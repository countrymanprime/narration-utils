import importlib.util
import sys
from pathlib import Path

import pytest

DEVICES_PATH = Path(__file__).resolve().parents[1] / "core" / "devices_avfoundation.py"
SPEC = importlib.util.spec_from_file_location("devices_avfoundation", DEVICES_PATH)
devices_avfoundation = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(devices_avfoundation)

# FFmpeg's avfoundation lister prints one line per device under two headers, video devices first (`-f avfoundation
# -list_devices true -i ""`, reasoned from public FFmpeg documentation/source per the PRD's Evidence and Research
# Summary sections - not confirmed against a local capture; Phase 1 should confirm the exact log context and format
# against real macOS log output before Phase 2 depends on it, per the PRD's Q5 and Technical Risks).
LOG_CAPTURE = [
    (32, "AVFoundation input device", "AVFoundation video devices:\n"),
    (32, "AVFoundation input device", "[0] FaceTime HD Camera\n"),
    (32, "AVFoundation input device", "[1] Capture screen 0\n"),
    (32, "AVFoundation input device", "AVFoundation audio devices:\n"),
    (32, "AVFoundation input device", "[0] Built-in Microphone\n"),
    (32, "AVFoundation input device", "[1] Focusrite USB Audio\n"),
]


def test_parse_device_list_keeps_ffmpegs_order_and_index():
    parsed = devices_avfoundation.parse_device_list(LOG_CAPTURE)

    assert [(device.name, device.kind, device.index) for device in parsed] == [
        ("FaceTime HD Camera", "video", 0),
        ("Capture screen 0", "video", 1),
        ("Built-in Microphone", "audio", 0),
        ("Focusrite USB Audio", "audio", 1),
    ]


def test_parse_device_list_reassembles_split_fragments():
    """PyAV may split one logical FFmpeg line into several log callbacks, as it does for dshow (test_devices.py)."""
    fragments = [
        (32, "AVFoundation input device", "AVFoundation audio devices:\n"),
        (32, "AVFoundation input device", "[0] Built-in"),
        (32, "AVFoundation input device", " Microphone\n"),
    ]

    parsed = devices_avfoundation.parse_device_list(fragments)

    assert [(device.name, device.kind, device.index) for device in parsed] == [("Built-in Microphone", "audio", 0)]


def test_list_input_devices_keeps_only_audio_kind_devices():
    result, error = devices_avfoundation.list_input_devices(capture=lambda: LOG_CAPTURE)

    assert error is None
    assert [device.name for device in result] == ["Built-in Microphone", "Focusrite USB Audio"]


def test_list_input_devices_reports_no_devices_as_an_empty_list_not_an_error():
    result, error = devices_avfoundation.list_input_devices(capture=list)

    assert result == []
    assert error is None


def test_list_input_devices_never_raises_when_the_capture_itself_fails():
    def broken_capture():
        raise RuntimeError("avfoundation backend unavailable")

    result, error = devices_avfoundation.list_input_devices(capture=broken_capture)

    assert result == []
    assert error == "Could not list input devices: avfoundation backend unavailable"


def test_device_to_json_exposes_only_the_name_the_capture_path_needs():
    device = devices_avfoundation.Device(name="Built-in Microphone", kind="audio", index=0)

    assert device.to_json() == {"name": "Built-in Microphone"}


@pytest.mark.parametrize(
    "line",
    [
        "",
        "ffmpeg version 8.0.1-full_build",
        "[0] a device before any section header",
    ],
)
def test_parse_device_list_ignores_lines_that_are_neither_a_section_nor_a_device_once_sectioned(line):
    entries = [(32, "AVFoundation input device", line + "\n")]

    assert devices_avfoundation.parse_device_list(entries) == []


def test_parse_device_list_ignores_log_entries_from_other_ffmpeg_contexts():
    entries = [(32, "in", "AVFoundation audio devices:\n"), (32, "in", "[0] not really listed\n")]

    assert devices_avfoundation.parse_device_list(entries) == []


def test_resolve_index_finds_the_named_devices_index():
    index = devices_avfoundation.resolve_index("Focusrite USB Audio", capture=lambda: LOG_CAPTURE)

    assert index == 1


def test_resolve_index_raises_for_a_device_that_is_not_listed():
    with pytest.raises(LookupError, match="No audio input device"):
        devices_avfoundation.resolve_index("Narration Utils conformance: no such device", capture=lambda: LOG_CAPTURE)


def test_resolve_index_raises_when_listing_itself_fails():
    def broken_capture():
        raise RuntimeError("avfoundation backend unavailable")

    with pytest.raises(LookupError, match="Could not list input devices"):
        devices_avfoundation.resolve_index("Built-in Microphone", capture=broken_capture)


class _FakeAvLogging:
    """As test_devices.py's own fake: PyAV's default log level is off, so a capture receives nothing unless the
    listing (devices_avfoundation.capture_avfoundation_log) raises it to INFO first."""

    INFO = 32
    VERBOSE = 40

    def __init__(self, level):
        self.level = level
        self.set_calls = []
        self.level_during_open = "never opened"
        self.captured = []

    def get_level(self):
        return self.level

    def set_level(self, level):
        self.set_calls.append(level)
        self.level = level

    def Capture(self, local):
        assert local is True
        captured = self.captured

        class _Capture:
            def __enter__(self):
                return captured

            def __exit__(self, *exc):
                return False

        return _Capture()


def _install_fake_av(monkeypatch, fake_logging):
    class _FakeAv:
        logging = fake_logging

        @staticmethod
        def open(file, format, options):
            fake_logging.level_during_open = fake_logging.level
            if fake_logging.level is not None and fake_logging.level >= fake_logging.INFO:
                fake_logging.captured.extend(LOG_CAPTURE)
            raise RuntimeError("Immediate exit requested")

    monkeypatch.setitem(sys.modules, "av", _FakeAv)
    monkeypatch.setitem(sys.modules, "av.logging", fake_logging)


def test_capture_avfoundation_log_raises_the_default_off_level_to_info_for_the_listing_then_turns_it_back_off(monkeypatch):
    fake_logging = _FakeAvLogging(level=None)
    _install_fake_av(monkeypatch, fake_logging)

    entries = devices_avfoundation.capture_avfoundation_log()

    assert fake_logging.level_during_open == fake_logging.INFO
    assert fake_logging.set_calls == [fake_logging.INFO, None]
    assert fake_logging.level is None
    assert [device.name for device in devices_avfoundation.list_input_devices(capture=lambda: entries)[0]] == [
        "Built-in Microphone",
        "Focusrite USB Audio",
    ]


def test_capture_avfoundation_log_leaves_an_already_more_verbose_level_alone(monkeypatch):
    fake_logging = _FakeAvLogging(level=_FakeAvLogging.VERBOSE)
    _install_fake_av(monkeypatch, fake_logging)

    devices_avfoundation.capture_avfoundation_log()

    assert fake_logging.level_during_open == fake_logging.VERBOSE
    assert fake_logging.level == fake_logging.VERBOSE


def test_capture_avfoundation_log_restores_the_previous_level_even_when_the_capture_itself_fails(monkeypatch):
    fake_logging = _FakeAvLogging(level=None)
    _install_fake_av(monkeypatch, fake_logging)

    def broken_capture(local):
        raise RuntimeError("log capture unavailable")

    monkeypatch.setattr(fake_logging, "Capture", broken_capture)

    with pytest.raises(RuntimeError, match="log capture unavailable"):
        devices_avfoundation.capture_avfoundation_log()

    assert fake_logging.level is None
