"""Phase 8 calibration: the synthetic fixtures through the shipped coverage path.

`docs/research/recording-coverage-calibration.md` records what this measured and ADR 0132 the
defaults it chose. This module is test tooling, not product code. It runs each case the way the
host runs a check:

1. the sidecar's coverage mode (`core/coverage_mode.py`, `compare.py --coverage`) reads a JSON
   manifest and one words file per item, aligns the chapter and writes the tagged result lines;
   scripted items get their words file written first, so nothing is transcribed, and audio items
   (a permissioned corpus, or the Piper renders below) are transcribed by the real Whisper path;
2. the thresholds are applied on read to the result lines, by `text_complete`, which mirrors
   `coverage.Report.TextComplete` in `apps/desktop/internal/coverage/report.go`.

It adds four things the Phase 1 harness and the Phase 2 spike do not have:

- `with_asr_noise` drops and swaps transcript words at a set rate, seeded per case, so the
  perfect synthetic transcripts can stand in for a transcriber that makes mistakes;
- `resolution_cases` leave out or replace a phrase just longer than the check promises to catch
  (Q3's 3 missing and 8 misread words), in the middle of every paragraph long enough;
- `collect` runs every case at every noise level and alignment, and `choose` picks the defaults
  from `GRID` by a fixed rule: only candidates with no false "met" on `tune` at any noise level
  and no chance-matched word credited (`is_safe`), then the most complete `tune` chapters called
  complete, then the values closest to the Proposed ones;
- `render_audio_corpus` speaks the committed cases with a Piper voice into a directory in the
  `NARRATION_COVERAGE_CORPUS` layout, outside the repository, and `audio_report` runs the real
  sidecar with a Whisper model over it and times it.

Phase 1 of the model cascade PRD (the note's "Model cascade (Phase 1)" section) adds two more:

- `cascade` simulates the two-pass check: a fast model over the whole chapter, windows planned from
  the regions that fail it (`plan_windows`, the PRD's MC3 constants), a stronger model over those
  windows only (one load a run), its words spliced into the first pass's (`splice`), and the chapter
  aligned again by the same pure alignment and coverage code the sidecar runs (`align_words`). It
  reports it per case against single-model runs, or, over an unlabelled chapter (a host manifest),
  against a reference model;
- `windows` benchmarks what a window of each length costs to transcribe.

Run it: `uv run python sidecars/transcript-compare/tests/coverage_calibration.py synthetic` prints
the tables of the research note; `render-audio`, `audio`, `cascade` and `windows` are the optional
audio runs.

The file is over the 800-line soft ceiling on purpose: the PRD keeps the calibration harness in one
module (its coverage floor is 100%, `scripts/ci/coverage-floors.json`), and the cascade's product
code, where a split would matter, lands in Phases 3 and 4.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import itertools
import json
import os
import random
import subprocess
import sys
import tempfile
import time
import wave
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType, SimpleNamespace

import numpy as np

if __package__ in (None, ""):  # run as a script: make the harness importable
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import coverage_harness as harness
import coverage_spike as spike

CORE = spike.CORE
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

import compare as engine  # needs CORE on sys.path, as coverage_mode itself does
import coverage_mode
import recording_coverage as coverage_model

SIDECAR = CORE / "compare.py"
REPOSITORY = Path(__file__).resolve().parents[3]
SCRIPTED_MODEL = "scripted"


# ---------------------------------------------------------------------------
# settings


@dataclass(frozen=True)
class Settings:
    """The four recording-check settings (Q3): two alignment parameters and two thresholds."""

    min_paragraph_present: float
    max_missing_run: int
    max_misread_run: int
    min_anchor_run: int

    @property
    def alignment(self) -> tuple[int, int]:
        return (self.max_misread_run, self.min_anchor_run)


PROPOSED = Settings(0.95, 3, 8, 3)
"""The starting values the owner answered Q3 with: 0.95, 3, 8 and 3."""

SHIPPED = Settings(0.8, 3, 8, 3)
"""What `choose` picks from `GRID` on the synthetic set, and the defaults the app ships (ADR 0132).
Still Proposed and uncalibrated on real narration (Q15)."""

GRID: Mapping[str, tuple] = MappingProxyType(
    {
        "min_paragraph_present": (0.8, 0.85, 0.9, 0.95, 1.0),
        "max_missing_run": (0, 1, 2, 3, 4, 5, 6, 8),
        "max_misread_run": (4, 6, 8, 10, 12),
        "min_anchor_run": (2, 3, 4),
    }
)


def grid_settings(grid: Mapping[str, tuple] = GRID) -> list[Settings]:
    names = list(grid)
    return [Settings(**dict(zip(names, values, strict=True))) for values in itertools.product(*(grid[name] for name in names))]


# ---------------------------------------------------------------------------
# the sidecar result, read the way the host reads it


@dataclass(frozen=True)
class SidecarResult:
    summary: Mapping
    paragraphs: tuple[Mapping, ...]
    regions: tuple[Mapping, ...]
    items: tuple[Mapping, ...]
    seconds: float = 0.0  # wall time of the run that wrote it


def read_results(path: Path, seconds: float = 0.0) -> SidecarResult:
    lines: dict[str, list[dict]] = {"COVERAGE": [], "COVERAGE_ITEM": [], "COVERAGE_PARAGRAPH": [], "COVERAGE_REGION": []}
    for line in path.read_text(encoding="utf-8").splitlines():
        tag, _, payload = line.partition("|")
        lines[tag].append(json.loads(payload))
    (summary,) = lines["COVERAGE"]
    return SidecarResult(summary, tuple(lines["COVERAGE_PARAGRAPH"]), tuple(lines["COVERAGE_REGION"]), tuple(lines["COVERAGE_ITEM"]), seconds)


def present_fraction(paragraph: Mapping) -> float:
    return paragraph["present"] / paragraph["tokens"] if paragraph["tokens"] else 1.0


def paragraph_passes(paragraph: Mapping, settings: Settings) -> bool:
    return present_fraction(paragraph) >= settings.min_paragraph_present and paragraph["longestMissingRun"] <= settings.max_missing_run


def text_complete(result: SidecarResult, settings: Settings) -> bool:
    """`coverage.Report.TextComplete`: no missing run over the limit and every paragraph passes."""
    if result.summary["longestMissingRun"] > settings.max_missing_run:
        return False
    return all(paragraph_passes(paragraph, settings) for paragraph in result.paragraphs)


def harness_report(result: SidecarResult, settings: Settings) -> harness.Report:
    labels = {}
    for paragraph in result.paragraphs:
        if paragraph_passes(paragraph, settings):
            labels[paragraph["id"]] = "present"
        else:
            labels[paragraph["id"]] = "missing" if present_fraction(paragraph) < 1 - settings.min_paragraph_present else "partial"
    regions = tuple(harness.Region(region["kind"], tuple(region["paragraphIds"])) for region in result.regions)
    return harness.Report(text_complete(result, settings), MappingProxyType(labels), regions)


# ---------------------------------------------------------------------------
# running a case through the sidecar


@dataclass(frozen=True)
class Whisper:
    """A real transcription: the model name the host passes and its hash-verified directory."""

    model: str
    model_dir: Path | None = None
    language: str | None = "en"
    device: str = "cpu"


def _audio_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as reader:
        return reader.getnframes() / reader.getframerate()


def write_inputs(case: harness.Case, words_dir: Path) -> Path:
    """The manifest the host would write for the case, and a words file for every scripted item.
    Audio items get no words file, so the sidecar decodes and transcribes them."""
    words_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for index, item in enumerate(case.items):
        name = f"{index:03d}-{item.id}.json"
        if item.audio is not None:
            source, length = str(item.audio.resolve()), _audio_seconds(item.audio)
        else:
            source = f"{case.id}-{item.id}.wav"  # never opened: the words file covers the range
            length = max((word.end for word in item.words), default=0.0) + harness.WORD_SECONDS
            words = tuple((word.text, word.start, word.end) for word in item.words)
            coverage_mode.write_words_file(words_dir / name, coverage_mode.ItemWords(words, 0.0, length, SCRIPTED_MODEL, "en", None))
        items.append({"index": index, "itemGuid": item.id, "sourceFile": source, "startOffset": 0.0, "length": length, "wordsFile": name, "muted": False})
    manifest = words_dir / "manifest.json"
    manifest.write_text(json.dumps({"schemaVersion": coverage_mode.MANIFEST_SCHEMA_VERSION, "items": items}), encoding="utf-8")
    return manifest


def _args(case: harness.Case, manuscript: Path, words_dir: Path, out: Path, settings: Settings, whisper: Whisper | None) -> list[str]:
    return _sidecar_args(case.chapter.id, manuscript, words_dir, out, settings, whisper)


def _sidecar_args(chapter_id: str, manuscript: Path, words_dir: Path, out: Path, settings: Settings, whisper: Whisper | None) -> list[str]:
    args = [
        "--coverage",
        "--manifest", str(words_dir / "manifest.json"),
        "--manuscript", str(manuscript),
        "--chapter-id", chapter_id,
        "--words-dir", str(words_dir),
        "--out", str(out),
        "--progress", str(out.with_suffix(".progress")),
        "--model", whisper.model if whisper else SCRIPTED_MODEL,
        "--max-misread-run", str(settings.max_misread_run),
        "--min-anchor-run", str(settings.min_anchor_run),
    ]  # fmt: skip
    if whisper and whisper.model_dir:
        args += ["--model-dir", str(whisper.model_dir)]
    if whisper and whisper.language:
        args += ["--language", whisper.language]
    return args


def _no_transcription(item, _on_seconds):
    raise AssertionError(f"item {item.item_guid} has no words file: a scripted case must never be transcribed")


def run_in_process(case: harness.Case, manuscript: Path, work: Path, settings: Settings) -> SidecarResult:
    """`coverage_mode.run` over the case's words files, with the same arguments the CLI parses.
    Only for scripted cases: it refuses to transcribe."""
    words_dir = work / "words"
    write_inputs(case, words_dir)
    out = work / f"results-{settings.max_misread_run}-{settings.min_anchor_run}.txt"
    args = _args(case, manuscript, words_dir, out, settings, None)
    namespace = SimpleNamespace(
        **{args[k][2:].replace("-", "_"): args[k + 1] for k in range(1, len(args), 2)},
        model_dir=None,
        language=None,
        device="cpu",
    )
    namespace.max_misread_run, namespace.min_anchor_run = settings.max_misread_run, settings.min_anchor_run
    started = time.perf_counter()
    with contextlib.redirect_stdout(None), contextlib.redirect_stderr(None):  # the sidecar's log lines
        coverage_mode.run(namespace, engine, transcriber=_no_transcription)
    return read_results(out, time.perf_counter() - started)


def run_cli(case: harness.Case, manuscript: Path, words_dir: Path, out: Path, settings: Settings, whisper: Whisper | None = None) -> SidecarResult:
    """`compare.py --coverage` as a subprocess, as the host launches it. Words files already in
    `words_dir` are reused, so a second run with other alignment settings transcribes nothing."""
    write_inputs(case, words_dir)
    return _run_sidecar(case.id, _args(case, manuscript, words_dir, out, settings, whisper), out)


def _run_sidecar(label: str, args: list[str], out: Path) -> SidecarResult:
    started = time.perf_counter()
    done = subprocess.run([sys.executable, str(SIDECAR), *args], capture_output=True, text=True, check=False)
    seconds = time.perf_counter() - started
    if done.returncode != 0:
        raise RuntimeError(f"{label}: the sidecar exited with {done.returncode}: {done.stderr[-2000:]}")
    return read_results(out, seconds)


STORED_SECONDS = "seconds.json"
"""Beside a words cache: the wall time of the run that transcribed it, so a run that reuses every
words file still reports what the check cost."""


def with_stored_seconds(result: SidecarResult, words_dir: Path) -> SidecarResult:
    """The result with the time of the run that transcribed its words: stored when this run
    transcribed something, read back when it reused everything."""
    stored = words_dir / STORED_SECONDS
    if result.summary["items"]["transcribed"]:
        stored.write_text(json.dumps({"seconds": result.seconds}), encoding="utf-8")
        return result
    if stored.exists():
        return dataclasses.replace(result, seconds=json.loads(stored.read_text(encoding="utf-8"))["seconds"])
    return result


# ---------------------------------------------------------------------------
# simulated transcriber error

NOISE_WORDS = ("the", "and", "a", "of", "to", "in", "it", "that", "uh", "um")


@dataclass(frozen=True)
class Noise:
    """Per-word transcriber error on a perfect transcript: a word is dropped with probability
    `drop`, else swapped for a common word with probability `swap`; `burst` words in a row are
    dropped once per `burst_every` words (a phrase lost to VAD or a mumble)."""

    name: str
    drop: float = 0.0
    swap: float = 0.0
    burst: int = 0
    burst_every: int = 0
    seed: int = 8


NOISE_LEVELS: tuple[Noise, ...] = (
    Noise("none"),
    Noise("light", drop=0.01, swap=0.02),
    Noise("moderate", drop=0.03, swap=0.05),
    Noise("bursty", drop=0.01, swap=0.02, burst=3, burst_every=150),
    Noise("heavy", drop=0.05, swap=0.10, burst=4, burst_every=120),
)


def _noisy_words(words: tuple[harness.Word, ...], noise: Noise, rng: random.Random) -> tuple[harness.Word, ...]:
    kept, skip = [], 0
    for index, word in enumerate(words):
        if noise.burst_every and index % noise.burst_every == noise.burst_every // 2:
            skip = noise.burst
        if skip:
            skip -= 1
            continue
        roll = rng.random()
        if roll < noise.drop:
            continue
        if roll < noise.drop + noise.swap:
            word = dataclasses.replace(word, text=rng.choice(NOISE_WORDS))
        kept.append(word)
    return tuple(kept)


def with_asr_noise(case: harness.Case, noise: Noise) -> harness.Case:
    """The case with its transcript perturbed; the labels stay what the narrator did."""
    if not (noise.drop or noise.swap or noise.burst):
        return case
    rng = random.Random(f"{noise.seed}:{noise.name}:{case.id}")
    items = tuple(item if item.words is None else dataclasses.replace(item, words=_noisy_words(item.words, noise, rng)) for item in case.items)
    return dataclasses.replace(case, items=items)


# ---------------------------------------------------------------------------
# the case sets


STRESS_HELD_OUT_CHAPTERS = frozenset({"c-0002", "c-0004"})

# The smallest omissions the check promises to catch (Q3's resolution): a phrase of more than
# `max_missing_run` (3) words left out, and more than `max_misread_run` (8) words said as other
# text. Anything smaller cannot be told apart from a transcriber that drops or garbles a word.
SKIPPED_PHRASE_WORDS = (4, 6)
REPLACED_PHRASE_WORDS = 9
_EDGE_WORDS = 3  # read words kept on each side of a phrase, so it sits inside the paragraph


def _phrase_spec(chapter: harness.Chapter, k: int, n: int, spoken: list[str]) -> dict:
    paragraph = chapter.paragraphs[k]
    reads = [{"read": p.id} for p in chapter.paragraphs]
    at = (len(paragraph.text.split()) - n) // 2
    middle = [{"say": " ".join(spoken)}] if spoken else []
    read = [{"read": paragraph.id, "words": [0, at]}, *middle, {"read": paragraph.id, "words": [at + n, None]}]
    return {
        "id": f"{chapter.id}-{'replaced' if spoken else 'skipped'}-phrase-{n}-{k}",
        "conditions": ["unrelated_speech" if spoken else "skipped_sentence"],
        "split": "tune",
        "recording": {"items": [{"id": "item-1", "segments": [*reads[:k], *read, *reads[k + 1 :]]}]},
        "expected": {
            "textComplete": False,
            "paragraphs": spike._labels(chapter, partial=[paragraph.id]),
            "regions": [{"kind": "different_text" if spoken else "skip", "paragraphs": [paragraph.id]}],
        },
    }


def resolution_cases() -> tuple[harness.Case, ...]:
    """A phrase at the check's resolution left out, or said as other words, in the middle of every
    paragraph long enough: the cases that bound `max_missing_run` and `max_misread_run`."""
    chapters = {case.chapter.id: case.chapter for case in harness.load_corpus(harness.FIXTURE_DIR).cases}
    unrelated = spike.UNRELATED.split()[:REPLACED_PHRASE_WORDS]
    cases = []
    for chapter in chapters.values():
        for k, paragraph in enumerate(chapter.paragraphs):
            size = len(paragraph.text.split())
            for n, spoken in [*((n, []) for n in SKIPPED_PHRASE_WORDS), (REPLACED_PHRASE_WORDS, unrelated)]:
                if size >= n + 2 * _EDGE_WORDS:
                    cases.append(harness.build_case({**_phrase_spec(chapter, k, n, spoken), "chapter": chapter.id}, chapter))
    return tuple(cases)


def calibration_cases() -> tuple[harness.Case, ...]:
    """The committed cases with their own split, then the Phase 2 stress cases and the resolution
    cases split by chapter: chapter II and the constructed chapter are held out, so no generated
    case the defaults are chosen on shares a chapter with a generated case they are judged on."""
    committed = harness.load_corpus(harness.FIXTURE_DIR).cases
    generated = [("stress", case) for case in spike.stress_cases()] + [("resolution", case) for case in resolution_cases()]
    return (
        *committed,
        *(
            dataclasses.replace(case, id=f"{family}:{case.id}", split="held_out" if case.chapter.id in STRESS_HELD_OUT_CHAPTERS else "tune")
            for family, case in generated
        ),
    )


# ---------------------------------------------------------------------------
# the sweep


@dataclass(frozen=True)
class Tally:
    cases: int = 0
    complete: int = 0  # cases labelled complete
    false_met: int = 0
    false_not_met: int = 0

    def add(self, expected: bool, got: bool) -> Tally:
        return Tally(
            self.cases + 1,
            self.complete + expected,
            self.false_met + (got and not expected),
            self.false_not_met + (expected and not got),
        )

    @property
    def complete_called_complete(self) -> int:
        return self.complete - self.false_not_met


ResultTable = Mapping[tuple[str, str, tuple[int, int]], SidecarResult]
"""(noise name, case id, alignment) -> the sidecar's result."""


def collect(cases: Sequence[harness.Case], noises: Sequence[Noise], alignments: Iterable[tuple[int, int]], work: Path) -> dict:
    """One sidecar run per case, noise level and alignment; thresholds are applied later, on read."""
    manuscript = harness.FIXTURE_DIR / "manuscript.json"
    table = {}
    for noise in noises:
        for case in cases:
            noisy = with_asr_noise(case, noise)
            for misread, anchor in alignments:
                folder = work / noise.name / case.id.replace(":", "_") / f"{misread}-{anchor}"
                table[(noise.name, case.id, (misread, anchor))] = run_in_process(
                    noisy, manuscript, folder, dataclasses.replace(PROPOSED, max_misread_run=misread, min_anchor_run=anchor)
                )
    return table


def tally(table: ResultTable, cases: Sequence[harness.Case], noise: Noise, settings: Settings, split: str | None = None) -> Tally:
    total = Tally()
    for case in cases:
        if split is None or case.split == split:
            total = total.add(case.expected.text_complete, text_complete(table[(noise.name, case.id, settings.alignment)], settings))
    return total


def labels(table: ResultTable, cases: Sequence[harness.Case], noise: Noise, settings: Settings) -> harness.Evaluation:
    """The harness's paragraph-label and region scoring of the stored results under `settings`."""
    return harness.Evaluation(tuple(harness._score(case, harness_report(table[(noise.name, case.id, settings.alignment)], settings)) for case in cases))


def _distance(settings: Settings) -> float:
    """How far a candidate is from the Proposed values, each setting scaled by its grid step."""
    return (
        abs(settings.min_paragraph_present - PROPOSED.min_paragraph_present) / 0.05
        + abs(settings.max_missing_run - PROPOSED.max_missing_run)
        + abs(settings.max_misread_run - PROPOSED.max_misread_run) / 2
        + abs(settings.min_anchor_run - PROPOSED.min_anchor_run)
    )


def chance_credit(table: ResultTable, cases: Sequence[harness.Case], noise: Noise, settings: Settings, split: str | None = None) -> int:
    """Words credited as read in a paragraph that unrelated speech replaced (the stress set's
    `-unrelated-` cases): the PRD's chance-match metric, whose target is 0."""
    credited = 0
    for case in cases:
        if "-unrelated-" not in case.id or (split is not None and case.split != split):
            continue
        missing = {pid for pid, value in case.expected.paragraphs.items() if value == "missing"}
        result = table[(noise.name, case.id, settings.alignment)]
        credited += sum(paragraph["present"] for paragraph in result.paragraphs if paragraph["id"] in missing)
    return credited


def is_safe(table: ResultTable, cases: Sequence[harness.Case], noises: Sequence[Noise], settings: Settings) -> bool:
    """No false met on `tune` at any noise level, and no chance-matched word credited on `tune`
    with a perfect transcript."""
    return (
        all(tally(table, cases, noise, settings, "tune").false_met == 0 for noise in noises) and chance_credit(table, cases, noises[0], settings, "tune") == 0
    )


def choose(table: ResultTable, cases: Sequence[harness.Case], noises: Sequence[Noise], candidates: Sequence[Settings]) -> Settings:
    """The rule: only safe candidates (`is_safe`); of those, the most complete `tune` chapters called
    complete, summed over the noise levels; then the candidate closest to the Proposed values."""
    safe = [s for s in candidates if is_safe(table, cases, noises, s)]
    if not safe:
        raise ValueError("no candidate is safe on the tune cases")
    return max(safe, key=lambda s: (sum(tally(table, cases, noise, s, "tune").complete_called_complete for noise in noises), -_distance(s)))


# ---------------------------------------------------------------------------
# audio: Piper renders outside the repository, Whisper through the real sidecar


def _segment_texts(segment: Mapping, chapter: harness.Chapter, clock: float, played: tuple[float, float], where: str) -> tuple[str | float, float]:
    """What a segment adds to the audio (text to speak, or seconds of silence) and the scripted
    clock after it. Only the part inside the played range is rendered, so a trim that hides text
    in the text form hides it here too: the audio is the played range."""
    start, end = played
    if "pause" in segment:
        overlap = max(0.0, min(clock + segment["pause"], end) - max(clock, start))
        return overlap, clock + segment["pause"]
    words = harness._segment_words(segment, chapter, where) if "read" in segment else str(segment["say"]).split()
    kept = [word for n, word in enumerate(words) if clock + n * harness.WORD_SECONDS >= start and clock + (n + 1) * harness.WORD_SECONDS <= end + 1e-9]
    return " ".join(kept), clock + len(words) * harness.WORD_SECONDS


EDGE_SILENCE_SECONDS = 0.3


def render_item(
    voice, segments: Sequence[Mapping], chapter: harness.Chapter, played: tuple[float, float], where: str
) -> np.ndarray:  # pragma: no cover - needs Piper
    rate = voice.config.sample_rate
    parts, clock = [np.zeros(int(EDGE_SILENCE_SECONDS * rate), dtype=np.int16)], 0.0
    for index, segment in enumerate(segments):
        piece, clock = _segment_texts(segment, chapter, clock, played, f"{where} segment {index}")
        if isinstance(piece, float):
            parts.append(np.zeros(int(piece * rate), dtype=np.int16))
        elif piece:
            parts.extend(np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16) for chunk in voice.synthesize(piece))
    parts.append(np.zeros(int(EDGE_SILENCE_SECONDS * rate), dtype=np.int16))
    return np.concatenate(parts)


def render_audio_corpus(voice_path: Path, out: Path, source: Path = harness.FIXTURE_DIR) -> list[Path]:  # pragma: no cover - needs Piper
    """Speak every case in `source` with a Piper voice into `out`, in the corpus layout
    (`manuscript.json`, `cases/*.json` with `audio` items, `audio/*.wav`). `out` must be outside
    the repository: the audio is never committed (Q15)."""
    if out.resolve().is_relative_to(REPOSITORY):
        raise ValueError(f"{out} is inside the repository; render the audio somewhere else")
    from piper.voice import PiperVoice

    voice = PiperVoice.load(str(voice_path))
    chapters = harness._load_chapters(source)
    (out / "cases").mkdir(parents=True, exist_ok=True)
    (out / "audio").mkdir(exist_ok=True)
    (out / "manuscript.json").write_bytes((source / "manuscript.json").read_bytes())
    written = []
    for path in sorted((source / "cases").glob("*.json")):
        spec = json.loads(path.read_text(encoding="utf-8"))
        chapter = chapters[spec["chapter"]]
        items = []
        for item in spec["recording"]["items"]:
            audio = out / "audio" / f"{spec['id']}-{item['id']}.wav"
            samples = render_item(voice, item["segments"], chapter, tuple(item.get("playedRange", (0.0, float("inf")))), f"{spec['id']} {item['id']}")
            with wave.open(str(audio), "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(voice.config.sample_rate)
                writer.writeframes(samples.tobytes())
            items.append({"id": item["id"], "audio": f"audio/{audio.name}"})
        case = {**spec, "recording": {"items": items}, "description": spec["description"] + " (Piper render)"}
        target = out / "cases" / path.name
        target.write_text(json.dumps(case, indent=2) + "\n", encoding="utf-8")
        written.append(target)
    return written


def transcript_errors(scripted: harness.Case, result: SidecarResult, words_dir: Path) -> dict[str, int]:
    """How the Whisper words differ from what was spoken: tokens dropped, swapped and added."""
    heard = []
    for item in result.items:
        words = coverage_mode.read_words_file(words_dir / f"{item['index']:03d}-{item['itemGuid']}.json")
        heard += [word[0] for word in (words.words if words else ())]
    said = engine.tokenize(" ".join(word.text for item in scripted.items for word in item.words))
    got = engine.tokenize(" ".join(heard))
    counts = {"said": len(said), "dropped": 0, "swapped": 0, "added": 0}
    for tag, i1, i2, j1, j2 in spike.sequence_matcher_opcodes(said, got):
        if tag == "delete":
            counts["dropped"] += i2 - i1
        elif tag == "insert":
            counts["added"] += j2 - j1
        elif tag == "replace":
            counts["swapped"] += min(i2 - i1, j2 - j1)
            counts["dropped"] += max(0, (i2 - i1) - (j2 - j1))
            counts["added"] += max(0, (j2 - j1) - (i2 - i1))
    return counts


# ---------------------------------------------------------------------------
# the reports


def _tally_cells(t: Tally) -> str:
    return f"{t.cases} | {t.false_met} | {t.false_not_met} | {t.complete_called_complete}/{t.complete}"


def _settings_text(s: Settings) -> str:
    return f"{s.min_paragraph_present:g}, {s.max_missing_run}, {s.max_misread_run}, {s.min_anchor_run}"


def synthetic_report(
    work: Path, grid: Mapping[str, tuple] = GRID, noises: Sequence[Noise] = NOISE_LEVELS, cases: Sequence[harness.Case] | None = None
) -> tuple[str, Settings]:
    cases = calibration_cases() if cases is None else cases
    candidates = grid_settings(grid)
    table = collect(cases, noises, sorted({s.alignment for s in candidates}), work)
    chosen = choose(table, cases, noises, candidates)
    lines = [
        f"Candidates: {len(candidates)}. Cases: {sum(c.split == 'tune' for c in cases)} tune, {sum(c.split == 'held_out' for c in cases)} held out.",
        f"Chosen (min_paragraph_present, max_missing_run, max_misread_run, min_anchor_run): {_settings_text(chosen)}",
        "",
        "| Settings | Noise | Split | Cases | False met | False not met | Complete called complete |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for label, settings in (("Proposed", PROPOSED), ("Chosen", chosen)):
        for noise in noises:
            for split in harness.SPLITS:
                lines.append(f"| {label} ({_settings_text(settings)}) | {noise.name} | {split} | {_tally_cells(tally(table, cases, noise, settings, split))} |")
    lines += ["", "| Settings | Split | Paragraph labels agreed | Regions located | Same kind |", "| --- | --- | --- | --- | --- |"]
    for label, settings in (("Proposed", PROPOSED), ("Chosen", chosen)):
        evaluation = labels(table, cases, noises[0], settings)
        for split in harness.SPLITS:
            s = evaluation.summary(split)
            lines.append(
                f"| {label} ({_settings_text(settings)}) | {split} | {s.paragraphs_agreed}/{s.paragraphs_total} | "
                f"{s.regions_located}/{s.regions_total} | {s.regions_kind_matched}/{s.regions_total} |"
            )
    safe = [s for s in candidates if is_safe(table, cases, noises, s)]
    lines += ["", f"{len(safe)} of {len(candidates)} candidates are safe: no false met on tune at any noise level and no chance-matched word credited.", ""]
    lines += sensitivity(table, cases, noises, chosen, grid)
    return "\n".join(lines), chosen


def sensitivity(table: ResultTable, cases: Sequence[harness.Case], noises: Sequence[Noise], around: Settings, grid: Mapping[str, tuple]) -> list[str]:
    """Each setting moved over its grid with the other three held at `around`: false met and
    complete chapters called complete, summed over the noise levels."""
    lines = [
        "| Setting | Value | False met (tune) | False met (held out) | Complete called complete (tune) | Complete called complete (held out) |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for name, values in grid.items():
        for value in values:
            settings = dataclasses.replace(around, **{name: value})
            cells = []
            for field in ("false_met", "complete_called_complete"):
                for split in harness.SPLITS:
                    cells.append(str(sum(getattr(tally(table, cases, noise, settings, split), field) for noise in noises)))
            complete = {split: sum(tally(table, cases, noise, settings, split).complete for noise in noises) for split in harness.SPLITS}
            cells[2] += f"/{complete['tune']}"
            cells[3] += f"/{complete['held_out']}"
            marker = " (chosen)" if value == getattr(around, name) else ""
            lines.append(f"| {name} | {value:g}{marker} | {' | '.join(cells)} |")
    return lines


def model_load_seconds(whisper: Whisper) -> float:  # pragma: no cover - needs a Whisper model
    """What loading the model costs a check: the sidecar loads it once a run."""
    started = time.perf_counter()
    coverage_mode._load_whisper_model(whisper.model, str(whisper.model_dir) if whisper.model_dir else None, whisper.device)
    return time.perf_counter() - started


def audio_report(corpus: Path, whispers: Sequence[Whisper], settings: Settings, work: Path) -> str:  # pragma: no cover - needs a Whisper model
    audio_cases = harness.load_corpus(corpus).cases
    scripted = {case.id: case for case in harness.load_corpus(harness.FIXTURE_DIR).cases}
    lines = [
        f"Settings: {_settings_text(settings)}",
        "",
        "| Model | Case | Split | Minutes | Seconds | Expected | Got | Present | Dropped | Swapped | Added |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for whisper in whispers:
        load = model_load_seconds(whisper)
        seconds = minutes = 0.0
        outcome = Tally()
        for case in audio_cases:
            words_dir = work / whisper.model / case.id
            result = with_stored_seconds(run_cli(case, corpus / "manuscript.json", words_dir, words_dir / "results.txt", settings, whisper), words_dir)
            got = text_complete(result, settings)
            outcome = outcome.add(case.expected.text_complete, got)
            played = result.summary["items"]["playedSeconds"] / 60
            seconds, minutes = seconds + result.seconds, minutes + played
            errors = transcript_errors(scripted[case.id], result, words_dir) if case.id in scripted else {}
            present = f"{result.summary['presentTokens']}/{result.summary['bodyTokens']}"
            lines.append(
                f"| {whisper.model} | {case.id} | {case.split} | {played:.2f} | {result.seconds:.1f} | {case.expected.text_complete} | {got} | {present} | "
                f"{errors.get('dropped', '')} | {errors.get('swapped', '')} | {errors.get('added', '')} |"
            )
        runs = len(audio_cases)
        lines.append(
            f"| {whisper.model} | all {outcome.cases}: false met {outcome.false_met}, false not met {outcome.false_not_met} | | {minutes:.2f} | "
            f"{seconds:.1f}: model load {load:.1f} a run, then {(seconds - runs * load) / minutes:.1f} per audio minute | | | | | | |"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# the model cascade (the calibration note's "Model cascade (Phase 1)")

WINDOW_MIN_SECONDS = 25.0
"""MC3: Whisper costs a 30-second block however little of it is audio, so a window shorter than
this costs as much as one this long (the `windows` benchmark)."""
WINDOW_PAST_BOUND_SECONDS = 3.0
"""MC3's "a few seconds past each bound": the window starts this far before the last matched word
before a gap and ends this far after the first matched word after it."""
WINDOW_MERGE_GAP_SECONDS = 20.0
"""MC3: two windows of one item less than this apart become one."""
WHOLE_CHAPTER_SHARE = 0.6
"""MC3: windows over this share of the chapter's played audio become one whole-chapter pass."""
SPLICE_EDGE_SECONDS = 0.5
"""Where a window cuts the audio, a word within this of the cut is left to the first pass: the
re-check may have heard only part of it."""
TIME_LIMIT_AGAINST_SMALL = 1.4
"""The Key Hypothesis: the cascade's total time within 40% of `small`'s."""


@dataclass(frozen=True)
class Target:
    """One chapter check: the host's manifest items, the manuscript, and the verdict it should get
    (None for an unlabelled real chapter)."""

    id: str
    manuscript: Path
    chapter_id: str
    items: tuple[coverage_mode.ManifestItem, ...]
    expected: bool | None


def case_target(case: harness.Case, manuscript: Path, words_dir: Path) -> Target:
    """A corpus case as a check: its manifest written as `write_inputs` writes it."""
    items = coverage_mode.read_manifest(write_inputs(case, words_dir))
    return Target(case.id, manuscript, case.chapter.id, items, case.expected.text_complete)


def manifest_target(target_id: str, manifest: Path, manuscript: Path, chapter_id: str) -> Target:
    """A chapter the host would check, from the manifest it would write."""
    return Target(target_id, manuscript, chapter_id, coverage_mode.read_manifest(manifest), None)


def write_manifest(target: Target, words_dir: Path) -> Path:
    words_dir.mkdir(parents=True, exist_ok=True)
    items = [
        {
            "index": item.index,
            "itemGuid": item.item_guid,
            "sourceFile": item.source_file,
            "startOffset": item.start_offset,
            "length": item.length,
            "wordsFile": item.words_file,
            "muted": item.muted,
        }
        for item in target.items
    ]
    manifest = words_dir / "manifest.json"
    manifest.write_text(json.dumps({"schemaVersion": coverage_mode.MANIFEST_SCHEMA_VERSION, "items": items}), encoding="utf-8")
    return manifest


def run_target(target: Target, words_dir: Path, settings: Settings, whisper: Whisper) -> SidecarResult:  # pragma: no cover - needs a Whisper model
    """`compare.py --coverage` over the target, reusing and timing its words cache."""
    write_manifest(target, words_dir)
    out = words_dir / "results.txt"
    return with_stored_seconds(_run_sidecar(target.id, _sidecar_args(target.chapter_id, target.manuscript, words_dir, out, settings, whisper), out), words_dir)


def read_item_words(target: Target, words_dir: Path) -> dict[int, coverage_mode.ItemWords]:
    """The words file of every played item, as a run over `words_dir` left them."""
    words = {}
    for item in target.items:
        if item.muted:
            continue
        found = coverage_mode.read_words_file(words_dir / item.words_file)
        if found is None:
            raise FileNotFoundError(f"{target.id}: no words file for item {item.index} in {words_dir}")
        words[item.index] = found
    return words


@dataclass(frozen=True)
class Aligned:
    """The chapter aligned to a set of words, as `coverage_mode.run` aligns it, with the item and
    source seconds of every joined transcript word."""

    coverage: coverage_model.ChapterCoverage
    alignment: dict
    timeline: coverage_mode._Timeline
    sources: tuple[tuple[int, float, float], ...]


def align_words(target: Target, words: Mapping[int, coverage_mode.ItemWords], settings: Settings) -> Aligned:
    """`coverage_mode.run`'s alignment over words already in hand (the sidecar module is Phase 2's
    to change, so its five alignment lines are repeated here; a test pins them to the sidecar)."""
    manuscript = str(target.manuscript)
    engine.register_project_equivalences(manuscript)
    chapter = coverage_mode._chapter(engine, manuscript, target.chapter_id)
    results = [
        coverage_mode._ItemResult(item, None, None, ())
        if item.muted
        else coverage_mode._ItemResult(item, "reused", words[item.index], tuple(coverage_mode.played_words(words[item.index], item)))
        for item in target.items
    ]
    timeline = coverage_mode._timeline(results)
    sources = tuple((result.item.index, start, end) for result in results if result.source for _text, start, end in result.played)
    heading = " ".join(part for part in (chapter["title"], chapter.get("subtitle") or "") if part)
    sentence_units, tokens, unit_idx, raw_words = engine.build_chapter_units({"title": heading, "paragraphs": chapter["paragraphs"]})
    _markers, _covered, alignment = engine.diff_and_build_markers(tokens, unit_idx, raw_words, timeline.words, 1)
    params = coverage_model.AlignmentParams(settings.max_misread_run, settings.min_anchor_run)
    coverage = coverage_model.compute_coverage(coverage_model.aligned_chapter_from_markers(alignment, sentence_units, chapter["paragraph_ids"]), params)
    return Aligned(coverage, alignment, timeline, sources)


def _thresholds(settings: Settings) -> coverage_model.Thresholds:
    return coverage_model.Thresholds(settings.min_paragraph_present, settings.max_missing_run)


def is_complete(coverage: coverage_model.ChapterCoverage, settings: Settings) -> bool:
    return coverage.text_complete(_thresholds(settings))


def failing_regions(coverage: coverage_model.ChapterCoverage, settings: Settings) -> tuple[coverage_model.Region, ...]:
    """The regions that make the chapter "not met": a run over `max_missing_run`, or a region in a
    paragraph that fails. None when the chapter is met: a "met" stands (the PRD's safety rule)."""
    if is_complete(coverage, settings):
        return ()
    failing = {paragraph.id for paragraph in coverage.paragraphs if not paragraph.passes(_thresholds(settings))}
    return tuple(region for region in coverage.regions if region.token_count > settings.max_missing_run or failing & set(region.paragraph_ids))


@dataclass(frozen=True)
class Bound:
    """A point in the audio: a played item and source seconds."""

    item: int
    time: float


@dataclass(frozen=True)
class Gap:
    """A region's audio bounds: the end of the last matched word before it and the start of the
    first matched word after it; None at a chapter edge."""

    before: Bound | None
    after: Bound | None


def region_gap(region: coverage_model.Region, aligned: Aligned) -> Gap:
    """A region's bounds from the alignment's `equal` opcodes on either side of its manuscript
    tokens, mapped through `index_map` to the joined transcript word and its item. Phase 2 emits
    these bounds from the sidecar; Phase 4 should read them from there instead."""
    before = after = None
    for tag, i1, i2, j1, j2 in aligned.alignment["opcodes"]:
        if tag != "equal":
            continue
        if i2 <= region.doc_start:
            before = j2 - 1
        elif i1 >= region.doc_end:
            after = j1
            break

    def bound(audio_index: int | None, edge: int) -> Bound | None:
        if audio_index is None:
            return None
        item, *times = aligned.sources[aligned.alignment["index_map"][audio_index]]
        return Bound(item, times[edge])

    return Gap(bound(before, 1), bound(after, 0))


@dataclass(frozen=True)
class Played:
    """An unmuted item's played range, in source seconds."""

    index: int
    start: float
    end: float


def played_ranges(target: Target) -> tuple[Played, ...]:
    return tuple(Played(item.index, item.start_offset, item.end) for item in target.items if not item.muted)


@dataclass(frozen=True)
class Span:
    """A window of one item's source audio to re-check."""

    item: int
    start: float
    end: float

    @property
    def seconds(self) -> float:
        return self.end - self.start


@dataclass(frozen=True)
class WindowPlan:
    spans: tuple[Span, ...]
    whole_chapter: bool

    @property
    def seconds(self) -> float:
        return sum(span.seconds for span in self.spans)


def _gap_spans(gap: Gap, played: Sequence[Played]) -> list[Span]:
    """A gap's bounds plus the margin past each, one slice per item it crosses; a missing bound
    runs to the chapter's edge."""
    position = {item.index: n for n, item in enumerate(played)}
    first = position[gap.before.item] if gap.before else 0
    last = position[gap.after.item] if gap.after else len(played) - 1
    start = gap.before.time - WINDOW_PAST_BOUND_SECONDS if gap.before else played[first].start
    end = gap.after.time + WINDOW_PAST_BOUND_SECONDS if gap.after else played[last].end
    spans = []
    for n in range(first, last + 1):
        item = played[n]
        span = Span(item.index, max(item.start, start) if n == first else item.start, min(item.end, end) if n == last else item.end)
        if span.seconds > 0:
            spans.append(span)
    return spans


def _padded(span: Span, item: Played) -> Span:
    """At least `WINDOW_MIN_SECONDS`, around the span's middle, shifted to stay inside the item."""
    if item.end - item.start <= WINDOW_MIN_SECONDS:
        return Span(item.index, item.start, item.end)
    if span.seconds >= WINDOW_MIN_SECONDS:
        return span
    extra = (WINDOW_MIN_SECONDS - span.seconds) / 2
    start, end = span.start - extra, span.end + extra
    if start < item.start:
        start, end = item.start, end + item.start - start
    if end > item.end:
        start, end = start - (end - item.end), item.end
    return Span(span.item, start, end)


def _merged(spans: Sequence[Span]) -> list[Span]:
    merged: list[Span] = []
    for span in sorted(spans, key=lambda s: s.start):
        if merged and span.start - merged[-1].end < WINDOW_MERGE_GAP_SECONDS:
            merged[-1] = Span(span.item, merged[-1].start, max(merged[-1].end, span.end))
        else:
            merged.append(span)
    return merged


def plan_windows(gaps: Sequence[Gap], played: Sequence[Played]) -> WindowPlan:
    """MC3's plan: each gap's bounds padded, merged per item, or the whole chapter when the windows
    would cover more than `WHOLE_CHAPTER_SHARE` of it. Items in play order."""
    raw = [span for gap in gaps for span in _gap_spans(gap, played)]
    spans = []
    for item in played:
        spans += _merged([_padded(span, item) for span in raw if span.item == item.index])
    plan = WindowPlan(tuple(spans), False)
    if plan.seconds > WHOLE_CHAPTER_SHARE * sum(item.end - item.start for item in played):
        return WindowPlan(tuple(Span(item.index, item.start, item.end) for item in played), True)
    return plan


Word = coverage_mode.Word


def splice(first: Sequence[Word], spans: Sequence[Span], recheck: Sequence[Sequence[Word]], played: Played) -> tuple[Word, ...]:
    """One item's words after a re-check: inside each window the re-check's words replace the first
    pass's, by word midpoint. Where a window cuts the audio (not at the item's own edge), the
    `SPLICE_EDGE_SECONDS` next to the cut stay the first pass's, so a word the cut split is neither
    lost nor counted twice."""

    def interior(span: Span) -> tuple[float, float]:
        start = span.start + (SPLICE_EDGE_SECONDS if span.start > played.start else 0.0)
        end = span.end - (SPLICE_EDGE_SECONDS if span.end < played.end else 0.0)
        return start, end

    inside = [interior(span) for span in spans]

    def rechecked(word: Word, zone: tuple[float, float]) -> bool:
        return zone[0] <= (word[1] + word[2]) / 2 <= zone[1]

    kept = [word for word in first if not any(rechecked(word, zone) for zone in inside)]
    new = [word for zone, words in zip(inside, recheck, strict=True) for word in words if rechecked(word, zone)]
    return tuple(sorted(kept + new, key=lambda word: (word[1], word[2])))


SpanTranscriber = Callable[[coverage_mode.ManifestItem, Span], tuple[coverage_mode.ItemWords, float]]
"""Transcribes one window of an item; returns its words (source seconds) and the seconds it took."""


@dataclass(frozen=True)
class Cascade:
    first: Aligned
    final: Aligned
    plan: WindowPlan
    words: Mapping[int, coverage_mode.ItemWords]
    recheck_seconds: float
    align_seconds: float
    first_complete: bool
    complete: bool


def cascade(target: Target, first_words: Mapping[int, coverage_mode.ItemWords], transcribe: SpanTranscriber, settings: Settings) -> Cascade:
    """The two-pass check: a "met" first pass stands; otherwise the failing regions' windows are
    re-checked, spliced in, and the chapter is aligned again by the unchanged rules."""
    first = align_words(target, first_words, settings)
    if is_complete(first.coverage, settings):
        return Cascade(first, first, WindowPlan((), False), dict(first_words), 0.0, 0.0, True, True)
    played = {item.index: item for item in played_ranges(target)}
    plan = plan_windows([region_gap(region, first) for region in failing_regions(first.coverage, settings)], tuple(played.values()))
    items = {item.index: item for item in target.items}
    rechecked: dict[int, list[tuple[Span, coverage_mode.ItemWords]]] = {}
    seconds = 0.0
    for span in plan.spans:
        words, took = transcribe(items[span.item], span)
        rechecked.setdefault(span.item, []).append((span, words))
        seconds += took
    spliced = dict(first_words)
    for index, pairs in rechecked.items():
        base = first_words[index]
        words = splice(base.words, [span for span, _ in pairs], [new.words for _, new in pairs], played[index])
        spliced[index] = dataclasses.replace(base, words=words, model=f"{base.model}+{pairs[0][1].model}")
    started = time.perf_counter()
    final = align_words(target, spliced, settings)
    return Cascade(first, final, plan, spliced, seconds, time.perf_counter() - started, False, is_complete(final.coverage, settings))


def cached_span_transcriber(directory: Path, inner: SpanTranscriber) -> SpanTranscriber:
    """Keeps each re-checked window's words and time in `directory`, so a repeated run transcribes
    nothing and still reports what the window cost."""

    def transcribe(item: coverage_mode.ManifestItem, span: Span) -> tuple[coverage_mode.ItemWords, float]:
        name = f"{span.item:03d}-{span.start:.3f}-{span.end:.3f}"
        words_path, seconds_path = directory / f"{name}.json", directory / f"{name}.seconds.json"
        cached = coverage_mode.read_words_file(words_path)
        if cached is not None and seconds_path.exists():
            return cached, json.loads(seconds_path.read_text(encoding="utf-8"))["seconds"]
        words, seconds = inner(item, span)
        coverage_mode.write_words_file(words_path, words)
        seconds_path.write_text(json.dumps({"seconds": seconds}), encoding="utf-8")
        return words, seconds

    return transcribe


def whisper_span_transcriber(whisper: Whisper, manuscript: Path) -> tuple[SpanTranscriber, float]:  # pragma: no cover - needs a Whisper model
    """The sidecar's own transcriber over windows, with the model loaded once for the run (as the
    re-check mode will): returns it and the seconds the load took."""
    started = time.perf_counter()
    model = coverage_mode._load_whisper_model(whisper.model, str(whisper.model_dir) if whisper.model_dir else None, whisper.device)
    load = time.perf_counter() - started
    hotwords = engine.load_vocabulary_hints(str(manuscript))
    transcriber = coverage_mode.WhisperTranscriber(engine, model_size=whisper.model, language=whisper.language, hotwords=hotwords, model_factory=lambda: model)

    def transcribe(item: coverage_mode.ManifestItem, span: Span) -> tuple[coverage_mode.ItemWords, float]:
        window = dataclasses.replace(item, start_offset=span.start, length=span.seconds)
        began = time.perf_counter()
        words = transcriber(window, lambda _seconds: None)
        return words, time.perf_counter() - began

    return transcribe, load


# reports ---------------------------------------------------------------------


@dataclass(frozen=True)
class Single:
    complete: bool
    seconds: float


@dataclass(frozen=True)
class CascadeRow:
    case_id: str
    expected: bool
    first: bool
    cascade: bool
    windows: int
    window_seconds: float
    whole_chapter: bool
    first_seconds: float
    recheck_seconds: float  # the re-check model's load (when it had windows) and its windows
    align_seconds: float
    singles: Mapping[str, Single]

    @property
    def total(self) -> float:
        return self.first_seconds + self.recheck_seconds + self.align_seconds


@dataclass(frozen=True)
class Hypothesis:
    go: bool
    false_met: int
    false_not_met: int
    large_false_not_met: int
    cascade_seconds: float
    small_seconds: float


def hypothesis(rows: Sequence[CascadeRow], small: str = "small", large: str = "large-v3-turbo") -> Hypothesis:
    """The PRD's Key Hypothesis on a corpus: no false met, no more false not met than the large
    model alone, and a total time within 40% of `small`'s."""
    ours, theirs = Tally(), Tally()
    for row in rows:
        ours, theirs = ours.add(row.expected, row.cascade), theirs.add(row.expected, row.singles[large].complete)
    seconds = sum(row.total for row in rows)
    small_seconds = sum(row.singles[small].seconds for row in rows)
    go = ours.false_met == 0 and ours.false_not_met <= theirs.false_not_met and seconds <= TIME_LIMIT_AGAINST_SMALL * small_seconds
    return Hypothesis(go, ours.false_met, ours.false_not_met, theirs.false_not_met, seconds, small_seconds)


def cascade_table(rows: Sequence[CascadeRow], settings: Settings, first: str = "tiny", recheck: str = "large-v3-turbo") -> str:
    singles = list(rows[0].singles) if rows else []
    lines = [
        f"Settings: {_settings_text(settings)}",
        "",
        f"| Case | Expected | {first} | Cascade | Windows | Window s | First pass s | Re-check s | Total s | "
        + " | ".join(f"{name} | {name} s" for name in singles)
        + " |",
        "| --- " * (9 + 2 * len(singles)) + "|",
    ]
    for row in rows:
        windows = f"{row.windows}{' (whole chapter)' if row.whole_chapter else ''}"
        cells = [row.case_id, row.expected, row.first, row.cascade, windows, f"{row.window_seconds:.0f}", f"{row.first_seconds:.1f}"]
        cells += [f"{row.recheck_seconds:.1f}", f"{row.total:.1f}"]
        cells += [cell for name in singles for cell in (row.singles[name].complete, f"{row.singles[name].seconds:.1f}")]
        lines.append("| " + " | ".join(str(cell) for cell in cells) + " |")
    small_seconds = sum(row.singles["small"].seconds for row in rows) if "small" in singles else 0.0
    methods = [(first, lambda r: r.first, lambda r: r.first_seconds), (f"cascade ({first} + {recheck})", lambda r: r.cascade, lambda r: r.total)]
    methods += [(name, lambda r, n=name: r.singles[n].complete, lambda r, n=name: r.singles[n].seconds) for name in singles]
    lines += ["", "| Method | Cases | False met | False not met | Seconds | Against small |", "| --- | --- | --- | --- | --- | --- |"]
    for name, verdict, seconds in methods:
        tally = Tally()
        for row in rows:
            tally = tally.add(row.expected, verdict(row))
        total = sum(seconds(row) for row in rows)
        share = f"{total / small_seconds:.0%}" if small_seconds else ""
        lines.append(f"| {name} | {tally.cases} | {tally.false_met} | {tally.false_not_met} | {total:.1f} | {share} |")
    result = hypothesis(rows)
    judged = (
        f"{'Go' if result.go else 'No-go'}: cascade false met {result.false_met}, false not met {result.false_not_met} "
        f"(large-v3-turbo alone {result.large_false_not_met}), {result.cascade_seconds:.1f} s against small's {result.small_seconds:.1f} s "
        f"(limit {TIME_LIMIT_AGAINST_SMALL * result.small_seconds:.1f} s)."
    )
    return "\n".join([*lines, "", judged])


@dataclass(frozen=True)
class FoundRegion:
    """A region without its words: kind, size, manuscript token range, and where it sits in the
    audio (the sidecar's `position`), so a report on private narration carries no text."""

    kind: str
    tokens: int
    doc_start: int
    doc_end: int
    item: int | None
    time: float | None


def found_regions(aligned: Aligned, regions: Sequence[coverage_model.Region] | None = None) -> tuple[FoundRegion, ...]:
    found = []
    for region in aligned.coverage.regions if regions is None else regions:
        position = coverage_mode._region_position(region, aligned.alignment, aligned.timeline)
        item, at = (position["itemIndex"], position["sourceTime"]) if position else (None, None)
        found.append(FoundRegion(region.kind, region.token_count, region.doc_start, region.doc_end, item, at))
    return tuple(found)


def region_agreement(ours: Sequence[FoundRegion], theirs: Sequence[FoundRegion]) -> tuple[int, list[FoundRegion], list[FoundRegion]]:
    """Regions are the same gap when their manuscript tokens overlap: how many of ours the other
    run found too, ours it did not, and its own we did not."""

    def overlap(a: FoundRegion, b: FoundRegion) -> bool:
        return a.doc_start < b.doc_end and b.doc_start < a.doc_end

    only_ours = [a for a in ours if not any(overlap(a, b) for b in theirs)]
    only_theirs = [b for b in theirs if not any(overlap(a, b) for a in ours)]
    return len(ours) - len(only_ours), only_ours, only_theirs


def position_text(region: FoundRegion) -> str:
    """Where to listen: the item in play order (1-based) and its source time."""
    if region.item is None or region.time is None:
        return "no audio"
    return f"item {region.item + 1} at {int(region.time // 60)}:{int(region.time % 60):02d}"


@dataclass(frozen=True)
class ChapterRun:
    name: str
    verdicts: Mapping[str, bool]
    regions: tuple[FoundRegion, ...]
    seconds: float
    windows: int | None = None
    window_seconds: float | None = None


def chapter_report(runs: Sequence[ChapterRun], reference: str) -> str:
    """An unlabelled chapter: each run's verdicts, regions and time, and its regions against the
    reference run's, with every disagreement as a place to listen."""
    ref = next(run for run in runs if run.name == reference)
    labels = list(ref.verdicts)
    lines = [
        f"| Run | {' | '.join(labels)} | Regions | Windows | Window s | Seconds | Also found by {reference} | Only this run | Only {reference} |",
        "| --- " * (len(labels) + 8) + "|",
    ]
    disagreements = []
    for run in runs:
        both, mine, theirs = region_agreement(run.regions, ref.regions)
        windows = "" if run.windows is None else run.windows
        window_seconds = "" if run.window_seconds is None else f"{run.window_seconds:.0f}"
        verdicts = " | ".join(str(run.verdicts[label]) for label in labels)
        lines.append(
            f"| {run.name} | {verdicts} | {len(run.regions)} | {windows} | {window_seconds} | {run.seconds:.1f} | {both} | {len(mine)} | {len(theirs)} |"
        )
        if run.name != reference and (mine or theirs):
            disagreements.append(f"\n{run.name} against {reference}:")
            disagreements += [f"- {position_text(r)}: {r.kind}, {r.tokens} words, found by {run.name} only" for r in mine]
            disagreements += [f"- {position_text(r)}: {r.kind}, {r.tokens} words, found by {reference} only" for r in theirs]
    return "\n".join(lines + disagreements)


def cascade_corpus_report(
    corpus: Path, whispers: Mapping[str, Whisper], first: str, recheck: str, settings_list: Sequence[Settings], work: Path
) -> str:  # pragma: no cover - needs Whisper models
    """The cascade over every case of a corpus, against each model alone (the `audio` words cache
    in `work` is reused, so a repeated run transcribes nothing)."""
    manuscript = corpus / "manuscript.json"
    cases = harness.load_corpus(corpus).cases
    transcribe, load = whisper_span_transcriber(whispers[recheck], manuscript)
    sections = []
    for settings in settings_list:
        rows = []
        for case in cases:
            target = case_target(case, manuscript, work / "targets" / case.id)
            singles = {name: run_target(target, work / name / case.id, settings, whisper) for name, whisper in whispers.items()}
            cached = cached_span_transcriber(work / f"recheck-{recheck}" / case.id, transcribe)
            outcome = cascade(target, read_item_words(target, work / first / case.id), cached, settings)
            windows, window_seconds = len(outcome.plan.spans), outcome.plan.seconds
            rows.append(
                CascadeRow(
                    case.id,
                    case.expected.text_complete,
                    outcome.first_complete,
                    outcome.complete,
                    windows,
                    window_seconds,
                    outcome.plan.whole_chapter,
                    singles[first].seconds,
                    outcome.recheck_seconds + (load if windows else 0.0),
                    outcome.align_seconds,
                    {name: Single(text_complete(result, settings), result.seconds) for name, result in singles.items() if name != first},
                )
            )
        sections.append(cascade_table(rows, settings, first, recheck))
    return f"Re-check model load: {load:.1f} s, charged to every case with a window.\n\n" + "\n\n".join(sections)


def cascade_chapter_report(
    target: Target, whispers: Mapping[str, Whisper], first: str, recheck: str, settings_list: Sequence[Settings], work: Path
) -> str:  # pragma: no cover - needs Whisper models and the audio
    """The cascade over one unlabelled chapter, against each model alone, with `recheck` alone as
    the reference. Prints positions, counts and times only: never a word of the chapter."""
    transcribe, load = whisper_span_transcriber(whispers[recheck], target.manuscript)
    results = {name: run_target(target, work / name / target.id, settings_list[0], whisper) for name, whisper in whispers.items()}
    words = {name: read_item_words(target, work / name / target.id) for name in whispers}
    sections = [f"Re-check model load: {load:.1f} s. Played audio: {sum(p.end - p.start for p in played_ranges(target)) / 60:.1f} minutes."]
    for settings in settings_list:
        label = _settings_text(settings)
        runs = []
        for name in whispers:
            aligned = align_words(target, words[name], settings)
            regions = found_regions(aligned, failing_regions(aligned.coverage, settings))
            runs.append(ChapterRun(name, {label: is_complete(aligned.coverage, settings)}, regions, results[name].seconds))
        outcome = cascade(target, words[first], cached_span_transcriber(work / f"recheck-{recheck}" / target.id, transcribe), settings)
        windows, window_seconds = len(outcome.plan.spans), outcome.plan.seconds
        seconds = results[first].seconds + outcome.recheck_seconds + (load if windows else 0.0) + outcome.align_seconds
        regions = found_regions(outcome.final, failing_regions(outcome.final.coverage, settings))
        runs.append(ChapterRun(f"cascade ({first} + {recheck})", {label: outcome.complete}, regions, seconds, windows, window_seconds))
        whole = " (whole chapter)" if outcome.plan.whole_chapter else ""
        sections.append(f"Settings {label}: cascade re-check {outcome.recheck_seconds:.1f} s over {windows} windows{whole}\n\n{chapter_report(runs, recheck)}")
    return "\n\n".join(sections)


# the window benchmark --------------------------------------------------------

BENCH_WINDOWS = (5, 10, 20, 30, 45, 60, 120, 240)
BENCH_REPEATS = 3
BENCH_STRIDE_SECONDS = 97.0


def bench_offsets(total: float, window: float, repeats: int, stride: float = BENCH_STRIDE_SECONDS) -> list[float]:
    """Where each repeat of a window starts: a different stretch of the audio each time."""
    if total <= window:
        return [0.0] * repeats
    return [(n * stride) % (total - window) for n in range(repeats)]


def windows_table(model: str, load: float, rows: Sequence[tuple[int, float]], three: float, one: float) -> str:
    lines = [
        f"{model}: model load {load:.1f} s (median of {BENCH_REPEATS})",
        "",
        "| Window (s) | Median (s) | Seconds per audio minute |",
        "| --- | --- | --- |",
    ]
    lines += [f"| {window} | {seconds:.1f} | {seconds / window * 60:.1f} |" for window, seconds in rows]
    lines += ["", f"Merging: three 10 s windows {three:.1f} s; one 60 s window over them {one:.1f} s"]
    return "\n".join(lines)


def _bench_transcribe(model, clip: np.ndarray, language: str | None) -> float:  # pragma: no cover - needs a Whisper model
    """Seconds to transcribe a clip with the sidecar's settings."""
    began = time.perf_counter()
    segments, _info = model.transcribe(clip, language=language, word_timestamps=True, vad_filter=True)
    for _segment in segments:  # the segments are a generator: transcription happens here
        pass
    return time.perf_counter() - began


def windows_report(corpus: Path, whispers: Sequence[Whisper]) -> str:  # pragma: no cover - needs Whisper models
    """Model load and transcription time by window length, with the sidecar's settings (int8 on
    the CPU, `vad_filter`, `word_timestamps`), over the corpus's audio joined end to end."""
    import statistics

    from faster_whisper import decode_audio

    rate = 16000
    audio = np.concatenate([decode_audio(str(path), sampling_rate=rate) for path in sorted((corpus / "audio").glob("*.wav"))])
    total = len(audio) / rate
    sections = [f"Audio: {total / 60:.1f} minutes; CPU threads: {os.cpu_count()}"]
    for whisper in whispers:
        loads = [model_load_seconds(whisper) for _ in range(BENCH_REPEATS)]
        model = coverage_mode._load_whisper_model(whisper.model, str(whisper.model_dir) if whisper.model_dir else None, whisper.device)

        def run(start: float, seconds: float, model=model, language=whisper.language) -> float:
            return _bench_transcribe(model, audio[int(start * rate) : int((start + seconds) * rate)], language)

        run(0.0, 5.0)  # warm-up, not timed
        rows = [(window, statistics.median([run(start, window) for start in bench_offsets(total, window, BENCH_REPEATS)])) for window in BENCH_WINDOWS]
        three = sum(run(start, 10.0) for start in (0.0, 25.0, 50.0))
        sections.append(windows_table(whisper.model, statistics.median(loads), rows, three, run(0.0, 60.0)))
    return "\n\n".join(sections)


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - a command line over the functions above
    parser = argparse.ArgumentParser(description="Calibrate the recording check's four settings on the synthetic fixtures.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("synthetic", help="sweep the settings over the committed and generated cases at every noise level")
    render = sub.add_parser("render-audio", help="speak the committed cases with a Piper voice into a corpus directory outside the repo")
    render.add_argument("--voice", type=Path, required=True, help="a Piper .onnx voice")
    render.add_argument("--out", type=Path, required=True)
    audio = sub.add_parser("audio", help="run the real sidecar and a Whisper model over a corpus directory")
    audio.add_argument("--corpus", type=Path, default=Path(os.environ.get(harness.CORPUS_ENV, "")) or None)
    audio.add_argument("--model", action="append", required=True, help="name=directory of a faster-whisper model, repeatable")
    audio.add_argument("--settings", default=_settings_text(PROPOSED), help="min_paragraph_present,max_missing_run,max_misread_run,min_anchor_run")
    audio.add_argument("--work", type=Path, default=None, help="where words files are kept between runs (default: a temporary directory)")
    cascade_cmd = sub.add_parser("cascade", help="simulate the two-model check over a corpus, or over one chapter from a host manifest")
    cascade_cmd.add_argument("--corpus", type=Path, default=Path(os.environ.get(harness.CORPUS_ENV, "")) or None)
    cascade_cmd.add_argument("--manifest", type=Path, help="a host coverage manifest: check this one unlabelled chapter instead of a corpus")
    cascade_cmd.add_argument("--manuscript", type=Path, help="with --manifest: the canonical manuscript.json")
    cascade_cmd.add_argument("--chapter-id", help="with --manifest: the manuscript chapter")
    cascade_cmd.add_argument("--model", action="append", required=True, help="name=directory of a faster-whisper model, repeatable; each also runs alone")
    cascade_cmd.add_argument("--first", default="tiny", help="the first-pass model (MC2)")
    cascade_cmd.add_argument("--recheck", default="large-v3-turbo", help="the re-check model (MC2), and the reference for an unlabelled chapter")
    cascade_cmd.add_argument("--settings", action="append", help="as for audio, repeatable (default: the Proposed and the shipped settings)")
    cascade_cmd.add_argument("--work", type=Path, required=True, help="the words cache, shared with `audio` (keep it outside the repository)")
    windows = sub.add_parser("windows", help="benchmark model load and transcription time by window length")
    windows.add_argument("--corpus", type=Path, default=Path(os.environ.get(harness.CORPUS_ENV, "")) or None)
    windows.add_argument("--model", action="append", required=True, help="name=directory of a faster-whisper model, repeatable")
    args = parser.parse_args(argv)
    if args.command == "render-audio":
        for path in render_audio_corpus(args.voice, args.out):
            print(path)
        return 0
    if args.command in ("cascade", "windows"):
        whispers = {name: Whisper(name, Path(directory)) for name, _, directory in (spec.partition("=") for spec in args.model)}
        if args.command == "windows":
            print(windows_report(args.corpus, list(whispers.values())))
            return 0
        settings_list = [_parse_settings(text) for text in args.settings] if args.settings else [PROPOSED, SHIPPED]
        if args.manifest:
            target = manifest_target(args.manifest.stem, args.manifest, args.manuscript, args.chapter_id)
            print(cascade_chapter_report(target, whispers, args.first, args.recheck, settings_list, args.work))
        else:
            print(cascade_corpus_report(args.corpus, whispers, args.first, args.recheck, settings_list, args.work))
        return 0
    with tempfile.TemporaryDirectory() as scratch:
        work = Path(scratch)
        if args.command == "synthetic":
            text, _chosen = synthetic_report(work)
            print(text)
            return 0
        whispers = [Whisper(name, Path(directory)) for name, _, directory in (spec.partition("=") for spec in args.model)]
        print(audio_report(args.corpus, whispers, _parse_settings(args.settings), args.work or work))
    return 0


def _parse_settings(text: str) -> Settings:  # pragma: no cover - the command line
    a, b, c, d = (part.strip() for part in text.split(","))
    return Settings(float(a), int(b), int(c), int(d))


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
