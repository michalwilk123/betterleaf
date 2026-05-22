import { NextRequest, NextResponse } from "next/server";

const DEFAULT_APP_SLUG = "betterleaf-integration";

export async function GET(request: NextRequest) {
  const state = new URL(request.url).searchParams.get("state");
  if (!state) {
    return NextResponse.redirect(new URL("/projects?github=error", request.url));
  }

  const appSlug = process.env.GITHUB_APP_SLUG ?? DEFAULT_APP_SLUG;
  const installUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  installUrl.searchParams.set("state", state);

  return NextResponse.redirect(installUrl.toString());
}
