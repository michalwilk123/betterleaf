import { v } from "convex/values";
import { query } from "./_generated/server";
import { authComponent } from "./auth";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function checkAccess(
  ctx: QueryCtx,
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

export const getLatestPdfUrl = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    try {
      await checkAccess(ctx, projectId);
    } catch {
      return null;
    }

    const latest = await ctx.db
      .query("compilationOutputs")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .order("desc")
      .first();
    if (!latest) return null;

    const pdfUrl = await ctx.storage.getUrl(latest.storageId);
    if (!pdfUrl) return null;

    return { pdfUrl, createdAt: latest.createdAt };
  },
});

export const getByHash = query({
  args: { projectId: v.id("projects"), zipHash: v.string() },
  handler: async (ctx, { projectId, zipHash }) => {
    try {
      await checkAccess(ctx, projectId);
    } catch {
      return null;
    }

    const project = await ctx.db.get(projectId);
    if (!project) return null;

    const output = await ctx.db
      .query("compilationOutputs")
      .withIndex("by_project_and_hash", (q) =>
        q.eq("projectId", projectId).eq("zipHash", zipHash)
      )
      .first();
    if (!output?.synctexStorageId || !output.entrypoint ||
        output.compiler !== (project.compiler ?? "pdflatex")) return null;

    const pdfUrl = await ctx.storage.getUrl(output.storageId);
    if (!pdfUrl) return null;

    return { pdfUrl };
  },
});
