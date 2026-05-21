import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Missing GITHUB_CLIENT_ID" }, { status: 500 });
  }

  const state = randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/github/callback`,
    scope: "repo read:user",
    state,
  });

  const response = NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
  response.cookies.set("github_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
