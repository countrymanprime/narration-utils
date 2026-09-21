"""Generates the tiny synthetic WAV files the REAPER fixtures reference: 3 s, 8 kHz, mono, 16-bit sine tones."""

import math
import struct
import sys
import wave
from pathlib import Path

RATE = 8000
SECONDS = 3


def write_tone(path, hertz):
    frames = b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * hertz * index / RATE))) for index in range(RATE * SECONDS))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(frames)


target = Path(sys.argv[1])
target.mkdir(parents=True, exist_ok=True)
for name, hertz in (("take_a.wav", 220), ("take_b.wav", 330), ("take_c.wav", 440)):
    write_tone(target / name, hertz)
