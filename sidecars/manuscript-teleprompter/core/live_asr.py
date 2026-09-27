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
    python live_asr.py --engine moonshine --model small --model-dir DIR --mic "Microphone Array" --context script.txt --timing
(moonshine-voice is a Windows-only dependency, loaded by moonshine_engine.py. From source, omitting --model-dir lets the
library download the model itself; the frozen sidecar refuses to and needs a catalog install.)

Output (stdout, one JSON object per line, flushed immediately; times are
seconds of stream time). Engines only produce hypotheses; one shared layer
turns them into these three event types:
    {"type": "partial", "segment": 0, "words": [{"word": "hello", "start": 1.24, "end": 1.51}]}
        the whole current reading of the open segment; REPLACES the previous
        partial and may still change - use it for speculative cursor movement
    {"type": "word", "segment": 0, "word": "hello", "start": 1.24, "end": 1.51}
        a confirmed word; append-only, never retracted
    {"type": "segment_end", "segment": 0}
        the segment closed; all its words were emitted as `word` events first
    {"type": "position", "read": 12, "committed": 10, "status": "listening", "jump": null, "skipped": null}
        only with --script FILE or --manuscript FILE --chapter X: where the
        narrator is in the script, on change only (see script_tracker.py);
        replay.py runs recorded output through the same tracker offline. A
        session can also start already at a word with --start-word N, and
        while running the host can move it there with --control-file PATH,
        which is tailed for lines shaped {"cmd": "seek", "word": N}
        (control_channel.py) - both emit a "position" event with
        jump: "restart", the same sentinel-file pattern as --stop-file.
        {"cmd": "pause"} and {"cmd": "resume"} on the same file stop and
        restart listening: the device stays open and levels still flow, but
        the engine hears nothing and the tracker's clock stands still
    {"type": "flag", "id": 1, "kind": "misread", "start": 7, "end": 8, "heard": "chairs"}
        with a tracker, after a segment closes: a suspected misread, extra,
        skipped or restart, judged from confirmed words only (see flags.py)
    {"type": "script", "chapter": {"id": "c1", "title": "..."}, "tokens": 512, "spans": [{"kind": "paragraph", "id": "p1", "index": 0, "start": 6, "count": 4}]}
        once, first, only with --manuscript (or a --script named with
        --script-id and --script-title, the credits): how the chapter was
        tokenized (title, then each paragraph split on whitespace; a named
        script has no title and one paragraph per line) so a frontend can
        map `read` indices onto paragraphs and words (see chapter_script.py)
    {"type": "devices", "devices": [{"name": "Microphone Array (Realtek(R) Audio)"}], "error": null}
        only with --list-devices: the input devices the --mic capture path
        (iter_microphone_chunks, below) can open, by the same name dshow
        opens them under (see devices.py); prints once and exits, no
        --wav/--mic session follows. `error` is set (devices always []) if
        listing failed - a caller must never treat that as "no microphones".
    {"type": "engine_check", "engine": "moonshine", "ok": true, "detail": "moonshine-voice 0.1.5: ..."}
        only with --check-moonshine: whether this build can run Moonshine (see
        moonshine_engine.py); prints once and exits, 1 if not. The packaged
        app's smoke test reads it.
    {"type": "locate", "word": 812, "sentence": {...}, "confidence": 0.84, "confident": true, ...}
        only with --locate --wav FILE --tail-start S --tail-end E: seconds S
        to E of a recording, placed in the script; prints once and exits,
        no session follows (see locate.py for every field)
    {"type": "level", "peak": -12.3, "rms": -24.1}
        the input level in dBFS every 100 ms of audio, in every session (see
        levels.py). With --meter --mic NAME it is the only event: no model,
        no script, until the stop file appears, so the narrator can check the
        microphone before Start
Word timings come from the engine and are advisory: they can be noisy or run
backwards (Moonshine's do, mostly in partials), so the only guarantee is that
`end` is never before `start`. Consumers should rely on word ORDER, not times.
Diagnostics go to stderr via narration_common.logging_utils.log, never stdout.
--timing adds decode-time lines and, for --mic, how far behind the speaker
each partial and confirmed word was emitted.
"""

import argparse
import difflib
import itertools
import json
import re
import sys
import time
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path

import numpy as np

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "libs" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common.logging_utils import log, set_log_file

# Word and Hypothesis are the speech engine port's types (provider-ports P3); they are re-exported here so `live_asr.Hypothesis`
# and every other existing import keep working.
from narration_common.ports.asr import Hypothesis, Word

SAMPLE_RATE = 16000

Decoder = Callable[[np.ndarray], list[Word]]

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

# Moonshine streaming model sizes selectable with --engine moonshine
# (English only for now).
MOONSHINE_ARCHS = {"tiny": "TINY_STREAMING", "small": "SMALL_STREAMING", "medium": "MEDIUM_STREAMING"}

# Upper bound on how long unbroken speech can accumulate before it is
# force-closed even without a detected pause, bounding both memory and the
# cost of each re-decode. Tune once real mic latency is measured.
MAX_BUFFER_SECONDS = 12.0

CHUNK_SECONDS = 0.32

_NON_WORD_CHARS_RE = re.compile(r"[^\w']")


def _closed_segment_end(speeches: list[dict], buffer_len: int) -> int | None:
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


def _confirm_agreed_words(previous: list[Word], current: list[Word], committed: int) -> tuple[list[Word], int]:
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


def _word_json(word: Word) -> dict:
    """A word as an event field set. Engine timings are advisory and can be
    noisy (Moonshine's occasionally run backwards), so the one thing guaranteed
    here is a non-negative duration."""
    text, start, end = word
    return {"word": text, "start": round(start, 3), "end": round(max(end, start), 3)}


def _decode_span(decode: Decoder, buffer: np.ndarray, start: int, end: int, buffer_start_time: float, sample_rate: int) -> list[Word]:
    """Decode buffer[start:end] and return its words in absolute stream time
    (blank words dropped)."""
    offset = buffer_start_time + start / sample_rate
    return [(text, offset + word_start, offset + word_end) for text, word_start, word_end in decode(buffer[start:end]) if text]


def whisper_hypotheses(
    chunks: Iterable[np.ndarray],
    decode: Decoder,
    sample_rate: int = SAMPLE_RATE,
    decode_interval_seconds: float = DECODE_INTERVAL_SECONDS,
    max_buffer_seconds: float = MAX_BUFFER_SECONDS,
    detect_speech: Callable | None = None,
) -> Iterator[Hypothesis]:
    """The Whisper engine: buffer audio, re-decode the open segment every
    decode interval (a non-final Hypothesis each time) and close it with one
    last decode (a final Hypothesis) on a VAD-confirmed pause, the size cap,
    or end of stream. `detect_speech` defaults to faster_whisper's bundled
    Silero VAD but is injectable so the buffering logic can be unit-tested
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
    segment = 0

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
                words = _decode_span(decode, buffer, speeches[0]["start"], flush_end, buffer_start_time, sample_rate)
                yield Hypothesis(segment, tuple(words), final=True)
                segment += 1
            buffer_start_time += flush_end / sample_rate
            buffer = buffer[flush_end:]
            samples_since_decode = 0
            continue

        if speeches and samples_since_decode >= interval_samples:
            start = speeches[0]["start"]
            if len(buffer) - start >= interval_samples:
                words = _decode_span(decode, buffer, start, len(buffer), buffer_start_time, sample_rate)
                samples_since_decode = 0
                yield Hypothesis(segment, tuple(words), final=False)

    if len(buffer) > 0:
        speeches = detect_speech(buffer, vad_options, sampling_rate=sample_rate)
        if speeches:
            words = _decode_span(decode, buffer, speeches[0]["start"], len(buffer), buffer_start_time, sample_rate)
            yield Hypothesis(segment, tuple(words), final=True)


def confirmed_events(hypotheses: Iterable[Hypothesis]) -> Iterator[dict]:
    """The engine-independent event layer. Every non-final hypothesis becomes a
    `partial` event (the whole current reading, replace semantics, may still
    change); words two consecutive hypotheses agree on become append-only
    `word` events; a final hypothesis flushes its unconfirmed words and ends
    with `segment_end`, after which agreement state resets."""
    previous: list[Word] = []
    committed = 0
    for hypothesis in hypotheses:
        words = list(hypothesis.words)
        if hypothesis.final:
            for word in words[committed:]:
                yield {"type": "word", "segment": hypothesis.segment, **_word_json(word)}
            yield {"type": "segment_end", "segment": hypothesis.segment}
            previous, committed = [], 0
            continue
        yield {"type": "partial", "segment": hypothesis.segment, "words": [_word_json(w) for w in words]}
        confirmed, committed = _confirm_agreed_words(previous, words, committed)
        previous = words
        for word in confirmed:
            yield {"type": "word", "segment": hypothesis.segment, **_word_json(word)}


def whisper_events(chunks: Iterable[np.ndarray], decode: Decoder, **engine_options) -> Iterator[dict]:
    """The Whisper engine wired to the shared event layer."""
    return confirmed_events(whisper_hypotheses(chunks, decode, **engine_options))


def _align_timings_to_text(tokens: list[str], timed: list[Word], line_start: float, line_end: float) -> list[Word]:
    """Give each of the text's tokens a timing: copy it from the matching timed
    word, or spread the tokens with no match evenly across the gap between
    their timed neighbours. The text is authoritative because Moonshine's
    timing list can omit a word the text contains (seen on a final line whose
    text had 3 words and timings for 2)."""
    matcher = difflib.SequenceMatcher(None, [_normalize_word(t) for t in tokens], [_normalize_word(w[0]) for w in timed], autojunk=False)
    matched: dict[int, tuple[float, float]] = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            matched[block.a + offset] = timed[block.b + offset][1:]

    words: list[Word] = []
    previous_end = line_start
    index = 0
    while index < len(tokens):
        if index in matched:
            start, end = matched[index]
            words.append((tokens[index], start, end))
            previous_end = end
            index += 1
            continue
        run_end = index
        while run_end < len(tokens) and run_end not in matched:
            run_end += 1
        next_start = max(matched[run_end][0] if run_end < len(tokens) else line_end, previous_end)
        step = (next_start - previous_end) / (run_end - index)
        words.extend((tokens[index + n], previous_end + n * step, previous_end + (n + 1) * step) for n in range(run_end - index))
        index = run_end
    return words


def _moonshine_words(line) -> tuple[Word, ...]:
    """A Moonshine line's words in absolute stream time (its word timings are
    already absolute): the text's own words, with timings aligned onto them."""
    timed = [(w.word.strip(), w.start, w.end) for w in (line.words or []) if w.word.strip()]
    return tuple(_align_timings_to_text(line.text.split(), timed, line.start_time, line.start_time + line.duration))


def _take_all(items: list) -> list:
    batch = list(items)
    items.clear()
    return batch


def moonshine_hypotheses(chunks: Iterable[np.ndarray], transcriber, sample_rate: int = SAMPLE_RATE) -> Iterator[Hypothesis]:
    """The Moonshine engine: feed audio to a streaming Transcriber and turn
    its line events into hypotheses - LineTextChanged is a non-final reading
    of the open line, LineCompleted its final one (in practice identical to
    the last partial, so it closes the segment rather than correcting it).

    Events are matched by class name so this needs no moonshine import, and
    tests can drive it with a fake transcriber. Moonshine's own line ids are
    huge, so segments are renumbered 0, 1, 2... in order of first appearance."""
    pending: list[Hypothesis] = []
    segments: dict[int, int] = {}

    def on_event(event) -> None:
        kind = type(event).__name__
        if kind not in ("LineTextChanged", "LineCompleted"):
            return
        final = kind == "LineCompleted"
        words = _moonshine_words(event.line)
        if not words and not final:
            return
        segment = segments.setdefault(event.line.line_id, len(segments))
        pending.append(Hypothesis(segment, words, final))

    transcriber.add_listener(on_event)
    transcriber.start()
    for chunk in chunks:
        transcriber.add_audio(chunk.tolist(), sample_rate)
        yield from _take_all(pending)
    transcriber.stop()
    yield from _take_all(pending)


def make_decoder(model, language: str | None, hotwords: str | None, vad_filter: bool = False) -> Decoder:
    """Wrap a loaded faster-whisper WhisperModel as a plain
    audio -> [(word, start, end)] function, mirroring compare.py's own
    transcribe() word-collection loop. vad_filter is off for the live engine:
    the caller already cut this exact span to where VAD found speech. The
    tail-audio locate (locate.py) turns it on, since a recording's tail
    usually ends in room tone Whisper would otherwise put words into."""

    def decode(audio: np.ndarray) -> list[Word]:
        segments, _info = model.transcribe(
            audio,
            language=language,
            word_timestamps=True,
            vad_filter=vad_filter,
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

    def timed(audio: np.ndarray) -> list[Word]:
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
    enumeration/selection UX is planned in
    docs/prds/teleprompter-engines-and-input-devices.prd.md, not resolved
    here) - not exercised by the automated test suite.
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


def _anchor_capture_clock(chunks: Iterator[np.ndarray]) -> tuple[Iterator[np.ndarray], float]:
    """Pull the first chunk so the wall clock can be anchored to when capture
    actually began (its audio time zero), independent of model load and
    device-open time."""
    first = next(chunks, None)
    if first is None:
        return iter(()), time.perf_counter()
    return itertools.chain([first], chunks), time.perf_counter() - len(first) / SAMPLE_RATE


def event_lag_seconds(event: dict, elapsed: float) -> float | None:
    """How far behind the speaker an event is: capture-relative wall time
    minus the end of the newest word it carries (None if it carries none)."""
    if event["type"] == "word":
        return elapsed - event["end"]
    if event["type"] == "partial" and event["words"]:
        return elapsed - event["words"][-1]["end"]
    return None


class StreamClock:
    """Stream time for the script tracker: wall time since capture began for a
    mic, or the audio consumed so far for a file (which replays faster than
    real time). While paused it stands still, and after a resume it runs on
    without the paused time, so the tracker's pause timeout never counts a
    pause the narrator asked for (ADR 0248)."""

    def __init__(self, capture_started: float | None = None, time_fn: Callable[[], float] = time.perf_counter) -> None:
        self._capture_started = capture_started
        self._time = time_fn
        self._audio_seconds = 0.0
        self._paused_at: float | None = None
        self._paused_total = 0.0

    def note_chunk(self, chunk: np.ndarray) -> None:
        self._audio_seconds += len(chunk) / SAMPLE_RATE

    def _raw(self) -> float:
        if self._capture_started is None:
            return self._audio_seconds
        return self._time() - self._capture_started

    def pause(self) -> None:
        if self._paused_at is None:
            self._paused_at = self._raw()

    def resume(self) -> None:
        if self._paused_at is not None:
            self._paused_total += self._raw() - self._paused_at
            self._paused_at = None

    @property
    def paused(self) -> bool:
        return self._paused_at is not None

    def now(self) -> float:
        raw = self._paused_at if self._paused_at is not None else self._raw()
        return raw - self._paused_total


def stoppable(chunks: Iterable[np.ndarray], stop_path: str | None) -> Iterator[np.ndarray]:
    """End the stream, so the engine flushes and the process exits normally,
    as soon as the sentinel file `stop_path` exists. This is how a parent that
    cannot send Ctrl+C (the Go host) asks for a clean stop, matching the
    `.cancel` sentinels the other sidecars use."""
    for chunk in chunks:
        if stop_path and Path(stop_path).exists():
            return
        yield chunk


def ticking(chunks: Iterable[np.ndarray], clock: StreamClock, on_tick: Callable[[float], None]) -> Iterator[np.ndarray]:
    """Pass chunks through, reporting the stream time as each arrives, so
    time-based status (the tracker's pause timeout) advances even while the
    engine emits nothing."""
    for chunk in chunks:
        clock.note_chunk(chunk)
        on_tick(clock.now())
        yield chunk


def gated(chunks: Iterable[np.ndarray], is_paused: Callable[[], bool]) -> Iterator[np.ndarray]:
    """Pass chunks through except while paused, when they are read from the
    device and dropped: the device stays open, so a resume is instant, and the
    engine never hears the pause (ADR 0248)."""
    for chunk in chunks:
        if not is_paused():
            yield chunk


EventStream = Callable[[Iterable[np.ndarray]], Iterator[dict]]


def _load_whisper_decoder(args, vad_filter: bool = False) -> Decoder:
    from faster_whisper import WhisperModel

    compute_type = "int8" if args.device == "cpu" else "float16"
    log(f"Loading Whisper model '{args.model}'{' from the locally verified asset cache' if args.model_dir else ''}...")
    model = WhisperModel(args.model_dir or args.model, device=args.device, compute_type=compute_type, local_files_only=bool(args.model_dir))
    decode = make_decoder(model, args.language, args.hotwords, vad_filter=vad_filter)
    return with_decode_timing(decode) if args.timing else decode


def _load_whisper_engine(args) -> EventStream:
    """Load the model now; return a function that streams events for a chunk
    source (so loading never overlaps with live capture)."""
    decode = _load_whisper_decoder(args)
    return lambda chunks: whisper_events(chunks, decode, decode_interval_seconds=args.decode_interval)


def _run_locate(ap: argparse.ArgumentParser, args) -> None:
    """--locate: place a recording's tail in the chapter and print one `locate` line (locate.py). The chapter is
    checked before the model loads, so a wrong chapter fails fast."""
    import locate
    from chapter_script import ChapterError

    locate.check_args(ap, args)
    _check_engine_args(ap, args)
    try:
        tokens, breaks = locate.load_script(args)
    except ChapterError as error:
        choices = f" Choose one of: {'; '.join(error.candidates)}" if error.candidates else ""
        ap.error(f"{error}{choices}")
    decode = _load_whisper_decoder(args, vad_filter=True)
    log(f"Locating seconds {args.tail_start:g} to {args.tail_end:g} of {args.wav}...")
    _emit(locate.run(args.wav, args.tail_start, args.tail_end, tokens, breaks, decode))


def _load_moonshine_engine(args) -> EventStream:
    # Which model files are loaded, and the refusal to download from the frozen sidecar, live in moonshine_engine.py.
    from moonshine_engine import load_transcriber

    transcriber = load_transcriber(MOONSHINE_ARCHS[args.model], args.model_dir, args.decode_interval, args.hotwords, args.context_text)

    def stream(chunks: Iterable[np.ndarray]) -> Iterator[dict]:
        try:
            yield from confirmed_events(moonshine_hypotheses(chunks, transcriber))
        finally:
            transcriber.close()

    return stream


def _check_engine_args(ap: argparse.ArgumentParser, args) -> None:
    if args.engine == "moonshine":
        if args.model not in MOONSHINE_ARCHS:
            ap.error(f"--engine moonshine supports --model {'/'.join(MOONSHINE_ARCHS)}, not {args.model!r}")
        if args.language not in (None, "en"):
            ap.error("--engine moonshine is English only for now")
    elif args.context:
        ap.error("--context is only supported with --engine moonshine")
    if bool(args.manuscript) != bool(args.chapter):
        ap.error("--manuscript and --chapter go together")
    has_tracker = bool(args.manuscript or args.script)
    if args.start_word is not None and not has_tracker:
        ap.error("--start-word needs --script or --manuscript")
    if args.control_file and not has_tracker:
        ap.error("--control-file needs --script or --manuscript")
    if bool(args.script_id) != bool(args.script_title):
        ap.error("--script-id and --script-title go together")
    if args.script_id and not args.script:
        ap.error("--script-id needs --script")


def _load_script(ap: argparse.ArgumentParser, args):
    """(tracker, `script` event, chapter text) for --manuscript/--chapter or
    --script, or all None. A --script named with --script-id/--script-title
    (the credits, ADR 0150) gets a `script` event like a chapter; a plain
    --script does not. Sibling modules are imported only when needed."""
    from flags import FlaggingTracker
    from script_tracker import script_words

    if args.manuscript or args.script_id:
        from chapter_script import ChapterError, load_chapter_script, load_text_script, script_event

        try:
            if args.manuscript:
                chapter = load_chapter_script(args.manuscript, args.chapter)
            else:
                chapter = load_text_script(args.script, args.script_id, args.script_title)
        except ChapterError as error:
            choices = f" Choose one of: {'; '.join(error.candidates)}" if error.candidates else ""
            ap.error(f"{error}{choices}")
        return FlaggingTracker(chapter.tokens), script_event(chapter), chapter.text
    if args.script:
        return FlaggingTracker(script_words(Path(args.script).read_text(encoding="utf-8"))), None, None
    return None, None, None


def _emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


def _run(args, stream: EventStream, chunks: Iterator[np.ndarray], tracker) -> None:
    """Stream engine events (and, with a tracker, the position events they
    cause) to stdout until the input ends or Ctrl+C."""
    from control_channel import ControlChannel, pause_state, seek_word
    from levels import LevelMeter, metered

    capture_started = None
    last_logged_commit = None

    def track(position: dict) -> dict:
        """Debug-log a tracker position, sampled so a session's ~0.32s ticks don't flood the log: a jump (resync)
        always logs, and a plain commit logs only when the committed word actually advances. A tracker can also emit
        a `flag` event (script_tracker.py, flags.py) carrying the heard words as content, which this must never
        touch, so anything that is not a `position` passes straight through."""
        nonlocal last_logged_commit
        if position.get("type") != "position":
            return position
        if position.get("jump"):
            log(
                "the tracker resynced",
                level="debug",
                event="teleprompter.tracker_resync",
                read=position["read"],
                committed=position["committed"],
                status=position["status"],
                jump=position["jump"],
                skipped=len(position["skipped"]) if position.get("skipped") else 0,
            )
            last_logged_commit = position["committed"]
        elif position["committed"] != last_logged_commit:
            log(
                "the tracker committed",
                level="debug",
                event="teleprompter.tracker_commit",
                read=position["read"],
                committed=position["committed"],
                status=position["status"],
            )
            last_logged_commit = position["committed"]
        return position

    try:
        if args.mic:
            chunks, capture_started = _anchor_capture_clock(chunks)
        clock = StreamClock(capture_started)
        if tracker and args.start_word is not None:
            for position in tracker.reset_to(args.start_word, clock.now()):
                _emit(track(position))
        chunks = metered(stoppable(chunks, args.stop_file), LevelMeter(), _emit)
        if tracker:
            control = ControlChannel(args.control_file)

            def on_tick(now: float) -> None:
                for command in control.poll():
                    paused = pause_state(command)
                    if paused is not None:
                        clock.pause() if paused else clock.resume()
                    word = seek_word(command)
                    if word is not None:
                        for position in tracker.reset_to(word, clock.now()):
                            _emit(track(position))
                for position in tracker.tick(clock.now()):
                    _emit(track(position))

            chunks = gated(ticking(chunks, clock, on_tick), lambda: clock.paused)
        for event in stream(chunks):
            _emit(event)
            if tracker:
                for tracked in tracker.feed(event, clock.now()):
                    _emit(track(tracked))
            if args.timing and capture_started is not None:
                lag = event_lag_seconds(event, clock.now())
                if lag is not None:
                    log(f"lag {lag:.2f}s behind ({event['type']})")
    except KeyboardInterrupt:
        log("Stopped.")


# What --meter cannot be combined with: it opens a microphone and reports its level, nothing else.
_SESSION_ONLY_OPTIONS = ("wav", "manuscript", "script", "control_file", "start_word", "locate", "list_devices", "check_moonshine")


def _run_meter(ap: argparse.ArgumentParser, args) -> None:
    """--meter: report the microphone's level (levels.py) until the stop file appears. No model loads and no script is
    read, so it starts in about the time the device takes to open (read-aloud-control-bar PRD Phase 4, Q6 A)."""
    from levels import LevelMeter, metered

    if not args.mic:
        ap.error("--meter needs --mic")
    taken = [f"--{name.replace('_', '-')}" for name in _SESSION_ONLY_OPTIONS if getattr(args, name) not in (None, False)]
    if taken:
        ap.error(f"--meter takes only --mic and --stop-file, not {' '.join(taken)}")
    log(f"Metering {args.mic}...")
    try:
        for _chunk in metered(stoppable(iter_microphone_chunks(args.mic), args.stop_file), LevelMeter(), _emit):
            pass
    except KeyboardInterrupt:
        log("Stopped.")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Stream live word-timestamp ASR as NDJSON for the Manuscript Teleprompter prototype")
    ap.add_argument(
        "--list-devices",
        action="store_true",
        help="Print the input devices the --mic capture path can open (one JSON object: {type: devices, devices: [...], error}), then exit",
    )
    ap.add_argument(
        "--check-moonshine",
        action="store_true",
        help="Print whether this build can run --engine moonshine (one JSON object: {type: engine_check, engine, ok, detail}), then exit (1 if not)",
    )
    ap.add_argument(
        "--meter",
        action="store_true",
        help="Report only the --mic input level ({type: level, peak, rms} in dBFS every 100 ms) until --stop-file appears; no model, no script",
    )
    ap.add_argument("--wav", default=None, help="Replay this audio file as if it were live mic input (fixture testing)")
    ap.add_argument("--mic", default=None, help="Capture from this input device name instead of --wav (Windows dshow device name)")
    ap.add_argument("--engine", default="whisper", choices=["whisper", "moonshine"], help="Live ASR engine (default: whisper); both emit the same events")
    ap.add_argument(
        "--model",
        default="small",
        help="Model size: whisper tiny/base/small/medium/large-v3-turbo/large-v3, or moonshine tiny/small/medium (streaming)",
    )
    ap.add_argument(
        "--model-dir",
        default=None,
        help="Local, already-verified model directory from the engine's asset catalog (apps/desktop/internal/whisper or internal/moonshine); "
        "omit to let the engine's library resolve --model itself for direct/manual CLI use (Moonshine: source runs only, the frozen sidecar requires it)",
    )
    ap.add_argument("--language", default=None, help="Force language code, e.g. 'en' (default: auto-detect)")
    ap.add_argument("--hotwords", default=None, help="Comma-separated vocabulary hints (faster-whisper hotwords, or Moonshine key terms)")
    ap.add_argument("--context", default=None, help="Text file (e.g. the script passage) whose unusual words Moonshine is biased toward; moonshine only")
    script_source = ap.add_mutually_exclusive_group()
    script_source.add_argument("--script", default=None, help="Plain-text script being read; adds `position` events (see script_tracker.py) to the stream")
    script_source.add_argument(
        "--manuscript", default=None, help="Canonical manuscript.json to read the script from (needs --chapter); also emits a `script` event"
    )
    ap.add_argument("--chapter", default=None, help="Chapter id or title in --manuscript (narration chapters only)")
    ap.add_argument(
        "--script-id",
        default=None,
        help="Names a --script that is not a chapter (the credits) so it also emits a `script` event, one paragraph per line (needs --script-title)",
    )
    ap.add_argument("--script-title", default=None, help="The --script-id script's display name, e.g. 'Opening credits' (needs --script-id)")
    ap.add_argument("--start-word", type=int, default=None, help="Start the tracker already at this script word index (needs --script or --manuscript)")
    ap.add_argument(
        "--control-file",
        default=None,
        help='Sentinel file the host appends seek commands to, one JSON object per line, e.g. {"cmd": "seek", "word": 12} '
        "(needs --script or --manuscript); tailed once per chunk like --stop-file, no server or port",
    )
    ap.add_argument(
        "--locate",
        action="store_true",
        help="Instead of a session: transcribe seconds --tail-start to --tail-end of --wav, place them in the script and print one "
        "`locate` line with the word to resume from (locate.py); needs --model-dir, never downloads a model",
    )
    ap.add_argument("--tail-start", type=float, default=None, help="--locate: where the tail starts in --wav, in seconds")
    ap.add_argument("--tail-end", type=float, default=None, help="--locate: where the tail (the recorded audio) ends in --wav, in seconds")
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Inference device (default: cpu)")
    ap.add_argument(
        "--decode-interval",
        type=float,
        default=DECODE_INTERVAL_SECONDS,
        help="Seconds of new audio between re-decodes of the open segment (default 0.5; smaller = faster updates, more CPU)",
    )
    ap.add_argument(
        "--timing", action="store_true", help="Log each decode's wall time and, with --mic, how far behind the speaker each partial and word was emitted"
    )
    ap.add_argument("--stop-file", default=None, help="Stop cleanly (flush, then exit 0) once this sentinel file exists; how the desktop host requests a stop")
    ap.add_argument("--log", default=None, help="Path to also mirror log output to (optional)")
    return ap


def main() -> None:
    ap = build_parser()
    args = ap.parse_args()

    if args.log:
        set_log_file(open(args.log, "a", encoding="utf-8"))  # noqa: SIM115
    if args.meter:
        _run_meter(ap, args)
        return
    if args.list_devices:
        from devices import list_input_devices

        devices, error = list_input_devices()
        _emit({"type": "devices", "devices": [device.to_json() for device in devices], "error": error})
        return
    if args.check_moonshine:
        from moonshine_engine import self_check

        report = self_check()
        _emit(report)
        if not report["ok"]:
            sys.exit(1)
        return
    if args.locate:
        _run_locate(ap, args)
        return
    if not args.wav and not args.mic:
        ap.error("one of --wav or --mic is required")
    _check_engine_args(ap, args)

    tracker, script_message, chapter_text = _load_script(ap, args)
    args.context_text = Path(args.context).read_text(encoding="utf-8") if args.context else (chapter_text if args.engine == "moonshine" else None)
    if script_message:
        _emit(script_message)
    stream = (_load_moonshine_engine if args.engine == "moonshine" else _load_whisper_engine)(args)
    chunks = iter_wav_chunks(args.wav) if args.wav else iter_microphone_chunks(args.mic)
    log("Listening..." if args.mic else f"Replaying {args.wav}...")
    _run(args, stream, chunks, tracker)


if __name__ == "__main__":
    main()
