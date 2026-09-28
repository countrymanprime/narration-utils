"""The LibriVox recordings: where they come from, where they are kept, and fetching them.

The MP3s are not committed (ADR 0416). `sources.json` names each file's archive.org URL and checksums; `fetch` downloads
any that are missing or wrong into the sources directory and keeps a file only when its SHA-256 matches. The directory
is `NARRATION_LIBRIVOX_DIR`, or `~/.cache/narration-utils/librivox-alice` when that is unset, outside the repository.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.request
from pathlib import Path

from alice_text import HERE

SOURCES_ENV = "NARRATION_LIBRIVOX_DIR"
DEFAULT_DIR = Path.home() / ".cache" / "narration-utils" / "librivox-alice"
ATTEMPTS = 3
RETRY_SECONDS = 5
TIMEOUT_SECONDS = 120
USER_AGENT = "narration-utils test fixtures (https://github.com/countrymanprime/narration-utils)"


def load_sources(root: Path = HERE) -> dict[str, dict]:
    return {s["id"]: s for s in json.loads((root / "sources.json").read_text(encoding="utf-8"))["sources"]}


def sources_dir() -> Path:
    named = os.environ.get(SOURCES_ENV)
    return Path(named) if named else DEFAULT_DIR


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def present(source: dict, directory: Path) -> bool:
    """The recording is in `directory` and is the published file, byte for byte."""
    path = directory / source["file"]
    return path.is_file() and sha256(path) == source["sha256"]


def _download(source: dict, target: Path) -> None:
    partial = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(source["url"], headers={"User-Agent": USER_AGENT})
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response, partial.open("wb") as out:
                while block := response.read(1 << 20):
                    out.write(block)
            break
        except OSError as exc:
            if attempt == ATTEMPTS:
                raise RuntimeError(f"{source['id']}: could not download {source['url']} ({exc})") from exc
            time.sleep(RETRY_SECONDS)
    if sha256(partial) != source["sha256"]:
        partial.unlink()
        raise RuntimeError(f"{source['id']}: the download from {source['url']} is not the pinned file (SHA-256 differs)")
    partial.replace(target)


def fetch(directory: Path, only: set[str] | None = None) -> list[str]:
    """Download every recording (or those in `only`) that is missing or wrong; returns the ids downloaded."""
    directory.mkdir(parents=True, exist_ok=True)
    fetched = []
    for source in load_sources().values():
        if only is not None and source["id"] not in only:
            continue
        if present(source, directory):
            continue
        print(f"fetching {source['id']} from {source['url']}")
        _download(source, directory / source["file"])
        fetched.append(source["id"])
    return fetched
