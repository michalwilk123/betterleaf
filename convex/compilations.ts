import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function checkAccess(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = await authComponent.safeGetAuthUser(ctx as any);

  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Project not found");

  if (user) {
    const uid = user._id as string;
    if (project.ownerId === uid) return;

    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    if (membership.some((m) => m.userId === uid)) return;
  }

  // Public access fallback
  const pa = project.publicAccess;
  if (pa === "read" || pa === "edit") return;

  throw new Error("Not authorized");
}

export const getByHash = query({
  args: { projectId: v.id("projects"), zipHash: v.string() },
  handler: async (ctx, { projectId, zipHash }) => {
    try {
      await checkAccess(ctx, projectId);
    } catch {
      return null;
    }

    const output = await ctx.db
      .query("compilationOutputs")
      .withIndex("by_project_and_hash", (q) =>
        q.eq("projectId", projectId).eq("zipHash", zipHash)
      )
      .first();
    if (!output) return null;

    const pdfUrl = await ctx.storage.getUrl(output.storageId);
    if (!pdfUrl) return null;

    return { pdfUrl };
  },
});

export const generateUploadUrl = mutation({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }) => {
    if (projectId) {
      await checkAccess(ctx, projectId);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = await authComponent.getAuthUser(ctx as any);
      if (!user) throw new Error("Not authenticated");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const save = mutation({
  args: {
    projectId: v.id("projects"),
    zipHash: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { projectId, zipHash, storageId }) => {
    await checkAccess(ctx, projectId);

    const existing = await ctx.db
      .query("compilationOutputs")
      .withIndex("by_project_and_hash", (q) =>
        q.eq("projectId", projectId).eq("zipHash", zipHash)
      )
      .first();

    if (existing) {
      await ctx.storage.delete(existing.storageId);
      await ctx.db.patch(existing._id, {
        storageId,
        createdAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("compilationOutputs", {
      projectId,
      zipHash,
      storageId,
      createdAt: Date.now(),
    });
  },
});
