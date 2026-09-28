"""The recorder: a capture engine's blocks to a WAV file, with levels and dropout counts (ADR 0357).

An engine is a ``Source``: it knows its rate and channel count and, once started, calls ``deliver(block, overflowed)`` from
its own audio thread for every block it captures. ``overflowed`` is the engine's own flag for input it lost before the
block (WASAPI's ``AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY``, PortAudio's ``input_overflow``); ``fail(error)`` reports an
error that ended the stream; the recorder sets ``failed`` and its owner calls ``stop()``.

The audio thread only copies the block onto a bounded queue, never touching the disk; a writer thread takes blocks off it,
writes them (``WavWriter``), meters them (``LevelMeter``) and hands each level event to ``on_level``. So a slow disk or a
slow listener can fill the queue but can never stall the device. If the queue is full, that block is dropped and counted:
a dropout the take reports, never a silent gap.

``stop()`` stops the engine, drains the queue into the file and closes it; it returns a ``RecordingResult`` and is safe to
call twice. An error on either side (the engine's ``fail``, a disk that fills, ``WavFullError``) stops the engine too, and
the file is still closed with the audio written before the error, which the result names. Nothing here sends anything
anywhere: the only output is the file and the callbacks (D72).
"""

import math
import queue
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, Self

import numpy as np

from .meter import LevelMeter
from .wav import WavWriter

# Seconds of audio the queue holds before it drops a block. The writer takes a block in well under a millisecond (the spike
# measures it), so this only fills when the disk stalls for this long.
QUEUE_SECONDS = 4.0
_STOP = object()


class Source(Protocol):
    """A capture engine as the recorder drives it."""

    sample_rate: int
    channels: int

    def start(self, deliver: Callable[[np.ndarray, bool], None], fail: Callable[[BaseException], None]) -> None: ...

    def stop(self) -> None: ...

    @property
    def latency(self) -> float:
        """The engine's reported input latency in seconds (0.0 when it reports none)."""
        ...


@dataclass
class RecordingResult:
    """What one take came to: where it is, how long, and every loss the recorder saw."""

    path: Path
    sample_rate: int
    channels: int
    bits: int
    frames: int
    overflows: int = 0  # blocks the engine flagged as following lost input
    dropped_blocks: int = 0  # blocks the recorder dropped because its queue was full
    dropped_frames: int = 0
    clipped: int = 0  # samples at or over full scale
    latency: float = 0.0  # the engine's reported input latency, seconds
    wall_seconds: float = 0.0  # from start() to stop()
    block_ms: list[float] = field(default_factory=list, repr=False)  # the writer's time per block
    lag_ms: list[float] = field(default_factory=list, repr=False)  # from deliver() to written, per block
    error: str | None = None

    @property
    def seconds(self) -> float:
        return self.frames / self.sample_rate

    @property
    def dropouts(self) -> int:
        return self.overflows + self.dropped_blocks

    def summary(self) -> dict:
        """The numbers the spike report and a future ``take`` event carry."""

        def pct(values: list[float], q: float) -> float | None:
            return round(float(np.percentile(values, q)), 3) if values else None

        return {
            "path": str(self.path),
            "sampleRate": self.sample_rate,
            "channels": self.channels,
            "bits": self.bits,
            "frames": self.frames,
            "seconds": round(self.seconds, 3),
            "wallSeconds": round(self.wall_seconds, 3),
            "overflows": self.overflows,
            "droppedBlocks": self.dropped_blocks,
            "droppedFrames": self.dropped_frames,
            "clipped": self.clipped,
            "latencyMs": round(self.latency * 1000, 2),
            "blockMs": {"p50": pct(self.block_ms, 50), "p99": pct(self.block_ms, 99), "max": pct(self.block_ms, 100)},
            "lagMs": {"p50": pct(self.lag_ms, 50), "p99": pct(self.lag_ms, 99), "max": pct(self.lag_ms, 100)},
            "error": self.error,
        }


class Recorder:
    """Records one take from ``source`` to ``path``; see the module docstring."""

    def __init__(
        self,
        source: Source,
        path: str | Path,
        *,
        bits: int = 24,
        on_level: Callable[[dict], None] | None = None,
        queue_seconds: float = QUEUE_SECONDS,
        clock: Callable[[], float] = time.perf_counter,
    ):
        self.source = source
        self._clock = clock
        self._on_level = on_level
        self._writer = WavWriter(path, source.sample_rate, source.channels, bits)
        self._meter = LevelMeter(source.sample_rate, source.channels)
        # Blocks are about 10 ms; allow for engines that deliver smaller ones.
        self._queue: queue.Queue = queue.Queue(maxsize=max(8, int(queue_seconds * 200)))
        self._lock = threading.Lock()
        self._error: str | None = None
        self.failed = threading.Event()  # set on the first error, so a controller can wait on it and stop()
        self._overflows = 0
        self._dropped_blocks = 0
        self._dropped_frames = 0
        self._block_ms: list[float] = []
        self._lag_ms: list[float] = []
        self._started = 0.0
        self._stopped = False
        self._result: RecordingResult | None = None
        self._thread = threading.Thread(target=self._drain, name="recorder-writer", daemon=True)

    # --- the audio thread -------------------------------------------------------------------------------------------------

    def _deliver(self, block: np.ndarray, overflowed: bool) -> None:
        if overflowed:
            with self._lock:
                self._overflows += 1
        try:
            self._queue.put_nowait((np.array(block, dtype=np.float32, copy=True), self._clock()))
        except queue.Full:
            with self._lock:
                self._dropped_blocks += 1
                self._dropped_frames += len(block)

    def _fail(self, error: BaseException) -> None:
        # The writer keeps draining what was delivered before the error; the caller sees ``failed`` and calls stop().
        self._note_error(f"The input device stopped: {error}")

    # --- the writer thread ------------------------------------------------------------------------------------------------

    def _note_error(self, message: str) -> None:
        with self._lock:
            if self._error is None:
                self._error = message
        self.failed.set()

    def _drain(self) -> None:
        while True:
            item = self._queue.get()
            if item is _STOP:
                return
            block, delivered = item
            if self._writer.closed:
                continue  # the file already failed; keep draining so the engine never blocks
            began = self._clock()
            try:
                self._writer.write(block)
            except OSError as error:  # a full disk, WavFullError, a removed drive
                self._note_error(str(error) or type(error).__name__)
                try:
                    self._writer.close()
                except OSError as close_error:  # the same failed device, closing: still leaves the file handle shut
                    self._note_error(str(close_error) or type(close_error).__name__)
                continue
            events = self._meter.feed(block)
            done = self._clock()
            self._block_ms.append((done - began) * 1000)
            self._lag_ms.append((done - delivered) * 1000)
            if self._on_level is not None:
                for event in events:
                    try:
                        self._on_level(event)
                    except Exception as error:  # noqa: BLE001 - a listener's bug must not stop the take being written
                        self._note_error(f"The level listener failed: {error}")

    # --- control ----------------------------------------------------------------------------------------------------------

    @property
    def error(self) -> str | None:
        with self._lock:
            return self._error

    @property
    def frames(self) -> int:
        return self._writer.frames_written

    def start(self) -> "Recorder":
        self._started = self._clock()
        self._thread.start()
        try:
            self.source.start(self._deliver, self._fail)
        except BaseException:
            self._queue.put(_STOP)
            self._thread.join()
            self._writer.close()
            raise
        return self

    def stop(self) -> RecordingResult:
        """Stops the engine, writes what it delivered, closes the file. Safe to call twice."""
        if self._result is not None:
            return self._result
        try:
            self.source.stop()
        except Exception as error:  # noqa: BLE001 - the take is still saved; the result says why the stop was not clean
            self._note_error(f"The input device did not stop cleanly: {error}")
        stopped = self._clock()
        self._queue.put(_STOP)
        self._thread.join()
        self._writer.close()
        with self._lock:
            self._result = RecordingResult(
                path=self._writer.path,
                sample_rate=self._writer.sample_rate,
                channels=self._writer.channels,
                bits=self._writer.bits,
                frames=self._writer.frames_written,
                overflows=self._overflows,
                dropped_blocks=self._dropped_blocks,
                dropped_frames=self._dropped_frames,
                clipped=self._meter.clipped,
                latency=float(getattr(self.source, "latency", 0.0) or 0.0),
                wall_seconds=stopped - self._started,
                block_ms=self._block_ms,
                lag_ms=self._lag_ms,
                error=self._error,
            )
        return self._result

    def __enter__(self) -> Self:
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.stop()


def synthetic_tone(start: int, count: int, sample_rate: int, channels: int, frequency: float = 440.0, level: float = 0.25) -> np.ndarray:
    """Frames ``start`` to ``start + count`` of a sine at ``level`` (about -12 dBFS), each channel a little higher in pitch
    so a swapped or dropped channel shows. A pure function of the frame index, so a test can rebuild what a take holds."""
    index = np.arange(start, start + count, dtype=np.float64)
    columns = [level * np.sin(2 * math.pi * frequency * (1 + 0.5 * c) * index / sample_rate) for c in range(channels)]
    return np.stack(columns, axis=1).astype(np.float32)


class SyntheticSource:
    """A capture engine with no device: ``synthetic_tone`` in blocks of ``block`` frames, from its own thread.

    With ``realtime`` it paces blocks to the wall clock, as a device does, so a run measures what a real take costs; without
    it, blocks come as fast as the recorder takes them (a throughput test). ``overflow_every`` flags every n-th block as
    following lost input, ``fail_after`` ends the stream with an error after that many blocks, and ``stop_after`` ends it
    cleanly (the thread just stops delivering), so the recorder's accounting can be tested without hardware.
    """

    def __init__(
        self,
        sample_rate: int = 48000,
        channels: int = 1,
        block: int = 480,
        *,
        realtime: bool = True,
        overflow_every: int = 0,
        fail_after: int | None = None,
        stop_after: int | None = None,
        latency: float = 0.0,
    ):
        self.sample_rate = sample_rate
        self.channels = channels
        self.block = block
        self.realtime = realtime
        self.overflow_every = overflow_every
        self.fail_after = fail_after
        self.stop_after = stop_after
        self._latency = latency
        self.delivered = 0  # blocks
        self._halt = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def latency(self) -> float:
        return self._latency

    def start(self, deliver: Callable[[np.ndarray, bool], None], fail: Callable[[BaseException], None]) -> None:
        def run() -> None:
            began = time.perf_counter()
            while not self._halt.is_set():
                if self.fail_after is not None and self.delivered >= self.fail_after:
                    fail(OSError("the synthetic device was unplugged"))
                    return
                if self.stop_after is not None and self.delivered >= self.stop_after:
                    return
                start = self.delivered * self.block
                overflowed = bool(self.overflow_every) and (self.delivered + 1) % self.overflow_every == 0
                deliver(synthetic_tone(start, self.block, self.sample_rate, self.channels), overflowed)
                self.delivered += 1
                if self.realtime:
                    due = began + self.delivered * self.block / self.sample_rate
                    self._halt.wait(max(0.0, due - time.perf_counter()))

        self._thread = threading.Thread(target=run, name="synthetic-source", daemon=True)
        self._thread.start()

    def wait(self, timeout: float | None = None) -> None:
        """Until the thread ends on its own (``stop_after`` or ``fail_after``)."""
        if self._thread is not None:
            self._thread.join(timeout)

    def stop(self) -> None:
        self._halt.set()
        if self._thread is not None:
            self._thread.join()
