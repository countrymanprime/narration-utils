"""
Script tracker for the Manuscript Teleprompter (see
docs/architecture/manuscript-teleprompter.md). Engine-independent: it consumes
the `partial`, `word` and `segment_end` events any live ASR engine emits
(live_asr.py) and follows the narrator through a known script, emitting
`position` events when the cursor, the committed position or the status change:

    {"type": "position", "read": 12, "committed": 10, "status": "listening",
     "jump": null, "skipped": null}

`read` is the number of script tokens consumed, i.e. the index of the next
word to read (the UI highlights that word). `committed` is the same measure
from confirmed words only. Indices are into `script_words(text)`, the
whitespace-split tokens, so the UI must tokenize the same way. `status` is
"listening", "waiting" (no forward progress for WAIT_SECONDS) or "done".

The design follows Autocue (https://github.com/EdNutting/autocue, MIT): a
speculative cursor driven by every partial hypothesis (forward-only, so
wobbling partials never make the highlight flicker backward) and a committed
position driven by confirmed words that re-anchors each segment. Matching is
fuzzy and ignores heard words that fit nothing nearby (fillers, garbage first
words), steps over up to MAX_SKIP script words (misreads, skipped words), and
only jumps elsewhere in the script - a restart or a skip ahead - on strong
evidence: MIN_JUMP_MATCHES matching words that beat the nearby match by
JUMP_MARGIN. Engine word timestamps are deliberately ignored (they are
noisy); only word order and the arrival time passed to feed()/tick() matter.
"""

import difflib
import re
from dataclasses import dataclass
from functools import lru_cache

MAX_SKIP = 2
BACK_WORDS = 40
AHEAD_WORDS = 30
MIN_JUMP_MATCHES = 3
JUMP_MARGIN = 2
WAIT_SECONDS = 1.5
FUZZY_MIN_LENGTH = 4
FUZZY_RATIO = 0.8

_NON_WORD_CHARS_RE = re.compile(r"[^\w']")


def normalize_word(word: str) -> str:
    return _NON_WORD_CHARS_RE.sub("", word.lower())


def script_words(text: str) -> list[str]:
    """The tokens position indices refer to."""
    return text.split()


@lru_cache(maxsize=65536)
def words_match(heard: str, script: str) -> bool:
    """Normalized equality, or a close spelling of a longer word (plurals and
    small recognition slips), never for short words."""
    if heard == script:
        return True
    if len(heard) < FUZZY_MIN_LENGTH or len(script) < FUZZY_MIN_LENGTH:
        return False
    return difflib.SequenceMatcher(None, heard, script).ratio() >= FUZZY_RATIO


@dataclass(frozen=True)
class Alignment:
    read: int
    matched: int
    first: int | None


def advance(heard: list[str], script: list[str], start: int) -> Alignment:
    """Walk the heard words through the script from `start`: each matches the
    next script word or one of the next MAX_SKIP after it (skipping those);
    a heard word that matches none is ignored."""
    position, matched, first = start, 0, None
    for word in heard:
        for skip in range(MAX_SKIP + 1):
            index = position + skip
            if index >= len(script):
                break
            if words_match(word, script[index]):
                first = index if first is None else first
                position, matched = index + 1, matched + 1
                break
    return Alignment(position, matched, first)


@dataclass(frozen=True)
class Location:
    read: int
    matched: int
    jump: str | None
    skipped: tuple[int, int] | None


def locate(heard: list[str], script: list[str], anchor: int) -> Location:
    """Where the heard words sit in the script: from the anchor, unless a
    clearly better alignment exists elsewhere nearby (a restart behind or a
    skip ahead), which is reported as a jump."""
    near = advance(heard, script, anchor)
    if len(heard) < MIN_JUMP_MATCHES:
        return Location(near.read, near.matched, None, None)

    best_key, best_start, best = None, anchor, None
    for start in range(max(0, anchor - BACK_WORDS), min(len(script), anchor + AHEAD_WORDS)):
        if anchor <= start <= anchor + MAX_SKIP:
            continue
        candidate = advance(heard, script, start)
        if candidate.matched < MIN_JUMP_MATCHES or candidate.matched < near.matched + JUMP_MARGIN:
            continue
        key = (candidate.matched, -abs(start - anchor))
        if best_key is None or key > best_key:
            best_key, best_start, best = key, start, candidate

    if best is None:
        return Location(near.read, near.matched, None, None)
    if best_start < anchor:
        return Location(best.read, best.matched, "restart", None)
    skipped = (anchor, best.first) if best.first is not None and best.first > anchor else None
    return Location(best.read, best.matched, "skip", skipped)


def _heard_words(words: list[dict]) -> list[str]:
    return [n for n in (normalize_word(w["word"]) for w in words) if n]


class ScriptTracker:
    """Stateful follower of one narrator through one script. Feed it engine
    events with their arrival time (seconds on any consistent clock); it
    returns the `position` events (0 or 1) each one caused."""

    def __init__(self, tokens: list[str]) -> None:
        indexed = [(index, normalize_word(token)) for index, token in enumerate(tokens)]
        self._token_count = len(tokens)
        self._original = [index for index, word in indexed if word]
        self._script = [word for _, word in indexed if word]
        self._anchor = 0
        self._committed = 0
        self._display = 0
        self._segment: int | None = None
        self._confirmed: list[str] = []
        self._jump_reported = False
        self._pending_jump: tuple[str, tuple[int, int] | None] | None = None
        self._progress_at: float | None = None
        self._emitted = (0, 0, "listening")

    def feed(self, event: dict, now: float) -> list[dict]:
        kind = event.get("type")
        if kind == "partial":
            self._enter_segment(event["segment"])
            self._move_display(locate(_heard_words(event["words"]), self._script, self._anchor), now)
        elif kind == "word":
            self._on_confirmed_word(event, now)
        elif kind == "segment_end":
            self._on_segment_end()
        else:
            return []
        return self._emit(now)

    def tick(self, now: float) -> list[dict]:
        """Report a status change that time alone caused (the pause timeout)."""
        return self._emit(now)

    def _enter_segment(self, segment: int) -> None:
        if segment != self._segment:
            self._segment = segment
            self._confirmed = []
            self._jump_reported = False

    def _on_confirmed_word(self, event: dict, now: float) -> None:
        self._enter_segment(event["segment"])
        word = normalize_word(event["word"])
        if not word:
            return
        self._confirmed.append(word)
        location = locate(self._confirmed, self._script, self._anchor)
        self._committed = location.read
        self._move_display(location, now)

    def _on_segment_end(self) -> None:
        if self._segment is None:
            return
        self._anchor = self._committed
        self._display = self._committed
        self._segment = None
        self._confirmed = []

    def _move_display(self, location: Location, now: float) -> None:
        first_sight_of_jump = location.jump is not None and not self._jump_reported
        target = location.read if first_sight_of_jump else max(self._display, location.read)
        if first_sight_of_jump:
            self._jump_reported = True
            self._pending_jump = (location.jump, self._original_span(location.skipped))
            self._progress_at = now
        elif target > self._display:
            self._progress_at = now
        self._display = target

    def _original_index(self, position: int) -> int:
        return self._original[position] if position < len(self._original) else self._token_count

    def _original_span(self, span: tuple[int, int] | None) -> tuple[int, int] | None:
        return None if span is None else (self._original_index(span[0]), self._original_index(span[1]))

    def _status(self, now: float) -> str:
        if self._script and self._display >= len(self._script):
            return "done"
        if self._progress_at is not None and now - self._progress_at > WAIT_SECONDS:
            return "waiting"
        return "listening"

    def _emit(self, now: float) -> list[dict]:
        state = (self._original_index(self._display), self._original_index(self._committed), self._status(now))
        jump, self._pending_jump = self._pending_jump, None
        if state == self._emitted and jump is None:
            return []
        self._emitted = state
        kind, skipped = jump if jump else (None, None)
        read, committed, status = state
        return [{"type": "position", "read": read, "committed": committed, "status": status, "jump": kind, "skipped": list(skipped) if skipped else None}]
