"""
Transcribe one or more audio segments (items on a REAPER track), match them
against the correspondingly-named chapter in a canonical manuscript by track name,
diff the transcript against that chapter's text, and write take-marker
placements REAPER can import.

Usage:
    python compare.py --manifest segments.txt --manuscript "manuscript.json" \
        --track-name "Chapter 1" --out results.txt [--model base]

Manifest input format (pipe-delimited, no header):
    item_index|source_file|start_offset_seconds|length_seconds

Output format (pipe-delimited, tagged lines) - normally either a
NEED_CHAPTER line alone, or a SUMMARY/DIFF/MARKER* block:
    NEED_CHAPTER|<title1>|<title2>|...
    SUMMARY|<text>
    DIFF|<diff_file_path>
    MARKER|<item_index>|<srcpos_seconds>|<kind>|<name>|<doc_text>|<audio_text>

kind is one of MISREAD / SKIPPED / EXTRA. doc_text/audio_text may be empty
(e.g. SKIPPED has no audio_text, EXTRA has no doc_text). NEED_CHAPTER means
the track name didn't confidently match any heading - the caller should
re-invoke with --chapter-title set to one of the listed titles.
"""

import argparse
import difflib
import json
import multiprocessing
import os
import re
import sys
import time
import traceback
from pathlib import Path

import numpy as np

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "shared" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common.config import get_default  # noqa: E402
from narration_common import manuscript as canonical_manuscript  # noqa: E402
from narration_common.logging_utils import log, set_log_file  # noqa: E402
from narration_common.progress import write_progress  # noqa: E402

FILLER_WORDS = {"uh", "um", "umm", "uhh", "erm", "hmm", "mhm", "huh"}

TOKEN_RE = re.compile(r"[A-Za-z0-9']+")
SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+")
ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "mt"}

SAMPLE_RATE = 16000
PAUSE_GAP_SECONDS = 0.6
EXCERPT_TAIL_BUFFER_SENTENCES = 2

NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
    "hundred": 100,
    "thousand": 1000,
    "million": 1000000,
    "billion": 1000000000,
}


def format_time(seconds):
    seconds = max(0, int(seconds))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


class Cancelled(Exception):
    pass


class NeedsChapterSelection(Exception):
    """Raised when the track name didn't confidently match any chapter
    heading - not a failure, just a request for the caller to ask the user
    to pick one of `candidates` and re-invoke with --chapter-title."""

    def __init__(self, candidates):
        super().__init__("Needs an explicit chapter selection")
        self.candidates = candidates


def check_cancelled(progress_path):
    if not progress_path:
        return
    if os.path.exists(progress_path + ".cancel"):
        raise Cancelled()


_QUOTE_NORMALIZE_TABLE = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‛": "'",
        "ʼ": "'",
        "`": "'",
        "´": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        "‟": '"',
    }
)

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_equivalence_groups(path):
    """Groups of words to treat as equivalent when matching - one group
    per line, comma-separated, '#' starts a comment (whole-line or
    trailing). Shared shape/loader for the bundled homophones list
    (homophones.csv, next to this script) and a per-project custom list
    (see project_data_path). Missing file or bad lines are silently
    skipped (best-effort)."""
    groups = []
    if not path or not os.path.exists(path):
        return groups
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.split("#", 1)[0].strip()
                if not line:
                    continue
                words = [w.strip().lower() for w in line.split(",") if w.strip()]
                if len(words) >= 2:
                    groups.append(tuple(words))
    except OSError:
        pass
    return groups


def _build_canon(groups):
    return {w: g[0] for g in groups for w in g}


# Whisper sometimes transcribes a correctly-spoken homophone with the wrong
# spelling (heard "your", wrote "you're") - these aren't narration errors,
# so each group in homophones.csv is canonicalized to its first member
# before matching. Deliberately EXCLUDES one/won, to/too/two, for/four,
# ate/eight: each has a member that's also a NUMBER_WORDS entry, and
# merge_number_words() accumulates *consecutive* number words into one
# combined value (e.g. "twenty two" -> 22) - aliasing "won" to "one" could
# turn an unrelated adjacent number into a bogus merge (e.g. "she won two
# races" -> "she one two races" -> merged into a single garbage token).
_HOMOPHONE_CANON = _build_canon(load_equivalence_groups(os.path.join(_SCRIPT_DIR, "homophones.csv")))

# Populated per-run in run() from a per-manuscript custom list (invented
# names/words Whisper spells inconsistently, since it has no dictionary
# entry to guess from) - see project_data_path/load_equivalence_groups.
_CUSTOM_CANON = {}


def _load_word_set(path):
    """Flat set loader for a simple one-word-per-line stoplist (as opposed
    to load_equivalence_groups' comma-grouped format) - used below for the
    bundled common-words stoplist consulted by extract_hints()."""
    words = set()
    if not path or not os.path.exists(path):
        return words
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.split("#", 1)[0].strip().lower()
                if line:
                    words.add(line)
    except OSError:
        pass
    return words


# Ordinary words that happen to get capitalized mid-sentence (start of a
# quote, a title, after an em dash) - filtered out of extract_hints()'s
# suggestions so they lean toward actual invented names/terms.
_COMMON_WORDS = _load_word_set(os.path.join(_SCRIPT_DIR, "common_words.txt"))


def tokenize(text):
    """Typographic ("smart") quotes are normalized to ASCII before token
    extraction - a curly apostrophe (e.g. Word's "yesterday's") isn't in
    TOKEN_RE's character class, so left unnormalized it splits one word
    into two ("yesterday" + "s"), a false mismatch against Whisper's
    straight-apostrophe transcript that showed up as a bogus MISREAD
    (confirmed live). Double curly quotes are normalized too for
    consistency, though TOKEN_RE already drops all quote characters
    (straight or curly) either way, so that half is a no-op today.
    Homophones (built-in + per-manuscript custom) are canonicalized too -
    like number normalization, this only affects matching, so a genuine
    nearby misread's displayed snippet may show the canonical spelling
    rather than the literal word, same accepted tradeoff as "twenty
    three" already displaying as "23". A trailing possessive-'s is folded
    into a plain -s too - "sentinel's" and "sentinels" are pronounced
    identically for any word, so this is a general rule rather than a
    homophone-list entry."""
    text = text.translate(_QUOTE_NORMALIZE_TABLE)
    tokens = [t.lower() for t in TOKEN_RE.findall(text)]
    tokens = [_HOMOPHONE_CANON.get(t, t) for t in tokens]
    tokens = [t[:-2] + "s" if t.endswith("'s") and len(t) > 2 else t for t in tokens]
    tokens = [_CUSTOM_CANON.get(t, t) for t in tokens]
    return tokens


def project_data_dir(manuscript_path):
    """This tool's per-project metadata folder, next to the manuscript
    itself - houses the diff output and the custom word-equivalence list,
    derived by convention from --manuscript rather than a separate argument, so
    the caller (the REAPER script) never has to plumb an extra path
    through."""
    return str(Path(manuscript_path).resolve().parents[2] / "TranscriptCompare")


def project_data_path(manuscript_path, filename):
    return os.path.join(project_data_dir(manuscript_path), filename)


def tokenize_with_raw(text):
    """Like tokenize(), but also returns a parallel list of the original
    (un-normalized) word each token came from - lets a display layer
    substitute the manuscript's own formatting/casing/punctuation back in
    for a token confirmed to match the recording, instead of only ever
    being able to show a fully-normalized or fully-raw-Whisper rendering.
    A raw word that itself expands into multiple tokens repeats its raw
    form for each constituent token."""
    tokens = []
    raw_words = []
    for raw in text.split():
        for t in tokenize(raw):
            tokens.append(t)
            raw_words.append(raw)
    return tokens, raw_words


def merge_number_words(tokens, index_map):
    """Collapse runs of spelled-out cardinal numbers into a single digit
    token so e.g. "twenty three" lines up with a transcript's "23", and
    "one" lines up with "1". Digit tokens already present pass through
    unchanged. index_map (parallel to tokens) is carried through, pointing
    each output token at the index of its first constituent input token."""
    out_tokens = []
    out_index_map = []
    n = len(tokens)
    i = 0
    while i < n:
        if tokens[i] in NUMBER_WORDS:
            start = i
            total = 0
            chunk = 0
            j = i
            while j < n:
                tok = tokens[j]
                if tok in NUMBER_WORDS:
                    val = NUMBER_WORDS[tok]
                    if val == 100:
                        chunk = (chunk or 1) * 100
                    elif val >= 1000:
                        total += (chunk or 1) * val
                        chunk = 0
                    else:
                        chunk += val
                    j += 1
                elif tok == "and" and j + 1 < n and tokens[j + 1] in NUMBER_WORDS:
                    j += 1
                else:
                    break
            total += chunk
            out_tokens.append(str(total))
            out_index_map.append(index_map[start])
            i = j
        else:
            out_tokens.append(tokens[i])
            out_index_map.append(index_map[i])
            i += 1
    return out_tokens, out_index_map


def split_sentences(text):
    """Split on sentence-final punctuation, with a small guard so a
    "Mr. Smith" doesn't get split mid-name."""
    raw = [p.strip() for p in SENTENCE_BOUNDARY_RE.split(text) if p.strip()]
    out = []
    for part in raw:
        if out:
            last_word = tokenize(out[-1])[-1:]
            if last_word and last_word[0] in ABBREVIATIONS and out[-1].endswith("."):
                out[-1] = out[-1] + " " + part
                continue
        out.append(part)
    return out


def build_sentence_units(paragraphs):
    """Flatten a chapter's paragraphs into individual sentences, each tagged
    with its source paragraph index - the shared unit for excerpt-boundary
    alignment and for one-sentence-per-line rendering."""
    units = []  # list of (sentence_text, paragraph_idx)
    for p_i, para in enumerate(paragraphs):
        for sent in split_sentences(para):
            units.append((sent, p_i))
    return units


def ends_sentence(word):
    if not word or word[-1] not in ".!?":
        return False
    core = tokenize(word)
    return not (core and core[-1] in ABBREVIATIONS and word.endswith("."))


def split_audio_sentences(words):
    """words: list of (text, start, end) for the spoken body. Breaks on
    Whisper's own sentence-ending punctuation OR a natural pause gap -
    Whisper sometimes writes a comma instead of a period at a real sentence
    boundary, but the pause is still there, so the gap catches what the
    punctuation mark missed."""
    lines = []
    current = []
    for i, (w, _s, e) in enumerate(words):
        current.append(w)
        gap = words[i + 1][1] - e if i + 1 < len(words) else None
        if ends_sentence(w) or (gap is not None and gap >= PAUSE_GAP_SECONDS):
            lines.append(" ".join(current))
            current = []
    if current:
        lines.append(" ".join(current))
    return lines


def read_segments(manifest_path):
    segments = []
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            item_index, source_file, start_offset, length = line.split("|")
            segments.append(
                {
                    "item_index": int(item_index),
                    "source_file": source_file,
                    "start_offset": float(start_offset),
                    "length": float(length),
                }
            )
    segments.sort(key=lambda s: s["item_index"])
    return segments


def decode_segment(source_file, start_offset, length):
    """Decode [start_offset, start_offset+length) seconds of source_file to
    mono float32 @ 16kHz using PyAV, so multi-item tracks with no rendering
    or gluing still produce one continuous transcript.

    PyAV's seek() lands at or before the requested point (nearest keyframe),
    so we can't just trim samples from the front of the decode blindly - we
    derive the actual lead-in from the first decoded frame's own timestamp
    and drop exactly that much, then take exactly `length` seconds from
    there."""
    import av

    container = av.open(source_file)
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
    total_needed = int(round(length * SAMPLE_RATE))

    if start_offset > 0:
        seek_pts = int(start_offset / stream.time_base)
        container.seek(seek_pts, stream=stream)

    chunks = []
    first_frame_time = None
    collected_samples = 0

    for frame in container.decode(stream):
        if frame.pts is not None and first_frame_time is None:
            first_frame_time = float(frame.pts * stream.time_base)
        for rframe in resampler.resample(frame):
            arr = rframe.to_ndarray()[0].astype(np.float32)
            chunks.append(arr)
            collected_samples += len(arr)

        if first_frame_time is not None:
            lead_in = max(0, int(round((start_offset - first_frame_time) * SAMPLE_RATE)))
            if collected_samples >= lead_in + total_needed:
                break

    container.close()

    if not chunks:
        return np.zeros(total_needed, dtype=np.float32)

    audio = np.concatenate(chunks)

    lead_in = 0
    if first_frame_time is not None:
        lead_in = min(len(audio), max(0, int(round((start_offset - first_frame_time) * SAMPLE_RATE))))
    audio = audio[lead_in:]

    if len(audio) > total_needed:
        audio = audio[:total_needed]
    elif len(audio) < total_needed:
        audio = np.pad(audio, (0, total_needed - len(audio)))

    return audio.astype(np.float32)


def build_concatenated_audio(segments, progress_path=None):
    """Returns (full_audio_array, segments_with_concat_start) where each
    segment dict gains a 'concat_start' key (seconds into the concatenated
    array where this segment begins)."""
    pieces = []
    concat_start = 0.0
    enriched = []
    n = len(segments)
    for i, seg in enumerate(segments):
        check_cancelled(progress_path)
        write_progress(progress_path, "DECODE", 2 + int(13 * i / max(1, n)), f"Decoding item {i + 1}/{n}")
        log(f"Decoding item {seg['item_index']}: {seg['source_file']} " f"[{seg['start_offset']:.2f}s, {seg['length']:.2f}s]")
        audio = decode_segment(seg["source_file"], seg["start_offset"], seg["length"])
        pieces.append(audio)
        seg = dict(seg)
        seg["concat_start"] = concat_start
        enriched.append(seg)
        concat_start += len(audio) / SAMPLE_RATE

    full_audio = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)
    return full_audio, enriched


def locate_in_segments(concat_time, segments):
    """Map a timestamp in the concatenated audio back to (item_index, srcpos)
    in the original item's source-relative coordinate space."""
    if not segments:
        return 0, 0.0

    chosen = segments[0]
    for seg in segments:
        if seg["concat_start"] <= concat_time:
            chosen = seg
        else:
            break

    offset_into_segment = concat_time - chosen["concat_start"]
    srcpos = chosen["start_offset"] + max(0.0, offset_into_segment)
    return chosen["item_index"], srcpos


def transcribe(audio_array, model_size, language, device="cpu", progress_path=None, hotwords=None, return_info=False):
    from faster_whisper import WhisperModel

    total_duration = len(audio_array) / SAMPLE_RATE

    write_progress(progress_path, "LOAD", 15, f"Loading Whisper model '{model_size}' (first use may download it)...")
    log(f"Loading Whisper model '{model_size}' on {device} (first run downloads it once)...")
    compute_type = "int8" if device == "cpu" else "float16"
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    write_progress(progress_path, "TRANSCRIBE", 18, f"Transcribing... 00:00 / {format_time(total_duration)}")
    if hotwords:
        log(f"Using vocabulary hints: {hotwords}")
    log("Transcribing audio (this can take a while for long tracks)...")
    segments, info = model.transcribe(
        audio_array,
        language=language,
        word_timestamps=True,
        vad_filter=True,
        hotwords=hotwords or None,
    )

    words = []  # list of (word_text, start_seconds, end_seconds)
    for seg in segments:
        check_cancelled(progress_path)

        if seg.words:
            for w in seg.words:
                words.append((w.word.strip(), w.start, w.end))

        frac = min(1.0, seg.end / total_duration) if total_duration > 0 else 1.0
        write_progress(progress_path, "TRANSCRIBE", 18 + int(72 * frac), f"Transcribing... {format_time(seg.end)} / {format_time(total_duration)}")

    log(f"Detected language: {info.language} (p={info.language_probability:.2f})")
    if return_info:
        return words, info
    return words


# Sensible-not-perfectly-tuned per-model default cap on how many chunk
# workers to run at once (each loads its own full copy of the model into
# memory - unlike threads, a spawned process shares nothing). Clamped
# further to 1 on CUDA, where concurrent worker processes would contend
# for the same GPU/VRAM instead of just CPU cores.
MAX_WORKERS_BY_MODEL = {
    "tiny": 8,
    "base": 6,
    "small": 4,
    "medium": 2,
    "large-v3-turbo": 2,
    "large-v3": 1,
}

# Consecutive chunks overlap by this many seconds so a word/sentence cut
# exactly at a chunk boundary has a decent chance of appearing whole in at
# least one of its two neighboring chunks; _dedupe_overlap below then
# drops the duplicate.
CHUNK_OVERLAP_SECONDS = 1.5


def _read_last_progress_pct(path):
    """Best-effort read of a chunk's own progress file's last PCT field -
    used only to estimate how far along a still-running worker is, never
    to make a correctness decision, so any read/parse hiccup (the file
    mid-write, not yet created, etc.) just falls back to "no update yet"."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return None
    last_line = None
    for line in content.splitlines():
        if line.strip():
            last_line = line
    if not last_line:
        return None
    parts = last_line.split("|")
    if len(parts) < 2:
        return None
    try:
        return float(parts[1])
    except ValueError:
        return None


def _chunk_worker_entry(chunk_audio_path, model_size, language, device, hotwords, chunk_progress_path, chunk_out_path):
    """Entry point for one chunk's transcription in its own OS process (see
    transcribe_chunked below). A spawned worker is a fresh interpreter -
    nothing is shared with the parent or sibling workers - so it loads its
    own WhisperModel, transcribes this chunk's audio (written to a private
    .npy file by the parent; chunk-local timestamps only, the parent adds
    the chunk's start-time offset during reassembly), and writes the
    resulting words to chunk_out_path as JSON.

    Runs as a separate process rather than a thread specifically so the
    parent can force-terminate it outright on cancellation, and so this
    function's own unconditional os._exit(0) can force real termination
    when done - mirroring the exact reasoning already used for the main
    process in main()'s Cancelled handler: faster-whisper/ctranslate2 can
    leave lingering non-daemon threads that keep a process alive past a
    normal return.
    """
    try:
        audio = np.load(chunk_audio_path)
        words = transcribe(audio, model_size, language, device, chunk_progress_path, hotwords)
        tmp_path = chunk_out_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(words, f)
        os.replace(tmp_path, chunk_out_path)
    except Exception:
        # Best-effort: leave chunk_out_path missing on failure. The parent
        # has no separate per-chunk error channel today - a chunk that
        # never produces its output file is indistinguishable here from
        # one that's just slow, so it surfaces only via the run's overall
        # TIMEOUT_SECONDS handling on the Lua side, same as any other
        # backend hang would.
        pass
    finally:
        os._exit(0)


def transcribe_chunked(full_audio, model_size, language, device, progress_path, hotwords, chunk_seconds, parallel_workers, work_dir):
    """Chunked/optionally-parallel counterpart to transcribe(): splits
    full_audio into chunk_seconds-length, slightly overlapping windows,
    transcribes each independently (in parallel worker processes beyond
    the first, which runs synchronously in this process), then reassembles
    one chunk-offset-adjusted, overlap-deduplicated transcript_words list -
    the same shape transcribe() itself returns, so diff_and_build_markers()
    and everything downstream of it in run() needs no changes at all.
    """
    overlap_samples = int(CHUNK_OVERLAP_SECONDS * SAMPLE_RATE)
    chunk_samples = int(chunk_seconds * SAMPLE_RATE)
    n = len(full_audio)

    starts = list(range(0, n, chunk_samples)) if chunk_samples > 0 else [0]
    chunks = []
    for i, start in enumerate(starts):
        ov_start = max(0, start - overlap_samples) if i > 0 else start
        end = min(n, start + chunk_samples + overlap_samples)
        chunks.append(
            {
                "index": i,
                "start_sample": ov_start,
                "end_sample": end,
                "offset_seconds": ov_start / SAMPLE_RATE,
                "duration": (end - ov_start) / SAMPLE_RATE,
            }
        )
    n_chunks = len(chunks)
    log(f"Chunked transcription: {n_chunks} chunk(s) of ~{chunk_seconds}s " f"(with {CHUNK_OVERLAP_SECONDS}s overlap between neighbors)")

    max_by_model = MAX_WORKERS_BY_MODEL.get(model_size, 2)
    if device == "cuda":
        max_by_model = 1
    n_workers = parallel_workers if parallel_workers > 0 else max_by_model
    n_workers = max(1, min(n_workers, n_chunks, max_by_model, os.cpu_count() or 1))
    log(f"Using up to {n_workers} parallel worker process(es) for model '{model_size}'")

    os.makedirs(work_dir, exist_ok=True)

    def chunk_paths(i):
        return (
            os.path.join(work_dir, f"chunk_{i:04d}.npy"),
            os.path.join(work_dir, f"chunk_{i:04d}.progress"),
            os.path.join(work_dir, f"chunk_{i:04d}.json"),
        )

    for c in chunks:
        audio_path, _, _ = chunk_paths(c["index"])
        np.save(audio_path, full_audio[c["start_sample"] : c["end_sample"]])

    # Chunk 0 runs synchronously in this (parent) process, before any
    # workers are spawned - this both caches the model download once
    # (avoiding N processes racing to fetch the same weights on a cold
    # cache) and, when the caller didn't force a --language, lets every
    # later chunk reuse chunk 0's own detected language explicitly instead
    # of each independently (and possibly inconsistently) auto-detecting
    # language on what might be a low-signal slice.
    write_progress(progress_path, "TRANSCRIBE", 18, f"Transcribing chunk 1/{n_chunks}...")
    _, _, first_out_path = chunk_paths(0)
    first_words, first_info = transcribe(
        full_audio[chunks[0]["start_sample"] : chunks[0]["end_sample"]], model_size, language, device, None, hotwords, return_info=True
    )
    with open(first_out_path, "w", encoding="utf-8") as f:
        json.dump(first_words, f)
    effective_language = language or first_info.language

    pending = chunks[1:]
    running = {}  # index -> multiprocessing.Process
    chunk_progress = {0: 100.0}
    for c in pending:
        chunk_progress[c["index"]] = 0.0

    def aggregate_percent():
        total_weighted = sum(c["duration"] for c in chunks) or 1.0
        weighted = sum(chunk_progress.get(c["index"], 0.0) * c["duration"] for c in chunks)
        return 18 + int(72 * min(1.0, weighted / (100.0 * total_weighted)))

    cancel_path = (progress_path + ".cancel") if progress_path else None
    while pending or running:
        if cancel_path and os.path.exists(cancel_path):
            for p in running.values():
                p.terminate()
            raise Cancelled()

        while pending and len(running) < n_workers:
            c = pending.pop(0)
            audio_path, chunk_prog_path, chunk_out_path = chunk_paths(c["index"])
            p = multiprocessing.Process(
                target=_chunk_worker_entry,
                args=(audio_path, model_size, effective_language, device, hotwords, chunk_prog_path, chunk_out_path),
                daemon=True,
            )
            p.start()
            running[c["index"]] = p

        for idx in list(running.keys()):
            _, chunk_prog_path, chunk_out_path = chunk_paths(idx)
            if os.path.exists(chunk_out_path):
                running.pop(idx)
                chunk_progress[idx] = 100.0
            else:
                pct = _read_last_progress_pct(chunk_prog_path)
                if pct is not None:
                    chunk_progress[idx] = pct

        done_count = n_chunks - len(pending) - len(running)
        write_progress(progress_path, "TRANSCRIBE", aggregate_percent(), f"Transcribing... {done_count}/{n_chunks} chunk(s) done")
        time.sleep(0.5)

    # Reassembly: read every chunk's words back in index order, add each
    # chunk's own start-time offset (workers wrote chunk-local timestamps
    # only), and drop this chunk's words that duplicate one already kept
    # from the previous chunk within their shared overlap span.
    all_words = []
    for c in chunks:
        _, _, chunk_out_path = chunk_paths(c["index"])
        with open(chunk_out_path, "r", encoding="utf-8") as f:
            raw_words = json.load(f)
        offset = c["offset_seconds"]
        words = [(w[0], w[1] + offset, w[2] + offset) for w in raw_words]

        if c["index"] > 0:
            overlap_boundary = offset + CHUNK_OVERLAP_SECONDS
            prior_tail = [w for w in all_words if w[1] >= offset]
            consumed = [False] * len(prior_tail)
            deduped = []
            for w in words:
                if w[1] < overlap_boundary:
                    matched = False
                    for i, pw in enumerate(prior_tail):
                        if not consumed[i] and pw[0].lower() == w[0].lower():
                            consumed[i] = True
                            matched = True
                            break
                    if matched:
                        continue
                deduped.append(w)
            words = deduped

        all_words.extend(words)

    all_words.sort(key=lambda w: w[1])

    for c in chunks:
        for p in chunk_paths(c["index"]):
            try:
                os.remove(p)
            except OSError:
                pass
        try:
            os.remove(chunk_paths(c["index"])[2] + ".tmp")
        except OSError:
            pass
    try:
        os.rmdir(work_dir)
    except OSError:
        pass  # non-empty (e.g. a stray file) or already gone - not fatal, best-effort cleanup only

    write_progress(progress_path, "TRANSCRIBE", 90, "Transcription complete")
    return all_words


def load_manuscript_chapters(manuscript_path):
    """Return comparison chapters from canonical manuscript data only."""
    data = canonical_manuscript.load_file(manuscript_path)
    by_chapter = {chapter["id"]: {"id": chapter["id"], "title": chapter["title"], "paragraphs": [], "global_indices": [], "paragraph_ids": []} for chapter in data["chapters"]}
    for paragraph in data["paragraphs"]:
        chapter = by_chapter[paragraph["chapterId"]]
        chapter["paragraphs"].append(paragraph["text"])
        chapter["global_indices"].append(paragraph["index"])
        chapter["paragraph_ids"].append(paragraph["id"])
    chapters = [chapter for chapter in by_chapter.values() if chapter["paragraphs"]]
    if not chapters:
        raise ValueError("The canonical manuscript has no narratable chapters.")
    return chapters


def resolve_global_paragraph(chapter, local_index):
    """The Manuscript reader's global paragraph index for the local_index-th
    paragraph of this chapter, falling back to the
    nearest paragraph with a known global index if that exact one has none."""
    indices = chapter["global_indices"]
    if not indices:
        return 0
    local_index = min(max(local_index, 0), len(indices) - 1)
    if indices[local_index] is not None:
        return indices[local_index]
    for distance in range(1, len(indices)):
        for candidate in (local_index - distance, local_index + distance):
            if 0 <= candidate < len(indices) and indices[candidate] is not None:
                return indices[candidate]
    return 0


def extract_hints(manuscript_path, hints_out_path):
    """Scans the manuscript for candidate vocabulary-hint terms: words
    capitalized somewhere other than a sentence's first word (index 0 of
    the sentence's own word list) - a heuristic that tends to catch
    invented names/terms an ordinary dictionary wouldn't know how to spell,
    while a plain word that's only ever capitalized at a sentence's start
    self-excludes naturally, no separate logic needed. Deliberately fast
    (no model load, no audio decode - reuses only load_manuscript_chapters() and
    split_sentences()) since this is meant to run synchronously from the
    config screen while the user waits a few seconds, unlike the real
    --manifest/model transcription path below.

    Writes "OK|term1, term2, ..." (or "OK|" if none found) to
    hints_out_path, matching this script's existing tagged-line convention
    (SUMMARY|, NEED_CHAPTER|, MARKER|) for its other file-based output.
    """
    chapters = load_manuscript_chapters(manuscript_path)

    counts = {}  # lowercase key -> total occurrences
    suspicious = {}  # lowercase key -> times capitalized, not sentence-initial
    display = {}  # lowercase key -> a representative original-case spelling

    for chapter in chapters:
        for para in chapter["paragraphs"]:
            for sentence in split_sentences(para):
                words = sentence.split()
                for i, raw in enumerate(words):
                    word = raw.strip(".,!?;:\"'()[]{}‘’“”")
                    if len(word) < 3 or not word.isalpha():
                        continue
                    key = word.lower()
                    counts[key] = counts.get(key, 0) + 1
                    display.setdefault(key, word)
                    if i > 0 and word[0].isupper():
                        suspicious[key] = suspicious.get(key, 0) + 1

    candidates = [key for key in suspicious if key not in _COMMON_WORDS]
    candidates.sort(key=lambda k: suspicious[k], reverse=True)
    candidates = candidates[:30]  # keeps the destination single-line native dialog usable

    terms = [display[k] for k in candidates]
    line = "OK|" + ", ".join(terms)
    if hints_out_path:
        with open(hints_out_path, "w", encoding="utf-8") as f:
            f.write(line + "\n")
    else:
        print(line)


def clean_marker_field(value):
    return value[:200].replace("|", "/")


def display_title(title):
    """Headings can contain a manual line break embedding a subtitle (e.g.
    "CHAPTER ONE\\nBad Ideas Look Great in Neon", confirmed live) - join
    into one clean line ("CHAPTER ONE: Bad Ideas Look Great in Neon") for
    error/log messages and markdown headings alike."""
    if not title:
        return title
    lines = [line.strip() for line in title.splitlines() if line.strip()]
    return ": ".join(lines)


def normalized_tokens(s):
    """Tokenize + collapse spelled-out numbers to digits, so "Chapter 1"
    (a natural REAPER track name) lines up with a manuscript heading styled
    as "CHAPTER ONE" - confirmed live to be a real-world heading style, not
    just a hypothetical. Kept as a token LIST (not a joined string) so
    prefix/containment checks compare whole tokens - a joined-string
    ".startswith()" check would (and did, live) wrongly match "chapter 1"
    against "chapter 11", since "1" is a literal character-prefix of "11"."""
    tokens = tokenize(s)
    tokens, _ = merge_number_words(tokens, list(range(len(tokens))))
    return tokens


def _contains_token_run(haystack, needle):
    n = len(needle)
    if n == 0 or n > len(haystack):
        return False
    return any(haystack[i : i + n] == needle for i in range(len(haystack) - n + 1))


def find_chapter_by_track_name(chapters, track_name):
    candidate_titles = [display_title(c["title"]) for c in chapters]
    target_tokens = normalized_tokens(track_name)
    titles = "\n".join(f"  - {t}" for t in candidate_titles)

    chapter_tokens_list = [(c, normalized_tokens(c["title"])) for c in chapters]

    # 1. exact match
    for chapter, toks in chapter_tokens_list:
        if toks == target_tokens:
            return chapter, 1.0, candidate_titles

    # 2. token-level prefix/containment match - handles "Chapter 1" (track)
    # vs "Chapter 1: The Beginning" (heading with a subtitle). Whole-token
    # comparison, not substring, so "chapter 1" never matches inside
    # "chapter 11". This has to run BEFORE the fuzzy fallback below:
    # SequenceMatcher's ratio penalizes a long-but-correct heading (lots of
    # extra characters in the subtitle) more than it penalizes a
    # short-but-wrong one, so e.g. a "Characters" heading can outscore the
    # real "Chapter 1: The Beginning" on pure ratio alone even though it
    # shares no actual content with the track name.
    substring_matches = [
        chapter for chapter, toks in chapter_tokens_list if toks[: len(target_tokens)] == target_tokens or _contains_token_run(toks, target_tokens)
    ]
    if len(substring_matches) == 1:
        return substring_matches[0], 0.95, candidate_titles
    elif len(substring_matches) > 1:
        # ambiguous prefix match - the shortest title is closest to exact
        return min(substring_matches, key=lambda c: len(c["title"])), 0.9, candidate_titles

    # 3. fuzzy fallback, deliberately strict, since a weak match here means
    # picking the WRONG chapter's content to diff against, not just a
    # slightly-off score.
    target_str = " ".join(target_tokens)
    best = None
    best_score = -1.0
    for chapter, toks in chapter_tokens_list:
        ratio = difflib.SequenceMatcher(None, " ".join(toks), target_str).ratio()
        if ratio > best_score:
            best_score = ratio
            best = chapter

    if best is None or best_score < 0.75:
        log(
            f"No chapter heading matched track name '{track_name}' well enough "
            f"(best guess '{display_title(best['title']) if best else '?'}' scored {best_score:.2f}). "
            f"Detected headings:\n{titles}\nAsking for an explicit chapter selection."
        )
        return None, 0.0, candidate_titles

    log(
        f"WARNING: no exact/prefix heading match for track '{track_name}' - "
        f"using closest fuzzy match '{display_title(best['title'])}' (score={best_score:.2f}). "
        f"Detected headings:\n{titles}"
    )
    return best, best_score, candidate_titles


def find_chapter_by_exact_title(chapters, title):
    for chapter in chapters:
        if display_title(chapter["title"]) == title:
            return chapter
    return None


def _fuse_hyphen_split_opcodes(opcodes, chapter_norm, filtered_tokens):
    """A bare hyphen is already treated as a token separator (needed so a
    hyphenated spelled-out number like "forty-three" still merges via
    merge_number_words into "43") - but that's exactly why Whisper
    rendering a compound word with a dash ("super-powered") when the
    manuscript spells it solid ("superpowered") shows up as a genuine-
    looking 'replace' block: SequenceMatcher has no way to know the two
    sides are the same word. Rewrite a 'replace' opcode as 'equal' when
    one side's token(s), concatenated with no separator, equal the other
    side's single token."""
    fixed = []
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "replace":
            doc_words = chapter_norm[i1:i2]
            audio_words = filtered_tokens[j1:j2]
            if len(doc_words) == 1 and len(audio_words) > 1 and doc_words[0] == "".join(audio_words):
                fixed.append(("equal", i1, i2, j1, j2))
                continue
            if len(audio_words) == 1 and len(doc_words) > 1 and audio_words[0] == "".join(doc_words):
                fixed.append(("equal", i1, i2, j1, j2))
                continue
        fixed.append((tag, i1, i2, j1, j2))
    return fixed


def diff_and_build_markers(chapter_tokens, chapter_unit_idx, chapter_raw_words, transcript_words, min_words):
    filtered_tokens = []
    index_map = []
    for i, (w, _s, _e) in enumerate(transcript_words):
        for t in tokenize(w):
            if t in FILLER_WORDS:
                continue
            filtered_tokens.append(t)
            index_map.append(i)

    chapter_norm, chapter_index_map = merge_number_words(chapter_tokens, list(range(len(chapter_tokens))))
    filtered_tokens, index_map = merge_number_words(filtered_tokens, index_map)

    sm = difflib.SequenceMatcher(None, chapter_norm, filtered_tokens, autojunk=False)
    opcodes = _fuse_hyphen_split_opcodes(sm.get_opcodes(), chapter_norm, filtered_tokens)

    # Content before the first aligned block or after the last one was
    # simply never part of this recording (e.g. only a partial chapter was
    # selected/recorded) - not a genuine mid-recording skip. Only "delete"
    # opcodes within the aligned span represent real skips; "replace" and
    # "insert" are untouched below since they only occur where transcript
    # content actually exists.
    aligned_start = None
    aligned_end = None
    for tag, i1, i2, _j1, _j2 in opcodes:
        if tag != "delete":
            if aligned_start is None:
                aligned_start = i1
            aligned_end = i2

    # (concat_time, kind, name, doc snippet, audio snippet, sentence unit,
    #  normalized document/audio bounds).  The bounds stay with the marker
    # so the result writer can build a compact, aligned review excerpt for
    # that specific discrepancy rather than pairing a whole script sentence
    # with only the changed audio words.
    markers = []

    def snippet(tokens, lo, hi, limit=8):
        words = tokens[lo:hi]
        if not words:
            return ""
        s = " ".join(words[:limit])
        if len(words) > limit:
            s += " ..."
        return s

    def time_for(filtered_idx):
        if not transcript_words:
            return 0.0
        if filtered_idx >= len(index_map):
            return transcript_words[-1][2]
        orig_idx = index_map[filtered_idx]
        return transcript_words[orig_idx][1]

    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            continue

        length = max(i2 - i1, j2 - j1)
        if length < min_words:
            continue

        t = time_for(j1)

        if tag == "replace":
            doc_snip = snippet(chapter_norm, i1, i2)
            audio_snip = snippet(filtered_tokens, j1, j2)
            kind = "MISREAD"
            name = f"MISREAD: '{doc_snip}' as '{audio_snip}'"
        elif tag == "delete":
            if aligned_start is None or i2 <= aligned_start or i1 >= aligned_end:
                continue  # outside the recorded span - not a real skip
            doc_snip = snippet(chapter_norm, i1, i2)
            audio_snip = ""
            kind = "SKIPPED"
            name = f"SKIPPED: '{doc_snip}'"
        elif tag == "insert":
            doc_snip = ""
            audio_snip = snippet(filtered_tokens, j1, j2)
            kind = "EXTRA"
            name = f"EXTRA: '{audio_snip}'"
        else:
            continue

        source_token = i1 if i1 < len(chapter_norm) else max(0, i1 - 1)
        source_original = chapter_index_map[source_token] if chapter_index_map else 0
        markers.append(
            (
                t,
                kind,
                clean_marker_field(name),
                clean_marker_field(doc_snip),
                clean_marker_field(audio_snip),
                chapter_unit_idx[source_original] if source_original < len(chapter_unit_idx) else 0,
                i1,
                i2,
                j1,
                j2,
            )
        )

    markers.sort(key=lambda m: m[0])

    covered_range = None
    if aligned_start is not None and aligned_end is not None and aligned_end > aligned_start:
        first_orig = chapter_index_map[aligned_start]
        last_orig = chapter_index_map[aligned_end - 1]
        first_u = max(chapter_unit_idx[first_orig], 0)  # clamp title (-1) to first real unit
        last_u = max(chapter_unit_idx[last_orig], 0)
        covered_range = (first_u, last_u)

    # chapter_unit_idx is indexed by original chapter_tokens position;
    # re-express it in chapter_norm (merged) position, the space the
    # opcodes above actually use, so the audio-line renderer can reuse this
    # exact alignment instead of guessing sentence boundaries independently.
    chapter_norm_unit_idx = [chapter_unit_idx[orig_i] for orig_i in chapter_index_map]
    alignment = {
        "opcodes": opcodes,
        "unit_idx": chapter_norm_unit_idx,
        "index_map": index_map,
        "chapter_index_map": chapter_index_map,
        "chapter_raw_words": chapter_raw_words,
    }

    return markers, covered_range, alignment


def build_marker_context(
    marker_i1, marker_i2, marker_j1, marker_j2, unit_idx, opcodes, index_map, chapter_index_map, chapter_raw_words, transcript_words, context_words=6
):
    """Return compact script/recorded excerpts centered on one diff opcode.

    The marker's bounds are in the same normalized-token space as the
    opcodes.  We keep up to ``context_words`` manuscript tokens on either
    side, never cross the source sentence, and reconstruct the recorded
    counterpart from the alignment.  Equal words deliberately reuse the
    manuscript rendering; only a real replacement or insertion uses Whisper's
    raw word(s).  This gives the proofing table useful local context without
    making a run-on sentence fill the expanded row.
    """
    if not unit_idx or not chapter_index_map:
        return "", ""

    n = len(unit_idx)
    source_i = marker_i1 if marker_i1 < n else marker_i1 - 1
    if source_i < 0 or source_i >= n:
        return "", ""
    source_unit = unit_idx[source_i]
    if source_unit is None or source_unit < 0:
        return "", ""

    unit_start = source_i
    while unit_start > 0 and unit_idx[unit_start - 1] == source_unit:
        unit_start -= 1
    unit_end = source_i + 1
    while unit_end < n and unit_idx[unit_end] == source_unit:
        unit_end += 1

    window_start = max(unit_start, marker_i1 - context_words)
    window_end = min(unit_end, marker_i2 + context_words)
    # An insertion has no document span; include the words on both sides of
    # its anchor.  The same formula above already does that, but this clamp
    # keeps an end-of-sentence insertion anchored inside its source unit.
    if marker_i1 == marker_i2:
        window_start = max(unit_start, marker_i1 - context_words)
        window_end = min(unit_end, marker_i1 + context_words)

    def add_doc_words(parts, seen_original, lo, hi):
        for norm_i in range(max(lo, window_start), min(hi, window_end)):
            original_i = chapter_index_map[norm_i]
            if original_i != seen_original[0]:
                parts.append(chapter_raw_words[original_i])
                seen_original[0] = original_i

    script_words = []
    script_seen = [-1]
    add_doc_words(script_words, script_seen, window_start, window_end)

    heard_words = []
    heard_seen = [-1]
    for tag, i1, i2, j1, j2 in opcodes:
        overlaps_window = i1 < window_end and i2 > window_start
        is_target_insertion = i1 == i2 and i1 == marker_i1 and j1 == marker_j1 and j2 == marker_j2
        insertion_in_window = i1 == i2 and window_start <= i1 <= window_end
        if tag == "equal" and overlaps_window:
            add_doc_words(heard_words, heard_seen, i1, i2)
        elif tag == "replace" and overlaps_window:
            heard_words.extend(transcript_words[index_map[j]][0] for j in range(j1, j2))
        elif tag == "insert" and (insertion_in_window or is_target_insertion):
            heard_words.extend(transcript_words[index_map[j]][0] for j in range(j1, j2))

    if not script_words and not heard_words:
        return "", ""

    prefix = "... " if window_start > unit_start else ""
    suffix = " ..." if window_end < unit_end else ""
    return prefix + " ".join(script_words) + suffix, prefix + " ".join(heard_words) + suffix


def find_transcript_title_boundary(title, transcript_words):
    """Where does the spoken title end within the transcript? An
    independent, best-effort heuristic (approximate is fine - this is for
    display only, not marker placement): number-normalize the title, take a
    short window from the very start of the transcript, and find the
    longest matching run between the two. Returns a word index into
    transcript_words (0 if nothing matched, meaning "no title detected -
    treat the whole thing as body")."""
    title_tokens = tokenize(title)
    title_tokens, _ = merge_number_words(title_tokens, list(range(len(title_tokens))))
    if not title_tokens or not transcript_words:
        return 0

    window_word_count = min(len(transcript_words), len(title_tokens) * 4 + 20)

    transcript_tokens = []
    idx_map = []
    for i in range(window_word_count):
        w = transcript_words[i][0]
        for t in tokenize(w):
            if t in FILLER_WORDS:
                continue
            transcript_tokens.append(t)
            idx_map.append(i)
    transcript_tokens, idx_map = merge_number_words(transcript_tokens, idx_map)

    if not transcript_tokens:
        return 0

    sm = difflib.SequenceMatcher(None, title_tokens, transcript_tokens, autojunk=False)
    match = sm.find_longest_match(0, len(title_tokens), 0, len(transcript_tokens))
    if match.size == 0:
        return 0

    boundary_norm_idx = match.b + match.size
    if boundary_norm_idx >= len(idx_map):
        return idx_map[-1] + 1
    return idx_map[boundary_norm_idx]


def build_unit_audio_info(unit_idx, opcodes, index_map, chapter_index_map, chapter_raw_words, transcript_words, first_u, last_u):
    """For manuscript sentence units [first_u, last_u], reconstruct what
    the "recorded" side should show for that unit - word by word, not as
    an all-or-nothing per-unit flag. Where a doc token aligns as a clean
    'equal' match (including a fused hyphen-split compound - see
    _fuse_hyphen_split_opcodes), the reconstruction reuses the
    manuscript's own raw word (preserving its original casing,
    punctuation, quotes, hyphenation) instead of Whisper's raw rendering,
    since they're confirmed the same content; only a genuine replace/
    insert substitutes the actual transcribed word(s). Without this, one
    real misread in an otherwise-perfect sentence used to make the whole
    line fall back to Whisper's raw transcript, which then *also* painted
    unrelated quote/dash/case/number formatting as "different" even
    though only one word was actually wrong (confirmed live). Returns a
    list (one entry per unit in range) of (is_exact, recorded_text) -
    is_exact=True means the caller should use the manuscript's own
    sentence text verbatim rather than recorded_text."""
    unit_words = {u: [] for u in range(first_u, last_u + 1)}
    unit_all_equal = {u: True for u in range(first_u, last_u + 1)}
    unit_touched = {u: False for u in range(first_u, last_u + 1)}

    def append_word(u, raw):
        if u is None or u < first_u or u > last_u:
            return
        words = unit_words[u]
        if not words or words[-1] != raw:  # dedupe a raw word repeated across its constituent tokens
            words.append(raw)
        unit_touched[u] = True

    def mark_diff(units, j1, j2):
        audio_words = [transcript_words[index_map[j]][0] for j in range(j1, j2)]
        for u in units:
            if u is None or u < first_u or u > last_u:
                continue
            unit_words[u].extend(audio_words)
            unit_all_equal[u] = False
            unit_touched[u] = True

    n = len(unit_idx)
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "delete":
            for u in sorted(set(unit_idx[i1:i2])):
                if u is not None and first_u <= u <= last_u:
                    unit_all_equal[u] = False
                    unit_touched[u] = True
            continue
        if tag == "equal":
            # Per doc-token, not per-audio-token, so a fused hyphen-split
            # opcode (uneven i/j lengths - one compound doc token standing
            # in for several audio tokens, or vice versa) still emits
            # exactly the doc-side raw word(s) without needing the j-range
            # at all, since the audio's exact wording doesn't matter once
            # it's confirmed to be the same content.
            for k in range(i2 - i1):
                chapter_norm_i = i1 + k
                append_word(unit_idx[chapter_norm_i], chapter_raw_words[chapter_index_map[chapter_norm_i]])
        else:  # replace / insert - block-level, not token-precise
            if i1 == i2:
                probe = min(i1, n - 1)
                mark_diff([unit_idx[probe] if 0 <= probe < n else None], j1, j2)
            else:
                mark_diff(sorted(set(unit_idx[i1:i2])), j1, j2)

    info = []
    for u in range(first_u, last_u + 1):
        if not unit_touched[u]:
            info.append((False, ""))
        elif unit_all_equal[u]:
            info.append((True, ""))
        else:
            info.append((False, " ".join(unit_words[u])))
    return info


def write_unified_diff(chapter, transcript_words, diff_path, covered_range, sentence_units, alignment):
    """Writes the manuscript/recorded comparison two ways:
    - diff_path: one unified-diff-formatted file ('-'/'+'/' ' syntax) -
      always readable on its own (Notepad, any editor), no external tool
      needed, and gets automatic red/green highlighting in editors that
      recognize .diff/.patch syntax.
    - <diff_path minus .diff>.manuscript.txt / .recorded.txt: a plain
      line-for-line pair, one line per sentence unit, derived from the
      exact same per-unit data - lets a real interactive two-pane diff
      view (`code --diff manuscript.txt recorded.txt`) be attempted too,
      since a standalone .diff file opened as a document is only ever
      syntax-highlighted text, never an actual diff *view*.
    Returns diff_path; the .txt pair's paths are deterministically
    derivable from it (swap the .diff extension), so callers needing them
    don't require a separate return value."""
    heading = display_title(chapter["title"])

    if covered_range is not None:
        first_u, last_u = covered_range
    else:
        first_u, last_u = 0, len(sentence_units) - 1

    if covered_range is not None:
        unit_info = build_unit_audio_info(
            alignment["unit_idx"],
            alignment["opcodes"],
            alignment["index_map"],
            alignment["chapter_index_map"],
            alignment["chapter_raw_words"],
            transcript_words,
            first_u,
            last_u,
        )
    else:
        # Degenerate fallback - alignment found nothing at all, so there's
        # no manuscript unit to line audio up against; fall back to
        # punctuation/pause-based splitting over everything after the
        # spoken title and just show it as one big addition.
        title_boundary = find_transcript_title_boundary(chapter["title"], transcript_words)
        fallback_lines = split_audio_sentences(transcript_words[title_boundary:])
        unit_info = [(False, line) for line in fallback_lines]

    diff_lines = [f"--- {heading} (manuscript)", f"+++ {heading} (recorded)"]
    doc_lines, audio_lines = [], []
    if first_u > 0:
        diff_lines.append(" ...")
        doc_lines.append("...")
        audio_lines.append("...")
    for offset, u in enumerate(range(first_u, last_u + 1)):
        doc_text = sentence_units[u][0]
        is_exact, audio_text = unit_info[offset] if offset < len(unit_info) else (False, "")
        doc_lines.append(doc_text)
        audio_lines.append(doc_text if is_exact else audio_text)
        if is_exact:
            diff_lines.append(" " + doc_text)
        else:
            diff_lines.append("-" + doc_text)
            if audio_text:
                diff_lines.append("+" + audio_text)
    if last_u < len(sentence_units) - 1:
        diff_lines.append(" ...")
        doc_lines.append("...")
        audio_lines.append("...")

    with open(diff_path, "w", encoding="utf-8") as f:
        f.write("\n".join(diff_lines) + "\n")

    base, _ext = os.path.splitext(diff_path)
    with open(base + ".manuscript.txt", "w", encoding="utf-8") as f:
        f.write(f"{heading}\n\n" + "\n".join(doc_lines) + "\n")
    with open(base + ".recorded.txt", "w", encoding="utf-8") as f:
        f.write(f"{heading}\n\n" + "\n".join(audio_lines) + "\n")

    return diff_path


def run(args):
    progress_path = args.progress

    write_progress(progress_path, "START", 0, "Starting...")

    # Per-manuscript custom word equivalences (invented names/words
    # Whisper spells inconsistently, since it has no dictionary entry to
    # guess from) - pulled automatically from a dedicated subfolder next
    # to the manuscript rather than a separate argument, so there's
    # nothing extra for the caller to plumb through. Registered before
    # anything below calls tokenize() (chapter matching included).
    equivalences_path = project_data_path(args.manuscript, "equivalences.csv")
    custom_groups = load_equivalence_groups(equivalences_path)
    if custom_groups:
        _CUSTOM_CANON.update(_build_canon(custom_groups))
        log(f"Loaded {len(custom_groups)} custom word equivalence group(s) from {equivalences_path}")

    segments = read_segments(args.manifest)
    if not segments:
        raise ValueError("Manifest contained no segments.")

    # Chapter matching only needs canonical manuscript data and the track name (or an
    # explicit --chapter-title override) - resolve it before the expensive
    # decode+transcribe steps below, so a NEED_CHAPTER prompt (or a bad
    # --manuscript path) doesn't cost the user a multi-minute wait first.
    check_cancelled(progress_path)
    write_progress(progress_path, "MATCH", 1, "Matching chapter to track name...")
    log("Loading canonical manuscript and splitting into chapters...")
    chapters = load_manuscript_chapters(args.manuscript)
    log(f"Found {len(chapters)} chapter(s)/section(s) in the document.")

    if args.chapter_title:
        chapter = find_chapter_by_exact_title(chapters, args.chapter_title)
        if chapter is None:
            raise ValueError(f"Chapter title override '{args.chapter_title}' not found in the document.")
        score = 1.0
        log(f"Using explicitly-selected chapter '{display_title(chapter['title'])}'")
    else:
        chapter, score, candidates = find_chapter_by_track_name(chapters, args.track_name)
        if chapter is None:
            raise NeedsChapterSelection(candidates)
        log(f"Matched track '{args.track_name}' to chapter '{display_title(chapter['title'])}' (score={score:.3f})")

    check_cancelled(progress_path)
    full_audio, segments = build_concatenated_audio(segments, progress_path)

    vocab_hints_path = project_data_path(args.manuscript, "vocabulary_hints.txt")
    hotwords = None
    if os.path.exists(vocab_hints_path):
        try:
            with open(vocab_hints_path, "r", encoding="utf-8") as f:
                hotwords = f.read().strip() or None
        except OSError:
            hotwords = None

    if args.chunk_seconds and args.chunk_seconds > 0:
        chunk_work_dir = os.path.splitext(args.out)[0] + "_chunks"
        transcript_words = transcribe_chunked(
            full_audio, args.model, args.language, args.device, progress_path, hotwords, args.chunk_seconds, args.parallel_workers, chunk_work_dir
        )
    else:
        transcript_words = transcribe(full_audio, args.model, args.language, args.device, progress_path, hotwords)

    check_cancelled(progress_path)

    # Narrators typically read the chapter heading/title aloud before the
    # body text. The title is otherwise only used for track-name matching,
    # so without this, every spoken title shows up as a false "EXTRA IN
    # AUDIO" discrepancy - confirmed live. Prepending it here means the
    # spoken title aligns against real doc content instead. chapter_unit_idx
    # tracks which sentence unit (or -1 for the title) each token belongs
    # to, so the diff's own aligned span can drive the excerpt boundary
    # below instead of a separate bag-of-words heuristic.
    sentence_units = build_sentence_units(chapter["paragraphs"])
    chapter_tokens, chapter_raw_words = tokenize_with_raw(chapter["title"])
    chapter_unit_idx = [-1] * len(chapter_tokens)
    for u_i, (sent, _p_i) in enumerate(sentence_units):
        sent_tokens, sent_raw_words = tokenize_with_raw(sent)
        for t, rw in zip(sent_tokens, sent_raw_words):
            chapter_tokens.append(t)
            chapter_raw_words.append(rw)
            chapter_unit_idx.append(u_i)

    check_cancelled(progress_path)
    write_progress(progress_path, "DIFF", 96, "Building diff and markers...")
    markers, covered_range, alignment = diff_and_build_markers(chapter_tokens, chapter_unit_idx, chapter_raw_words, transcript_words, args.min_words)
    if covered_range is not None:
        first_u, last_u = covered_range
        last_u = min(last_u + EXCERPT_TAIL_BUFFER_SENTENCES, len(sentence_units) - 1)
        covered_range = (first_u, last_u)

    diff_path = write_unified_diff(chapter, transcript_words, args.diff_out, covered_range, sentence_units, alignment)

    summary = f"MATCH: '{display_title(chapter['title'])}' (score {score:.2f}) - " f"{len(markers)} discrepancy marker(s)"

    check_cancelled(progress_path)
    write_progress(progress_path, "WRITE", 99, "Writing results...")
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        f.write(f"SUMMARY|{summary}\n")
        f.write(f"DIFF|{diff_path}\n")
        for t, kind, name, doc_text, audio_text, unit_index, marker_i1, marker_i2, marker_j1, marker_j2 in markers:
            item_index, srcpos = locate_in_segments(t, segments)
            paragraph = resolve_global_paragraph(chapter, sentence_units[unit_index][1] if 0 <= unit_index < len(sentence_units) else 0)
            script_context, audio_context = build_marker_context(
                marker_i1,
                marker_i2,
                marker_j1,
                marker_j2,
                alignment["unit_idx"],
                alignment["opcodes"],
                alignment["index_map"],
                alignment["chapter_index_map"],
                alignment["chapter_raw_words"],
                transcript_words,
            )
            if not script_context:
                script_context = sentence_units[unit_index][0] if 0 <= unit_index < len(sentence_units) else doc_text
            if not audio_context:
                audio_context = audio_text
            f.write(
                f"MARKER|{item_index}|{srcpos:.3f}|{kind}|{name}|{doc_text}|{audio_text}|{clean_marker_field(chapter['title'])}|{paragraph}|{clean_marker_field(script_context)}|{clean_marker_field(audio_context)}\n"
            )

    log(f"Wrote {len(markers)} marker row(s) to {args.out}")
    write_progress(progress_path, "DONE", 100, "Finished")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", required=False, help="Path to the pipe-delimited segment manifest")
    ap.add_argument("--manuscript", required=True, help="Path to canonical manuscript.json")
    ap.add_argument("--track-name", required=False, help="REAPER track name (matched against a doc heading)")
    ap.add_argument("--chapter-title", default=None, help="Bypass track-name matching and use this exact chapter title (from a prior NEED_CHAPTER prompt)")
    ap.add_argument("--out", required=False, help="Path to write the tagged results file")
    ap.add_argument("--diff-out", required=False, help="Path to write the unified-diff-formatted manuscript/recorded comparison file")
    ap.add_argument(
        "--model", default=get_default("TranscriptCompare", "model_size", "small"), help="Whisper model size (tiny/base/small/medium/large-v3-turbo/large-v3)"
    )
    ap.add_argument("--language", default=None, help="Force language code, e.g. 'en' (default: auto-detect)")
    ap.add_argument("--min-words", type=int, default=1, help="Minimum word-block length to report as a discrepancy")
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Inference device (default: cpu)")
    ap.add_argument("--progress", default=None, help="Path to write live progress updates to (optional)")
    ap.add_argument("--log", default=None, help="Path to also mirror log output to (optional)")
    ap.add_argument(
        "--chunk-seconds",
        type=int,
        default=0,
        help="Transcribe in fixed-length chunks of this many seconds instead of the whole file at once (0 = whole file, default)",
    )
    ap.add_argument("--parallel-workers", type=int, default=0, help="Max chunk workers to run at once when chunked (0 = auto, based on model size)")
    ap.add_argument(
        "--extract-hints", action="store_true", help="Instead of transcribing, scan --manuscript for candidate vocabulary-hint terms and write them to --hints-out"
    )
    ap.add_argument("--hints-out", default=None, help="Path to write suggested hint terms to (used with --extract-hints)")
    args = ap.parse_args()

    if args.log:
        try:
            set_log_file(open(args.log, "w", encoding="utf-8"))
        except OSError:
            pass

    if args.extract_hints:
        try:
            extract_hints(args.manuscript, args.hints_out)
        except Exception as e:
            log(traceback.format_exc())
            if args.hints_out:
                try:
                    with open(args.hints_out, "w", encoding="utf-8") as f:
                        f.write("ERROR|" + str(e) + "\n")
                except OSError:
                    pass
            os._exit(1)
        os._exit(0)

    missing = [
        name
        for name, val in (
            ("--manifest", args.manifest),
            ("--track-name", args.track_name),
            ("--out", args.out),
            ("--diff-out", args.diff_out),
        )
        if not val
    ]
    if missing:
        ap.error(", ".join(missing) + " required unless --extract-hints is given")

    try:
        run(args)
    except Cancelled:
        log("Cancelled by user.")
        write_progress(args.progress, "CANCELLED", 0, "Cancelled by user")
        try:
            if args.progress:
                os.remove(args.progress + ".cancel")
        except OSError:
            pass
        # os._exit, not sys.exit: faster-whisper/ctranslate2 can leave
        # lingering non-daemon worker threads that keep the interpreter
        # alive through a normal shutdown, so the process never actually
        # exits (confirmed live: a "finished" run stuck around indefinitely
        # at ~0% CPU). This forces real termination.
        os._exit(2)
    except NeedsChapterSelection as e:
        log("No confident chapter match - asking for an explicit selection.")
        write_progress(args.progress, "NEED_CHAPTER", 0, "Waiting for chapter selection")
        try:
            with open(args.out, "w", newline="", encoding="utf-8") as f:
                f.write("NEED_CHAPTER|" + "|".join(t.replace("|", "/") for t in e.candidates) + "\n")
        except OSError:
            pass
        os._exit(0)
    except Exception as e:
        log(traceback.format_exc())
        write_progress(args.progress, "ERROR", 0, str(e))
        os._exit(1)

    os._exit(0)


if __name__ == "__main__":
    main()
