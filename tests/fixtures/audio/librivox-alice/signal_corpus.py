"""Signal-level defects put into real narration at known times: the corpus the audio diagnostics are checked on.

Each recipe in `recipes/signal.json` takes paragraphs `excerpt` [a, b] of a source, puts `headSeconds` and
`tailSeconds` of the recording's own room tone around them, and applies its edits. Every edit is anchored at a
paragraph boundary of the excerpt (`afterParagraph`: n is the pause after paragraph n, 1-based in the chapter), so
it lands in a real pause or at a known point of speech. `labels.json` says what was done and where, in seconds of
the built file; `<id>.words.json` is the transcript words retimed to it, for pacing.

Edits:
- `{"insertRoomTone": {"afterParagraph": n, "seconds": s}}`: dead air.
- `{"insertDigitalSilence": {"afterParagraph": n, "seconds": s}}`: a dropout (exact zeros).
- `{"clip": {"afterParagraph": n, "offset": o, "seconds": s, "gainDb": g}}`: speech from o s into paragraph n + 1
  driven g dB hotter and hard-clipped at full scale.
- `{"gain": {"afterParagraph": n, "db": d}}`: everything after the pause changes level by d dB.
- `{"hiss": {"dbfs": l, "afterParagraph": n}}`: white noise at RMS l dBFS from the pause on (from the start
  without `afterParagraph`), raising the noise floor and room tone.
- `{"clicks": {"afterParagraphs": [n, ...], "peakDbfs": p, "place": "centre" | "cut"}}`: a 2 ms click in the
  middle of each pause (or at the cut, which may sit next to a breath).

An edit may carry `"knownIssue"`: a defect the tools are known to miss, copied to its last label. The checks log a
known miss and fail when it starts being found, so the note is removed rather than left stale.

`"trimToSpeech": true` starts the excerpt at the end of the pause before its first paragraph and ends it at the
start of the pause after its last, so `headSeconds` and `tailSeconds` are (nearly) all the room tone there is.
`edges` in the labels is the reference timing of that room tone, computed from the built file.
"""

from __future__ import annotations

import json
from pathlib import Path

import audio
import numpy as np
from alice_text import HERE, tokens
from paragraph_spans import Alignment

CLICK_SECONDS = 0.002
SEED = 20260927
# The edge reference: the first and last 50 ms window at or above -50 dBFS RMS, as ACX's checker and the app time
# the room tone at a file's head and tail.
EDGE_WINDOW_SECONDS = 0.05
EDGE_FLOOR_DBFS = -50.0
# A pause is the run of 10 ms frames this far under the reader's speech level around a paragraph cut.
PAUSE_BELOW_SPEECH_DB = 30
_INSERTS = ("insertRoomTone", "insertDigitalSilence")


def _assemble(pieces: list[np.ndarray], rate: int) -> tuple[np.ndarray, list[float]]:
    """audio.join, plus where each piece starts in the result (each join overlaps by one fade)."""
    fade = int(rate * audio.FADE_SECONDS)
    starts, position = [], 0
    for k, piece in enumerate(pieces):
        position -= fade if k and position >= fade and len(piece) >= fade else 0
        starts.append(position / rate)
        position += len(piece)
    return audio.join(pieces, rate), starts


def _layout(recipe: dict, alignment: Alignment) -> tuple[list[np.ndarray], list[tuple[str, int]]]:
    """The pieces in order, each tagged ("paragraph", n), (insert kind, after n) or ("edge", 0 | 1)."""
    first, last = recipe["excerpt"]
    inserts: dict[int, list[tuple[str, float]]] = {}
    for edit in recipe.get("edits", []):
        for kind in _INSERTS:
            if kind in edit:
                inserts.setdefault(edit[kind]["afterParagraph"], []).append((kind, float(edit[kind]["seconds"])))

    def tone(seconds: float) -> np.ndarray:
        return audio.room_tone(alignment.samples, alignment.rate, alignment.levels, seconds)

    pieces, tags = [tone(recipe.get("headSeconds", 1.0))], [("edge", 0)]
    trim = recipe.get("trimToSpeech", False)
    for number in range(first, last + 1):
        start, end = alignment.cuts[number - 1], alignment.cuts[number]
        if trim and number == first:
            start = pause_span(alignment, number - 1)[1]
        if trim and number == last:
            end = pause_span(alignment, number)[0]
        pieces.append(alignment.slice(start, end))
        tags.append(("paragraph", number))
        for kind, seconds in inserts.get(number, []):
            pieces.append(np.zeros(int(seconds * alignment.rate), np.float32) if kind == "insertDigitalSilence" else tone(seconds))
            tags.append((kind, number))
    pieces.append(tone(recipe.get("tailSeconds", 3.0)))
    tags.append(("edge", 1))
    return pieces, tags


def pause_span(alignment: Alignment, cut_index: int) -> tuple[float, float]:
    """The quiet run of frames around cut `cut_index` (0 is before paragraph 1): the reader's pause there."""
    levels, quiet = alignment.levels, alignment.speech_level - PAUSE_BELOW_SPEECH_DB
    centre = round(alignment.cuts[cut_index] / audio.HOP_SECONDS)
    lo, hi = centre, centre
    while lo > 0 and levels[lo - 1] < quiet:
        lo -= 1
    while hi < len(levels) - 1 and levels[hi + 1] < quiet:
        hi += 1
    return lo * audio.HOP_SECONDS, hi * audio.HOP_SECONDS


def _edges(samples: np.ndarray, rate: int) -> tuple[float, float]:
    """Seconds of room tone before the first and after the last window at or above EDGE_FLOOR_DBFS."""
    width = int(EDGE_WINDOW_SECONDS * rate)
    count = len(samples) // width
    energy = (samples[: count * width].astype(np.float64).reshape(count, width) ** 2).mean(axis=1)
    loud = np.flatnonzero(10 * np.log10(np.maximum(energy, 1e-12)) >= EDGE_FLOOR_DBFS)
    if not len(loud):
        return len(samples) / rate, len(samples) / rate
    return loud[0] * width / rate, len(samples) / rate - (loud[-1] + 1) * width / rate


def _click(rate: int, peak_dbfs: float) -> np.ndarray:
    n = max(2, int(CLICK_SECONDS * rate))
    t = np.arange(n) / rate
    return (10 ** (peak_dbfs / 20) * np.sin(2 * np.pi * 3000 * t) * np.exp(-t / (CLICK_SECONDS / 3))).astype(np.float32)


def _apply(samples: np.ndarray, rate: int, recipe: dict, alignment: Alignment, bounds: dict) -> list[dict]:
    """Apply the in-place edits in order; returns their labels."""
    labels = []
    rng = np.random.default_rng(SEED)
    for edit in recipe.get("edits", []):
        if "clip" in edit:
            spec = edit["clip"]
            start = bounds[("paragraph", spec["afterParagraph"] + 1)][0] + spec["offset"]
            lo, hi = int(start * rate), int((start + spec["seconds"]) * rate)
            samples[lo:hi] = np.clip(audio.gain(samples[lo:hi], spec["gainDb"]), -1.0, 32767 / 32768)
            labels.append({"kind": "clipping", "start_s": round(start, 3), "end_s": round(start + spec["seconds"], 3)})
        elif "gain" in edit:
            at = bounds[("pause", edit["gain"]["afterParagraph"])]
            samples[int(at * rate) :] = audio.gain(samples[int(at * rate) :], edit["gain"]["db"])
            labels.append({"kind": "level_shift", "at_s": round(at, 3), "delta_db": edit["gain"]["db"]})
        elif "hiss" in edit:
            spec = edit["hiss"]
            at = bounds[("pause", spec["afterParagraph"])] if "afterParagraph" in spec else 0.0
            lo = int(at * rate)
            samples[lo:] += (rng.standard_normal(len(samples) - lo) * 10 ** (spec["dbfs"] / 20)).astype(np.float32)
            labels.append({"kind": "hiss", "from_s": round(at, 3), "rms_dbfs": spec["dbfs"]})
        elif "clicks" in edit:
            spec = edit["clicks"]
            click = _click(rate, spec["peakDbfs"])
            for number in spec["afterParagraphs"]:
                at = bounds[("pause", number)]
                if spec.get("place", "centre") == "centre":
                    # In the middle of the reader's pause, away from the breath or word on either side of it.
                    lo, hi = pause_span(alignment, number)
                    at += (lo + hi) / 2 - alignment.cuts[number]
                start = int(at * rate)
                samples[start : start + len(click)] += click
                labels.append({"kind": "click", "at_s": round(at, 3), "peak_dbfs": spec["peakDbfs"]})
        if edit.get("knownIssue"):
            labels[-1]["known_issue"] = edit["knownIssue"]
    return labels


def _retimed_words(alignment: Alignment, bounds: dict, recipe: dict) -> list[dict]:
    """The excerpt's matched script words in measure.Word's shape, timed in the built file."""
    words = []
    for number in range(recipe["excerpt"][0], recipe["excerpt"][1] + 1):
        offset = bounds[("paragraph", number)][0] - alignment.cuts[number - 1]
        first = alignment.first_token[number - 1]
        texts = tokens(alignment.chapter.paragraphs[number - 1].text)
        for text, times in zip(texts, alignment.token_times[first : first + len(texts)]):
            if times:
                words.append({"text": text, "start_seconds": round(times[0] + offset, 3), "end_seconds": round(times[1] + offset, 3)})
    return words


def build_case(recipe: dict, alignment: Alignment, out: Path) -> dict:
    rate = alignment.rate
    pieces, tags = _layout(recipe, alignment)
    samples, starts = _assemble(pieces, rate)
    bounds: dict = {tag: (start, start + len(piece) / rate) for tag, start, piece in zip(tags, starts, pieces)}
    for number in range(recipe["excerpt"][0], recipe["excerpt"][1] + 1):
        # The pause after paragraph n: the quiet point where its slice ends (and any inserted piece starts).
        bounds[("pause", number)] = bounds[("paragraph", number)][1] - audio.FADE_SECONDS / 2
    labels = [
        {"kind": "dead_air" if tag[0] == "insertRoomTone" else "digital_silence", "start_s": round(bounds[tag][0], 3), "end_s": round(bounds[tag][1], 3)}
        for tag in tags
        if tag[0] in _INSERTS
    ]
    labels += _apply(samples, rate, recipe, alignment, bounds)
    head, tail = _edges(samples, rate)
    words = _retimed_words(alignment, bounds, recipe)
    audio.write_wav(out / f"{recipe['id']}.wav", samples, rate)
    (out / f"{recipe['id']}.words.json").write_text(json.dumps(words) + "\n", encoding="utf-8")
    return {
        "id": recipe["id"],
        "file": f"{recipe['id']}.wav",
        "words": f"{recipe['id']}.words.json",
        "source": alignment.source["id"],
        "excerpt": recipe["excerpt"],
        "description": recipe["description"],
        "duration_s": round(len(samples) / rate, 3),
        "sample_rate": rate,
        # The first and last spoken word: the head and tail room tone is what lies outside them.
        "speech_start_s": words[0]["start_seconds"],
        "speech_end_s": words[-1]["end_seconds"],
        "edges": {"floor_dbfs": EDGE_FLOOR_DBFS, "head_s": round(head, 3), "tail_s": round(tail, 3)},
        "events": labels,
    }


def load_recipes(root: Path = HERE) -> list[dict]:
    return json.loads((root / "recipes" / "signal.json").read_text(encoding="utf-8"))["cases"]


def build(out: Path, alignments: dict[str, Alignment], recipes: list[dict]) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    cases = [build_case(recipe, alignments[recipe["source"]], out) for recipe in recipes]
    path = out / "labels.json"
    path.write_text(json.dumps({"schemaVersion": 1, "cases": cases}, indent=2) + "\n", encoding="utf-8")
    return path
