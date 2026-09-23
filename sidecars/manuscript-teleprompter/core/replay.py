"""
Replay recorded live-ASR output through the script tracker and its flags,
offline - no microphone, model or UI. Takes either the JSON Lines file the
Moonshine spike writes (`spikes/moonshine_probe.py --events-out`, one record per
partial/final line, each with the wall time it arrived) or the NDJSON a
`live_asr.py` session printed (`--stream`, its engine events are replayed and
anything the tracker printed is ignored), plus the plain-text script that was
read, runs them through the shared event layer, ScriptTracker and flags.py,
and reports how the cursor behaved and what was flagged:

    python replay.py --events moonshine-mic-small.jsonl --script my-script.txt [--timeline]
    python replay.py --stream session.ndjson --script my-script.txt [--timeline]

The numbers to look at: `speculation_lead_seconds` (how much earlier the
cursor reached each word than confirmed words alone would have), `backward_moves`
and `jumps` (for a read-through of the script these should be zero: anything
else is a false restart or skip), `final_read` against `script_tokens`, and
`flags`: on a clean read every flag is a false flag, so `per_100_heard_words`
is the false-flag rate the teleprompter PRD's target (at most 1) is measured
by; on a reading with seeded errors, `list` shows each flag against the script
for a human to count.
"""

import argparse
import json
import sys
from collections.abc import Iterator
from itertools import pairwise
from pathlib import Path
from types import SimpleNamespace

import numpy as np

_CORE_DIR = Path(__file__).resolve().parent
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

import live_asr
from flags import FLAG_KINDS, FlaggingTracker
from script_tracker import script_words


class LineTextChanged:
    def __init__(self, line):
        self.line = line


class LineCompleted:
    def __init__(self, line):
        self.line = line


def load_records(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _record_line(record: dict) -> SimpleNamespace:
    words = [SimpleNamespace(word=w["word"], start=w["start"], end=w["end"]) for w in record["words"]] or None
    return SimpleNamespace(line_id=record["line_id"], text=record["text"], start_time=record["start"], duration=record["duration"], words=words)


class _RecordedTranscriber:
    """Plays recorded line events back through the same listener interface the
    real Moonshine Transcriber uses, one record per add_audio call."""

    def __init__(self, records: list[dict]) -> None:
        self._pending = iter(records)
        self._listener = None

    def add_listener(self, listener) -> None:
        self._listener = listener

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def add_audio(self, samples, sample_rate) -> None:
        record = next(self._pending)
        event_class = LineCompleted if record["kind"] == "LineCompleted" else LineTextChanged
        self._listener(event_class(_record_line(record)))


def replay_events(records: list[dict]) -> Iterator[tuple[float, dict]]:
    """Engine events for recorded Moonshine records, each paired with the wall
    time of the record that produced it."""
    clock = {"wall": 0.0}

    def chunks() -> Iterator[np.ndarray]:
        for record in records:
            clock["wall"] = record["wall"]
            yield np.zeros(1, dtype=np.float32)

    for event in live_asr.confirmed_events(live_asr.moonshine_hypotheses(chunks(), _RecordedTranscriber(records))):
        yield clock["wall"], event


def stream_events(lines: list[dict]) -> Iterator[tuple[float, dict]]:
    """The engine events of a printed `live_asr.py` session, each paired with the
    newest word time seen so far (a session prints no wall clock; engine times
    are advisory but only order and pauses matter here)."""
    clock = 0.0
    for event in lines:
        if event.get("type") not in ("partial", "word", "segment_end"):
            continue
        ends = [word["end"] for word in event["words"]] if event["type"] == "partial" else [event.get("end", clock)]
        clock = max([clock, *ends])
        yield clock, event


def track_events(timed_events: Iterator[tuple[float, dict]], tokens: list[str]) -> tuple[list[tuple[float, dict]], int]:
    """The position and flag events a live run would have produced, with arrival
    times, and how many confirmed words were heard. The clock is advanced
    (tick) at each event's arrival, so a pause is noticed at the next event
    rather than the moment it crossed the timeout."""
    tracker = FlaggingTracker(tokens)
    timeline: list[tuple[float, dict]] = []
    heard_words = 0
    for wall, event in timed_events:
        heard_words += event["type"] == "word"
        timeline.extend((wall, tracked) for tracked in tracker.tick(wall))
        timeline.extend((wall, tracked) for tracked in tracker.feed(event, wall))
    return timeline, heard_words


def track_recording(records: list[dict], tokens: list[str]) -> list[tuple[float, dict]]:
    """track_events over recorded Moonshine probe records."""
    return track_events(replay_events(records), tokens)[0]


def _first_reach(timeline: list[tuple[float, dict]], key: str) -> dict[int, float]:
    reached: dict[int, float] = {}
    highest = 0
    for wall, event in timeline:
        for level in range(highest + 1, event[key] + 1):
            reached[level] = wall
        highest = max(highest, event[key])
    return reached


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[int(fraction * (len(ordered) - 1))], 3)


def summarize_flags(flags: list[dict], heard_words: int, tokens: list[str]) -> dict:
    by_kind = {kind: sum(1 for flag in flags if flag["kind"] == kind) for kind in FLAG_KINDS}
    return {
        "heard_words": heard_words,
        "total": len(flags),
        "by_kind": by_kind,
        "per_100_heard_words": {kind: round(100 * count / heard_words, 2) if heard_words else None for kind, count in by_kind.items()},
        "list": [
            {
                "kind": flag["kind"],
                "start": flag["start"],
                "end": flag["end"],
                "script": " ".join(tokens[flag["start"] : flag["end"]]) or f"(before {' '.join(tokens[flag['start'] : flag['start'] + 1]) or 'the end'})",
                "heard": flag["heard"],
            }
            for flag in flags
        ],
    }


def summarize_timeline(timeline: list[tuple[float, dict]], token_count: int, heard_words: int = 0, tokens: list[str] | None = None) -> dict:
    positions = [(wall, event) for wall, event in timeline if event["type"] == "position"]
    events = [event for _, event in positions]
    displayed = _first_reach(positions, "read")
    committed = _first_reach(positions, "committed")
    leads = [committed[level] - displayed[level] for level in committed if level in displayed]
    final_read = events[-1]["read"] if events else 0
    return {
        "script_tokens": token_count,
        "final_read": final_read,
        "coverage": round(final_read / token_count, 3) if token_count else None,
        "position_events": len(events),
        "backward_moves": sum(1 for before, after in pairwise(events) if after["read"] < before["read"]),
        "jumps": [{"at": round(wall, 3), "jump": e["jump"], "read": e["read"], "skipped": e["skipped"]} for wall, e in positions if e["jump"]],
        "waiting_events": sum(1 for e in events if e["status"] == "waiting"),
        "speculation_lead_seconds": {"median": _percentile(leads, 0.5), "p90": _percentile(leads, 0.9), "max": _percentile(leads, 1.0), "words": len(leads)},
        "flags": summarize_flags([event for _, event in timeline if event["type"] == "flag"], heard_words, tokens or [""] * token_count),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Replay recorded live-ASR output through the script tracker and its flags")
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--events", help="JSON Lines file written by spikes/moonshine_probe.py --events-out")
    source.add_argument("--stream", help="NDJSON a live_asr.py session printed (its engine events are replayed)")
    ap.add_argument("--script", required=True, help="Plain-text script that was read aloud")
    ap.add_argument("--timeline", action="store_true", help="Also print every position and flag event")
    args = ap.parse_args()

    tokens = script_words(Path(args.script).read_text(encoding="utf-8"))
    timed = replay_events(load_records(args.events)) if args.events else stream_events(load_records(args.stream))
    timeline, heard_words = track_events(timed, tokens)
    if args.timeline:
        for wall, event in timeline:
            if event["type"] == "flag":
                print(
                    f"[{wall:7.2f}s] FLAG {event['kind']:8s} {event['start']}-{event['end']} script={' '.join(tokens[event['start'] : event['end']])!r} heard={event['heard']!r}"
                )
                continue
            upcoming = tokens[event["read"]] if event["read"] < len(tokens) else "(end)"
            note = f"  {event['jump'].upper()}" if event["jump"] else ""
            print(f"[{wall:7.2f}s] read={event['read']:4d} committed={event['committed']:4d} {event['status']:9s} next={upcoming!r}{note}")
    print(json.dumps(summarize_timeline(timeline, len(tokens), heard_words, tokens), indent=2))


if __name__ == "__main__":
    main()
