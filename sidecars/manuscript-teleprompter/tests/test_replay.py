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


def test_a_clean_reading_has_no_flags_and_a_zero_false_flag_rate():
    records = [
        _record("LineTextChanged", 1.0, 5, "the old lighthouse keeper"),
        _record("LineCompleted", 2.0, 5, "the old lighthouse keeper climbed the spiral stairs each evening"),
    ]
    timeline, heard_words = replay.track_events(replay.replay_events(records), TOKENS)

    flags = replay.summarize_timeline(timeline, len(TOKENS), heard_words, TOKENS)["flags"]

    assert flags["heard_words"] == 10
    assert flags["total"] == 0
    assert flags["per_100_heard_words"]["misread"] == 0.0


def test_the_summary_lists_each_flag_against_the_script_and_rates_it_per_100_heard_words():
    records = [_record("LineCompleted", 2.0, 5, "the old lighthouse keeper slowly climbed the spiral chairs each evening")]
    timeline, heard_words = replay.track_events(replay.replay_events(records), TOKENS)

    flags = replay.summarize_timeline(timeline, len(TOKENS), heard_words, TOKENS)["flags"]

    assert flags["by_kind"] == {"misread": 1, "extra": 1, "skipped": 0, "restart": 0}
    assert flags["per_100_heard_words"]["misread"] == pytest.approx(100 / 11, abs=0.01)
    assert flags["list"] == [
        {"kind": "extra", "start": 4, "end": 4, "script": "(before climbed)", "heard": "slowly"},
        {"kind": "misread", "start": 7, "end": 8, "script": "stairs", "heard": "chairs"},
    ]


def test_a_printed_live_session_replays_its_engine_events_and_ignores_what_the_tracker_printed():
    words = ["the", "old", "lighthouse", "keeper", "climbed", "the", "spiral", "chairs"]
    session = [{"type": "script", "tokens": 3}, {"type": "position", "read": 9, "committed": 9, "status": "listening", "jump": None, "skipped": None}]
    session += [{"type": "partial", "segment": 0, "words": [{"word": w, "start": i * 0.3, "end": i * 0.3 + 0.2} for i, w in enumerate(words[:3])]}]
    session += [{"type": "word", "segment": 0, "word": w, "start": i * 0.3, "end": i * 0.3 + 0.2} for i, w in enumerate(words)]
    session += [{"type": "word", "segment": 0, "word": "each", "start": 3.0, "end": 3.2}, {"type": "segment_end", "segment": 0}]
    session += [{"type": "flag", "id": 9, "kind": "extra", "start": 0, "end": 0, "heard": "stale"}]

    timed = list(replay.stream_events(session))
    timeline, heard_words = replay.track_events(iter(timed), TOKENS)

    assert [event["type"] for _, event in timed][:2] == ["partial", "word"]
    assert [wall for wall, _ in timed] == sorted(wall for wall, _ in timed)
    assert heard_words == 9
    assert [(e["kind"], e["heard"]) for _, e in timeline if e["type"] == "flag"] == [("misread", "chairs")]


@pytest.mark.parametrize("source", ["--events", "--stream"])
def test_the_cli_prints_the_timeline_with_flags_and_then_the_summary(tmp_path, capsys, monkeypatch, source):
    script = tmp_path / "script.txt"
    script.write_text(SCRIPT, encoding="utf-8")
    records = [_record("LineCompleted", 2.0, 5, "the old lighthouse keeper climbed the spiral chairs each evening")]
    if source == "--stream":
        records = [event for _, event in replay.replay_events(records)]
    recording = tmp_path / "recording.jsonl"
    recording.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["replay.py", source, str(recording), "--script", str(script), "--timeline"])

    replay.main()

    printed = capsys.readouterr().out
    assert "FLAG misread  7-8 script='stairs' heard='chairs'" in printed
    assert "read=" in printed
    summary = json.loads(printed[printed.index("{") :])
    assert summary["flags"]["by_kind"]["misread"] == 1
    assert summary["final_read"] == 10


def test_load_records_reads_json_lines(tmp_path):
    path = tmp_path / "events.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in _reading()) + "\n", encoding="utf-8")

    assert replay.load_records(str(path)) == _reading()
