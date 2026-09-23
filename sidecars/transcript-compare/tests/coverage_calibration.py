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

Run it: `uv run python sidecars/transcript-compare/tests/coverage_calibration.py synthetic` prints
the tables of the research note; `render-audio` and `audio` are the optional audio runs.
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
from collections.abc import Iterable, Mapping, Sequence
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
    args = [
        "--coverage",
        "--manifest", str(words_dir / "manifest.json"),
        "--manuscript", str(manuscript),
        "--chapter-id", case.chapter.id,
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
    started = time.perf_counter()
    done = subprocess.run(
        [sys.executable, str(SIDECAR), *_args(case, manuscript, words_dir, out, settings, whisper)], capture_output=True, text=True, check=False
    )
    seconds = time.perf_counter() - started
    if done.returncode != 0:
        raise RuntimeError(f"{case.id}: the sidecar exited with {done.returncode}: {done.stderr[-2000:]}")
    return read_results(out, seconds)


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
            result = run_cli(case, corpus / "manuscript.json", words_dir, words_dir / "results.txt", settings, whisper)
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
    args = parser.parse_args(argv)
    if args.command == "render-audio":
        for path in render_audio_corpus(args.voice, args.out):
            print(path)
        return 0
    with tempfile.TemporaryDirectory() as scratch:
        work = Path(scratch)
        if args.command == "synthetic":
            text, _chosen = synthetic_report(work)
            print(text)
            return 0
        a, b, c, d = (part.strip() for part in args.settings.split(","))
        settings = Settings(float(a), int(b), int(c), int(d))
        whispers = [Whisper(name, Path(directory)) for name, _, directory in (spec.partition("=") for spec in args.model)]
        print(audio_report(args.corpus, whispers, settings, args.work or work))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
