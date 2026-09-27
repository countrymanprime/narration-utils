"""Tests for the sidecar's windows-only recheck mode (model cascade Phase 3, PRD
docs/prds/recording-check-model-cascade.prd.md): `compare.py --coverage --recheck <windows.json>`
transcribes only the given windows with `--model`, one model load for the run, and splices the new
words into each affected words file, recording per-range model provenance in a new `spans` list.
It touches no manifest, chapter or timeline, and writes no results file. A plain check (not the
windows path) also refuses to reuse a words file another model made (the Should item)."""

import json
import subprocess
import sys

import pytest
import test_coverage_mode as base
from test_coverage_mode import (
    P1,
    P2,
    SUBTITLE,
    TITLE,
    _args,
    _lines,
    _never_transcribe,
    _timed,
    _words_file,
    compare,
    mode,
)

cached_project = base.cached_project
progress = base.progress


def _window(item_index=0, guid="{A}", source="a.wav", words_file="item-0.json", start=10.0, end=20.0):
    return {"itemIndex": item_index, "itemGuid": guid, "sourceFile": source, "wordsFile": words_file, "start": start, "end": end}


def _write_windows(path, windows, schema_version=1):
    path.write_text(json.dumps({"schemaVersion": schema_version, "windows": windows}), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# the windows file


def test_windows_are_read_in_file_order(tmp_path):
    path = _write_windows(tmp_path / "w.json", [_window(item_index=1, words_file="item-1.json"), _window(item_index=0)])

    windows = mode.read_windows(path)

    assert [w.item_index for w in windows] == [1, 0]
    assert windows[0] == mode.Window(1, "{A}", "a.wav", "item-1.json", 10.0, 20.0)
    assert windows[0].length == pytest.approx(10.0)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda w: w.update(schemaVersion=2), "schema version"),
        (lambda w: w.update(windows=[]), "no windows"),
        (lambda w: w.update(windows="x"), "windows"),
        (lambda w: w["windows"][0].pop("itemGuid"), "itemGuid"),
        (lambda w: w["windows"][0].update(extra=1), "extra"),
        (lambda w: w["windows"][0].update(itemIndex=True), "itemIndex"),
        (lambda w: w["windows"][0].update(itemIndex=-1), "itemIndex"),
        (lambda w: w["windows"][0].update(itemGuid=""), "itemGuid"),
        (lambda w: w["windows"][0].update(sourceFile=""), "sourceFile"),
        (lambda w: w["windows"][0].update(wordsFile="../escape.json"), "wordsFile"),
        (lambda w: w["windows"][0].update(wordsFile="sub/name.json"), "wordsFile"),
        (lambda w: w["windows"][0].update(start=-1), "start"),
        (lambda w: w["windows"][0].update(start="1"), "start"),
        (lambda w: w["windows"][0].update(end=5), "end"),  # the default window starts at 10.0
    ],
)
def test_a_malformed_windows_file_is_refused_before_anything_is_read(tmp_path, change, message):
    data = {"schemaVersion": 1, "windows": [_window()]}
    change(data)
    path = tmp_path / "w.json"
    path.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(mode.WindowsError, match=message):
        mode.read_windows(path)


@pytest.mark.parametrize("content", ["not json", "[1, 2]"])
def test_a_windows_file_that_is_not_the_right_json_is_refused(tmp_path, content):
    path = tmp_path / "w.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(mode.WindowsError):
        mode.read_windows(path)


def test_a_missing_windows_file_is_refused(tmp_path):
    with pytest.raises(mode.WindowsError, match="could not be read"):
        mode.read_windows(tmp_path / "absent.json")


def test_a_windows_entry_that_is_not_an_object_is_refused(tmp_path):
    path = tmp_path / "w.json"
    path.write_text(json.dumps({"schemaVersion": 1, "windows": [3]}), encoding="utf-8")

    with pytest.raises(mode.WindowsError, match="is not an object"):
        mode.read_windows(path)


# ---------------------------------------------------------------------------
# splicing a window into a words file


def test_splicing_a_window_replaces_only_the_words_inside_it_and_keeps_the_rest():
    existing = mode.ItemWords((("keep", 0.0, 0.4), ("gone", 5.0, 5.4), ("also-gone", 6.0, 6.4), ("keep2", 12.0, 12.4)), 0.0, 15.0, "tiny", "en", None)
    window = mode.Window(0, "{A}", "a.wav", "w.json", 4.0, 8.0)

    spliced = mode.splice_window(existing, window, (("new", 4.5, 4.9), ("words", 5.5, 5.9)), "large-v3-turbo")

    assert [w[0] for w in spliced.words] == ["keep", "new", "words", "keep2"]
    assert spliced.model == "tiny"  # unchanged, for compatibility; spans carry the recheck model
    assert (spliced.source_start, spliced.source_end) == (0.0, 15.0)
    assert spliced.spans == (mode.Span(0.0, 4.0, "tiny"), mode.Span(4.0, 8.0, "large-v3-turbo"), mode.Span(8.0, 15.0, "tiny"))


def test_a_new_word_touching_the_windows_edge_is_dropped():
    existing = mode.ItemWords((), 0.0, 10.0, "tiny", "en", None)
    window = mode.Window(0, "{A}", "a.wav", "w.json", 4.0, 8.0)

    spliced = mode.splice_window(existing, window, (("touches-start", 4.0, 4.4), ("inside", 5.0, 5.4), ("touches-end", 7.6, 8.0)), "large-v3-turbo")

    assert [w[0] for w in spliced.words] == ["inside"]


def test_an_old_word_survives_when_its_midpoint_is_outside_the_window_even_if_it_overlaps_the_edge():
    existing = mode.ItemWords((("straddling", 3.0, 4.4),), 0.0, 10.0, "tiny", "en", None)  # midpoint 3.7, outside [4.0, 8.0]
    window = mode.Window(0, "{A}", "a.wav", "w.json", 4.0, 8.0)

    spliced = mode.splice_window(existing, window, (), "large-v3-turbo")

    assert [w[0] for w in spliced.words] == ["straddling"]


def test_a_silent_window_removes_the_old_words_and_adds_none():
    existing = mode.ItemWords((("noise", 5.0, 5.4),), 0.0, 10.0, "tiny", "en", None)
    window = mode.Window(0, "{A}", "a.wav", "w.json", 4.0, 8.0)

    spliced = mode.splice_window(existing, window, (), "large-v3-turbo")

    assert spliced.words == ()
    assert spliced.spans == (mode.Span(0.0, 4.0, "tiny"), mode.Span(4.0, 8.0, "large-v3-turbo"), mode.Span(8.0, 10.0, "tiny"))


def test_two_overlapping_windows_leave_the_later_ones_words_and_model_in_the_overlap():
    existing = mode.ItemWords((("old", 5.0, 5.4),), 0.0, 20.0, "tiny", "en", None)
    first = mode.Window(0, "{A}", "a.wav", "w.json", 0.0, 10.0)
    second = mode.Window(0, "{A}", "a.wav", "w.json", 6.0, 16.0)

    after_first = mode.splice_window(existing, first, (("first", 2.0, 2.4),), "large-v3-turbo")
    after_second = mode.splice_window(after_first, second, (("second", 8.0, 8.4),), "medium")

    assert [w[0] for w in after_second.words] == ["first", "second"]
    assert after_second.spans == (mode.Span(0.0, 6.0, "large-v3-turbo"), mode.Span(6.0, 16.0, "medium"), mode.Span(16.0, 20.0, "tiny"))


def test_a_plain_words_file_never_gains_a_spans_key(tmp_path):
    path = tmp_path / "item.json"
    words = mode.ItemWords((), 0.0, 5.0, "small", "en", None)

    mode.write_words_file(path, words)

    raw = json.loads(path.read_text(encoding="utf-8"))
    assert "spans" not in raw
    assert mode.read_words_file(path).spans == ()
    assert mode.read_words_file(path).spans_or_default() == (mode.Span(0.0, 5.0, "small"),)


@pytest.mark.parametrize(
    "spans",
    [
        "not a list",
        [{"start": 0.0, "model": "small"}],  # missing end
        [{"start": 0.0, "end": 1.0, "model": 3}],  # model not a string
        [{"start": "0", "end": 1.0, "model": "small"}],  # start not a number
    ],
)
def test_a_words_file_with_a_malformed_spans_list_is_a_miss_not_an_error(tmp_path, spans):
    path = tmp_path / "item.json"
    payload = {
        "schemaVersion": 1,
        "sourceStart": 0.0,
        "sourceEnd": 5.0,
        "words": [],
        "transcription": {"model": "small"},
        "spans": spans,
    }
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert mode.read_words_file(path) is None


def test_a_spliced_words_file_round_trips_its_spans(tmp_path):
    path = tmp_path / "item.json"
    original = mode.ItemWords(_timed("a b c", 0.0), 0.0, 10.0, "tiny", "en", None)
    window = mode.Window(0, "{A}", "a.wav", "item.json", 3.0, 7.0)
    spliced = mode.splice_window(original, window, (("new", 4.0, 4.4),), "large-v3-turbo")

    mode.write_words_file(path, spliced)
    read_back = mode.read_words_file(path)

    assert read_back == spliced
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["spans"] == [
        {"start": 0.0, "end": 3.0, "model": "tiny"},
        {"start": 3.0, "end": 7.0, "model": "large-v3-turbo"},
        {"start": 7.0, "end": 10.0, "model": "tiny"},
    ]


# ---------------------------------------------------------------------------
# run_recheck


def test_run_recheck_splices_every_affected_words_file_and_writes_no_report(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    words_dir = tmp_path / "words"
    windows = _write_windows(
        tmp_path / "windows.json",
        [
            _window(item_index=0, guid="{A}", source="a.wav", words_file="item-0.json", start=10.0, end=20.0),
            _window(item_index=2, guid="{B}", source="b.wav", words_file="item-2.json", start=0.0, end=6.0),
        ],
    )
    calls = []

    def transcriber(item, on_seconds):
        calls.append((item.index, item.start_offset, item.length))
        on_seconds(item.length)
        text = P1 if item.index == 0 else P2
        return mode.ItemWords(_timed(text, item.start_offset), item.start_offset, item.end, "large-v3-turbo", "en", None)

    args = _args(tmp_path, manuscript, manifest, recheck=str(windows), model="large-v3-turbo")

    mode.run_recheck(args, compare, transcriber=transcriber)

    assert calls == [(0, 10.0, 10.0), (2, 0.0, 6.0)]
    assert not (tmp_path / "out").exists()
    item0 = mode.read_words_file(words_dir / "item-0.json")
    item2 = mode.read_words_file(words_dir / "item-2.json")
    assert item0.model == "small" and item0.spans == (mode.Span(10.0, 20.0, "large-v3-turbo"),)
    assert item2.model == "small" and item2.spans == (mode.Span(0.0, 6.0, "large-v3-turbo"),)
    assert progress.lines[0][0] == "START"
    assert progress.lines[-1] == ("DONE", 100, "Finished")


def test_run_recheck_refuses_before_transcribing_when_a_named_words_file_has_nothing_cached(tmp_path, progress):
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    windows = _write_windows(tmp_path / "windows.json", [_window(words_file="absent.json")])
    args = _args(tmp_path, tmp_path / "m.json", tmp_path / "man.json", recheck=str(windows), words_dir=str(words_dir))

    with pytest.raises(mode.WindowsError, match="absent.json"):
        mode.run_recheck(args, compare, transcriber=_never_transcribe)


def test_run_recheck_applies_multiple_windows_to_the_same_words_file_in_order(tmp_path, progress):
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    _words_file(words_dir / "item-0.json", f"{P1} {P2}", 0.0, 40.0)
    windows = _write_windows(
        tmp_path / "windows.json",
        [_window(item_index=0, words_file="item-0.json", start=0.0, end=15.0), _window(item_index=0, words_file="item-0.json", start=20.0, end=35.0)],
    )

    def transcriber(item, on_seconds):
        return mode.ItemWords(_timed("re checked words", item.start_offset), item.start_offset, item.end, "large-v3-turbo", "en", None)

    args = _args(tmp_path, tmp_path / "m.json", tmp_path / "man.json", recheck=str(windows), words_dir=str(words_dir), model="large-v3-turbo")

    mode.run_recheck(args, compare, transcriber=transcriber)

    spliced = mode.read_words_file(words_dir / "item-0.json")
    # The very first word of each window's own transcription starts exactly at the window's edge
    # (this fake transcriber's words start at the item's own start_offset) and is dropped; "checked"
    # is safely interior to both windows.
    assert sum(1 for w in spliced.words if w[0] == "checked") == 2
    assert spliced.spans == (
        mode.Span(0.0, 15.0, "large-v3-turbo"),
        mode.Span(15.0, 20.0, "small"),
        mode.Span(20.0, 35.0, "large-v3-turbo"),
        mode.Span(35.0, 40.0, "small"),
    )


def test_run_recheck_loads_the_model_once_for_every_window(tmp_path, progress):
    source = base._wav(tmp_path / "take.wav", 4.0)
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    _words_file(words_dir / "item-0.json", "before after", 0.0, 4.0)
    windows = _write_windows(
        tmp_path / "windows.json",
        [
            _window(item_index=0, source=str(source), words_file="item-0.json", start=0.5, end=1.5),
            _window(item_index=0, source=str(source), words_file="item-0.json", start=2.5, end=3.5),
        ],
    )
    model = base._FakeModel()
    loads = []

    def factory():
        loads.append(1)
        return model

    transcriber = mode.WhisperTranscriber(compare, model_size="large-v3-turbo", language=None, hotwords=None, model_factory=factory)
    args = _args(tmp_path, tmp_path / "m.json", tmp_path / "man.json", recheck=str(windows), words_dir=str(words_dir), model="large-v3-turbo")

    mode.run_recheck(args, compare, transcriber=transcriber)

    assert loads == [1]  # one model load for the whole run, not once per window
    spliced = mode.read_words_file(words_dir / "item-0.json")
    assert spliced.model == "small"


def test_an_all_cached_re_run_after_a_splice_loads_no_model(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    windows = _write_windows(tmp_path / "windows.json", [_window(item_index=2, guid="{B}", source="b.wav", words_file="item-2.json", start=0.0, end=6.0)])
    recheck_args = _args(tmp_path, manuscript, manifest, recheck=str(windows), model="large-v3-turbo")

    def transcriber(item, on_seconds):
        return mode.ItemWords(_timed(P2, item.start_offset), item.start_offset, item.end, "large-v3-turbo", "en", None)

    mode.run_recheck(recheck_args, compare, transcriber=transcriber)

    align_args = _args(tmp_path, manuscript, manifest, align_only=True, model="small")
    mode.run(align_args, compare)  # the real transcriber: loading a model here would fail, there is none

    assert not any(stage == "LOAD" for stage, _pct, _msg in progress.lines)
    assert _lines(align_args.out)["COVERAGE"][0]["items"]["reused"] == 2


# ---------------------------------------------------------------------------
# the command line (compare.py --coverage --recheck)


def test_the_cli_recheck_requires_words_dir(tmp_path):
    windows = _write_windows(tmp_path / "windows.json", [_window()])
    command = [
        sys.executable,
        str(base.CORE / "compare.py"),
        "--coverage",
        "--recheck",
        str(windows),
        "--manuscript",
        str(tmp_path / "m.json"),
        "--progress",
        str(tmp_path / "progress.txt"),
    ]

    result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)

    assert result.returncode == 2
    assert "--words-dir" in result.stderr


def test_the_cli_refuses_recheck_with_align_only(tmp_path):
    windows = _write_windows(tmp_path / "windows.json", [_window()])
    command = [
        sys.executable,
        str(base.CORE / "compare.py"),
        "--coverage",
        "--recheck",
        str(windows),
        "--align-only",
        "--manuscript",
        str(tmp_path / "m.json"),
        "--words-dir",
        str(tmp_path / "words"),
        "--progress",
        str(tmp_path / "progress.txt"),
    ]

    result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)

    assert result.returncode == 2
    assert "--align-only" in result.stderr


def test_the_cli_refuses_recheck_without_coverage(tmp_path):
    windows = _write_windows(tmp_path / "windows.json", [_window()])
    command = [
        sys.executable,
        str(base.CORE / "compare.py"),
        "--recheck",
        str(windows),
        "--manifest",
        "m",
        "--track-name",
        "t",
        "--out",
        "o",
        "--diff-out",
        "d",
    ]

    result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)

    assert result.returncode == 2
    assert "--recheck" in result.stderr


def test_the_cli_recheck_exits_1_when_a_named_words_file_has_nothing_cached(tmp_path):
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    windows = _write_windows(tmp_path / "windows.json", [_window(words_file="absent.json")])
    progress_path = tmp_path / "progress.txt"
    command = [
        sys.executable,
        str(base.CORE / "compare.py"),
        "--coverage",
        "--recheck",
        str(windows),
        "--words-dir",
        str(words_dir),
        "--manuscript",
        str(tmp_path / "m.json"),
        "--model",
        "tiny",
        "--progress",
        str(progress_path),
    ]

    result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)

    assert result.returncode == 1, result.stderr
    assert progress_path.read_text(encoding="utf-8").startswith("ERROR|")


def test_the_cli_recheck_exits_1_on_a_malformed_windows_file(tmp_path):
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    windows_path = tmp_path / "windows.json"
    windows_path.write_text("not json", encoding="utf-8")
    progress_path = tmp_path / "progress.txt"
    command = [
        sys.executable,
        str(base.CORE / "compare.py"),
        "--coverage",
        "--recheck",
        str(windows_path),
        "--words-dir",
        str(words_dir),
        "--manuscript",
        str(tmp_path / "m.json"),
        "--progress",
        str(progress_path),
    ]

    result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)

    assert result.returncode == 1, result.stderr


# ---------------------------------------------------------------------------
# the Should item: a plain check never silently reuses another model's words


def test_covers_also_checks_the_model_when_one_is_given():
    words = mode.ItemWords((), 10.0, 20.0, "small", "en", None)
    item = mode.ManifestItem(0, "{A}", "a.wav", 12.0, 5.0, "w.json", False)

    assert mode.covers(words, item)  # no model given: range only, as before
    assert mode.covers(words, item, "small")
    assert not mode.covers(words, item, "large-v3-turbo")


def test_a_plain_check_does_not_reuse_words_a_different_model_made(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    args = _args(tmp_path, manuscript, manifest, model="large-v3-turbo")
    calls = []

    def transcriber(item, on_seconds):
        calls.append(item.index)
        text = f"{TITLE} {SUBTITLE} {P1}" if item.index == 0 else P2
        return mode.ItemWords(_timed(text, item.start_offset), item.start_offset, item.end, "large-v3-turbo", "en", None)

    mode.run(args, compare, transcriber=transcriber)

    assert calls == [0, 2]  # both cached items were made with "small", so both are re-transcribed
    assert _lines(args.out)["COVERAGE"][0]["items"] == {"analyzed": 2, "muted": 1, "playedSeconds": 16.0, "transcribed": 2, "reused": 0}


def test_align_only_refuses_when_the_cache_was_made_with_a_different_model(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    args = _args(tmp_path, manuscript, manifest, align_only=True, model="large-v3-turbo")

    with pytest.raises(mode.AlignOnlyError, match="item 0"):
        mode.run(args, compare, transcriber=_never_transcribe)
