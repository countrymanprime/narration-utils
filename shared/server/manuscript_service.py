"""Manuscript reader backend, ported 1:1 from shared/hub/ManuscriptService.cs.

The on-disk notes sidecar (<project>/narration-utils/manuscript-notes.json)
keeps the same PascalCase field names the .NET build wrote, so existing
project sidecars stay readable after this migration; API responses still use
camelCase to match what the UI already expects (see docstring in app.py).
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from narration_common import manuscript as canonical

_ALLOWED_STATUSES = ("not_started", "recording", "editing", "proofing", "finalized")


class ManuscriptError(Exception):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_reader_state() -> dict:
    return {"activeChapter": None, "activeSourceLine": None, "bookmarks": [], "expandedChapters": None}


def _normalize_note(note: dict) -> dict:
    """Tolerates the PascalCase keys .NET originally wrote for this sidecar."""
    lowered = {str(k).lower(): v for k, v in note.items()}
    return {
        "id": lowered.get("id"),
        "chapter": lowered.get("chapter"),
        "chapterId": lowered.get("chapterid"),
        "paragraph": lowered.get("paragraph"),
        "paragraphId": lowered.get("paragraphid"),
        "text": lowered.get("text"),
        "createdAt": lowered.get("createdat"),
        "anchorStart": lowered.get("anchorstart"),
        "anchorEnd": lowered.get("anchorend"),
        "anchorText": lowered.get("anchortext"),
    }


def _normalize_bookmark(bookmark: dict) -> dict:
    lowered = {str(k).lower(): v for k, v in bookmark.items()}
    return {
        "id": lowered.get("id"),
        "kind": lowered.get("kind"),
        "chapter": lowered.get("chapter"),
        "chapterId": lowered.get("chapterid"),
        "paragraph": lowered.get("paragraph"),
        "paragraphId": lowered.get("paragraphid"),
        "sourceLine": lowered.get("sourceline"),
        "noteId": lowered.get("noteid"),
        "createdAt": lowered.get("createdat"),
    }


class ManuscriptService:
    def __init__(self, project_folder: str | None, python_exe: str = "", backend: str = ""):
        self._project_folder = project_folder
        self._python_exe = python_exe
        self._backend = backend

    @property
    def _manuscript(self) -> str | None:
        if not self._project_folder:
            return None
        path = canonical.manuscript_path(self._project_folder)
        return str(path) if path.exists() else None

    @property
    def _data_dir(self) -> str | None:
        return str(Path(self._project_folder) / "ManuscriptGuide") if self._project_folder else None

    @property
    def _guide_path(self) -> str | None:
        data_dir = self._data_dir
        return str(Path(data_dir) / "manuscript_guide.json") if data_dir else None

    @property
    def _notes_path(self) -> str | None:
        return str(Path(self._project_folder) / "narration-utils" / "manuscript-notes.json") if self._project_folder else None

    def _load(self) -> dict:
        if not self._project_folder:
            raise ManuscriptError("Save the REAPER project and import a manuscript first.")
        try:
            return canonical.load(self._project_folder)
        except canonical.ManuscriptError as exc:
            raise ManuscriptError(str(exc)) from exc

    def _entity_occurrence_index(self) -> dict[tuple[str, str], list[str]]:
        index: dict[tuple[str, str], list[str]] = {}
        guide_path = self._guide_path
        if guide_path is None or not os.path.isfile(guide_path):
            return index

        guide = json.loads(Path(guide_path).read_text(encoding="utf-8"))

        def add_occurrences(entity_id: str, occurrences):
            for occ in occurrences or []:
                if not isinstance(occ, dict):
                    continue
                chapter, paragraph = occ.get("chapterId"), occ.get("paragraphId")
                if not isinstance(chapter, str) or not isinstance(paragraph, str):
                    continue
                key = (chapter, paragraph)
                ids = index.setdefault(key, [])
                if entity_id not in ids:
                    ids.append(entity_id)

        for entity in guide.get("entities", []):
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            if entity_id is None:
                continue
            add_occurrences(entity_id, entity.get("occurrences"))
            for alias in entity.get("aliases", []):
                # Some older guide manifests store a plain alias name instead
                # of {text, pronunciation, occurrences} - skip it the same
                # way the .NET port's `as JsonObject` safe-cast silently did.
                add_occurrences(entity_id, alias.get("occurrences") if isinstance(alias, dict) else None)
        return index

    def _load_notes(self) -> dict:
        path = self._notes_path
        empty = {"notes": [], "chapterStatus": {}, "readerState": _empty_reader_state()}
        if path is None or not os.path.isfile(path):
            return empty
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return empty
        # Case-insensitive, tolerant of the PascalCase keys .NET originally wrote.
        lowered = {str(k).lower(): v for k, v in raw.items()}
        notes = [_normalize_note(n) for n in lowered.get("notes", [])]
        chapter_status = lowered.get("chapterstatus", {})
        reader_state = lowered.get("readerstate") or {}
        state_lowered = {str(k).lower(): v for k, v in reader_state.items()}
        return {
            "notes": notes,
            "chapterStatus": chapter_status,
            "readerState": {
                "activeChapter": state_lowered.get("activechapter"),
                "activeSourceLine": state_lowered.get("activesourceline"),
                "bookmarks": [_normalize_bookmark(b) for b in (state_lowered.get("bookmarks") or [])],
                "expandedChapters": state_lowered.get("expandedchapters"),
            } if reader_state else _empty_reader_state(),
        }

    def _save_notes(self, notes: dict) -> None:
        path = self._notes_path
        if path is None:
            raise ManuscriptError("Save the REAPER project first.")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # _load_notes tolerates both this shape and the PascalCase one .NET
        # originally wrote, so a resave doesn't need to preserve the old
        # casing - just be internally consistent.
        payload = {
            "notes": notes["notes"],
            "chapterStatus": notes["chapterStatus"],
            "readerState": {
                "activeChapter": notes["readerState"]["activeChapter"],
                "activeSourceLine": notes["readerState"]["activeSourceLine"],
                "bookmarks": notes["readerState"]["bookmarks"],
                "expandedChapters": notes["readerState"]["expandedChapters"],
            },
        }
        Path(path).write_text(json.dumps(payload), encoding="utf-8")

    def chapters(self) -> list[dict]:
        data = self._load()
        status = self._load_notes()["chapterStatus"]
        return [
            {"id": c["id"], "title": c["title"], "index": c["index"], "wordCount": c["wordCount"], "status": status.get(c["id"], "not_started")}
            for c in data["chapters"]
        ]

    def paragraphs(self, chapter_id: str) -> list[dict]:
        data = self._load()
        entity_index = self._entity_occurrence_index()
        return [
            {"id": p["id"], "chapterId": p["chapterId"], "chapter": p["chapterTitle"], "index": p["index"], "text": p["text"], "entityIds": entity_index.get((p["chapterId"], p["id"]), [])}
            for p in data["paragraphs"]
            if p["chapterId"] == chapter_id
        ]

    def reader(self) -> dict:
        data = self._load()
        status = self._load_notes()["chapterStatus"]
        entity_index = self._entity_occurrence_index()
        chapters = [
            {"id": c["id"], "title": c["title"], "index": c["index"], "wordCount": c["wordCount"], "status": status.get(c["id"], "not_started")}
            for c in data["chapters"]
        ]
        paragraphs = [
            {"id": p["id"], "chapterId": p["chapterId"], "chapter": p["chapterTitle"], "index": p["index"], "text": p["text"], "entityIds": entity_index.get((p["chapterId"], p["id"]), [])}
            for p in data["paragraphs"]
        ]
        return {"chapters": chapters, "paragraphs": paragraphs, "notes": self._load_notes()["notes"]}

    def search(self, query: str) -> list[dict]:
        if not query or not query.strip():
            return []
        data = self._load()
        needle = query.lower()
        return [
            {"chapter": p["chapterTitle"], "chapterId": p["chapterId"], "paragraph": p["index"], "paragraphId": p["id"], "excerpt": p["text"]}
            for p in data["paragraphs"]
            if needle in p["text"].lower()
        ]

    def set_chapter_status(self, chapter_id: str, status: str) -> dict:
        if status not in _ALLOWED_STATUSES:
            raise ManuscriptError(f"Unknown chapter status: {status}")
        notes = self._load_notes()
        chapter = next((item for item in self._load()["chapters"] if item["id"] == chapter_id), None)
        if chapter is None:
            raise ManuscriptError("Unknown manuscript chapter.")
        notes["chapterStatus"][chapter_id] = status
        self._save_notes(notes)
        return {"id": chapter["id"], "title": chapter["title"], "index": chapter["index"], "wordCount": chapter["wordCount"], "status": status}

    def note_list(self, chapter_id: str | None) -> list[dict]:
        notes = self._load_notes()["notes"]
        return notes if chapter_id is None else [n for n in notes if n.get("chapterId") == chapter_id]

    def note_create(self, chapter_id: str, paragraph_id: str, text: str, anchor_start: int | None = None, anchor_end: int | None = None, anchor_text: str | None = None) -> dict:
        if (anchor_start is not None and anchor_start < 0) or (anchor_end is not None and (anchor_start is None or anchor_end < anchor_start)):
            raise ManuscriptError("Invalid note anchor.")
        paragraph = next((item for item in self._load()["paragraphs"] if item["id"] == paragraph_id and item["chapterId"] == chapter_id), None)
        if paragraph is None:
            raise ManuscriptError("Unknown manuscript paragraph.")
        notes = self._load_notes()
        note = {
            "id": uuid.uuid4().hex,
            "chapter": paragraph["chapterTitle"], "chapterId": chapter_id,
            "paragraph": paragraph["index"], "paragraphId": paragraph_id,
            "text": text,
            "createdAt": _now_iso(),
            "anchorStart": anchor_start,
            "anchorEnd": anchor_end,
            "anchorText": anchor_text,
        }
        notes["notes"].append(note)
        self._save_notes(notes)
        return note

    def note_delete(self, note_id: str) -> None:
        notes = self._load_notes()
        notes["notes"] = [n for n in notes["notes"] if n.get("id") != note_id]
        self._save_notes(notes)

    def get_reader_state(self) -> dict:
        return self._load_notes()["readerState"]

    def save_reader_state(self, active_chapter: str | None, active_source_line: int | None, expanded_chapters: list[str] | None = None) -> dict:
        notes = self._load_notes()
        current = notes["readerState"]
        next_state = {
            "activeChapter": active_chapter,
            "activeSourceLine": active_source_line,
            "bookmarks": current["bookmarks"],
            "expandedChapters": expanded_chapters if expanded_chapters is not None else current["expandedChapters"],
        }
        notes["readerState"] = next_state
        self._save_notes(notes)
        return next_state

    def create_bookmark(self, kind: str, chapter: str, chapter_id: str | None, paragraph: int | None, paragraph_id: str | None, source_line: int | None, note_id: str | None) -> dict:
        if kind not in ("chapter", "line", "note"):
            raise ManuscriptError("Unknown bookmark kind.")
        notes = self._load_notes()
        state = notes["readerState"]
        duplicate = next(
            (b for b in state["bookmarks"] if b.get("kind") == kind and b.get("chapterId") == chapter_id and b.get("paragraphId") == paragraph_id and b.get("noteId") == note_id),
            None,
        )
        if duplicate is not None:
            return duplicate
        bookmark = {
            "id": uuid.uuid4().hex,
            "kind": kind,
            "chapter": chapter,
            "chapterId": chapter_id,
            "paragraph": paragraph,
            "paragraphId": paragraph_id,
            "sourceLine": source_line,
            "noteId": note_id,
            "createdAt": _now_iso(),
        }
        state["bookmarks"] = [*state["bookmarks"], bookmark]
        notes["readerState"] = state
        self._save_notes(notes)
        return bookmark

    def delete_bookmark(self, bookmark_id: str) -> None:
        notes = self._load_notes()
        state = notes["readerState"]
        state["bookmarks"] = [b for b in state["bookmarks"] if b.get("id") != bookmark_id]
        notes["readerState"] = state
        self._save_notes(notes)
