import importlib.util
import json
from pathlib import Path

import pytest

REPLAY_PATH = Path(__file__).resolve().parents[1] / "core" / "replay.py"
SPEC = importlib.util.spec_from_file_location("replay", REPLAY_PATH)
replay = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(replay)

SCRIPT = "The old lighthouse keeper climbed the spiral stairs each evening. He lit the great lamp and watched the ships pass."
TOKENS = SCRIPT.split()


def _record(kind, wall, line_id, text):
    words = [{"word": w.strip(".,"), "start": round(0.2 * i, 3), "end": round(0.2 * i + 0.15, 3)} for i, w in enumerate(text.split())]
    return {"kind": kind, "wall": wall, "line_id": line_id, "text": text, "start": 0.0, "duration": 0.2 * len(words), "words": words, "latency_ms": 10}


def _reading():
    return [
        _record("LineTextChanged", 1.0, 5, "the old"),
        _record("LineTextChanged", 1.5, 5, "the old lighthouse keeper"),
        _record("LineTextChanged", 2.0, 5, "the old lighthouse keeper climbed"),
        _record("LineCompleted", 2.6, 5, "the old lighthouse keeper climbed"),
    ]


def test_replay_events_stamp_each_engine_event_with_the_wall_time_of_its_record():
    events = list(replay.replay_events(_reading()))

    assert events[0][0] == 1.0
    assert events[0][1]["type"] == "partial"
    first_word = next(item for item in events if item[1]["type"] == "word")
    assert first_word[0] == 1.5
    assert events[-1][1] == {"type": "segment_end", "segment": 0}
    assert events[-1][0] == 2.6


def test_track_recording_moves_the_cursor_as_the_recording_progresses():
    timeline = replay.track_recording(_reading(), TOKENS)

    speculative = [(wall, event["read"]) for wall, event in timeline if event["read"] != 0]
    assert speculative[0] == (1.0, 2)
    assert speculative[-1][1] == 5


def test_summary_reports_how_far_speculation_leads_confirmation():
    timeline = replay.track_recording(_reading(), TOKENS)

    summary = replay.summarize_timeline(timeline, len(TOKENS))

    assert summary["final_read"] == 5
    assert summary["backward_moves"] == 0
    assert summary["jumps"] == []
    assert summary["speculation_lead_seconds"]["median"] == pytest.approx(0.5)
    assert summary["speculation_lead_seconds"]["words"] == 5


def test_summary_counts_a_restart_as_a_jump_and_a_backward_move():
    records = [
        _record("LineTextChanged", 1.0, 1, "the old lighthouse keeper climbed the spiral stairs"),
        _record("LineCompleted", 2.0, 1, "the old lighthouse keeper climbed the spiral stairs"),
        _record("LineTextChanged", 3.0, 2, "the old lighthouse keeper climbed"),
    ]

    summary = replay.summarize_timeline(replay.track_recording(records, TOKENS), len(TOKENS))

    assert [j["jump"] for j in summary["jumps"]] == ["restart"]
    assert summary["backward_moves"] == 1
    assert summary["final_read"] == 5


def test_a_long_gap_between_records_shows_up_as_a_waiting_status():
    records = [
        _record("LineTextChanged", 1.0, 5, "the old"),
        _record("LineCompleted", 1.3, 5, "the old"),
        _record("LineTextChanged", 5.0, 6, "lighthouse keeper"),
    ]

    summary = replay.summarize_timeline(replay.track_recording(records, TOKENS), len(TOKENS))

    assert summary["waiting_events"] == 1
    assert summary["final_read"] == 4


def test_load_records_reads_json_lines(tmp_path):
    path = tmp_path / "events.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in _reading()) + "\n", encoding="utf-8")

    assert replay.load_records(str(path)) == _reading()
