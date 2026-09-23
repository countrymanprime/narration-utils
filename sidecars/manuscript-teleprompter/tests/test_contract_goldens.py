"""The teleprompter event stream as the sidecar really produces it, pinned as a contract file (ADR 0069).

The script event comes from ``chapter_script`` reading a canonical manuscript, the partial/word/segment_end events from the
engine-independent layer in ``live_asr`` fed a recorded reading (the same path ``replay.py`` uses), and the position events from
the real ``ScriptTracker``. The TypeScript contract tests validate ``teleprompter-events.json`` against the UI's schemas, and the
Go relay test feeds the same lines through the host and pins the state snapshot it builds.
"""

import importlib.util
import json
from pathlib import Path

from narration_common import contract_files

CORE = Path(__file__).resolve().parents[1] / "core"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, CORE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


chapter_script = _load("chapter_script")
replay = _load("replay")
flags = _load("flags")

PARAGRAPH = "The old lighthouse keeper climbed the spiral stairs each evening. He lit the great lamp and watched the ships pass."
LATER = "Far out at sea a small boat rocked in the swell."


def _manuscript(tmp_path):
    data = {
        "schemaVersion": 1,
        "documentId": "lighthouse",
        "chapters": [{"id": "c1", "title": "Chapter One", "contentKind": "narration"}],
        "paragraphs": [
            {"id": "p1", "chapterId": "c1", "index": 0, "text": PARAGRAPH},
            {"id": "p2", "chapterId": "c1", "index": 1, "text": LATER},
        ],
    }
    path = tmp_path / "manuscript.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _record(kind, wall, line_id, text):
    words = [{"word": w.strip(".,"), "start": round(0.2 * i, 3), "end": round(0.2 * i + 0.15, 3)} for i, w in enumerate(text.split())]
    return {"kind": kind, "wall": wall, "line_id": line_id, "text": text, "start": 0.0, "duration": 0.2 * len(words), "words": words, "latency_ms": 10}


def _reading():
    """A narrator who reads the first sentence with an added word and a misread, skips ahead to the second paragraph, then goes
    back over its first words: one flag of every kind."""
    return [
        _record("LineTextChanged", 1.0, 5, "chapter one the old"),
        _record("LineTextChanged", 1.6, 5, "chapter one the old lighthouse keeper slowly climbed"),
        _record("LineCompleted", 2.4, 5, "chapter one the old lighthouse keeper slowly climbed the curly stairs"),
        _record("LineTextChanged", 3.0, 6, "far out at sea"),
        _record("LineCompleted", 3.8, 6, "far out at sea a small boat"),
        _record("LineTextChanged", 4.6, 7, "at sea a small"),
        _record("LineCompleted", 5.4, 7, "at sea a small boat rocked in the swell"),
    ]


def _stream(tmp_path):
    script = chapter_script.load_chapter_script(_manuscript(tmp_path), "c1")
    tracker = flags.FlaggingTracker(script.tokens)
    events = [chapter_script.script_event(script)]
    for wall, event in replay.replay_events(_reading()):
        events.extend(tracker.tick(wall))
        events.append(event)
        events.extend(tracker.feed(event, wall))
    return events


def test_the_event_stream_matches_the_committed_contract_file(tmp_path):
    contract_files.check("teleprompter-events", _stream(tmp_path))


def test_the_credits_script_event_matches_the_committed_contract_file():
    # A --script named with --script-id/--script-title (the credits, audiobook-credits-templates.prd.md Phase 4, ADR 0150):
    # no title span, one paragraph span per line, no manuscript index.
    text = "You have been listening to Alice, written by Lewis Carroll,\nnarrated by Ada Finch.\n\nThe End."
    contract_files.check("teleprompter-credits-script", chapter_script.script_event(chapter_script.text_script(text, "credits-closing", "Closing credits")))


def test_the_stream_holds_every_event_type_the_ui_reads(tmp_path):
    kinds = {event["type"] for event in _stream(tmp_path)}

    assert kinds == {"script", "position", "partial", "word", "segment_end", "flag"}


def test_the_stream_holds_a_flag_of_every_kind(tmp_path):
    kinds = {event["kind"] for event in _stream(tmp_path) if event["type"] == "flag"}

    assert kinds == set(flags.FLAG_KINDS)
