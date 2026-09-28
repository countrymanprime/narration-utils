"""Where each paragraph (and sentence) of the script sits in a recording, from the committed word timings.

The manuscript words and the Whisper words are aligned with difflib; a paragraph's span runs from its first to its
last matched word. A cut between two paragraphs is the quietest 10 ms frame between them, so a cut lands in the
reader's pause and not in a word. Finding the cuts needs the audio; `markers_json` writes them to
`alignment/<id>.markers.json` so the markers can be read, and recipes checked, without downloading anything.
"""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

import audio
import numpy as np
from alice_text import HERE, Chapter, tokens

# A paragraph whose words matched less than this is not used as an edit point (a misread or a Whisper miss).
MIN_MATCHED = 0.8
# How far past a span edge the quiet point may be looked for when two spans nearly touch.
SEARCH_SECONDS = 0.25
# How far before the first paragraph and after the last the head and tail cuts are looked for.
EDGE_SEARCH_SECONDS = 1.5
# A cut is in a real pause when the level there is at least this far under the reader's speech level (90th percentile).
CLEAN_CUT_DB = 30
MARKERS_SCHEMA = 1
_SENTENCE_END = re.compile(r"(?<=[.!?][\"'’)\]])\s+|(?<=[.!?])\s+")


@dataclass(frozen=True)
class Span:
    start: float
    end: float
    matched: float


@dataclass(frozen=True)
class Alignment:
    source: dict
    chapter: Chapter
    duration: float
    # None when the alignment was read from the committed markers instead of the recording.
    samples: np.ndarray | None
    rate: int
    levels: np.ndarray | None
    # One per manuscript token in chapter order: (start, end), or None where Whisper heard something else.
    token_times: list[tuple[float, float] | None]
    # For each paragraph, the index of its first token in token_times.
    first_token: list[int]
    paragraphs: list[Span]
    # cuts[0] ends the head (LibriVox preamble and chapter title), cuts[i] is between paragraphs i and i+1
    # (1-based), cuts[n] starts the tail (LibriVox closing lines). cut_clean[i] says whether cuts[i] is in a pause.
    cuts: list[float]
    cut_clean: list[bool]
    # For each paragraph, the cut times around its sentences ([start, between..., end]) and whether each is clean.
    sentences: list[list[float]]
    sentence_clean: list[list[bool]]

    @property
    def has_audio(self) -> bool:
        return self.samples is not None

    @property
    def speech_level(self) -> float:
        return float(np.percentile(self._levels(), 90))

    def _levels(self) -> np.ndarray:
        if self.levels is None:
            raise ValueError(f"{self.source['id']}: this needs the recording; fetch it (build.py fetch)")
        return self.levels

    def slice(self, start: float, end: float) -> np.ndarray:
        """The audio between two times, or nothing when only the markers are loaded."""
        if self.samples is None:
            return np.zeros(0, np.float32)
        return self.samples[round(start * self.rate) : round(end * self.rate)]

    def room_tone(self, seconds: float) -> np.ndarray:
        if self.samples is None:
            return np.zeros(0, np.float32)
        return audio.room_tone(self.samples, self.rate, self._levels(), seconds)

    def usable(self, number: int) -> bool:
        """Paragraph `number` (1-based) aligned well enough, and in real pauses at both ends, to be cut, moved or dropped."""
        return self.paragraphs[number - 1].matched >= MIN_MATCHED and self.cut_clean[number - 1] and self.cut_clean[number]

    def sentence_cuts(self, number: int) -> list[float]:
        """Cut times around the sentences of paragraph `number`: [start, between..., end]."""
        return self.sentences[number - 1]


def _first_word(times: list, lo: int, hi: int) -> tuple[float, float] | None:
    return next((times[i] for i in range(lo, hi) if times[i]), None)


def _last_word(times: list, lo: int, hi: int) -> tuple[float, float] | None:
    return next((times[i] for i in range(hi - 1, lo - 1, -1) if times[i]), None)


def _cut_between(levels: np.ndarray, before: tuple[float, float] | None, after: tuple[float, float] | None) -> float:
    """The quietest point from the middle of the word before to the middle of the word after. Whisper often stretches
    a word over the pause next to it, so the pause may lie inside either word's timing, never past its middle."""
    if before is None or after is None:
        raise ValueError("cannot cut next to a sentence with no matched words")
    lo, hi = sum(before) / 2, sum(after) / 2
    if hi - lo < 2 * SEARCH_SECONDS:
        lo, hi = min(lo, hi) - SEARCH_SECONDS / 2, max(lo, hi) + SEARCH_SECONDS / 2
    return audio.quietest(levels, lo, hi)[0]


def _heard_tokens(words: list) -> list[tuple[str, float, float]]:
    return [(token, start, end) for text, start, end in words for token in tokens(text)]


def match_words(source: dict, chapter: Chapter, root: Path = HERE) -> tuple[list[tuple[float, float] | None], list[int]]:
    """The script's tokens matched to the committed word timings (no audio needed), and each paragraph's first token."""
    words = json.loads((root / "alignment" / f"{source['id']}.words.json").read_text(encoding="utf-8"))["words"]
    heard = _heard_tokens(words)
    script: list[str] = []
    first_token = []
    for paragraph in chapter.paragraphs:
        first_token.append(len(script))
        script.extend(tokens(paragraph.text))
    times: list[tuple[float, float] | None] = [None] * len(script)
    matcher = difflib.SequenceMatcher(None, script, [t for t, _, _ in heard], autojunk=False)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            _, start, end = heard[block.b + k]
            times[block.a + k] = (start, end)
    return times, first_token


def _paragraph_spans(source: dict, times: list, first_token: list[int]) -> tuple[list[Span], list[tuple]]:
    spans, edges = [], []
    for i, first in enumerate(first_token):
        last = first_token[i + 1] if i + 1 < len(first_token) else len(times)
        head, tail = _first_word(times, first, last), _last_word(times, first, last)
        if head is None or tail is None:
            raise ValueError(f"{source['id']}: paragraph {i + 1} has no matched words")
        edges.append((head, tail))
        spans.append(Span(head[0], tail[1], round(sum(1 for t in times[first:last] if t) / max(1, last - first), 3)))
    return spans, edges


def _sentence_cuts(chapter: Chapter, times: list, first_token: list[int], cuts: list[float], levels: np.ndarray) -> list[list[float]]:
    out = []
    for number, paragraph in enumerate(chapter.paragraphs, start=1):
        parts = [s for s in _SENTENCE_END.split(paragraph.text) if s.strip()]
        first = first_token[number - 1]
        last = first + len(tokens(paragraph.text))
        inner, offset = [], first
        for part in parts[:-1]:
            offset += len(tokens(part))
            inner.append(_cut_between(levels, _last_word(times, first, offset), _first_word(times, offset, last)))
        out.append([cuts[number - 1], *inner, cuts[number]])
    return out


def align(source: dict, chapter: Chapter, sources_dir: Path, root: Path = HERE) -> Alignment:
    """The alignment measured on the recording itself (fetched into `sources_dir`)."""
    samples, rate = audio.decode(sources_dir / source["file"])
    levels = audio.frame_levels(samples, rate)
    times, first_token = match_words(source, chapter, root)
    spans, edges = _paragraph_spans(source, times, first_token)
    duration = len(samples) / rate
    opening = sum(edges[0][0]) / 2
    cuts = [audio.quietest(levels, max(0.0, opening - EDGE_SEARCH_SECONDS), opening)[0]]
    cuts += [_cut_between(levels, before[1], after[0]) for before, after in pairwise(edges)]
    closing = sum(edges[-1][1]) / 2
    cuts.append(audio.quietest(levels, closing, min(duration, closing + EDGE_SEARCH_SECONDS))[0])
    speech = float(np.percentile(levels, 90))

    def clean(seconds: float) -> bool:
        return float(levels[min(len(levels) - 1, round(seconds / audio.HOP_SECONDS))]) <= speech - CLEAN_CUT_DB

    sentences = _sentence_cuts(chapter, times, first_token, cuts, levels)
    return Alignment(
        source, chapter, duration, samples, rate, levels, times, first_token, spans, cuts,
        [clean(c) for c in cuts], sentences, [[clean(c) for c in row] for row in sentences],
    )  # fmt: skip


def markers_json(alignment: Alignment) -> dict:
    """Where every paragraph and sentence of the script sits in the recording, and which cuts are in real pauses."""
    paragraphs = []
    for number, (paragraph, span) in enumerate(zip(alignment.chapter.paragraphs, alignment.paragraphs, strict=True), start=1):
        paragraphs.append(
            {
                "id": paragraph.id,
                "start_s": span.start,
                "end_s": span.end,
                "matched": span.matched,
                "sentence_cuts_s": alignment.sentences[number - 1],
                "sentence_cuts_clean": alignment.sentence_clean[number - 1],
            }
        )
    return {
        "schemaVersion": MARKERS_SCHEMA,
        "source": alignment.source["id"],
        "chapter": alignment.chapter.id,
        "duration_s": round(alignment.duration, 3),
        "sample_rate": alignment.rate,
        "cuts_s": alignment.cuts,
        "cuts_clean": alignment.cut_clean,
        "paragraphs": paragraphs,
    }


def from_markers(source: dict, chapter: Chapter, root: Path = HERE) -> Alignment:
    """The alignment read from the committed markers: every edit point, but no audio."""
    data = json.loads((root / "alignment" / f"{source['id']}.markers.json").read_text(encoding="utf-8"))
    if data["chapter"] != chapter.id or len(data["paragraphs"]) != len(chapter.paragraphs):
        raise ValueError(f"{source['id']}: the markers do not match {chapter.id}; rebuild them (build.py markers)")
    times, first_token = match_words(source, chapter, root)
    spans = [Span(p["start_s"], p["end_s"], p["matched"]) for p in data["paragraphs"]]
    return Alignment(
        source, chapter, data["duration_s"], None, data["sample_rate"], None, times, first_token, spans,
        data["cuts_s"], data["cuts_clean"],
        [p["sentence_cuts_s"] for p in data["paragraphs"]], [p["sentence_cuts_clean"] for p in data["paragraphs"]],
    )  # fmt: skip
