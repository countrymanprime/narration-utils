"""The built-in recorder's engine-neutral core (native-recording-suite PRD Phase 1, ADR 0357).

A capture engine (``capture_wasapi.py`` in the teleprompter sidecar, or ``SyntheticSource`` in a test) hands blocks of
``float32`` frames to a ``Recorder``, which writes them to a WAV file at the device's own rate (``wav``), reports input
levels (``meter``) and counts every dropout it can see. ``framing`` turns the same blocks into the capture port's
16 kHz mono chunks. Nothing here opens a device, imports an audio library or touches the network (D72): it is numpy and
the standard library, so it runs, and is tested, on any host.
"""

from .framing import Framer, LinearResampler, downmix
from .meter import FLOOR_DBFS, LevelMeter, dbfs
from .recorder import Recorder, RecordingResult, Source, SyntheticSource, synthetic_tone
from .wav import WavFullError, WavWriter, read_wav_header

__all__ = [
    "FLOOR_DBFS",
    "Framer",
    "LevelMeter",
    "LinearResampler",
    "Recorder",
    "RecordingResult",
    "Source",
    "SyntheticSource",
    "WavFullError",
    "WavWriter",
    "dbfs",
    "downmix",
    "read_wav_header",
    "synthetic_tone",
]
