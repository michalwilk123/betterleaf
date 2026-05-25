import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { authComponent } from "./auth";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { importPKCS8, SignJWT } from "jose";

type GithubTextFile = {
  path: string;
  content: string;
};

type GithubBinaryFile = {
  path: string;
  storageId: Id<"_storage">;
};

type GithubTreeEntry = {
  path: string;
  type: string;
};

type GithubFile = GithubTextFile;

const TEXT_FILE_PATTERN =
  /\.(tex|bib|bst|cls|sty|md|txt|json|yaml|yml|csv|tikz|cfg|def|bbx|cbx|lbx)$/i;
const IGNORED_GITHUB_PATH_PATTERN =
  /(^|\/)(\.git|node_modules|\.next|out|build|coverage)(\/|$)/i;

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

function getGithubAppPrivateKey() {
  const encodedKey = process.env.GITHUB_APP_PRIVATE_KEY_B64;
  if (!encodedKey) throw new Error("Missing GITHUB_APP_PRIVATE_KEY_B64");
  return atob(encodedKey);
}

async function createGithubAppJwt() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error("Missing GITHUB_CLIENT_ID");

  const privateKey = await importPKCS8(getGithubAppPrivateKey(), "RS256");
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(clientId)
    .sign(privateKey);
}

async function getInstallationTokenForRepo(owner: string, repo: string) {
  const appJwt = await createGithubAppJwt();
  const installationResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/installation`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (installationResponse.status === 404) {
    throw new Error(
      `Install the BetterLeaf GitHub App on ${owner}/${repo} before creating a synced project`
    );
  }
  if (!installationResponse.ok) {
    const body = await installationResponse.text();
    throw new Error(`GitHub App installation lookup failed (${installationResponse.status}): ${body.slice(0, 300)}`);
  }
  const installation = await installationResponse.json();
  const token = await githubFetch(
    appJwt,
    `https://api.github.com/app/installations/${installation.id}/access_tokens`,
    { method: "POST" }
  );
  return token.token as string;
}

function decodeBase64(content: string) {
  const normalized = content.replace(/\n/g, "");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function decodeBase64Bytes(content: string) {
  const normalized = content.replace(/\n/g, "");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function getContentType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function hasLikelyUtf8Mojibake(content: string) {
  return /(?:Ã.|Å.|Ä.|Â.|â[]|Î.|Ï.)/.test(content);
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

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");
    const userId = user._id as string;
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
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

export const createOAuthState = mutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    const now = Date.now();
    await ctx.db.insert("githubOAuthStates", {
      state,
      userId: user._id as string,
      createdAt: now,
      expiresAt: now + 10 * 60 * 1000,
    });
  },
});

export const consumeOAuthStateAndSaveConnection = mutation({
  args: {
    state: v.string(),
    githubUserId: v.number(),
    login: v.string(),
    accessToken: v.string(),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, { state, githubUserId, login, accessToken, scope }) => {
    const oauthState = await ctx.db
      .query("githubOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!oauthState || oauthState.expiresAt < Date.now()) {
      throw new Error("Invalid GitHub authorization state");
    }

    await ctx.db.delete(oauthState._id);

    const now = Date.now();
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", oauthState.userId))
      .unique();
    const connection = {
      githubUserId,
      login,
      accessToken,
      scope,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, connection);
      return;
    }
    await ctx.db.insert("githubConnections", {
      userId: oauthState.userId,
      ...connection,
      createdAt: now,
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

    const repo = normalizeRepo(args.repo);
    const rootPath = normalizePath(args.path);
    const branch = args.branch.trim();
    const installationToken = await getInstallationTokenForRepo(repo.owner, repo.name);
    const latestCommit = await getBranchCommit(installationToken, repo.owner, repo.name, branch);
    const files = await readGithubFiles(
      ctx,
      installationToken,
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
    await ctx.runMutation(api.files.replaceProjectFiles, {
      projectId: result.projectId,
      textFiles: files.textFiles.map((file) => ({ name: file.path, content: file.content })),
      binaryFiles: files.binaryFiles.map((file) => ({
        name: file.path,
        storageId: file.storageId,
      })),
      githubLastCommitSha: latestCommit,
    });
    return result;
  },
});

export const verifyInstallation = action({
  args: { repo: v.string() },
  handler: async (ctx, { repo }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await authComponent.getAuthUser(ctx as any);
    if (!user) throw new Error("Not authenticated");

    const parsedRepo = normalizeRepo(repo);

    try {
      await getInstallationTokenForRepo(parsedRepo.owner, parsedRepo.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown installation error";
      return { installed: false, message };
    }

    await ctx.runMutation(internal.githubInternal.markInstalledConnection, {
      userId: user._id as string,
      login: `GitHub App installed for ${parsedRepo.owner}/${parsedRepo.name}`,
    });

    return { installed: true };
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

    const installationToken = await getInstallationTokenForRepo(
      project.githubRepoOwner,
      project.githubRepoName
    );
    const latestCommit = await getBranchCommit(
      installationToken,
      project.githubRepoOwner,
      project.githubRepoName,
      project.githubBranch
    );
    if (latestCommit === project.githubLastCommitSha) {
      const localFiles = await ctx.runQuery(api.files.listByProject, { projectId });
      const hasCorruptedText = localFiles.some(
        (file: { storageId?: Id<"_storage">; content: string }) =>
          !file.storageId && hasLikelyUtf8Mojibake(file.content)
      );
      if (!hasCorruptedText) {
        const remotePaths = await readGithubFilePaths(
          installationToken,
          project.githubRepoOwner,
          project.githubRepoName,
          project.githubBranch,
          project.githubPath ?? ""
        );
        const localPaths = new Set(localFiles.map((file: { name: string }) => file.name));
        const hasMissingRemoteFile = remotePaths.some((path) => !localPaths.has(path));
        if (!hasMissingRemoteFile) return { updated: false };
      }
    }

    const files = await readGithubFiles(
      ctx,
      installationToken,
      project.githubRepoOwner,
      project.githubRepoName,
      project.githubBranch,
      project.githubPath ?? ""
    );
    await ctx.runMutation(api.files.replaceProjectFiles, {
      projectId,
      textFiles: files.textFiles.map((file) => ({ name: file.path, content: file.content })),
      binaryFiles: files.binaryFiles.map((file) => ({
        name: file.path,
        storageId: file.storageId,
      })),
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
    const corruptedFile = files.find(
      (file: { storageId?: Id<"_storage">; name: string; content: string }) =>
        !file.storageId && hasLikelyUtf8Mojibake(file.content)
    );
    if (corruptedFile) {
      throw new Error(
        `Refusing to commit because ${corruptedFile.name} contains text that looks like corrupted UTF-8. Sync from GitHub first to reload the file with the fixed decoder.`
      );
    }

    const installationToken = await getInstallationTokenForRepo(
      project.githubRepoOwner,
      project.githubRepoName
    );
    const commitSha = await commitFiles(
      installationToken,
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

async function readGithubFiles(
  ctx: ActionCtx,
  token: string,
  owner: string,
  repo: string,
  branch: string,
  rootPath: string
): Promise<{ textFiles: GithubTextFile[]; binaryFiles: GithubBinaryFile[] }> {
  const entries = await readGithubTreeEntries(token, owner, repo, branch, rootPath);

  const textFiles: GithubTextFile[] = [];
  const binaryFiles: GithubBinaryFile[] = [];
  for (const entry of entries) {
    const data = await githubFetch(
      token,
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(entry.path)}?ref=${encodeURIComponent(branch)}`
    );
    const relativePath = getGithubRelativePath(entry.path, rootPath);
    if (TEXT_FILE_PATTERN.test(entry.path)) {
      textFiles.push({ path: relativePath, content: decodeBase64(data.content) });
    } else {
      const bytes = decodeBase64Bytes(data.content);
      const storageId = await ctx.storage.store(
        new Blob([bytes], { type: getContentType(entry.path) })
      );
      binaryFiles.push({ path: relativePath, storageId });
    }
  }
  return { textFiles, binaryFiles };
}

async function readGithubFilePaths(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  rootPath: string
) {
  const entries = await readGithubTreeEntries(token, owner, repo, branch, rootPath);
  return entries.map((entry) => getGithubRelativePath(entry.path, rootPath));
}

async function readGithubTreeEntries(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  rootPath: string
) {
  const tree = await githubFetch(
    token,
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  const prefix = rootPath ? `${rootPath}/` : "";
  return (tree.tree as GithubTreeEntry[]).filter((entry) => {
    if (entry.type !== "blob") return false;
    if (rootPath && entry.path !== rootPath && !entry.path.startsWith(prefix)) return false;
    return !IGNORED_GITHUB_PATH_PATTERN.test(entry.path);
  });
}

function getGithubRelativePath(path: string, rootPath: string) {
  return rootPath ? path.slice(`${rootPath}/`.length) : path;
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
