"""Ported from shared/hub.Tests/ManuscriptServiceTests.cs."""

import json
import pytest

from shared.server.manuscript_service import ManuscriptError, ManuscriptService
from narration_common.manuscript import manuscript_path


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "project"
    (root / "ManuscriptGuide").mkdir(parents=True)
    return root


def new_service(project) -> ManuscriptService:
    return ManuscriptService(str(project), python_exe="unused", backend="unused")


def seed_manuscript(project):
    payload = {
        "schemaVersion": 1, "documentId": "test", "importedAt": "2026-01-01T00:00:00Z", "importer": {"format": "docx", "version": 1},
        "source": {"fileName": "test.docx", "sha256": "x", "storedPath": "sources/test.docx"},
        "chapters": [{"id": "c-1", "title": "Chapter One", "index": 0, "wordCount": 8, "sections": []}, {"id": "c-2", "title": "Chapter Two", "index": 1, "wordCount": 5, "sections": []}],
        "paragraphs": [
            {"id": "p-1", "chapterId": "c-1", "chapterTitle": "Chapter One", "index": 0, "text": "Saint Voltage crossed the plaza at a dead run."},
            {"id": "p-2", "chapterId": "c-1", "chapterTitle": "Chapter One", "index": 1, "text": "Nico was waiting by the side doors."},
            {"id": "p-3", "chapterId": "c-2", "chapterTitle": "Chapter Two", "index": 2, "text": "Three floors beneath the hall."},
        ],
    }
    target = manuscript_path(project)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload), encoding="utf-8")


def seed_guide(project):
    guide = {
        "entities": [{
            "id": "saint-voltage", "canonical_name": "Saint Voltage", "category": "Character", "locked": False,
            "occurrences": [{"chapter": "Chapter One", "chapterId": "c-1", "paragraph": 0, "paragraphId": "p-1", "excerpt": "Saint Voltage crossed the plaza."}],
            "aliases": [{"text": "The Voltage", "occurrences": [{"chapter": "Chapter One", "chapterId": "c-1", "paragraph": 1, "paragraphId": "p-2", "excerpt": "Nico was waiting."}]}],
        }],
    }
    (project / "ManuscriptGuide" / "manuscript_guide.json").write_text(json.dumps(guide), encoding="utf-8")


def test_chapters_reads_word_counts_from_the_cache_and_defaults_status_to_not_started(project):
    seed_manuscript(project)
    chapters = new_service(project).chapters()
    assert len(chapters) == 2
    assert chapters[0]["title"] == "Chapter One"
    assert chapters[0]["wordCount"] == 8
    assert chapters[0]["status"] == "not_started"


def test_paragraphs_are_filtered_by_chapter_and_tagged_with_entity_ids_from_the_guide(project):
    seed_manuscript(project)
    seed_guide(project)
    paragraphs = new_service(project).paragraphs("c-1")
    assert len(paragraphs) == 2
    assert paragraphs[0]["entityIds"] == ["saint-voltage"]
    assert paragraphs[1]["entityIds"] == ["saint-voltage"]  # via the alias's own occurrence


def test_paragraphs_with_no_matching_entity_occurrence_get_an_empty_list(project):
    seed_manuscript(project)
    seed_guide(project)
    paragraphs = new_service(project).paragraphs("c-2")
    assert len(paragraphs) == 1
    assert paragraphs[0]["entityIds"] == []


def test_search_is_case_insensitive_across_all_chapters(project):
    seed_manuscript(project)
    hits = new_service(project).search("nico")
    assert len(hits) == 1
    assert hits[0]["chapter"] == "Chapter One"


def test_chapter_status_and_notes_round_trip_through_the_sidecar_without_touching_the_python_backend(project):
    service = new_service(project)
    seed_manuscript(project)
    service.set_chapter_status("c-1", "recording")
    chapters = service.chapters()
    assert next(c for c in chapters if c["title"] == "Chapter One")["status"] == "recording"

    note = service.note_create("c-1", "p-1", "Underplay the bravado here.")
    assert note["chapter"] == "Chapter One"
    assert len(service.note_list("c-1")) == 1
    assert service.note_list("c-2") == []

    service.note_delete(note["id"])
    assert service.note_list(None) == []


def test_setting_an_unknown_chapter_status_throws(project):
    with pytest.raises(ManuscriptError):
        new_service(project).set_chapter_status("Chapter One", "on-fire")


def test_reader_state_and_bookmarks_round_trip_through_the_project_sidecar(project):
    seed_manuscript(project)
    service = new_service(project)
    initial = service.get_reader_state()
    assert initial["expandedChapters"] is None
    assert initial["bookmarks"] == []

    service.save_reader_state("c-2", 512, ["c-1", "c-2"])
    bookmark = service.create_bookmark("line", "Chapter Two", "c-2", 2, "p-3", 512, None)
    restored = new_service(project).get_reader_state()

    assert restored["activeChapter"] == "c-2"
    assert restored["activeSourceLine"] == 512
    assert restored["expandedChapters"] == ["c-1", "c-2"]
    assert len(restored["bookmarks"]) == 1
    assert restored["bookmarks"][0]["id"] == bookmark["id"]

    service.delete_bookmark(bookmark["id"])
    assert new_service(project).get_reader_state()["bookmarks"] == []


def test_legacy_reader_state_ignores_retired_autofocus_field(project):
    sidecar = project / "narration-utils" / "manuscript-notes.json"
    sidecar.parent.mkdir(parents=True)
    sidecar.write_text(json.dumps({
        "notes": [],
        "chapterStatus": {},
        "readerState": {
            "activeChapter": "Chapter One",
            "autoFocusChapters": True,
            "bookmarks": [],
            "expandedChapters": ["Chapter One"],
        },
    }), encoding="utf-8")

    state = new_service(project).get_reader_state()

    assert state["activeChapter"] == "Chapter One"
    assert state["expandedChapters"] == ["Chapter One"]
