import importlib.util
from pathlib import Path

CONTROL_CHANNEL_PATH = Path(__file__).resolve().parents[1] / "core" / "control_channel.py"
SPEC = importlib.util.spec_from_file_location("control_channel", CONTROL_CHANNEL_PATH)
control_channel = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(control_channel)


def test_poll_returns_nothing_when_no_path_was_given():
    assert control_channel.ControlChannel(None).poll() == []


def test_poll_returns_nothing_when_the_file_does_not_exist_yet(tmp_path):
    channel = control_channel.ControlChannel(str(tmp_path / "missing.ctl"))

    assert channel.poll() == []


def test_poll_returns_each_whole_command_line_once(tmp_path):
    path = tmp_path / "control"
    path.write_text('{"cmd": "seek", "word": 12}\n{"cmd": "seek", "word": 40}\n', encoding="utf-8")
    channel = control_channel.ControlChannel(str(path))

    commands = channel.poll()

    assert commands == [{"cmd": "seek", "word": 12}, {"cmd": "seek", "word": 40}]
    assert channel.poll() == []


def test_poll_leaves_a_trailing_partial_line_for_the_next_poll(tmp_path):
    path = tmp_path / "control"
    path.write_text('{"cmd": "seek", "word": 1}\n{"cmd": "seek"', encoding="utf-8")
    channel = control_channel.ControlChannel(str(path))

    first = channel.poll()

    assert first == [{"cmd": "seek", "word": 1}]

    with path.open("a", encoding="utf-8") as handle:
        handle.write(', "word": 2}\n')

    assert channel.poll() == [{"cmd": "seek", "word": 2}]


def test_poll_skips_a_malformed_line_but_keeps_the_valid_ones_around_it(tmp_path):
    path = tmp_path / "control"
    path.write_text('{"cmd": "seek", "word": 1}\nnot json\n["also", "not", "an", "object"]\n{"cmd": "seek", "word": 2}\n', encoding="utf-8")
    channel = control_channel.ControlChannel(str(path))

    assert channel.poll() == [{"cmd": "seek", "word": 1}, {"cmd": "seek", "word": 2}]


def test_poll_only_reads_what_was_appended_since_the_last_poll(tmp_path):
    path = tmp_path / "control"
    path.write_text('{"cmd": "seek", "word": 1}\n', encoding="utf-8")
    channel = control_channel.ControlChannel(str(path))
    channel.poll()

    with path.open("a", encoding="utf-8") as handle:
        handle.write('{"cmd": "seek", "word": 2}\n')

    assert channel.poll() == [{"cmd": "seek", "word": 2}]


def test_seek_word_reads_a_seek_commands_word():
    assert control_channel.seek_word({"cmd": "seek", "word": 7}) == 7


def test_seek_word_is_none_for_a_different_command():
    assert control_channel.seek_word({"cmd": "stop"}) is None


def test_seek_word_is_none_when_word_is_missing_or_not_an_integer():
    assert control_channel.seek_word({"cmd": "seek"}) is None
    assert control_channel.seek_word({"cmd": "seek", "word": "12"}) is None
    assert control_channel.seek_word({"cmd": "seek", "word": 1.5}) is None
    assert control_channel.seek_word({"cmd": "seek", "word": True}) is None


# Pause (read-aloud-control-bar PRD Phase 5): {"cmd": "pause"} and {"cmd": "resume"} on the same channel as seek.
def test_pause_state_reads_pause_and_resume():
    assert control_channel.pause_state({"cmd": "pause"}) is True
    assert control_channel.pause_state({"cmd": "resume"}) is False


def test_pause_state_is_none_for_any_other_command():
    for command in ({"cmd": "seek", "word": 3}, {"cmd": "Pause"}, {"cmd": None}, {}):
        assert control_channel.pause_state(command) is None
