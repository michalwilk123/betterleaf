import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { checkProjectSize } from "./lib/limits";

async function checkAccess(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  requireEditor = false
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = await authComponent.safeGetAuthUser(ctx as any);

  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Project not found");

  if (user) {
    const uid = user._id as string;
    if (project.ownerId === uid) return { user, project, role: "owner" as const };

    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    const member = membership.find((m) => m.userId === uid);
    if (member) {
      if (requireEditor && member.role === "viewer") {
        throw new Error("Viewer cannot edit");
      }
      return { user, project, role: member.role };
    }
  }

  // Public access fallback
  const pa = project.publicAccess;
  if (pa === "edit") return { user: user ?? null, project, role: "public-editor" as const };
  if (pa === "read") {
    if (requireEditor) throw new Error("Public viewers cannot edit");
    return { user: user ?? null, project, role: "public-viewer" as const };
  }

  throw new Error("Not authorized");
}

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.safeGetAuthUser(ctx as any);

    const project = await ctx.db.get(projectId);
    if (!project) return [];

    // Check access: owner, member, or public
    const uid = user ? (user._id as string) : null;
    let hasAccess = false;
    if (uid && project.ownerId === uid) {
      hasAccess = true;
    } else if (uid) {
      const membership = await ctx.db
        .query("projectMembers")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect();
      if (membership.some((m) => m.userId === uid)) hasAccess = true;
    }
    if (!hasAccess) {
      const pa = project.publicAccess;
      if (pa === "read" || pa === "edit") hasAccess = true;
    }
    if (!hasAccess) return [];

    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();

    return Promise.all(
      files.map(async (file) => {
        const storageUrl = file.storageId
          ? await ctx.storage.getUrl(file.storageId)
          : null;
        return { ...file, storageUrl };
      })
    );
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    content: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, name, content }) => {
    await checkAccess(ctx, projectId, true);
    const fileContent = content ?? "";
    const contentBytes = new TextEncoder().encode(fileContent).byteLength;
    await checkProjectSize(ctx, projectId, contentBytes);
    const now = Date.now();
    return ctx.db.insert("projectFiles", {
      projectId,
      name,
      content: fileContent,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateContent = mutation({
  args: {
    fileId: v.id("projectFiles"),
    content: v.string(),
  },
  handler: async (ctx, { fileId, content }) => {
    const file = await ctx.db.get(fileId);
    if (!file) throw new Error("File not found");
    await checkAccess(ctx, file.projectId, true);
    const contentBytes = new TextEncoder().encode(content).byteLength;
    await checkProjectSize(ctx, file.projectId, contentBytes, fileId);
    await ctx.db.patch(fileId, { content, updatedAt: Date.now() });
  },
});

export const rename = mutation({
  args: {
    fileId: v.id("projectFiles"),
    name: v.string(),
  },
  handler: async (ctx, { fileId, name }) => {
    const file = await ctx.db.get(fileId);
    if (!file) throw new Error("File not found");
    await checkAccess(ctx, file.projectId, true);
    await ctx.db.patch(fileId, { name, updatedAt: Date.now() });

    // If renamed file is the entrypoint and new name isn't .tex, clear it
    if (!name.endsWith(".tex")) {
      const project = await ctx.db.get(file.projectId);
      if (project?.entrypointFileId === fileId) {
        await ctx.db.patch(file.projectId, { entrypointFileId: undefined });
      }
    }
  },
});

export const generateUploadUrl = mutation({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }) => {
    if (projectId) {
      await checkAccess(ctx, projectId, true);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = await authComponent.getAuthUser(ctx as any);
      if (!user) throw new Error("Not authenticated");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const createBinary = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { projectId, name, storageId }) => {
    await checkAccess(ctx, projectId, true);
    const now = Date.now();
    return ctx.db.insert("projectFiles", {
      projectId,
      name,
      content: "",
      storageId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createManyText = mutation({
  args: {
    projectId: v.id("projects"),
    files: v.array(v.object({ name: v.string(), content: v.string() })),
  },
  handler: async (ctx, { projectId, files }) => {
    await checkAccess(ctx, projectId, true);
    const totalBytes = files.reduce(
      (sum, f) => sum + new TextEncoder().encode(f.content).byteLength,
      0
    );
    await checkProjectSize(ctx, projectId, totalBytes);
    const now = Date.now();
    for (const file of files) {
      await ctx.db.insert("projectFiles", {
        projectId,
        name: file.name,
        content: file.content,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

export const createManyBinary = mutation({
  args: {
    projectId: v.id("projects"),
    files: v.array(
      v.object({ name: v.string(), storageId: v.id("_storage") })
    ),
  },
  handler: async (ctx, { projectId, files }) => {
    await checkAccess(ctx, projectId, true);
    const now = Date.now();
    for (const file of files) {
      await ctx.db.insert("projectFiles", {
        projectId,
        name: file.name,
        content: "",
        storageId: file.storageId,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

export const remove = mutation({
  args: { fileId: v.id("projectFiles") },
  handler: async (ctx, { fileId }) => {
    const file = await ctx.db.get(fileId);
    if (!file) throw new Error("File not found");
    await checkAccess(ctx, file.projectId, true);

    // If deleted file is the entrypoint, clear it
    const project = await ctx.db.get(file.projectId);
    if (project?.entrypointFileId === fileId) {
      await ctx.db.patch(file.projectId, { entrypointFileId: undefined });
    }

    await ctx.db.delete(fileId);
  },
});
