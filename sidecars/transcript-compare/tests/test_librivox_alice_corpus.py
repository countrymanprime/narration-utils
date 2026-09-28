"""Checks on the LibriVox Alice fixtures and the corpora built from them (tests/fixtures/audio/librivox-alice, ADR 0416).

The recordings are fetched from archive.org, not committed. What is committed (the word timings, the markers of where
every paragraph and sentence sits, and the recipes) is checked here on every run, with no audio and no network. The
checks that need the recordings run only once they have been fetched (`build.py fetch`); they never download."""

import json
import sys
import wave
from itertools import pairwise
from pathlib import Path

import coverage_harness as harness
import numpy as np
import pytest

CORPUS_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "audio" / "librivox-alice"
sys.path.insert(0, str(CORPUS_DIR))

import coverage_corpus
import paragraph_spans
import signal_corpus
import sources
from alice_text import load_chapters, manuscript_json, tokens

SOURCES = sources.load_sources()
CHAPTERS = load_chapters()
# Whisper large-v3-turbo heard at least this share of each recording's script words, in order.
MIN_CHAPTER_MATCHED = 0.95
_FETCHED = all(sources.present(source, sources.sources_dir()) for source in SOURCES.values())
needs_recordings = pytest.mark.skipif(not _FETCHED, reason="the LibriVox recordings are not fetched (build.py fetch)")


def marked(source_id: str) -> paragraph_spans.Alignment:
    source = SOURCES[source_id]
    return paragraph_spans.from_markers(source, CHAPTERS[source["chapter"]])


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as reader:
        rate = reader.getframerate()
        pcm = np.frombuffer(reader.readframes(reader.getnframes()), dtype="<i2")
    return pcm.astype(np.float32) / 32768.0, rate


def test_every_source_names_a_pinned_archive_org_file():
    for source in SOURCES.values():
        assert source["url"].startswith("https://archive.org/download/")
        assert len(source["sha256"]) == 64 and len(source["md5"]) == 32
        assert Path(source["file"]).name == source["file"] and source["file"].endswith(".mp3")


def test_the_manuscript_is_the_demo_text():
    assert [c.title for c in CHAPTERS.values()][:2] == ["Chapter I", "Chapter II"]
    assert CHAPTERS["c-0001"].paragraphs[0].text.startswith("Alice was beginning to get very tired of sitting by her sister")
    assert all(tokens(p.text) for c in CHAPTERS.values() for p in c.paragraphs), "a scene break became a paragraph"


@pytest.mark.parametrize("source_id", sorted(SOURCES))
def test_the_word_timings_cover_the_script_in_order(source_id):
    source = SOURCES[source_id]
    times, _ = paragraph_spans.match_words(source, CHAPTERS[source["chapter"]])
    assert sum(1 for t in times if t) / len(times) >= MIN_CHAPTER_MATCHED


@pytest.mark.parametrize("source_id", sorted(SOURCES))
def test_the_markers_place_every_paragraph_and_sentence_in_order(source_id):
    alignment = marked(source_id)
    assert len(alignment.cuts) == len(alignment.chapter.paragraphs) + 1 == len(alignment.cut_clean)
    assert all(before < after for before, after in pairwise(alignment.cuts))
    assert 0 < alignment.cuts[0] and alignment.cuts[-1] < alignment.duration
    for number, row in enumerate(alignment.sentences, start=1):
        assert row[0] == alignment.cuts[number - 1] and row[-1] == alignment.cuts[number]
        assert len(row) == len(alignment.sentence_clean[number - 1])
    assert sum(alignment.cut_clean) / len(alignment.cut_clean) > 0.8, "most paragraph boundaries are real pauses"


def test_every_coverage_recipe_builds_a_case_the_harness_accepts(tmp_path):
    recipes = coverage_corpus.load_recipes()
    foreign = {p["foreign"]["source"] for r in recipes for i in r["items"] for p in i["pieces"] if "foreign" in p}
    alignments = {sid: marked(sid) for sid in {r["source"] for r in recipes} | foreign}
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
    expected = coverage_corpus.build_case(recipe, {"kara_01": marked("kara_01")}, out=None)["expected"]
    assert [pid for pid, label in expected["paragraphs"].items() if label != "present"] == ["c-0001-p012"]
    assert expected["regions"] == [{"kind": "skip", "paragraphs": ["c-0001-p012"]}]


def test_every_signal_recipe_anchors_at_a_paragraph_of_its_excerpt():
    for recipe in signal_corpus.load_recipes():
        first, last = recipe["excerpt"]
        for edit in recipe.get("edits", []):
            spec = next(iter(v for k, v in edit.items() if k != "knownIssue"))
            anchors = spec.get("afterParagraphs", [spec["afterParagraph"]] if "afterParagraph" in spec else [])
            assert all(first <= n < last for n in anchors), recipe["id"]


@needs_recordings
@pytest.mark.parametrize("source_id", sorted(SOURCES))
def test_the_committed_markers_are_the_ones_the_recording_gives(source_id):
    source = SOURCES[source_id]
    measured = paragraph_spans.align(source, CHAPTERS[source["chapter"]], sources.sources_dir())
    committed = json.loads((CORPUS_DIR / "alignment" / f"{source_id}.markers.json").read_text(encoding="utf-8"))
    assert json.loads(json.dumps(paragraph_spans.markers_json(measured))) == committed


@needs_recordings
def test_a_signal_edit_is_labelled_where_it_was_made(tmp_path):
    recipe = {
        "id": "probe",
        "source": "kara_09",
        "excerpt": [1, 4],
        "description": "one dead-air gap and one click",
        "edits": [{"insertRoomTone": {"afterParagraph": 2, "seconds": 3}}, {"clicks": {"afterParagraphs": [3], "peakDbfs": -6}}],
    }
    alignment = paragraph_spans.align(SOURCES["kara_09"], CHAPTERS["c-0009"], sources.sources_dir())
    label = signal_corpus.build_case(recipe, alignment, tmp_path)
    samples, rate = read_wav(tmp_path / "probe.wav")
    dead_air = next(e for e in label["events"] if e["kind"] == "dead_air")
    click = next(e for e in label["events"] if e["kind"] == "click")
    gap = samples[int(dead_air["start_s"] * rate) : int(dead_air["end_s"] * rate)]
    assert dead_air["end_s"] - dead_air["start_s"] == pytest.approx(3, abs=0.02)
    assert 20 * np.log10(np.sqrt(np.mean(gap**2)) + 1e-9) < -50, "the inserted room tone is not quiet"
    at = int(click["at_s"] * rate)
    assert np.max(np.abs(samples[at : at + int(0.003 * rate)])) > 10 ** (-9 / 20), "no click where the label says"
    assert label["speech_start_s"] < label["speech_end_s"] <= label["duration_s"]
