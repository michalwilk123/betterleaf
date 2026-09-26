import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getToken } from "@/lib/auth-server";

const LATEX_SERVICE_URL = process.env.LATEX_SERVICE_URL!;
const LATEX_API_SECRET = process.env.LATEX_API_SECRET!;

export const preferredRegion = "fra1";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { projectId, zipHash, page, x, y } = body && typeof body === "object" ? body : {};
  if (
    typeof projectId !== "string" ||
    typeof zipHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(zipHash) ||
    !Number.isInteger(page) || page < 1 || page > 10000 ||
    !Number.isFinite(x) || x < 0 || x > 20000 ||
    !Number.isFinite(y) || y < 0 || y > 20000
  ) {
    return NextResponse.json({ error: "Invalid SyncTeX position" }, { status: 400 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const token = await getToken();
  if (token) convex.setAuth(token);
  try {
    const build = await convex.query(api.compilations.getByHash, {
      projectId: projectId as Id<"projects">,
      zipHash,
    });
    if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }

  if (!LATEX_SERVICE_URL || !LATEX_API_SECRET) {
    return NextResponse.json({ error: "SyncTeX service unavailable" }, { status: 503 });
  }

  const formData = new FormData();
  formData.append("project_id", projectId);
  formData.append("zip_hash", zipHash);
  formData.append("page", String(page));
  formData.append("x", String(x));
  formData.append("y", String(y));

  try {
    const response = await fetch(`${LATEX_SERVICE_URL}/synctex`, {
      method: "POST",
      headers: { Authorization: `Bearer ${LATEX_API_SECRET}` },
      body: formData,
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      return NextResponse.json({ error: "No source location found" }, { status: 404 });
    }
    return NextResponse.json({ path: result.path, line: result.line });
  } catch {
    return NextResponse.json({ error: "SyncTeX lookup failed" }, { status: 502 });
  }
}
