"""A streaming PCM WAV writer for the built-in recorder (ADR 0357).

The recorder writes as it captures, so the file on disk is a readable WAV at every moment, not only after a clean stop:

- The header is written first with the sizes of an empty file, and patched every ``header_interval`` seconds of audio, so a
  crash or a power cut leaves a file that plays up to the last patch (at most that many seconds short).
- ``close()`` patches it once more with the final sizes and syncs the file. It is idempotent, and the context manager
  calls it on an exception too: a take that ends in an error is still a valid file of what was captured before it.
- The file is created with ``open(path, "xb")``: a take never overwrites an existing file (PRD Q5, D86), so a name that
  is already taken raises ``FileExistsError`` before any audio is written.
- A RIFF file cannot hold more than 4 GiB. A write that would pass that writes the whole frames that still fit, closes
  the file cleanly and raises ``WavFullError`` (at 48 kHz, 24-bit mono that is over eight hours).

Samples arrive as ``float32`` in [-1, 1], shaped ``(frames,)`` for mono or ``(frames, channels)``. They are clipped to full
scale, rounded to the nearest step and stored as little-endian signed PCM, 16 or 24 bits, in the plain ``WAVE_FORMAT_PCM``
header every reader in this repository (Python's ``wave``, the Go decoders) already opens.
"""

import os
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Self

import numpy as np

WAVE_FORMAT_PCM = 1
HEADER_BYTES = 44
# The RIFF size field is 32 bits and counts everything after its own 8 bytes.
MAX_RIFF_BYTES = 0xFFFFFFFF
SUPPORTED_BITS = (16, 24)


class WavFullError(OSError):
    """The file reached the 4 GiB a RIFF WAV can hold; the frames that fitted were written and the file was closed."""


@dataclass(frozen=True)
class WavHeader:
    """What a WAV file's 44-byte PCM header says."""

    sample_rate: int
    channels: int
    bits: int
    data_bytes: int
    riff_bytes: int

    @property
    def frames(self) -> int:
        return self.data_bytes // (self.channels * self.bits // 8)


def _header(sample_rate: int, channels: int, bits: int, data_bytes: int) -> bytes:
    block_align = channels * bits // 8
    return (
        b"RIFF"
        + struct.pack("<I", 36 + data_bytes)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<IHHIIHH", 16, WAVE_FORMAT_PCM, channels, sample_rate, sample_rate * block_align, block_align, bits)
        + b"data"
        + struct.pack("<I", data_bytes)
    )


def read_wav_header(path: str | os.PathLike) -> WavHeader:
    """Reads the 44-byte PCM header ``WavWriter`` writes (and raises ``ValueError`` for anything else)."""
    with open(path, "rb") as handle:
        raw = handle.read(HEADER_BYTES)
    if len(raw) < HEADER_BYTES or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE" or raw[12:16] != b"fmt " or raw[36:40] != b"data":
        raise ValueError(f"{path} does not start with a 44-byte PCM WAV header")
    (riff_bytes,) = struct.unpack("<I", raw[4:8])
    _fmt_bytes, fmt, channels, sample_rate, _byte_rate, _align, bits = struct.unpack("<IHHIIHH", raw[16:36])
    if fmt != WAVE_FORMAT_PCM:
        raise ValueError(f"{path} is WAV format {fmt}, not PCM")
    (data_bytes,) = struct.unpack("<I", raw[40:44])
    return WavHeader(sample_rate=sample_rate, channels=channels, bits=bits, data_bytes=data_bytes, riff_bytes=riff_bytes)


def to_pcm(frames: np.ndarray, bits: int) -> bytes:
    """``float32`` samples as little-endian signed PCM bytes, interleaved by frame. Not-a-number is silence."""
    if bits not in SUPPORTED_BITS:
        raise ValueError(f"a take is 16- or 24-bit PCM, not {bits}-bit")
    samples = np.nan_to_num(np.asarray(frames, dtype=np.float64), nan=0.0, posinf=1.0, neginf=-1.0)
    scale = float(1 << (bits - 1))
    ints = np.clip(np.rint(samples * scale), -scale, scale - 1).astype("<i4").reshape(-1)
    if bits == 16:
        return ints.astype("<i2").tobytes()
    return ints.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()


def from_pcm(raw: bytes, bits: int, channels: int) -> np.ndarray:
    """The inverse of ``to_pcm``: ``(frames, channels)`` ``float32`` samples, for tests and the spike's file check."""
    if bits == 16:
        ints = np.frombuffer(raw, dtype="<i2").astype(np.int32)
    elif bits == 24:
        triples = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        ints = triples[:, 0] | (triples[:, 1] << 8) | (triples[:, 2] << 16)
        ints = np.where(ints >= 1 << 23, ints - (1 << 24), ints)
    else:
        raise ValueError(f"a take is 16- or 24-bit PCM, not {bits}-bit")
    return (ints / float(1 << (bits - 1))).astype(np.float32).reshape(-1, channels)


class WavWriter:
    """Writes one take; see the module docstring for the rules it keeps."""

    def __init__(self, path: str | os.PathLike, sample_rate: int, channels: int, bits: int = 24, header_interval: float = 1.0):
        if sample_rate <= 0:
            raise ValueError(f"a sample rate is positive, not {sample_rate}")
        if not 1 <= channels <= 8:
            raise ValueError(f"a take has 1 to 8 channels, not {channels}")
        if bits not in SUPPORTED_BITS:
            raise ValueError(f"a take is 16- or 24-bit PCM, not {bits}-bit")
        self.path = Path(path)
        self.sample_rate = sample_rate
        self.channels = channels
        self.bits = bits
        self.frame_bytes = channels * bits // 8
        self.frames_written = 0
        self._patch_every = max(1, int(header_interval * sample_rate))
        self._since_patch = 0
        self._file = open(self.path, "xb")  # noqa: SIM115 - held open for the take, closed by close(); never overwrites (PRD Q5)
        try:
            self._file.write(_header(sample_rate, channels, bits, 0))
            self._file.flush()
        except BaseException:
            self._file.close()
            raise

    @property
    def closed(self) -> bool:
        return self._file.closed

    @property
    def data_bytes(self) -> int:
        return self.frames_written * self.frame_bytes

    @property
    def seconds(self) -> float:
        return self.frames_written / self.sample_rate

    def _shape(self, frames: np.ndarray) -> np.ndarray:
        block = np.asarray(frames, dtype=np.float32)
        if block.ndim == 1 and self.channels == 1:
            return block.reshape(-1, 1)
        if block.ndim != 2 or block.shape[1] != self.channels:
            raise ValueError(f"a block for this take is (frames, {self.channels}), not {block.shape}")
        return block

    def write(self, frames: np.ndarray) -> int:
        """Appends ``frames``; returns how many were written. Raises ``WavFullError`` (after closing) once the file is full."""
        if self.closed:
            raise ValueError(f"{self.path} is closed")
        block = self._shape(frames)
        room = (MAX_RIFF_BYTES - (HEADER_BYTES - 8) - self.data_bytes) // self.frame_bytes
        full = len(block) > room
        if full:
            block = block[:room]
        if len(block):
            self._file.write(to_pcm(block, self.bits))
            self.frames_written += len(block)
            self._since_patch += len(block)
            if self._since_patch >= self._patch_every:
                self.flush()
        if full:
            self.close()
            raise WavFullError(f"{self.path.name} reached the 4 GiB a WAV file can hold; the take was saved up to that point.")
        return len(block)

    def _patch(self) -> None:
        end = self._file.tell()
        self._file.seek(0)
        self._file.write(_header(self.sample_rate, self.channels, self.bits, self.data_bytes))
        self._file.seek(end)

    def flush(self) -> None:
        """Patches the header to the frames written so far and pushes them to the operating system."""
        if self.closed:
            return
        self._patch()
        self._file.flush()
        self._since_patch = 0

    def close(self) -> None:
        """Final sizes, synced to disk. Safe to call twice, and after a failed write."""
        if self.closed:
            return
        try:
            self._patch()
            self._file.flush()
            os.fsync(self._file.fileno())
        finally:
            self._file.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
