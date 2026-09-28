"""Character-continuity clips from one reader voicing every character: the trial's `manifest.json` layout.

A quoted line is labelled only when the text tags its speaker next to it ("'...,' said the Hatter", "the Hatter
said, '...'", "'...,' thought Alice"); the second half of a split line ("'...,' said the Hatter, '...'") takes the
same speaker. Untagged lines are left out, not guessed. Narration clips are the unquoted stretches of at least
NARRATION_MIN_WORDS words. See scripts/research/character-continuity-acoustic-trial for the trial that reads this.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import audio
from alice_text import tokens
from paragraph_spans import Alignment

MIN_CLIP_SECONDS = 0.8
MIN_MATCHED = 0.85
NARRATION_MIN_WORDS = 12
NARRATION_PER_CHAPTER = 12
PAD_BEFORE, PAD_AFTER = 0.03, 0.06

SPEAKERS = {
    "Alice": "alice",
    "White Rabbit": "white_rabbit",
    "Rabbit": "white_rabbit",
    "Mouse": "mouse",
    "Hatter": "hatter",
    "March Hare": "march_hare",
    "Dormouse": "dormouse",
    "Mock Turtle": "mock_turtle",
    "Gryphon": "gryphon",
    "King": "king",
    "Queen": "queen",
    "Duchess": "duchess",
    "Knave": "knave",
}
_NAMES = "|".join(sorted((re.escape(n) for n in SPEAKERS), key=len, reverse=True))
_VERBS = r"said|cried|replied|asked|exclaimed|shouted|remarked|continued|added|began|interrupted|thought|repeated|whispered|screamed|growled|sobbed|pleaded|muttered|went on|called out|observed|roared|answered"
_AFTER = re.compile(
    rf"^[\s,;:.!?—-]*(?:(?:{_VERBS})(?: to (?:herself|himself|itself|the \w+))?,? (?:the )?(?P<a>{_NAMES})\b|(?:the )?(?P<b>{_NAMES}) (?:{_VERBS})\b)"
)
_BEFORE = re.compile(rf"(?:the )?(?P<c>{_NAMES}) (?:{_VERBS})(?: to (?:herself|himself|itself|the \w+))?[^‘’]{{0,40}}[,:]\s*$")
_QUOTE = re.compile("‘(.+?)’(?![a-zA-Z])")


def tagged_quotes(text: str) -> list[tuple[int, int, str]]:
    """(start, end, speaker) character spans of the quotes whose speaker the text names."""
    quotes = list(_QUOTE.finditer(text))
    found: list[tuple[int, int, str]] = []
    for i, quote in enumerate(quotes):
        after = _AFTER.match(text[quote.end() : quote.end() + 80])
        before = _BEFORE.search(text[max(0, quote.start() - 80) : quote.start()])
        name = (after and (after.group("a") or after.group("b"))) or (before and before.group("c"))
        if not name and found and i > 0 and found[-1][1] == quotes[i - 1].end(1):
            gap = text[quotes[i - 1].end() : quote.start()]
            if _AFTER.match(gap) and len(gap) < 60:
                name = next(n for n, v in SPEAKERS.items() if v == found[-1][2])
        if name:
            found.append((quote.start(1), quote.end(1), SPEAKERS[name]))
    return found


def _clip_times(alignment: Alignment, number: int, text: str, start: int, end: int) -> tuple[float, float] | None:
    first = alignment.first_token[number - 1] + len(tokens(text[:start]))
    count = len(tokens(text[start:end]))
    times = alignment.token_times[first : first + count]
    matched = [t for t in times if t]
    if not count or len(matched) / count < MIN_MATCHED or not times[0] or not times[-1]:
        return None
    lo, hi = times[0][0] - PAD_BEFORE, times[-1][1] + PAD_AFTER
    return (round(lo, 2), round(hi, 2)) if hi - lo >= MIN_CLIP_SECONDS else None


def _narration_spans(text: str, quotes: list[tuple[int, int]]) -> list[tuple[int, int]]:
    spans, cursor = [], 0
    for start, end in [*quotes, (len(text) + 1, len(text) + 1)]:
        segment = (cursor, max(cursor, start - 1))
        if len(tokens(text[segment[0] : segment[1]])) >= NARRATION_MIN_WORDS:
            spans.append(segment)
        cursor = end + 1
    return spans


def lines_for(alignment: Alignment) -> list[dict]:
    """Every labelled clip of one chapter: its character and its time in the source."""
    lines, narration = [], []
    for number, paragraph in enumerate(alignment.chapter.paragraphs, start=1):
        text = paragraph.text
        all_quotes = [(q.start(1), q.end(1)) for q in _QUOTE.finditer(text)]
        for start, end, speaker in tagged_quotes(text):
            times = _clip_times(alignment, number, text, start, end)
            if times:
                lines.append({"character": speaker, "text": text[start:end], "start_s": times[0], "end_s": times[1]})
        for start, end in _narration_spans(text, all_quotes):
            times = _clip_times(alignment, number, text, start, end)
            if times:
                narration.append({"character": "narration", "text": text[start:end].strip(), "start_s": times[0], "end_s": times[1]})
    step = max(1, len(narration) // NARRATION_PER_CHAPTER)
    return lines + narration[::step][:NARRATION_PER_CHAPTER]


def build(out: Path, alignments: list[Alignment]) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    manifest_lines = []
    for alignment in alignments:
        chapter = alignment.chapter.number
        counters: dict[str, int] = {}
        for line in lines_for(alignment):
            index = counters.get(line["character"], 0)
            counters[line["character"]] = index + 1
            rel = Path(f"chapter{chapter:02d}") / line["character"] / f"line{index:02d}.wav"
            clip = alignment.slice(line["start_s"], line["end_s"])
            audio.write_wav(out / rel, clip, alignment.rate)
            manifest_lines.append(
                {
                    "chapter": chapter,
                    "character": line["character"],
                    "line_index": index,
                    "path": rel.as_posix(),
                    "duration_s": round(len(clip) / alignment.rate, 3),
                    "is_reference_eligible": True,
                    "source": alignment.source["id"],
                    "start_s": line["start_s"],
                    "end_s": line["end_s"],
                    "text": line["text"],
                }
            )
    readers = sorted({a.source["reader"] for a in alignments})
    route = "librivox-" + "+".join(r.lower().replace(" ", "-") for r in readers)
    manifest = {"sample_rate": alignments[0].rate, "route": route, "voices": {}, "lines": manifest_lines}
    path = out / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path
