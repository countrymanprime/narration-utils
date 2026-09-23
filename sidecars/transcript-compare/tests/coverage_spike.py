"""The Phase 2 alignment spike: `SequenceMatcher` against a word-level DP, scored on the fixtures.

`docs/prds/recording-coverage-analysis.prd.md` Phase 2 and Q2 (answered 2026-09-23: reuse the
`SequenceMatcher` opcodes `compare.py` already computes unless the spike's fixtures fail, then move
to a DP alignment). This module is test tooling, not product code:

- `coverage_analyzer(aligner)` turns `core/recording_coverage.py` into a harness analyzer, aligning through
  `compare.py`'s own tokenizing (homophones, number words, hyphen fusing) with either aligner;
- `lcs_opcodes` is the DP prototype: a longest-common-subsequence alignment over the same tokens
  (vectorized by row with numpy), converted to `difflib` opcodes so coverage reads it unchanged;
- `stress_cases()` generates text-only cases from the committed public-domain manuscript by
  programmatic drop, swap (pickup) and insert, with the labels the recording should get;
- `benchmark()` times both aligners on a full-chapter-size input.

Run it: `uv run python sidecars/transcript-compare/tests/coverage_spike.py` prints the tables that
`docs/research/recording-coverage-alignment-spike.md` records.
"""

from __future__ import annotations

import difflib
import importlib.util
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from types import MappingProxyType

import numpy as np

if __package__ in (None, ""):  # run as a script: make the harness and narration_common importable
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import coverage_harness as harness

CORE = Path(__file__).resolve().parents[1] / "core"


def _load(name: str, filename: str):
    """Load a `core/` module by path under a name that cannot shadow the `coverage` package."""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, CORE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = module  # dataclasses look their module up while the class is built
    spec.loader.exec_module(module)
    return module


compare = _load("transcript_compare_core", "compare.py")
cov = _load("transcript_coverage_core", "recording_coverage.py")

Aligner = Callable[[Sequence[str], Sequence[str]], list[tuple[str, int, int, int, int]]]
# The DP keeps its whole score matrix: uint16 cells, so both sides stay under 65,535 tokens.
DP_MAX_TOKENS = 65_535


# ---------------------------------------------------------------------------
# the two aligners


def sequence_matcher_opcodes(doc: Sequence[str], audio: Sequence[str]) -> list[tuple[str, int, int, int, int]]:
    """What `diff_and_build_markers` does today (before its hyphen fusing)."""
    return difflib.SequenceMatcher(None, list(doc), list(audio), autojunk=False).get_opcodes()


def lcs_opcodes(doc: Sequence[str], audio: Sequence[str]) -> list[tuple[str, int, int, int, int]]:
    """A word-level longest-common-subsequence alignment, as `difflib` opcodes.

    Row i of the score matrix is `L[i][j] = max(L[i-1][j], L[i-1][j-1] + match, L[i][j-1])`; the
    last term is a running maximum along the row, so each row is three numpy operations. The
    traceback prefers a match, then the later reading, so a retake is credited over the attempt
    before it."""
    n, m = len(doc), len(audio)
    if max(n, m) > DP_MAX_TOKENS:
        raise ValueError(f"the DP prototype takes at most {DP_MAX_TOKENS} tokens a side")
    vocab: dict[str, int] = {}
    a = np.array([vocab.setdefault(token, len(vocab)) for token in doc], dtype=np.int64)
    b = np.array([vocab.setdefault(token, len(vocab)) for token in audio], dtype=np.int64)
    score = np.zeros((n + 1, m + 1), dtype=np.uint16)
    for i in range(1, n + 1):
        diagonal = score[i - 1, :-1] + (b == a[i - 1])
        score[i, 1:] = np.maximum.accumulate(np.maximum(score[i - 1, 1:], diagonal))
    pairs = []
    i, j = n, m
    while i > 0 and j > 0:
        if a[i - 1] == b[j - 1] and score[i, j] == score[i - 1, j - 1] + 1:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif score[i - 1, j] >= score[i, j - 1]:
            i -= 1
        else:
            j -= 1
    return _pairs_to_opcodes(pairs[::-1], n, m)


def _pairs_to_opcodes(pairs: Sequence[tuple[int, int]], n: int, m: int) -> list[tuple[str, int, int, int, int]]:
    blocks: list[list[int]] = []
    for i, j in pairs:
        if blocks and blocks[-1][0] + blocks[-1][2] == i and blocks[-1][1] + blocks[-1][2] == j:
            blocks[-1][2] += 1
        else:
            blocks.append([i, j, 1])
    opcodes = []
    i = j = 0
    for bi, bj, size in [*blocks, [n, m, 0]]:
        if i < bi and j < bj:
            opcodes.append(("replace", i, bi, j, bj))
        elif i < bi:
            opcodes.append(("delete", i, bi, j, j))
        elif j < bj:
            opcodes.append(("insert", i, i, j, bj))
        if size:
            opcodes.append(("equal", bi, bi + size, bj, bj + size))
        i, j = bi + size, bj + size
    return opcodes


ALIGNERS: dict[str, Aligner] = {"SequenceMatcher": sequence_matcher_opcodes, "DP (LCS)": lcs_opcodes}


# ---------------------------------------------------------------------------
# coverage as a harness analyzer


def align_case(chapter: harness.Chapter, items: Sequence[harness.Item], aligner: Aligner = sequence_matcher_opcodes):
    """One chapter aligned to the items' words through compare.py's tokenizing, with the title
    and subtitle as the optional heading (Q11)."""
    heading = " ".join(part for part in (chapter.title, chapter.subtitle) if part)
    units, tokens, unit_idx, raw_words = compare.build_chapter_units({"title": heading, "paragraphs": [p.text for p in chapter.paragraphs]})
    words = [(word.text, word.start, word.end) for item in items for word in item.words]
    _markers, _covered, alignment = compare.diff_and_build_markers(tokens, unit_idx, raw_words, words, 1)
    if aligner is not sequence_matcher_opcodes:
        raw = aligner(alignment["doc_tokens"], alignment["audio_tokens"])
        alignment = {**alignment, "opcodes": compare._fuse_hyphen_split_opcodes(raw, alignment["doc_tokens"], alignment["audio_tokens"])}
    return cov.aligned_chapter_from_markers(alignment, units, [p.id for p in chapter.paragraphs])


def label(paragraph, thresholds) -> str:
    """A paragraph's harness label: passes the thresholds, or nearly nothing read, or in between."""
    if paragraph.passes(thresholds):
        return "present"
    return "missing" if paragraph.present_fraction < 1 - thresholds.min_paragraph_present else "partial"


def coverage_analyzer(aligner: Aligner = sequence_matcher_opcodes, params=None, thresholds=None) -> harness.Analyzer:
    params = params or cov.AlignmentParams()
    thresholds = thresholds or cov.Thresholds()

    def analyze(chapter: harness.Chapter, items: tuple[harness.Item, ...]) -> harness.Report:
        if any(item.words is None for item in items):
            raise harness.NeedsAudio("coverage reads transcript words; audio needs the Phase 3 sidecar mode")
        result = cov.compute_coverage(align_case(chapter, items, aligner), params)
        labels = MappingProxyType({paragraph.id: label(paragraph, thresholds) for paragraph in result.paragraphs})
        regions = tuple(harness.Region(region.kind, region.paragraph_ids) for region in result.regions)
        return harness.Report(result.text_complete(thresholds), labels, regions)

    return analyze


# ---------------------------------------------------------------------------
# generated stress cases


MISREAD_EVERY = 6  # one word in six misread: scattered misreads, each far inside max_misread_run
ASIDE = "sorry let me go again from the top of that bit"
UNRELATED = "hold on there is a lorry reversing outside so I am going to wait for it to go away and then pick this up again in a minute or two once it is quiet"


def _spec(case_id, chapter, condition, segments, labels, regions):
    return {
        "id": case_id,
        "conditions": [condition],
        "split": "tune",
        "recording": {"items": [{"id": "item-1", "segments": segments}]},
        "expected": {"textComplete": all(value == "present" for value in labels.values()), "paragraphs": labels, "regions": regions},
    }


def _labels(chapter, missing=(), partial=()):
    return {p.id: "missing" if p.id in missing else "partial" if p.id in partial else "present" for p in chapter.paragraphs}


def _edge_kind(chapter, index, inside="skip"):
    """The region kind for missing paragraph `index`: head or tail at the edges, else `inside`."""
    return "head" if index == 0 else "tail" if index == len(chapter.paragraphs) - 1 else inside


def _chapter_stress(chapter: harness.Chapter) -> list[dict]:
    ids = [p.id for p in chapter.paragraphs]
    reads = [{"read": pid} for pid in ids]
    specs = []
    for k, pid in enumerate(ids):
        without = reads[:k] + reads[k + 1 :]
        specs.append(
            _spec(
                f"{chapter.id}-drop-{k}",
                chapter,
                "skipped_paragraph",
                without,
                _labels(chapter, missing=[pid]),
                [{"kind": _edge_kind(chapter, k), "paragraphs": [pid]}],
            )
        )
        retake = [*reads[:k], {"read": pid, "words": [0, 6]}, {"say": ASIDE}, *reads[k:]]
        specs.append(_spec(f"{chapter.id}-false-start-{k}", chapter, "retakes_and_false_starts", retake, _labels(chapter), []))
        twice = [*reads[: k + 1], {"say": "no wait"}, *reads[k:]]
        specs.append(_spec(f"{chapter.id}-read-twice-{k}", chapter, "retakes_and_false_starts", twice, _labels(chapter), []))
        filler = " ".join((UNRELATED.split() * 3)[: len(chapter.paragraphs[k].text.split())])
        swapped = [*reads[:k], {"say": filler}, *reads[k + 1 :]]
        specs.append(
            _spec(
                f"{chapter.id}-unrelated-{k}",
                chapter,
                "unrelated_speech",
                swapped,
                _labels(chapter, missing=[pid]),
                [{"kind": _edge_kind(chapter, k, "different_text"), "paragraphs": [pid]}],
            )
        )
        misread = " ".join("mumble" if n % MISREAD_EVERY == MISREAD_EVERY - 1 else word for n, word in enumerate(chapter.paragraphs[k].text.split()))
        specs.append(_spec(f"{chapter.id}-misread-{k}", chapter, "misread", [*reads[:k], {"read": pid, "as": misread}, *reads[k + 1 :]], _labels(chapter), []))
        if k < len(ids) - 1:
            pickup = [*without, {"pause": 2.0}, {"say": "pickup"}, {"read": pid}]
            specs.append(
                _spec(
                    f"{chapter.id}-pickup-{k}",
                    chapter,
                    "pickup_at_end",
                    pickup,
                    _labels(chapter, missing=[pid]),
                    [{"kind": _edge_kind(chapter, k), "paragraphs": [pid]}],
                )
            )
        sentences = harness.split_sentences(chapter.paragraphs[k].text)
        if len(sentences) > 1 and len(sentences[0].split()) > 3:
            dropped = [*reads[:k], {"read": pid, "sentences": [1, None]}, *reads[k + 1 :]]
            specs.append(
                _spec(
                    f"{chapter.id}-drop-sentence-{k}",
                    chapter,
                    "skipped_sentence",
                    dropped,
                    _labels(chapter, partial=[pid]),
                    [{"kind": "head" if k == 0 else "skip", "paragraphs": [pid]}],
                )
            )
    return specs


def stress_cases(corpus: harness.Corpus | None = None) -> tuple[harness.Case, ...]:
    """Cases generated from each committed chapter: every paragraph dropped, false-started, read
    twice (a retake after a good read), replaced by unrelated speech of its length, misread one
    word in six, picked up at the end, and its first sentence dropped."""
    corpus = corpus or harness.load_corpus(harness.FIXTURE_DIR)
    chapters = {case.chapter.id: case.chapter for case in corpus.cases}
    return tuple(harness.build_case({**spec, "chapter": chapter.id}, chapter) for chapter in chapters.values() for spec in _chapter_stress(chapter))


# ---------------------------------------------------------------------------
# benchmark


def chapter_size_input(target_tokens: int = 6000) -> tuple[list[str], list[str]]:
    """A long chapter made by repeating the committed paragraphs, and a read of it with a skipped
    paragraph, a false start and an aside every few paragraphs."""
    corpus = harness.load_corpus(harness.FIXTURE_DIR)
    paragraphs = [p.text for chapter in {case.chapter.id: case.chapter for case in corpus.cases}.values() for p in chapter.paragraphs]
    doc, audio, k = [], [], 0
    while len(doc) < target_tokens:
        tokens = compare.tokenize(paragraphs[k % len(paragraphs)])
        doc += tokens
        if k % 7 == 3:
            pass  # skipped
        elif k % 5 == 1:
            audio += tokens[:6] + compare.tokenize(ASIDE) + tokens
        else:
            audio += tokens
        k += 1
    return doc, audio


def benchmark(target_tokens: int = 6000, repeats: int = 3) -> dict[str, float]:
    doc, audio = chapter_size_input(target_tokens)
    timings = {"doc_tokens": len(doc), "audio_tokens": len(audio)}
    for name, aligner in ALIGNERS.items():
        best = float("inf")
        for _ in range(repeats):
            start = time.perf_counter()
            aligner(doc, audio)
            best = min(best, time.perf_counter() - start)
        timings[name] = best
    timings["dp_matrix_mib"] = (len(doc) + 1) * (len(audio) + 1) * 2 / 2**20
    return timings


# ---------------------------------------------------------------------------
# the report


def _summary_row(name, split, summary):
    return (
        f"| {name} | {split} | {summary.scored} | {summary.false_met} | {summary.false_not_met} | "
        f"{summary.paragraphs_agreed}/{summary.paragraphs_total} | {summary.regions_located}/{summary.regions_total} | {summary.regions_kind_matched}/{summary.regions_total} |"
    )


def report() -> str:
    committed = harness.load_corpus(harness.FIXTURE_DIR).cases
    stress = stress_cases()
    header = [
        "| Aligner | Set | Cases | False met | False not met | Paragraph labels agreed | Regions located | Same kind |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    rows, misses = [], []
    for name, aligner in ALIGNERS.items():
        analyzer = coverage_analyzer(aligner)
        committed_eval = harness.evaluate(committed, analyzer)
        stress_eval = harness.evaluate(stress, analyzer)
        rows += [_summary_row(name, split, committed_eval.summary(split)) for split in harness.SPLITS]
        rows.append(_summary_row(name, "stress", stress_eval.summary()))
        misses += [f"- {name}: `{r.case.id}` {r.outcome}" for r in (*committed_eval.results, *stress_eval.results) if r.outcome != "ok"]
    timings = benchmark()
    bench = [
        "",
        f"Benchmark: {timings['doc_tokens']} chapter tokens against {timings['audio_tokens']} transcript tokens, best of 3.",
        *(f"- {name}: {timings[name] * 1000:.0f} ms" for name in ALIGNERS),
        f"- DP score matrix: {timings['dp_matrix_mib']:.0f} MiB",
    ]
    return "\n".join([*header, *rows, "", "Wrong verdicts:", *(misses or ["- none"]), *bench])


if __name__ == "__main__":
    print(report())
