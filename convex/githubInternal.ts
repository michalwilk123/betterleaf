import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getConnectionForAction = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const adminClearConnectionByLogin = internalMutation({
  args: { login: v.string() },
  handler: async (ctx, { login }) => {
    const matches = await ctx.db
      .query("githubConnections")
      .filter((q) => q.eq(q.field("login"), login))
      .collect();
    for (const row of matches) {
      await ctx.db.delete(row._id);
    }
    return { deleted: matches.length };
  },
});

export const markProjectCommit = internalMutation({
  args: { projectId: v.id("projects"), commitSha: v.string() },
  handler: async (ctx, { projectId, commitSha }) => {
    await ctx.db.patch(projectId, {
      githubLastCommitSha: commitSha,
      updatedAt: Date.now(),
    });
  },
});
