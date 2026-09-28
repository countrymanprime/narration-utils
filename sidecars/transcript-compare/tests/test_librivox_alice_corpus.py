"""Checks on the committed LibriVox Alice recordings and the corpora built from them
(tests/fixtures/audio/librivox-alice, ADR 0416).

The recordings are committed so an agent with no network can build the corpora. These tests keep the parts that
cannot be seen by eye honest: every MP3 is the published file, every paragraph of the script is found in its
recording, every recipe builds a case the recording-coverage harness accepts, and a signal case's labels land where
its edit was made."""

import hashlib
import json
import sys
import wave
from pathlib import Path

import coverage_harness as harness
import numpy as np
import pytest

CORPUS_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "audio" / "librivox-alice"
sys.path.insert(0, str(CORPUS_DIR))

import coverage_corpus
import paragraph_spans
import signal_corpus
from alice_text import load_chapters, manuscript_json, tokens

SOURCES = paragraph_spans.load_sources()
# Whisper large-v3-turbo heard at least this share of each recording's script words, in order.
MIN_CHAPTER_MATCHED = 0.95
_ALIGNED: dict[str, paragraph_spans.Alignment] = {}


def aligned(source_id: str) -> paragraph_spans.Alignment:
    if source_id not in _ALIGNED:
        source = SOURCES[source_id]
        _ALIGNED[source_id] = paragraph_spans.align(source, load_chapters()[source["chapter"]])
    return _ALIGNED[source_id]


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as reader:
        rate = reader.getframerate()
        pcm = np.frombuffer(reader.readframes(reader.getnframes()), dtype="<i2")
    return pcm.astype(np.float32) / 32768.0, rate


@pytest.mark.parametrize("source_id", sorted(SOURCES))
def test_every_recording_is_the_published_file(source_id):
    source = SOURCES[source_id]
    data = (CORPUS_DIR / source["file"]).read_bytes()
    assert hashlib.sha256(data).hexdigest() == source["sha256"]
    assert hashlib.md5(data).hexdigest() == source["md5"]


@pytest.mark.parametrize("source_id", sorted(SOURCES))
def test_the_word_timings_cover_the_script_in_order(source_id):
    alignment = aligned(source_id)
    matched = sum(1 for times in alignment.token_times if times) / len(alignment.token_times)
    assert matched >= MIN_CHAPTER_MATCHED
    assert all(before <= after for before, after in zip(alignment.cuts, alignment.cuts[1:]))
    assert 0 < alignment.cuts[0] < alignment.cuts[-1] < alignment.duration


def test_the_manuscript_is_the_demo_text():
    chapters = load_chapters()
    assert [c.title for c in chapters.values()][:2] == ["Chapter I", "Chapter II"]
    assert chapters["c-0001"].paragraphs[0].text.startswith("Alice was beginning to get very tired of sitting by her sister")
    assert all(tokens(p.text) for c in chapters.values() for p in c.paragraphs), "a scene break became a paragraph"


def test_every_coverage_recipe_builds_a_case_the_harness_accepts(tmp_path):
    recipes = coverage_corpus.load_recipes()
    foreign = {p["foreign"]["source"] for r in recipes for i in r["items"] for p in i["pieces"] if "foreign" in p}
    alignments = {sid: aligned(sid) for sid in {r["source"] for r in recipes} | foreign}
    chapters = {a.chapter.id: a.chapter for a in alignments.values()}
    manuscript = manuscript_json(list(chapters.values()), "librivox-alice")
    (tmp_path / "manuscript.json").write_text(json.dumps(manuscript), encoding="utf-8")
    loaded = harness._load_chapters(tmp_path)
    conditions, splits = set(), set()
    for recipe in recipes:
        spec = coverage_corpus.build_case(recipe, alignments, out=None)
        case = harness.build_case(spec, loaded[spec["chapter"]], tmp_path, recipe["id"])
        conditions.update(case.conditions)
        splits.add((case.split, case.expected.text_complete))
    assert {("tune", True), ("tune", False), ("held_out", True), ("held_out", False)} <= splits
    assert {"complete", "skipped_paragraph", "skipped_sentence", "pickup_at_end", "truncated_tail", "late_start"} <= conditions


def test_a_skipped_paragraph_is_the_only_missing_one():
    recipe = next(r for r in coverage_corpus.load_recipes() if r["id"] == "kara_01-skipped-paragraph")
    expected = coverage_corpus.build_case(recipe, {"kara_01": aligned("kara_01")}, out=None)["expected"]
    assert [pid for pid, label in expected["paragraphs"].items() if label != "present"] == ["c-0001-p012"]
    assert expected["regions"] == [{"kind": "skip", "paragraphs": ["c-0001-p012"]}]


def test_a_signal_edit_is_labelled_where_it_was_made(tmp_path):
    recipe = {
        "id": "probe",
        "source": "kara_09",
        "excerpt": [1, 4],
        "description": "one dead-air gap and one click",
        "edits": [{"insertRoomTone": {"afterParagraph": 2, "seconds": 3}}, {"clicks": {"afterParagraphs": [3], "peakDbfs": -6}}],
    }
    label = signal_corpus.build_case(recipe, aligned("kara_09"), tmp_path)
    samples, rate = read_wav(tmp_path / "probe.wav")
    dead_air = next(e for e in label["events"] if e["kind"] == "dead_air")
    click = next(e for e in label["events"] if e["kind"] == "click")
    gap = samples[int(dead_air["start_s"] * rate) : int(dead_air["end_s"] * rate)]
    assert dead_air["end_s"] - dead_air["start_s"] == pytest.approx(3, abs=0.02)
    assert 20 * np.log10(np.sqrt(np.mean(gap**2)) + 1e-9) < -50, "the inserted room tone is not quiet"
    at = int(click["at_s"] * rate)
    assert np.max(np.abs(samples[at : at + int(0.003 * rate)])) > 10 ** (-9 / 20), "no click where the label says"
    assert label["speech_start_s"] < label["speech_end_s"] <= label["duration_s"]
