import importlib.util
import io
import json
from contextlib import redirect_stderr
from pathlib import Path

import pytest

COMPARE_PATH = Path(__file__).resolve().parents[1] / "core" / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare", COMPARE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)


def test_reference_sections_are_not_available_for_transcript_matching(tmp_path):
    manuscript = tmp_path / "manuscript.json"
    manuscript.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "documentId": "test-document",
                "chapters": [
                    {"id": "chapter-1", "title": "Chapter 1", "contentKind": "narration"},
                    {"id": "characters", "title": "Characters", "contentKind": "reference"},
                ],
                "paragraphs": [
                    {"id": "p-1", "chapterId": "chapter-1", "index": 0, "text": "Ada enters the room."},
                    {"id": "p-2", "chapterId": "characters", "index": 1, "text": "Ada Finch is the narrator."},
                ],
            }
        ),
        encoding="utf-8",
    )

    chapters = compare.load_manuscript_chapters(manuscript)

    assert [chapter["title"] for chapter in chapters] == ["Chapter 1"]
    assert chapters[0]["paragraphs"] == ["Ada enters the room."]


def test_marker_confidence_is_high_at_a_clear_audio_pause():
    transcript_words = [("a", 0.0, 0.4), ("b", 0.4 + compare.PAUSE_GAP_SECONDS, 1.8)]
    index_map = [0, 1]

    label, gap = compare._marker_timing_confidence(1, 1, index_map, transcript_words)

    assert label == "high"
    assert gap == pytest.approx(compare.PAUSE_GAP_SECONDS)


def test_marker_confidence_is_low_when_words_run_together():
    transcript_words = [("a", 0.0, 0.5), ("b", 0.5 + compare.TIGHT_GAP_SECONDS / 2, 1.0)]
    index_map = [0, 1]

    label, gap = compare._marker_timing_confidence(1, 1, index_map, transcript_words)

    assert label == "low"
    assert gap == pytest.approx(compare.TIGHT_GAP_SECONDS / 2)


def test_marker_confidence_is_medium_between_the_two_thresholds():
    mid_gap = (compare.TIGHT_GAP_SECONDS + compare.PAUSE_GAP_SECONDS) / 2
    transcript_words = [("a", 0.0, 0.5), ("b", 0.5 + mid_gap, 1.0)]
    index_map = [0, 1]

    label, gap = compare._marker_timing_confidence(1, 1, index_map, transcript_words)

    assert label == "medium"
    assert gap == pytest.approx(mid_gap)


def test_marker_confidence_is_unknown_at_the_transcript_edge():
    transcript_words = [("a", 0.0, 0.4), ("b", 1.0, 1.4)]
    index_map = [0, 1]

    label, gap = compare._marker_timing_confidence(0, 0, index_map, transcript_words)

    assert label == "unknown"
    assert gap is None


def test_marker_confidence_for_a_span_uses_the_larger_boundary_gap():
    # A replace/insert spans [j1, j2); the tighter boundary shouldn't mask a
    # genuine pause on the other side of the span.
    clear_pause = compare.PAUSE_GAP_SECONDS + 0.1
    transcript_words = [
        ("a", 0.0, 0.4),
        ("b", 0.4 + compare.TIGHT_GAP_SECONDS / 2, 0.8),
        ("c", 0.8 + compare.TIGHT_GAP_SECONDS / 2, 1.2),
        ("d", 1.2 + clear_pause, 1.8),
    ]
    index_map = [0, 1, 2, 3]

    label, gap = compare._marker_timing_confidence(1, 3, index_map, transcript_words)

    assert label == "high"
    assert gap == pytest.approx(clear_pause)


# ---------------------------------------------------------------------------
# what the take markers ignore and tolerate (docs/utilities/transcript-compare.md, Acceptance)


def _markers(title, paragraphs, said):
    _units, tokens, unit_idx, raw_words = compare.build_chapter_units({"title": title, "paragraphs": paragraphs})
    words = [(word, index * 0.4, index * 0.4 + 0.3) for index, word in enumerate(said.split())]
    markers, covered_range, _alignment = compare.diff_and_build_markers(tokens, unit_idx, raw_words, words, 1)
    return [(marker[1], marker[3], marker[4]) for marker in markers], covered_range


def test_the_alignment_window_and_gap_count_are_recorded_at_debug_level(monkeypatch):
    monkeypatch.setenv("NARRATION_LOG_LEVEL", "debug")
    _units, tokens, unit_idx, raw_words = compare.build_chapter_units({"title": "Chapter One", "paragraphs": ["Ada opened the ledger at the first page."]})
    said = "Ada opened the page."
    words = [(word, index * 0.4, index * 0.4 + 0.3) for index, word in enumerate(said.split())]

    buffer = io.StringIO()
    with redirect_stderr(buffer):
        compare.diff_and_build_markers(tokens, unit_idx, raw_words, words, 1)

    records = [json.loads(line) for line in buffer.getvalue().splitlines() if line]
    (record,) = [r for r in records if r.get("event") == "compare.alignment"]
    assert record["level"] == "debug"
    assert record["aligned_start"] is not None
    assert record["gap_count"] >= 1
    assert "ledger" not in json.dumps(record)


def test_no_alignment_record_is_written_when_debug_is_off(monkeypatch):
    monkeypatch.delenv("NARRATION_LOG_LEVEL", raising=False)
    _units, tokens, unit_idx, raw_words = compare.build_chapter_units({"title": "Chapter One", "paragraphs": ["Ada opened the ledger."]})
    said = "Ada opened the ledger."
    words = [(word, index * 0.4, index * 0.4 + 0.3) for index, word in enumerate(said.split())]

    buffer = io.StringIO()
    with redirect_stderr(buffer):
        compare.diff_and_build_markers(tokens, unit_idx, raw_words, words, 1)

    assert buffer.getvalue() == ""


PARAGRAPHS = ["Ada opened the ledger at the first page.", "She read the column twice.", "Then she closed the book."]


def test_a_partial_recording_marks_no_skips_outside_the_recorded_span():
    markers, covered_range = _markers("Chapter 1", PARAGRAPHS, "she read the column twice")

    assert markers == []
    assert covered_range == (1, 1)


def test_a_skip_inside_the_recorded_span_is_marked():
    markers, _covered = _markers("Chapter 1", PARAGRAPHS, "ada opened the ledger at the first page then she closed the book")

    assert markers == [("SKIPPED", "she read the column twice", "")]


def test_a_spoken_title_is_not_extra_and_an_omitted_one_is_not_skipped():
    spoken, _ = _markers("Chapter 1", PARAGRAPHS, "chapter one ada opened the ledger at the first page she read the column twice then she closed the book")
    omitted, _ = _markers("Chapter 1", PARAGRAPHS, "ada opened the ledger at the first page she read the column twice then she closed the book")

    assert spoken == [] and omitted == []


def test_homophones_spoken_numbers_and_split_compounds_are_not_misreads():
    paragraphs = ["They're carrying 214 barrels and a notebook.", "It sailed in 1847, a well-known year."]
    markers, _ = _markers("Chapter 1", paragraphs, "their carrying two hundred fourteen barrels and a note book it sailed in 1847 a well known year")

    assert markers == []


def test_an_invented_name_spelled_another_way_is_a_misread_until_it_has_an_equivalence(monkeypatch):
    before, _ = _markers("Chapter 1", ["At dawn Maelis opened the ledger."], "at dawn maylis opened the ledger")
    monkeypatch.setattr(compare, "_CUSTOM_CANON", compare._build_canon([("maelis", "maylis")]))
    after, _ = _markers("Chapter 1", ["At dawn Maelis opened the ledger."], "at dawn maylis opened the ledger")

    assert before == [("MISREAD", "maelis", "maylis")]
    assert after == []
