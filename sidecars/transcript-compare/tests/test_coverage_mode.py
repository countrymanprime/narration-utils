"""Tests for the sidecar coverage mode (`core/coverage_mode.py`, `compare.py --coverage`).

docs/utilities/recording-coverage.md, ADR 0127: a hand-made manifest and pre-written words
files give the expected report with no transcription call; a missing words file is transcribed
once and written atomically; cancel mid-run keeps the finished words files and exits with code 2;
progress comes from transcribed seconds (ADR 0015). No Whisper model is needed: the transcriber is
a fake, and the real one is driven with a fake model over a generated WAV file."""

import argparse
import json
import math
import os
import subprocess
import sys
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

CORE = Path(__file__).resolve().parents[1] / "core"
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

import compare
import coverage_mode as mode

TITLE = "Chapter One"
SUBTITLE = "The Pool"
P1 = "Alice was beginning to get very tired of sitting by her sister on the bank."
P2 = "Once or twice she had peeped into the book her sister was reading."
P3 = "So she was considering in her own mind what she would do."
WORD_SECONDS = 0.3


# ---------------------------------------------------------------------------
# fixtures


def _project(tmp_path, subtitle=SUBTITLE):
    """A project folder with a canonical manuscript at the path the host uses."""
    manuscript = tmp_path / "project" / "narration-utils" / "manuscript" / "manuscript.json"
    manuscript.parent.mkdir(parents=True)
    chapter = {"id": "c-0001", "title": TITLE, "contentKind": "narration"}
    if subtitle is not None:
        chapter["subtitle"] = subtitle
    data = {
        "schemaVersion": 1,
        "documentId": "doc-1",
        "chapters": [chapter, {"id": "c-0002", "title": "Chapter Two", "contentKind": "narration"}],
        "paragraphs": [
            {"id": "p-000001", "chapterId": "c-0001", "index": 0, "text": P1},
            {"id": "p-000002", "chapterId": "c-0001", "index": 1, "text": P2},
            {"id": "p-000003", "chapterId": "c-0001", "index": 2, "text": P3},
            {"id": "p-000004", "chapterId": "c-0002", "index": 3, "text": "Down the rabbit hole."},
        ],
    }
    manuscript.write_text(json.dumps(data), encoding="utf-8")
    return manuscript


def _item(index, guid, source="a.wav", start=0.0, length=10.0, words_file=None, muted=False):
    return {
        "index": index,
        "itemGuid": guid,
        "sourceFile": source,
        "startOffset": start,
        "length": length,
        "wordsFile": words_file or f"item-{index}.json",
        "muted": muted,
    }


def _write_manifest(path, items, schema_version=1):
    path.write_text(json.dumps({"schemaVersion": schema_version, "items": items}), encoding="utf-8")
    return path


def _timed(text, start):
    return tuple((word, round(start + n * WORD_SECONDS, 3), round(start + n * WORD_SECONDS + 0.25, 3)) for n, word in enumerate(text.split()))


def _words_file(path, text, source_start, source_end, model="small", language="en"):
    words = mode.ItemWords(_timed(text, source_start), source_start, source_end, model, language, None)
    mode.write_words_file(path, words)
    return words


def _args(tmp_path, manuscript, manifest, **overrides):
    values = {
        "manifest": str(manifest),
        "manuscript": str(manuscript),
        "chapter_id": "c-0001",
        "words_dir": str(tmp_path / "words"),
        "out": str(tmp_path / "out" / "coverage.txt"),
        "progress": str(tmp_path / "progress.txt"),
        "model": "small",
        "model_dir": None,
        "language": None,
        "device": "cpu",
        "max_misread_run": None,
        "min_anchor_run": None,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def _never_transcribe(item, on_seconds):
    raise AssertionError(f"item {item.index} should not have been transcribed")


def _lines(out_path):
    tagged = {}
    for line in Path(out_path).read_text(encoding="utf-8").splitlines():
        tag, payload = line.split("|", 1)
        tagged.setdefault(tag, []).append(json.loads(payload))
    return tagged


class _Recorder:
    """Records progress lines instead of writing the file (the file keeps only the last one)."""

    def __init__(self):
        self.lines = []

    def __call__(self, path, stage, pct, message):
        self.lines.append((stage, int(pct), message))


@pytest.fixture()
def progress(monkeypatch):
    recorder = _Recorder()
    monkeypatch.setattr(compare, "write_progress", recorder)
    return recorder


@pytest.fixture()
def cached_project(tmp_path):
    """Title, subtitle and P1 on item 0; a muted item 1; P2 on item 2; P3 never read."""
    manuscript = _project(tmp_path)
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    _words_file(words_dir / "item-0.json", f"{TITLE} {SUBTITLE} {P1}", 10.0, 20.0)
    _words_file(words_dir / "item-2.json", P2, 0.0, 6.0)
    manifest = _write_manifest(
        tmp_path / "manifest.json",
        [
            _item(2, "{B}", "b.wav", 0.0, 6.0),
            _item(0, "{A}", "a.wav", 10.0, 10.0),
            _item(1, "{M}", "m.wav", 0.0, 4.0, muted=True),
        ],
    )
    return manuscript, manifest


# ---------------------------------------------------------------------------
# the manifest


def test_the_manifest_is_read_in_item_order(tmp_path):
    manifest = _write_manifest(tmp_path / "m.json", [_item(3, "{C}", start=1.5, length=2.25), _item(1, "{A}", muted=True)])

    items = mode.read_manifest(manifest)

    assert [item.index for item in items] == [1, 3]
    assert items[1] == mode.ManifestItem(3, "{C}", "a.wav", 1.5, 2.25, "item-3.json", False)
    assert items[1].end == pytest.approx(3.75)
    assert items[0].muted is True


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda m: m.update(schemaVersion=2), "schema version"),
        (lambda m: m.update(items=[]), "no items"),
        (lambda m: m.update(items="x"), "items"),
        (lambda m: m["items"][0].pop("itemGuid"), "itemGuid"),
        (lambda m: m["items"][0].update(extra=1), "extra"),
        (lambda m: m["items"][0].update(index=True), "index"),
        (lambda m: m["items"][0].update(index=-1), "index"),
        (lambda m: m["items"].append(_item(0, "{Z}")), "twice"),
        (lambda m: m["items"][0].update(itemGuid=""), "itemGuid"),
        (lambda m: m["items"][0].update(sourceFile=""), "sourceFile"),
        (lambda m: m["items"][0].update(startOffset=-0.5), "startOffset"),
        (lambda m: m["items"][0].update(startOffset=math.inf), "startOffset"),
        (lambda m: m["items"][0].update(startOffset="1"), "startOffset"),
        (lambda m: m["items"][0].update(length=0), "length"),
        (lambda m: m["items"][0].update(muted="no"), "muted"),
        (lambda m: m["items"][0].update(wordsFile="../escape.json"), "wordsFile"),
        (lambda m: m["items"][0].update(wordsFile="sub/name.json"), "wordsFile"),
        (lambda m: m["items"][0].update(wordsFile="sub\\name.json"), "wordsFile"),
        (lambda m: m["items"][0].update(wordsFile=".hidden"), "wordsFile"),
        (lambda m: m["items"][0].update(wordsFile="C:name.json"), "wordsFile"),
        (lambda m: m["items"][0].update(wordsFile="x" * 201), "wordsFile"),
    ],
)
def test_a_malformed_manifest_is_refused_before_anything_is_read(tmp_path, change, message):
    manifest = {"schemaVersion": 1, "items": [_item(0, "{A}")]}
    change(manifest)
    path = tmp_path / "m.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(mode.ManifestError, match=message):
        mode.read_manifest(path)


@pytest.mark.parametrize("content", ["not json", "[1, 2]", '{"schemaVersion": 1, "items": [3]}'])
def test_a_manifest_that_is_not_the_right_json_is_refused(tmp_path, content):
    path = tmp_path / "m.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(mode.ManifestError):
        mode.read_manifest(path)


def test_a_missing_manifest_is_refused(tmp_path):
    with pytest.raises(mode.ManifestError, match="could not be read"):
        mode.read_manifest(tmp_path / "absent.json")


# ---------------------------------------------------------------------------
# words files


def test_a_words_file_round_trips_and_leaves_no_temporary_file(tmp_path):
    path = tmp_path / "w" / "item.json"
    written = _words_file(path, "one two three", 5.0, 9.0, language=None)

    assert mode.read_words_file(path) == written
    assert os.listdir(path.parent) == ["item.json"]


@pytest.mark.parametrize(
    "content",
    [
        "{broken",
        '{"schemaVersion": 2, "sourceStart": 0, "sourceEnd": 1, "words": [], "transcription": {}}',
        '{"schemaVersion": 1, "sourceStart": 0, "sourceEnd": 1, "words": [["a", 0]], "transcription": {"model": "small"}}',
        '{"schemaVersion": 1, "sourceStart": 0, "sourceEnd": 1, "words": [], "transcription": {"model": 3}}',
        '{"schemaVersion": 1, "sourceStart": "0", "sourceEnd": 1, "words": [], "transcription": {"model": "small"}}',
        "[]",
    ],
)
def test_an_unreadable_words_file_is_a_miss_not_an_error(tmp_path, content):
    path = tmp_path / "item.json"
    path.write_text(content, encoding="utf-8")

    assert mode.read_words_file(path) is None


def test_an_absent_words_file_is_a_miss(tmp_path):
    assert mode.read_words_file(tmp_path / "absent.json") is None


def test_words_cover_an_item_only_when_their_range_contains_its_played_range():
    words = mode.ItemWords((), 10.0, 20.0, "small", "en", None)
    item = mode.ManifestItem(0, "{A}", "a.wav", 12.0, 5.0, "w.json", False)

    assert mode.covers(words, item)
    assert not mode.covers(words, mode.ManifestItem(0, "{A}", "a.wav", 8.0, 5.0, "w.json", False))
    assert not mode.covers(words, mode.ManifestItem(0, "{A}", "a.wav", 16.0, 5.0, "w.json", False))


def test_only_the_words_inside_the_played_range_are_used():
    words = mode.ItemWords((("before", 9.0, 9.5), ("in", 12.0, 12.4), ("edge", 16.6, 17.2), ("after", 18.0, 18.5)), 0.0, 30.0, "small", "en", None)
    item = mode.ManifestItem(0, "{A}", "a.wav", 11.0, 6.0, "w.json", False)

    assert [word for word, _s, _e in mode.played_words(words, item)] == ["in", "edge"]


# ---------------------------------------------------------------------------
# the run


def test_cached_words_give_the_report_with_no_transcription(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    args = _args(tmp_path, manuscript, manifest)

    mode.run(args, compare, transcriber=_never_transcribe)

    lines = _lines(args.out)
    (summary,) = lines["COVERAGE"]
    p3_tokens = len(P3.split())
    body = len(P1.split()) + len(P2.split()) + p3_tokens
    assert summary["schemaVersion"] == 1
    assert summary["chapterId"] == "c-0001"
    assert (summary["bodyTokens"], summary["presentTokens"], summary["missingTokens"]) == (body, body - p3_tokens, p3_tokens)
    assert summary["extraTokens"] == 0  # the spoken title and subtitle are not extra (Q11)
    assert summary["longestMissingRun"] == p3_tokens
    assert summary["alignment"] == {"maxMisreadRun": 8, "minAnchorRun": 3}
    assert summary["items"] == {"analyzed": 2, "muted": 1, "playedSeconds": 16.0, "transcribed": 0, "reused": 2}
    assert summary["analysis"] == {"model": "small", "language": None, "equivalencesHash": None}
    assert "verdict" not in summary and "textComplete" not in summary  # thresholds are applied on read, in Go

    assert lines["COVERAGE_ITEM"] == [
        {"index": 0, "itemGuid": "{A}", "status": "analyzed", "words": "reused", "playedSeconds": 10.0, "wordCount": 19, "model": "small", "language": "en"},
        {"index": 1, "itemGuid": "{M}", "status": "muted", "words": None, "playedSeconds": 4.0, "wordCount": 0, "model": None, "language": None},
        {"index": 2, "itemGuid": "{B}", "status": "analyzed", "words": "reused", "playedSeconds": 6.0, "wordCount": 13, "model": "small", "language": "en"},
    ]
    assert lines["COVERAGE_PARAGRAPH"] == [
        {"id": "p-000001", "tokens": len(P1.split()), "present": len(P1.split()), "longestMissingRun": 0},
        {"id": "p-000002", "tokens": len(P2.split()), "present": len(P2.split()), "longestMissingRun": 0},
        {"id": "p-000003", "tokens": p3_tokens, "present": 0, "longestMissingRun": p3_tokens},
    ]
    (region,) = lines["COVERAGE_REGION"]
    last_p2_word_end = round((len(P2.split()) - 1) * WORD_SECONDS + 0.25, 3)
    assert region == {
        "kind": "tail",
        "paragraphIds": ["p-000003"],
        "tokenCount": p3_tokens,
        "firstWord": "So",
        "lastWord": "do.",
        "position": {"itemIndex": 2, "itemGuid": "{B}", "sourceTime": last_p2_word_end},
        # A tail is bounded by the end of the last matched word and runs to the end of the chapter's audio.
        "before": {"itemIndex": 2, "itemGuid": "{B}", "sourceTime": last_p2_word_end},
        "after": None,
    }
    assert progress.lines[0][0] == "START"
    assert [stage for stage, _pct, _msg in progress.lines[-3:]] == ["ALIGN", "WRITE", "DONE"]
    assert progress.lines[-1][1] == 100


def test_a_skip_names_the_item_and_source_time_where_the_text_is_missing(tmp_path, progress):
    manuscript = _project(tmp_path)
    words_dir = tmp_path / "words"
    _words_file(words_dir / "item-0.json", P1, 30.0, 40.0)
    _words_file(words_dir / "item-1.json", P3, 2.0, 8.0)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{A}", start=30.0, length=10.0), _item(1, "{B}", start=2.0, length=6.0)])
    args = _args(tmp_path, manuscript, manifest)

    mode.run(args, compare, transcriber=_never_transcribe)

    (region,) = _lines(args.out)["COVERAGE_REGION"]
    assert (region["kind"], region["paragraphIds"], region["firstWord"], region["lastWord"]) == ("skip", ["p-000002"], "Once", "reading.")
    # The skipped text sits where the next read word ("So", the first word of item 1) starts.
    assert region["position"] == {"itemIndex": 1, "itemGuid": "{B}", "sourceTime": 2.0}
    # A region across two items: it starts after "bank." ends in item 0 and ends where "So" starts in item 1.
    bank_end = round(30.0 + (len(P1.split()) - 1) * WORD_SECONDS + 0.25, 3)
    assert region["before"] == {"itemIndex": 0, "itemGuid": "{A}", "sourceTime": bank_end}
    assert region["after"] == {"itemIndex": 1, "itemGuid": "{B}", "sourceTime": 2.0}


def test_a_skip_inside_one_item_is_bounded_by_the_words_read_on_either_side(tmp_path, progress):
    manuscript = _project(tmp_path)
    _words_file(tmp_path / "words" / "item-0.json", f"{P1} {P3}", 5.0, 20.0)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{A}", start=5.0, length=15.0)])
    args = _args(tmp_path, manuscript, manifest)

    mode.run(args, compare, transcriber=_never_transcribe)

    (region,) = _lines(args.out)["COVERAGE_REGION"]
    p1 = len(P1.split())
    assert (region["kind"], region["paragraphIds"]) == ("skip", ["p-000002"])
    # "before" is where "bank." ends, "after" where "So" starts: source seconds of item 0.
    assert region["before"] == {"itemIndex": 0, "itemGuid": "{A}", "sourceTime": round(5.0 + (p1 - 1) * WORD_SECONDS + 0.25, 3)}
    assert region["after"] == {"itemIndex": 0, "itemGuid": "{A}", "sourceTime": round(5.0 + p1 * WORD_SECONDS, 3)}


def test_a_head_has_no_bound_before_it_even_after_the_title_was_read(tmp_path, progress):
    manuscript = _project(tmp_path)
    _words_file(tmp_path / "words" / "item-0.json", f"{TITLE} {SUBTITLE} {P2} {P3}", 0.0, 12.0)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{A}", start=0.0, length=12.0)])
    args = _args(tmp_path, manuscript, manifest)

    mode.run(args, compare, transcriber=_never_transcribe)

    (region,) = _lines(args.out)["COVERAGE_REGION"]
    heading = len(f"{TITLE} {SUBTITLE}".split())
    assert (region["kind"], region["before"]) == ("head", None)
    assert region["after"] == {"itemIndex": 0, "itemGuid": "{A}", "sourceTime": round(heading * WORD_SECONDS, 3)}


def test_a_head_with_no_audio_at_all_has_no_position(tmp_path, progress):
    manuscript = _project(tmp_path)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{M}", muted=True)])
    args = _args(tmp_path, manuscript, manifest)

    mode.run(args, compare, transcriber=_never_transcribe)

    lines = _lines(args.out)
    assert lines["COVERAGE"][0]["presentTokens"] == 0
    assert lines["COVERAGE"][0]["items"]["analyzed"] == 0
    regions = [(region["kind"], region["position"], region["before"], region["after"]) for region in lines["COVERAGE_REGION"]]
    assert regions == [("head", None, None, None)]


def test_a_missing_words_file_is_transcribed_once_and_written(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    (tmp_path / "words" / "item-2.json").unlink()
    calls = []

    def transcriber(item, on_seconds):
        calls.append(item.index)
        on_seconds(3.0)
        on_seconds(9.0)  # past the played length: clamped, so progress cannot pass the item's share
        return mode.ItemWords(_timed(P2, item.start_offset), item.start_offset, item.end, "small", "en", None)

    args = _args(tmp_path, manuscript, manifest)
    mode.run(args, compare, transcriber=transcriber)

    assert calls == [2]
    assert mode.read_words_file(tmp_path / "words" / "item-2.json").words == _timed(P2, 0.0)
    summary = _lines(args.out)["COVERAGE"][0]
    assert (summary["items"]["transcribed"], summary["items"]["reused"]) == (1, 1)
    items = {line["index"]: line["words"] for line in _lines(args.out)["COVERAGE_ITEM"]}
    assert items == {0: "reused", 1: None, 2: "transcribed"}
    transcribe_pcts = [pct for stage, pct, _msg in progress.lines if stage == "TRANSCRIBE"]
    assert transcribe_pcts == sorted(transcribe_pcts)
    assert transcribe_pcts[-1] == mode.TRANSCRIBE_END_PCT
    assert any("00:03 / 00:06" in message for stage, _pct, message in progress.lines if stage == "TRANSCRIBE")
    assert [pct for _stage, pct, _msg in progress.lines] == sorted(pct for _stage, pct, _msg in progress.lines)


def test_progress_is_weighted_by_the_seconds_each_item_plays(tmp_path, progress):
    manuscript = _project(tmp_path)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{A}", length=30.0), _item(1, "{B}", length=10.0)])

    def transcriber(item, on_seconds):
        on_seconds(item.length)
        text = P1 if item.index == 0 else P2
        return mode.ItemWords(_timed(text, 0.0), 0.0, item.length, "small", "en", None)

    mode.run(_args(tmp_path, manuscript, manifest), compare, transcriber=transcriber)

    after_first = [pct for stage, pct, message in progress.lines if stage == "TRANSCRIBE" and message.startswith("Transcribing item 1/2")]
    span = mode.TRANSCRIBE_END_PCT - mode.TRANSCRIBE_START_PCT
    assert after_first[-1] == mode.TRANSCRIBE_START_PCT + int(span * 30 / 40)


def test_words_covering_a_wider_range_are_sliced_and_a_narrower_range_is_transcribed_again(tmp_path, progress):
    manuscript = _project(tmp_path)
    words_dir = tmp_path / "words"
    # Item 0 was trimmed after its words were cached: the cache still covers it.
    _words_file(words_dir / "item-0.json", f"{P1} {P2}", 0.0, 60.0)
    # Item 1 was lengthened: its cached words cover only part of what now plays.
    _words_file(words_dir / "item-1.json", "So she was", 0.0, 2.0)
    manifest = _write_manifest(
        tmp_path / "m.json",
        [_item(0, "{A}", start=0.0, length=len(P1.split()) * WORD_SECONDS), _item(1, "{B}", start=0.0, length=6.0)],
    )
    calls = []

    def transcriber(item, on_seconds):
        calls.append(item.index)
        return mode.ItemWords(_timed(P3, 0.0), 0.0, 6.0, "small", "en", None)

    args = _args(tmp_path, manuscript, manifest)
    mode.run(args, compare, transcriber=transcriber)

    assert calls == [1]
    lines = _lines(args.out)
    assert [line["wordCount"] for line in lines["COVERAGE_ITEM"]] == [len(P1.split()), len(P3.split())]
    assert [region["kind"] for region in lines["COVERAGE_REGION"]] == ["skip"]


def test_two_items_sharing_a_words_file_are_transcribed_once(tmp_path, progress):
    manuscript = _project(tmp_path)
    manifest = _write_manifest(
        tmp_path / "m.json",
        [_item(0, "{A}", length=6.0, words_file="same.json"), _item(1, "{B}", length=6.0, words_file="same.json")],
    )
    calls = []

    def transcriber(item, on_seconds):
        calls.append(item.index)
        return mode.ItemWords(_timed(P1, 0.0), 0.0, 6.0, "small", "en", None)

    args = _args(tmp_path, manuscript, manifest)
    mode.run(args, compare, transcriber=transcriber)

    assert calls == [0]
    assert [line["words"] for line in _lines(args.out)["COVERAGE_ITEM"]] == ["transcribed", "reused"]


def test_cancel_mid_run_keeps_the_finished_words_files_and_writes_no_results(tmp_path, progress):
    manuscript = _project(tmp_path)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{A}", length=6.0), _item(1, "{B}", length=6.0)])
    args = _args(tmp_path, manuscript, manifest)
    calls = []

    def transcriber(item, on_seconds):
        calls.append(item.index)
        if item.index == 1:
            Path(args.progress + ".cancel").write_text("", encoding="utf-8")
            on_seconds(1.0)
        return mode.ItemWords(_timed(P1, 0.0), 0.0, 6.0, "small", "en", None)

    with pytest.raises(compare.Cancelled):
        mode.run(args, compare, transcriber=transcriber)

    assert calls == [0, 1]
    assert mode.read_words_file(tmp_path / "words" / "item-0.json") is not None
    assert not (tmp_path / "words" / "item-1.json").exists()
    assert not Path(args.out).exists()


def test_a_stale_results_file_is_removed_before_the_run(tmp_path, progress):
    manuscript = _project(tmp_path)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{A}")])
    args = _args(tmp_path, manuscript, manifest, chapter_id="c-9999")
    Path(args.out).parent.mkdir(parents=True)
    Path(args.out).write_text("COVERAGE|{}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="c-9999"):
        mode.run(args, compare, transcriber=_never_transcribe)

    assert not Path(args.out).exists()


def test_invalid_alignment_parameters_are_refused(tmp_path, progress):
    manuscript = _project(tmp_path)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{A}")])

    with pytest.raises(ValueError, match="min_anchor_run"):
        mode.run(_args(tmp_path, manuscript, manifest, min_anchor_run=0), compare, transcriber=_never_transcribe)


def test_alignment_parameters_are_used_and_reported(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    args = _args(tmp_path, manuscript, manifest, max_misread_run=2, min_anchor_run=4)

    mode.run(args, compare, transcriber=_never_transcribe)

    assert _lines(args.out)["COVERAGE"][0]["alignment"] == {"maxMisreadRun": 2, "minAnchorRun": 4}


def test_a_subtitle_that_is_not_in_the_manuscript_is_extra_when_read(tmp_path, cached_project, progress):
    _manuscript, manifest = cached_project
    _project(tmp_path / "other", subtitle=None)
    args = _args(tmp_path, tmp_path / "other" / "project" / "narration-utils" / "manuscript" / "manuscript.json", manifest)

    mode.run(args, compare, transcriber=_never_transcribe)

    assert _lines(args.out)["COVERAGE"][0]["extraTokens"] == len(SUBTITLE.split())


def test_project_equivalences_are_used_and_their_hash_reported(tmp_path, progress):
    manuscript = _project(tmp_path)
    data_dir = tmp_path / "project" / "TranscriptCompare"
    data_dir.mkdir()
    (data_dir / "equivalences.csv").write_text("Alice, Alyce\n", encoding="utf-8")
    words_dir = tmp_path / "words"
    _words_file(words_dir / "item-0.json", f"{P1.replace('Alice', 'Alyce')} {P2} {P3}", 0.0, 20.0)
    manifest = _write_manifest(tmp_path / "m.json", [_item(0, "{A}", length=20.0)])
    args = _args(tmp_path, manuscript, manifest)

    mode.run(args, compare, transcriber=_never_transcribe)

    summary = _lines(args.out)["COVERAGE"][0]
    assert summary["missingTokens"] == 0
    assert summary["extraTokens"] == 0
    assert summary["analysis"]["equivalencesHash"].startswith("sha256:")


def test_a_run_with_every_item_cached_never_loads_a_model(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    data_dir = tmp_path / "project" / "TranscriptCompare"
    data_dir.mkdir()
    (data_dir / "vocabulary_hints.txt").write_text("Alyce\n", encoding="utf-8")
    args = _args(tmp_path, manuscript, manifest)

    mode.run(args, compare)  # the real transcriber: loading a model here would fail, there is none

    assert _lines(args.out)["COVERAGE"][0]["items"]["reused"] == 2
    assert not any(stage == "LOAD" for stage, _pct, _msg in progress.lines)


def test_the_same_inputs_give_the_same_bytes(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    first = _args(tmp_path, manuscript, manifest)
    second = _args(tmp_path, manuscript, manifest, out=str(tmp_path / "out" / "again.txt"))

    mode.run(first, compare, transcriber=_never_transcribe)
    mode.run(second, compare, transcriber=_never_transcribe)

    assert Path(first.out).read_bytes() == Path(second.out).read_bytes()


# ---------------------------------------------------------------------------
# the Whisper transcriber, with a fake model


def _wav(path, seconds, rate=16000):
    samples = (np.sin(np.linspace(0, 440 * 2 * np.pi * seconds, int(rate * seconds))) * 8000).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(samples.tobytes())
    return path


class _FakeModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, audio, **options):
        self.calls.append((len(audio), options))
        word = SimpleNamespace
        segments = [
            SimpleNamespace(end=1.0, words=[word(word=" So", start=0.1, end=0.4), word(word=" she", start=0.5, end=0.9)]),
            SimpleNamespace(end=2.0, words=None),
        ]
        return iter(segments), SimpleNamespace(language="en")


def test_the_whisper_transcriber_decodes_the_played_range_and_returns_source_times(tmp_path):
    source = _wav(tmp_path / "take.wav", 4.0)
    model = _FakeModel()
    loads = []

    def factory():
        loads.append(1)
        return model

    transcriber = mode.WhisperTranscriber(compare, model_size="small", language=None, hotwords="Alyce", model_factory=factory)
    item = mode.ManifestItem(0, "{A}", str(source), 1.0, 2.0, "w.json", False)
    seconds = []

    words = transcriber(item, seconds.append)
    again = transcriber(item, seconds.append)

    assert loads == [1]  # the model is loaded once per run, not once per item
    assert words == again
    assert words.words == (("So", 1.1, 1.4), ("she", 1.5, 1.9))
    assert (words.source_start, words.source_end, words.model, words.language) == (1.0, 3.0, "small", "en")
    assert words.hotwords_hash == mode.text_hash("Alyce")
    assert seconds == [1.0, 2.0, 1.0, 2.0]
    samples, options = model.calls[0]
    assert samples == 2 * compare.SAMPLE_RATE
    assert options == {"language": None, "word_timestamps": True, "vad_filter": True, "hotwords": "Alyce"}


def test_the_whisper_transcriber_stops_when_progress_raises(tmp_path):
    source = _wav(tmp_path / "take.wav", 3.0)
    transcriber = mode.WhisperTranscriber(compare, model_size="small", language="en", hotwords=None, model_factory=_FakeModel)
    item = mode.ManifestItem(0, "{A}", str(source), 0.0, 2.0, "w.json", False)

    def cancel(_seconds):
        raise compare.Cancelled()

    with pytest.raises(compare.Cancelled):
        transcriber(item, cancel)


# ---------------------------------------------------------------------------
# the command line (compare.py --coverage), exit codes 0, 1 and 2


def _cli(tmp_path, manuscript, manifest, *extra):
    args = _args(tmp_path, manuscript, manifest)
    command = [
        sys.executable,
        str(CORE / "compare.py"),
        "--coverage",
        "--manifest",
        args.manifest,
        "--manuscript",
        args.manuscript,
        "--chapter-id",
        args.chapter_id,
        "--words-dir",
        args.words_dir,
        "--out",
        args.out,
        "--progress",
        args.progress,
        *extra,
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
    return completed, args


def test_the_cli_writes_the_report_and_exits_0(tmp_path, cached_project):
    manuscript, manifest = cached_project

    completed, args = _cli(tmp_path, manuscript, manifest, "--min-anchor-run", "3")

    assert completed.returncode == 0, completed.stderr
    assert set(_lines(args.out)) == {"COVERAGE", "COVERAGE_ITEM", "COVERAGE_PARAGRAPH", "COVERAGE_REGION", "COVERAGE_TOKEN"}
    assert Path(args.progress).read_text(encoding="utf-8").startswith("DONE|100|")


def test_the_cli_exits_2_on_cancel_and_1_on_a_bad_manifest(tmp_path, cached_project):
    manuscript, manifest = cached_project
    Path(tmp_path / "progress.txt.cancel").write_text("", encoding="utf-8")

    cancelled, args = _cli(tmp_path, manuscript, manifest)

    assert cancelled.returncode == 2
    assert Path(args.progress).read_text(encoding="utf-8").startswith("CANCELLED|")
    assert not Path(args.out).exists()

    manifest.write_text('{"schemaVersion": 1, "items": [{"index": "0"}]}', encoding="utf-8")
    failed, args = _cli(tmp_path, manuscript, manifest)

    assert failed.returncode == 1
    assert Path(args.progress).read_text(encoding="utf-8").startswith("ERROR|0|")
    assert not Path(args.out).exists()


@pytest.mark.parametrize(
    ("extra", "message"),
    [(("--chunk-seconds", "30"), "--chunk-seconds"), (("--find-repeats",), "--find-repeats")],
)
def test_the_cli_refuses_options_the_coverage_mode_does_not_take(tmp_path, cached_project, extra, message):
    manuscript, manifest = cached_project

    completed, _args_used = _cli(tmp_path, manuscript, manifest, *extra)

    assert completed.returncode == 2
    assert message in completed.stderr


def test_the_cli_names_the_arguments_the_coverage_mode_needs(tmp_path):
    completed = subprocess.run(
        [sys.executable, str(CORE / "compare.py"), "--coverage", "--manuscript", str(tmp_path / "m.json")],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert completed.returncode == 2
    assert "--manifest, --chapter-id, --words-dir, --out required with --coverage" in completed.stderr
