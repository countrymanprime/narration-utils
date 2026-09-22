"""Tests for the --find-repeats additive detector mode (take-review PRD
phase 3, Q1/Q2): the repeated-span clustering, exact-copy detection by
source identity, and the SPAN_GROUP/SPAN_MEMBER tagged output. Kept in a
separate module from test_compare.py per the PRD's parallel-session note
(new logic in a new module, `take-review-pickups-duplicates-take-intelligence.prd.md`
"Parallel-session compatibility", phase 3 row)."""

import argparse
import importlib.util
import json
from pathlib import Path

COMPARE_PATH = Path(__file__).resolve().parents[1] / "core" / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare_repeats", COMPARE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)


def _manuscript(tmp_path, chapter_text):
    manuscript = tmp_path / "manuscript.json"
    manuscript.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "documentId": "test-document",
                "chapters": [{"id": "chapter-1", "title": "Chapter One", "contentKind": "narration"}],
                "paragraphs": [{"id": "p-1", "chapterId": "chapter-1", "index": 0, "text": chapter_text}],
            }
        ),
        encoding="utf-8",
    )
    return manuscript


# ---------------------------------------------------------------------------
# detect_exact_copies


def test_detect_exact_copies_groups_identical_source_ranges():
    segments = [
        {"source_file": "take_a.wav", "start_offset": 0.0, "length": 4.0},
        {"source_file": "take_b.wav", "start_offset": 0.0, "length": 4.0},
        {"source_file": "take_a.wav", "start_offset": 0.0, "length": 4.0},
    ]

    result = compare.detect_exact_copies(segments)

    assert result[0] == result[2]
    assert 1 not in result


def test_detect_exact_copies_ignores_different_ranges_of_the_same_file():
    segments = [
        {"source_file": "session.wav", "start_offset": 0.0, "length": 4.0},
        {"source_file": "session.wav", "start_offset": 10.0, "length": 4.0},
    ]

    result = compare.detect_exact_copies(segments)

    assert result == {}


def test_detect_exact_copies_is_empty_when_every_segment_is_unique():
    segments = [
        {"source_file": "a.wav", "start_offset": 0.0, "length": 4.0},
        {"source_file": "b.wav", "start_offset": 0.0, "length": 4.0},
    ]

    assert compare.detect_exact_copies(segments) == {}


# ---------------------------------------------------------------------------
# group_repeated_spans


def test_group_repeated_spans_groups_overlapping_reads():
    # Segment 0 covers sentences 0-2, segment 1 covers 1-2 (a pickup of the
    # tail), segment 2 is unrelated (sentence 9 only, no overlap).
    covered_ranges = [(0, 2), (1, 2), (9, 9)]

    groups = compare.group_repeated_spans(covered_ranges, min_overlap=0.5)

    assert len(groups) == 1
    first_u, last_u, members = groups[0]
    assert (first_u, last_u) == (0, 2)
    assert sorted(members) == [0, 1]


def test_group_repeated_spans_keeps_barely_touching_spans_separate():
    # Spans touch at exactly one sentence unit - below the 0.5 overlap
    # threshold relative to either span's own length, so no group forms.
    covered_ranges = [(0, 4), (4, 8)]

    groups = compare.group_repeated_spans(covered_ranges, min_overlap=0.5)

    assert groups == []


def test_group_repeated_spans_excludes_unaligned_segments():
    covered_ranges = [(0, 3), (0, 3), None]

    groups = compare.group_repeated_spans(covered_ranges, min_overlap=0.5)

    assert len(groups) == 1
    assert sorted(groups[0][2]) == [0, 1]


def test_group_repeated_spans_omits_singleton_spans():
    covered_ranges = [(0, 3), (10, 12)]

    groups = compare.group_repeated_spans(covered_ranges, min_overlap=0.5)

    assert groups == []


# ---------------------------------------------------------------------------
# read_repeat_segments


def test_read_repeat_segments_parses_identity_fields(tmp_path):
    manifest = tmp_path / "manifest.txt"
    manifest.write_text(
        "0|C:/audio/a.wav|0.0|4.5|{ITEM-GUID-1}|{TAKE-GUID-1}\n1|C:/audio/b.wav|10.0|3.25|{ITEM-GUID-2}|{TAKE-GUID-2}\n",
        encoding="utf-8",
    )

    segments = compare.read_repeat_segments(manifest)

    assert segments == [
        {"item_index": 0, "source_file": "C:/audio/a.wav", "start_offset": 0.0, "length": 4.5, "item_guid": "{ITEM-GUID-1}", "take_guid": "{TAKE-GUID-1}"},
        {"item_index": 1, "source_file": "C:/audio/b.wav", "start_offset": 10.0, "length": 3.25, "item_guid": "{ITEM-GUID-2}", "take_guid": "{TAKE-GUID-2}"},
    ]


# ---------------------------------------------------------------------------
# find_repeated_spans (integration, ASR mocked out)


def _fake_decode_segment(source_file, start_offset, length):
    import numpy as np

    return np.zeros(int(length * compare.SAMPLE_RATE), dtype=np.float32)


def test_find_repeated_spans_groups_a_restart_and_flags_an_exact_copy(tmp_path, monkeypatch):
    chapter_text = "Ada walked into the quiet room. She closed the door behind her softly."
    manuscript = _manuscript(tmp_path, chapter_text)

    # Reads, by manifest order:
    #  0: the full sentence pair, read cleanly (the "keeper")
    #  1: a restart of the same two sentences (should group with 0)
    #  2: byte-identical source range to segment 1 (an exact copy, e.g. a
    #     duplicated take) - also groups with 0/1 by span, and is flagged
    #     as an exact copy of segment 1 besides.
    #  3: a pickup of just the second sentence (a partial-coverage read of
    #     the same span, distinct from the exact-copy pair)
    transcripts = {
        0: [
            (w, i * 0.5, i * 0.5 + 0.4)
            for i, w in enumerate(["ada", "walked", "into", "the", "quiet", "room", "she", "closed", "the", "door", "behind", "her", "softly"])
        ],
        1: [
            (w, i * 0.5, i * 0.5 + 0.4)
            for i, w in enumerate(["ada", "walked", "into", "the", "quiet", "room", "she", "closed", "the", "door", "behind", "her", "softly"])
        ],
        2: [
            (w, i * 0.5, i * 0.5 + 0.4)
            for i, w in enumerate(["ada", "walked", "into", "the", "quiet", "room", "she", "closed", "the", "door", "behind", "her", "softly"])
        ],
        3: [(w, i * 0.5, i * 0.5 + 0.4) for i, w in enumerate(["she", "closed", "the", "door", "behind", "her", "softly"])],
    }

    def fake_transcribe(audio, model_size, language, device="cpu", progress_path=None, hotwords=None, return_info=False, model_dir=None):
        return transcripts[fake_transcribe.call_count.pop(0)]

    fake_transcribe.call_count = [0, 1, 2, 3]

    monkeypatch.setattr(compare, "decode_segment", _fake_decode_segment)
    monkeypatch.setattr(compare, "transcribe", fake_transcribe)

    manifest = tmp_path / "manifest.txt"
    manifest.write_text(
        "0|C:/audio/take0.wav|0.0|7.0|{ITEM-1}|{TAKE-1}\n"
        "1|C:/audio/take1.wav|0.0|7.0|{ITEM-1}|{TAKE-2}\n"
        "2|C:/audio/take1.wav|0.0|7.0|{ITEM-1}|{TAKE-3}\n"
        "3|C:/audio/take3.wav|0.0|2.0|{ITEM-1}|{TAKE-4}\n",
        encoding="utf-8",
    )

    out_path = tmp_path / "results.txt"
    args = argparse.Namespace(
        manifest=str(manifest),
        manuscript=str(manuscript),
        track_name="Chapter One",
        chapter_title=None,
        out=str(out_path),
        model="tiny",
        model_dir=None,
        language="en",
        device="cpu",
        progress=None,
        min_words=1,
        min_span_overlap=0.5,
    )

    compare.find_repeated_spans(args)

    lines = out_path.read_text(encoding="utf-8").strip().splitlines()
    summary = lines[0]
    assert summary.startswith("SUMMARY|Found 1 repeated-span group(s)")

    group_lines = [line for line in lines if line.startswith("SPAN_GROUP|")]
    member_lines = [line for line in lines if line.startswith("SPAN_MEMBER|")]

    assert len(group_lines) == 1
    assert group_lines[0].split("|")[4] == "4"  # all 4 reads cover (some or all of) the same two sentences

    members_by_item = {line.split("|")[2]: line.split("|") for line in member_lines}
    assert set(members_by_item.keys()) == {"0", "1", "2", "3"}

    # SPAN_MEMBER|group|item_index|item_guid|take_guid|source_file|start_offset|length|first_u|last_u|coverage|quality|exact_copy
    coverage_index, quality_index, exact_copy_field_index = 10, 11, 12

    # Segment 2 shares source identity with segment 1 (same file/offset/length).
    seg2_fields = members_by_item["2"]
    seg1_fields = members_by_item["1"]
    assert seg2_fields[exact_copy_field_index] == seg1_fields[exact_copy_field_index]
    assert seg2_fields[exact_copy_field_index] != ""

    # Segment 0 (the "keeper", never duplicated) and segment 3 (a distinct
    # partial pickup, not a byte-identical copy) have no exact-copy flag.
    assert members_by_item["0"][exact_copy_field_index] == ""
    assert members_by_item["3"][exact_copy_field_index] == ""

    # Segment 3 covers only the second sentence, so it's a partial-coverage
    # member of the group, while the full two-sentence reads cover it fully.
    assert float(members_by_item["3"][coverage_index]) < float(members_by_item["0"][coverage_index])

    # Coverage and quality are numeric fractions in range.
    for fields in members_by_item.values():
        coverage = float(fields[coverage_index])
        quality = float(fields[quality_index])
        assert 0.0 <= coverage <= 1.0
        assert 0.0 <= quality <= 1.0
