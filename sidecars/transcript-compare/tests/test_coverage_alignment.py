"""The coverage mode's word alignment (edit-and-proof-workspace PRD Phase 1, EP3 C).

Beside its measurements, `compare.py --coverage` writes one `COVERAGE_TOKEN` line per chapter token
(the manuscript word it came from, its status as the check judged it, and where it was heard in its
item's source) and one `COVERAGE_EXTRA` line per run of heard words the chapter does not account
for. The flags must equal the check: a token's status is the status the check counted. Align-only
(`--align-only`) re-aligns from cached words and never transcribes."""

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pytest
import test_coverage_mode as base
from test_coverage_mode import (
    P1,
    P2,
    P3,
    SUBTITLE,
    TITLE,
    WORD_SECONDS,
    _args,
    _item,
    _lines,
    _never_transcribe,
    _project,
    _words_file,
    _write_manifest,
    compare,
    mode,
)

# The coverage mode tests' fixtures, shared rather than copied.
cached_project = base.cached_project
progress = base.progress
coverage_model = mode.coverage_model  # core/recording_coverage.py, on the path test_coverage_mode sets


def _run(tmp_path, manuscript, manifest, **overrides):
    args = _args(tmp_path, manuscript, manifest, **overrides)
    mode.run(args, compare, _never_transcribe)
    return _lines(args.out)


def _paragraph_words(manuscript):
    data = json.loads(Path(manuscript).read_text(encoding="utf-8"))
    return {p["id"]: p["text"].split() for p in data["paragraphs"]}


def test_every_chapter_token_has_one_line_in_order_naming_its_manuscript_word(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    lines = _run(tmp_path, manuscript, manifest)
    tokens = lines["COVERAGE_TOKEN"]
    assert [token["i"] for token in tokens] == list(range(len(tokens)))
    heading = f"{TITLE} {SUBTITLE}".split()
    words = _paragraph_words(manuscript)
    assert [token["text"] for token in tokens[: len(heading)]] == heading
    assert all(token["p"] is None and token["status"] == "heading" for token in tokens[: len(heading)])
    body = tokens[len(heading) :]
    assert len(body) == sum(len(words[pid]) for pid in ("p-000001", "p-000002", "p-000003"))
    for token in body:
        # The word is the w-th whitespace word of its paragraph's text: the UI finds it without tokenizing.
        assert words[token["p"]][token["w"]] == token["text"]


def test_a_read_word_says_which_item_and_where_in_its_source_it_was_heard(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    tokens = _run(tmp_path, manuscript, manifest)["COVERAGE_TOKEN"]
    alice = next(token for token in tokens if token["p"] == "p-000001" and token["w"] == 0)
    # Item 0's words start at 10.0 s of source: four heading words, then "Alice".
    assert alice["status"] == "read"
    assert alice["item"] == 0
    assert alice["start"] == pytest.approx(10.0 + 4 * WORD_SECONDS)
    assert alice["end"] == pytest.approx(10.0 + 4 * WORD_SECONDS + 0.25)
    once = next(token for token in tokens if token["p"] == "p-000002" and token["w"] == 0)
    assert (once["status"], once["item"], once["start"]) == ("read", 2, 0.0)


def test_text_never_heard_has_no_time_and_the_checks_own_status(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    tokens = _run(tmp_path, manuscript, manifest)["COVERAGE_TOKEN"]
    tail = [token for token in tokens if token["p"] == "p-000003"]
    assert tail and all(token["status"] == "tail" for token in tail)
    assert all(token["item"] is None and token["start"] is None and token["end"] is None for token in tail)


def test_the_flags_equal_the_check(tmp_path, progress):
    # A skip in the middle of P2 and a misread word in P1: the per-token statuses must add up to the
    # paragraph lines, the summary and the regions the check itself wrote.
    manuscript = _project(tmp_path)
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    p1 = P1.replace("sister", "cistern", 1)
    p2 = " ".join(P2.split()[:3] + P2.split()[9:])
    _words_file(words_dir / "item-0.json", f"{TITLE} {SUBTITLE} {p1} {p2} {P3}", 0.0, 40.0)
    manifest = _write_manifest(tmp_path / "manifest.json", [_item(0, "{A}", "a.wav", 0.0, 40.0)])
    lines = _run(tmp_path, manuscript, manifest)
    tokens = lines["COVERAGE_TOKEN"]
    body = [token for token in tokens if token["status"] != "heading"]
    present = {"read", "misread"}
    summary = lines["COVERAGE"][0]
    assert sum(token["status"] in present for token in body) == summary["presentTokens"]
    assert sum(token["status"] not in present for token in body) == summary["missingTokens"]
    for paragraph in lines["COVERAGE_PARAGRAPH"]:
        mine = [token for token in body if token["p"] == paragraph["id"]]
        assert len(mine) == paragraph["tokens"]
        assert sum(token["status"] in present for token in mine) == paragraph["present"]
    kinds = Counter(token["status"] for token in body if token["status"] not in present)
    regions = Counter()
    for region in lines["COVERAGE_REGION"]:
        regions[region["kind"]] += region["tokenCount"]
    assert kinds == regions
    assert kinds["skip"] == 6
    assert sum(extra["tokens"] for extra in lines.get("COVERAGE_EXTRA", [])) == summary["extraTokens"]
    cistern = next(token for token in body if token["p"] == "p-000001" and token["text"] == "sister")
    assert cistern["status"] == "misread"
    assert cistern["heard"] == "cistern"
    assert cistern["item"] == 0 and cistern["start"] is not None


def test_words_heard_that_the_chapter_does_not_account_for_are_extra_runs(tmp_path, progress):
    manuscript = _project(tmp_path)
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    aside = "sorry let me try that bit again from the top please"
    _words_file(words_dir / "item-0.json", f"{TITLE} {SUBTITLE} {P1} {aside} {P2} {P3}", 0.0, 60.0)
    manifest = _write_manifest(tmp_path / "manifest.json", [_item(0, "{A}", "a.wav", 0.0, 60.0)])
    lines = _run(tmp_path, manuscript, manifest)
    (extra,) = lines["COVERAGE_EXTRA"]
    assert extra["text"] == aside
    assert extra["tokens"] == len(aside.split())
    heard_before = 4 + len(P1.split())
    assert extra["start"] == {"itemIndex": 0, "itemGuid": "{A}", "sourceTime": pytest.approx(heard_before * WORD_SECONDS)}
    last = heard_before + len(aside.split()) - 1
    assert extra["end"] == {"itemIndex": 0, "itemGuid": "{A}", "sourceTime": pytest.approx(last * WORD_SECONDS + 0.25)}
    # It sits after P1's last word.
    tokens = lines["COVERAGE_TOKEN"]
    after = tokens[extra["afterToken"]]
    assert (after["p"], after["w"]) == ("p-000001", len(P1.split()) - 1)
    assert all(token["status"] in ("heading", "read") for token in tokens)


def test_a_fully_read_chapter_has_no_extra_lines(tmp_path, progress):
    manuscript = _project(tmp_path)
    words_dir = tmp_path / "words"
    words_dir.mkdir()
    _words_file(words_dir / "item-0.json", f"{TITLE} {SUBTITLE} {P1} {P2} {P3}", 0.0, 40.0)
    manifest = _write_manifest(tmp_path / "manifest.json", [_item(0, "{A}", "a.wav", 0.0, 40.0)])
    lines = _run(tmp_path, manuscript, manifest)
    assert "COVERAGE_EXTRA" not in lines
    assert {token["status"] for token in lines["COVERAGE_TOKEN"]} == {"heading", "read"}


def test_the_measurement_lines_are_unchanged_by_the_alignment_lines(tmp_path, cached_project, progress):
    # Additive (ADR 0127's tagged lines): the lines the host already reads come first, at the same
    # schema version, and the new tags come after them.
    manuscript, manifest = cached_project
    out = Path(_args(tmp_path, manuscript, manifest).out)
    _run(tmp_path, manuscript, manifest)
    tags = [line.split("|", 1)[0] for line in out.read_text(encoding="utf-8").splitlines()]
    first_new = tags.index("COVERAGE_TOKEN")
    assert set(tags[:first_new]) == {"COVERAGE", "COVERAGE_ITEM", "COVERAGE_PARAGRAPH", "COVERAGE_REGION"}
    assert set(tags[first_new:]) <= {"COVERAGE_TOKEN", "COVERAGE_EXTRA"}
    assert _lines(out)["COVERAGE"][0]["schemaVersion"] == mode.RESULT_SCHEMA_VERSION == 1


# ---------------------------------------------------------------------------
# the token statuses in the model


def test_token_statuses_are_the_checks_statuses():
    aligned = coverage_model.AlignedChapter(
        doc_tokens=("a", "b", "c", "d", "e", "f", "g", "h"),
        doc_words=("A", "B", "C", "D", "E", "F", "G", "H"),
        token_paragraph=(0,) * 8,
        paragraph_ids=("p1",),
        audio_tokens=("a", "b", "c", "x", "e", "f", "g", "h", "z"),
        opcodes=(("equal", 0, 3, 0, 3), ("replace", 3, 4, 3, 4), ("equal", 4, 8, 4, 8), ("insert", 8, 8, 8, 9)),
    )
    params = coverage_model.AlignmentParams()
    tokens, extras = coverage_model.align_tokens(aligned, params)
    assert [token.status for token in tokens] == ["read", "read", "read", "misread", "read", "read", "read", "read"]
    assert [token.audio for token in tokens] == list(range(8))
    assert extras == ((8, 9),)
    coverage = coverage_model.compute_coverage(aligned, params)
    assert coverage.present_tokens == 8
    assert sum(end - start for start, end in extras) == coverage.extra_tokens


# ---------------------------------------------------------------------------
# align-only


def test_align_only_with_every_item_cached_gives_the_same_report(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    first = _args(tmp_path, manuscript, manifest, out=str(tmp_path / "a.txt"))
    again = _args(tmp_path, manuscript, manifest, out=str(tmp_path / "b.txt"), align_only=True)
    mode.run(first, compare, _never_transcribe)
    mode.run(again, compare)
    assert Path(first.out).read_bytes() == Path(again.out).read_bytes()


def test_align_only_refuses_before_anything_is_decoded_when_an_item_is_not_cached(tmp_path, cached_project, progress):
    manuscript, manifest = cached_project
    (tmp_path / "words" / "item-2.json").unlink()
    args = _args(tmp_path, manuscript, manifest, align_only=True)
    with pytest.raises(mode.AlignOnlyError, match="item 2"):
        mode.run(args, compare, _never_transcribe)
    assert not Path(args.out).exists()
    assert not any(stage in ("DECODE", "TRANSCRIBE", "LOAD") for stage, _pct, _message in progress.lines)


def test_the_cli_takes_align_only_with_coverage_and_exits_1_when_words_are_missing(tmp_path, cached_project):
    manuscript, manifest = cached_project
    (tmp_path / "words" / "item-2.json").unlink()
    out = tmp_path / "out.txt"
    command = [
        sys.executable,
        str(Path(compare.__file__)),
        "--coverage",
        "--align-only",
        "--manuscript",
        str(manuscript),
        "--manifest",
        str(manifest),
        "--chapter-id",
        "c-0001",
        "--words-dir",
        str(tmp_path / "words"),
        "--out",
        str(out),
        "--progress",
        str(tmp_path / "progress.txt"),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
    assert result.returncode == 1, result.stderr
    assert not out.exists()
    assert (tmp_path / "progress.txt").read_text(encoding="utf-8").startswith("ERROR|")


def test_the_cli_refuses_align_only_without_coverage(tmp_path):
    command = [sys.executable, str(Path(compare.__file__)), "--align-only", "--manifest", "m", "--track-name", "t", "--out", "o", "--diff-out", "d"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
    assert result.returncode == 2
    assert "--align-only" in result.stderr
