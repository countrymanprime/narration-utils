import importlib.util
import json
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
