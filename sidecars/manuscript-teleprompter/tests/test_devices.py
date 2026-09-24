import importlib.util
import sys
from pathlib import Path

import pytest

DEVICES_PATH = Path(__file__).resolve().parents[1] / "core" / "devices.py"
SPEC = importlib.util.spec_from_file_location("devices", DEVICES_PATH)
devices = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(devices)

# Real ffmpeg log output (via PyAV's av.logging.Capture) recorded on the development machine, 2026-09-22 - see
# manuscript-teleprompter.md for the full note. PyAV split each logical ffmpeg line into several log callbacks, so this
# fixture also exercises the fragment-joining, not just the parsing regex.
REAL_LOG_CAPTURE = [
    (32, "dshow", '"ASUS FHD webcam"'),
    (32, "dshow", " (video"),
    (32, "dshow", ")"),
    (32, "dshow", "\n"),
    (32, "dshow", '  Alternative name "@device_pnp_\\\\?\\usb#vid_3277&pid_0010&mi_00#7&df5034d&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\global"\n'),
    (32, "dshow", '"OBS Virtual Camera"'),
    (32, "dshow", " (none)"),
    (32, "dshow", "\n"),
    (32, "dshow", '  Alternative name "@device_sw_{860BB310-5D01-11D0-BD3B-00A0C911CE86}\\{A3FCE0F5-3493-419F-958A-ABA1250EC20B}"\n'),
    (32, "dshow", '"Analogue 1 + 2 (Focusrite USB Audio)"'),
    (32, "dshow", " (audio"),
    (32, "dshow", ")"),
    (32, "dshow", "\n"),
    (32, "dshow", '  Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{BE5BFBF2-729D-4BCC-A107-0FF92B481D1C}"\n'),
    (32, "dshow", '"Microphone Array (Realtek(R) Audio)"'),
    (32, "dshow", " (audio"),
    (32, "dshow", ")"),
    (32, "dshow", "\n"),
    (32, "dshow", '  Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{364008FC-A5F4-4188-AB8A-1AB65E40114C}"\n'),
]


def test_parse_device_list_reassembles_split_fragments_and_keeps_ffmpegs_order():
    parsed = devices.parse_device_list(REAL_LOG_CAPTURE)

    assert [(device.name, device.kind) for device in parsed] == [
        ("ASUS FHD webcam", "video"),
        ("OBS Virtual Camera", "none"),
        ("Analogue 1 + 2 (Focusrite USB Audio)", "audio"),
        ("Microphone Array (Realtek(R) Audio)", "audio"),
    ]


def test_parse_device_list_attaches_the_alternative_name_to_the_device_before_it():
    parsed = devices.parse_device_list(REAL_LOG_CAPTURE)

    mic = next(device for device in parsed if device.name == "Microphone Array (Realtek(R) Audio)")
    assert mic.alternative_name == "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{364008FC-A5F4-4188-AB8A-1AB65E40114C}"


def test_list_input_devices_keeps_only_audio_kind_devices():
    result, error = devices.list_input_devices(capture=lambda: REAL_LOG_CAPTURE)

    assert error is None
    assert [device.name for device in result] == ["Analogue 1 + 2 (Focusrite USB Audio)", "Microphone Array (Realtek(R) Audio)"]


def test_list_input_devices_reports_no_devices_as_an_empty_list_not_an_error():
    result, error = devices.list_input_devices(capture=list)

    assert result == []
    assert error is None


def test_list_input_devices_never_raises_when_the_capture_itself_fails():
    def broken_capture():
        raise RuntimeError("dshow backend unavailable")

    result, error = devices.list_input_devices(capture=broken_capture)

    assert result == []
    assert error == "Could not list input devices: dshow backend unavailable"


def test_device_to_json_exposes_only_the_name_the_capture_path_needs():
    device = devices.Device(name="Microphone Array (Realtek(R) Audio)", kind="audio", alternative_name="@device_cm_{...}")

    assert device.to_json() == {"name": "Microphone Array (Realtek(R) Audio)"}


@pytest.mark.parametrize(
    "line",
    [
        "",
        "ffmpeg version 8.0.1-full_build",
        '  Alternative name "orphaned, no device line before it"',
    ],
)
def test_parse_device_list_ignores_lines_that_are_neither_a_device_nor_an_alternative_name(line):
    entries = [(32, "dshow", line + "\n")]

    assert devices.parse_device_list(entries) == []


def test_parse_device_list_ignores_log_entries_from_other_ffmpeg_contexts():
    entries = [(32, "in", 'this looks like "a device" (audio) but is not from dshow\n')]

    assert devices.parse_device_list(entries) == []


class _FakeAvLogging:
    """Stands in for `av.logging`. PyAV's default level is None (FFmpeg logging off) and FFmpeg prints the dshow device
    list at INFO (32), so a capture opened at the default level receives nothing: the reason the real listing came back
    empty while every test above, which injects a finished capture, still passed."""

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
    """A fake `av` whose `open` behaves like FFmpeg's dshow lister: it logs the device list only when the level lets INFO
    through, then raises (list_devices is not a real capture)."""

    class _FakeAv:
        logging = fake_logging

        @staticmethod
        def open(file, format, options):
            fake_logging.level_during_open = fake_logging.level
            if fake_logging.level is not None and fake_logging.level >= fake_logging.INFO:
                fake_logging.captured.extend(REAL_LOG_CAPTURE)
            raise RuntimeError("Immediate exit requested")

    monkeypatch.setitem(sys.modules, "av", _FakeAv)
    monkeypatch.setitem(sys.modules, "av.logging", fake_logging)


def test_capture_dshow_log_raises_the_default_off_level_to_info_for_the_listing_then_turns_it_back_off(monkeypatch):
    fake_logging = _FakeAvLogging(level=None)
    _install_fake_av(monkeypatch, fake_logging)

    entries = devices.capture_dshow_log()

    assert fake_logging.level_during_open == fake_logging.INFO
    assert fake_logging.set_calls == [fake_logging.INFO, None]
    assert fake_logging.level is None
    assert [device.name for device in devices.list_input_devices(capture=lambda: entries)[0]] == [
        "Analogue 1 + 2 (Focusrite USB Audio)",
        "Microphone Array (Realtek(R) Audio)",
    ]


def test_capture_dshow_log_leaves_an_already_more_verbose_level_alone(monkeypatch):
    fake_logging = _FakeAvLogging(level=_FakeAvLogging.VERBOSE)
    _install_fake_av(monkeypatch, fake_logging)

    devices.capture_dshow_log()

    assert fake_logging.level_during_open == fake_logging.VERBOSE
    assert fake_logging.level == fake_logging.VERBOSE


def test_capture_dshow_log_restores_the_previous_level_even_when_the_capture_itself_fails(monkeypatch):
    fake_logging = _FakeAvLogging(level=None)
    _install_fake_av(monkeypatch, fake_logging)

    def broken_capture(local):
        raise RuntimeError("log capture unavailable")

    monkeypatch.setattr(fake_logging, "Capture", broken_capture)

    with pytest.raises(RuntimeError, match="log capture unavailable"):
        devices.capture_dshow_log()

    assert fake_logging.level is None


def _active_capture_endpoints():
    """How many audio capture endpoints Windows itself reports as active, read from the registry rather than through
    FFmpeg, so the real-PyAV test below can tell "no microphone here" from "the listing is broken"."""
    import winreg

    active = 0
    path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture"
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path) as captures:
        for index in range(winreg.QueryInfoKey(captures)[0]):
            with winreg.OpenKey(captures, winreg.EnumKey(captures, index)) as endpoint:
                state, _type = winreg.QueryValueEx(endpoint, "DeviceState")
                active += (state & 0xF) == 1  # DEVICE_STATE_ACTIVE; the high bits are flags
    return active


def _real_dshow_available():
    if sys.platform != "win32":
        return False
    try:
        import av
    except ImportError:
        return False
    return "dshow" in av.formats_available


@pytest.mark.skipif(not _real_dshow_available(), reason="the dshow device lister exists only in a Windows FFmpeg build")
def test_capture_dshow_log_really_receives_ffmpegs_device_list_through_pyav():
    try:
        microphones = _active_capture_endpoints()
    except OSError:
        microphones = 0
    if microphones == 0:
        pytest.skip("Windows reports no active microphone on this machine (e.g. a CI runner); never depend on one")
    import av.logging

    level_before = av.logging.get_level()

    entries = devices.capture_dshow_log()

    assert av.logging.get_level() == level_before
    assert any(context == "dshow" for _level, context, _message in entries), "PyAV's log capture received no dshow output"
    listed, error = devices.list_input_devices(capture=lambda: entries)
    assert error is None
    assert listed, "Windows reports an active microphone but the dshow listing found no audio device"
