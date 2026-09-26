import gzip
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("LATEX_API_SECRET", "test-secret")
os.environ.setdefault("CONVEX_URL", "https://example.convex.cloud")
os.environ.setdefault("CONVEX_DEPLOY_KEY", "test-key")

from fastapi.testclient import TestClient

import compiler
import convex_fetcher
import main


class CompilerSynctexTests(unittest.TestCase):
    def test_compile_emits_synctex_without_changing_engine(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "main.tex").write_text("hello")

            def run(command, cwd, timeout):
                self.assertEqual(command[1:3], ["-xelatex", "-synctex=1"])
                Path(cwd, "main.pdf").write_bytes(b"pdf")
                Path(cwd, "main.synctex.gz").write_bytes(b"map")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch.object(compiler, "_run_latexmk", side_effect=run):
                result = compiler.compile_latex(tmp, "main.tex", 10, compiler="xelatex")

        self.assertTrue(result.success)
        self.assertEqual(result.pdf_bytes, b"pdf")
        self.assertEqual(result.synctex_bytes, b"map")


class LookupSynctexTests(unittest.TestCase):
    def test_relative_path_resolves_against_entrypoint_directory(self):
        output = "SyncTeX result begin\nInput:sections/intro.tex\nLine:42\nSyncTeX result end\n"
        with patch.object(main.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=output)) as run:
            match = main._find_source_line(b"map", "book/main.tex", {"book/sections/intro.tex"}, 1, 30, 50)
        self.assertEqual(match, {"path": "book/sections/intro.tex", "line": 42})
        self.assertEqual(run.call_args.args[0][:3], ["synctex", "edit", "-o"])

    def test_absolute_native_path_uses_main_input_as_compile_root(self):
        map_bytes = gzip.compress(b"SyncTeX Version:1\nInput:1:/tmp/latex-123/book/./main.tex\n")
        output = "SyncTeX result begin\nInput:/tmp/latex-123/book/./sections/intro.tex\nLine:42\n"
        with patch.object(main.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=output)):
            match = main._find_source_line(map_bytes, "book/main.tex", {"book/sections/intro.tex"}, 1, 30, 50)
        self.assertEqual(match, {"path": "book/sections/intro.tex", "line": 42})

    def test_rejects_source_outside_project(self):
        for path in ("../../secret.tex", "/etc/passwd", "other.tex"):
            with self.subTest(path=path):
                output = f"Input:{path}\nLine:7\n"
                with patch.object(main.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=output)):
                    match = main._find_source_line(b"map", "book/main.tex", {"book/main.tex"}, 1, 30, 50)
                self.assertIsNone(match)


class SynctexRouteTests(unittest.TestCase):
    def test_route_requires_auth_and_valid_coordinates(self):
        with TestClient(main.app) as client:
            form = {"project_id": "p", "zip_hash": "h", "page": "1", "x": "30", "y": "50"}
            self.assertEqual(client.post("/synctex", data=form).status_code, 401)
            form["x"] = "nan"
            response = client.post("/synctex", data=form, headers={"Authorization": "Bearer test-secret"})
            self.assertEqual(response.status_code, 400)

    def test_route_returns_project_source_match(self):
        with (
            patch.object(convex_fetcher, "get_synctex_by_hash", return_value=(b"map", "main.tex")),
            patch.object(convex_fetcher, "fetch_project", return_value={"files": [{"name": "main.tex"}]}),
            patch.object(main, "_find_source_line", return_value={"path": "main.tex", "line": 12}),
            TestClient(main.app) as client,
        ):
            response = client.post(
                "/synctex",
                data={"project_id": "p", "zip_hash": "h", "page": "1", "x": "30", "y": "50"},
                headers={"Authorization": "Bearer test-secret"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"path": "main.tex", "line": 12})


class CacheUploadTests(unittest.TestCase):
    def test_pdf_and_map_are_saved_in_one_record(self):
        class Client:
            def __init__(self):
                self.calls = []

            def mutation(self, name, args):
                self.calls.append((name, args))
                return "https://example.test/upload" if name.endswith("generateUploadUrl") else None

        client = Client()
        storage_ids = iter(("pdf-id", "map-id"))

        class Http:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def post(self, url, content, headers):
                return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"storageId": next(storage_ids)})

        with patch.object(convex_fetcher, "_get_client", return_value=client), patch.object(convex_fetcher.httpx, "Client", return_value=Http()):
            convex_fetcher.upload_and_cache(b"pdf", b"map", "p", "h", "main.tex", "pdflatex")

        saves = [args for name, args in client.calls if name == "service:saveCompilation"]
        self.assertEqual(saves, [{
            "projectId": "p", "zipHash": "h", "storageId": "pdf-id",
            "synctexStorageId": "map-id", "entrypoint": "main.tex", "compiler": "pdflatex",
        }])


class CompileProjectHeaderTests(unittest.IsolatedAsyncioTestCase):
    async def test_fresh_response_waits_for_cache_and_returns_hash(self):
        project = {
            "compiler": "pdflatex", "haltOnError": False,
            "entrypoint": "main.tex", "files": [{"name": "main.tex"}],
        }
        uploaded = []

        def save(*args):
            uploaded.append(args)

        def submit(client_id, job):
            job.future.set_result(compiler.CompileResult(True, b"pdf", "", synctex_bytes=b"map"))

        request = SimpleNamespace(client=SimpleNamespace(host="test"))
        with (
            patch.object(convex_fetcher, "fetch_project", return_value=project),
            patch.object(convex_fetcher, "materialize_files", new=AsyncMock(return_value="hash")),
            patch.object(convex_fetcher, "check_cache", return_value=None),
            patch.object(convex_fetcher, "fetch_build_artifacts", return_value=None),
            patch.object(convex_fetcher, "upload_and_cache", side_effect=save),
            patch.object(main.queue_manager, "submit", side_effect=submit),
        ):
            response = await main.compile_project(request, "p", 60)

        self.assertEqual(response.headers["X-Build-Hash"], "hash")
        self.assertEqual(response.body, b"pdf")
        self.assertEqual(uploaded, [(b"pdf", b"map", "p", "hash", "main.tex", "pdflatex")])

    async def test_cache_failure_still_returns_pdf_without_hash(self):
        project = {
            "compiler": "pdflatex", "haltOnError": False,
            "entrypoint": "main.tex", "files": [{"name": "main.tex"}],
        }

        def submit(client_id, job):
            job.future.set_result(compiler.CompileResult(True, b"pdf", "", synctex_bytes=b"map"))

        request = SimpleNamespace(client=SimpleNamespace(host="test"))
        with (
            patch.object(convex_fetcher, "fetch_project", return_value=project),
            patch.object(convex_fetcher, "materialize_files", new=AsyncMock(return_value="hash")),
            patch.object(convex_fetcher, "check_cache", return_value=None),
            patch.object(convex_fetcher, "fetch_build_artifacts", return_value=None),
            patch.object(convex_fetcher, "upload_and_cache", side_effect=RuntimeError("cache offline")),
            patch.object(main.queue_manager, "submit", side_effect=submit),
        ):
            response = await main.compile_project(request, "p", 60)

        self.assertEqual(response.body, b"pdf")
        self.assertNotIn("X-Build-Hash", response.headers)

    async def test_cache_response_returns_hash(self):
        project = {
            "compiler": "pdflatex", "haltOnError": False,
            "entrypoint": "main.tex", "files": [{"name": "main.tex"}],
        }

        class Http:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                pass

            async def get(self, url):
                return SimpleNamespace(content=b"cached pdf", raise_for_status=lambda: None)

        request = SimpleNamespace(client=SimpleNamespace(host="test"))
        with (
            patch.object(convex_fetcher, "fetch_project", return_value=project),
            patch.object(convex_fetcher, "materialize_files", new=AsyncMock(return_value="hash")),
            patch.object(convex_fetcher, "check_cache", return_value={"pdfUrl": "https://example.test/pdf"}),
            patch.object(main.httpx, "AsyncClient", return_value=Http()),
        ):
            response = await main.compile_project(request, "p", 60)

        self.assertEqual(response.headers["X-Build-Hash"], "hash")
        self.assertEqual(response.body, b"cached pdf")


if __name__ == "__main__":
    unittest.main()
