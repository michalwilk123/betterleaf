import { NextRequest, NextResponse } from "next/server";

const LATEX_SERVICE_URL = process.env.LATEX_SERVICE_URL!;
const LATEX_API_SECRET = process.env.LATEX_API_SECRET!;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectId, timeout } = body as { projectId?: string; timeout?: number };

  if (!projectId) {
    return NextResponse.json(
      { error: "Missing required field: projectId" },
      { status: 400 }
    );
  }

  console.log("[compile/route] projectId:", projectId, "timeout:", timeout);

  const formData = new FormData();
  formData.append("project_id", projectId);
  formData.append("timeout", String(timeout ?? 120));

  console.log("[compile/route] sending to LaTeX service:", `${LATEX_SERVICE_URL}/compile-project`);
  const response = await fetch(`${LATEX_SERVICE_URL}/compile-project`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LATEX_API_SECRET}`,
    },
    body: formData,
    signal: AbortSignal.timeout(130_000),
  });

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

  // Forward error JSON
  const errorBody = await response.json();
  console.error("[compile/route] error from LaTeX service:", JSON.stringify(errorBody).slice(0, 500));
  return NextResponse.json(errorBody, { status: response.status });
}
