import { NextRequest, NextResponse } from "next/server";

const LATEX_SERVICE_URL = process.env.LATEX_SERVICE_URL!;
const LATEX_API_SECRET = process.env.LATEX_API_SECRET!;

export const preferredRegion = "fra1";
export const maxDuration = 130;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { projectId, timeout } = body as { projectId?: string; timeout?: number };

  if (!projectId) {
    return NextResponse.json(
      { error: "Missing required field: projectId" },
      { status: 400 }
    );
  }

  if (!LATEX_SERVICE_URL) {
    console.error("[compile/route] LATEX_SERVICE_URL is not configured");
    return NextResponse.json(
      {
        error: "service_misconfigured",
        message: "LaTeX service URL is not configured",
        log: "LATEX_SERVICE_URL env var is not set",
      },
      { status: 500 }
    );
  }

  if (!LATEX_API_SECRET) {
    console.error("[compile/route] LATEX_API_SECRET is not configured");
    return NextResponse.json(
      {
        error: "service_misconfigured",
        message: "LaTeX service secret is not configured",
        log: "LATEX_API_SECRET env var is not set",
      },
      { status: 500 }
    );
  }

  console.log("[compile/route] projectId:", projectId, "timeout:", timeout);

  const formData = new FormData();
  formData.append("project_id", projectId);
  formData.append("timeout", String(timeout ?? 120));

  console.log("[compile/route] sending to LaTeX service:", `${LATEX_SERVICE_URL}/compile-project`);

  let response: Response;
  try {
    response = await fetch(`${LATEX_SERVICE_URL}/compile-project`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LATEX_API_SECRET}`,
      },
      body: formData,
      signal: AbortSignal.timeout(130_000),
    });
  } catch (err) {
    // fetch never got a response: bad LATEX_SERVICE_URL, unreachable host,
    // or the request timed out. Surface it instead of a bare 500.
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    const detail = err instanceof Error ? `${err.message}${cause}` : String(err);
    console.error("[compile/route] failed to reach LaTeX service:", detail);
    return NextResponse.json(
      {
        error: "service_unreachable",
        message: "Could not reach LaTeX service",
        log: detail,
      },
      { status: 502 }
    );
  }

  const contentType = response.headers.get("content-type") || "";
  console.log("[compile/route] LaTeX service response:", response.status, response.statusText, "contentType:", contentType);

  if (contentType.includes("application/pdf")) {
    const pdfBytes = await response.arrayBuffer();
    console.log("[compile/route] PDF received, size:", pdfBytes.byteLength);
    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=output.pdf",
      },
    });
  }

  // Non-PDF response. Forward JSON errors verbatim; if the body isn't JSON
  // (e.g. an HTML error page from a proxy), wrap the text so a log still reaches the UI.
  const raw = await response.text();
  let errorBody: unknown;
  try {
    errorBody = JSON.parse(raw);
  } catch {
    errorBody = {
      error: "compilation_failed",
      message: response.statusText || "Compilation failed",
      log: raw.slice(0, 500) || response.statusText,
    };
  }
  console.error("[compile/route] error from LaTeX service:", JSON.stringify(errorBody).slice(0, 500));
  return NextResponse.json(errorBody, { status: response.status });
}
