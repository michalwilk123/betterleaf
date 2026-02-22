import asyncio
import logging
import os
import secrets
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from queue_manager import Job, QueueFullError, QueueManager
from zip_safety import ZipSafetyError, validate_and_extract

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_TIMEOUT = 120
DEFAULT_TIMEOUT = 60

API_SECRET = os.environ.get("LATEX_API_SECRET", "")
if not API_SECRET:
    raise RuntimeError("LATEX_API_SECRET env var must be set")

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://betterleaf.micwilk.com")

queue_manager = QueueManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await queue_manager.start()
    yield
    await queue_manager.stop()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    log.info("Incoming %s %s", request.method, request.url.path)
    response = await call_next(request)
    log.info("Response status: %d for %s %s", response.status_code, request.method, request.url.path)
    return response


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/compile")
async def compile(
    request: Request,
    file: UploadFile = File(...),
    entrypoint: str = Form(...),
    timeout: int = Form(DEFAULT_TIMEOUT),
    compiler: str = Form("pdflatex"),
    halt_on_error: bool = Form(False),
):
    auth = request.headers.get("Authorization", "")
    if not secrets.compare_digest(auth, f"Bearer {API_SECRET}"):
        return JSONResponse(
            status_code=401,
            content={"error": "unauthorized"},
        )

    # Validate timeout
    timeout = min(max(timeout, 1), MAX_TIMEOUT)

    # Read and validate size
    zip_bytes = await file.read()
    if len(zip_bytes) > MAX_UPLOAD_SIZE:
        return JSONResponse(
            status_code=413,
            content={"error": "upload_too_large", "detail": "Max upload size is 50MB"},
        )

    # Validate compiler
    if compiler not in ("pdflatex", "xelatex", "lualatex"):
        compiler = "pdflatex"

    log.info("Compile request: entrypoint=%s, timeout=%d, compiler=%s, halt_on_error=%s, zip_size=%d bytes", entrypoint, timeout, compiler, halt_on_error, len(zip_bytes))

    # Extract to temp dir
    work_dir = Path(tempfile.mkdtemp(prefix="latex-"))
    try:
        validate_and_extract(zip_bytes, work_dir)
    except ZipSafetyError as e:
        import shutil

        shutil.rmtree(work_dir, ignore_errors=True)
        return JSONResponse(
            status_code=400,
            content={"error": "zip_safety_violation", "detail": str(e)},
        )

    # Submit to queue
    client_id = request.client.host if request.client else "unknown"
    loop = asyncio.get_event_loop()
    job = Job(
        work_dir=str(work_dir),
        entrypoint=entrypoint,
        timeout=timeout,
        compiler=compiler,
        halt_on_error=halt_on_error,
        future=loop.create_future(),
    )

    try:
        queue_manager.submit(client_id, job)
    except QueueFullError:
        import shutil

        shutil.rmtree(work_dir, ignore_errors=True)
        return JSONResponse(
            status_code=503,
            content={"error": "queue_full", "detail": "Too many pending compilations"},
        )

    log.info("Job submitted for client=%s, work_dir=%s", client_id, work_dir)
    extracted_files = [str(p.relative_to(work_dir)) for p in work_dir.rglob("*") if p.is_file()]
    log.info("Extracted files: %s", extracted_files)

    # Await result
    result = await job.future

    log.info("Compilation result: success=%s, pdf_size=%s, log_tail=%s",
             result.success,
             len(result.pdf_bytes) if result.pdf_bytes else 0,
             result.log_tail[:200] if result.log_tail else "(empty)")

    if result.success:
        return Response(
            content=result.pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=output.pdf"},
        )
    else:
        return JSONResponse(
            status_code=422,
            content={"error": "compilation_failed", "log": result.log_tail},
        )
