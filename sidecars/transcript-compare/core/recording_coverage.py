"""Recording coverage: how much of a chapter's body text a recording contains, in order.

docs/utilities/recording-coverage.md ("What counts as read"; Q1, Q2, Q3, Q11). This module is
pure: it takes one word-level alignment between the chapter's tokens and the transcript's tokens
(the opcodes `diff_and_build_markers` in `compare.py` already computes, so coverage and the take
markers can never disagree) and reports, per paragraph (`p-NNNNNN`), how many body tokens were
read in place, the longest run of missing tokens, and typed regions of missing text naming their
first and last words and the matched transcript tokens that bound them (ADR 0168).

The rules (the Definitions of the delivered PRD, now "What counts as read" in that page):

- **Anchors.** An `equal` block of at least `min_anchor_run` tokens is read text. A shorter one
  with non-equal neighbours on both sides is a chance match (the odd "the" inside unrelated
  speech) and joins the gap around it. A short block at either end of the alignment, or next to
  another `equal` block (the hyphen fuse makes those), stays an anchor.
- **Gaps.** Everything between two anchors is one gap: `d` body tokens against `a` transcript
  tokens. With no transcript (`a == 0`) the text was not read. With `d <= max_misread_run`, up to
  `min(d, a)` tokens are a misread and count as present (the narrator said something in their
  place, "even if there are mistakes"), and the rest are a short read. A larger gap is not a
  misread: it is text skipped (when what was said there is chapter text read again, a retake or
  the tail of a false start) or different text (when it is not).
- **Heading.** The title and subtitle are optional (Q11): their tokens carry paragraph `-1`, are
  never in the denominator and never missing, and reading them is not extra.
- **Head and tail.** Missing text before the first present body token is `head`, after the last
  is `tail`, unlike the take markers, which ignore both.
- **Extra** transcript tokens (retakes, false starts, asides) are counted and reported, and never
  count against the narrator.

The narrator's thresholds (`min_paragraph_present`, `max_missing_run`) are applied on read by
`ChapterCoverage.text_complete`, so changing one never re-aligns. The two alignment parameters
(`max_misread_run`, `min_anchor_run`) change which tokens count, so a result is only valid for the
parameters it was computed with (Q13). The defaults are the ones the app ships (ADR 0132), chosen
on the synthetic fixtures and still uncalibrated on real narration (Q15).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType

HEADING = -1
"""The paragraph index of a title or subtitle token: optional, outside the denominator."""

REGION_KINDS = ("head", "tail", "skip", "short_read", "different_text")

REREAD_SHARE = 0.5
"""A large gap is `skip`, not `different_text`, when at least this share of what was said in it is
chapter text (an `min_anchor_run`-gram of the chapter): the narrator re-read something rather than
saying something else."""

_OPCODE_TAGS = frozenset({"equal", "replace", "delete", "insert"})
_PRESENT = "present"


class CoverageError(ValueError):
    """The alignment or the parameters handed to coverage are inconsistent."""


@dataclass(frozen=True)
class AlignmentParams:
    """Parameters that decide which tokens count as read; a result is tied to them (Q13)."""

    max_misread_run: int = 8
    min_anchor_run: int = 3

    def __post_init__(self) -> None:
        if not isinstance(self.max_misread_run, int) or self.max_misread_run < 0:
            raise CoverageError("max_misread_run must be a whole number of tokens, 0 or more")
        if not isinstance(self.min_anchor_run, int) or self.min_anchor_run < 1:
            raise CoverageError("min_anchor_run must be a whole number of tokens, 1 or more")


@dataclass(frozen=True)
class Thresholds:
    """The narrator's pass/fail settings, applied on read."""

    min_paragraph_present: float = 0.8
    max_missing_run: int = 3

    def __post_init__(self) -> None:
        if not 0.0 <= self.min_paragraph_present <= 1.0:
            raise CoverageError("min_paragraph_present must be between 0 and 1")
        if not isinstance(self.max_missing_run, int) or self.max_missing_run < 0:
            raise CoverageError("max_missing_run must be a whole number of tokens, 0 or more")


@dataclass(frozen=True)
class AlignedChapter:
    """One chapter aligned to one transcript: the input to `compute_coverage`.

    `doc_tokens`, `doc_words` (the manuscript word each token came from, for region text) and
    `token_paragraph` (an index into `paragraph_ids`, or HEADING) run in parallel. `opcodes` are
    `difflib` opcodes over `doc_tokens` and `audio_tokens`."""

    doc_tokens: tuple[str, ...]
    doc_words: tuple[str, ...]
    token_paragraph: tuple[int, ...]
    paragraph_ids: tuple[str, ...]
    audio_tokens: tuple[str, ...]
    opcodes: tuple[tuple[str, int, int, int, int], ...]

    def __post_init__(self) -> None:
        count = len(self.doc_tokens)
        if len(self.doc_words) != count or len(self.token_paragraph) != count:
            raise CoverageError("doc_tokens, doc_words and token_paragraph must be the same length")
        if any(index != HEADING and not 0 <= index < len(self.paragraph_ids) for index in self.token_paragraph):
            raise CoverageError("token_paragraph must index paragraph_ids, or be HEADING")
        _check_opcodes(self.opcodes, count, len(self.audio_tokens))


def _check_opcodes(opcodes: Sequence[tuple[str, int, int, int, int]], doc_len: int, audio_len: int) -> None:
    """The opcodes must tile both sequences, in order, with no gap or overlap."""
    i = j = 0
    for tag, i1, i2, j1, j2 in opcodes:
        if tag not in _OPCODE_TAGS or (i1, j1) != (i, j) or i2 < i1 or j2 < j1:
            raise CoverageError(f"opcode {(tag, i1, i2, j1, j2)} does not continue the alignment at ({i}, {j})")
        if tag == "equal" and (i2 == i1 or j2 == j1):
            raise CoverageError(f"equal opcode {(tag, i1, i2, j1, j2)} has an empty side")
        i, j = i2, j2
    if (i, j) != (doc_len, audio_len):
        raise CoverageError(f"opcodes end at ({i}, {j}), not at the ends of the sequences ({doc_len}, {audio_len})")


def aligned_chapter_from_markers(alignment: Mapping, sentence_units: Sequence[tuple[str, int]], paragraph_ids: Sequence[str]) -> AlignedChapter:
    """Build the input from the alignment `compare.diff_and_build_markers` returns.

    Its `equal` blocks may have sides of different lengths: `_fuse_hyphen_split_opcodes` rewrites
    "notebook" against "note book" as equal. `sentence_units` are `build_chapter_units`'
    `(sentence, paragraph index)` pairs; its unit -1 (the title, and the subtitle when the caller
    put it in the title) becomes HEADING."""
    raw_words = alignment["chapter_raw_words"]
    unit_idx = alignment["unit_idx"]
    return AlignedChapter(
        doc_tokens=tuple(alignment["doc_tokens"]),
        doc_words=tuple(raw_words[original] for original in alignment["chapter_index_map"]),
        token_paragraph=tuple(HEADING if unit < 0 else sentence_units[unit][1] for unit in unit_idx),
        paragraph_ids=tuple(paragraph_ids),
        audio_tokens=tuple(alignment["audio_tokens"]),
        opcodes=tuple(tuple(opcode) for opcode in alignment["opcodes"]),
    )


@dataclass(frozen=True)
class Region:
    """A run of missing body text of one kind."""

    kind: str
    paragraph_ids: tuple[str, ...]
    token_count: int
    first_word: str
    last_word: str
    doc_start: int  # token index of the first missing token
    doc_end: int  # token index after the last
    audio_index: int  # transcript token index where the missing text would sit
    # The region's bounds in the transcript: the last token of the nearest anchor with body text
    # before it, and the first token of the nearest one after it. None where no such anchor exists:
    # always for a head (a read title is optional text and never bounds one) and for a tail.
    audio_before: int | None = None
    audio_after: int | None = None


@dataclass(frozen=True)
class ParagraphCoverage:
    id: str
    tokens: int
    present: int
    longest_missing_run: int  # the longest run touching this paragraph, counted across paragraph boundaries

    @property
    def present_fraction(self) -> float:
        return self.present / self.tokens if self.tokens else 1.0

    def passes(self, thresholds: Thresholds) -> bool:
        return self.present_fraction >= thresholds.min_paragraph_present and self.longest_missing_run <= thresholds.max_missing_run


@dataclass(frozen=True)
class ChapterCoverage:
    params: AlignmentParams
    body_tokens: int
    present_tokens: int
    extra_tokens: int
    longest_missing_run: int
    paragraphs: tuple[ParagraphCoverage, ...]
    regions: tuple[Region, ...]
    by_id: Mapping[str, ParagraphCoverage] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "by_id", MappingProxyType({paragraph.id: paragraph for paragraph in self.paragraphs}))

    @property
    def missing_tokens(self) -> int:
        return self.body_tokens - self.present_tokens

    @property
    def present_fraction(self) -> float:
        """The chapter's share of body words present: what fills `recordedFraction` (D11)."""
        return self.present_tokens / self.body_tokens if self.body_tokens else 1.0

    def text_complete(self, thresholds: Thresholds) -> bool:
        """Every paragraph passes and no missing run, head and tail included, is too long."""
        return self.longest_missing_run <= thresholds.max_missing_run and all(paragraph.passes(thresholds) for paragraph in self.paragraphs)


# ---------------------------------------------------------------------------
# computing it


@dataclass(frozen=True)
class _Gap:
    i1: int
    i2: int
    j1: int
    j2: int


def _is_chance_match(opcodes: Sequence[tuple[str, int, int, int, int]], index: int, min_anchor_run: int) -> bool:
    """A short `equal` block with a non-equal neighbour on both sides."""
    tag, i1, i2, _j1, _j2 = opcodes[index]
    if tag != "equal" or i2 - i1 >= min_anchor_run or index in (0, len(opcodes) - 1):
        return False
    return opcodes[index - 1][0] != "equal" and opcodes[index + 1][0] != "equal"


def _segments(opcodes: Sequence[tuple[str, int, int, int, int]], min_anchor_run: int) -> list[tuple[str, _Gap]]:
    """Anchors and the gaps between them, in order; a chance match joins the gap around it."""
    out: list[tuple[str, _Gap]] = []
    for index, (tag, i1, i2, j1, j2) in enumerate(opcodes):
        if tag == "equal" and not _is_chance_match(opcodes, index, min_anchor_run):
            out.append(("anchor", _Gap(i1, i2, j1, j2)))
        elif out and out[-1][0] == "gap":
            previous = out[-1][1]
            out[-1] = ("gap", _Gap(previous.i1, i2, previous.j1, j2))
        else:
            out.append(("gap", _Gap(i1, i2, j1, j2)))
    return out


def _is_reread(audio: Sequence[str], doc_ngrams: frozenset[tuple[str, ...]], n: int) -> bool:
    """Whether most of what was said in a gap is chapter text (a retake, not different words)."""
    if len(audio) < n:
        return False
    covered = [False] * len(audio)
    for start in range(len(audio) - n + 1):
        if tuple(audio[start : start + n]) in doc_ngrams:
            covered[start : start + n] = [True] * n
    return sum(covered) >= REREAD_SHARE * len(audio)


def _gap_statuses(aligned: AlignedChapter, gap: _Gap, params: AlignmentParams, doc_ngrams: frozenset) -> tuple[dict[int, str], int]:
    """The status of each body token in a gap, and how many transcript tokens it accounts for."""
    body = [i for i in range(gap.i1, gap.i2) if aligned.token_paragraph[i] != HEADING]
    said = gap.j2 - gap.j1
    if not body:
        return {}, min(gap.i2 - gap.i1, said)
    if said == 0:
        return dict.fromkeys(body, "skip"), 0
    if len(body) <= params.max_misread_run:
        read = min(len(body), said)
        return {i: _PRESENT if n < read else "short_read" for n, i in enumerate(body)}, min(gap.i2 - gap.i1, said)
    audio = aligned.audio_tokens[gap.j1 : gap.j2]
    kind = "skip" if _is_reread(audio, doc_ngrams, params.min_anchor_run) else "different_text"
    return dict.fromkeys(body, kind), 0


def _statuses(aligned: AlignedChapter, params: AlignmentParams) -> tuple[list[str | None], list[int], int]:
    """Per doc token: its status (None for heading), the transcript index it sits at, and the
    number of transcript tokens that are chapter text."""
    n = params.min_anchor_run
    tokens = aligned.doc_tokens
    doc_ngrams = frozenset(tuple(tokens[k : k + n]) for k in range(len(tokens) - n + 1))
    status: list[str | None] = [None] * len(tokens)
    audio_at = [0] * len(tokens)
    matched_audio = 0
    for kind, gap in _segments(aligned.opcodes, params.min_anchor_run):
        if kind == "anchor":
            gap_status = {i: _PRESENT for i in range(gap.i1, gap.i2) if aligned.token_paragraph[i] != HEADING}
            matched_audio += gap.j2 - gap.j1
        else:
            gap_status, accounted = _gap_statuses(aligned, gap, params, doc_ngrams)
            matched_audio += accounted
        for i, value in gap_status.items():
            status[i] = value
            audio_at[i] = gap.j1
    return _mark_head_and_tail(status), audio_at, matched_audio


def _mark_head_and_tail(status: list[str | None]) -> list[str | None]:
    present = [i for i, value in enumerate(status) if value == _PRESENT]
    first, last = (present[0], present[-1]) if present else (len(status), len(status))
    return [value if value in (None, _PRESENT) else "head" if i < first else "tail" if i > last else value for i, value in enumerate(status)]


def _missing_runs(status: Sequence[str | None]) -> list[tuple[int, int]]:
    """Maximal runs of missing body tokens as (start, end) doc indices; heading tokens are skipped over."""
    runs: list[tuple[int, int]] = []
    start = None
    for i, value in enumerate(status):
        if value is None:
            continue
        if value != _PRESENT and start is None:
            start = i
        elif value == _PRESENT and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(status)))
    return runs


def _run_length(status: Sequence[str | None], start: int, end: int) -> int:
    return sum(value is not None for value in status[start:end])


def _body_anchors(aligned: AlignedChapter, params: AlignmentParams) -> list[_Gap]:
    """The anchors that hold body text, in order: the matched words that can bound a region."""
    return [
        gap
        for kind, gap in _segments(aligned.opcodes, params.min_anchor_run)
        if kind == "anchor" and any(aligned.token_paragraph[i] != HEADING for i in range(gap.i1, gap.i2))
    ]


def _bounds(anchors: Sequence[_Gap], doc_start: int, doc_end: int) -> tuple[int | None, int | None]:
    """The transcript tokens that bound the doc tokens `[doc_start, doc_end)`: the last token of the
    last anchor ending at or before `doc_start`, and the first token of the first anchor starting
    at or after `doc_end`."""
    before = next((anchor.j2 - 1 for anchor in reversed(anchors) if anchor.i2 <= doc_start), None)
    after = next((anchor.j1 for anchor in anchors if anchor.i1 >= doc_end), None)
    return before, after


def _region(aligned: AlignedChapter, status: Sequence[str | None], audio_at: Sequence[int], anchors: Sequence[_Gap], start: int, end: int) -> Region:
    """One missing run as a region, of its first token's kind. A run lies inside one gap, because
    anchors are present text, so it has one kind; head and tail relabel whole runs. The one
    exception, an anchor of heading tokens alone between two gaps, takes the first gap's kind."""
    tokens = [i for i in range(start, end) if status[i] is not None]
    kind = status[tokens[0]]
    paragraph_ids = tuple(dict.fromkeys(aligned.paragraph_ids[aligned.token_paragraph[i]] for i in tokens))
    audio_index = 0 if kind == "head" else len(aligned.audio_tokens) if kind == "tail" else audio_at[tokens[0]]
    before, after = _bounds(anchors, tokens[0], tokens[-1] + 1)
    return Region(
        kind, paragraph_ids, len(tokens), aligned.doc_words[tokens[0]], aligned.doc_words[tokens[-1]], tokens[0], tokens[-1] + 1, audio_index, before, after
    )


def _paragraphs(aligned: AlignedChapter, status: Sequence[str | None], runs: Sequence[tuple[int, int]]) -> tuple[ParagraphCoverage, ...]:
    tokens = [0] * len(aligned.paragraph_ids)
    present = [0] * len(aligned.paragraph_ids)
    longest = [0] * len(aligned.paragraph_ids)
    for i, value in enumerate(status):
        if value is None:
            continue
        paragraph = aligned.token_paragraph[i]
        tokens[paragraph] += 1
        present[paragraph] += value == _PRESENT
    for start, end in runs:
        length = _run_length(status, start, end)
        for paragraph in {aligned.token_paragraph[i] for i in range(start, end) if status[i] is not None}:
            longest[paragraph] = max(longest[paragraph], length)
    return tuple(ParagraphCoverage(pid, tokens[k], present[k], longest[k]) for k, pid in enumerate(aligned.paragraph_ids))


def compute_coverage(aligned: AlignedChapter, params: AlignmentParams | None = None) -> ChapterCoverage:
    """Present, missing and extra tokens, per-paragraph figures and regions for one alignment."""
    params = params or AlignmentParams()
    status, audio_at, matched_audio = _statuses(aligned, params)
    runs = _missing_runs(status)
    paragraphs = _paragraphs(aligned, status, runs)
    anchors = _body_anchors(aligned, params)
    return ChapterCoverage(
        params=params,
        body_tokens=sum(paragraph.tokens for paragraph in paragraphs),
        present_tokens=sum(paragraph.present for paragraph in paragraphs),
        extra_tokens=len(aligned.audio_tokens) - matched_audio,
        longest_missing_run=max((_run_length(status, start, end) for start, end in runs), default=0),
        paragraphs=paragraphs,
        regions=tuple(_region(aligned, status, audio_at, anchors, start, end) for start, end in runs),
    )
