import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { authComponent } from "./auth";
import type { Id } from "./_generated/dataModel";

type GithubFile = {
  path: string;
  content: string;
};

const TEXT_FILE_PATTERN =
  /\.(tex|bib|bst|cls|sty|md|txt|json|yaml|yml|csv|tikz|cfg|def|bbx|cbx|lbx)$/i;

function normalizeRepo(input: string) {
  const trimmed = input.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  const [owner, name] = trimmed.split("/");
  if (!owner || !name) throw new Error("Repository must be in owner/name format");
  return { owner, name };
}

function normalizePath(path: string | undefined) {
  return (path ?? "").trim().replace(/^\/+|\/+$/g, "");
}

async function githubFetch(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

function decodeBase64(content: string) {
  const normalized = content.replace(/\n/g, "");
  return atob(normalized);
}

export const status = query({
  args: {},
  handler: async (ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.safeGetAuthUser(ctx as any);
    if (!user) return { connected: false };
    const connection = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", user._id as string))
      .unique();
    if (!connection) return { connected: false };
    return { connected: true, login: connection.login };
  },
});

export const saveConnection = mutation({
  args: {
    githubUserId: v.number(),
    login: v.string(),
    accessToken: v.string(),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");
    const userId = user._id as string;
    const now = Date.now();
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return;
    }
    await ctx.db.insert("githubConnections", {
      userId,
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createSyncedProject = action({
  args: {
    repo: v.string(),
    branch: v.string(),
    path: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ shortId: string; projectId: Id<"projects"> }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");
    const connection = await ctx.runQuery(internal.githubInternal.getConnectionForAction, {
      userId: user._id as string,
    });
    if (!connection) throw new Error("Connect GitHub before creating a synced project");

    const repo = normalizeRepo(args.repo);
    const rootPath = normalizePath(args.path);
    const branch = args.branch.trim();
    const latestCommit = await getBranchCommit(connection.accessToken, repo.owner, repo.name, branch);
    const files = await readGithubTextFiles(
      connection.accessToken,
      repo.owner,
      repo.name,
      branch,
      rootPath
    );

    const result: { shortId: string; projectId: Id<"projects"> } = await ctx.runMutation(api.projects.create, {
      name: args.name?.trim() || repo.name,
      skipDefaultFile: true,
      githubRepoOwner: repo.owner,
      githubRepoName: repo.name,
      githubBranch: branch,
      githubPath: rootPath,
      githubLastCommitSha: latestCommit,
    });
    await ctx.runMutation(api.files.replaceProjectTextFiles, {
      projectId: result.projectId,
      files: files.map((file) => ({ name: file.path, content: file.content })),
      githubLastCommitSha: latestCommit,
    });
    return result;
  },
});

export const syncFromGithub = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.runQuery(api.projects.getByIdForOwner, { projectId });
    if (!project) throw new Error("Project not found");
    if (!project.githubRepoOwner || !project.githubRepoName || !project.githubBranch) {
      return { updated: false };
    }

    const connection = await ctx.runQuery(internal.githubInternal.getConnectionForAction, {
      userId: user._id as string,
    });
    if (!connection) throw new Error("Connect GitHub before syncing this project");

    const latestCommit = await getBranchCommit(
      connection.accessToken,
      project.githubRepoOwner,
      project.githubRepoName,
      project.githubBranch
    );
    if (latestCommit === project.githubLastCommitSha) return { updated: false };

    const files = await readGithubTextFiles(
      connection.accessToken,
      project.githubRepoOwner,
      project.githubRepoName,
      project.githubBranch,
      project.githubPath ?? ""
    );
    await ctx.runMutation(api.files.replaceProjectTextFiles, {
      projectId,
      files: files.map((file) => ({ name: file.path, content: file.content })),
      githubLastCommitSha: latestCommit,
    });
    return { updated: true };
  },
});

export const commitProject = action({
  args: { projectId: v.id("projects"), message: v.optional(v.string()) },
  handler: async (ctx, { projectId, message }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.runQuery(api.projects.getByIdForOwner, { projectId });
    if (!project) throw new Error("Project not found");
    if (!project.githubRepoOwner || !project.githubRepoName || !project.githubBranch) {
      return { committed: false };
    }
    const connection = await ctx.runQuery(internal.githubInternal.getConnectionForAction, {
      userId: user._id as string,
    });
    if (!connection) throw new Error("Connect GitHub before committing this project");

    const files = await ctx.runQuery(api.files.listByProject, { projectId });
    const commitSha = await commitFiles(
      connection.accessToken,
      project.githubRepoOwner,
      project.githubRepoName,
      project.githubBranch,
      project.githubPath ?? "",
      files
        .filter((file: { storageId?: Id<"_storage"> }) => !file.storageId)
        .map((file: { name: string; content: string }) => ({ path: file.name, content: file.content })),
      message ?? `Update ${project.name}`
    );
    await ctx.runMutation(internal.githubInternal.markProjectCommit, { projectId, commitSha });
    return { committed: true, commitSha };
  },
});

async function getBranchCommit(token: string, owner: string, repo: string, branch: string) {
  const data = await githubFetch(
    token,
    `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
  );
  return data.commit.sha as string;
}

async function readGithubTextFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  rootPath: string
): Promise<GithubFile[]> {
  const tree = await githubFetch(
    token,
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  const prefix = rootPath ? `${rootPath}/` : "";
  const entries = (tree.tree as Array<{ path: string; type: string }>).filter((entry) => {
    if (entry.type !== "blob") return false;
    if (rootPath && entry.path !== rootPath && !entry.path.startsWith(prefix)) return false;
    return TEXT_FILE_PATTERN.test(entry.path);
  });

  const files: GithubFile[] = [];
  for (const entry of entries) {
    const data = await githubFetch(
      token,
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(entry.path)}?ref=${encodeURIComponent(branch)}`
    );
    const relativePath = rootPath ? entry.path.slice(prefix.length) : entry.path;
    files.push({ path: relativePath, content: decodeBase64(data.content) });
  }
  return files;
}

async function commitFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  rootPath: string,
  files: GithubFile[],
  message: string
) {
  const ref = await githubFetch(
    token,
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  const baseCommitSha = ref.object.sha as string;
  const baseCommit = await githubFetch(
    token,
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${baseCommitSha}`
  );
  const tree = await githubFetch(
    token,
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: files.map((file) => ({
          path: rootPath ? `${rootPath}/${file.path}` : file.path,
          mode: "100644",
          type: "blob",
          content: file.content,
        })),
      }),
    }
  );
  const commit = await githubFetch(
    token,
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [baseCommitSha],
      }),
    }
  );
  await githubFetch(
    token,
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    }
  );
  return commit.sha as string;
}
