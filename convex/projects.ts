import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { nanoid } from "nanoid";
import { authComponent } from "./auth";
import type { Id } from "./_generated/dataModel";
import { checkProjectCount } from "./lib/limits";

const DEFAULT_MAIN_TEX = `\\documentclass{article}
\\usepackage[utf8]{inputenc}

\\title{Untitled Document}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Start writing here.

\\end{document}
`;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx as any);
    if (!user) return [];
    const userId = user._id as string;

    // Get owned projects
    const owned = await ctx.db.query("projects").collect();
    const ownedByMe = owned.filter((p) => p.ownerId === userId);

    // Get shared projects via membership
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const sharedProjectIds = new Set(memberships.map((m) => m.projectId));

    const sharedProjects = await Promise.all(
      [...sharedProjectIds]
        .filter((id) => !ownedByMe.some((p) => p._id === id))
        .map((id) => ctx.db.get(id))
    );

    const allProjects = [
      ...ownedByMe.map((p) => ({ ...p, isOwned: true })),
      ...sharedProjects
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => ({ ...p, isOwned: false })),
    ];

    return allProjects.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: { shortId: v.string() },
  handler: async (ctx, { shortId }) => {
    const user = await authComponent.safeGetAuthUser(ctx as any);

    const project = await ctx.db
      .query("projects")
      .withIndex("by_shortId", (q) => q.eq("shortId", shortId))
      .unique();
    if (!project) return null;

    const uid = user ? (user._id as string) : null;

    // Check access: owner, member, or public
    if (uid && project.ownerId === uid) {
      return { ...project, isOwned: true, accessLevel: "owner" as const };
    }

    if (uid) {
      const membership = await ctx.db
        .query("projectMembers")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .collect();
      const member = membership.find((m) => m.userId === uid);
      if (member) {
        return {
          ...project,
          isOwned: false,
          accessLevel: member.role === "editor" ? "editor" as const : "viewer" as const,
        };
      }
    }

    // Public access fallback
    const pa = project.publicAccess;
    if (pa === "edit") {
      return { ...project, isOwned: false, accessLevel: "public-editor" as const };
    }
    if (pa === "read") {
      return { ...project, isOwned: false, accessLevel: "public-viewer" as const };
    }

    return null;
  },
});

export const create = mutation({
  args: { name: v.optional(v.string()), skipDefaultFile: v.optional(v.boolean()) },
  handler: async (ctx, { name, skipDefaultFile }) => {
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    await checkProjectCount(ctx, user._id as string);

    const now = Date.now();
    const shortId = nanoid(10);
    const projectName = name || "Untitled Project";

    const projectId = await ctx.db.insert("projects", {
      shortId,
      name: projectName,
      ownerId: user._id as string,
      createdAt: now,
      updatedAt: now,
    });

    if (!skipDefaultFile) {
      // Create default main.tex and set as entrypoint
      const mainTexId = await ctx.db.insert("projectFiles", {
        projectId,
        name: "main.tex",
        content: DEFAULT_MAIN_TEX,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(projectId, { entrypointFileId: mainTexId });
    }

    return { shortId, projectId };
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    compiler: v.optional(v.union(v.literal("pdflatex"), v.literal("xelatex"), v.literal("lualatex"))),
    haltOnError: v.optional(v.boolean()),
    publicAccess: v.optional(v.union(v.literal("none"), v.literal("read"), v.literal("edit"))),
  },
  handler: async (ctx, { projectId, name, compiler, haltOnError, publicAccess }) => {
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== (user._id as string)) {
      throw new Error("Not authorized");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (name !== undefined) patch.name = name;
    if (compiler !== undefined) patch.compiler = compiler;
    if (haltOnError !== undefined) patch.haltOnError = haltOnError;
    if (publicAccess !== undefined) patch.publicAccess = publicAccess;

    await ctx.db.patch(projectId, patch);
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== (user._id as string)) {
      throw new Error("Not authorized");
    }

    // Delete files
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    for (const file of files) {
      await ctx.db.delete(file._id);
    }

    // Delete members
    const members = await ctx.db
      .query("projectMembers")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    for (const member of members) {
      await ctx.db.delete(member._id);
    }

    // Delete pending invites
    const invites = await ctx.db
      .query("pendingInvites")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    for (const invite of invites) {
      await ctx.db.delete(invite._id);
    }

    // Delete compilation outputs and their stored PDFs
    const outputs = await ctx.db
      .query("compilationOutputs")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    for (const output of outputs) {
      await ctx.storage.delete(output.storageId);
      await ctx.db.delete(output._id);
    }

    // Delete project
    await ctx.db.delete(projectId);
  },
});

export const setEntrypoint = mutation({
  args: { projectId: v.id("projects"), fileId: v.id("projectFiles") },
  handler: async (ctx, { projectId, fileId }) => {
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("Project not found");
    if (project.ownerId !== (user._id as string)) {
      throw new Error("Not authorized");
    }

    const file = await ctx.db.get(fileId);
    if (!file || file.projectId !== projectId) {
      throw new Error("File not found in project");
    }
    if (!file.name.endsWith(".tex")) {
      throw new Error("Entrypoint must be a .tex file");
    }

    await ctx.db.patch(projectId, { entrypointFileId: fileId });
  },
});
