"""Ported from shared/hub.Tests/ManuscriptServiceTests.cs."""

import json
import os
import time

import pytest

from shared.server.manuscript_service import ManuscriptError, ManuscriptService


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "project"
    (root / "ManuscriptGuide").mkdir(parents=True)
    (root / "Manuscript.docx").write_text("not a real docx - only its mtime matters for cache staleness", encoding="utf-8")
    return root


def new_service(project) -> ManuscriptService:
    return ManuscriptService(str(project), python_exe="unused", backend="unused")


def seed_text_cache(project):
    payload = {
        "chapters": [{"title": "Chapter One", "index": 0, "wordCount": 8}, {"title": "Chapter Two", "index": 1, "wordCount": 5}],
        "paragraphs": [
            {"chapter": "Chapter One", "index": 0, "text": "Saint Voltage crossed the plaza at a dead run."},
            {"chapter": "Chapter One", "index": 1, "text": "Nico was waiting by the side doors."},
            {"chapter": "Chapter Two", "index": 2, "text": "Three floors beneath the hall."},
        ],
    }
    cache_path = project / "ManuscriptGuide" / "manuscript_text.json"
    cache_path.write_text(json.dumps(payload), encoding="utf-8")
    # Cache must be newer than Manuscript.docx or ManuscriptService treats it
    # as stale and tries to regenerate it via the (here, fake) Python backend.
    future = time.time() + 300
    os.utime(cache_path, (future, future))


def seed_guide(project):
    guide = {
        "entities": [{
            "id": "saint-voltage", "canonical_name": "Saint Voltage", "category": "Character", "locked": False,
            "occurrences": [{"chapter": "Chapter One", "paragraph": 0, "excerpt": "Saint Voltage crossed the plaza."}],
            "aliases": [{"text": "The Voltage", "occurrences": [{"chapter": "Chapter One", "paragraph": 1, "excerpt": "Nico was waiting."}]}],
        }],
    }
    (project / "ManuscriptGuide" / "manuscript_guide.json").write_text(json.dumps(guide), encoding="utf-8")


def test_chapters_reads_word_counts_from_the_cache_and_defaults_status_to_not_started(project):
    seed_text_cache(project)
    chapters = new_service(project).chapters()
    assert len(chapters) == 2
    assert chapters[0]["title"] == "Chapter One"
    assert chapters[0]["wordCount"] == 8
    assert chapters[0]["status"] == "not_started"


def test_paragraphs_are_filtered_by_chapter_and_tagged_with_entity_ids_from_the_guide(project):
    seed_text_cache(project)
    seed_guide(project)
    paragraphs = new_service(project).paragraphs("Chapter One")
    assert len(paragraphs) == 2
    assert paragraphs[0]["entityIds"] == ["saint-voltage"]
    assert paragraphs[1]["entityIds"] == ["saint-voltage"]  # via the alias's own occurrence


def test_paragraphs_with_no_matching_entity_occurrence_get_an_empty_list(project):
    seed_text_cache(project)
    seed_guide(project)
    paragraphs = new_service(project).paragraphs("Chapter Two")
    assert len(paragraphs) == 1
    assert paragraphs[0]["entityIds"] == []


def test_search_is_case_insensitive_across_all_chapters(project):
    seed_text_cache(project)
    hits = new_service(project).search("nico")
    assert len(hits) == 1
    assert hits[0]["chapter"] == "Chapter One"


def test_chapter_status_and_notes_round_trip_through_the_sidecar_without_touching_the_python_backend(project):
    service = new_service(project)
    service.set_chapter_status("Chapter One", "recording")
    seed_text_cache(project)
    chapters = service.chapters()
    assert next(c for c in chapters if c["title"] == "Chapter One")["status"] == "recording"

    note = service.note_create("Chapter One", 0, "Underplay the bravado here.")
    assert note["chapter"] == "Chapter One"
    assert len(service.note_list("Chapter One")) == 1
    assert service.note_list("Chapter Two") == []

    service.note_delete(note["id"])
    assert service.note_list(None) == []


def test_setting_an_unknown_chapter_status_throws(project):
    with pytest.raises(ManuscriptError):
        new_service(project).set_chapter_status("Chapter One", "on-fire")


def test_reader_state_and_bookmarks_round_trip_through_the_project_sidecar(project):
    service = new_service(project)
    initial = service.get_reader_state()
    assert initial["expandedChapters"] is None
    assert initial["bookmarks"] == []

    service.save_reader_state("Chapter Two", 512, ["Chapter One", "Chapter Two"])
    bookmark = service.create_bookmark("line", "Chapter Two", 2, 512, None)
    restored = new_service(project).get_reader_state()

    assert restored["activeChapter"] == "Chapter Two"
    assert restored["activeSourceLine"] == 512
    assert restored["expandedChapters"] == ["Chapter One", "Chapter Two"]
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
