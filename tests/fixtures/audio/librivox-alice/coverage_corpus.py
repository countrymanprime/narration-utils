"""Recording-check cases cut from the real readings: the `NARRATION_COVERAGE_CORPUS` layout (ADR 0125).

Each recipe in `recipes/coverage.json` lists a case's items as pieces of a source recording. The labels are derived
from the pieces by the rules in docs/research/recording-coverage-fixtures.md, so they are exact by construction:

- `{"whole": true}`: the source file untouched, every paragraph read in place.
- `{"head": true}` / `{"tail": true}`: the LibriVox preamble and chapter title / the closing lines (not paragraphs).
- `{"paragraphs": [a, b]}`: paragraphs a to b (1-based, inclusive; b null for the last), cut at the reader's pauses.
- `{"paragraph": n, "sentences": [i, j]}`: sentences i to j of paragraph n (0-based, half-open; j null for the end).
- `{"roomTone": seconds}`: the recording's own room tone.
- `{"foreign": {"source": id, "paragraph": n}}`: a paragraph of another recording, as different text in its place.

A recipe's `"notRead": [n, ...]` names paragraphs the reader left words out of in the source recording itself, such
as an editorial note in the script that the reader's edition does not have: they are partial wherever they are read.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import audio
import numpy as np
from alice_text import HERE, manuscript_json
from paragraph_spans import Alignment

SCHEMA_VERSION = 1


@dataclass
class _Reading:
    """What the pieces read, walked in recording order."""

    last_in_place: int = 0
    full: set[int] = field(default_factory=set)
    partial: set[int] = field(default_factory=set)
    foreign_after: list[int] = field(default_factory=list)

    def read(self, number: int, whole: bool) -> None:
        if number <= self.last_in_place:
            return  # out of place: a pickup, a repeat or a retake of text already passed
        if whole:
            self.full.add(number)
            self.last_in_place = number
        else:
            self.partial.add(number)


def _require_clean(alignment: Alignment, number: int) -> None:
    if not alignment.usable(number):
        raise ValueError(f"paragraph {number} of {alignment.source['id']} is not a clean edit point")


def _piece_audio(piece: dict, alignment: Alignment, others: dict[str, Alignment], reading: _Reading) -> np.ndarray:
    n = len(alignment.paragraphs)
    if piece.get("whole"):
        for number in range(1, n + 1):
            reading.read(number, whole=True)
        return alignment.slice(0.0, alignment.duration)
    if piece.get("head"):
        return alignment.slice(0.0, alignment.cuts[0])
    if piece.get("tail"):
        return alignment.slice(alignment.cuts[n], alignment.duration)
    if "roomTone" in piece:
        return alignment.room_tone(float(piece["roomTone"]))
    if "foreign" in piece:
        other = others[piece["foreign"]["source"]]
        number = piece["foreign"]["paragraph"]
        _require_clean(other, number)
        reading.foreign_after.append(reading.last_in_place)
        return other.slice(other.cuts[number - 1], other.cuts[number])
    if "paragraphs" in piece:
        first, last = piece["paragraphs"][0], piece["paragraphs"][1] or n
        _require_clean(alignment, first)
        _require_clean(alignment, last)
        for number in range(first, last + 1):
            reading.read(number, whole=True)
        return alignment.slice(alignment.cuts[first - 1], alignment.cuts[last])
    if "sentences" in piece:
        number = piece["paragraph"]
        cuts, clean = alignment.sentence_cuts(number), alignment.sentence_clean[number - 1]
        lo, hi = piece["sentences"][0], piece["sentences"][1]
        hi = len(cuts) - 1 if hi is None else hi
        if not (clean[lo] and clean[hi]):
            raise ValueError(f"sentences {lo}-{hi} of paragraph {number} of {alignment.source['id']} are not cut at pauses")
        reading.read(number, whole=(lo == 0 and hi == len(cuts) - 1))
        return alignment.slice(cuts[lo], cuts[hi])
    raise ValueError(f"unknown piece {piece}")


def _region_kind(run: list[int], count: int, reading: _Reading) -> str:
    # Other text read in the run's place names it first, so a replaced first or last paragraph is not a head or tail.
    if any(run[0] - 1 <= after < run[-1] for after in reading.foreign_after):
        return "different_text"
    if run[0] == 1:
        return "head"
    if run[-1] == count:
        return "tail"
    return "skip"


def _expected(alignment: Alignment, reading: _Reading) -> dict:
    ids = [p.id for p in alignment.chapter.paragraphs]
    labels = {pid: "present" if i + 1 in reading.full else "partial" if i + 1 in reading.partial else "missing" for i, pid in enumerate(ids)}
    regions, run = [], []
    for i, pid in enumerate([*ids, None]):
        if pid is not None and labels[pid] != "present":
            run.append(i + 1)
            continue
        if run:
            regions.append({"kind": _region_kind(run, len(ids), reading), "paragraphs": [ids[k - 1] for k in run]})
            run = []
    return {"textComplete": all(v == "present" for v in labels.values()), "paragraphs": labels, "regions": regions}


def build_case(recipe: dict, alignments: dict[str, Alignment], out: Path | None) -> dict:
    """The case JSON for one recipe; writes its item WAVs under `out/audio` unless `out` is None (labels only)."""
    alignment = alignments[recipe["source"]]
    reading = _Reading()
    items = []
    for item in recipe["items"]:
        samples = audio.join([_piece_audio(piece, alignment, alignments, reading) for piece in item["pieces"]], alignment.rate)
        name = f"audio/{recipe['id']}-{item['id']}.wav"
        if out is not None:
            audio.write_wav(out / name, samples, alignment.rate)
        items.append({"id": item["id"], "audio": name})
    for number in recipe.get("notRead", []):
        if number in reading.full:
            reading.full.discard(number)
            reading.partial.add(number)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "id": recipe["id"],
        "chapter": alignment.chapter.id,
        "conditions": recipe["conditions"],
        "split": recipe["split"],
        "description": recipe["description"] + f" (LibriVox, {alignment.source['reader']})",
        "recording": {"items": items},
        "expected": _expected(alignment, reading),
    }


def load_recipes(root: Path = HERE) -> list[dict]:
    return json.loads((root / "recipes" / "coverage.json").read_text(encoding="utf-8"))["cases"]


def build(out: Path, alignments: dict[str, Alignment], recipes: list[dict]) -> list[Path]:
    (out / "cases").mkdir(parents=True, exist_ok=True)
    chapters = {a.chapter.id: a.chapter for a in alignments.values()}
    used = sorted({alignments[r["source"]].chapter.id for r in recipes})
    manuscript = manuscript_json([chapters[c] for c in used], "librivox-alice")
    (out / "manuscript.json").write_text(json.dumps(manuscript, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    written = []
    for recipe in recipes:
        case = build_case(recipe, alignments, out)
        target = out / "cases" / f"{recipe['id']}.json"
        target.write_text(json.dumps(case, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(target)
    return written
