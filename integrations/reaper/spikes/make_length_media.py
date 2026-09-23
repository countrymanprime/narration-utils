"""Generates short and long synthetic tones for the take-mechanics spike (Q4): a candidate shorter than the target
item, one longer, and a mid-length one used for the source-offset alignment test. Same format as make_media.py
(8 kHz, mono, 16-bit) so the fixtures stay consistent."""

import math
import struct
import sys
import wave
from pathlib import Path

RATE = 8000


def write_tone(path: Path, hertz: float, seconds: float) -> None:
    frame_count = int(RATE * seconds)
    frames = b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * hertz * index / RATE))) for index in range(frame_count))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(frames)


target = Path(sys.argv[1])
target.mkdir(parents=True, exist_ok=True)
# take_short: 1 s, shorter than the 3 s target item. take_long: 5 s, longer than it.
# take_aligned: 4 s, used for the source-offset test (the "manuscript span" is simulated as starting 1.5 s in).
for name, hertz, seconds in (
    ("take_short.wav", 550, 1.0),
    ("take_long.wav", 660, 5.0),
    ("take_aligned.wav", 770, 4.0),
):
    write_tone(target / name, hertz, seconds)
