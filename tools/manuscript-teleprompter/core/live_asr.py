"""
Live word-timestamp ASR sidecar for the Manuscript Teleprompter (see
docs/architecture/manuscript-teleprompter.md). Captures audio (mic or a
replayed WAV file for fixture testing / latency measurement), holds a
growing buffer, and flushes it through faster-whisper for decode whenever
Silero VAD (faster-whisper's own bundled model - no new dependency) reports
a confirmed pause, or the buffer grows past MAX_BUFFER_SECONDS. Each decoded
word is written to stdout as one NDJSON line the instant it's known, so a
caller (eventually the Go Supervisor's streaming relay path) can consume it
line-by-line instead of waiting for a whole utterance.

This is a same-shape adaptation of WhisperLive's documented streaming design
(https://github.com/collabora/WhisperLive) - VAD-gated audio windows,
rolling faster-whisper decode, real per-word timestamps - re-implemented
from scratch against this repo's already-pinned faster-whisper/onnxruntime
stack rather than vendoring WhisperLive's own client/server code (this repo
runs no loopback server; see docs/architecture/daw-integration.md). Per
docs/architecture/manuscript-teleprompter.md's license note, this is
recorded as the first "ported logic" entry in
docs/research/local-dependency-evaluation.md.
WhisperLive is MIT-licensed: Copyright (c) 2023 Vineet Suryan, Collabora Ltd.

Usage:
    python live_asr.py --wav segment.wav --model small [--model-dir DIR]
    python live_asr.py --mic "Microphone (Realtek Audio)" --model small

Output (stdout, one JSON object per line, flushed immediately):
    {"word": "hello", "start": 1.24, "end": 1.51}
Diagnostics go to stderr via narration_common.logging_utils.log, never stdout.
"""

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Iterator, List, Optional, Tuple

import numpy as np

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "shared" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common.logging_utils import log, set_log_file  # noqa: E402

SAMPLE_RATE = 16000

# Mirrors compare.py's PAUSE_GAP_SECONDS (0.6s) - the same "how long a pause
# has to be before it counts as a real break" judgment call, reused here so
# a narrator's felt sense of a pause is consistent between the offline
# Transcript Compare pass and this live view.
PAUSE_GAP_MS = 600
SPEECH_PAD_MS = 200

# Upper bound on how long unbroken speech can accumulate before it is
# force-flushed even without a detected pause, so one very long sentence
# can't grow latency (or memory) unboundedly. Not resolved by the
# architecture brief - this default is exactly the "latency tradeoff"
# question the day-1 prototype exists to answer; expect to tune it once
# real mic latency is measured.
MAX_BUFFER_SECONDS = 12.0

CHUNK_SECONDS = 0.32


@dataclass(frozen=True)
class SpeechSegment:
    """A contiguous, VAD-closed (or force-flushed) span of buffered audio,
    with its absolute offset from the start of the stream."""

    audio: np.ndarray
    start_time: float


def _closed_segment_end(speeches: List[dict], buffer_len: int) -> Optional[int]:
    """A leading speech span in `speeches` is "closed" - confirmed by a
    following pause - once VAD has already found a later span (meaning
    silence separated them), or the current span's end sits strictly before
    the buffer's own end (meaning trailing silence already closed it out).
    A single span still touching the buffer's end might just be mid-word;
    it is left open pending more audio.

    Known simplification: VadOptions.speech_pad_ms pads a closing span's end
    forward, so a pause shorter than that padding can be missed as "not yet
    closed" for one extra buffer append. Acceptable for a day-1 prototype;
    revisit only if real mic testing shows it clips words.
    """
    if not speeches:
        return None
    first = speeches[0]
    if len(speeches) > 1 or first["end"] < buffer_len:
        return first["end"]
    return None


def segment_stream(
    chunks: Iterable[np.ndarray],
    sample_rate: int = SAMPLE_RATE,
    max_buffer_seconds: float = MAX_BUFFER_SECONDS,
    detect_speech: Callable = None,
) -> Iterator[SpeechSegment]:
    """Accumulate incoming audio chunks into a buffer and yield it in
    VAD-paused (or force-flushed) spans. `detect_speech` defaults to
    faster_whisper's bundled Silero VAD but is injectable so the flush/carry
    logic can be unit-tested without loading any model."""
    if detect_speech is None:
        from faster_whisper.vad import get_speech_timestamps

        detect_speech = get_speech_timestamps

    from faster_whisper.vad import VadOptions

    vad_options = VadOptions(min_silence_duration_ms=PAUSE_GAP_MS, speech_pad_ms=SPEECH_PAD_MS)
    max_buffer_samples = int(max_buffer_seconds * sample_rate)

    buffer = np.zeros(0, dtype=np.float32)
    buffer_start_time = 0.0

    for chunk in chunks:
        if len(chunk) == 0:
            continue
        buffer = np.concatenate([buffer, chunk])

        speeches = detect_speech(buffer, vad_options, sampling_rate=sample_rate)
        flush_end = _closed_segment_end(speeches, len(buffer))
        if flush_end is None and len(buffer) >= max_buffer_samples:
            flush_end = len(buffer)

        if flush_end:
            yield SpeechSegment(audio=buffer[:flush_end].copy(), start_time=buffer_start_time)
            buffer_start_time += flush_end / sample_rate
            buffer = buffer[flush_end:]

    if len(buffer) > 0:
        yield SpeechSegment(audio=buffer, start_time=buffer_start_time)


def stream_words(
    segments: Iterable[SpeechSegment],
    decode: Callable[[np.ndarray], List[Tuple[str, float, float]]],
) -> Iterator[dict]:
    """Decode each flushed segment and rebase its word timestamps from
    segment-relative to absolute stream time."""
    for segment in segments:
        if len(segment.audio) == 0:
            continue
        for word, start, end in decode(segment.audio):
            if not word:
                continue
            yield {
                "word": word,
                "start": round(segment.start_time + start, 3),
                "end": round(segment.start_time + end, 3),
            }


def make_decoder(model, language: Optional[str], hotwords: Optional[str]) -> Callable[[np.ndarray], List[Tuple[str, float, float]]]:
    """Wrap a loaded faster-whisper WhisperModel as a plain
    audio -> [(word, start, end)] function, mirroring compare.py's own
    transcribe() word-collection loop. vad_filter is off here: segment_stream
    already isolated this exact span as one VAD-closed utterance."""

    def decode(audio: np.ndarray) -> List[Tuple[str, float, float]]:
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


def iter_wav_chunks(path: str, chunk_seconds: float = CHUNK_SECONDS) -> Iterator[np.ndarray]:
    """Decode a whole audio file via PyAV (same resample pattern as
    compare.py's own file decode) and replay it as fixed-size chunks, so a
    recorded WAV can stand in for live mic input - for the fixture test and
    for measuring model-size/latency tradeoffs against a known reading."""
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
    brief, not resolved here) - not exercised by the automated test suite."""
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
    finally:
        container.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Stream live word-timestamp ASR as NDJSON for the Manuscript Teleprompter prototype")
    ap.add_argument("--wav", default=None, help="Replay this audio file as if it were live mic input (fixture testing / latency measurement)")
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

    chunks = iter_wav_chunks(args.wav) if args.wav else iter_microphone_chunks(args.mic)
    log("Listening..." if args.mic else f"Replaying {args.wav}...")
    for event in stream_words(segment_stream(chunks), decode):
        print(json.dumps(event), flush=True)


if __name__ == "__main__":
    main()
