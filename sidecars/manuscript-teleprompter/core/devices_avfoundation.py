"""
Input device enumeration for the Manuscript Teleprompter live sidecar's Core Audio (macOS) backend
(docs/prds/coreaudio-capture.prd.md Phase 1). Mirrors `devices.py`'s dshow spike (module docstring, PLR Q1-Q5):
PyAV can list FFmpeg `avfoundation` devices the same way it lists `dshow` devices - by opening the device in
"list" mode (which always raises after logging, never a real capture) and reading FFmpeg's own log lines back
through `av.logging.Capture`, filtered to the log context `avfoundation` reports itself under.

Unlike `dshow`, which addresses (and disambiguates) devices by name, `avfoundation` addresses a device by index
(`av.open(file=":0", format="avfoundation")` for the first audio device) and lists both video and audio devices
under two headers ("AVFoundation video devices:" / "AVFoundation audio devices:"), one device per line
(`[N] Name`), rather than dshow's two-line per-device "Name" (kind) / Alternative-name shape. `Device.index` is
FFmpeg's device index, recorded so `capture_avfoundation.py`'s `resolve_index` can translate a name back to it at
`chunks()` open time (the PRD's Q1/Q3 recommendation: resolve fresh on every open, never cache across a session).

Not verified against real Apple hardware or a local FFmpeg build (the PRD's Q2, Q5, and Technical Risks table):
the log context name ("AVFoundation input device") and the exact line format are reasoned from FFmpeg's
documented `-f avfoundation -list_devices true` CLI behaviour, not confirmed by a local capture. As
`parse_device_list` already does for dshow, a line matching neither a section header nor the device pattern is
silently ignored, so a format this module did not predict correctly degrades to "no devices listed", never a
crash - and this parsing should be confirmed against real macOS log output (Q2) before Phase 2 depends on it.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

# One captured FFmpeg log record: (level, context, message). `context` is the component name FFmpeg logs under
# ("AVFoundation input device" for this device lister, reasoned per this module's docstring); PyAV sets it to
# `None` for some records, which this module simply ignores, exactly as devices.py does for dshow.
LogEntry = tuple[int, str | None, str]

# FFmpeg's log context for the avfoundation demuxer's own messages, reasoned from its documented CLI behaviour
# (see module docstring) - not confirmed against a real capture (PRD Q2, Q5).
_LOG_CONTEXT = "AVFoundation input device"

_SECTION_LINE = re.compile(r"^AVFoundation (?P<kind>audio|video) devices:$")
_DEVICE_LINE = re.compile(r"^\[(?P<index>\d+)\]\s(?P<name>.*)$")


@dataclass(frozen=True)
class Device:
    name: str
    kind: str  # "audio" | "video", the section header the device was listed under
    index: int  # FFmpeg's avfoundation device index (the ":N" that opens it); private to this module and capture_avfoundation.py

    def to_json(self) -> dict:
        # Only the name is exposed, same as devices.Device: the one value the capture path (CoreAudioBackend.chunks) needs on the
        # wire. The index is resolved back from the name at open time (resolve_index), never sent to a caller.
        return {"name": self.name}


def _join_context_lines(entries: list[LogEntry]) -> list[str]:
    """FFmpeg logs the avfoundation device list under one context, but PyAV may split one logical line into several log callbacks
    (as it does for dshow, devices.py's own `_join_context_lines`); concatenate every matching message in arrival order and split
    back into lines on the newlines it already contains."""
    joined = "".join(message for _level, context, message in entries if context == _LOG_CONTEXT)
    return joined.splitlines()


def parse_device_list(entries: list[LogEntry]) -> list[Device]:
    """Turn PyAV's captured ffmpeg log entries (from listing avfoundation devices) into the devices ffmpeg reported, in its own
    order. A device line belongs to whichever section header ("AVFoundation audio/video devices:") came before it; a device line
    with no section header yet, or a line matching neither pattern (blank lines, ffmpeg's own banner), is ignored."""
    devices: list[Device] = []
    kind: str | None = None
    for line in _join_context_lines(entries):
        section_match = _SECTION_LINE.match(line)
        if section_match:
            kind = section_match.group("kind")
            continue
        device_match = _DEVICE_LINE.match(line)
        if device_match and kind is not None:
            devices.append(Device(name=device_match.group("name"), kind=kind, index=int(device_match.group("index"))))
    return devices


def capture_avfoundation_log() -> list[LogEntry]:
    """Ask ffmpeg (through PyAV) to list its avfoundation devices and capture the log lines it prints, instead of any capture
    output: `list_devices` is a listing mode, so opening it this way always raises, and that is expected and discarded.

    Same level-raising dance as devices.capture_dshow_log: FFmpeg prints the list at INFO, but PyAV's default log level is off, so
    the level is raised to INFO for the listing only (never lowered if something already made it more verbose) and put back
    afterwards, even on failure."""
    import av
    import av.logging

    previous_level = av.logging.get_level()
    if previous_level is None or previous_level < av.logging.INFO:
        av.logging.set_level(av.logging.INFO)
    try:
        with av.logging.Capture(local=True) as log:
            try:
                av.open(file="", format="avfoundation", options={"list_devices": "true"})
            except Exception:  # noqa: BLE001, S110 - listing always raises (see module docstring); the log, not the exception, is the result
                pass
    finally:
        if av.logging.get_level() != previous_level:
            av.logging.set_level(previous_level)
    return list(log)


def list_input_devices(capture: Callable[[], list[LogEntry]] = capture_avfoundation_log) -> tuple[list[Device], str | None]:
    """The audio input devices the capture path (CoreAudioBackend.chunks) can open, listed by the name it is later resolved back
    to an index by (resolve_index). Never raises: a listing failure returns an empty list and a message instead, so it can never
    block Start, the same rule devices.list_input_devices keeps for dshow."""
    try:
        entries = capture()
    except Exception as error:  # noqa: BLE001 - defensive: a missing ffmpeg/avfoundation backend (e.g. off macOS) must not crash the sidecar
        return [], f"Could not list input devices: {error}"
    devices = [device for device in parse_device_list(entries) if device.kind == "audio"]
    return devices, None


def resolve_index(name: str, capture: Callable[[], list[LogEntry]] = capture_avfoundation_log) -> int:
    """The FFmpeg avfoundation index that opens the audio device listed under `name`, resolved fresh from a listing taken now
    (Q1/Q3: never cached across a session, in case indices are unstable across hot-plug or reboot - untested, no Apple hardware
    available while this was written). Raises `LookupError` when the listing itself fails or `name` is not among its devices, so
    a caller (`CoreAudioBackend.chunks`) opening a name that does not exist raises instead of opening the wrong device."""
    devices, error = list_input_devices(capture=capture)
    if error is not None:
        raise LookupError(f"Could not list input devices to resolve {name!r}: {error}")
    for device in devices:
        if device.name == name:
            return device.index
    raise LookupError(f"No audio input device named {name!r}")
