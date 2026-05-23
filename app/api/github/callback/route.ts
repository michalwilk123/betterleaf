import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const installationId = url.searchParams.get("installation_id");

  if (!state) {
    console.warn("[github/callback] missing state", {
      hasCode: Boolean(code),
      hasInstallationId: Boolean(installationId),
    });
    return NextResponse.redirect(new URL("/projects?github=error", request.url));
  }

  console.info("[github/callback] received callback", {
    hasCode: Boolean(code),
    hasInstallationId: Boolean(installationId),
    stateLength: state.length,
  });

  // App was installed without OAuth-during-install enabled: fall back to OAuth so we can identify the user.
  if (!code) {
    if (!installationId) {
      console.warn("[github/callback] missing code and installation_id", {
        stateLength: state.length,
      });
      return NextResponse.redirect(new URL("/projects?github=error", request.url));
    }
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: "Missing GITHUB_CLIENT_ID" }, { status: 500 });
    }
    const oauthUrl = new URL("https://github.com/login/oauth/authorize");
    oauthUrl.searchParams.set("client_id", clientId);
    oauthUrl.searchParams.set(
      "redirect_uri",
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/github/callback`
    );
    oauthUrl.searchParams.set("state", state);
    return NextResponse.redirect(oauthUrl.toString());
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Missing GitHub OAuth configuration" }, { status: 500 });
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/github/callback`,
    }),
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.access_token) {
    console.warn("[github/callback] token exchange failed", {
      status: tokenResponse.status,
      error: tokenBody?.error,
      errorDescription: tokenBody?.error_description,
    });
    return NextResponse.redirect(new URL("/projects?github=error", request.url));
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenBody.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const githubUser = await userResponse.json();
  if (!userResponse.ok) {
    console.warn("[github/callback] GitHub user fetch failed", {
      status: userResponse.status,
      message: githubUser?.message,
    });
    return NextResponse.redirect(new URL("/projects?github=error", request.url));
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  await convex.mutation(api.github.consumeOAuthStateAndSaveConnection, {
    state,
    githubUserId: githubUser.id,
    login: githubUser.login,
    accessToken: tokenBody.access_token,
    scope: tokenBody.scope || undefined,
  });

  console.info("[github/callback] saved GitHub connection", {
    login: githubUser.login,
    githubUserId: githubUser.id,
  });
  const response = NextResponse.redirect(new URL("/projects?github=connected", request.url));
  return response;
}
