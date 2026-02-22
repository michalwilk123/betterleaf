import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    shortId: v.string(),
    name: v.string(),
    ownerId: v.string(),
    entrypointFileId: v.optional(v.id("projectFiles")),
    compiler: v.optional(v.union(v.literal("pdflatex"), v.literal("xelatex"), v.literal("lualatex"))),
    haltOnError: v.optional(v.boolean()),
    publicAccess: v.optional(v.union(v.literal("none"), v.literal("read"), v.literal("edit"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_shortId", ["shortId"]),

  projectFiles: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    content: v.string(),
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    role: v.union(v.literal("editor"), v.literal("viewer")),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"])
    .index("by_userId", ["userId"]),

  compilationOutputs: defineTable({
    projectId: v.id("projects"),
    zipHash: v.string(),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  })
    .index("by_project_and_hash", ["projectId", "zipHash"])
    .index("by_projectId", ["projectId"]),

  pendingInvites: defineTable({
    projectId: v.id("projects"),
    email: v.string(),
    role: v.union(v.literal("editor"), v.literal("viewer")),
    invitedBy: v.string(),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"])
    .index("by_email", ["email"]),
});
