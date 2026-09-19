"""
Live word-timestamp ASR sidecar for the Manuscript Teleprompter (see
docs/architecture/manuscript-teleprompter.md). Captures audio (mic or a
replayed file for fixture testing), holds a growing buffer, and - while
speech is in progress - re-decodes that buffer with faster-whisper every
DECODE_INTERVAL_SECONDS. A word is emitted only once two consecutive decodes
agree on it (the "LocalAgreement-2" policy), so the stream is append-only and
trails speech by roughly one to two decode intervals instead of waiting for a
pause. A confirmed pause (Silero VAD - faster-whisper's own bundled model, no
new dependency) or MAX_BUFFER_SECONDS closes the segment: one last decode
emits whatever was still unconfirmed and the state resets. Each word is
written to stdout as one NDJSON line the moment it is confirmed, so a caller
(eventually the Go Supervisor's streaming relay path) can consume it
line-by-line.

Adapted from two MIT-licensed designs, re-implemented from scratch against
this repo's already-pinned faster-whisper/onnxruntime stack rather than
vendoring either project's code (this repo runs no loopback server; see
docs/architecture/daw-integration.md):
- WhisperLive (https://github.com/collabora/WhisperLive) - VAD-gated audio
  windows, rolling faster-whisper decode, per-word timestamps.
  Copyright (c) 2023 Vineet Suryan, Collabora Ltd.
- whisper_streaming, "Turning Whisper into Real-Time Transcription System"
  (https://github.com/ufal/whisper_streaming) - the LocalAgreement policy for
  emitting only words that consecutive decodes agree on. Copyright (c) 2023 ÚFAL.
Both are recorded in docs/research/local-dependency-evaluation.md.

Usage:
    python live_asr.py --wav segment.wav --model small [--model-dir DIR]
    python live_asr.py --mic "Microphone Array (Realtek(R) Audio)" --model tiny --timing

Output (stdout, one JSON object per line, flushed immediately):
    {"word": "hello", "start": 1.24, "end": 1.51}
Diagnostics go to stderr via narration_common.logging_utils.log, never stdout.
--timing adds decode-time lines and, for --mic, how far behind the speaker
each word was emitted.
"""

import argparse
import itertools
import json
import re
import sys
import time
from pathlib import Path
from typing import Callable, Iterable, Iterator, List, Optional, Tuple

import numpy as np

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "shared" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common.logging_utils import log, set_log_file  # noqa: E402

SAMPLE_RATE = 16000

# (word, start_seconds, end_seconds)
Word = Tuple[str, float, float]
Decoder = Callable[[np.ndarray], List[Word]]

# Mirrors compare.py's PAUSE_GAP_SECONDS (0.6s) - the same "how long a pause
# has to be before it counts as a real break" judgment call, reused here so
# a narrator's felt sense of a pause is consistent between the offline
# Transcript Compare pass and this live view.
PAUSE_GAP_MS = 600
SPEECH_PAD_MS = 200

# How much new audio must arrive before the in-progress speech is decoded
# again. Smaller = words confirmed sooner but more CPU (each decode re-reads
# the whole open segment). With two decodes needed to confirm a word, output
# trails speech by about two of these plus decode time.
DECODE_INTERVAL_SECONDS = 0.5

# Upper bound on how long unbroken speech can accumulate before it is
# force-closed even without a detected pause, bounding both memory and the
# cost of each re-decode. Tune once real mic latency is measured.
MAX_BUFFER_SECONDS = 12.0

CHUNK_SECONDS = 0.32

_NON_WORD_CHARS_RE = re.compile(r"[^\w']")


def _closed_segment_end(speeches: List[dict], buffer_len: int) -> Optional[int]:
    """A leading speech span in `speeches` is "closed" - confirmed by a
    following pause - once VAD has already found a later span (meaning
    silence separated them), or the current span's end sits strictly before
    the buffer's own end (meaning trailing silence already closed it out).
    A single span still touching the buffer's end might just be mid-word;
    it is left open pending more audio.

    Known simplification: VadOptions.speech_pad_ms pads a closing span's end
    forward, so a pause shorter than that padding can be missed as "not yet
    closed" for one extra buffer append. Revisit only if real mic testing
    shows it clips words.
    """
    if not speeches:
        return None
    first = speeches[0]
    if len(speeches) > 1 or first["end"] < buffer_len:
        return first["end"]
    return None


def _normalize_word(word: str) -> str:
    return _NON_WORD_CHARS_RE.sub("", word.lower())


def _confirm_agreed_words(previous: List[Word], current: List[Word], committed: int) -> Tuple[List[Word], int]:
    """LocalAgreement-2: the words `previous` and `current` (consecutive
    decodes of the same growing segment) agree on, as a prefix, are stable.
    Returns the newly stable words past the `committed` count already emitted
    (taken from `current`, which has the newer timings) and the new count.

    Position-based: if a later decode re-splits an already-emitted word (e.g.
    "so-called" -> "so called") the prefix stops agreeing until it settles,
    and afterwards the next emitted word can be off by one (one duplicated
    or dropped). Acceptable for a prototype; downstream matching is fuzzy."""
    agreed = 0
    for old, new in zip(previous, current):
        if _normalize_word(old[0]) != _normalize_word(new[0]):
            break
        agreed += 1
    if agreed <= committed:
        return [], committed
    return current[committed:agreed], agreed


def _to_event(word: Word) -> dict:
    text, start, end = word
    return {"word": text, "start": round(start, 3), "end": round(end, 3)}


def _decode_span(decode: Decoder, buffer: np.ndarray, start: int, end: int, buffer_start_time: float, sample_rate: int) -> List[Word]:
    """Decode buffer[start:end] and return its words in absolute stream time
    (blank words dropped)."""
    offset = buffer_start_time + start / sample_rate
    return [(text, offset + word_start, offset + word_end) for text, word_start, word_end in decode(buffer[start:end]) if text]


def rolling_words(
    chunks: Iterable[np.ndarray],
    decode: Decoder,
    sample_rate: int = SAMPLE_RATE,
    decode_interval_seconds: float = DECODE_INTERVAL_SECONDS,
    max_buffer_seconds: float = MAX_BUFFER_SECONDS,
    detect_speech: Optional[Callable] = None,
) -> Iterator[dict]:
    """Yield append-only word events (absolute stream time) for a stream of
    audio chunks. `detect_speech` defaults to faster_whisper's bundled Silero
    VAD but is injectable so the buffering/agreement logic can be unit-tested
    without loading any model."""
    if detect_speech is None:
        from faster_whisper.vad import get_speech_timestamps

        detect_speech = get_speech_timestamps

    from faster_whisper.vad import VadOptions

    vad_options = VadOptions(min_silence_duration_ms=PAUSE_GAP_MS, speech_pad_ms=SPEECH_PAD_MS)
    interval_samples = int(decode_interval_seconds * sample_rate)
    max_buffer_samples = int(max_buffer_seconds * sample_rate)

    buffer = np.zeros(0, dtype=np.float32)
    buffer_start_time = 0.0
    samples_since_decode = 0
    previous: List[Word] = []
    committed = 0

    for chunk in chunks:
        if len(chunk) == 0:
            continue
        buffer = np.concatenate([buffer, chunk])
        samples_since_decode += len(chunk)

        speeches = detect_speech(buffer, vad_options, sampling_rate=sample_rate)
        flush_end = _closed_segment_end(speeches, len(buffer))
        if flush_end is None and len(buffer) >= max_buffer_samples:
            flush_end = len(buffer)

        if flush_end:
            if speeches:
                final = _decode_span(decode, buffer, speeches[0]["start"], flush_end, buffer_start_time, sample_rate)
                for word in final[committed:]:
                    yield _to_event(word)
            buffer_start_time += flush_end / sample_rate
            buffer = buffer[flush_end:]
            previous, committed, samples_since_decode = [], 0, 0
            continue

        if speeches and samples_since_decode >= interval_samples:
            start = speeches[0]["start"]
            if len(buffer) - start >= interval_samples:
                current = _decode_span(decode, buffer, start, len(buffer), buffer_start_time, sample_rate)
                confirmed, committed = _confirm_agreed_words(previous, current, committed)
                previous = current
                samples_since_decode = 0
                for word in confirmed:
                    yield _to_event(word)

    if len(buffer) > 0:
        speeches = detect_speech(buffer, vad_options, sampling_rate=sample_rate)
        if speeches:
            final = _decode_span(decode, buffer, speeches[0]["start"], len(buffer), buffer_start_time, sample_rate)
            for word in final[committed:]:
                yield _to_event(word)


def make_decoder(model, language: Optional[str], hotwords: Optional[str]) -> Decoder:
    """Wrap a loaded faster-whisper WhisperModel as a plain
    audio -> [(word, start, end)] function, mirroring compare.py's own
    transcribe() word-collection loop. vad_filter is off here: the caller
    already cut this exact span to where VAD found speech."""

    def decode(audio: np.ndarray) -> List[Word]:
        segments, _info = model.transcribe(
            audio,
            language=language,
            word_timestamps=True,
            vad_filter=False,
            hotwords=hotwords or None,
        )
        words = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    words.append((w.word.strip(), w.start, w.end))
        return words

    return decode


def with_decode_timing(decode: Decoder) -> Decoder:
    """Log each decode's audio duration and wall time (and their ratio) to
    stderr, so model sizes can be compared on the same recording. A ratio
    under 1.0 means decoding keeps up with real time."""

    def timed(audio: np.ndarray) -> List[Word]:
        duration = len(audio) / SAMPLE_RATE
        started = time.perf_counter()
        words = decode(audio)
        elapsed = time.perf_counter() - started
        log(f"decode: {duration:.2f}s audio in {elapsed:.2f}s ({elapsed / duration:.2f}x realtime)")
        return words

    return timed


def iter_wav_chunks(path: str, chunk_seconds: float = CHUNK_SECONDS) -> Iterator[np.ndarray]:
    """Decode a whole audio file via PyAV (same resample pattern as
    compare.py's own file decode) and replay it as fixed-size chunks, so a
    recorded file can stand in for live mic input. It replays as fast as the
    CPU allows, so it checks accuracy but not real-time lag."""
    import av

    container = av.open(path)
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)

    samples = []
    for frame in container.decode(stream):
        for rframe in resampler.resample(frame):
            samples.append(rframe.to_ndarray()[0].astype(np.float32))
    container.close()

    audio = np.concatenate(samples) if samples else np.zeros(0, dtype=np.float32)
    chunk_samples = max(1, int(chunk_seconds * SAMPLE_RATE))
    for start in range(0, len(audio), chunk_samples):
        yield audio[start : start + chunk_samples]


def iter_microphone_chunks(device_name: str, chunk_seconds: float = CHUNK_SECONDS) -> Iterator[np.ndarray]:
    """Capture live mic audio via PyAV's Windows dshow input, resampled the
    same way as iter_wav_chunks. Manual-testing path only (device
    enumeration/selection UX is an explicit open item in the architecture
    brief, not resolved here) - not exercised by the automated test suite.
    Ctrl+C ends the stream so buffered audio is still decoded."""
    import av

    container = av.open(file=f"audio={device_name}", format="dshow")
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
    chunk_samples = max(1, int(chunk_seconds * SAMPLE_RATE))

    pending = np.zeros(0, dtype=np.float32)
    try:
        for frame in container.decode(stream):
            for rframe in resampler.resample(frame):
                pending = np.concatenate([pending, rframe.to_ndarray()[0].astype(np.float32)])
                while len(pending) >= chunk_samples:
                    yield pending[:chunk_samples]
                    pending = pending[chunk_samples:]
    except KeyboardInterrupt:
        log("Stopping...")
    finally:
        container.close()
    if len(pending) > 0:
        yield pending


def _anchor_capture_clock(chunks: Iterator[np.ndarray]) -> Tuple[Iterator[np.ndarray], float]:
    """Pull the first chunk so the wall clock can be anchored to when capture
    actually began (its audio time zero), independent of model load and
    device-open time."""
    first = next(chunks, None)
    if first is None:
        return iter(()), time.perf_counter()
    return itertools.chain([first], chunks), time.perf_counter() - len(first) / SAMPLE_RATE


def main() -> None:
    ap = argparse.ArgumentParser(description="Stream live word-timestamp ASR as NDJSON for the Manuscript Teleprompter prototype")
    ap.add_argument("--wav", default=None, help="Replay this audio file as if it were live mic input (fixture testing)")
    ap.add_argument("--mic", default=None, help="Capture from this input device name instead of --wav (Windows dshow device name)")
    ap.add_argument("--model", default="small", help="Whisper model size (tiny/base/small/medium/large-v3-turbo/large-v3)")
    ap.add_argument(
        "--model-dir",
        default=None,
        help="Local, already-verified model directory from the whisper asset catalog (shell/internal/whisper); omit to let faster-whisper resolve --model itself for direct/manual CLI use",
    )
    ap.add_argument("--language", default=None, help="Force language code, e.g. 'en' (default: auto-detect)")
    ap.add_argument("--hotwords", default=None, help="Comma-separated vocabulary hints passed to faster-whisper as hotwords")
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Inference device (default: cpu)")
    ap.add_argument("--timing", action="store_true", help="Log each decode's wall time and, with --mic, how far behind the speaker each word was emitted")
    ap.add_argument("--log", default=None, help="Path to also mirror log output to (optional)")
    args = ap.parse_args()

    if args.log:
        set_log_file(open(args.log, "a", encoding="utf-8"))
    if not args.wav and not args.mic:
        ap.error("one of --wav or --mic is required")

    from faster_whisper import WhisperModel

    compute_type = "int8" if args.device == "cpu" else "float16"
    log(f"Loading Whisper model '{args.model}'{' from the locally verified asset cache' if args.model_dir else ''}...")
    model = WhisperModel(args.model_dir or args.model, device=args.device, compute_type=compute_type, local_files_only=bool(args.model_dir))
    decode = make_decoder(model, args.language, args.hotwords)
    if args.timing:
        decode = with_decode_timing(decode)

    chunks = iter_wav_chunks(args.wav) if args.wav else iter_microphone_chunks(args.mic)
    log("Listening..." if args.mic else f"Replaying {args.wav}...")
    capture_started = None
    try:
        if args.mic:
            chunks, capture_started = _anchor_capture_clock(chunks)
        for event in rolling_words(chunks, decode):
            print(json.dumps(event), flush=True)
            if args.timing and capture_started is not None:
                log(f"lag {time.perf_counter() - capture_started - event['end']:.2f}s behind: {event['word']}")
    except KeyboardInterrupt:
        log("Stopped.")


if __name__ == "__main__":
    main()
