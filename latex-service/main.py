import asyncio
import gzip
import io
import logging
import math
import os
import posixpath
import secrets
import shutil
import subprocess
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


PROTECTED_PATHS = {"/compile", "/compile-project", "/synctex"}


def _find_source_line(
    synctex_bytes: bytes,
    entrypoint: str,
    source_names: set[str],
    page: int,
    x: float,
    y: float,
) -> dict[str, str | int] | None:
    """Run native SyncTeX against a temporary map and validate its source match."""
    stem = Path(entrypoint).stem
    with tempfile.TemporaryDirectory(prefix="synctex-") as tmp:
        output = Path(tmp) / f"{stem}.pdf"
        output.touch()
        output.with_suffix(".synctex.gz").write_bytes(synctex_bytes)
        result = subprocess.run(
            ["synctex", "edit", "-o", f"{page}:{x}:{y}:{output}"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=5,
            cwd=tmp,
        )

    if result.returncode != 0:
        return None
    input_name = None
    line = None
    for output_line in result.stdout.splitlines():
        if output_line.startswith("Input:"):
            input_name = output_line.removeprefix("Input:")
        elif output_line.startswith("Line:"):
            try:
                line = int(output_line.removeprefix("Line:"))
            except ValueError:
                return None
        if input_name is not None and line is not None:
            break

    if not input_name or line is None or line < 1:
        return None
    if "\\" in input_name or "\x00" in input_name:
        return None
    if posixpath.isabs(input_name):
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(synctex_bytes)) as map_file:
                map_file.readline(8192)  # SyncTeX version
                main_input = map_file.readline(8192).decode("utf-8", errors="replace")
            if not main_input.startswith("Input:1:"):
                return None
            original_main = posixpath.normpath(main_input.removeprefix("Input:1:").strip())
            if not posixpath.isabs(original_main) or posixpath.basename(original_main) != posixpath.basename(entrypoint):
                return None
            input_name = posixpath.relpath(input_name, posixpath.dirname(original_main))
        except (OSError, EOFError, ValueError):
            return None
    path = posixpath.normpath(posixpath.join(posixpath.dirname(entrypoint), input_name))
    if path.startswith("../") or path in ("..", "."):
        return None
    if path not in source_names:
        # The compiler may have created a subdirectory symlink to a flat source.
        flat_path = posixpath.join(posixpath.dirname(entrypoint), posixpath.basename(path))
        if flat_path not in source_names:
            return None
        path = flat_path
    return {"path": path, "line": line}


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


@app.post("/synctex")
async def synctex(
    project_id: str = Form(...),
    zip_hash: str = Form(...),
    page: int = Form(...),
    x: float = Form(...),
    y: float = Form(...),
):
    if (
        page < 1
        or page > 10000
        or not math.isfinite(x)
        or not math.isfinite(y)
        or not 0 <= x <= 100000
        or not 0 <= y <= 100000
    ):
        return JSONResponse(status_code=400, content={"error": "invalid_coordinates"})

    try:
        map_record = await asyncio.to_thread(
            convex_fetcher.get_synctex_by_hash, project_id, zip_hash
        )
        if not map_record:
            return JSONResponse(status_code=404, content={"error": "synctex_not_found"})
        project = await asyncio.to_thread(convex_fetcher.fetch_project, project_id)
    except Exception as e:
        log.error("Failed to fetch SyncTeX data for project %s: %s", project_id, e)
        return JSONResponse(status_code=502, content={"error": "synctex_fetch_failed"})

    synctex_bytes, entrypoint = map_record
    source_names = {file["name"] for file in project["files"]}
    try:
        match = await asyncio.to_thread(
            _find_source_line,
            synctex_bytes,
            entrypoint,
            source_names,
            page,
            x,
            y,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        log.error("SyncTeX lookup failed for project %s: %s", project_id, e)
        return JSONResponse(status_code=502, content={"error": "synctex_lookup_failed"})
    if not match:
        return JSONResponse(status_code=404, content={"error": "source_not_found"})
    return match


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
                headers={
                    "Content-Disposition": "inline; filename=output.pdf",
                    "X-Build-Hash": zip_hash,
                },
            )
    except Exception as e:
        log.warning("Cache check failed for project %s: %s — proceeding to compile", project_id, e)

    # Fetch the persisted build dir (if any) to seed an incremental rebuild.
    # Only reuse it when the stored compiler matches (aux files are engine-specific).
    artifact_tar = None
    try:
        artifact = await asyncio.to_thread(convex_fetcher.fetch_build_artifacts, project_id)
        if artifact and artifact[1] == compiler:
            artifact_tar = artifact[0]
    except Exception as e:
        log.warning("Failed to fetch build artifacts for project %s: %s — compiling clean", project_id, e)

    source_names = [f["name"] for f in files]

    # Submit to queue
    client_id = request.client.host if request.client else "unknown"
    loop = asyncio.get_event_loop()
    job = Job(
        work_dir=str(work_dir),
        entrypoint=entrypoint,
        timeout=timeout,
        compiler=compiler,
        halt_on_error=halt_on_error,
        artifact_tar=artifact_tar,
        source_names=source_names,
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

    log.info("Job submitted for client=%s project=%s work_dir=%s restore=%s", client_id, project_id, work_dir, bool(artifact_tar))

    result = await job.future

    log.info(
        "Compilation result: success=%s, pdf_size=%s, log_tail=%s",
        result.success,
        len(result.pdf_bytes) if result.pdf_bytes else 0,
        result.log_tail[:200] if result.log_tail else "(empty)",
    )

    if result.success:
        headers = {"Content-Disposition": "inline; filename=output.pdf"}
        if result.synctex_bytes:
            try:
                await asyncio.to_thread(
                    convex_fetcher.upload_and_cache,
                    result.pdf_bytes,
                    result.synctex_bytes,
                    project_id,
                    zip_hash,
                    entrypoint,
                    compiler,
                )
                headers["X-Build-Hash"] = zip_hash
            except Exception as e:
                log.error("Failed to cache compilation for project %s: %s", project_id, e)
        else:
            log.error("Compilation produced no SyncTeX map for project %s", project_id)
        # Fire-and-forget: persist the build dir for the next incremental compile
        if result.artifact_tar:
            asyncio.create_task(
                asyncio.to_thread(
                    convex_fetcher.upload_and_cache_artifacts,
                    result.artifact_tar,
                    project_id,
                    compiler,
                )
            )
        return Response(
            content=result.pdf_bytes,
            media_type="application/pdf",
            headers=headers,
        )
    else:
        return JSONResponse(
            status_code=422,
            content={"error": "compilation_failed", "log": result.log_tail},
        )
