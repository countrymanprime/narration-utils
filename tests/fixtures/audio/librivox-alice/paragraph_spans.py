"""Where each paragraph (and sentence) of the script sits in a recording, from the committed word timings.

The manuscript words and the Whisper words are aligned with difflib; a paragraph's span runs from its first to its
last matched word. A cut between two paragraphs is the quietest 10 ms frame between them, so a cut lands in the
reader's pause and not in a word.
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
    samples: np.ndarray
    rate: int
    levels: np.ndarray
    # One per manuscript token in chapter order: (start, end), or None where Whisper heard something else.
    token_times: list[tuple[float, float] | None]
    # For each paragraph, the index of its first token in token_times.
    first_token: list[int]
    paragraphs: list[Span]
    # cuts[0] ends the head (LibriVox preamble and chapter title), cuts[i] is between paragraphs i and i+1
    # (1-based), cuts[n] starts the tail (LibriVox closing lines).
    cuts: list[float]

    @property
    def speech_level(self) -> float:
        return float(np.percentile(self.levels, 90))

    def clean_cut(self, seconds: float) -> bool:
        """The cut at `seconds` is in a real pause: at least CLEAN_CUT_DB under the reader's speech level."""
        return float(self.levels[min(len(self.levels) - 1, round(seconds / audio.HOP_SECONDS))]) <= self.speech_level - CLEAN_CUT_DB

    @property
    def duration(self) -> float:
        return len(self.samples) / self.rate

    def slice(self, start: float, end: float) -> np.ndarray:
        return self.samples[round(start * self.rate) : round(end * self.rate)]

    def usable(self, number: int) -> bool:
        """Paragraph `number` (1-based) aligned well enough, and in real pauses at both ends, to be cut, moved or dropped."""
        return self.paragraphs[number - 1].matched >= MIN_MATCHED and self.clean_cut(self.cuts[number - 1]) and self.clean_cut(self.cuts[number])

    def sentence_cuts(self, number: int) -> list[float]:
        """Cut times around the sentences of paragraph `number`: [start, between..., end]."""
        paragraph = self.chapter.paragraphs[number - 1]
        parts = [s for s in _SENTENCE_END.split(paragraph.text) if s.strip()]
        first = self.first_token[number - 1]
        last = first + len(tokens(paragraph.text))
        cuts = [self.cuts[number - 1]]
        offset = first
        for part in parts[:-1]:
            offset += len(tokens(part))
            cuts.append(_cut_between(self.levels, _last_word(self.token_times, first, offset), _first_word(self.token_times, offset, last)))
        cuts.append(self.cuts[number])
        return cuts


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


def _match(script: list[str], heard: list[tuple[str, float, float]]) -> list[tuple[float, float] | None]:
    times: list[tuple[float, float] | None] = [None] * len(script)
    matcher = difflib.SequenceMatcher(None, script, [t for t, _, _ in heard], autojunk=False)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            _, start, end = heard[block.b + k]
            times[block.a + k] = (start, end)
    return times


def align(source: dict, chapter: Chapter, root: Path = HERE) -> Alignment:
    samples, rate = audio.decode(root / source["file"])
    levels = audio.frame_levels(samples, rate)
    words = json.loads((root / "alignment" / f"{source['id']}.words.json").read_text(encoding="utf-8"))["words"]
    script: list[str] = []
    first_token = []
    for paragraph in chapter.paragraphs:
        first_token.append(len(script))
        script.extend(tokens(paragraph.text))
    times = _match(script, _heard_tokens(words))

    spans, edges = [], []
    for i, first in enumerate(first_token):
        last = first_token[i + 1] if i + 1 < len(first_token) else len(script)
        head, tail = _first_word(times, first, last), _last_word(times, first, last)
        if head is None or tail is None:
            raise ValueError(f"{source['id']}: paragraph {i + 1} has no matched words")
        edges.append((head, tail))
        spans.append(Span(head[0], tail[1], round(sum(1 for t in times[first:last] if t) / max(1, last - first), 3)))

    duration = len(samples) / rate
    opening = sum(edges[0][0]) / 2
    cuts = [audio.quietest(levels, max(0.0, opening - EDGE_SEARCH_SECONDS), opening)[0]]
    cuts += [_cut_between(levels, before[1], after[0]) for before, after in pairwise(edges)]
    closing = sum(edges[-1][1]) / 2
    cuts.append(audio.quietest(levels, closing, min(duration, closing + EDGE_SEARCH_SECONDS))[0])
    return Alignment(source, chapter, samples, rate, levels, times, first_token, spans, cuts)


def load_sources(root: Path = HERE) -> dict[str, dict]:
    return {s["id"]: s for s in json.loads((root / "sources.json").read_text(encoding="utf-8"))["sources"]}
