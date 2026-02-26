"""Convex client module for fetching project data and caching compilations."""

import asyncio
import hashlib
import json
import os
from pathlib import Path

import httpx
from convex import ConvexClient

CONVEX_URL = os.environ["CONVEX_URL"]
CONVEX_DEPLOY_KEY = os.environ["CONVEX_DEPLOY_KEY"]


def _get_client() -> ConvexClient:
    client = ConvexClient(CONVEX_URL)
    client.set_admin_auth(CONVEX_DEPLOY_KEY)
    return client


def fetch_project(project_id: str) -> dict:
    """Fetch project metadata and all files from Convex."""
    client = _get_client()
    return client.query("service:getProjectWithFiles", {"projectId": project_id})


async def materialize_files(files: list[dict], work_dir: Path) -> str:
    """Write all project files to work_dir and return the content hash.

    Hash algorithm matches the client-side buildZip:
      SHA-256 of JSON.stringify([[name, storageUrl_or_content], ...]) sorted by name.
    """
    sorted_files = sorted(files, key=lambda f: f["name"])

    # Write text files, collect binary files for async download
    binary_files = []
    for file in sorted_files:
        if file.get("storageUrl"):
            binary_files.append(file)
        else:
            path = work_dir / file["name"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(file["content"], encoding="utf-8")

    # Download binary files concurrently
    if binary_files:
        async with httpx.AsyncClient() as http:
            await asyncio.gather(
                *[_download_binary(http, file, work_dir / file["name"]) for file in binary_files]
            )

    # Compute hash matching client-side buildZip algorithm
    hash_input = []
    for file in sorted_files:
        if file.get("storageUrl"):
            hash_input.append([file["name"], file["storageUrl"]])
        else:
            hash_input.append([file["name"], file["content"]])

    # Use compact JSON (no spaces) to match JavaScript's JSON.stringify
    canonical = json.dumps(hash_input, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _download_binary(http: httpx.AsyncClient, file: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    response = await http.get(file["storageUrl"])
    response.raise_for_status()
    path.write_bytes(response.content)


def check_cache(project_id: str, zip_hash: str) -> dict | None:
    """Check if a compilation result is cached in Convex. Returns {pdfUrl} or None."""
    client = _get_client()
    return client.query(
        "service:getCompilationByHash",
        {"projectId": project_id, "zipHash": zip_hash},
    )


def upload_and_cache(pdf_bytes: bytes, project_id: str, zip_hash: str) -> None:
    """Upload PDF to Convex storage and save the compilation record."""
    client = _get_client()
    upload_url = client.mutation("service:generateUploadUrl", {})

    with httpx.Client() as http:
        upload_res = http.post(
            upload_url,
            content=pdf_bytes,
            headers={"Content-Type": "application/pdf"},
        )
        upload_res.raise_for_status()
        storage_id = upload_res.json()["storageId"]

    client.mutation(
        "service:saveCompilation",
        {"projectId": project_id, "zipHash": zip_hash, "storageId": storage_id},
    )
