"""Ground-truth harness for recording coverage.

docs/utilities/recording-coverage.md, ADR 0125 (D12, Q15 as amended 2026-09-23): no
coverage threshold ships before it is scored against labeled chapters. The labeled set is
synthetic for now: `fixtures/coverage/` holds a public-domain (and one constructed) manuscript
and one JSON case per scripted recording, each with per-paragraph labels and the expected
chapter verdict. The protocol, the case format and the labeling rules are in
`docs/research/recording-coverage-fixtures.md`.

A scripted recording is rendered into timed transcript words (a perfect transcript: what the
narrator said, as a transcriber would write it), so any analyzer that takes transcript words can
be scored without audio. A permissioned corpus with real audio, kept outside the repository, joins
the set through the `NARRATION_COVERAGE_CORPUS` directory variable; its audio cases are skipped by
analyzers that cannot hear.

Run it: `python sidecars/transcript-compare/tests/coverage_harness.py [--strict] [--corpus-only]`.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

if __package__ in (None, ""):  # run as a script: make narration_common importable
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "libs" / "python"))

from narration_common import manuscript as canonical_manuscript

SCHEMA_VERSION = 1
CORPUS_ENV = "NARRATION_COVERAGE_CORPUS"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "coverage"

LABELS = ("present", "partial", "missing")
REGION_KINDS = ("head", "tail", "skip", "short_read", "different_text")
SPLITS = ("tune", "held_out")
# The conditions the PRD's Phase 1 lists, plus three it names elsewhere (misread, unrelated speech
# for chance matches, and text the item's trim hides). Every one needs a committed case.
CONDITIONS = (
    "complete",
    "truncated_tail",
    "late_start",
    "skipped_paragraph",
    "skipped_sentence",
    "retakes_and_false_starts",
    "repeated_refrain",
    "title_omitted",
    "title_read",
    "subtitle_read",
    "pickup_at_end",
    "multiple_items_trimmed",
    "names_and_numbers",
    "misread",
    "unrelated_speech",
    "trimmed_out_text",
)
# Synthetic speaking rate: one word per 0.4 s (150 words a minute).
WORD_SECONDS = 0.4
TIME_DECIMALS = 3
# Summed float word times may land a hair past a played-range end they touch exactly.
_TIME_TOLERANCE = 1e-9

# The stub's paragraph thresholds: share of a paragraph's words heard anywhere.
STUB_PRESENT = 0.95
STUB_PARTIAL = 0.5

_SENTENCE_END = re.compile(r"(?<=[.!?][\"')\]])\s+|(?<=[.!?])\s+")
_NON_WORD = re.compile(r"[^\w']+")


class FixtureError(ValueError):
    """A case, a manuscript or an analyzer report breaks the fixture format."""


class NeedsAudio(Exception):
    """The analyzer cannot score a case whose items are audio files, not transcript words."""


@dataclass(frozen=True)
class Paragraph:
    id: str
    text: str


@dataclass(frozen=True)
class Chapter:
    id: str
    title: str
    subtitle: str
    paragraphs: tuple[Paragraph, ...]

    def paragraph(self, paragraph_id: str) -> Paragraph | None:
        return next((paragraph for paragraph in self.paragraphs if paragraph.id == paragraph_id), None)


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Item:
    """One REAPER item's played range: transcript words (scripted) or an audio file (corpus)."""

    id: str
    words: tuple[Word, ...] | None
    audio: Path | None


@dataclass(frozen=True)
class Region:
    kind: str
    paragraphs: tuple[str, ...]


@dataclass(frozen=True)
class Report:
    """A chapter verdict with per-paragraph labels and regions: a case's truth or an analyzer's answer."""

    text_complete: bool
    paragraphs: Mapping[str, str]
    regions: tuple[Region, ...]


@dataclass(frozen=True)
class Case:
    id: str
    chapter: Chapter
    conditions: tuple[str, ...]
    split: str
    description: str
    items: tuple[Item, ...]
    expected: Report


@dataclass(frozen=True)
class Corpus:
    directory: Path
    cases: tuple[Case, ...]


Analyzer = Callable[[Chapter, tuple[Item, ...]], Report]


# ---------------------------------------------------------------------------
# rendering a scripted recording


def split_sentences(text: str) -> list[str]:
    """Sentences for `"sentences"` ranges: split after . ! or ? (and any closing quote)."""
    return [sentence for sentence in _SENTENCE_END.split(text.strip()) if sentence]


def _segment_words(segment: Mapping, chapter: Chapter, where: str) -> list[str]:
    paragraph = chapter.paragraph(segment["read"])
    if paragraph is None:
        raise FixtureError(f"{where}: unknown paragraph {segment['read']!r}")
    if "sentences" in segment and "words" in segment:
        raise FixtureError(f"{where}: a read takes sentences or words, not both")
    text = segment.get("as", paragraph.text)
    if "sentences" in segment:
        return " ".join(_slice(split_sentences(text), segment["sentences"], where)).split()
    return _slice(text.split(), segment.get("words", [0, None]), where)


def _slice(values: list[str], bounds: Sequence, where: str) -> list[str]:
    start, end = bounds[0], len(values) if bounds[1] is None else bounds[1]
    if not (0 <= start < end <= len(values)):
        raise FixtureError(f"{where}: range {list(bounds)} is outside 0..{len(values)}")
    return values[start:end]


def _render_segments(segments: Sequence[Mapping], chapter: Chapter, where: str) -> list[Word]:
    """Words at source times, one after another at WORD_SECONDS each; pauses add silence."""
    clock, words = 0.0, []
    for index, segment in enumerate(segments):
        at = f"{where} segment {index}"
        if "pause" in segment:
            if not isinstance(segment["pause"], (int, float)) or segment["pause"] < 0:
                raise FixtureError(f"{at}: pause must be a non-negative number of seconds")
            clock += segment["pause"]
            continue
        if "read" in segment:
            texts = _segment_words(segment, chapter, at)
        elif "say" in segment:
            texts = str(segment["say"]).split()
        else:
            raise FixtureError(f"{at}: a segment is read, say or pause")
        for text in texts:
            words.append(Word(text, clock, clock + WORD_SECONDS))
            clock += WORD_SECONDS
    return words


def _played(words: list[Word], played_range: Sequence | None, where: str) -> tuple[Word, ...]:
    """Only the words wholly inside the item's played range, timed from its start."""
    start, end = played_range if played_range is not None else (0.0, math.inf)
    if not (0 <= start < end):
        raise FixtureError(f"{where}: playedRange must be [start, end] with 0 <= start < end")
    return tuple(
        Word(w.text, round(w.start - start, TIME_DECIMALS), round(w.end - start, TIME_DECIMALS))
        for w in words
        if w.start >= start and w.end <= end + _TIME_TOLERANCE
    )


def _load_item(spec: Mapping, chapter: Chapter, directory: Path, where: str) -> Item:
    if ("segments" in spec) == ("audio" in spec):
        raise FixtureError(f"{where}: an item has exactly one of segments or audio")
    if "audio" in spec:
        audio = (directory / spec["audio"]).resolve()
        if not audio.is_relative_to(directory.resolve()):
            raise FixtureError(f"{where}: audio must stay inside the corpus directory")
        return Item(spec["id"], None, directory / spec["audio"])
    words = _render_segments(spec["segments"], chapter, where)
    return Item(spec["id"], _played(words, spec.get("playedRange"), where), None)


# ---------------------------------------------------------------------------
# loading and validating


def _load_chapters(directory: Path) -> dict[str, Chapter]:
    try:
        data = canonical_manuscript.load_file(directory / "manuscript.json")
    except canonical_manuscript.ManuscriptError as exc:
        raise FixtureError(f"{directory}: the manuscript cannot be read ({exc})") from exc
    paragraphs: dict[str, list[Paragraph]] = {}
    for paragraph in sorted(data["paragraphs"], key=lambda record: record.get("index", 0)):
        paragraphs.setdefault(paragraph["chapterId"], []).append(Paragraph(paragraph["id"], paragraph["text"]))
    return {
        chapter["id"]: Chapter(chapter["id"], chapter.get("title", ""), chapter.get("subtitle", ""), tuple(paragraphs.get(chapter["id"], ())))
        for chapter in data["chapters"]
        if chapter.get("contentKind", "narration") == "narration"  # the targets compare.py loads (PRD Q4)
    }


def _load_expected(spec: Mapping, chapter: Chapter, where: str) -> Report:
    labels = dict(spec.get("paragraphs", {}))
    if set(labels) != {paragraph.id for paragraph in chapter.paragraphs}:
        raise FixtureError(f"{where}: expected labels must name every paragraph of {chapter.id} and no other")
    if any(label not in LABELS for label in labels.values()):
        raise FixtureError(f"{where}: a paragraph label is one of {', '.join(LABELS)}")
    regions = tuple(_load_region(region, labels, where) for region in spec.get("regions", []))
    complete = all(label == "present" for label in labels.values())
    if spec.get("textComplete") is not complete:
        raise FixtureError(f"{where}: textComplete must be true exactly when every paragraph is present")
    covered = {paragraph for region in regions for paragraph in region.paragraphs}
    uncovered = [pid for pid, label in labels.items() if label != "present" and pid not in covered]
    if uncovered:
        raise FixtureError(f"{where}: {', '.join(uncovered)} not covered by a region")
    return Report(complete, MappingProxyType(labels), regions)


def _load_region(spec: Mapping, labels: Mapping[str, str], where: str) -> Region:
    if spec.get("kind") not in REGION_KINDS:
        raise FixtureError(f"{where}: region kind is one of {', '.join(REGION_KINDS)}")
    paragraphs = tuple(spec.get("paragraphs", ()))
    if not paragraphs or any(pid not in labels for pid in paragraphs):
        raise FixtureError(f"{where}: region paragraphs must be a non-empty list of the chapter's paragraphs")
    if any(labels[pid] == "present" for pid in paragraphs):
        raise FixtureError(f"{where}: a region names a present paragraph")
    return Region(spec["kind"], paragraphs)


def _check_header(spec: Mapping, path: Path, chapters: Mapping[str, Chapter]) -> None:
    where = path.name
    if spec.get("schemaVersion") != SCHEMA_VERSION:
        raise FixtureError(f"{where}: schemaVersion must be {SCHEMA_VERSION}")
    if spec.get("id") != path.stem:
        raise FixtureError(f"{where}: the case id must equal the file name")
    if spec.get("chapter") not in chapters:
        raise FixtureError(f"{where}: unknown chapter {spec.get('chapter')!r}")
    conditions = spec.get("conditions") or []
    if not conditions:
        raise FixtureError(f"{where}: conditions must list at least one condition")
    unknown = [condition for condition in conditions if condition not in CONDITIONS]
    if unknown:
        raise FixtureError(f"{where}: unknown condition {', '.join(unknown)}")
    if spec.get("split") not in SPLITS:
        raise FixtureError(f"{where}: split is one of {', '.join(SPLITS)}")


def _load_case(path: Path, directory: Path, chapters: Mapping[str, Chapter]) -> Case:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise FixtureError(f"{path.name}: cannot be read as JSON ({exc})") from exc
    _check_header(spec, path, chapters)
    return build_case(spec, chapters[spec["chapter"]], directory, path.name)


def build_case(spec: Mapping, chapter: Chapter, directory: Path = FIXTURE_DIR, where: str | None = None) -> Case:
    """A case from its JSON form, for one chapter: renders the recording and checks the labels.

    `load_corpus` uses it for committed files; generated cases (the Phase 2 spike's stress set)
    use it directly, so they obey the same labeling rules."""
    where = where or str(spec.get("id"))
    item_specs = spec.get("recording", {}).get("items") or []
    if not item_specs:
        raise FixtureError(f"{where}: the recording needs at least one item in items")
    ids = [item.get("id") for item in item_specs]
    if len(ids) != len(set(ids)):
        raise FixtureError(f"{where}: duplicate item id")
    items = tuple(_load_item(item, chapter, directory, f"{where} item {item.get('id')}") for item in item_specs)
    expected = _load_expected(spec.get("expected", {}), chapter, where)
    return Case(spec["id"], chapter, tuple(spec["conditions"]), spec["split"], spec.get("description", ""), items, expected)


def load_corpus(directory: Path) -> Corpus:
    """A corpus directory: `manuscript.json` (canonical manuscript) and `cases/*.json`."""
    directory = Path(directory)
    chapters = _load_chapters(directory)
    cases = tuple(_load_case(path, directory, chapters) for path in sorted((directory / "cases").glob("*.json")))
    return Corpus(directory, cases)


def corpus_dirs(include_committed: bool = True) -> tuple[Path, ...]:
    """The committed synthetic set, plus the permissioned corpus named by NARRATION_COVERAGE_CORPUS."""
    committed = (FIXTURE_DIR,) if include_committed else ()
    named = os.environ.get(CORPUS_ENV)
    if not named:
        return committed
    directory = Path(named)
    if not directory.is_dir():
        raise FixtureError(f"{CORPUS_ENV} names {named}, which is not a directory")
    return (*committed, directory)


# ---------------------------------------------------------------------------
# scoring


@dataclass(frozen=True)
class CaseResult:
    case: Case
    outcome: str  # ok | false_met | false_not_met | skipped
    report: Report | None
    paragraphs_agreed: int = 0
    regions_located: int = 0
    regions_kind_matched: int = 0
    reason: str = ""


@dataclass(frozen=True)
class Summary:
    cases: int
    scored: int
    skipped: int
    false_met: int
    false_not_met: int
    paragraphs_agreed: int
    paragraphs_total: int
    regions_located: int
    regions_kind_matched: int
    regions_total: int


@dataclass(frozen=True)
class Evaluation:
    results: tuple[CaseResult, ...]

    def summary(self, split: str | None = None) -> Summary:
        results = [result for result in self.results if split is None or result.case.split == split]
        scored = [result for result in results if result.outcome != "skipped"]
        return Summary(
            cases=len(results),
            scored=len(scored),
            skipped=len(results) - len(scored),
            false_met=sum(result.outcome == "false_met" for result in scored),
            false_not_met=sum(result.outcome == "false_not_met" for result in scored),
            paragraphs_agreed=sum(result.paragraphs_agreed for result in scored),
            paragraphs_total=sum(len(result.case.expected.paragraphs) for result in scored),
            regions_located=sum(result.regions_located for result in scored),
            regions_kind_matched=sum(result.regions_kind_matched for result in scored),
            regions_total=sum(len(result.case.expected.regions) for result in scored),
        )


def _score(case: Case, report: Report) -> CaseResult:
    expected = case.expected
    if set(report.paragraphs) != set(expected.paragraphs):
        raise FixtureError(f"{case.id}: the analyzer must label every paragraph of {case.chapter.id}")
    if report.text_complete == expected.text_complete:
        outcome = "ok"
    else:
        outcome = "false_met" if report.text_complete else "false_not_met"
    located = kind_matched = 0
    for region in expected.regions:
        hits = [found for found in report.regions if set(found.paragraphs) & set(region.paragraphs)]
        located += bool(hits)
        kind_matched += any(found.kind == region.kind for found in hits)
    agreed = sum(report.paragraphs[pid] == label for pid, label in expected.paragraphs.items())
    return CaseResult(case, outcome, report, agreed, located, kind_matched)


def evaluate(cases: Sequence[Case], analyzer: Analyzer) -> Evaluation:
    """Run the analyzer on every case and score it against the labels."""
    results = []
    for case in cases:
        try:
            report = analyzer(case.chapter, case.items)
        except NeedsAudio as exc:
            results.append(CaseResult(case, "skipped", None, reason=str(exc) or "needs an analyzer that reads audio"))
            continue
        results.append(_score(case, report))
    return Evaluation(tuple(results))


# ---------------------------------------------------------------------------
# the stub analyzer


def _normalized(text: str) -> list[str]:
    return [word for word in _NON_WORD.sub(" ", text.lower()).split() if word]


def presence_stub(chapter: Chapter, items: tuple[Item, ...]) -> Report:
    """An order-blind stand-in: a paragraph is present when its words were heard anywhere.

    It exists so the harness runs before the real analyzer (Phase 2) does, and it is wrong on
    purpose where order matters: a pickup at the end or a refrain read once looks complete."""
    if any(item.words is None for item in items):
        raise NeedsAudio("the presence stub reads transcript words, not audio")
    heard = {word for item in items for w in item.words for word in _normalized(w.text)}
    labels = {}
    for paragraph in chapter.paragraphs:
        words = _normalized(paragraph.text)
        share = sum(word in heard for word in words) / len(words) if words else 1.0
        labels[paragraph.id] = "present" if share >= STUB_PRESENT else "partial" if share >= STUB_PARTIAL else "missing"
    return Report(all(label == "present" for label in labels.values()), MappingProxyType(labels), _stub_regions(chapter, labels))


def _stub_regions(chapter: Chapter, labels: Mapping[str, str]) -> tuple[Region, ...]:
    ids = [paragraph.id for paragraph in chapter.paragraphs]
    runs: list[list[str]] = []
    previous_missing = False
    for pid in ids:
        missing = labels[pid] != "present"
        if missing and previous_missing:
            runs[-1].append(pid)
        elif missing:
            runs.append([pid])
        previous_missing = missing
    return tuple(Region(_run_kind(run, ids), tuple(run)) for run in runs)


def _run_kind(run: list[str], ids: list[str]) -> str:
    if run[0] == ids[0]:
        return "head"
    return "tail" if run[-1] == ids[-1] else "skip"


# ---------------------------------------------------------------------------
# the label table


def _row(result: CaseResult) -> str:
    case = result.case
    expected = "complete" if case.expected.text_complete else "incomplete"
    if result.report is None:
        got, paragraphs, regions = "-", "-", "-"
    else:
        got = "complete" if result.report.text_complete else "incomplete"
        paragraphs = f"{result.paragraphs_agreed}/{len(case.expected.paragraphs)}"
        regions = f"{result.regions_located}/{len(case.expected.regions)}" if case.expected.regions else "-"
    outcome = result.outcome if not result.reason else f"{result.outcome} ({result.reason})"
    return f"| {case.id} | {case.split} | {', '.join(case.conditions)} | {expected} | {got} | {outcome} | {paragraphs} | {regions} |"


def _summary_line(label: str, summary: Summary) -> str:
    return (
        f"- {label}: {summary.cases} cases, {summary.scored} scored, {summary.skipped} skipped. "
        f"False met: {summary.false_met}. False not met: {summary.false_not_met}. "
        f"Paragraph labels agreed: {summary.paragraphs_agreed}/{summary.paragraphs_total}. "
        f"Regions located: {summary.regions_located}/{summary.regions_total} "
        f"(same kind: {summary.regions_kind_matched})."
    )


def format_table(evaluation: Evaluation) -> str:
    """The label table as Markdown: one row per case, then a summary per split and overall."""
    lines = [
        "| Case | Split | Conditions | Expected | Got | Outcome | Paragraphs agreed | Regions located |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        *(_row(result) for result in evaluation.results),
        "",
        *(_summary_line(split, evaluation.summary(split)) for split in SPLITS),
        _summary_line("all", evaluation.summary()),
    ]
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Score the presence stub against the recording-coverage fixtures and print the label table.")
    parser.add_argument("--strict", action="store_true", help="exit 1 when any case is a false met")
    parser.add_argument("--corpus-only", action="store_true", help=f"score only the directory named by {CORPUS_ENV}")
    args = parser.parse_args(argv)
    if args.corpus_only and not os.environ.get(CORPUS_ENV):
        parser.error(f"--corpus-only needs {CORPUS_ENV} to name a corpus directory")
    cases = [case for directory in corpus_dirs(include_committed=not args.corpus_only) for case in load_corpus(directory).cases]
    evaluation = evaluate(cases, presence_stub)
    print(format_table(evaluation))
    return 1 if args.strict and evaluation.summary().false_met else 0


if __name__ == "__main__":
    sys.exit(main())
