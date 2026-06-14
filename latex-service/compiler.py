import io
import logging
import os
import re
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

# Guards for restoring an externally-stored artifact tarball (defense-in-depth;
# we generate the tar ourselves but it round-trips through external storage).
MAX_ARTIFACT_FILES = 2000
MAX_ARTIFACT_UNCOMPRESSED = 200 * 1024 * 1024  # 200 MB


@dataclass
class CompileResult:
    success: bool
    pdf_bytes: bytes | None
    log_tail: str
    artifact_tar: bytes | None = None


def _fix_flat_file_references(work_path: Path) -> None:
    """Scan .tex files for references like images/foo.jpg. If the file exists
    at the root but not at the referenced path, create the subdirectory and
    symlink it."""
    root_files = {f.name: f for f in work_path.iterdir() if f.is_file()}

    # Collect all paths referenced in tex files
    ref_pattern = re.compile(
        r"\\(?:includegraphics|input|include|bibliography|addbibresource)"
        r"(?:\[[^\]]*\])?\{([^}]+)\}"
    )
    for tex_file in work_path.glob("*.tex"):
        text = tex_file.read_text(errors="replace")
        for match in ref_pattern.finditer(text):
            ref = match.group(1).strip()
            ref_path = work_path / ref
            if ref_path.exists():
                continue
            # Check if the basename exists at root
            basename = Path(ref).name
            if basename in root_files:
                ref_path.parent.mkdir(parents=True, exist_ok=True)
                ref_path.symlink_to(root_files[basename])
                log.info("Symlinked %s -> %s", ref, root_files[basename])


def _restore_artifacts(work_path: Path, tar_bytes: bytes) -> None:
    """Extract a previously-saved build-artifact tarball into work_path.

    Restored files are re-stamped to 'now' so that _touch_sources can afterwards
    make every source strictly newer (see compile_latex). On any problem we log
    and return — the build then proceeds as a clean cold build.
    """
    try:
        with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tf:
            members = tf.getmembers()
            if len(members) > MAX_ARTIFACT_FILES:
                log.warning("Artifact tar has too many members (%d); skipping restore", len(members))
                return
            total = sum(m.size for m in members)
            if total > MAX_ARTIFACT_UNCOMPRESSED:
                log.warning("Artifact tar too large (%d bytes); skipping restore", total)
                return
            # filter="data" rejects absolute paths, '..' traversal, and links.
            tf.extractall(path=work_path, filter="data")
            restored = [m.name for m in members if m.isfile()]
    except (tarfile.TarError, OSError, ValueError) as e:
        log.warning("Failed to restore build artifacts; compiling clean: %s", e)
        return

    for name in restored:
        try:
            os.utime(work_path / name, None)
        except OSError:
            pass
    log.info("Restored %d build-artifact files", len(restored))


def _touch_sources(work_path: Path, source_names: list[str]) -> None:
    """Stamp every source file to 'now' so latexmk always re-checks source content
    (its .fdb_latexmk stores per-source MD5s) and never falsely treats a changed
    file as up-to-date after a build-dir restore."""
    for name in source_names:
        path = work_path / name
        try:
            if path.exists():
                os.utime(path, None)
        except OSError:
            pass


def _pack_artifacts(
    work_path: Path, compile_cwd: Path, source_set: set[str], pdf_name: str
) -> bytes | None:
    """Pack generated build artifacts under compile_cwd into a gzipped tar with
    paths relative to work_path. Excludes source files, the output PDF, synctex,
    and symlinks. Returns the tar bytes, or None if there is nothing to store."""
    buf = io.BytesIO()
    count = 0
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for path in sorted(compile_cwd.rglob("*")):
            if path.is_symlink() or not path.is_file():
                continue
            rel = path.relative_to(work_path).as_posix()
            if rel in source_set:
                continue
            if path.name == pdf_name or rel.endswith(".synctex.gz"):
                continue
            tf.add(path, arcname=rel, recursive=False)
            count += 1
    if count == 0:
        return None
    return buf.getvalue()


def _clean_generated(work_path: Path, compile_cwd: Path, source_set: set[str]) -> None:
    """Remove all generated (non-source, non-symlink) files under compile_cwd so a
    poisoned restored build dir can be retried from a clean state."""
    for path in compile_cwd.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(work_path).as_posix()
        if rel in source_set:
            continue
        try:
            path.unlink()
        except OSError:
            pass


def _run_latexmk(cmd: list[str], compile_cwd: Path, timeout: int) -> subprocess.CompletedProcess | None:
    """Run latexmk; return the completed process, or None on timeout."""
    try:
        return subprocess.run(
            cmd,
            cwd=compile_cwd,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return None


def compile_latex(
    work_dir: str,
    entrypoint: str,
    timeout: int,
    compiler: str = "pdflatex",
    halt_on_error: bool = False,
    artifact_tar: bytes | None = None,
    source_names: list[str] | None = None,
) -> CompileResult:
    """Run latexmk in work_dir. Must be picklable (runs in ProcessPoolExecutor).

    If artifact_tar is given, the previous build directory is restored first so
    latexmk does an incremental rebuild; the new build dir is packed into
    CompileResult.artifact_tar on success.
    """
    work_path = Path(work_dir)
    entrypoint_rel = Path(entrypoint)
    entrypoint_path = work_path / entrypoint_rel
    source_set = set(source_names or [])

    log.info("compile_latex called: work_dir=%s, entrypoint=%s, timeout=%d, compiler=%s, halt_on_error=%s, restore=%s", work_dir, entrypoint, timeout, compiler, halt_on_error, bool(artifact_tar))
    log.info("Files in work_dir: %s", [str(p.relative_to(work_path)) for p in work_path.rglob("*") if p.is_file()])

    if not entrypoint_path.exists():
        log.error("Entrypoint not found: %s", entrypoint_path)
        return CompileResult(
            success=False,
            pdf_bytes=None,
            log_tail=f"Entrypoint not found: {entrypoint}",
        )

    # Map compiler to latexmk flag
    compiler_flags = {
        "pdflatex": "-pdf",
        "xelatex": "-xelatex",
        "lualatex": "-lualatex",
    }
    engine_flag = compiler_flags.get(compiler, "-pdf")
    compile_cwd = entrypoint_path.parent
    entrypoint_file = entrypoint_path.name

    cmd = [
        "latexmk",
        engine_flag,
        "-interaction=nonstopmode",
        "-outdir=.",
        entrypoint_file,
    ]
    if halt_on_error:
        cmd.insert(-1, "-halt-on-error")
    log.info("Running command: %s", cmd)
    log.info("Compilation cwd: %s", compile_cwd)

    # Files may be stored flat but referenced with subdirectory paths
    # (e.g. images/foo.jpg). Scan tex files and create missing dirs + symlinks.
    _fix_flat_file_references(compile_cwd)

    pdf_name = entrypoint_rel.stem + ".pdf"
    pdf_path = compile_cwd / pdf_name

    # Restore a previous build dir for an incremental rebuild. Restore the aux
    # files first, then touch sources so they are strictly newest — this forces
    # latexmk to MD5-compare every source and never falsely skip a changed file.
    restored = False
    if artifact_tar:
        _restore_artifacts(work_path, artifact_tar)
        _touch_sources(work_path, list(source_set))
        restored = True

    result = _run_latexmk(cmd, compile_cwd, timeout)
    if result is None:
        return CompileResult(success=False, pdf_bytes=None, log_tail=f"Compilation timed out after {timeout}s")

    log.info("latexmk returncode: %d", result.returncode)
    log.info("latexmk stdout (last 500 chars): %s", result.stdout[-500:] if result.stdout else "(empty)")
    log.info("latexmk stderr (last 500 chars): %s", result.stderr[-500:] if result.stderr else "(empty)")

    # A restored build dir can be stale/corrupt and poison the build. If the
    # incremental attempt produced no PDF, retry once from a clean state.
    if not pdf_path.exists() and restored:
        log.warning("Incremental compile produced no PDF; retrying from clean build dir")
        _clean_generated(work_path, compile_cwd, source_set)
        result = _run_latexmk(cmd, compile_cwd, timeout)
        if result is None:
            return CompileResult(success=False, pdf_bytes=None, log_tail=f"Compilation timed out after {timeout}s")
        log.info("latexmk (clean retry) returncode: %d", result.returncode)
        log.info("latexmk (clean retry) stdout (last 500 chars): %s", result.stdout[-500:] if result.stdout else "(empty)")
        log.info("latexmk (clean retry) stderr (last 500 chars): %s", result.stderr[-500:] if result.stderr else "(empty)")

    log.info("Looking for PDF at: %s (exists=%s)", pdf_path, pdf_path.exists())

    if pdf_path.exists():
        # Only pack artifacts when the caller told us which files are sources
        # (the /compile-project path). Without that we cannot separate artifacts
        # from sources, so we skip persistence (e.g. the raw /compile zip path).
        artifact_bytes = None
        if source_set:
            try:
                artifact_bytes = _pack_artifacts(work_path, compile_cwd, source_set, pdf_name)
            except (tarfile.TarError, OSError) as e:
                log.warning("Failed to pack build artifacts: %s", e)
        return CompileResult(
            success=True,
            pdf_bytes=pdf_path.read_bytes(),
            log_tail="",
            artifact_tar=artifact_bytes,
        )

    # Collect log tail from the .log file or stdout/stderr
    log_text = result.stdout + "\n" + result.stderr
    log_file = compile_cwd / (entrypoint_rel.stem + ".log")
    if log_file.exists():
        log_text = log_file.read_text(errors="replace")

    log_lines = log_text.strip().splitlines()
    tail = "\n".join(log_lines[-50:])

    return CompileResult(success=False, pdf_bytes=None, log_tail=tail)
