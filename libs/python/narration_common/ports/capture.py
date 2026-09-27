"""The capture port (ADR 0301, provider-ports P10): what every microphone backend is to its callers.

A backend lists the input devices it can open (``list_devices``) and streams one of them as chunks of mono audio (``chunks``).
Its callers are the teleprompter sidecar's ``--list-devices``, its session and its level meter (``live_asr.py``), which today call
``devices.list_input_devices`` and ``iter_microphone_chunks`` directly; the dshow adapter (P11) moves those two behind this port.
Callers look a backend up in ``BACKENDS`` for this platform and never compare names themselves.

The rules below are the ones those two functions keep today:

- ``list_devices()`` never raises. A listing that fails returns no devices and a sentence for the narrator, so a caller never
  takes a failure for "no microphones" and a listing can never block Start. The name a device is listed under is the name that
  opens it, and ``to_json()`` is what the ``devices`` event carries (``{"name": ...}``).
- ``chunks(device, chunk_seconds)`` opens the device when first iterated, raising if it cannot, and gives 1-D ``float32`` arrays of
  mono samples at ``SAMPLE_RATE``, each ``chunk_samples(chunk_seconds)`` long except the last, which may be shorter but is never
  empty. Closing the iterator releases the device, and closing it twice is safe.

Nothing here imports a backend or numpy: PyAV stays a lazy import inside its adapter (P11).
"""

from dataclasses import dataclass
from typing import Any, Protocol

from .registry import Descriptor, Registry

# The rate every chunk is at and the default chunk length: ``live_asr.py``'s SAMPLE_RATE and CHUNK_SECONDS (a test keeps them equal).
SAMPLE_RATE = 16000
CHUNK_SECONDS = 0.32


def chunk_samples(chunk_seconds: float) -> int:
    """How many samples a whole chunk holds, rounded as ``iter_microphone_chunks`` rounds it (never fewer than one)."""
    return max(1, int(chunk_seconds * SAMPLE_RATE))


@dataclass(frozen=True)
class CaptureDescriptor(Descriptor):
    """A capture backend's row. A backend opens one platform's own audio API (dshow on Windows), so it names its platforms;
    it has one job and so no modes."""

    def __post_init__(self) -> None:
        super().__post_init__()
        if not self.platforms:
            raise ValueError(f"capture backend {self.name!r} must name the platforms whose audio API it opens")
        if self.modes:
            raise ValueError(f"capture backend {self.name!r} has no modes to declare, not {', '.join(self.modes)}")


class InputDevice(Protocol):
    """One device a backend listed. ``name`` opens it; ``to_json()`` is its entry in the ``devices`` event."""

    name: str

    def to_json(self) -> dict[str, Any]: ...


class CaptureBackend(Protocol):
    """One microphone backend, keeping the rules in this module's docstring."""

    descriptor: CaptureDescriptor

    def list_devices(self) -> tuple[list[InputDevice], str | None]: ...

    def chunks(self, device: str, chunk_seconds: float = CHUNK_SECONDS) -> Any:
        """An iterator of chunks with a ``close()``; a generator, as ``iter_microphone_chunks`` is, fits."""
        ...


# Filled by the teleprompter sidecar's adapter when it is imported (provider-ports P11); the first registered is the default.
BACKENDS: Registry[CaptureBackend] = Registry("capture backend")
