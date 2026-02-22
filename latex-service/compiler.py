import logging
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class CompileResult:
    success: bool
    pdf_bytes: bytes | None
    log_tail: str


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


def compile_latex(work_dir: str, entrypoint: str, timeout: int, compiler: str = "pdflatex", halt_on_error: bool = False) -> CompileResult:
    """Run latexmk in work_dir. Must be picklable (runs in ProcessPoolExecutor)."""
    work_path = Path(work_dir)
    entrypoint_rel = Path(entrypoint)
    entrypoint_path = work_path / entrypoint_rel

    log.info("compile_latex called: work_dir=%s, entrypoint=%s, timeout=%d, compiler=%s, halt_on_error=%s", work_dir, entrypoint, timeout, compiler, halt_on_error)
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

    try:
        result = subprocess.run(
            cmd,
            cwd=compile_cwd,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return CompileResult(
            success=False,
            pdf_bytes=None,
            log_tail=f"Compilation timed out after {timeout}s",
        )

    log.info("latexmk returncode: %d", result.returncode)
    log.info("latexmk stdout (last 500 chars): %s", result.stdout[-500:] if result.stdout else "(empty)")
    log.info("latexmk stderr (last 500 chars): %s", result.stderr[-500:] if result.stderr else "(empty)")

    pdf_name = entrypoint_rel.stem + ".pdf"
    pdf_path = compile_cwd / pdf_name

    log.info("Looking for PDF at: %s (exists=%s)", pdf_path, pdf_path.exists())

    if pdf_path.exists():
        return CompileResult(
            success=True,
            pdf_bytes=pdf_path.read_bytes(),
            log_tail="",
        )

    # Collect log tail from the .log file or stdout/stderr
    log_text = result.stdout + "\n" + result.stderr
    log_file = compile_cwd / (entrypoint_rel.stem + ".log")
    if log_file.exists():
        log_text = log_file.read_text(errors="replace")

    log_lines = log_text.strip().splitlines()
    tail = "\n".join(log_lines[-50:])

    return CompileResult(success=False, pdf_bytes=None, log_tail=tail)
