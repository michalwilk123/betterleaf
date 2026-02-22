import { NextRequest, NextResponse } from "next/server";

const LATEX_SERVICE_URL = process.env.LATEX_SERVICE_URL!;
const LATEX_API_SECRET = process.env.LATEX_API_SECRET!;

export async function POST(request: NextRequest) {
  const incoming = await request.formData();

  const file = incoming.get("file") as Blob | null;
  const entrypoint = incoming.get("entrypoint") as string | null;
  const timeout = incoming.get("timeout") as string | null;
  const compiler = incoming.get("compiler") as string | null;
  const haltOnError = incoming.get("halt_on_error") as string | null;

  if (!file || !entrypoint) {
    return NextResponse.json(
      { error: "Missing required fields: file, entrypoint" },
      { status: 400 }
    );
  }

  console.log("[compile/route] file size:", file.size, "entrypoint:", entrypoint, "timeout:", timeout, "compiler:", compiler, "halt_on_error:", haltOnError);

  const formData = new FormData();
  formData.append("file", file, "project.zip");
  formData.append("entrypoint", entrypoint);
  formData.append("timeout", timeout ?? "120");
  if (compiler) formData.append("compiler", compiler);
  if (haltOnError) formData.append("halt_on_error", haltOnError);

  console.log("[compile/route] sending to LaTeX service:", `${LATEX_SERVICE_URL}/compile`);
  const response = await fetch(`${LATEX_SERVICE_URL}/compile`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LATEX_API_SECRET}`,
    },
    body: formData,
    signal: AbortSignal.timeout(130_000),
  });

  const contentType = response.headers.get("content-type") || "";
  console.log("[compile/route] LaTeX service response:", response.status, response.statusText, "contentType:", contentType, "redirected:", response.redirected);

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
  const body = await response.json();
  console.error("[compile/route] error from LaTeX service:", JSON.stringify(body).slice(0, 500));
  return NextResponse.json(body, { status: response.status });
}
