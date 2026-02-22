import zipfile
from pathlib import Path, PurePosixPath


class ZipSafetyError(Exception):
    pass


MAX_COMPRESSED_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_UNCOMPRESSED_SIZE = 200 * 1024 * 1024  # 200 MB
MAX_FILE_COUNT = 500
MAX_COMPRESSION_RATIO = 100


def validate_and_extract(zip_bytes: bytes, dest_dir: Path) -> None:
    if len(zip_bytes) > MAX_COMPRESSED_SIZE:
        raise ZipSafetyError(
            f"Compressed size {len(zip_bytes)} exceeds limit {MAX_COMPRESSED_SIZE}"
        )

    try:
        zf = zipfile.ZipFile(zipfile.Path(root=None), "r")  # type: ignore[arg-type]
    except Exception:
        pass

    import io

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except zipfile.BadZipFile as e:
        raise ZipSafetyError(f"Invalid zip file: {e}")

    with zf:
        members = zf.infolist()

        if len(members) > MAX_FILE_COUNT:
            raise ZipSafetyError(
                f"Too many files: {len(members)} exceeds limit {MAX_FILE_COUNT}"
            )

        total_uncompressed = sum(m.file_size for m in members)
        if total_uncompressed > MAX_UNCOMPRESSED_SIZE:
            raise ZipSafetyError(
                f"Uncompressed size {total_uncompressed} exceeds limit {MAX_UNCOMPRESSED_SIZE}"
            )

        compressed_size = len(zip_bytes)
        if compressed_size > 0 and total_uncompressed / compressed_size > MAX_COMPRESSION_RATIO:
            raise ZipSafetyError(
                f"Compression ratio {total_uncompressed / compressed_size:.1f} "
                f"exceeds limit {MAX_COMPRESSION_RATIO}"
            )

        for member in members:
            # Check for path traversal
            member_path = PurePosixPath(member.filename)
            if member_path.is_absolute():
                raise ZipSafetyError(f"Absolute path in zip: {member.filename}")
            if ".." in member_path.parts:
                raise ZipSafetyError(f"Path traversal in zip: {member.filename}")

            # Check for symlinks (external_attr upper 16 bits contain Unix mode)
            unix_mode = member.external_attr >> 16
            if unix_mode != 0 and (unix_mode & 0o120000) == 0o120000:
                raise ZipSafetyError(f"Symlink in zip: {member.filename}")

        zf.extractall(dest_dir)
