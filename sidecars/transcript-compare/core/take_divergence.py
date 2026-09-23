"""Where one take of a fixed manuscript span diverges from the manuscript.

Take review (`docs/utilities/take-review.md`), its PRD's Phase 9, and ADR 0141. The
take's timed words (free ASR words with Whisper's word timestamps, ADR 0008) are aligned to the
span's words with the take markers' own diff (`compare.diff_and_build_markers`), so a take's
divergences and its markers can never disagree about what was said. The result says, for every
manuscript word of the span, whether the take read it (`matched`), said something else there
(`misread`), left it out between words it did read (`skipped`) or never reached it because the
take starts late or stops early (`unread`); and it lists each divergence as a span of manuscript
words with the time range of the take it happened in, which Phase 10's comparison view shades.

Nothing here ranks takes or turns fidelity into a verdict (PRD Q9): the counts are evidence.

This module does not import `compare.py`: every function that tokenizes or aligns is handed the
loaded module as `engine`, so the result uses exactly the tokenizing of the process it runs in.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from types import ModuleType

MATCHED = "matched"
MISREAD = "misread"
SKIPPED = "skipped"
UNREAD = "unread"
EXTRA = "extra"
WORD_STATUSES = (MATCHED, MISREAD, SKIPPED, UNREAD)
DIVERGENCE_KINDS = (MISREAD, SKIPPED, UNREAD, EXTRA)

BEFORE = "before"
WITHIN = "within"
AFTER = "after"

TIME_DECIMALS = 3

Word = tuple[str, float, float]
"""A transcript word: text, start and end in seconds from the start of the take's range."""


class SpanError(ValueError):
    """The requested span is not a run of sentences of the chapter."""


@dataclass(frozen=True)
class SpanWord:
    """One spoken manuscript word of the span: a whitespace-separated word of a sentence that has
    at least one token (a lone dash or quote mark is not spoken and is not a span word)."""

    index: int
    text: str
    unit: int
    paragraph: int
    tokens: tuple[str, ...]


@dataclass(frozen=True)
class Span:
    """A fixed run of a chapter's sentence units, `first_unit` to `last_unit` inclusive, in the
    same numbering `--find-repeats` reports a repeated span in."""

    first_unit: int
    last_unit: int
    first_paragraph: int
    last_paragraph: int
    words: tuple[SpanWord, ...]


@dataclass(frozen=True)
class WordResult:
    index: int
    status: str
    start: float | None
    end: float | None


@dataclass(frozen=True)
class Divergence:
    """One place the take departs from the span.

    `first_word`/`last_word` are the span words involved (inclusive). An `extra` has no manuscript
    words of its own; it sits before span word `first_word` (`first_word == last_word`, or both
    None when it comes after the last word). `start`/`end` are the take seconds the divergence
    occupies; a `skipped` one is the pause where the words were left out, and an `unread` one has
    no time at all."""

    kind: str
    position: str
    first_word: int | None
    last_word: int | None
    manuscript_text: str
    audio_text: str
    start: float | None
    end: float | None


@dataclass(frozen=True)
class TakeAlignment:
    words: tuple[WordResult, ...]
    divergences: tuple[Divergence, ...]
    extra_words: int

    def count(self, status: str) -> int:
        return sum(1 for word in self.words if word.status == status)

    @property
    def fidelity(self) -> float:
        """Matched span words over all span words (0 for an empty span)."""
        return self.count(MATCHED) / len(self.words) if self.words else 0.0


# ---------------------------------------------------------------------------
# the span


def build_span(engine: ModuleType, paragraphs: Sequence[str], first_unit: int, last_unit: int) -> Span:
    """The spoken words of sentence units `first_unit`..`last_unit` of a chapter's paragraphs,
    split into sentences exactly as the markers and `--find-repeats` split them."""
    units = engine.build_sentence_units(list(paragraphs))
    if not units:
        raise SpanError("The chapter has no sentences")
    if not (0 <= first_unit <= last_unit < len(units)):
        raise SpanError(f"The span {first_unit}..{last_unit} is not within the chapter's {len(units)} sentence(s)")
    words: list[SpanWord] = []
    for unit in range(first_unit, last_unit + 1):
        sentence, paragraph = units[unit]
        for raw in sentence.split():
            tokens = tuple(engine.tokenize(raw))
            if tokens:
                words.append(SpanWord(len(words), raw, unit, paragraph, tokens))
    if not words:
        raise SpanError(f"The span {first_unit}..{last_unit} has no spoken words")
    return Span(first_unit, last_unit, units[first_unit][1], units[last_unit][1], tuple(words))


# ---------------------------------------------------------------------------
# aligning one take


def _merged_owners(span: Span, chapter_index_map: Sequence[int]) -> tuple[tuple[int, ...], ...]:
    """For each span token after number merging (the space the diff's opcodes index), the span
    words it came from: a merged number ("twenty three" as "23") covers every word it spans."""
    flat_owner = [word.index for word in span.words for _token in word.tokens]
    bounds = [*chapter_index_map, len(flat_owner)]
    return tuple(tuple(sorted({flat_owner[orig] for orig in range(bounds[k], bounds[k + 1])})) for k in range(len(chapter_index_map)))


def _audio_range(index_map: Sequence[int], transcript: Sequence[Word], j1: int, j2: int) -> tuple[float, float, str]:
    """Time range and raw text of the transcript words behind filtered audio tokens [j1, j2), j1 < j2."""
    originals = sorted({index_map[j] for j in range(j1, j2)})
    return transcript[originals[0]][1], transcript[originals[-1]][2], " ".join(transcript[i][0].strip() for i in originals)


def _gap(index_map: Sequence[int], transcript: Sequence[Word], j: int) -> tuple[float | None, float | None]:
    """The pause at filtered audio position j: from the end of the word before it to the start of
    the word at it (None on a side the take has no word)."""
    before = transcript[index_map[j - 1]][2] if 0 < j <= len(index_map) else None
    after = transcript[index_map[j]][1] if 0 <= j < len(index_map) else None
    if before is not None and after is not None and after < before:
        after = before
    return before, after


def _audio_tokens(engine: ModuleType, transcript: Sequence[Word], index_map: Sequence[int]) -> list[str] | None:
    """The audio tokens the diff's opcodes index, rebuilt the way `diff_and_build_markers` builds
    them (tokenize, drop fillers, merge number words); None if the rebuild does not reproduce the
    diff's own index map, in which case nothing is reinterpreted."""
    tokens: list[str] = []
    owners: list[int] = []
    for i, (text, _start, _end) in enumerate(transcript):
        for token in engine.tokenize(text):
            if token not in engine.FILLER_WORDS:
                tokens.append(token)
                owners.append(i)
    merged, merged_map = engine.merge_number_words(tokens, owners)
    return merged if list(merged_map) == list(index_map) else None


def _prefer_earlier_copy(opcodes: Sequence[tuple], audio_tokens: Sequence[str] | None) -> list[tuple]:
    """A restart or a stutter says the same words twice, and the diff may match either copy. When
    it matched the first and called the second extra, swap them: a narrator abandons the earlier
    read, so the extra is the earlier copy and its time is the false start's."""
    out: list[tuple] = []
    for op in opcodes:
        tag, i1, _i2, j1, j2 = op
        n = j2 - j1
        previous = out[-1] if out else None
        if (
            audio_tokens is not None
            and tag == "insert"
            and previous is not None
            and previous[0] == "equal"
            and previous[2] == i1
            and previous[4] == j1
            and previous[2] - previous[1] >= n
            and list(audio_tokens[j1 - n : j1]) == list(audio_tokens[j1:j2])
        ):
            _eq, a1, a2, b1, b2 = out.pop()
            if a2 - n > a1:
                out.append(("equal", a1, a2 - n, b1, b2 - n))
            out.append(("insert", a2 - n, a2 - n, b2 - n, b2))
            out.append(("equal", a2 - n, a2, j1, j2))
            continue
        out.append(op)
    return out


def _word_statuses(span: Span, owners: Sequence[Sequence[int]], token_status: Sequence[str]) -> list[str]:
    by_word: list[set[str]] = [set() for _ in span.words]
    for words, status in zip(owners, token_status):
        for word in words:
            by_word[word].add(status)
    # A word whose tokens were treated differently (part read, part not) was not read as written.
    return [next(iter(statuses)) if len(statuses) == 1 else MISREAD for statuses in by_word]


def _position(i1: int, i2: int, aligned_start: int | None, aligned_end: int | None) -> str:
    if aligned_start is None or i2 <= aligned_start:
        return BEFORE
    if i1 >= aligned_end:
        return AFTER
    return WITHIN


def align_take(engine: ModuleType, span: Span, transcript: Sequence[Word]) -> TakeAlignment:
    """Align one take's transcript words to the span with the markers' own diff and localize every
    divergence. Times stay in the transcript's own seconds; the caller shifts them."""
    doc_tokens = [token for word in span.words for token in word.tokens]
    unit_idx = [word.unit for word in span.words for _token in word.tokens]
    raw_words = [word.text for word in span.words for _token in word.tokens]
    _markers, _covered, alignment = engine.diff_and_build_markers(doc_tokens, unit_idx, raw_words, list(transcript), 1)
    index_map = alignment["index_map"]
    opcodes = _prefer_earlier_copy(alignment["opcodes"], _audio_tokens(engine, transcript, index_map))
    owners = _merged_owners(span, alignment["chapter_index_map"])

    aligned = [(i1, i2) for tag, i1, i2, _j1, _j2 in opcodes if tag != "delete"]
    aligned_start = aligned[0][0] if aligned else None
    aligned_end = aligned[-1][1] if aligned else None

    token_status = [UNREAD] * len(owners)
    token_times: list[tuple[float, float] | None] = [None] * len(owners)
    divergences: list[Divergence] = []
    extra_words = 0

    for tag, i1, i2, j1, j2 in opcodes:
        position = _position(i1, i2, aligned_start, aligned_end)
        if tag == "equal":
            for offset in range(i2 - i1):
                token_status[i1 + offset] = MATCHED
                token_times[i1 + offset] = _audio_range(index_map, transcript, j1 + offset, j1 + offset + 1)[:2]
            continue
        words = sorted({word for i in range(i1, i2) for word in owners[i]})
        manuscript_text = " ".join(span.words[w].text for w in words)
        audio = _audio_range(index_map, transcript, j1, j2) if j2 > j1 else None
        if tag == "replace":
            for i in range(i1, i2):
                token_status[i] = MISREAD
                token_times[i] = audio[:2]
            divergences.append(Divergence(MISREAD, WITHIN, words[0], words[-1], manuscript_text, audio[2], audio[0], audio[1]))
        elif tag == "delete":
            status = SKIPPED if position == WITHIN else UNREAD
            for i in range(i1, i2):
                token_status[i] = status
            start, end = _gap(index_map, transcript, j1) if status == SKIPPED else (None, None)
            divergences.append(Divergence(status, position, words[0], words[-1], manuscript_text, "", start, end))
        else:  # insert: said, but not in the span at this point
            extra_words += len({index_map[j] for j in range(j1, j2)})
            anchor = owners[i1][0] if i1 < len(owners) else None
            divergences.append(Divergence(EXTRA, position, anchor, anchor, "", audio[2], audio[0], audio[1]))

    divergences.sort(key=_divergence_order)
    return TakeAlignment(_word_results(span, owners, token_status, token_times), tuple(divergences), extra_words)


def _word_results(
    span: Span, owners: Sequence[Sequence[int]], token_status: Sequence[str], token_times: Sequence[tuple[float, float] | None]
) -> tuple[WordResult, ...]:
    """Each span word's status and the time of the audio its tokens were matched or misread as."""
    statuses = _word_statuses(span, owners, token_status)
    word_times: list[list[tuple[float, float]]] = [[] for _ in span.words]
    for words, times in zip(owners, token_times):
        if times is not None:
            for word in words:
                word_times[word].append(times)
    return tuple(
        WordResult(
            word.index,
            statuses[word.index],
            min(t[0] for t in word_times[word.index]) if word_times[word.index] else None,
            max(t[1] for t in word_times[word.index]) if word_times[word.index] else None,
        )
        for word in span.words
    )


def _divergence_order(divergence: Divergence) -> tuple[int, float]:
    order = {BEFORE: 0, WITHIN: 1, AFTER: 2}[divergence.position]
    word = divergence.first_word if divergence.first_word is not None else 1 << 30
    return order, word


# ---------------------------------------------------------------------------
# output


def _seconds(value: float | None, offset: float) -> float | None:
    return None if value is None else round(value + offset, TIME_DECIMALS)


def to_json(alignment: TakeAlignment, source_offset: float) -> dict:
    """The alignment as a JSON object, times shifted into source seconds (`source_offset` is where
    the take's range starts in its source file)."""
    return {
        "fidelity": round(alignment.fidelity, 4),
        "counts": {**{status: alignment.count(status) for status in WORD_STATUSES}, "extraWords": alignment.extra_words},
        "words": [
            {"index": word.index, "status": word.status, "start": _seconds(word.start, source_offset), "end": _seconds(word.end, source_offset)}
            for word in alignment.words
        ],
        "divergences": [
            {
                "kind": d.kind,
                "position": d.position,
                "firstWord": d.first_word,
                "lastWord": d.last_word,
                "manuscriptText": d.manuscript_text,
                "audioText": d.audio_text,
                "start": _seconds(d.start, source_offset),
                "end": _seconds(d.end, source_offset),
            }
            for d in alignment.divergences
        ],
    }


def span_json(span: Span) -> dict:
    return {
        "firstUnit": span.first_unit,
        "lastUnit": span.last_unit,
        "firstParagraph": span.first_paragraph,
        "lastParagraph": span.last_paragraph,
        "words": [{"index": word.index, "text": word.text, "unit": word.unit, "paragraph": word.paragraph} for word in span.words],
    }
