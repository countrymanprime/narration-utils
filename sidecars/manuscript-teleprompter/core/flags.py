"""
Suspected reading errors for the Manuscript Teleprompter (ADR 0105). The script
tracker (script_tracker.py) already aligns what the narrator said with the
script; this module reads that alignment once a segment closes and reports
what did not line up as `flag` events, after the tracker's `position` events:

    {"type": "flag", "id": 3, "kind": "misread", "start": 7, "end": 8, "heard": "chairs"}

`kind` is one of:
- "misread": script words [start, end) were read as the `heard` words.
- "skipped": script words [start, end) were passed over (`heard` is "").
- "extra": the `heard` words were said between two script words; the flag is
  zero-width, start == end == the index of the script word after them.
- "restart": script words [start, end) were read again (`heard` is the re-read):
  the narrator's own recovery after a flub, flagged so it can be reviewed.
`start`/`end` are `script_words()` indices, the space of a position's `read`.
`id` counts a session's flags from 1.

Every flag is only ever *suspected*: live recognition is not proof, and
Transcript Compare over the recorded take stays authoritative. So the rules
favour precision over recall (a doubtful discrepancy is dropped, not flagged):
- confirmed words only, judged once the segment has closed;
- a discrepancy is judged only between two matched script words, never at a
  segment's ragged edges, and never with a heard word among its first
  SEGMENT_HEAD_WORDS words (where both engines revise most, ADR 0021);
- a heard reading that says the same thing in other spelling (numbers,
  hyphenation, homophones, possessives: narration_common.spoken_forms, the
  forms Transcript Compare forgives too) is not a misread or an extra;
- hesitations are not extras, a single dropped article is not a skip, a single
  repeated word is not a restart (engines drop and duplicate those on their
  own), and a long run of unplaceable words is not called a misread.
A jump the tracker makes on confirmed words (a restart behind, a skip ahead)
is flagged as it stands: the tracker already demands strong evidence for one.
A seek (`reset_to`) is the narrator moving on purpose and is never flagged.
"""

import sys
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

from script_tracker import ScriptTracker, SegmentReading, align, words_match

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "libs" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common.spoken_forms import FILLER_WORDS, spoken_key

FLAG_KINDS = ("misread", "extra", "skipped", "restart")
SEGMENT_HEAD_WORDS = 2
MAX_MISREAD_HEARD_WORDS = 3
# Engines duplicate a word or two when a later decode re-splits what an earlier
# one confirmed ("of the of the", seen on Whisper), so a re-read counts as a
# restart only from three words.
MIN_RESTART_WORDS = 3
# Short words speech engines leave out of a transcript on their own; one of
# these missing alone is not reported as skipped.
ENGINE_DROPPED_WORDS = frozenset({"a", "an", "the", "and", "of"})

# The findings category (docs/architecture/findings-contract.md) each kind is
# persisted under. A restart is a re-read, which take review already files as
# category `pickup` with evidence.kind `restart` (apps/desktop/internal/repeats).
FINDING_CATEGORIES = {
    "misread": "transcript_discrepancy",
    "extra": "transcript_discrepancy",
    "skipped": "transcript_discrepancy",
    "restart": "pickup",
}


@dataclass(frozen=True)
class Flag:
    """A suspected discrepancy in tracker positions (the filtered script);
    `start == end` for an extra."""

    kind: str
    start: int
    end: int
    heard: tuple[str, ...]


@dataclass(frozen=True)
class _Gap:
    """What lies between two consecutive matched heard words (h1 -> s1, h2 -> s2)."""

    s1: int
    s2: int
    heard: tuple[str, ...]
    heard_raw: tuple[str, ...]
    before_raw: str
    after_raw: str
    # The gap's first word starts before the matched word ahead of it ended: the engine confirmed the same audio twice
    # (a later decode re-split what an earlier one confirmed), so nothing was said again.
    echo: bool = False


def _sounds_like(heard: str, written: str) -> bool:
    """`heard` is the written words said right: the same spoken key (numbers,
    hyphenation, homophones, possessives), or a key within the tracker's own
    spelling tolerance for a single word (`words_match`), applied to the run."""
    heard_key, written_key = spoken_key(heard), spoken_key(written)
    return bool(heard_key) and words_match(heard_key, written_key)


def _said_right(gap: "_Gap", written: Sequence[str]) -> bool:
    """Whether the gap's heard words are the written words between its two
    matches said right, also counting a neighbour match the engine split a
    written word across ("7 o" + "clock" for "seven o'clock"). The neighbour
    joins must say exactly the same: a shared neighbour word would otherwise
    carry any short misread over the spelling tolerance."""
    run = " ".join(gap.heard_raw)
    between = " ".join(written[gap.s1 + 1 : gap.s2])
    return (
        _sounds_like(run, between)
        or _same_key(f"{gap.before_raw} {run}", f"{written[gap.s1]} {between}")
        or _same_key(f"{run} {gap.after_raw}", f"{between} {written[gap.s2]}")
    )


def _same_key(heard: str, written: str) -> bool:
    key = spoken_key(heard)
    return bool(key) and key == spoken_key(written)


def _jump_flag(reading: SegmentReading, matches: tuple[int | None, ...]) -> Flag | None:
    location = reading.location
    if location.jump == "skip" and location.skipped:
        # Words heard before the first match may be the skipped words, misheard: only an unbroken skip is flagged.
        if matches and matches[0] is None:
            return None
        return Flag("skipped", location.skipped[0], location.skipped[1], ())
    if location.jump == "restart" and location.first is not None and location.first < reading.anchor:
        end = min(reading.anchor, location.read)
        heard = tuple(raw for raw, match in zip(reading.heard_raw, matches) if match is not None and match < end)
        return Flag("restart", location.first, end, heard)
    return None


def _misread(gap: _Gap, written: Sequence[str]) -> Flag | None:
    if len(gap.heard) > MAX_MISREAD_HEARD_WORDS or _said_right(gap, written):
        return None
    return Flag("misread", gap.s1 + 1, gap.s2, gap.heard_raw)


def _skipped(gap: _Gap, script: Sequence[str]) -> Flag | None:
    if gap.s2 - gap.s1 == 2 and script[gap.s1 + 1] in ENGINE_DROPPED_WORDS:
        return None
    return Flag("skipped", gap.s1 + 1, gap.s2, ())


def _repeat_length(spoken: list[str], script: Sequence[str], s1: int) -> int:
    """How many script words ending at s1 the spoken run repeats (0 if it is not a repeat)."""
    count = len(spoken)
    if count > s1 + 1:
        return 0
    return count if all(words_match(word, script[s1 - count + 1 + offset]) for offset, word in enumerate(spoken)) else 0


def _extra_or_restart(gap: _Gap, script: Sequence[str], written: Sequence[str]) -> Flag | None:
    spoken = [word for word in gap.heard if word not in FILLER_WORDS]
    if not spoken or gap.echo:
        return None
    repeated = _repeat_length(spoken, script, gap.s1)
    if repeated:
        return Flag("restart", gap.s1 - repeated + 1, gap.s1 + 1, gap.heard_raw) if repeated >= MIN_RESTART_WORDS else None
    # An engine that splits one written word ("so-called" -> "so called") matches one half and leaves the other over.
    if _said_right(gap, written):
        return None
    return Flag("extra", gap.s2, gap.s2, gap.heard_raw)


def _gap_flag(gap: _Gap, script: Sequence[str], written: Sequence[str]) -> Flag | None:
    if gap.s2 > gap.s1 + 1:
        return _misread(gap, written) if gap.heard else _skipped(gap, script)
    return _extra_or_restart(gap, script, written) if gap.heard else None


def _echoes(times: Sequence[tuple[float, float] | None], matched: int) -> bool:
    """Whether the heard word after `matched` starts before `matched` ended. Word times are advisory (ADR 0021), so they are
    only ever used to withhold a flag, never to raise one."""
    if matched + 1 >= len(times) or times[matched] is None or times[matched + 1] is None:
        return False
    return times[matched + 1][0] < times[matched][1]


def segment_flags(reading: SegmentReading, script: Sequence[str], written: Sequence[str]) -> list[Flag]:
    """The suspected discrepancies in one closed segment. `script` is the
    tracker's normalized script and `written` the same words as written, both
    by tracker position."""
    matches = align(list(reading.heard), script, reading.location.start)
    found = [_jump_flag(reading, matches)]
    pairs = [(heard, match) for heard, match in enumerate(matches) if match is not None]
    for (h1, s1), (h2, s2) in pairwise(pairs):
        # The gap's own heard words start at h1 + 1: judged only when none of them is among the segment's first words.
        if h1 + 1 < SEGMENT_HEAD_WORDS:
            continue
        heard = (reading.heard[h1 + 1 : h2], reading.heard_raw[h1 + 1 : h2])
        gap = _Gap(s1, s2, *heard, reading.heard_raw[h1], reading.heard_raw[h2], _echoes(reading.heard_times, h1))
        found.append(_gap_flag(gap, script, written))
    return sorted((flag for flag in found if flag is not None), key=lambda flag: (flag.start, flag.end))


class FlaggingTracker:
    """A ScriptTracker that also reports the `flag` events each closed segment
    raises. Same interface: feed engine events, tick the clock, seek."""

    def __init__(self, tokens: list[str]) -> None:
        self._tracker = ScriptTracker(tokens)
        self._script = self._tracker.words
        self._written = tuple(tokens[self._tracker.original_index(position)] for position in range(len(self._script)))
        self._next_id = 1

    def feed(self, event: dict, now: float) -> list[dict]:
        events = self._tracker.feed(event, now)
        reading = self._tracker.take_closed_segment()
        if reading is None:
            return events
        return events + [self._event(flag) for flag in segment_flags(reading, self._script, self._written)]

    def tick(self, now: float) -> list[dict]:
        return self._tracker.tick(now)

    def reset_to(self, word: int, now: float) -> list[dict]:
        return self._tracker.reset_to(word, now)

    def _event(self, flag: Flag) -> dict:
        start = self._tracker.original_index(flag.start)
        end = start if flag.start == flag.end else self._tracker.original_index(flag.end - 1) + 1
        event = {"type": "flag", "id": self._next_id, "kind": flag.kind, "start": start, "end": end, "heard": " ".join(flag.heard)}
        self._next_id += 1
        return event
