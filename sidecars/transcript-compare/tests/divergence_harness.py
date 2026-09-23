"""Evaluation harness for per-take divergence (take-review PRD Phase 9, Q10 as answered 2026-09-23).

Q10 asks whether diff plus ASR word timestamps (ADR 0008) localize where inside a take it goes
wrong precisely enough, or whether forced alignment is needed. The owner chose synthetic,
constructed fixtures over an annotated corpus: `fixtures/divergence/cases.json` holds a span of
manuscript and, per case, a scripted take with a known flub, restart, skip or substitution at a
known word. The protocol and the results are in `docs/research/take-divergence-evaluation.md`.

A script is planned against the span (which manuscript words each part reads, misreads, skips or
adds to) and gives the ground truth: every divergence as span words and a true time range. Two
ways to time the words said:

- `exact` and `jitter` (no audio, used by the tests): words at 150 a minute, and the same with every
  word boundary moved by up to `JITTER_SECONDS` to stand in for ASR timestamp error;
- `--asr DIR` (manual, needs a local faster-whisper model): the takes rendered to speech by
  `divergence_tts.ps1`, which records each word's true onset, then transcribed by Whisper exactly
  as the sidecar transcribes a take.

A divergence is *localized* when the analyzer reports the same kind over the same span words and
its time range overlaps the true one with both boundaries within `WORD_SECONDS` (one word at 150
words a minute): finer than that, forced alignment could not show the narrator a smaller sub-span.

Run it: `python sidecars/transcript-compare/tests/divergence_harness.py [--timing exact|jitter]
[--asr DIR --model-dir DIR]`.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import random
import statistics
import sys
import wave
import zlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

CORE = Path(__file__).resolve().parents[1] / "core"
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

import take_divergence as td

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "divergence" / "cases.json"
SCHEMA_VERSION = 1

WORD_SECONDS = 0.4
"""One word at 150 words a minute: the synthetic speaking rate and the localization limit."""
SPOKEN_FRACTION = 0.8
SENTENCE_PAUSE_SECONDS = 0.3
RESTART_PAUSE_SECONDS = 0.35
JITTER_SECONDS = 0.15
MIN_WORD_SECONDS = 0.05
VOICE_FRAME_SECONDS = 0.01
VOICE_FLOOR_DB = -35.0

SAYING = ("read", "misread", "extra", "restart")
SILENT = ("skip", "unread")
TRUTH_KIND = {"misread": td.MISREAD, "skip": td.SKIPPED, "unread": td.UNREAD, "extra": td.EXTRA, "restart": td.EXTRA}


class FixtureError(ValueError):
    """A case breaks the fixture format or does not read the span it names."""


def load_compare() -> ModuleType:
    spec = importlib.util.spec_from_file_location("transcript_compare_divergence_harness", CORE / "compare.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# cases and their plans


@dataclass(frozen=True)
class Case:
    id: str
    description: str
    first_unit: int
    last_unit: int
    script: tuple[dict, ...]


@dataclass(frozen=True)
class Said:
    text: str
    segment: int


@dataclass(frozen=True)
class Truth:
    """A divergence the script put there: span words (an extra's are the word it comes before, None
    at the end) and the script segment it came from, whose words' times give its true range."""

    kind: str
    label: str
    first_word: int | None
    last_word: int | None
    segment: int


@dataclass(frozen=True)
class Plan:
    case: Case
    span: td.Span
    said: tuple[Said, ...]
    truths: tuple[Truth, ...]


def load_cases(path: Path = FIXTURE) -> tuple[tuple[str, ...], tuple[Case, ...]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schemaVersion") != SCHEMA_VERSION:
        raise FixtureError(f"{path} is not schema version {SCHEMA_VERSION}")
    paragraphs = tuple(data["paragraphs"])
    cases = []
    for raw in data["cases"]:
        first, last = raw["span"]
        cases.append(Case(raw["id"], raw["description"], first, last, tuple(raw["script"])))
    ids = [case.id for case in cases]
    if len(set(ids)) != len(ids):
        raise FixtureError("Case ids must be unique")
    return paragraphs, tuple(cases)


def _segment_kind(segment: dict, where: str) -> str:
    kinds = [kind for kind in (*SAYING, *SILENT) if kind in segment]
    if len(kinds) != 1 or set(segment) - {kinds[0], "as"}:
        raise FixtureError(f"{where}: a segment is one of {SAYING + SILENT}, with an optional 'as'")
    if "as" in segment and kinds[0] not in ("read", "misread"):
        raise FixtureError(f"{where}: only read and misread take 'as'")
    if kinds[0] == "misread" and "as" not in segment:
        raise FixtureError(f"{where}: a misread says what was said instead with 'as'")
    return kinds[0]


def _spoken(engine: ModuleType, text: str) -> list[str]:
    return [raw for raw in text.split() if engine.tokenize(raw)]


def plan_case(engine: ModuleType, paragraphs: Sequence[str], case: Case) -> Plan:
    """Walk the script along the span: read, misread, skip and unread consume span words (which must
    be the span's own words, in order), extra and restart consume none. Span words left after the
    last segment are unread."""
    span = td.build_span(engine, paragraphs, case.first_unit, case.last_unit)
    said: list[Said] = []
    truths: list[Truth] = []
    position = 0
    for index, segment in enumerate(case.script):
        where = f"case {case.id} segment {index}"
        kind = _segment_kind(segment, where)
        text = segment[kind]
        if kind in ("extra", "restart"):
            anchor = position if position < len(span.words) else None
            truths.append(Truth(td.EXTRA, kind, anchor, anchor, index))
            said.extend(Said(word, index) for word in _spoken(engine, text))
            continue
        consumed = _spoken(engine, text)
        expected = span.words[position : position + len(consumed)]
        if [engine.tokenize(w) for w in consumed] != [list(w.tokens) for w in expected]:
            raise FixtureError(f"{where}: '{text}' is not the span's next {len(consumed)} word(s)")
        if kind != "read":
            truths.append(Truth(TRUTH_KIND[kind], kind, position, position + len(consumed) - 1, index))
        if kind in ("read", "misread"):
            said.extend(Said(word, index) for word in _spoken(engine, segment.get("as", text)))
        position += len(consumed)
    if position < len(span.words):
        truths.append(Truth(td.UNREAD, "unread", position, len(span.words) - 1, len(case.script)))
    return Plan(case, span, tuple(said), tuple(truths))


# ---------------------------------------------------------------------------
# timing the words said


Times = tuple[tuple[float, float], ...]


def exact_times(plan: Plan) -> Times:
    """150 words a minute, a pause after a sentence and after a false start."""
    times = []
    clock = 0.0
    for i, word in enumerate(plan.said):
        times.append((round(clock, 3), round(clock + WORD_SECONDS * SPOKEN_FRACTION, 3)))
        clock += WORD_SECONDS
        if word.text.rstrip("”\"'").endswith((".", "!", "?")):
            clock += SENTENCE_PAUSE_SECONDS
        next_segment = plan.said[i + 1].segment if i + 1 < len(plan.said) else None
        if plan.case.script[word.segment].get("restart") and next_segment != word.segment:
            clock += RESTART_PAUSE_SECONDS
    return tuple(times)


def jittered_times(plan: Plan) -> Times:
    """Exact times with every boundary moved by up to JITTER_SECONDS (seeded by the case id), kept
    in order: a stand-in for ASR word-timestamp error."""
    rng = random.Random(zlib.crc32(plan.case.id.encode("utf-8")))
    times = []
    floor = 0.0
    for start, end in exact_times(plan):
        start = max(floor, start + rng.uniform(-JITTER_SECONDS, JITTER_SECONDS))
        end = max(start + MIN_WORD_SECONDS, end + rng.uniform(-JITTER_SECONDS, JITTER_SECONDS))
        times.append((round(start, 3), round(end, 3)))
        floor = start
    return tuple(times)


TIMINGS: dict[str, Callable[[Plan], Times]] = {"exact": exact_times, "jitter": jittered_times}


def transcript_of(plan: Plan, times: Times) -> list[td.Word]:
    return [(word.text, start, end) for word, (start, end) in zip(plan.said, times)]


def truth_range(plan: Plan, times: Times, truth: Truth) -> tuple[float, float] | None:
    """A said divergence spans its own words; a skip is the pause between the words around it; an
    unread stretch has no time."""
    if truth.kind == td.UNREAD:
        return None
    own = [times[i] for i, word in enumerate(plan.said) if word.segment == truth.segment]
    if own:
        return own[0][0], own[-1][1]
    before = [times[i][1] for i, word in enumerate(plan.said) if word.segment < truth.segment]
    after = [times[i][0] for i, word in enumerate(plan.said) if word.segment > truth.segment]
    point_before = before[-1] if before else (after[0] if after else 0.0)
    point_after = after[0] if after else point_before
    return min(point_before, point_after), max(point_before, point_after)  # words that overlap leave no pause


# ---------------------------------------------------------------------------
# scoring


@dataclass(frozen=True)
class Outcome:
    truth: Truth
    true_range: tuple[float, float] | None
    found: td.Divergence | None
    words_ok: bool
    time_ok: bool
    boundary_error: float | None

    @property
    def localized(self) -> bool:
        return self.words_ok and self.time_ok


@dataclass(frozen=True)
class CaseResult:
    plan: Plan
    outcomes: tuple[Outcome, ...]
    false_positives: tuple[td.Divergence, ...]


def _same_words(truth: Truth, found: td.Divergence, span_length: int) -> bool:
    if found.kind != truth.kind:
        return False
    if truth.kind == td.EXTRA:  # which copy of a repeated word is the extra is the diff's choice
        anchor = span_length if truth.first_word is None else truth.first_word
        found_anchor = span_length if found.first_word is None else found.first_word
        return abs(anchor - found_anchor) <= 1
    return found.first_word <= truth.last_word and truth.first_word <= found.last_word


def _time(truth_range_: tuple[float, float] | None, found: td.Divergence) -> tuple[bool, float | None]:
    if truth_range_ is None:
        return found.start is None, None
    if found.start is None or found.end is None:
        return False, None
    true_start, true_end = truth_range_
    error = max(abs(found.start - true_start), abs(found.end - true_end))
    # A skip is a point in time (the pause where words were left out): its distance is what counts.
    points = true_start == true_end or found.start == found.end
    overlaps = points or (found.start <= true_end + 1e-9 and found.end >= true_start - 1e-9)
    return overlaps and error <= WORD_SECONDS + 1e-9, error


def score(plan: Plan, times: Times, alignment: td.TakeAlignment) -> CaseResult:
    unclaimed = list(alignment.divergences)
    outcomes = []
    for truth in plan.truths:
        true_range = truth_range(plan, times, truth)
        candidates = [d for d in unclaimed if _same_words(truth, d, len(plan.span.words))]
        best = None
        for candidate in candidates:
            time_ok, error = _time(true_range, candidate)
            key = (not time_ok, error if error is not None else 0.0)
            if best is None or key < best[0]:
                best = (key, candidate, time_ok, error)
        if best is None:
            outcomes.append(Outcome(truth, true_range, None, False, False, None))
            continue
        unclaimed.remove(best[1])
        outcomes.append(Outcome(truth, true_range, best[1], True, best[2], best[3]))
    return CaseResult(plan, tuple(outcomes), tuple(unclaimed))


def evaluate(engine: ModuleType, plan: Plan, transcript: Sequence[td.Word], times: Times) -> CaseResult:
    return score(plan, times, td.align_take(engine, plan.span, transcript))


def run_synthetic(engine: ModuleType, timing: str, path: Path = FIXTURE) -> list[CaseResult]:
    paragraphs, cases = load_cases(path)
    results = []
    for case in cases:
        plan = plan_case(engine, paragraphs, case)
        times = TIMINGS[timing](plan)
        results.append(evaluate(engine, plan, transcript_of(plan, times), times))
    return results


# ---------------------------------------------------------------------------
# real ASR over rendered speech


def tts_text(plan: Plan) -> tuple[str, tuple[int, ...]]:
    """The text to speak, with each said word's character offset in it; a false start ends in a
    comma so the voice pauses as a narrator would."""
    parts = []
    offsets = []
    cursor = 0
    for i, word in enumerate(plan.said):
        text = word.text
        last_of_restart = plan.case.script[word.segment].get("restart") and (i + 1 == len(plan.said) or plan.said[i + 1].segment != word.segment)
        if last_of_restart:
            text += ","
        offsets.append(cursor)
        parts.append(text)
        cursor += len(text) + 1
    return " ".join(parts), tuple(offsets)


def voiced_frames(wav: Path) -> tuple[tuple[bool, ...], float]:
    """Which VOICE_FRAME_SECONDS frames of a 16-bit mono WAV hold speech: RMS within
    VOICE_FLOOR_DB of the loudest frame."""
    import numpy as np

    with wave.open(str(wav), "rb") as w:
        rate = w.getframerate()
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64)
    size = max(1, round(rate * VOICE_FRAME_SECONDS))
    count = len(samples) // size
    rms = np.sqrt(np.mean(samples[: count * size].reshape(count, size) ** 2, axis=1)) if count else np.zeros(0)
    peak = float(rms.max()) if count else 0.0
    floor = peak * 10 ** (VOICE_FLOOR_DB / 20)
    return tuple(bool(value > floor) for value in rms), size / rate


def onset_times(plan: Plan, events: Sequence[dict], voiced: Sequence[bool], frame_seconds: float) -> Times:
    """True word times from the voice's own word events: a said word starts at the event that
    starts inside it and ends where the audio before the next word's onset (or the end of the audio)
    last holds speech, so a pause after it is not counted as part of it."""
    _text, offsets = tts_text(plan)
    starts = []
    for i, offset in enumerate(offsets):
        limit = offsets[i + 1] if i + 1 < len(offsets) else 1 << 30
        inside = [e["start"] for e in events if offset <= e["char"] < limit]
        if not inside:
            raise FixtureError(f"case {plan.case.id}: the voice reported no word at '{plan.said[i].text}'")
        starts.append(min(inside))
    times = []
    for i, start in enumerate(starts):
        stop = starts[i + 1] if i + 1 < len(starts) else len(voiced) * frame_seconds
        first, last = int(start / frame_seconds), int(stop / frame_seconds)
        spoken = [f for f in range(first, min(last, len(voiced))) if voiced[f]]
        end = (spoken[-1] + 1) * frame_seconds if spoken else stop
        times.append((round(start, 3), round(max(start, min(end, stop)), 3)))
    return tuple(times)


def run_asr(
    engine: ModuleType, audio_dir: Path, model: str, model_dir: str | None, hotwords: str | None = None, path: Path = FIXTURE
) -> list[tuple[CaseResult, list[td.Word]]]:
    """Transcribe each rendered case as the sidecar transcribes a take and score it against the
    voice's true word times."""
    paragraphs, cases = load_cases(path)
    results = []
    for case in cases:
        plan = plan_case(engine, paragraphs, case)
        wav = audio_dir / f"{case.id}.wav"
        events = json.loads((audio_dir / f"{case.id}.json").read_text(encoding="utf-8-sig"))
        voiced, frame_seconds = voiced_frames(wav)
        times = onset_times(plan, events, voiced, frame_seconds)
        audio = engine.decode_segment(str(wav), 0.0, len(voiced) * frame_seconds)
        words = engine.transcribe(audio, model, "en", "cpu", hotwords=hotwords, model_dir=model_dir)
        transcript = [(text, float(start), float(end)) for text, start, end in words]
        results.append((evaluate(engine, plan, transcript, times), transcript))
    return results


def write_tts_plan(engine: ModuleType, out: Path, path: Path = FIXTURE) -> None:
    """The texts `divergence_tts.ps1` speaks, one per case."""
    paragraphs, cases = load_cases(path)
    items = [{"id": case.id, "text": tts_text(plan_case(engine, paragraphs, case))[0]} for case in cases]
    out.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------------------------------------------------------------------------
# the report


def _fmt(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}"


def summarize(results: Sequence[CaseResult]) -> dict:
    outcomes = [o for r in results for o in r.outcomes]
    errors = [o.boundary_error for o in outcomes if o.words_ok and o.boundary_error is not None]
    return {
        "cases": len(results),
        "expected": len(outcomes),
        "wordsLocalized": sum(o.words_ok for o in outcomes),
        "localized": sum(o.localized for o in outcomes),
        "falsePositives": sum(len(r.false_positives) for r in results),
        "cleanCasesWithFalsePositives": sum(1 for r in results if not r.plan.truths and r.false_positives),
        "medianBoundaryError": round(statistics.median(errors), 3) if errors else None,
        "maxBoundaryError": round(max(errors), 3) if errors else None,
    }


def report(results: Sequence[CaseResult]) -> str:
    lines = [f"{'case':<28} {'truth':<9} {'words':<11} {'found':<18} {'true s':>13} {'found s':>13} {'err':>5}  ok"]
    for result in results:
        for o in result.outcomes:
            t = o.truth
            words = f"{t.first_word}-{t.last_word}"
            found = f"{o.found.kind} {o.found.first_word}-{o.found.last_word}" if o.found else "MISSED"
            true_s = "-" if o.true_range is None else f"{o.true_range[0]:.2f}-{o.true_range[1]:.2f}"
            found_s = "-" if o.found is None or o.found.start is None else f"{o.found.start:.2f}-{o.found.end:.2f}"
            ok = "yes" if o.localized else "NO"
            lines.append(f"{result.plan.case.id:<28} {t.label:<9} {words:<11} {found:<18} {true_s:>13} {found_s:>13} {_fmt(o.boundary_error):>5}  {ok}")
        for d in result.false_positives:
            lines.append(
                f"{result.plan.case.id:<28} {'FALSE +':<9} {'':<11} {d.kind + ' ' + str(d.first_word):<18} {'':>13} {_fmt(d.start):>13} '{d.audio_text or d.manuscript_text}'"
            )
        if not result.outcomes and not result.false_positives:
            lines.append(f"{result.plan.case.id:<28} (clean: nothing expected, nothing found)")
    lines.append(json.dumps(summarize(results)))
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--timing", choices=sorted(TIMINGS), default="exact")
    ap.add_argument("--tts-plan", type=Path, help="Write the texts divergence_tts.ps1 speaks to this file and stop")
    ap.add_argument("--asr", type=Path, help="Directory of <case>.wav and <case>.json rendered by divergence_tts.ps1")
    ap.add_argument("--model", default="small")
    ap.add_argument("--model-dir", default=None, help="A local faster-whisper model directory (no download)")
    ap.add_argument("--hotwords", default=None, help="Vocabulary hints passed to Whisper, as a project's vocabulary_hints.txt is")
    args = ap.parse_args(argv)
    engine = load_compare()
    if args.tts_plan:
        write_tts_plan(engine, args.tts_plan)
        return 0
    if args.asr:
        pairs = run_asr(engine, args.asr, args.model, args.model_dir, args.hotwords)
        for result, transcript in pairs:
            print(f"# {result.plan.case.id}: {' '.join(w for w, _s, _e in transcript)}")
        print(report([result for result, _t in pairs]))
        return 0
    print(report(run_synthetic(engine, args.timing)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
