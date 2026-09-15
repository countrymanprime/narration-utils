"""Canonical, project-owned manuscript storage and one-time import adapters.

Importers are the only code that understands a source format.  Everything
after import consumes ``narration-utils/manuscript/manuscript.json``.  This
keeps narration locations stable and prevents a reader/search/build action
from silently reparsing an author-owned source file.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .docx_chapters import NON_CHAPTER_HEADINGS, load_docx_paragraph_records

_CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

SCHEMA_VERSION = 1
IMPORTER_VERSION = 1
SUPPORTED_EXTENSIONS = {".docx": "docx", ".md": "markdown", ".markdown": "markdown", ".pdf": "pdf"}


class ManuscriptError(ValueError):
    """A source cannot be imported or canonical manuscript cannot be read."""


def manuscript_dir(project_folder: str | Path) -> Path:
    return Path(project_folder) / "narration-utils" / "manuscript"


def manuscript_path(project_folder: str | Path) -> Path:
    return manuscript_dir(project_folder) / "manuscript.json"


def source_format(path: str | Path) -> str:
    value = SUPPORTED_EXTENSIONS.get(Path(path).suffix.lower())
    if value is None:
        raise ManuscriptError("Choose a Word (.docx), Markdown (.md), or text-based PDF (.pdf) manuscript.")
    return value


def file_hash(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _text(value: str) -> str:
    return " ".join(value.split())


def _new_draft(format_name: str, path: Path, paragraphs: list[dict[str, Any]], chapter_titles: list[str]) -> dict[str, Any]:
    if not paragraphs:
        raise ManuscriptError("The manuscript has no readable text paragraphs.")
    return {
        "format": format_name,
        "sourceName": path.name,
        "paragraphs": paragraphs,
        "chapterTitles": chapter_titles,
    }


def _docx_draft(path: Path, progress=None) -> dict[str, Any]:
    chapter = "Front matter"
    paragraphs: list[dict[str, Any]] = []
    titles: list[str] = []
    for record in load_docx_paragraph_records(path, progress=progress):
        text = _text(record["text"])
        if record["is_heading_outline"]:
            if text.casefold() in NON_CHAPTER_HEADINGS:
                continue
            chapter = text
            titles.append(text)
            continue
        paragraphs.append({"chapter": chapter, "text": text, "sourceIndex": len(paragraphs)})
    return _new_draft("docx", path, paragraphs, titles)


_MARKDOWN_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


def _markdown_draft(path: Path, heading_level: int) -> dict[str, Any]:
    if heading_level < 1 or heading_level > 6:
        raise ManuscriptError("Markdown chapter heading level must be between H1 and H6.")
    chapter = "Front matter"
    section: str | None = None
    paragraphs: list[dict[str, Any]] = []
    titles: list[str] = []
    pending: list[str] = []

    def flush() -> None:
        if pending:
            body = _text(" ".join(pending))
            if body:
                paragraphs.append({"chapter": chapter, "section": section, "text": body, "sourceIndex": len(paragraphs)})
            pending.clear()

    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        match = _MARKDOWN_HEADING.match(raw)
        if match:
            flush()
            level, text = len(match.group(1)), _text(match.group(2))
            if level == heading_level:
                chapter, section = text, None
                titles.append(text)
            elif level > heading_level:
                section = text
            # Higher-level headings are document metadata rather than prose.
            continue
        if not raw.strip():
            flush()
        else:
            pending.append(raw.strip())
    flush()
    return _new_draft("markdown", path, paragraphs, titles)


def _pdf_draft(path: Path) -> dict[str, Any]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - dependency failure is environment-specific
        raise ManuscriptError("PDF import requires the pypdf dependency. Re-run setup to install it.") from exc
    try:
        pages = PdfReader(str(path)).pages
        raw_pages = [page.extract_text() or "" for page in pages]
    except Exception as exc:  # noqa: BLE001 - parser errors need a concise UI message
        raise ManuscriptError(f"Could not read this PDF: {exc}") from exc
    text = "\n".join(raw_pages)
    if len(re.sub(r"\s+", "", text)) < 80:
        raise ManuscriptError("This PDF has no selectable manuscript text. OCR support is not available yet; use a text-based PDF.")
    chapter = "Front matter"
    paragraphs: list[dict[str, Any]] = []
    titles: list[str] = []
    for block in re.split(r"\n\s*\n+", text):
        lines = [_text(line) for line in block.splitlines() if _text(line)]
        if not lines:
            continue
        candidate = lines[0]
        is_chapter = bool(re.match(r"^(chapter|book|part)\b", candidate, re.I)) or (len(lines) == 1 and len(candidate) <= 90 and candidate.isupper())
        if is_chapter:
            chapter = candidate
            titles.append(candidate)
            continue
        paragraphs.append({"chapter": chapter, "text": _text(" ".join(lines)), "sourceIndex": len(paragraphs)})
    return _new_draft("pdf", path, paragraphs, titles)


def _manuscript_import_binary() -> Path | None:
    """Locates the compiled shared/manuscript-import Rust CLI, if built.

    Docx/markdown parsing moved there for speed (see that crate's docstrings
    for the ported logic); PDF stays on the Python path below for now - a
    quick test showed pdf-extract's line/paragraph-break heuristics don't
    match pypdf's closely enough to trust for the chapter-vs-paragraph
    split, and PDF is the least-used of the three formats.

    Falls back to the Python implementation entirely when the binary hasn't
    been built yet (see shared/manuscript-import/README or run
    `cargo build --release` there) - a fresh checkout without a Rust
    toolchain should still be able to import docx/markdown manuscripts.
    """
    repo_root = Path(__file__).resolve().parents[3]
    binary_name = "manuscript-import.exe" if os.name == "nt" else "manuscript-import"
    for profile in ("release", "debug"):
        candidate = repo_root / "shared" / "manuscript-import" / "target" / profile / binary_name
        if candidate.is_file():
            return candidate
    return None


def _draft_via_rust(binary: Path, path: Path, markdown_heading_level: int) -> dict[str, Any]:
    # --out (a file), not stdout: this process runs with all three standard
    # streams redirected to null (spawned that way by the Tauri shell), and
    # under that exact condition subprocess.run(capture_output=True) comes
    # back with stdout=None on Windows even though the child wrote to it and
    # exited 0 - reproduced directly, not theoretical. A file sidesteps the
    # pipe-inheritance quirk entirely and matches the --out convention
    # tools/manuscript-guide's CLI already uses for the same reason.
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir) / "draft.json"
        args = [str(binary), "--source", str(path), "--out", str(out_path)]
        if source_format(path) == "markdown":
            args += ["--markdown-heading-level", str(markdown_heading_level)]
        result = subprocess.run(args, capture_output=True, text=True, creationflags=_CREATE_NO_WINDOW)
        if result.returncode != 0:
            raise ManuscriptError((result.stderr or "").strip() or "Could not parse this manuscript.")
        try:
            return json.loads(out_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ManuscriptError("The manuscript parser returned invalid data.") from exc


def prepare_import(source: str | Path, markdown_heading_level: int = 1, progress=None) -> dict[str, Any]:
    path = Path(source)
    if not path.is_file():
        raise ManuscriptError("The selected manuscript no longer exists.")
    format_name = source_format(path)
    if format_name == "pdf":
        return _pdf_draft(path)
    binary = _manuscript_import_binary()
    if binary is not None:
        if progress:
            progress("Reading manuscript…")
        return _draft_via_rust(binary, path, markdown_heading_level)
    if format_name == "docx":
        return _docx_draft(path, progress=progress)
    return _markdown_draft(path, markdown_heading_level)


def preview(draft: dict[str, Any]) -> dict[str, Any]:
    """Small serializable import review, avoiding a full manuscript response."""
    return {
        "format": draft["format"],
        "sourceName": draft["sourceName"],
        "paragraphCount": len(draft["paragraphs"]),
        "chapterTitles": draft["chapterTitles"],
    }


def _canonical(draft: dict[str, Any], source: Path, source_relative_path: str, source_hash: str) -> dict[str, Any]:
    document_id = uuid.uuid4().hex
    chapters: list[dict[str, Any]] = []
    chapter_by_title: dict[str, dict[str, Any]] = {}
    paragraphs: list[dict[str, Any]] = []
    for source_paragraph in draft["paragraphs"]:
        title = source_paragraph["chapter"]
        chapter = chapter_by_title.get(title)
        if chapter is None:
            chapter = {"id": f"c-{len(chapters) + 1:04d}", "title": title, "index": len(chapters), "wordCount": 0, "sections": []}
            chapters.append(chapter)
            chapter_by_title[title] = chapter
        section_title = source_paragraph.get("section")
        section_id = None
        if section_title:
            sections = chapter["sections"]
            existing = next((item for item in sections if item["title"] == section_title), None)
            if existing is None:
                existing = {"id": f"{chapter['id']}-s-{len(sections) + 1:03d}", "title": section_title}
                sections.append(existing)
            section_id = existing["id"]
        text = source_paragraph["text"]
        chapter["wordCount"] += len(text.split())
        paragraphs.append({
            "id": f"p-{len(paragraphs) + 1:06d}", "index": len(paragraphs), "chapterId": chapter["id"], "chapterTitle": title,
            "sectionId": section_id, "text": text, "sourceIndex": source_paragraph["sourceIndex"],
        })
    return {
        "schemaVersion": SCHEMA_VERSION,
        "documentId": document_id,
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "importer": {"format": draft["format"], "version": IMPORTER_VERSION},
        "source": {"fileName": source.name, "sha256": source_hash, "storedPath": source_relative_path},
        "chapters": chapters,
        "paragraphs": paragraphs,
    }


def validate(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict) or data.get("schemaVersion") != SCHEMA_VERSION:
        raise ManuscriptError("This manuscript data uses an unsupported schema version.")
    if not isinstance(data.get("documentId"), str) or not isinstance(data.get("chapters"), list) or not isinstance(data.get("paragraphs"), list):
        raise ManuscriptError("The canonical manuscript data is invalid.")
    chapter_ids = {item.get("id") for item in data["chapters"] if isinstance(item, dict)}
    paragraph_ids = set()
    for paragraph in data["paragraphs"]:
        if not isinstance(paragraph, dict) or not isinstance(paragraph.get("id"), str) or paragraph["id"] in paragraph_ids or paragraph.get("chapterId") not in chapter_ids or not isinstance(paragraph.get("text"), str):
            raise ManuscriptError("The canonical manuscript has invalid paragraph records.")
        paragraph_ids.add(paragraph["id"])
    return data


def load_file(path: str | Path) -> dict[str, Any]:
    path = Path(path)
    if not path.is_file():
        raise ManuscriptError("Import a manuscript first.")
    try:
        return validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManuscriptError("The canonical manuscript data could not be read.") from exc


def exists(project_folder: str | Path) -> bool:
    return manuscript_path(project_folder).is_file()


def load(project_folder: str | Path) -> dict[str, Any]:
    return load_file(manuscript_path(project_folder))


def commit_import(project_folder: str | Path, source: str | Path, draft: dict[str, Any], progress=None) -> dict[str, Any]:
    """Copy source then atomically activate normalized data. Caller resets sidecars first."""
    root = Path(project_folder)
    selected = Path(source)
    folder = manuscript_dir(root)
    source_folder = folder / "sources" / uuid.uuid4().hex
    source_folder.mkdir(parents=True, exist_ok=True)
    stored = source_folder / selected.name
    total = selected.stat().st_size
    copied = 0
    digest = hashlib.sha256()
    if progress:
        progress(0, "Copying selected manuscript…")
    with selected.open("rb") as input_handle, stored.open("wb") as output_handle:
        while block := input_handle.read(1024 * 1024):
            output_handle.write(block)
            digest.update(block)
            copied += len(block)
            if progress:
                progress(round(copied * 100 / total) if total else 100, f"Copying manuscript… {copied:,} bytes")
    shutil.copystat(selected, stored)
    relative = stored.relative_to(root).as_posix()
    if progress:
        progress(100, "Writing canonical manuscript data…")
    data = _canonical(draft, selected, relative, digest.hexdigest())
    target = manuscript_path(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, target)
    return data
