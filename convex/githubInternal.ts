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

export const markInstalledConnection = internalMutation({
  args: {
    userId: v.string(),
    login: v.string(),
  },
  handler: async (ctx, { userId, login }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const connection = {
      githubUserId: 0,
      login,
      accessToken: "",
      scope: "github_app_installation",
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, connection);
      return;
    }

    await ctx.db.insert("githubConnections", {
      userId,
      ...connection,
      createdAt: now,
    });
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
