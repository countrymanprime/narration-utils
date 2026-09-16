"""Canonical, project-owned manuscript storage: the read side.

Importing a source file into ``narration-utils/manuscript/manuscript.json``
is Rust-only now (see ``shared/manuscript-import`` and
``shell/src-tauri/src/server/manuscript_canonical.rs``). This module keeps
only the read side, because ``manuscript_guide.py`` and ``compare.py``
still need to load that file as plain data.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
IMPORTER_VERSION = 1


class ManuscriptError(ValueError):
    """The canonical manuscript cannot be read."""


def manuscript_dir(project_folder: str | Path) -> Path:
    return Path(project_folder) / "narration-utils" / "manuscript"


def manuscript_path(project_folder: str | Path) -> Path:
    return manuscript_dir(project_folder) / "manuscript.json"


def validate(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict) or data.get("schemaVersion") != SCHEMA_VERSION:
        raise ManuscriptError("This manuscript data uses an unsupported schema version.")
    if not isinstance(data.get("documentId"), str) or not isinstance(data.get("chapters"), list) or not isinstance(data.get("paragraphs"), list):
        raise ManuscriptError("The canonical manuscript data is invalid.")
    chapter_ids = {item.get("id") for item in data["chapters"] if isinstance(item, dict)}
    paragraph_ids = set()
    for paragraph in data["paragraphs"]:
        if (
            not isinstance(paragraph, dict)
            or not isinstance(paragraph.get("id"), str)
            or paragraph["id"] in paragraph_ids
            or paragraph.get("chapterId") not in chapter_ids
            or not isinstance(paragraph.get("text"), str)
        ):
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
