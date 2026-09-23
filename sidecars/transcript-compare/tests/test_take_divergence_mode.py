"""Tests for `compare.py --take-divergence` (core/take_divergence_mode.py, take-review PRD phase 9):
the manifest, the results file, progress and exit codes. Transcription is replaced by a fake that
returns hand-timed words, so no model is loaded."""

import argparse
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from narration_common import contract_files

CORE = Path(__file__).resolve().parents[1] / "core"
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

import take_divergence_mode as mode

SPEC = importlib.util.spec_from_file_location("transcript_compare_divergence_mode", CORE / "compare.py")
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)

CHAPTER_TEXT = "Alice was beginning to get very tired. She had nothing to do. Once or twice she had peeped into the book."
TAKE = {"itemGuid": "{ITEM-1}", "takeGuid": "{TAKE-1}", "sourceFile": "take1.wav", "startOffset": 12.5, "length": 4.0}


@pytest.fixture(autouse=True)
def _no_custom_equivalences(monkeypatch):
    monkeypatch.setattr(compare, "_CUSTOM_CANON", {})


def project(tmp_path, chapter_text=CHAPTER_TEXT):
    """A project folder laid out as the host lays it out: the manuscript under
    narration-utils/manuscript, the per-project word lists under TranscriptCompare."""
    manuscript = tmp_path / "project" / "narration-utils" / "manuscript" / "manuscript.json"
    manuscript.parent.mkdir(parents=True)
    manuscript.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "documentId": "doc",
                "chapters": [
                    {"id": "front", "title": "Contents", "contentKind": "front-matter"},
                    {"id": "ch-1", "title": "Chapter One", "contentKind": "narration"},
                ],
                "paragraphs": [
                    {"id": "f-1", "chapterId": "front", "index": 0, "text": "Chapter One"},
                    {"id": "p-1", "chapterId": "ch-1", "index": 1, "text": chapter_text},
                ],
            }
        ),
        encoding="utf-8",
    )
    return manuscript


def manifest_file(tmp_path, **overrides):
    data = {"schemaVersion": 1, "chapterId": "ch-1", "span": {"firstUnit": 1, "lastUnit": 1}, "takes": [TAKE]}
    data.update(overrides)
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def args_for(tmp_path, manuscript_path, manifest_path, **overrides):
    values = {
        "manifest": str(manifest_path),
        "manuscript": str(manuscript_path),
        "out": str(tmp_path / "results.txt"),
        "progress": str(tmp_path / "progress.txt"),
        "model": "small",
        "model_dir": None,
        "language": "en",
        "device": "cpu",
        "find_repeats": False,
        "chunk_seconds": 0,
        "extract_hints": False,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def timed(text, step=0.5):
    return [(word, round(i * step, 3), round(i * step + 0.4, 3)) for i, word in enumerate(text.split())]


def fake_transcriber(by_take):
    return lambda take: timed(by_take[take.take_guid])


def results(path):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return lines[0], [(line.split("|", 1)[0], json.loads(line.split("|", 1)[1])) for line in lines[1:]]


def progress_stage(path):
    return Path(path).read_text(encoding="utf-8").split("|")[0]


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise SystemExit(f"usage: {message}")


# ---------------------------------------------------------------------------
# the manifest


def test_a_valid_manifest_keeps_its_takes_in_order(tmp_path):
    second = {**TAKE, "takeGuid": "{TAKE-2}", "startOffset": 0}
    manifest = mode.read_manifest(manifest_file(tmp_path, takes=[TAKE, second]))

    assert (manifest.chapter_id, manifest.first_unit, manifest.last_unit) == ("ch-1", 1, 1)
    assert [take.take_guid for take in manifest.takes] == ["{TAKE-1}", "{TAKE-2}"]
    assert manifest.takes[1].start_offset == 0.0


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"schemaVersion": 2}, "schema version"),
        ({"chapterId": ""}, "chapterId"),
        ({"span": {"firstUnit": 2, "lastUnit": 1}}, "firstUnit <= lastUnit"),
        ({"span": {"firstUnit": True, "lastUnit": 1}}, "whole sentence numbers"),
        ({"span": {"firstUnit": 0}}, "missing \\['lastUnit'\\]"),
        ({"span": [0, 1]}, "span is not an object"),
        ({"takes": []}, "non-empty list"),
        ({"takes": ["take.wav"]}, "take 0 is not an object"),
        ({"takes": [{**TAKE, "extra": 1}]}, "unknown \\['extra'\\]"),
        ({"takes": [{**TAKE, "takeGuid": ""}]}, "takeGuid must be"),
        ({"takes": [{**TAKE, "startOffset": -1}]}, "startOffset must be"),
        ({"takes": [{**TAKE, "length": 0}]}, "length must be"),
        ({"takes": [{**TAKE, "length": "4"}]}, "length must be"),
        ({"surprise": 1}, "unknown \\['surprise'\\]"),
    ],
)
def test_a_malformed_manifest_is_refused_with_what_is_wrong(tmp_path, overrides, message):
    with pytest.raises(mode.ManifestError, match=message):
        mode.read_manifest(manifest_file(tmp_path, **overrides))


def test_an_unreadable_or_non_object_manifest_is_refused(tmp_path):
    with pytest.raises(mode.ManifestError, match="could not be read"):
        mode.read_manifest(tmp_path / "missing.json")
    path = tmp_path / "list.json"
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(mode.ManifestError, match="is not an object"):
        mode.read_manifest(path)


# ---------------------------------------------------------------------------
# a run


def test_each_take_gets_its_words_and_divergences_in_source_seconds(tmp_path):
    second = {**TAKE, "takeGuid": "{TAKE-2}", "sourceFile": "take2.wav", "startOffset": 3.0}
    manuscript = project(tmp_path)
    args = args_for(tmp_path, manuscript, manifest_file(tmp_path, takes=[TAKE, second]))
    transcriber = fake_transcriber({"{TAKE-1}": "She had nothing to do", "{TAKE-2}": "She had nothing two do"})

    assert mode.main(Parser(), args, compare, transcriber) == mode.EXIT_DONE

    summary, rows = results(args.out)
    assert summary == "SUMMARY|Aligned 2 take(s) to sentences 1-1 of 'Chapter One'"
    (span_tag, span), (tag_1, take_1), (tag_2, take_2) = rows
    assert (span_tag, tag_1, tag_2) == ("DIVERGENCE_SPAN", "TAKE_DIVERGENCE", "TAKE_DIVERGENCE")
    assert span["schemaVersion"] == 1 and span["chapterId"] == "ch-1" and span["model"] == "small"
    assert [word["text"] for word in span["span"]["words"]] == ["She", "had", "nothing", "to", "do."]
    assert (take_1["index"], take_1["takeGuid"], take_1["fidelity"], take_1["divergences"]) == (0, "{TAKE-1}", 1.0, [])
    assert take_1["words"][2] == {"index": 2, "status": "matched", "start": 13.5, "end": 13.9}
    assert take_2["divergences"] == [
        {"kind": "misread", "position": "within", "firstWord": 3, "lastWord": 3, "manuscriptText": "to", "audioText": "two", "start": 4.5, "end": 4.9}
    ]
    assert progress_stage(args.progress) == "DONE"


def test_the_project_equivalences_apply_to_the_span(tmp_path):
    manuscript = project(tmp_path, "Arelian walked home.")
    word_lists = tmp_path / "project" / "TranscriptCompare"
    word_lists.mkdir()
    (word_lists / "equivalences.csv").write_text("arelian, arelion\n", encoding="utf-8")
    args = args_for(tmp_path, manuscript, manifest_file(tmp_path, span={"firstUnit": 0, "lastUnit": 0}))

    assert mode.main(Parser(), args, compare, fake_transcriber({"{TAKE-1}": "Arelion walked home"})) == mode.EXIT_DONE

    _summary, rows = results(args.out)
    assert rows[1][1]["fidelity"] == 1.0


def test_the_whisper_transcriber_decodes_the_take_range_with_the_project_hints(tmp_path):
    manuscript = project(tmp_path)
    (tmp_path / "project" / "TranscriptCompare").mkdir()
    (tmp_path / "project" / "TranscriptCompare" / "vocabulary_hints.txt").write_text("Arelian\n", encoding="utf-8")
    calls = []
    engine = SimpleNamespace(
        project_data_path=compare.project_data_path,
        decode_segment=lambda *a: calls.append(("decode", a)) or "audio",
        transcribe=lambda audio, *a, **kw: calls.append(("transcribe", audio, a, kw)) or [("She", 0.0, 0.3)],
    )
    args = args_for(tmp_path, manuscript, "unused", model_dir="C:/models/small")

    transcriber = mode.whisper_transcriber(engine, args, mode._project_hints(engine, str(manuscript)))
    words = transcriber(mode.Take("i", "t", "take1.wav", 12.5, 4.0))

    assert words == [("She", 0.0, 0.3)]
    assert calls == [
        ("decode", ("take1.wav", 12.5, 4.0)),
        ("transcribe", "audio", ("small", "en", "cpu"), {"hotwords": "Arelian", "model_dir": "C:/models/small"}),
    ]


def test_no_hints_file_means_no_hotwords(tmp_path):
    assert mode._project_hints(compare, str(project(tmp_path))) is None


def test_an_unknown_chapter_fails_with_an_error_line_and_no_results(tmp_path):
    args = args_for(tmp_path, project(tmp_path), manifest_file(tmp_path, chapterId="front"))

    assert mode.main(Parser(), args, compare, fake_transcriber({})) == mode.EXIT_FAILED

    assert Path(args.progress).read_text(encoding="utf-8").startswith("ERROR|0|The manuscript has no narratable chapter with id 'front'")
    assert not Path(args.out).exists()


def test_a_span_past_the_chapter_fails_before_anything_is_transcribed(tmp_path):
    args = args_for(tmp_path, project(tmp_path), manifest_file(tmp_path, span={"firstUnit": 0, "lastUnit": 9}))

    def must_not_transcribe(_take):
        raise AssertionError("transcribed")

    assert mode.main(Parser(), args, compare, must_not_transcribe) == mode.EXIT_FAILED
    assert "not within the chapter" in Path(args.progress).read_text(encoding="utf-8")


def test_a_cancel_between_takes_stops_with_no_results_and_clears_the_request(tmp_path):
    second = {**TAKE, "takeGuid": "{TAKE-2}"}
    args = args_for(tmp_path, project(tmp_path), manifest_file(tmp_path, takes=[TAKE, second]))
    cancel = Path(args.progress + ".cancel")
    transcribed = []

    def cancel_after_first(take):
        transcribed.append(take.take_guid)
        cancel.write_text("", encoding="utf-8")
        return timed("She had nothing to do")

    assert mode.main(Parser(), args, compare, cancel_after_first) == mode.EXIT_CANCELLED

    assert transcribed == ["{TAKE-1}"]
    assert progress_stage(args.progress) == "CANCELLED"
    assert not cancel.exists()
    assert not Path(args.out).exists()


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"out": None}, "--out required"),
        ({"manifest": None}, "--manifest required"),
        ({"find_repeats": True}, "--find-repeats cannot"),
        ({"chunk_seconds": 30}, "--chunk-seconds cannot"),
        ({"extract_hints": True}, "--extract-hints cannot"),
    ],
)
def test_conflicting_or_missing_arguments_are_usage_errors(tmp_path, overrides, message):
    args = args_for(tmp_path, "m.json", "manifest.json", **overrides)

    with pytest.raises(SystemExit, match=message):
        mode.main(Parser(), args, compare, fake_transcriber({}))


# ---------------------------------------------------------------------------
# through compare.py


def run_compare(*argv):
    return subprocess.run([sys.executable, str(CORE / "compare.py"), *argv], capture_output=True, text=True, timeout=120, check=False)


def test_compare_py_runs_the_mode_and_exits_1_on_a_bad_manifest(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text('{"schemaVersion": 1}', encoding="utf-8")
    progress = tmp_path / "progress.txt"

    result = run_compare(
        "--take-divergence", "--manifest", str(manifest), "--manuscript", str(project(tmp_path)), "--out", str(tmp_path / "r.txt"), "--progress", str(progress)
    )

    assert result.returncode == 1, result.stderr
    assert progress.read_text(encoding="utf-8").startswith("ERROR|0|The take-divergence manifest: missing")


def test_compare_py_exits_2_on_a_usage_error(tmp_path):
    result = run_compare("--take-divergence", "--manuscript", str(project(tmp_path)), "--manifest", "m.json")

    assert result.returncode == 2
    assert "--out required with --take-divergence" in result.stderr


# ---------------------------------------------------------------------------
# the results the host reads


def test_the_results_file_is_pinned_for_the_host_that_reads_it(tmp_path):
    """Three takes of one span, read cleanly, with a misread and with a skipped word: the file the host's
    internal/takecompare parser and its comparison tests read (`take-divergence-results.json`, ADR 0069)."""
    takes = [
        {"itemGuid": "{ITEM-A}", "takeGuid": "{TAKE-A}", "sourceFile": "read-a.wav", "startOffset": 0.0, "length": 8.0},
        {"itemGuid": "{ITEM-B}", "takeGuid": "{TAKE-B}", "sourceFile": "read-b.wav", "startOffset": 1.5, "length": 8.0},
        {"itemGuid": "{ITEM-C}", "takeGuid": "{TAKE-C}", "sourceFile": "read-c.wav", "startOffset": 0.0, "length": 8.0},
    ]
    manuscript = project(tmp_path)
    args = args_for(tmp_path, manuscript, manifest_file(tmp_path, span={"firstUnit": 0, "lastUnit": 1}, takes=takes))
    transcriber = fake_transcriber(
        {
            "{TAKE-A}": "Alice was beginning to get very tired She had nothing to do",
            "{TAKE-B}": "Alice was beginning to get very tried She had nothing to do",
            "{TAKE-C}": "Alice was beginning to get tired She had nothing to do",
        }
    )

    assert mode.main(Parser(), args, compare, transcriber) == mode.EXIT_DONE

    contract_files.check("take-divergence-results", {"lines": Path(args.out).read_text(encoding="utf-8").splitlines()})
