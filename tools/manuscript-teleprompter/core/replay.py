"""
Replay recorded live-ASR output through the script tracker, offline - no
microphone, model or UI. Takes the JSON Lines file the Moonshine spike writes
(`spikes/moonshine_probe.py --events-out`, one record per partial/final line,
each with the wall time it arrived) plus the plain-text script that was read,
runs the records through the real Moonshine adapter, the shared event layer and
ScriptTracker, and reports how the cursor behaved:

    python replay.py --events moonshine-mic-small.jsonl --script my-script.txt [--timeline]

The numbers to look at: `speculation_lead_seconds` (how much earlier the
cursor reached each word than confirmed words alone would have), `backward_moves`
and `jumps` (for a read-through of the script these should be zero: anything
else is a false restart or skip), and `final_read` against `script_tokens`.
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
from script_tracker import ScriptTracker, script_words


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


def track_recording(records: list[dict], tokens: list[str]) -> list[tuple[float, dict]]:
    """The position events a live run would have produced, with arrival times.
    The clock is advanced (tick) at each record's arrival, so a pause between
    records is noticed at the next record rather than the moment it crossed
    the timeout."""
    tracker = ScriptTracker(tokens)
    timeline: list[tuple[float, dict]] = []
    for wall, event in replay_events(records):
        timeline.extend((wall, position) for position in tracker.tick(wall))
        timeline.extend((wall, position) for position in tracker.feed(event, wall))
    return timeline


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


def summarize_timeline(timeline: list[tuple[float, dict]], token_count: int) -> dict:
    events = [event for _, event in timeline]
    displayed = _first_reach(timeline, "read")
    committed = _first_reach(timeline, "committed")
    leads = [committed[level] - displayed[level] for level in committed if level in displayed]
    final_read = events[-1]["read"] if events else 0
    return {
        "script_tokens": token_count,
        "final_read": final_read,
        "coverage": round(final_read / token_count, 3) if token_count else None,
        "position_events": len(events),
        "backward_moves": sum(1 for before, after in pairwise(events) if after["read"] < before["read"]),
        "jumps": [{"at": round(wall, 3), "jump": e["jump"], "read": e["read"], "skipped": e["skipped"]} for wall, e in timeline if e["jump"]],
        "waiting_events": sum(1 for e in events if e["status"] == "waiting"),
        "speculation_lead_seconds": {"median": _percentile(leads, 0.5), "p90": _percentile(leads, 0.9), "max": _percentile(leads, 1.0), "words": len(leads)},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Replay recorded Moonshine probe output through the script tracker")
    ap.add_argument("--events", required=True, help="JSON Lines file written by spikes/moonshine_probe.py --events-out")
    ap.add_argument("--script", required=True, help="Plain-text script that was read aloud")
    ap.add_argument("--timeline", action="store_true", help="Also print every position event")
    args = ap.parse_args()

    tokens = script_words(Path(args.script).read_text(encoding="utf-8"))
    timeline = track_recording(load_records(args.events), tokens)
    if args.timeline:
        for wall, event in timeline:
            upcoming = tokens[event["read"]] if event["read"] < len(tokens) else "(end)"
            note = f"  {event['jump'].upper()}" if event["jump"] else ""
            print(f"[{wall:7.2f}s] read={event['read']:4d} committed={event['committed']:4d} {event['status']:9s} next={upcoming!r}{note}")
    print(json.dumps(summarize_timeline(timeline, len(tokens)), indent=2))


if __name__ == "__main__":
    main()
