import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";

export const getProjectWithFiles = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("Project not found");

    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();

    // Resolve entrypoint filename
    const entrypointFile = project.entrypointFileId
      ? await ctx.db.get(project.entrypointFileId)
      : null;
    const entrypoint =
      entrypointFile?.name ??
      files.find((f) => f.name.endsWith(".tex") && !f.name.includes("/"))?.name ??
      "main.tex";

    const filesWithUrls = await Promise.all(
      files.map(async (file) => {
        const storageUrl = file.storageId
          ? await ctx.storage.getUrl(file.storageId)
          : null;
        return { name: file.name, content: file.content, storageUrl };
      })
    );
    filesWithUrls.push({
      name: ".betterleaf/entrypoint.txt",
      content: entrypoint,
      storageUrl: null,
    });

    return {
      compiler: project.compiler ?? "pdflatex",
      haltOnError: project.haltOnError ?? false,
      entrypoint,
      files: filesWithUrls,
    };
  },
});

export const getCompilationByHash = internalQuery({
  args: { projectId: v.id("projects"), zipHash: v.string() },
  handler: async (ctx, { projectId, zipHash }) => {
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

export const generateUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getBuildArtifacts = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const artifact = await ctx.db
      .query("buildArtifacts")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .first();
    if (!artifact) return null;

    const tarUrl = await ctx.storage.getUrl(artifact.storageId);
    if (!tarUrl) return null;

    return { tarUrl, compiler: artifact.compiler };
  },
});

export const saveBuildArtifacts = internalMutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    compiler: v.union(
      v.literal("pdflatex"),
      v.literal("xelatex"),
      v.literal("lualatex")
    ),
  },
  handler: async (ctx, { projectId, storageId, compiler }) => {
    const existing = await ctx.db
      .query("buildArtifacts")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .first();

    if (existing) {
      // Tolerant delete: a concurrent compile may have already removed this blob.
      try {
        await ctx.storage.delete(existing.storageId);
      } catch {
        // already gone — ignore
      }
      await ctx.db.patch(existing._id, { storageId, compiler, createdAt: Date.now() });
      return existing._id;
    }

    return await ctx.db.insert("buildArtifacts", {
      projectId,
      storageId,
      compiler,
      createdAt: Date.now(),
    });
  },
});

export const saveCompilation = internalMutation({
  args: {
    projectId: v.id("projects"),
    zipHash: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { projectId, zipHash, storageId }) => {
    const existing = await ctx.db
      .query("compilationOutputs")
      .withIndex("by_project_and_hash", (q) =>
        q.eq("projectId", projectId).eq("zipHash", zipHash)
      )
      .first();

    if (existing) {
      await ctx.storage.delete(existing.storageId);
      await ctx.db.patch(existing._id, { storageId, createdAt: Date.now() });
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
