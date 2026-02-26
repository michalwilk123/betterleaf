import asyncio
import logging
import os
import secrets
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

import convex_fetcher
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


PROTECTED_PATHS = {"/compile", "/compile-project"}


@app.middleware("http")
async def log_and_auth(request: Request, call_next):
    log.info("Incoming %s %s", request.method, request.url.path)
    if request.url.path in PROTECTED_PATHS:
        auth = request.headers.get("Authorization", "")
        if not secrets.compare_digest(auth, f"Bearer {API_SECRET}"):
            log.info("Response status: 401 for %s %s", request.method, request.url.path)
            return JSONResponse(status_code=401, content={"error": "unauthorized"})
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


@app.post("/compile-project")
async def compile_project(
    request: Request,
    project_id: str = Form(...),
    timeout: int = Form(DEFAULT_TIMEOUT),
):
    timeout = min(max(timeout, 1), MAX_TIMEOUT)

    # Fetch project and files from Convex
    try:
        project = await asyncio.to_thread(convex_fetcher.fetch_project, project_id)
    except Exception as e:
        log.error("Failed to fetch project %s: %s", project_id, e)
        return JSONResponse(
            status_code=400,
            content={"error": "project_fetch_failed", "detail": str(e)},
        )

    compiler = project.get("compiler", "pdflatex")
    halt_on_error = project.get("haltOnError", False)
    entrypoint = project["entrypoint"]
    files = project["files"]

    if compiler not in ("pdflatex", "xelatex", "lualatex"):
        compiler = "pdflatex"

    log.info(
        "compile-project: project_id=%s, entrypoint=%s, compiler=%s, halt_on_error=%s, files=%d",
        project_id, entrypoint, compiler, halt_on_error, len(files),
    )

    # Materialize files to temp dir and compute content hash
    work_dir = Path(tempfile.mkdtemp(prefix="latex-"))
    try:
        zip_hash = await convex_fetcher.materialize_files(files, work_dir)
    except Exception as e:
        shutil.rmtree(work_dir, ignore_errors=True)
        log.error("Failed to materialize files for project %s: %s", project_id, e)
        return JSONResponse(
            status_code=500,
            content={"error": "file_materialization_failed", "detail": str(e)},
        )

    # Check Convex compilation cache
    try:
        cached = await asyncio.to_thread(convex_fetcher.check_cache, project_id, zip_hash)
        if cached and cached.get("pdfUrl"):
            shutil.rmtree(work_dir, ignore_errors=True)
            log.info("Cache hit for project=%s hash=%s", project_id, zip_hash[:16])
            async with httpx.AsyncClient() as http:
                pdf_response = await http.get(cached["pdfUrl"])
                pdf_response.raise_for_status()
            return Response(
                content=pdf_response.content,
                media_type="application/pdf",
                headers={"Content-Disposition": "inline; filename=output.pdf"},
            )
    except Exception as e:
        log.warning("Cache check failed for project %s: %s — proceeding to compile", project_id, e)

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
        shutil.rmtree(work_dir, ignore_errors=True)
        return JSONResponse(
            status_code=503,
            content={"error": "queue_full", "detail": "Too many pending compilations"},
        )

    log.info("Job submitted for client=%s project=%s work_dir=%s", client_id, project_id, work_dir)

    result = await job.future

    log.info(
        "Compilation result: success=%s, pdf_size=%s, log_tail=%s",
        result.success,
        len(result.pdf_bytes) if result.pdf_bytes else 0,
        result.log_tail[:200] if result.log_tail else "(empty)",
    )

    if result.success:
        # Fire-and-forget: cache PDF in Convex
        asyncio.create_task(
            asyncio.to_thread(
                convex_fetcher.upload_and_cache, result.pdf_bytes, project_id, zip_hash
            )
        )
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
