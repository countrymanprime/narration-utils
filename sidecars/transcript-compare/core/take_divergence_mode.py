"""The sidecar's per-take divergence mode: `compare.py --take-divergence`.

Take review (`docs/utilities/take-review.md`), its PRD's Phase 9, and ADR 0141. For one
fixed manuscript span (a chapter, found by id, and a run of its sentence units, numbered as
`--find-repeats` numbers a repeated span) and the takes the host lists in a JSON manifest, this
mode transcribes each take's range with Whisper word timestamps, aligns it to the span with the
take markers' own diff (`core/take_divergence.py`) and writes, per take, every span word's status
and time and every divergence as manuscript words plus source seconds. Phase 10 reads it to shade
where each take goes wrong. It writes evidence only: no ranking and no verdict (PRD Q9).

Manifest (JSON, written by the host, a trust boundary: `docs/architecture/threat-model.md` row 4f):

    {"schemaVersion": 1, "chapterId": "<canonical chapter id>",
     "span": {"firstUnit": 0, "lastUnit": 2},
     "takes": [{"itemGuid": "...", "takeGuid": "...", "sourceFile": "<path>",
                "startOffset": <source seconds>, "length": <seconds>}, ...]}

Results (`--out`, written atomically, so the file exists only when the run finished), tagged lines:

    SUMMARY|<text>
    DIVERGENCE_SPAN|{"schemaVersion": 1, "chapterId", "chapterTitle", "span": {...words}, "model", "language"}
    TAKE_DIVERGENCE|{"index", "itemGuid", "takeGuid", "sourceFile", "startOffset", "length",
                     "fidelity", "counts", "words": [...], "divergences": [...]}   (one per take, manifest order)

Every time is in the take's source seconds. Progress is `stage|pct|message` (START, MATCH,
TRANSCRIBE, ALIGN, WRITE, DONE). Exit codes: 0 done; 1 failed (an `ERROR|0|<message>` progress
line, no results file); 2 cancelled through `<progress>.cancel`, honoured between takes (a
`CANCELLED` progress line, no results file). `argparse` also exits 2 on a usage error, with no progress line.

This module does not import `compare.py`: `run` is handed the loaded module as `engine`.
"""

from __future__ import annotations

import contextlib
import json
import math
import os
import traceback
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

import take_divergence

MANIFEST_SCHEMA_VERSION = 1
RESULT_SCHEMA_VERSION = 1

MATCH_PCT = 1
TRANSCRIBE_START_PCT = 2
TRANSCRIBE_END_PCT = 94
WRITE_PCT = 98

EXIT_DONE = 0
EXIT_FAILED = 1
EXIT_CANCELLED = 2

_MANIFEST_KEYS = frozenset({"schemaVersion", "chapterId", "span", "takes"})
_SPAN_KEYS = frozenset({"firstUnit", "lastUnit"})
_TAKE_KEYS = frozenset({"itemGuid", "takeGuid", "sourceFile", "startOffset", "length"})


class ManifestError(ValueError):
    """The manifest is not the shape this mode reads; nothing has been transcribed or written."""


@dataclass(frozen=True)
class Take:
    """One take's range of its source file, in source seconds."""

    item_guid: str
    take_guid: str
    source_file: str
    start_offset: float
    length: float


@dataclass(frozen=True)
class Manifest:
    chapter_id: str
    first_unit: int
    last_unit: int
    takes: tuple[Take, ...]


Transcriber = Callable[[Take], Sequence[take_divergence.Word]]
"""Transcribes one take's range: words timed in seconds from the start of that range."""


# ---------------------------------------------------------------------------
# the manifest


def _keys(raw: object, expected: frozenset[str], where: str) -> dict:
    if not isinstance(raw, dict):
        raise ManifestError(f"{where} is not an object")
    missing = sorted(expected - raw.keys())
    unknown = sorted(raw.keys() - expected)
    if missing or unknown:
        raise ManifestError(f"{where}: missing {missing}, unknown {unknown}")
    return raw


def _whole(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _seconds(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _take(raw: object, position: int) -> Take:
    where = f"manifest take {position}"
    raw = _keys(raw, _TAKE_KEYS, where)
    for key in ("itemGuid", "takeGuid", "sourceFile"):
        if not isinstance(raw[key], str) or not raw[key]:
            raise ManifestError(f"{where}: {key} must be a non-empty string")
    if not _seconds(raw["startOffset"]) or raw["startOffset"] < 0:
        raise ManifestError(f"{where}: startOffset must be a finite number of seconds, 0 or more")
    if not _seconds(raw["length"]) or raw["length"] <= 0:
        raise ManifestError(f"{where}: length must be a finite number of seconds above 0")
    return Take(raw["itemGuid"], raw["takeGuid"], raw["sourceFile"], float(raw["startOffset"]), float(raw["length"]))


def read_manifest(path: str | os.PathLike) -> Manifest:
    """The manifest, checked field by field; takes keep manifest order."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError) as exc:
        raise ManifestError(f"The take-divergence manifest could not be read: {exc}") from exc
    data = _keys(data, _MANIFEST_KEYS, "The take-divergence manifest")
    if data["schemaVersion"] != MANIFEST_SCHEMA_VERSION:
        raise ManifestError(f"The take-divergence manifest is not schema version {MANIFEST_SCHEMA_VERSION}")
    if not isinstance(data["chapterId"], str) or not data["chapterId"]:
        raise ManifestError("The manifest's chapterId must be a non-empty string")
    span = _keys(data["span"], _SPAN_KEYS, "The manifest's span")
    if not (_whole(span["firstUnit"]) and _whole(span["lastUnit"]) and span["firstUnit"] <= span["lastUnit"]):
        raise ManifestError("The manifest's span must be two whole sentence numbers, firstUnit <= lastUnit")
    if not isinstance(data["takes"], list) or not data["takes"]:
        raise ManifestError("The manifest's takes must be a non-empty list")
    takes = tuple(_take(raw, position) for position, raw in enumerate(data["takes"]))
    return Manifest(data["chapterId"], span["firstUnit"], span["lastUnit"], takes)


# ---------------------------------------------------------------------------
# running


def _find_chapter(engine: ModuleType, manuscript: str, chapter_id: str) -> dict:
    for chapter in engine.load_manuscript_chapters(manuscript):
        if chapter["id"] == chapter_id:
            return chapter
    raise ValueError(f"The manuscript has no narratable chapter with id '{chapter_id}'")


def _project_hints(engine: ModuleType, manuscript: str) -> str | None:
    """The project's vocabulary hints (Whisper hotwords), read as the compare run reads them."""
    path = engine.project_data_path(manuscript, "vocabulary_hints.txt")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def _register_equivalences(engine: ModuleType, manuscript: str) -> None:
    """The project's equivalences.csv, registered before anything tokenizes (as every mode does)."""
    groups = engine.load_equivalence_groups(engine.project_data_path(manuscript, "equivalences.csv"))
    if groups:
        engine._CUSTOM_CANON.update(engine._build_canon(groups))
        engine.log(f"Loaded {len(groups)} custom word equivalence group(s)")


def whisper_transcriber(engine: ModuleType, args, hotwords: str | None) -> Transcriber:
    """Decode a take's range and transcribe it with word timestamps (ADR 0008's words)."""

    def transcribe(take: Take) -> Sequence[take_divergence.Word]:
        audio = engine.decode_segment(take.source_file, take.start_offset, take.length)
        return engine.transcribe(audio, args.model, args.language, args.device, hotwords=hotwords, model_dir=args.model_dir)

    return transcribe


def _take_line(index: int, take: Take, alignment: take_divergence.TakeAlignment) -> str:
    payload = {
        "index": index,
        "itemGuid": take.item_guid,
        "takeGuid": take.take_guid,
        "sourceFile": take.source_file,
        "startOffset": take.start_offset,
        "length": take.length,
        **take_divergence.to_json(alignment, take.start_offset),
    }
    return "TAKE_DIVERGENCE|" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


def _write_atomically(path: str, text: str) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def run(args, engine: ModuleType, transcriber: Transcriber | None = None) -> None:
    """Align every take in the manifest to its span and write the results file."""
    progress = args.progress
    engine.write_progress(progress, "START", 0, "Starting...")
    manifest = read_manifest(args.manifest)
    _register_equivalences(engine, args.manuscript)

    engine.check_cancelled(progress)
    engine.write_progress(progress, "MATCH", MATCH_PCT, "Finding the span in the manuscript...")
    chapter = _find_chapter(engine, args.manuscript, manifest.chapter_id)
    span = take_divergence.build_span(engine, chapter["paragraphs"], manifest.first_unit, manifest.last_unit)
    transcriber = transcriber or whisper_transcriber(engine, args, _project_hints(engine, args.manuscript))

    lines = []
    count = len(manifest.takes)
    for index, take in enumerate(manifest.takes):
        engine.check_cancelled(progress)
        pct = TRANSCRIBE_START_PCT + (TRANSCRIBE_END_PCT - TRANSCRIBE_START_PCT) * index // count
        engine.write_progress(progress, "TRANSCRIBE", pct, f"Transcribing take {index + 1}/{count}")
        engine.log(f"Take {index}: {take.take_guid} ({take.source_file} [{take.start_offset:.2f}s, {take.length:.2f}s])")
        words = transcriber(take)
        engine.check_cancelled(progress)
        lines.append(_take_line(index, take, take_divergence.align_take(engine, span, words)))

    engine.write_progress(progress, "WRITE", WRITE_PCT, "Writing results...")
    header = {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "chapterId": chapter["id"],
        "chapterTitle": chapter["title"],
        "span": take_divergence.span_json(span),
        "model": args.model,
        "language": args.language,
    }
    title = engine.display_title(chapter["title"])
    summary = f"SUMMARY|Aligned {count} take(s) to sentences {span.first_unit}-{span.last_unit} of '{engine.clean_marker_field(title)}'\n"
    _write_atomically(args.out, summary + "DIVERGENCE_SPAN|" + json.dumps(header, ensure_ascii=False, separators=(",", ":")) + "\n" + "".join(lines))
    engine.log(f"Wrote {count} take divergence row(s) to {args.out}")
    engine.write_progress(progress, "DONE", 100, "Finished")


def main(ap, args, engine: ModuleType, transcriber: Transcriber | None = None) -> int:
    """`--take-divergence`: check its own arguments, run, and return the exit code."""
    missing = [name for name, value in [("--manifest", args.manifest), ("--out", args.out)] if not value]
    if missing:
        ap.error(", ".join(missing) + " required with --take-divergence")
    for flag, given in [("--find-repeats", args.find_repeats), ("--chunk-seconds", args.chunk_seconds), ("--extract-hints", args.extract_hints)]:
        if given:
            ap.error(f"{flag} cannot be used with --take-divergence")
    try:
        run(args, engine, transcriber)
    except engine.Cancelled:
        engine.log("Cancelled by user.")
        engine.write_progress(args.progress, "CANCELLED", 0, "Cancelled by user")
        with contextlib.suppress(OSError):  # only a progress file can ask for a cancel
            os.remove(args.progress + ".cancel")
        return EXIT_CANCELLED
    except Exception as exc:  # noqa: BLE001 - every failure is reported the same way: an ERROR progress line
        engine.log(traceback.format_exc())
        engine.write_progress(args.progress, "ERROR", 0, str(exc))
        return EXIT_FAILED
    return EXIT_DONE
