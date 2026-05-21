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

export const markProjectCommit = internalMutation({
  args: { projectId: v.id("projects"), commitSha: v.string() },
  handler: async (ctx, { projectId, commitSha }) => {
    await ctx.db.patch(projectId, {
      githubLastCommitSha: commitSha,
      updatedAt: Date.now(),
    });
  },
});
