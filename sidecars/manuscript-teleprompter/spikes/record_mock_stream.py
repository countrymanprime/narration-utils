"""
Regenerates apps/ui/src/api/teleprompterRecording.json, the position and flag
stream the browser mock replays for the Teleprompter page.

A scripted narrator (a few mishearings, a two-word skip, a long pause, a
re-read of an earlier sentence) is turned into Whisper-style rolling
hypotheses, then run through the REAL shared event layer (`confirmed_events`)
and `ScriptTracker` with its flags (`flags.FlaggingTracker`). The mock only
replays the resulting `position` and `flag` events, rescaled onto whatever
chapter it is showing, so the pacing (how far the cursor leads the confirmed
words, when it pauses, the jump events) and the suspected flags are the
tracker's own rather than invented.

    python record_mock_stream.py [--out PATH]
"""

import argparse
import json
import sys
from collections.abc import Iterator
from itertools import pairwise
from pathlib import Path

_CORE_DIR = Path(__file__).resolve().parents[1] / "core"
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

import live_asr
from flags import FlaggingTracker

SCRIPT = (
    "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: "
    "once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "
    "and what is the use of a book, thought Alice, without pictures or conversations? "
    "So she was considering in her own mind, as well as she could, for the hot day made her feel very sleepy and stupid, "
    "whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies."
)
TOKENS = SCRIPT.split()

WORD_SECONDS = 0.34
TICK_SECONDS = 0.5
DECODE_LAG_SECONDS = 0.25
SEGMENT_PAUSE_SECONDS = 0.6
LONG_PAUSE_AFTER = 20
LONG_PAUSE_SECONDS = 2.4
SKIPPED = {36, 37}
RE_READ_FROM = 24
RE_READ_AT = 46
MISHEARD = {8: "cited", 43: "conserving", 62: "daisy chain"}


def spoken_order() -> list[int]:
    """The script indices in the order the narrator says them."""
    order: list[int] = []
    for index in range(len(TOKENS)):
        if index in SKIPPED:
            continue
        order.append(index)
        if index == RE_READ_AT:
            order.extend(range(RE_READ_FROM, RE_READ_AT + 1))
    return order


def timed_words() -> list[tuple[str, float, float, int]]:
    """(heard text, start, end, segment) for every word the narrator speaks."""
    order = spoken_order()
    words = []
    clock, segment = 0.4, 0
    for position, index in enumerate(order):
        if position == LONG_PAUSE_AFTER:
            clock += LONG_PAUSE_SECONDS
            segment += 1
        elif position and index == RE_READ_FROM and order[position - 1] == RE_READ_AT:
            clock += 0.9
            segment += 1
        words.append((MISHEARD.get(index, TOKENS[index]), clock, clock + WORD_SECONDS * 0.85, segment))
        clock += WORD_SECONDS
    return words


def schedule(words: list[tuple[str, float, float, int]]) -> Iterator[tuple[float, live_asr.Hypothesis | None]]:
    """Decode ticks: a rolling non-final hypothesis while a segment is open, one
    final hypothesis once its pause is long enough, nothing when there is
    nothing new to say (the tracker still needs the tick to notice a pause)."""
    segments = sorted({w[3] for w in words})
    closed: set[int] = set()
    last_end = max(w[2] for w in words)
    t = TICK_SECONDS
    while t <= last_end + 2 * SEGMENT_PAUSE_SECONDS + TICK_SECONDS:
        open_segments = [s for s in segments if s not in closed]
        hypothesis = None
        if open_segments:
            segment = open_segments[0]
            members = [w for w in words if w[3] == segment]
            if t >= members[-1][2] + SEGMENT_PAUSE_SECONDS:
                hypothesis = live_asr.Hypothesis(segment, tuple((w[0], w[1], w[2]) for w in members), final=True)
                closed.add(segment)
            else:
                heard = [w for w in members if w[2] <= t - DECODE_LAG_SECONDS]
                if heard:
                    hypothesis = live_asr.Hypothesis(segment, tuple((w[0], w[1], w[2]) for w in heard), final=False)
        yield round(t, 3), hypothesis
        t += TICK_SECONDS


def record() -> list[dict]:
    tracker = FlaggingTracker(TOKENS)
    recording: list[dict] = []
    now = {"t": 0.0}

    def take(tracked: list[dict]) -> None:
        recording.extend({"t": round(now["t"], 2), "event": event} for event in tracked)

    def hypotheses() -> Iterator[live_asr.Hypothesis]:
        for t, hypothesis in schedule(timed_words()):
            now["t"] = t
            take(tracker.tick(t))
            if hypothesis is not None:
                yield hypothesis

    for event in live_asr.confirmed_events(hypotheses()):
        take(tracker.feed(event, now["t"]))
    return recording


def main() -> None:
    default_out = Path(__file__).resolve().parents[3] / "apps" / "ui" / "src" / "api" / "teleprompterRecording.json"
    ap = argparse.ArgumentParser(description="Regenerate the Teleprompter mock's recorded position stream")
    ap.add_argument("--out", default=str(default_out))
    args = ap.parse_args()

    events = record()
    positions = [item["event"] for item in events if item["event"]["type"] == "position"]
    backward = sum(1 for before, after in pairwise(positions) if after["read"] < before["read"])
    Path(args.out).write_text(json.dumps({"tokens": len(TOKENS), "events": events}, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "tokens": len(TOKENS),
                "events": len(events),
                "final_read": positions[-1]["read"],
                "final_status": positions[-1]["status"],
                "backward_moves": backward,
                "jumps": [(item["t"], item["event"]["jump"]) for item in events if item["event"].get("jump")],
                "flags": [
                    (item["t"], item["event"]["kind"], item["event"]["start"], item["event"]["end"], item["event"]["heard"])
                    for item in events
                    if item["event"]["type"] == "flag"
                ],
                "waiting_events": sum(1 for p in positions if p["status"] == "waiting"),
            }
        )
    )


if __name__ == "__main__":
    main()
