"""
Tail-audio locate for the Manuscript Teleprompter (teleprompter-manuscript-integration PRD Phase 9, ADR 0111): turn
the last seconds of a chapter's recorded audio into the script word to resume from.

The host (apps/desktop/internal/teleprompter, `Service.Locate`) finds where the chapter's recorded audio ends
(Phase 8, `tracks.RecordedEnd`) and runs this sidecar once, through `live_asr.py --locate`:

    python live_asr.py --locate --wav take.wav --tail-start 812.4 --tail-end 842.4 \\
        --manuscript manuscript.json --chapter c1 --model tiny --model-dir DIR

It cuts that range out of the source file, transcribes it with faster-whisper (the same decoder the live engine
uses, `live_asr.make_decoder`, with Silero VAD on because a recording's tail usually ends in room tone), and places
the heard words in the chapter in two steps. The tracker's `locate()` only searches a window around an anchor and a
tail has no anchor, so first every script position a heard word could start from is tried with the tracker's own
alignment step (`script_tracker.advance`) and the alignments are ranked; then the live tracker (`ScriptTracker`) is
run over the heard words from the best one, which is what turns a retake into a "restart" rather than a few stray
words ahead. There is no forced alignment (ADR 0008) and no model download: `--model-dir` is required, the host
passes the verified directory from the Whisper asset catalog.

Output is one JSON line on stdout:

    {"type": "locate", "word": 812, "last": 811, "sentence": {"start": 798, "end": 812, "text": "..."},
     "confidence": 0.84, "confident": true, "matched": 61, "heard": 70, "runnerUp": 4, "tokens": 2210,
     "heardText": "..."}

`word` is the next script word to read (the same index space as a `position` event's `read`, `script_words()` over
the chapter), `last` the last script word the tail placed, and `sentence` the sentence holding it, which the narrator
confirms before resuming. `word` is null when the tail cannot be placed (silence, or too few words that fit). The
`confidence` is how much of what was heard fits the place (heard words that are words of the passage, so a retake
still fits) times how clearly the place beats the best other one (`1 - runnerUp / matched`): a tail that lies
wholly in a passage the chapter repeats scores near zero, so it is never `confident`.
"""

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

_CORE_DIR = Path(__file__).resolve().parent
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

from script_tracker import MIN_JUMP_MATCHES, ScriptTracker, advance, normalize_word, words_match

SAMPLE_RATE = 16000

# The host asks for DEFAULT_TAIL_SECONDS (apps/desktop/internal/teleprompter/locate.go); anything longer than
# MAX_TAIL_SECONDS is refused, which bounds the decode time and the memory one run can take.
MAX_TAIL_SECONDS = 120.0

# A place needs at least this many heard words that fit the script, in order, to be `confident`; fewer than
# MIN_JUMP_MATCHES (the tracker's own bar for believing a jump) and there is no place at all.
MIN_CONFIDENT_MATCHES = 6

# The score a place needs to be `confident`. Measured on the recorded tails in tests/fixtures/teleprompter-locate:
# every clean tail scores above 0.6, the repeated passage below 0.1.
CONFIDENT_SCORE = 0.5

# How many heard words `follow` feeds the tracker as one segment. A live segment runs to a pause; the tail comes back
# from Whisper as one list, so it is cut into pieces about a clause long: long enough that a retake's words outnumber
# the stray matches ahead (the tracker's JUMP_MARGIN), short enough that a retake is noticed within one piece.
FOLLOW_SEGMENT_WORDS = 8

# A token that ends a sentence: a full stop, question or exclamation mark (or an ellipsis), optionally followed by
# closing quotes or brackets.
_SENTENCE_END_RE = re.compile(r"[.!?…][\"'”’)\]]*$")


@dataclass(frozen=True)
class Placement:
    """One alignment of the heard words: the first and one-past-last script positions it matched, and how many."""

    first: int
    read: int
    matched: int

    def overlaps(self, other: "Placement") -> bool:
        return self.first < other.read and other.first < self.read


@dataclass(frozen=True)
class TailLocation:
    """Where a tail ends in the script, in `script_words()` indices. `word` is None when it could not be placed."""

    word: int | None
    last: int | None
    confidence: float
    confident: bool
    matched: int
    heard: int
    runner_up: int


class _Script:
    """The tracker's view of a token list: punctuation-only tokens dropped, each remaining word normalized, with a map
    back to the original index (the same filtering as `ScriptTracker`)."""

    def __init__(self, tokens: list[str]) -> None:
        indexed = [(index, normalize_word(token)) for index, token in enumerate(tokens)]
        self.token_count = len(tokens)
        self.original = [index for index, word in indexed if word]
        self.words = [word for _, word in indexed if word]

    def original_index(self, position: int) -> int:
        return self.original[position] if position < len(self.original) else self.token_count


def _start_positions(heard: list[str], script: list[str]) -> list[int]:
    """Every script position whose word one of the heard words matches: the only places an alignment can begin."""
    by_word: dict[str, list[int]] = {}
    for position, word in enumerate(script):
        by_word.setdefault(word, []).append(position)
    wanted = set(heard)
    starts: list[int] = []
    for word, positions in by_word.items():
        if any(words_match(heard_word, word) for heard_word in wanted):
            starts.extend(positions)
    return sorted(starts)


def placements(heard: list[str], script: list[str]) -> list[Placement]:
    """Every distinct alignment of `heard` (normalized words) that matches at least one script word."""
    found: set[Placement] = set()
    for start in _start_positions(heard, script):
        alignment = advance(heard, script, start)
        if alignment.matched and alignment.first is not None:
            found.add(Placement(alignment.first, alignment.read, alignment.matched))
    return sorted(found, key=lambda placement: (placement.first, placement.read))


def rank(candidates: list[Placement]) -> tuple[Placement | None, int]:
    """The best placement (most words matched, then the tightest span, then the earliest) and the matched count of
    the best placement that does not overlap it (0 when there is none)."""
    if not candidates:
        return None, 0
    best = max(candidates, key=lambda placement: (placement.matched, -(placement.read - placement.first), -placement.first))
    runner_up = max((placement.matched for placement in candidates if not placement.overlaps(best)), default=0)
    return best, runner_up


def follow(heard: list[str], tokens: list[str], start_word: int) -> int:
    """Run the live tracker (`ScriptTracker`) over the heard words from `start_word` and return where it ends: the
    next word to read. The tracker is what notices a retake (the narrator going back to re-read a sentence, a
    "restart"), which a single forward alignment reads as a few stray words ahead. The tail comes as one flat word
    list, so it is fed in segments of FOLLOW_SEGMENT_WORDS, each one the tracker's unit for a jump."""
    tracker = ScriptTracker(tokens)
    committed = start_word
    for position in tracker.reset_to(start_word, 0.0):
        committed = position["committed"]
    for segment, offset in enumerate(range(0, len(heard), FOLLOW_SEGMENT_WORDS)):
        for word in heard[offset : offset + FOLLOW_SEGMENT_WORDS]:
            for position in tracker.feed({"type": "word", "segment": segment, "word": word}, 0.0):
                committed = position["committed"]
        tracker.feed({"type": "segment_end", "segment": segment}, 0.0)
    return committed


def _fitting(heard: list[str], passage: list[str]) -> int:
    """How many heard words are words of `passage`, in any order: a retake's second reading fits the place as well as
    the first, while an ad-lib or another chapter's words do not."""
    vocabulary = set(passage)
    return sum(1 for word in heard if word in vocabulary or any(words_match(word, known) for known in vocabulary))


def _last_word_before(tokens: list[str], word: int) -> int | None:
    """The last token before `word` that is a word, not punctuation alone."""
    return next((index for index in range(min(word, len(tokens)) - 1, -1, -1) if normalize_word(tokens[index])), None)


def locate_tail(heard_words: list[str], tokens: list[str]) -> TailLocation:
    """Place the words heard in a recording's tail in the script `tokens` (`script_words()` of the chapter): rank every
    place they fit for the confidence, then follow them with the tracker from the best one for the resume word."""
    heard = [word for word in (normalize_word(text) for text in heard_words) if word]
    script = _Script(tokens)
    best, runner_up = rank(placements(heard, script.words))
    if best is None or best.matched < MIN_JUMP_MATCHES:
        return TailLocation(None, None, 0.0, False, best.matched if best else 0, len(heard), runner_up)
    coverage = _fitting(heard, script.words[best.first : best.read]) / len(heard)
    distinct = 1.0 - runner_up / best.matched
    confidence = round(coverage * distinct, 3)
    confident = best.matched >= MIN_CONFIDENT_MATCHES and confidence >= CONFIDENT_SCORE
    start = script.original_index(best.first)
    word = follow(heard, tokens, start)
    if word <= start:  # the tracker placed nothing from there: keep the ranked alignment's own end
        word = script.original_index(best.read)
    return TailLocation(
        word=word,
        last=_last_word_before(tokens, word),
        confidence=confidence,
        confident=confident,
        matched=best.matched,
        heard=len(heard),
        runner_up=runner_up,
    )


def sentence_bounds(tokens: list[str], index: int, breaks: set[int]) -> tuple[int, int]:
    """The [start, end) token range of the sentence holding token `index`: it runs from just after the previous token
    that ends a sentence to the next one (inclusive), and never crosses a paragraph break (`breaks` holds the index of
    each paragraph's first token)."""
    start = index
    while start > 0 and start not in breaks and not _SENTENCE_END_RE.search(tokens[start - 1]):
        start -= 1
    end = index + 1
    while end < len(tokens) and end not in breaks and not _SENTENCE_END_RE.search(tokens[end - 1]):
        end += 1
    return start, end


def locate_event(heard_words: list[str], tokens: list[str], breaks: set[int] | None = None) -> dict:
    """The `locate` line this mode prints for a tail's heard words."""
    location = locate_tail(heard_words, tokens)
    sentence = None
    if location.last is not None:
        start, end = sentence_bounds(tokens, location.last, breaks or set())
        sentence = {"start": start, "end": end, "text": " ".join(tokens[start:end])}
    return {
        "type": "locate",
        "word": location.word,
        "last": location.last,
        "sentence": sentence,
        "confidence": location.confidence,
        "confident": location.confident,
        "matched": location.matched,
        "heard": location.heard,
        "runnerUp": location.runner_up,
        "tokens": len(tokens),
        "heardText": " ".join(word for word in heard_words if word),
    }


def read_audio_range(path: str, start: float, end: float) -> np.ndarray:
    """Seconds `start` to `end` of an audio file as 16 kHz mono float32 (PyAV, the same resample `live_asr` uses).
    It seeks to the nearest point at or before `start` and trims, so only the tail is decoded, not the whole take."""
    import av

    with av.open(path) as container:
        stream = container.streams.audio[0]
        if start > 0 and stream.time_base:
            container.seek(int(start / stream.time_base), stream=stream, backward=True, any_frame=False)
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
        pieces: list[np.ndarray] = []
        origin = None
        for frame in container.decode(stream):
            if origin is None:
                origin = float(frame.time or 0.0)
            if frame.time is not None and frame.time >= end:
                break
            pieces.extend(resampled.to_ndarray()[0].astype(np.float32) for resampled in resampler.resample(frame))
        pieces.extend(resampled.to_ndarray()[0].astype(np.float32) for resampled in resampler.resample(None))
    audio = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)
    origin = origin or 0.0
    first = max(0, round((start - origin) * SAMPLE_RATE))
    last = max(first, round((end - origin) * SAMPLE_RATE))
    return audio[first:last]


def check_args(ap, args) -> None:
    """Refuse a locate run the host could never have asked for (argparse exits with status 2)."""
    if args.mic:
        ap.error("--locate reads a recording (--wav), not a microphone")
    if not args.wav:
        ap.error("--locate needs --wav")
    if args.engine != "whisper":
        ap.error("--locate runs the whisper engine only")
    if not args.model_dir:
        ap.error("--locate needs --model-dir: it never downloads a model")
    if not (args.manuscript or args.script):
        ap.error("--locate needs --manuscript and --chapter, or --script")
    if args.tail_start is None or args.tail_end is None:
        ap.error("--locate needs --tail-start and --tail-end")
    if not (np.isfinite(args.tail_start) and np.isfinite(args.tail_end)) or args.tail_start < 0 or args.tail_end <= args.tail_start:
        ap.error("--tail-start and --tail-end must be seconds with 0 <= start < end")
    if args.tail_end - args.tail_start > MAX_TAIL_SECONDS:
        ap.error(f"--locate reads at most {MAX_TAIL_SECONDS:g} seconds of audio")


def load_script(args) -> tuple[list[str], set[int]]:
    """The script tokens and paragraph breaks from --manuscript/--chapter (chapter_script, which raises ChapterError
    for an unknown chapter) or --script, as for a live session."""
    from script_tracker import script_words

    if args.manuscript:
        from chapter_script import load_chapter_script

        chapter = load_chapter_script(args.manuscript, args.chapter)
        return chapter.tokens, {span.start for span in chapter.spans}
    return script_words(Path(args.script).read_text(encoding="utf-8")), set()


def run(wav: str, start: float, end: float, tokens: list[str], breaks: set[int], decode) -> dict:
    """Cut seconds `start` to `end` out of `wav`, decode them with `decode` (audio -> [(word, start, end)]) and place
    the heard words in `tokens`; returns the `locate` event."""
    audio = read_audio_range(wav, start, end)
    heard = [text for text, _word_start, _word_end in decode(audio)] if len(audio) else []
    return locate_event(heard, tokens, breaks)
