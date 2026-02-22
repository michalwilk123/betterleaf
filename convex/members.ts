import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await authComponent.safeGetAuthUser(ctx as any);
    if (!user) return [];

    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== (user._id as string)) return [];

    const members = await ctx.db
      .query("projectMembers")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();

    const membersWithInfo = await Promise.all(
      members.map(async (m) => {
        const memberUser = await authComponent.getAnyUserById(ctx as any, m.userId);
        return {
          ...m,
          name: memberUser?.name ?? "Unknown",
          email: memberUser?.email ?? "",
        };
      })
    );

    return membersWithInfo;
  },
});

export const addByEmail = mutation({
  args: {
    projectId: v.id("projects"),
    email: v.string(),
    role: v.union(v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, { projectId, email, role }) => {
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== (user._id as string)) {
      throw new Error("Not authorized");
    }

    // Check if already a member (we can't easily look up by email in members table,
    // so we store as pending invite and resolve on login)
    const now = Date.now();
    await ctx.db.insert("pendingInvites", {
      projectId,
      email: email.toLowerCase(),
      role,
      invitedBy: (user._id as string),
      createdAt: now,
    });
  },
});

export const listPendingInvites = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await authComponent.safeGetAuthUser(ctx as any);
    if (!user) return [];

    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== (user._id as string)) return [];

    return ctx.db
      .query("pendingInvites")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const removeInvite = mutation({
  args: { inviteId: v.id("pendingInvites") },
  handler: async (ctx, { inviteId }) => {
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new Error("Invite not found");

    const project = await ctx.db.get(invite.projectId);
    if (!project || project.ownerId !== (user._id as string)) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(inviteId);
  },
});

export const remove = mutation({
  args: {
    memberId: v.id("projectMembers"),
  },
  handler: async (ctx, { memberId }) => {
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    const member = await ctx.db.get(memberId);
    if (!member) throw new Error("Member not found");

    const project = await ctx.db.get(member.projectId);
    if (!project || project.ownerId !== (user._id as string)) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(memberId);
  },
});

export const resolvePendingInvites = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx as any);
    if (!user || !user.email) return;

    const invites = await ctx.db
      .query("pendingInvites")
      .withIndex("by_email", (q) => q.eq("email", user.email!.toLowerCase()))
      .collect();

    for (const invite of invites) {
      // Check if already a member
      const existingMembers = await ctx.db
        .query("projectMembers")
        .withIndex("by_projectId", (q) => q.eq("projectId", invite.projectId))
        .collect();

      if (!existingMembers.some((m) => m.userId === (user._id as string))) {
        await ctx.db.insert("projectMembers", {
          projectId: invite.projectId,
          userId: (user._id as string),
          role: invite.role,
          createdAt: Date.now(),
        });
      }

      await ctx.db.delete(invite._id);
    }
  },
});
