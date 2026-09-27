"""The sidecar's recording-coverage mode: `compare.py --coverage`.

docs/utilities/recording-coverage.md and ADR 0127. For one chapter and the items
the host lists in a JSON manifest (active takes only, in play order; muted items are listed and
skipped, Q5 and Q10), this mode:

1. reuses each item's words file when it covers the item's played range, and otherwise decodes
   and transcribes that range and writes the words file atomically (temporary file, then rename),
   so a cancelled run keeps every item it finished;
2. joins the items' words in play order and aligns the chapter to them with the take markers' own
   alignment (`compare.diff_and_build_markers`, ADR 0126), the title and subtitle as optional
   heading tokens (Q11);
3. writes the measurements, never a verdict (the narrator's thresholds are applied later, on
   read, by the host), as tagged lines with one JSON object each: `COVERAGE|` (the chapter),
   `COVERAGE_ITEM|` (one per manifest item), `COVERAGE_PARAGRAPH|` and `COVERAGE_REGION|`; then
   the word alignment the edit and proof workspace reads (PRD Phase 1, ADR 0242): one
   `COVERAGE_TOKEN|` per chapter token and one `COVERAGE_EXTRA|` per run of words heard that the
   chapter does not account for. The results file is written atomically, so it exists only when
   the run finished.

With `--align-only` the mode never transcribes: it re-aligns from the words files alone and fails
before decoding anything when an item's words do not cover its played range (EP3 C). A plain check,
`--align-only` included, refuses to reuse a words file another model made (`covers`), so a model
change is a re-transcription, never a silent stale reuse.

`--recheck <windows.json>` is a separate, windows-only mode (`run_recheck`, model cascade Phase 3):
instead of the manifest and chapter above, it takes a checked list of windows, each bounded audio
in one item's source and the words file to update, transcribes each with `--model` (one model load
for the run) and splices the result into that words file (`splice_window`), reattributing the
range's model provenance in a new, additive `spans` list. It touches no manifest, chapter or
timeline, and writes no results file.

Progress is `stage|pct|message` in the usual file (START, DECODE, LOAD, TRANSCRIBE, ALIGN, WRITE,
DONE; `--recheck` never reaches ALIGN or WRITE), and TRANSCRIBE moves with the seconds transcribed
over the seconds that need transcribing (ADR 0015). Exit codes, set by `compare.main`: 0 the results
file is complete (or, for `--recheck`, every window spliced); 1 failed (an `ERROR|0|<message>`
progress line, no results file); 2 cancelled through `<progress>.cancel` (a `CANCELLED` progress
line, no results file, finished words files kept). Python's `argparse` also exits with 2 on a usage
error, with no progress line.

This module does not import `compare.py`: `run` is handed the loaded module as `engine`, so the
mode uses exactly the tokenizing, decoding and alignment of the process it runs in.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from types import ModuleType

import recording_coverage as coverage_model

MANIFEST_SCHEMA_VERSION = 1
WORDS_SCHEMA_VERSION = 1
WINDOWS_SCHEMA_VERSION = 1
RESULT_SCHEMA_VERSION = 1

TRANSCRIBE_START_PCT = 2
TRANSCRIBE_END_PCT = 94
ALIGN_PCT = 95
WRITE_PCT = 98

RANGE_TOLERANCE_SECONDS = 0.001
"""How far a cached range may fall short of a played range and still cover it (float rounding)."""

WORDS_FILE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}")
"""A words file is named by the host's cache key: a plain file name, never a path."""

_MANIFEST_ITEM_KEYS = frozenset({"index", "itemGuid", "sourceFile", "startOffset", "length", "wordsFile", "muted"})
_WINDOW_KEYS = frozenset({"itemIndex", "itemGuid", "sourceFile", "wordsFile", "start", "end"})

Word = tuple[str, float, float]


class ManifestError(ValueError):
    """The manifest is not the shape this mode reads; nothing has been read or written yet."""


class AlignOnlyError(ValueError):
    """Align-only was asked for, but an item's words are not cached for its played range."""


class WindowsError(ValueError):
    """The windows file (`--recheck`) is not the shape this mode reads, or names a words file
    with nothing cached to splice into; nothing has been read or written yet."""


@dataclass(frozen=True)
class ManifestItem:
    """One item's active take: the played range of its source, in source seconds."""

    index: int
    item_guid: str
    source_file: str
    start_offset: float
    length: float
    words_file: str
    muted: bool

    @property
    def end(self) -> float:
        return self.start_offset + self.length


@dataclass(frozen=True)
class Span:
    """One range of a words file attributed to one model (model cascade Phase 3): `[start, end]`
    in the file's own source seconds. A plain file (never spliced by `--recheck`) carries none;
    `spans_or_default` gives it one span, the whole file under its `model`."""

    start: float
    end: float
    model: str


@dataclass(frozen=True)
class ItemWords:
    """A words file: the words said in `[source_start, source_end]` of a source, in source seconds,
    and what shaped them (Q7, Q13: model and language label a result, they do not invalidate it).
    `model` stays the file's original transcription for compatibility; `spans` is empty unless a
    `--recheck` splice has given ranges of the file to another model."""

    words: tuple[Word, ...]
    source_start: float
    source_end: float
    model: str
    language: str | None
    hotwords_hash: str | None
    spans: tuple[Span, ...] = ()

    def spans_or_default(self) -> tuple[Span, ...]:
        return self.spans or (Span(self.source_start, self.source_end, self.model),)


Transcriber = Callable[[ManifestItem, Callable[[float], None]], ItemWords]
"""Transcribes one item's played range; calls back with the seconds of it done so far."""


# ---------------------------------------------------------------------------
# the manifest


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _manifest_item(raw: object, position: int) -> ManifestItem:
    where = f"manifest item {position}"
    if not isinstance(raw, dict):
        raise ManifestError(f"{where} is not an object")
    missing = sorted(_MANIFEST_ITEM_KEYS - raw.keys())
    unknown = sorted(raw.keys() - _MANIFEST_ITEM_KEYS)
    if missing or unknown:
        raise ManifestError(f"{where}: missing {missing}, unknown {unknown}")
    index = raw["index"]
    if not isinstance(index, int) or isinstance(index, bool) or index < 0:
        raise ManifestError(f"{where}: index must be a whole number, 0 or more")
    for key in ("itemGuid", "sourceFile"):
        if not isinstance(raw[key], str) or not raw[key]:
            raise ManifestError(f"{where}: {key} must be a non-empty string")
    if not _number(raw["startOffset"]) or raw["startOffset"] < 0:
        raise ManifestError(f"{where}: startOffset must be a finite number of seconds, 0 or more")
    if not _number(raw["length"]) or raw["length"] <= 0:
        raise ManifestError(f"{where}: length must be a finite number of seconds above 0")
    if not isinstance(raw["wordsFile"], str) or not WORDS_FILE_NAME.fullmatch(raw["wordsFile"]):
        raise ManifestError(f"{where}: wordsFile must be a plain file name (letters, digits, '.', '_', '-')")
    if not isinstance(raw["muted"], bool):
        raise ManifestError(f"{where}: muted must be true or false")
    return ManifestItem(index, raw["itemGuid"], raw["sourceFile"], float(raw["startOffset"]), float(raw["length"]), raw["wordsFile"], raw["muted"])


def read_manifest(path: str | os.PathLike) -> tuple[ManifestItem, ...]:
    """The manifest's items in play order (by index), checked field by field. The host writes it
    (a trust boundary: `docs/architecture/threat-model.md` row 4e)."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError) as exc:
        raise ManifestError(f"The coverage manifest could not be read: {exc}") from exc
    if not isinstance(data, dict) or data.get("schemaVersion") != MANIFEST_SCHEMA_VERSION:
        raise ManifestError(f"The coverage manifest is not schema version {MANIFEST_SCHEMA_VERSION}")
    raw_items = data.get("items")
    if not isinstance(raw_items, list):
        raise ManifestError("The coverage manifest's items must be a list")
    if not raw_items:
        raise ManifestError("The coverage manifest has no items")
    items = [_manifest_item(raw, position) for position, raw in enumerate(raw_items)]
    seen: set[int] = set()
    for item in items:
        if item.index in seen:
            raise ManifestError(f"The coverage manifest lists item index {item.index} twice")
        seen.add(item.index)
    return tuple(sorted(items, key=lambda item: item.index))


# ---------------------------------------------------------------------------
# words files


def text_hash(text: str | None) -> str | None:
    return None if text is None else "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _file_hash(path: str) -> str:
    return "sha256:" + hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _parse_words(data: object) -> ItemWords | None:
    if not isinstance(data, dict) or data.get("schemaVersion") != WORDS_SCHEMA_VERSION:
        return None
    transcription = data.get("transcription")
    words = data.get("words")
    if not (_number(data.get("sourceStart")) and _number(data.get("sourceEnd")) and isinstance(words, list) and isinstance(transcription, dict)):
        return None
    if not isinstance(transcription.get("model"), str):
        return None
    if not all(isinstance(word, list) and len(word) == 3 and isinstance(word[0], str) and _number(word[1]) and _number(word[2]) for word in words):
        return None
    spans_raw = data.get("spans", [])
    if not isinstance(spans_raw, list) or not all(
        isinstance(s, dict) and _number(s.get("start")) and _number(s.get("end")) and isinstance(s.get("model"), str) for s in spans_raw
    ):
        return None
    language = transcription.get("language")
    hotwords = transcription.get("hotwordsHash")
    return ItemWords(
        tuple((word[0], float(word[1]), float(word[2])) for word in words),
        float(data["sourceStart"]),
        float(data["sourceEnd"]),
        transcription["model"],
        language if isinstance(language, str) else None,
        hotwords if isinstance(hotwords, str) else None,
        tuple(Span(float(s["start"]), float(s["end"]), s["model"]) for s in spans_raw),
    )


def read_words_file(path: str | os.PathLike) -> ItemWords | None:
    """A words file, or None when it is absent, unreadable, or not this schema: every one of those
    is a cache miss that costs a transcription, never an error."""
    try:
        return _parse_words(json.loads(Path(path).read_text(encoding="utf-8")))
    except (OSError, ValueError, RecursionError):
        return None


def _write_atomically(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def write_words_file(path: str | os.PathLike, words: ItemWords) -> None:
    payload = {
        "schemaVersion": WORDS_SCHEMA_VERSION,
        "sourceStart": words.source_start,
        "sourceEnd": words.source_end,
        "words": [list(word) for word in words.words],
        "transcription": {"model": words.model, "language": words.language, "hotwordsHash": words.hotwords_hash, "vadFilter": True},
    }
    if words.spans:
        payload["spans"] = [{"start": span.start, "end": span.end, "model": span.model} for span in words.spans]
    _write_atomically(Path(path), json.dumps(payload, ensure_ascii=False) + "\n")


def covers(words: ItemWords, item: ManifestItem, model: str | None = None) -> bool:
    """Whether a words file transcribed all of the item's played range. A trim that narrows the
    range keeps it; a trim that widens it needs a new transcription. With `model` given, a plain
    re-check also refuses to reuse a words file another model made (the windows-only `--recheck`
    path never calls this with a model: it splices unconditionally, model mismatch or not)."""
    in_range = words.source_start <= item.start_offset + RANGE_TOLERANCE_SECONDS and words.source_end >= item.end - RANGE_TOLERANCE_SECONDS
    return in_range and (model is None or words.model == model)


def played_words(words: ItemWords, item: ManifestItem) -> list[Word]:
    """The words whose midpoint lies in the item's played range."""
    return [word for word in words.words if item.start_offset <= (word[1] + word[2]) / 2 <= item.end]


# ---------------------------------------------------------------------------
# transcription


def _load_whisper_model(model_size: str, model_dir: str | None, device: str):  # pragma: no cover - needs a Whisper model
    from faster_whisper import WhisperModel

    # model_dir is the host's hash-verified asset directory; local_files_only keeps faster-whisper
    # off the network, as compare.transcribe does (threat-model row 1a).
    compute_type = "int8" if device == "cpu" else "float16"
    return WhisperModel(model_dir or model_size, device=device, compute_type=compute_type, local_files_only=bool(model_dir))


class WhisperTranscriber:
    """Decodes an item's played range and transcribes it with one Whisper model, loaded on first use
    (an all-cached run never loads it) and kept for the rest of the run."""

    def __init__(self, engine: ModuleType, *, model_size: str, language: str | None, hotwords: str | None, model_factory: Callable[[], object]):
        self._engine = engine
        self._model_size = model_size
        self._language = language
        self._hotwords = hotwords
        self._factory = model_factory
        self._model = None

    def __call__(self, item: ManifestItem, on_seconds: Callable[[float], None]) -> ItemWords:
        audio = self._engine.decode_segment(item.source_file, item.start_offset, item.length)
        if self._model is None:
            self._model = self._factory()
        segments, info = self._model.transcribe(audio, language=self._language, word_timestamps=True, vad_filter=True, hotwords=self._hotwords or None)
        words: list[Word] = []
        for segment in segments:
            for word in segment.words or ():
                words.append((word.word.strip(), round(item.start_offset + word.start, 3), round(item.start_offset + word.end, 3)))
            on_seconds(min(segment.end, item.length))
        return ItemWords(tuple(words), item.start_offset, item.end, self._model_size, info.language, text_hash(self._hotwords))


# ---------------------------------------------------------------------------
# the run


class _Progress:
    """Progress that never moves backwards, and TRANSCRIBE from seconds done over seconds to do."""

    def __init__(self, engine: ModuleType, path: str | None, total_seconds: float):
        self._engine = engine
        self._path = path
        self._total = total_seconds
        self.done = 0.0
        self._pct = 0

    def report(self, stage: str, pct: int, message: str) -> None:
        self._pct = max(self._pct, pct)
        self._engine.write_progress(self._path, stage, self._pct, message)

    def transcribed(self, seconds: float, message: str) -> None:
        share = min(1.0, seconds / self._total) if self._total > 0 else 1.0
        self.report("TRANSCRIBE", TRANSCRIBE_START_PCT + int((TRANSCRIBE_END_PCT - TRANSCRIBE_START_PCT) * share), message)

    @property
    def pct(self) -> int:
        return self._pct


@dataclass(frozen=True)
class _ItemResult:
    item: ManifestItem
    source: str | None  # "reused", "transcribed", or None for a muted item
    words: ItemWords | None
    played: tuple[Word, ...]


def _alignment_params(args) -> coverage_model.AlignmentParams:
    overrides = {name: getattr(args, name) for name in ("max_misread_run", "min_anchor_run") if getattr(args, name, None) is not None}
    return coverage_model.AlignmentParams(**overrides)


def _chapter(engine: ModuleType, manuscript: str, chapter_id: str) -> dict:
    for chapter in engine.load_manuscript_chapters(manuscript):
        if chapter["id"] == chapter_id:
            return chapter
    raise ValueError(f"Chapter '{chapter_id}' is not a narration chapter of the manuscript.")


def _words_for(item: ManifestItem, path: Path, transcriber: Transcriber, progress: _Progress, engine: ModuleType, args, label: str) -> _ItemResult:
    """Reuse the item's words file if it covers the item with this run's model, otherwise
    transcribe and write it."""
    cached = read_words_file(path)
    if cached is not None and covers(cached, item, args.model):
        return _ItemResult(item, "reused", cached, tuple(played_words(cached, item)))
    engine.check_cancelled(args.progress)
    progress.report("DECODE", progress.pct, f"Decoding item {label}...")
    start = progress.done

    def on_seconds(seconds: float) -> None:
        engine.check_cancelled(args.progress)
        done = min(max(seconds, 0.0), item.length)
        progress.transcribed(start + done, f"Transcribing item {label}... {engine.format_time(done)} / {engine.format_time(item.length)}")

    words = transcriber(item, on_seconds)
    write_words_file(path, words)
    progress.done = start + item.length
    progress.transcribed(progress.done, f"Transcribed item {label}")
    return _ItemResult(item, "transcribed", words, tuple(played_words(words, item)))


def _collect_words(items: Sequence[ManifestItem], words_dir: Path, transcriber: Transcriber, engine: ModuleType, args) -> list[_ItemResult]:
    playing = [item for item in items if not item.muted]
    pending = []
    for item in playing:
        hit = _is_covered(words_dir, item, args.model)
        engine.log("checked the item's cached words", level="debug", event="coverage.cache", item_index=item.index, item_guid=item.item_guid, hit=hit)
        if not hit:
            pending.append(item)
    progress = _Progress(engine, args.progress, sum(item.length for item in pending))
    results = {item.index: _ItemResult(item, None, None, ()) for item in items if item.muted}
    for position, item in enumerate(playing):
        engine.check_cancelled(args.progress)
        label = f"{pending.index(item) + 1}/{len(pending)}" if item in pending else f"{position + 1}"
        result = _words_for(item, words_dir / item.words_file, transcriber, progress, engine, args, label)
        if item in pending and result.source == "reused":  # another item wrote its words file first
            progress.done += item.length
            progress.transcribed(progress.done, f"Reused the words of item {label}")
        results[item.index] = result
    engine.check_cancelled(args.progress)
    progress.report("ALIGN", ALIGN_PCT, "Aligning the chapter to the recording...")
    return [results[item.index] for item in items]


def _is_covered(words_dir: Path, item: ManifestItem, model: str) -> bool:
    cached = read_words_file(words_dir / item.words_file)
    return cached is not None and covers(cached, item, model)


@dataclass(frozen=True)
class _Timeline:
    """The analyzed items' words joined in play order, each item starting where the last one ended."""

    words: list[Word]
    starts: list[tuple[float, ManifestItem]]  # (joined time the item starts at, item)
    word_items: list[tuple[float, ManifestItem]]  # per word: (joined time its item starts at, its item)

    def position(self, joined_time: float) -> dict:
        start, item = self.starts[0]
        for candidate_start, candidate in self.starts:
            if candidate_start <= joined_time:
                start, item = candidate_start, candidate
        return {"itemIndex": item.index, "itemGuid": item.item_guid, "sourceTime": round(item.start_offset + joined_time - start, 3)}

    def word_edge(self, word_index: int, edge: int) -> dict:
        """A word's start (`edge` 1) or end (2) in its own item's source: unlike `position`, a word
        ending exactly where the next item starts stays in its own item."""
        start, item = self.word_items[word_index]
        return {"itemIndex": item.index, "itemGuid": item.item_guid, "sourceTime": round(item.start_offset + self.words[word_index][edge] - start, 3)}


def _timeline(results: Sequence[_ItemResult]) -> _Timeline:
    words: list[Word] = []
    starts: list[tuple[float, ManifestItem]] = []
    word_items: list[tuple[float, ManifestItem]] = []
    offset = 0.0
    for result in results:
        if result.source is None:
            continue
        starts.append((offset, result.item))
        shift = offset - result.item.start_offset
        words.extend((text, start + shift, end + shift) for text, start, end in result.played)
        word_items.extend([(offset, result.item)] * len(result.played))
        offset += result.item.length
    return _Timeline(words, starts, word_items)


def _region_position(region: coverage_model.Region, alignment: dict, timeline: _Timeline) -> dict | None:
    """Where the missing text would sit in the audio: the start of the transcript word at the
    region's audio index, or the end of the last word for a region after everything said."""
    index_map = alignment["index_map"]
    if not timeline.words:
        return None
    if region.audio_index < len(index_map):
        return timeline.position(timeline.words[index_map[region.audio_index]][1])
    return timeline.position(timeline.words[-1][2])


def _region_bounds(region: coverage_model.Region, alignment: dict, timeline: _Timeline) -> tuple[dict | None, dict | None]:
    """Where the missing text is bounded in the audio: the end of the last matched word before the
    region and the start of the first matched word after it, each in its own item's source seconds,
    or None where the region has no matched word on that side (a head, a tail, nothing said)."""
    index_map = alignment["index_map"]
    before = timeline.word_edge(index_map[region.audio_before], 2) if region.audio_before is not None else None
    after = timeline.word_edge(index_map[region.audio_after], 1) if region.audio_after is not None else None
    return before, after


def _line(tag: str, payload: dict) -> str:
    return f"{tag}|{json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}\n"


def _item_line(result: _ItemResult) -> dict:
    words = result.words
    return {
        "index": result.item.index,
        "itemGuid": result.item.item_guid,
        "status": "muted" if result.item.muted else "analyzed",
        "words": result.source,
        "playedSeconds": result.item.length,
        "wordCount": len(result.played),
        "model": words.model if words else None,
        "language": words.language if words else None,
    }


def _report(
    chapter: dict, coverage: coverage_model.ChapterCoverage, results: Sequence[_ItemResult], alignment: dict, timeline: _Timeline, analysis: dict
) -> str:
    analyzed = [result for result in results if result.source is not None]
    summary = {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "chapterId": chapter["id"],
        "bodyTokens": coverage.body_tokens,
        "presentTokens": coverage.present_tokens,
        "missingTokens": coverage.missing_tokens,
        "extraTokens": coverage.extra_tokens,
        "longestMissingRun": coverage.longest_missing_run,
        "alignment": {"maxMisreadRun": coverage.params.max_misread_run, "minAnchorRun": coverage.params.min_anchor_run},
        "items": {
            "analyzed": len(analyzed),
            "muted": len(results) - len(analyzed),
            "playedSeconds": round(sum(result.item.length for result in analyzed), 3),
            "transcribed": sum(result.source == "transcribed" for result in analyzed),
            "reused": sum(result.source == "reused" for result in analyzed),
        },
        "analysis": analysis,
    }
    lines = [_line("COVERAGE", summary)]
    lines += [_line("COVERAGE_ITEM", _item_line(result)) for result in results]
    lines += [
        _line("COVERAGE_PARAGRAPH", {"id": p.id, "tokens": p.tokens, "present": p.present, "longestMissingRun": p.longest_missing_run})
        for p in coverage.paragraphs
    ]
    for region in coverage.regions:
        before, after = _region_bounds(region, alignment, timeline)
        payload = {
            "kind": region.kind,
            "paragraphIds": list(region.paragraph_ids),
            "tokenCount": region.token_count,
            "firstWord": region.first_word,
            "lastWord": region.last_word,
            "position": _region_position(region, alignment, timeline),
            "before": before,
            "after": after,
        }
        lines.append(_line("COVERAGE_REGION", payload))
    return "".join(lines)


def _token_words(engine: ModuleType, heading: str, paragraphs: Sequence[str]) -> list[tuple[int, int]]:
    """Per chapter token, in `build_chapter_units`' order: its paragraph index (HEADING for the
    title and subtitle) and the ordinal of the whitespace word it came from in that paragraph's
    text (or the heading's), so a screen finds the word with `text.split()[w]`, never re-tokenizing.
    A word with no token (a lone dash) still counts; a word with several tokens repeats."""
    out = [(coverage_model.HEADING, n) for n, raw in enumerate(heading.split()) for _ in engine.tokenize(raw)]
    counters: dict[int, int] = {}
    for sentence, paragraph in engine.build_sentence_units(paragraphs):
        for raw in sentence.split():
            ordinal = counters.get(paragraph, 0)
            counters[paragraph] = ordinal + 1
            out.extend((paragraph, ordinal) for _ in engine.tokenize(raw))
    return out


def _alignment_lines(aligned: coverage_model.AlignedChapter, alignment: dict, timeline: _Timeline, words: Sequence[tuple[int, int]], params) -> list[str]:
    """The COVERAGE_TOKEN and COVERAGE_EXTRA lines: each token's word, status and where it was heard
    (item index and source seconds), and each run of extra words with the token it follows."""
    tokens, extras = coverage_model.align_tokens(aligned, params)
    index_map = alignment["index_map"]
    original = alignment["chapter_index_map"]
    lines = []
    for i, token in enumerate(tokens):
        paragraph, ordinal = words[original[i]]
        payload = {
            "i": i,
            "p": None if paragraph == coverage_model.HEADING else aligned.paragraph_ids[paragraph],
            "w": ordinal,
            "text": aligned.doc_words[i],
            "status": token.status,
            "heard": None,
            "item": None,
            "start": None,
            "end": None,
        }
        if token.audio is not None:
            word = index_map[token.audio]
            start, end = timeline.word_edge(word, 1), timeline.word_edge(word, 2)
            payload.update(item=start["itemIndex"], start=start["sourceTime"], end=end["sourceTime"])
            if token.status == coverage_model.MISREAD:
                payload["heard"] = timeline.words[word][0]
        lines.append(_line("COVERAGE_TOKEN", payload))
    heard_at = [(token.audio, i) for i, token in enumerate(tokens) if token.audio is not None]
    for start, end in extras:
        first, last = index_map[start], index_map[end - 1]
        before = [i for audio, i in heard_at if audio < start]
        payload = {
            "text": " ".join(timeline.words[k][0] for k in range(first, last + 1)),
            "tokens": end - start,
            "start": timeline.word_edge(first, 1),
            "end": timeline.word_edge(last, 2),
            "afterToken": before[-1] if before else None,
        }
        lines.append(_line("COVERAGE_EXTRA", payload))
    return lines


def _require_cached(items: Sequence[ManifestItem], words_dir: Path, model: str) -> None:
    missing = [item for item in items if not item.muted and not _is_covered(words_dir, item, model)]
    if missing:
        raise AlignOnlyError(
            f"Align again needs every item's words, but item {missing[0].index} has none cached for the part it plays. Run the recording check to transcribe it."
        )


def _refuse_transcription(item: ManifestItem, on_seconds: Callable[[float], None]) -> ItemWords:
    raise AlignOnlyError(f"Align again never transcribes, and item {item.index}'s words are not cached for the part it plays.")


def _default_transcriber(engine: ModuleType, args) -> Transcriber:
    progress_path = args.progress

    def factory():  # pragma: no cover - needs a Whisper model
        engine.write_progress(progress_path, "LOAD", TRANSCRIBE_START_PCT, f"Loading Whisper model '{args.model}'...")
        return _load_whisper_model(args.model, args.model_dir, args.device)

    return WhisperTranscriber(
        engine, model_size=args.model, language=args.language, hotwords=engine.load_vocabulary_hints(args.manuscript), model_factory=factory
    )


def run(args, engine: ModuleType, transcriber: Transcriber | None = None) -> None:
    """The coverage mode. Raises `engine.Cancelled` on cancel; any other exception is a failure."""
    out = Path(args.out)
    out.unlink(missing_ok=True)  # a results file left from an earlier run must not pass for this one
    engine.write_progress(args.progress, "START", 0, "Starting...")
    engine.check_cancelled(args.progress)
    params = _alignment_params(args)
    items = read_manifest(args.manifest)
    equivalences = engine.register_project_equivalences(args.manuscript)
    chapter = _chapter(engine, args.manuscript, args.chapter_id)
    if getattr(args, "align_only", False):
        _require_cached(items, Path(args.words_dir), args.model)
        transcriber = _refuse_transcription

    results = _collect_words(items, Path(args.words_dir), transcriber or _default_transcriber(engine, args), engine, args)

    timeline = _timeline(results)
    heading = " ".join(part for part in (chapter["title"], chapter.get("subtitle") or "") if part)
    sentence_units, tokens, unit_idx, raw_words = engine.build_chapter_units({"title": heading, "paragraphs": chapter["paragraphs"]})
    _markers, _covered, alignment = engine.diff_and_build_markers(tokens, unit_idx, raw_words, timeline.words, 1)
    aligned = coverage_model.aligned_chapter_from_markers(alignment, sentence_units, chapter["paragraph_ids"])
    coverage = coverage_model.compute_coverage(aligned, params)
    words = _token_words(engine, heading, chapter["paragraphs"])
    if len(words) != len(raw_words):
        raise ValueError(f"The chapter's words could not be matched to its tokens ({len(words)} against {len(raw_words)}).")

    engine.check_cancelled(args.progress)
    engine.write_progress(args.progress, "WRITE", WRITE_PCT, "Writing results...")
    analysis = {"model": args.model, "language": args.language, "equivalencesHash": _file_hash(equivalences) if equivalences else None}
    report = _report(chapter, coverage, results, alignment, timeline, analysis) + "".join(_alignment_lines(aligned, alignment, timeline, words, params))
    _write_atomically(out, report)
    engine.log(f"Wrote the coverage of chapter {chapter['id']} to {out}")
    engine.write_progress(args.progress, "DONE", 100, "Finished")


# ---------------------------------------------------------------------------
# the windows-only recheck mode (model cascade Phase 3)


@dataclass(frozen=True)
class Window:
    """One window of audio to re-check with a stronger model, bounded by the words the first pass
    matched on either side of a missing region (planned by the host, model cascade Phase 4)."""

    item_index: int
    item_guid: str
    source_file: str
    words_file: str
    start: float
    end: float

    @property
    def length(self) -> float:
        return self.end - self.start


def _window(raw: object, position: int) -> Window:
    where = f"window {position}"
    if not isinstance(raw, dict):
        raise WindowsError(f"{where} is not an object")
    missing = sorted(_WINDOW_KEYS - raw.keys())
    unknown = sorted(raw.keys() - _WINDOW_KEYS)
    if missing or unknown:
        raise WindowsError(f"{where}: missing {missing}, unknown {unknown}")
    index = raw["itemIndex"]
    if not isinstance(index, int) or isinstance(index, bool) or index < 0:
        raise WindowsError(f"{where}: itemIndex must be a whole number, 0 or more")
    for key in ("itemGuid", "sourceFile"):
        if not isinstance(raw[key], str) or not raw[key]:
            raise WindowsError(f"{where}: {key} must be a non-empty string")
    if not isinstance(raw["wordsFile"], str) or not WORDS_FILE_NAME.fullmatch(raw["wordsFile"]):
        raise WindowsError(f"{where}: wordsFile must be a plain file name (letters, digits, '.', '_', '-')")
    if not _number(raw["start"]) or raw["start"] < 0:
        raise WindowsError(f"{where}: start must be a finite number of seconds, 0 or more")
    if not _number(raw["end"]) or raw["end"] <= raw["start"]:
        raise WindowsError(f"{where}: end must be a finite number of seconds after start")
    return Window(index, raw["itemGuid"], raw["sourceFile"], raw["wordsFile"], float(raw["start"]), float(raw["end"]))


def read_windows(path: str | os.PathLike) -> tuple[Window, ...]:
    """The `--recheck` windows file: what to re-transcribe and where to splice it, checked field by
    field before anything is opened, the same trust boundary as the manifest (threat-model row 4e)."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError) as exc:
        raise WindowsError(f"The coverage windows file could not be read: {exc}") from exc
    if not isinstance(data, dict) or data.get("schemaVersion") != WINDOWS_SCHEMA_VERSION:
        raise WindowsError(f"The coverage windows file is not schema version {WINDOWS_SCHEMA_VERSION}")
    raw_windows = data.get("windows")
    if not isinstance(raw_windows, list):
        raise WindowsError("The coverage windows file's windows must be a list")
    if not raw_windows:
        raise WindowsError("The coverage windows file has no windows")
    return tuple(_window(raw, position) for position, raw in enumerate(raw_windows))


def _drop_edge_words(words: Sequence[Word], start: float, end: float) -> list[Word]:
    """A window's own newly transcribed words, dropping any whose start or end touches the
    window's edge: the window's own decode may have cut such a word short, so it is never trusted
    over what was already there (a risk noted in the PRD's Architecture notes)."""
    return [word for word in words if word[1] > start and word[2] < end]


def _drop_replaced_words(words: Sequence[Word], start: float, end: float) -> list[Word]:
    """A words file's existing words, dropping those a window replaces: whichever midpoint falls
    inside `[start, end]`, the same membership rule `played_words` uses for an item's range."""
    return [word for word in words if not (start <= (word[1] + word[2]) / 2 <= end)]


def _overwrite_spans(spans: Sequence[Span], start: float, end: float, model: str) -> tuple[Span, ...]:
    """`spans`, a file's existing per-range model attribution, with `[start, end]` reassigned to
    `model`: a span the window covers wholly is dropped, one it straddles is split at the window's
    edge and the part outside the window keeps its own model."""
    kept: list[Span] = []
    for span in spans:
        if span.end <= start or span.start >= end:
            kept.append(span)
            continue
        if span.start < start:
            kept.append(Span(span.start, start, span.model))
        if span.end > end:
            kept.append(Span(end, span.end, span.model))
    kept.append(Span(start, end, model))
    return tuple(sorted(kept, key=lambda span: span.start))


def splice_window(existing: ItemWords, window: Window, new_words: Sequence[Word], model: str) -> ItemWords:
    """`existing` with `window`'s range re-checked: the words it replaced are gone, the window's
    own new words stand in for them (edge words dropped), and the range is reattributed to `model`
    in `spans` (model cascade Phase 3). `existing.model` is left as it was, for compatibility."""
    kept = _drop_replaced_words(existing.words, window.start, window.end)
    added = _drop_edge_words(new_words, window.start, window.end)
    words = tuple(sorted(kept + added, key=lambda word: word[1]))
    spans = _overwrite_spans(existing.spans_or_default(), window.start, window.end, model)
    return replace(existing, words=words, spans=spans)


def run_recheck(args, engine: ModuleType, transcriber: Transcriber | None = None) -> None:
    """The windows-only recheck mode (`--coverage --recheck`, model cascade Phase 3): transcribes
    only the given windows with `--model`, one model load for the run, and splices the new words
    into each affected words file. Touches no manifest, chapter or timeline, and writes no results
    file. Raises `engine.Cancelled` on cancel; any other exception is a failure."""
    engine.write_progress(args.progress, "START", 0, "Starting...")
    engine.check_cancelled(args.progress)
    windows = read_windows(args.recheck)
    words_dir = Path(args.words_dir)
    by_file: dict[str, list[Window]] = {}
    for window in windows:
        by_file.setdefault(window.words_file, []).append(window)
    for words_file in by_file:
        if read_words_file(words_dir / words_file) is None:
            raise WindowsError(f"The coverage windows file names {words_file!r}, which has no words cached to splice into.")

    transcribe = transcriber or _default_transcriber(engine, args)
    progress = _Progress(engine, args.progress, sum(window.length for window in windows))
    for words_file, file_windows in by_file.items():
        path = words_dir / words_file
        existing = read_words_file(path)
        for window in file_windows:
            engine.check_cancelled(args.progress)
            label = f"item {window.item_index}"
            progress.report("DECODE", progress.pct, f"Decoding the re-check window of {label}...")
            start = progress.done
            item = ManifestItem(window.item_index, window.item_guid, window.source_file, window.start, window.length, words_file, False)

            def on_seconds(seconds: float, _start=start, _length=window.length, _label=label) -> None:
                engine.check_cancelled(args.progress)
                done = min(max(seconds, 0.0), _length)
                progress.transcribed(_start + done, f"Re-checking {_label}... {engine.format_time(done)} / {engine.format_time(_length)}")

            result = transcribe(item, on_seconds)
            existing = splice_window(existing, window, result.words, args.model)
            progress.done = start + window.length
            progress.transcribed(progress.done, f"Re-checked {label}")
        write_words_file(path, existing)
    engine.check_cancelled(args.progress)
    engine.write_progress(args.progress, "DONE", 100, "Finished")
