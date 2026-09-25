import importlib.util
import json
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parents[1] / "core" / "chapter_script.py"
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
    by_chapter_name = chapter_script.load_chapter_script(path, "CHAPTER ONE — Bad Ideas Look Great")

    assert by_id.chapter_id == by_title.chapter_id == "c2"
    assert by_display_title.chapter_id == by_chapter_name.chapter_id == "c1"


def test_an_unknown_chapter_lists_the_narration_chapters_that_can_be_chosen(tmp_path):
    with pytest.raises(chapter_script.ChapterError) as error:
        chapter_script.load_chapter_script(_manuscript(tmp_path), "Chapter Nine")

    # Named by the app's rule (ADR 0191), and each can be passed back to select its chapter.
    assert error.value.candidates == ["CHAPTER ONE — Bad Ideas Look Great", "Chapter Two"]
    for name in error.value.candidates:
        assert chapter_script.load_chapter_script(_manuscript(tmp_path), name).title


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


# A script that is not a manuscript chapter (the opening or closing credits, audiobook-credits-templates.prd.md Phase 4,
# ADR 0150): the host renders the text and hands it over as a file, and the reader needs spans for it as for a chapter.


def test_a_text_script_is_every_word_of_the_text_with_no_title_words():
    script = chapter_script.text_script("Alice, written by Lewis Carroll,\n\nnarrated by  Ada.", "credits-opening", "Opening credits")

    assert script.tokens == ["Alice,", "written", "by", "Lewis", "Carroll,", "narrated", "by", "Ada."]
    assert (script.chapter_id, script.title) == ("credits-opening", "Opening credits")


def test_a_text_script_has_one_paragraph_span_per_line_with_words_numbered_from_one():
    script = chapter_script.text_script("One two.\r\n   \nThree.\rFour five six.", "credits-closing", "Closing credits")

    assert [(s.kind, s.id, s.index, s.start, s.count) for s in script.spans] == [
        ("paragraph", "credits-closing-1", None, 0, 2),
        ("paragraph", "credits-closing-2", None, 2, 1),
        ("paragraph", "credits-closing-3", None, 3, 3),
    ]


def test_a_text_script_event_names_the_script_by_its_id_and_title():
    event = chapter_script.script_event(chapter_script.text_script("The End.", "credits-closing", "Closing credits"))

    assert event == {
        "type": "script",
        "chapter": {"id": "credits-closing", "title": "Closing credits"},
        "tokens": 2,
        "spans": [{"kind": "paragraph", "id": "credits-closing-1", "index": None, "start": 0, "count": 2}],
    }


def test_a_text_script_with_no_words_is_refused():
    with pytest.raises(chapter_script.ChapterError, match="no words"):
        chapter_script.text_script(" \n\t", "credits-opening", "Opening credits")


def test_load_text_script_reads_the_file_as_utf8(tmp_path):
    path = tmp_path / "credits.txt"
    path.write_bytes("Café au lait,\r\nread by Zoë.".encode())

    script = chapter_script.load_text_script(path, "credits-opening", "Opening credits")

    assert script.tokens == ["Café", "au", "lait,", "read", "by", "Zoë."]
    assert [s.id for s in script.spans] == ["credits-opening-1", "credits-opening-2"]


def test_load_text_script_reports_a_missing_file_as_a_chapter_error(tmp_path):
    with pytest.raises(chapter_script.ChapterError, match="Could not read the Opening credits text"):
        chapter_script.load_text_script(tmp_path / "gone.txt", "credits-opening", "Opening credits")
