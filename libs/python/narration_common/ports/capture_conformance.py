"""The capture port's conformance suite (ADR 0301, Liskov): what every ``CaptureBackend`` must do, checked the same way for each.

``run(backend)`` lists the devices: the listing must not raise, must be ``(devices, error)`` with either devices or a sentence, and
every device must have a name and say it on the wire. It then opens the first listed device (or ``device=``) by that name and takes
``take`` chunks: each a non-empty 1-D ``float32`` array of finite samples, whole unless it is the last; the stream is closed twice.
Unless told not to, it also checks that a device that does not exist raises instead of opening or ending quietly. Real backends run
it with a faked device layer, so CI needs no microphone; ``conformance.run_over_registry(BACKENDS, ...)`` runs it over every row.
"""

import json
import math
from typing import Any

from . import conformance
from .capture import CHUNK_SECONDS, CaptureDescriptor, chunk_samples
from .conformance import ConformanceError

MISSING_DEVICE = "Narration Utils conformance: no such device"


def check_listing(backend: Any, name: str) -> list[Any]:
    """``list_devices()`` returns ``(devices, error)`` without raising: devices with names and wire forms, or none and a sentence."""
    try:
        listing = backend.list_devices()
    except Exception as exc:
        raise ConformanceError(f'"{name}" list_devices() raised {type(exc).__name__}: {exc}; a failed listing returns its message') from exc
    if not (isinstance(listing, tuple) and len(listing) == 2):
        raise ConformanceError(f'"{name}" list_devices() returned {listing!r}, not (devices, error)')
    devices, error = listing
    devices = list(devices)
    if error is not None:
        if not isinstance(error, str) or not error.strip():
            raise ConformanceError(f'"{name}" list_devices() gave an error with no message for the narrator: {error!r}')
        if devices:
            raise ConformanceError(f'"{name}" list_devices() listed devices and an error; a failed listing lists none')
    for device in devices:
        device_name = getattr(device, "name", None)
        if not isinstance(device_name, str) or not device_name.strip():
            raise ConformanceError(f'"{name}" listed a device with no name: {device!r}')
        to_json = getattr(device, "to_json", None)
        if not callable(to_json):
            raise ConformanceError(f'"{name}" listed "{device_name}" with no to_json() for the devices event')
        wire = to_json()
        try:
            json.dumps(wire)
        except (TypeError, ValueError) as exc:
            raise ConformanceError(f'"{name}" listed "{device_name}", whose to_json() is not JSON: {exc}') from exc
        if not isinstance(wire, dict) or wire.get("name") != device_name:
            raise ConformanceError(f'"{name}" listed "{device_name}", but its to_json() says {wire!r}')
    return devices


def check_chunk(chunk: Any, where: str) -> int:
    """One chunk is a non-empty 1-D ``float32`` array of finite samples; returns its length."""
    try:
        length = len(chunk)
    except TypeError as exc:
        raise ConformanceError(f"{where} has no length: {chunk!r}") from exc
    if length == 0:
        raise ConformanceError(f"{where} is empty")
    dtype = getattr(chunk, "dtype", None)
    if dtype is None:
        raise ConformanceError(f"{where} has no dtype; a chunk is a float32 array")
    if str(dtype) != "float32":
        raise ConformanceError(f"{where} is {dtype}, not float32")
    dimensions = getattr(chunk, "ndim", 1)
    if dimensions != 1:
        raise ConformanceError(f"{where} has {dimensions} dimensions; a chunk is mono, one sample after another")
    if not all(math.isfinite(sample) for sample in chunk):
        raise ConformanceError(f"{where} holds a sample that is not a number")
    return length


def check_stream(backend: Any, device: str, chunk_seconds: float, take: int, name: str) -> None:
    """Opens ``device``, takes up to ``take`` chunks and checks them, then closes the stream twice."""
    whole = chunk_samples(chunk_seconds)
    stream = backend.chunks(device, chunk_seconds)
    if not callable(getattr(stream, "close", None)):
        raise ConformanceError(f'"{name}" chunks() gave {type(stream).__name__}, which has no close() to release the device')
    try:
        lengths = []
        for index in range(take + 1):
            try:
                chunk = next(stream)
            except StopIteration:
                break
            except Exception as exc:
                if index == 0:
                    raise ConformanceError(f'"{name}" could not open "{device}", the name it listed: {type(exc).__name__}: {exc}') from exc
                raise ConformanceError(f'"{name}" failed after {index} chunks of "{device}": {type(exc).__name__}: {exc}') from exc
            if lengths and lengths[-1] != whole:
                raise ConformanceError(f'"{name}" chunk {index - 1} of "{device}" is {lengths[-1]} samples, not {whole}; only the last may be shorter')
            if index == take:
                break  # only peeked, to see whether the last chunk taken ended the stream
            lengths.append(check_chunk(chunk, f'"{name}" chunk {index} of "{device}"'))
        if not lengths:
            raise ConformanceError(f'"{name}" gave no audio from "{device}"')
        if lengths[-1] > whole:
            raise ConformanceError(f'"{name}" chunk {len(lengths) - 1} of "{device}" is {lengths[-1]} samples, more than {whole}')
    finally:
        conformance.check_close_twice(stream)


def check_missing_device(backend: Any, missing_device: str, chunk_seconds: float, name: str) -> None:
    """A device that does not exist raises by the first chunk: never audio, never a quiet end."""
    stream = None
    try:
        stream = backend.chunks(missing_device, chunk_seconds)
        next(stream)
    except StopIteration as exc:
        raise ConformanceError(f'"{name}" ended without audio instead of raising for "{missing_device}", which does not exist') from exc
    except Exception:  # noqa: BLE001 - any refusal will do: the caller wraps it in its own sentence
        return
    finally:
        if stream is not None and callable(getattr(stream, "close", None)):
            stream.close()
    raise ConformanceError(f'"{name}" opened a device that does not exist ("{missing_device}") instead of raising')


def run(
    backend: Any,
    *,
    device: str | None = None,
    missing_device: str | None = MISSING_DEVICE,
    chunk_seconds: float = CHUNK_SECONDS,
    take: int = 3,
) -> None:
    """Checks one backend. ``device`` is a device to stream (the first listed when absent; needed when nothing is listed);
    ``missing_device=None`` is for an adapter tested with its device layer faked to open anything."""
    if take < 1:
        raise ValueError("the capture suite must take at least one chunk")
    descriptor = conformance.check_descriptor(backend)
    if not isinstance(descriptor, CaptureDescriptor):
        raise ConformanceError(f'"{descriptor.name}" has a {type(descriptor).__name__}, not a CaptureDescriptor')
    name = descriptor.name

    devices = check_listing(backend, name)
    if device is None:
        if not devices:
            raise ValueError(f'"{name}" listed no devices, so the capture suite needs device= to stream')
        device = devices[0].name
    check_stream(backend, device, chunk_seconds, take, name)

    if missing_device is not None:
        check_missing_device(backend, missing_device, chunk_seconds, name)
