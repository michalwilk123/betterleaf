import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const MAX_PROJECTS_PER_USER = 20;
export const MAX_PROJECT_SIZE_BYTES = 40 * 1024 * 1024; // 40 MB

export async function checkProjectCount(ctx: QueryCtx, userId: string) {
  const projects = await ctx.db.query("projects").collect();
  const count = projects.filter((p) => p.ownerId === userId).length;
  if (count >= MAX_PROJECTS_PER_USER) {
    throw new Error(
      `Project limit reached. You can have at most ${MAX_PROJECTS_PER_USER} projects.`
    );
  }
}

export async function checkProjectSize(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  newContentBytes: number,
  excludeFileId?: Id<"projectFiles">
) {
  const files = await ctx.db
    .query("projectFiles")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();

  let totalBytes = 0;
  for (const file of files) {
    if (excludeFileId && file._id === excludeFileId) continue;
    totalBytes += new TextEncoder().encode(file.content).byteLength;
  }
  totalBytes += newContentBytes;

  if (totalBytes > MAX_PROJECT_SIZE_BYTES) {
    const limitMB = (MAX_PROJECT_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(
      `Project size limit exceeded. Total content cannot exceed ${limitMB} MB.`
    );
  }
}
