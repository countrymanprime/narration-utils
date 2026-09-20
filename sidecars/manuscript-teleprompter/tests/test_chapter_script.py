import importlib.util
import json
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parents[1] / "chapter_script.py"
SPEC = importlib.util.spec_from_file_location("chapter_script", MODULE_PATH)
chapter_script = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(chapter_script)


def _manuscript(tmp_path):
    data = {
        "schemaVersion": 1,
        "documentId": "test-document",
        "chapters": [
            {"id": "c1", "title": "CHAPTER ONE\nBad Ideas Look Great", "contentKind": "narration"},
            {"id": "c2", "title": "Chapter Two", "contentKind": "narration"},
            {"id": "ref", "title": "Characters", "contentKind": "reference"},
            {"id": "empty", "title": "Empty Chapter", "contentKind": "narration"},
        ],
        "paragraphs": [
            {"id": "p1", "chapterId": "c1", "index": 0, "text": "Ada  enters the room."},
            {"id": "p2", "chapterId": "c1", "index": 1, "text": "She stops."},
            {"id": "p3", "chapterId": "c2", "index": 2, "text": "Morning came."},
            {"id": "p4", "chapterId": "ref", "index": 3, "text": "Ada Finch is the narrator."},
        ],
    }
    path = tmp_path / "manuscript.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_the_script_is_the_title_then_each_paragraph_split_on_whitespace(tmp_path):
    script = chapter_script.load_chapter_script(_manuscript(tmp_path), "c1")

    assert script.tokens == ["CHAPTER", "ONE", "Bad", "Ideas", "Look", "Great", "Ada", "enters", "the", "room.", "She", "stops."]


def test_spans_map_token_ranges_back_to_the_title_and_paragraphs(tmp_path):
    script = chapter_script.load_chapter_script(_manuscript(tmp_path), "c1")

    assert [(s.kind, s.id, s.index, s.start, s.count) for s in script.spans] == [
        ("title", "c1", None, 0, 6),
        ("paragraph", "p1", 0, 6, 4),
        ("paragraph", "p2", 1, 10, 2),
    ]


def test_a_chapter_can_be_selected_by_id_or_by_title_ignoring_case_and_line_breaks(tmp_path):
    path = _manuscript(tmp_path)

    by_id = chapter_script.load_chapter_script(path, "c2")
    by_title = chapter_script.load_chapter_script(path, "chapter TWO")
    by_display_title = chapter_script.load_chapter_script(path, "CHAPTER ONE: Bad Ideas Look Great")

    assert by_id.chapter_id == by_title.chapter_id == "c2"
    assert by_display_title.chapter_id == "c1"


def test_an_unknown_chapter_lists_the_narration_chapters_that_can_be_chosen(tmp_path):
    with pytest.raises(chapter_script.ChapterError) as error:
        chapter_script.load_chapter_script(_manuscript(tmp_path), "Chapter Nine")

    assert error.value.candidates == ["CHAPTER ONE: Bad Ideas Look Great", "Chapter Two"]


def test_reference_sections_and_empty_chapters_cannot_be_read_from(tmp_path):
    path = _manuscript(tmp_path)

    for name in ("ref", "Characters", "empty"):
        with pytest.raises(chapter_script.ChapterError):
            chapter_script.load_chapter_script(path, name)


def test_the_chapter_text_is_the_title_and_paragraphs_joined_for_biasing(tmp_path):
    script = chapter_script.load_chapter_script(_manuscript(tmp_path), "c2")

    assert script.text == "Chapter Two\nMorning came."


def test_the_script_event_describes_the_chapter_and_its_token_spans(tmp_path):
    script = chapter_script.load_chapter_script(_manuscript(tmp_path), "c2")

    assert chapter_script.script_event(script) == {
        "type": "script",
        "chapter": {"id": "c2", "title": "Chapter Two"},
        "tokens": 4,
        "spans": [
            {"kind": "title", "id": "c2", "index": None, "start": 0, "count": 2},
            {"kind": "paragraph", "id": "p3", "index": 2, "start": 2, "count": 2},
        ],
    }


def test_a_missing_manuscript_reports_a_chapter_error_not_a_crash(tmp_path):
    with pytest.raises(chapter_script.ChapterError):
        chapter_script.load_chapter_script(tmp_path / "nope.json", "c1")
