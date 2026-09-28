"""
Offline word-time alignment for punch and roll (teleprompter-manuscript-integration PRD Phase 12, ADR 0560): the
project time of one script word, taken from the recording itself when the live punch anchors do not cover it.

"Punch from here" needs the time a flagged word was spoken. The host first asks the anchors the live session's
play-position poll recorded (apps/desktop/internal/teleprompter/anchors.go); when none brackets the word it runs this
mode once over a stretch of the chapter's recorded audio, through `live_asr.py --align-word`:

    python live_asr.py --align-word 812 --wav take.wav --tail-start 700.0 --tail-end 820.0 \\
        --manuscript manuscript.json --chapter c1 --model tiny --model-dir DIR

It is the tail-audio locate's machinery pointed at a word instead of the end (locate.py, ADR 0111): the same audio cut
(`read_audio_range`), the same faster-whisper decoder with Silero VAD and word timestamps (`live_asr.make_decoder`),
the same ranking of every place the heard words fit (the order of `locate.rank`, over the tracker's own `advance`
step), and then a longest-matching-blocks pass from the best place (with the tracker's fuzzy `words_match` inside
gaps), which says which script word each heard word is and, unlike the tracker's walk, survives a long run of words
Whisper dropped. The
word's time is the start Whisper gave the heard word matched to it; a word the narrator misread or Whisper dropped,
with matched words on both sides, is placed between them at the stretch's own pace, after the pause when a sentence
ends in the gap and before it otherwise. There is still no
forced alignment (ADR 0008) and no model download: `--model-dir` is required.

Output is one JSON line on stdout:

    {"type": "word_time", "word": 812, "time": 783.42, "exact": true, "matched": 188, "heard": 201, "tokens": 2210}

`time` is seconds into `--wav` (the host maps it onto the project timeline through the item's offset and rate), or
null when the word is not in the stretch: the heard words place nowhere (fewer than MIN_JUMP_MATCHES fit), or the
word lies before the first or after the last word they matched. `exact` is whether the word itself was heard, as
opposed to placed between two neighbours that were.
"""

import difflib
import re
import sys
from bisect import bisect_left
from dataclasses import dataclass
from pathlib import Path
from statistics import median

_CORE_DIR = Path(__file__).resolve().parent
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "libs" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from locate import _SENTENCE_END_RE, _Script, _start_positions, read_audio_range
from narration_common.logging_utils import log
from script_tracker import MIN_JUMP_MATCHES, advance, normalize_word, words_match

# The pace a stretch with too few neighbouring words heard to measure one is taken to have: about 150 words a minute.
DEFAULT_PACE_SECONDS = 0.4

# Punctuation a reader pauses at between words that does not end a sentence: at the end of a word, or opening the next.
_PAUSE_AFTER_RE = re.compile(r"[,;:—–\-)\]’”\"']$")
_PAUSE_BEFORE_RE = re.compile(r"^[(\[‘“\"'—–\-]")

# How much longer than the stretch's pace a gap of unheard words may run and still be read as those words with no
# pause among them.
PAUSE_FACTOR = 1.5

# Script words past twice the heard count a stretch's passage still reaches, for a narrator who skipped some.
PASSAGE_SLACK_WORDS = 20


@dataclass(frozen=True)
class WordTime:
    """Where script token `word` starts in the decoded audio, in its seconds (None when it is not in it)."""

    word: int
    time: float | None
    exact: bool
    matched: int
    heard: int


def _best_first(heard: list[str], script: list[str]) -> tuple[int | None, int]:
    """The first script word of the best alignment of `heard`, and how many words it matches: the same order as
    `locate.rank` (most words matched, then the tightest span, then the earliest)."""
    best_key, first, matched = None, None, 0
    for start in _start_positions(heard, script):
        alignment = advance(heard, script, start)
        if not alignment.matched or alignment.first is None:
            continue
        key = (alignment.matched, -(alignment.read - alignment.first), -alignment.first)
        if best_key is None or key > best_key:
            best_key, first, matched = key, alignment.first, alignment.matched
    return first, matched


def _pairs(heard: list[str], passage: list[str]) -> list[tuple[int, int]]:
    """(heard index, passage index) for every heard word that is a word of `passage`, in order. The tracker's walk
    (`advance`) steps over at most MAX_SKIP script words, so a longer run Whisper dropped would lose it the rest of the
    stretch; a longest-matching-blocks pass does not, and a gap of the same length on both sides between two blocks is
    paired word for word where the tracker's fuzzy match (`words_match`) accepts it, so a close misspelling still counts."""
    matcher = difflib.SequenceMatcher(None, heard, passage, autojunk=False)
    pairs: list[tuple[int, int]] = []
    heard_at = passage_at = 0
    for block in matcher.get_matching_blocks():
        if block.a - heard_at == block.b - passage_at:
            pairs.extend((heard_at + k, passage_at + k) for k in range(block.a - heard_at) if words_match(heard[heard_at + k], passage[passage_at + k]))
        pairs.extend((block.a + k, block.b + k) for k in range(block.size))
        heard_at, passage_at = block.a + block.size, block.b + block.size
    return pairs


@dataclass(frozen=True)
class Aligned:
    """A stretch of recording placed in the script: each script word heard in it (a position in the tracker's
    filtered script) with its (start, end) seconds, the tracker's view of the script, and the counts."""

    at: dict[int, tuple[float, float]]
    script: _Script
    heard: int
    # How many words the best walk matched: below MIN_JUMP_MATCHES, `at` is empty.
    walked: int
    # The script tokens, and the stretch's pace: the median seconds from one heard word's start to the next script
    # word's, over neighbours both heard.
    tokens: tuple[str, ...] = ()
    pace: float = DEFAULT_PACE_SECONDS


def align_stretch(timed_words: list[tuple[str, float, float]], tokens: list[str]) -> Aligned:
    """Place the timed words decoded from a stretch of recording ((text, start, end), seconds into it) in the script
    `tokens` (`script_words()` of the chapter). Nothing is placed when fewer than MIN_JUMP_MATCHES fit anywhere."""
    heard = [(normalize_word(text), start, end) for text, start, end in timed_words]
    heard = [entry for entry in heard if entry[0]]
    words = [text for text, _start, _end in heard]
    script = _Script(tokens)
    first, matched = _best_first(words, script.words)
    if first is None or matched < MIN_JUMP_MATCHES:
        return Aligned({}, script, len(heard), matched)
    # The passage the stretch can cover, around the best place's first word: the best walk may begin after a long run of
    # dropped words, so the passage reaches back as far as forward, by as many script words as were heard plus room for
    # what the narrator skipped.
    reach = len(words) + PASSAGE_SLACK_WORDS
    begin = max(0, first - reach)
    passage = script.words[begin : first + 2 * reach]
    at = {begin + position: heard[index][1:] for index, position in _pairs(words, passage)}
    steps = [at[position + 1][0] - at[position][0] for position in at if position + 1 in at]
    pace = float(median(steps)) if len(steps) >= MIN_JUMP_MATCHES else DEFAULT_PACE_SECONDS
    return Aligned(at, script, len(heard), matched, tuple(tokens), pace)


def time_of(aligned: Aligned, word: int) -> WordTime:
    """When script token `word` starts in an aligned stretch. A punctuation-only token is timed as the next word, which
    is where reading it would begin; a word that was not heard, with heard words on both sides, is placed between them
    (`_in_gap`)."""
    at, heard = aligned.at, aligned.heard
    matched = len(at) if at else aligned.walked
    target = bisect_left(aligned.script.original, word)
    if target >= len(aligned.script.words):
        return WordTime(word, None, False, matched, heard)
    if target in at:
        return WordTime(word, round(at[target][0], 3), True, matched, heard)
    before = max((position for position in at if position < target), default=None)
    after = min((position for position in at if position > target), default=None)
    if before is None or after is None:
        return WordTime(word, None, False, matched, heard)
    return WordTime(word, round(_in_gap(aligned, before, target, after), 3), False, matched, heard)


def _pause_strength(tokens: tuple[str, ...], index: int) -> int:
    """How likely a reader pauses after token `index`: 2 at a sentence end, 1 at any other punctuation between it and
    the next word (a comma, a dash, a bracket or a quote), 0 inside a phrase."""
    if _SENTENCE_END_RE.search(tokens[index]):
        return 2
    following = tokens[index + 1] if index + 1 < len(tokens) else ""
    return 1 if _PAUSE_AFTER_RE.search(tokens[index]) or _PAUSE_BEFORE_RE.match(following) else 0


def _in_gap(aligned: Aligned, before: int, target: int, after: int) -> float:
    """Where unheard script word `target` starts between the heard words `before` and `after` (script positions). A
    span the words fill at about the stretch's pace is shared evenly between them. A longer one holds a pause, which a
    reader takes at punctuation: when the strongest pause point lies between `before` and `target` the unheard words
    are packed at the pace up against `after`, when it lies between `target` and `after` against `before`, and a tie
    shares the span evenly."""
    first, last = aligned.at[before][0], aligned.at[after][0]
    steps, index = after - before, target - before
    even = first + (last - first) * index / steps
    if last - first <= steps * aligned.pace * PAUSE_FACTOR:
        return even
    original, tokens = aligned.script.original, aligned.tokens
    ahead = max(_pause_strength(tokens, token) for token in range(original[before], original[target]))
    behind = max((_pause_strength(tokens, token) for token in range(original[target], original[after])), default=0)
    if ahead > behind:
        return max(first, last - (steps - index) * aligned.pace)
    if behind > ahead:
        return min(last, first + index * aligned.pace)
    return even


def word_time(timed_words: list[tuple[str, float, float]], tokens: list[str], word: int) -> WordTime:
    """`align_stretch` then `time_of`: when script token `word` starts in the decoded stretch."""
    return time_of(align_stretch(timed_words, tokens), word)


def word_time_event(timed_words: list[tuple[str, float, float]], tokens: list[str], word: int, offset: float = 0.0) -> dict:
    """The `word_time` line this mode prints; `offset` (where the decoded stretch starts in the file) is added to the
    time so it is seconds into the file, not into the stretch."""
    result = word_time(timed_words, tokens, word)
    time = None if result.time is None else round(result.time + offset, 3)
    log(
        "aligned the punch word",
        level="debug",
        event="align_word.result",
        word=word,
        found=time is not None,
        exact=result.exact,
        matched=result.matched,
        heard=result.heard,
    )
    return {
        "type": "word_time",
        "word": word,
        "time": time,
        "exact": result.exact,
        "matched": result.matched,
        "heard": result.heard,
        "tokens": len(tokens),
    }


def check_args(ap, args) -> None:
    """Refuse an alignment the host could never have asked for: the locate's own checks on the recording and the
    range, plus a word inside no chapter and a run that asks for both modes."""
    import locate

    if args.locate:
        ap.error("--align-word and --locate are separate runs")
    locate.check_args(ap, args, mode="--align-word")
    if args.align_word < 0:
        ap.error("--align-word must be a script word index, 0 or more")


def run(wav: str, start: float, end: float, tokens: list[str], word: int, decode) -> dict:
    """Cut seconds `start` to `end` out of `wav`, decode them with `decode` (audio -> [(word, start, end)]) and time
    script token `word` in them; returns the `word_time` event, its time in seconds of `wav`."""
    audio = read_audio_range(wav, start, end)
    timed = list(decode(audio)) if len(audio) else []
    return word_time_event(timed, tokens, word, offset=start)
