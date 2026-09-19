"""
Spike: measure Moonshine streaming ASR as a live engine for the Manuscript
Teleprompter (docs/architecture/manuscript-teleprompter.md, "Prototype
findings and live-engine direction"). Not shipped code and not part of the
repo's Python environment: run it in an ephemeral environment so
pyproject.toml / uv.lock stay untouched:

    uv run --no-project --python 3.12 --with moonshine-voice==0.1.5 --with av==18.1.0 \\
        python tools/manuscript-teleprompter/spikes/moonshine_probe.py --list-devices
    uv run ... python .../moonshine_probe.py --wav reading.wav --reference script.txt
    uv run ... python .../moonshine_probe.py --mic "Realtek" --arch small --context script.txt

It feeds audio (a recording paced to real time, or the live mic) to a
Moonshine streaming Transcriber and logs every partial and final line with
wall-clock timing, then prints the numbers the spike must answer: how far
behind the speaker words appear, whether word timestamps exist on in-progress
lines, how much already-shown text gets revised, how often the final line
differs from the last partial, and the accuracy against a reference script.
"""

import argparse
import json
import queue
import re
import sys
import time
from typing import Dict, List, Optional

import numpy as np

SAMPLE_RATE = 16000
CHUNK_SECONDS = 0.1
TAIL_SILENCE_SECONDS = 1.5
ARCH_NAMES = {"tiny": "TINY_STREAMING", "small": "SMALL_STREAMING", "medium": "MEDIUM_STREAMING"}


def normalize_words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def word_error_rate(reference: List[str], hypothesis: List[str]) -> float:
    """Word-level Levenshtein distance divided by the reference length."""
    if not reference:
        return 0.0 if not hypothesis else 1.0
    previous = list(range(len(hypothesis) + 1))
    for row, ref_word in enumerate(reference, 1):
        current = [row]
        for col, hyp_word in enumerate(hypothesis, 1):
            cost = 0 if ref_word == hyp_word else 1
            current.append(min(previous[col] + 1, current[col - 1] + 1, previous[col - 1] + cost))
        previous = current
    return previous[-1] / len(reference)


def _first_seen_lags(partials: List[dict], final: dict) -> List[float]:
    """For each word with a final timestamp: wall time it first appeared in
    any partial (or the final) minus the audio time the word ended."""
    lags = []
    for index, word in enumerate(final["words"]):
        seen = next((p["wall"] for p in partials if len(p["text"].split()) > index), final["wall"])
        lags.append(seen - word["end"])
    return lags


def _percentile(values: List[float], fraction: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[int(fraction * (len(ordered) - 1))], 3)


def summarize(records: List[dict]) -> dict:
    """Aggregate the per-event records into the spike's headline numbers."""
    by_line: Dict[int, List[dict]] = {}
    for record in records:
        by_line.setdefault(record["line_id"], []).append(record)

    lags: List[float] = []
    shown = revised = completed = mismatched = 0
    partial_events = timed_partials = 0
    for line_records in by_line.values():
        partials = [r for r in line_records if r["kind"] == "LineTextChanged"]
        final = next((r for r in line_records if r["kind"] == "LineCompleted"), None)
        previous: List[str] = []
        for partial in partials:
            partial_events += 1
            timed_partials += 1 if partial["words"] else 0
            current = normalize_words(partial["text"])
            shown += len(previous)
            revised += sum(1 for old, new in zip(previous, current) if old != new) + max(0, len(previous) - len(current))
            previous = current
        if final is None:
            continue
        completed += 1
        mismatched += 1 if normalize_words(final["text"]) != previous else 0
        lags.extend(_first_seen_lags(partials, final))

    return {
        "lines_completed": completed,
        "partial_events": partial_events,
        "partials_with_word_timestamps": timed_partials,
        "final_differs_from_last_partial": f"{mismatched}/{completed}",
        "shown_words_later_revised": f"{revised}/{shown}",
        "word_lag_seconds": {"median": _percentile(lags, 0.5), "p90": _percentile(lags, 0.9), "max": _percentile(lags, 1.0), "timed_words": len(lags)},
    }


class ProbeListener:
    """Transcriber listener that timestamps every partial/final line against
    the wall clock, where t0 is the moment audio time zero was fed."""

    def __init__(self, echo: bool = True) -> None:
        self.t0 = time.perf_counter()
        self.records: List[dict] = []
        self._echo = echo

    def __call__(self, event) -> None:
        kind = type(event).__name__
        if kind not in ("LineTextChanged", "LineCompleted"):
            return
        line = event.line
        wall = time.perf_counter() - self.t0
        words = [{"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)} for w in (line.words or [])]
        self.records.append(
            {
                "kind": kind,
                "wall": round(wall, 3),
                "line_id": line.line_id,
                "text": line.text,
                "start": round(line.start_time, 3),
                "duration": round(line.duration, 3),
                "words": words,
                "latency_ms": line.last_transcription_latency_ms,
            }
        )
        if self._echo:
            label = "FINAL  " if kind == "LineCompleted" else "partial"
            behind = wall - (line.start_time + line.duration)
            print(
                f"[{wall:7.2f}s] {label} L{line.line_id} audio-end {line.start_time + line.duration:6.2f}s ({behind:+.2f}s) timed-words={len(words)}: {line.text}"
            )


def load_audio(path: str) -> np.ndarray:
    import av

    container = av.open(path)
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
    chunks = [rframe.to_ndarray()[0].astype(np.float32) for frame in container.decode(stream) for rframe in resampler.resample(frame)]
    container.close()
    audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    return np.concatenate([audio, np.zeros(int(TAIL_SILENCE_SECONDS * SAMPLE_RATE), dtype=np.float32)])


def feed_recording(transcriber, listener: ProbeListener, audio: np.ndarray, pace: bool) -> float:
    """Feed a recording in 0.1s chunks (paced to real time unless told not
    to). Returns seconds spent inside add_audio."""
    chunk = int(CHUNK_SECONDS * SAMPLE_RATE)
    processing = 0.0
    listener.t0 = time.perf_counter()
    for index in range(0, len(audio), chunk):
        if pace:
            delay = listener.t0 + index / SAMPLE_RATE - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
        started = time.perf_counter()
        transcriber.add_audio(audio[index : index + chunk].tolist(), SAMPLE_RATE)
        processing += time.perf_counter() - started
    return processing


def _find_input_device(query: str):
    import sounddevice as sd

    devices = [(i, d) for i, d in enumerate(sd.query_devices()) if d["max_input_channels"] > 0]
    if query.isdigit():
        return int(query)
    matches = [i for i, d in devices if query.lower() in d["name"].lower()]
    if not matches:
        raise SystemExit(f"No input device matches {query!r}; run --list-devices")
    return matches[0]


def feed_microphone(transcriber, listener: ProbeListener, device_query: str, seconds: Optional[float]) -> float:
    import sounddevice as sd

    device = _find_input_device(device_query)
    rate = int(sd.query_devices(device)["default_samplerate"])
    blocks: "queue.Queue[np.ndarray]" = queue.Queue()
    processing = 0.0
    print(f"Listening on device {device} at {rate} Hz. Ctrl+C to stop.", file=sys.stderr)
    with sd.InputStream(device=device, channels=1, samplerate=rate, dtype="float32", callback=lambda data, frames, info, status: blocks.put(data[:, 0].copy())):
        listener.t0 = time.perf_counter()
        try:
            while seconds is None or time.perf_counter() - listener.t0 < seconds:
                try:
                    block = blocks.get(timeout=1.0)
                except queue.Empty:
                    continue
                started = time.perf_counter()
                transcriber.add_audio(block.tolist(), rate)
                processing += time.perf_counter() - started
        except KeyboardInterrupt:
            print("Stopping...", file=sys.stderr)
    return processing


def build_transcriber(arch_name: str, update_interval: float, context_path: Optional[str]):
    from moonshine_voice import ModelArch, Transcriber
    from moonshine_voice.download import get_model_for_language

    arch = getattr(ModelArch, ARCH_NAMES[arch_name])
    print(f"Fetching/loading Moonshine {ARCH_NAMES[arch_name]} (first run downloads it)...", file=sys.stderr)
    model_path, model_arch = get_model_for_language("en", arch, include_word_timestamps=True)
    transcriber = Transcriber(model_path, model_arch, update_interval=update_interval, options={"word_timestamps": "true"})
    if context_path:
        transcriber.set_context(open(context_path, encoding="utf-8").read())
    return transcriber


def main() -> None:
    ap = argparse.ArgumentParser(description="Moonshine streaming spike for the Manuscript Teleprompter")
    ap.add_argument("--list-devices", action="store_true", help="List audio input devices and exit")
    ap.add_argument("--wav", default=None, help="Recording to feed (any format PyAV decodes)")
    ap.add_argument("--mic", default=None, help="Input device index or name substring")
    ap.add_argument("--seconds", type=float, default=None, help="Stop the mic run after this many seconds")
    ap.add_argument("--arch", default="small", choices=sorted(ARCH_NAMES), help="Streaming model size (default: small)")
    ap.add_argument("--update-interval", type=float, default=0.5, help="Seconds of audio between partial updates (default 0.5)")
    ap.add_argument("--context", default=None, help="Text file (e.g. the script passage) passed to set_context() to bias toward its unusual words")
    ap.add_argument("--reference", default=None, help="Text file with what was actually read, for word error rate")
    ap.add_argument("--no-pace", action="store_true", help="Feed the recording as fast as possible (lag numbers are then meaningless)")
    ap.add_argument("--events-out", default=None, help="Write every partial/final record as JSON Lines to this path")
    args = ap.parse_args()

    if args.list_devices:
        import sounddevice as sd

        for index, device in enumerate(sd.query_devices()):
            if device["max_input_channels"] > 0:
                print(f"{index:3d}  {device['name']}  ({int(device['default_samplerate'])} Hz)")
        return
    if not args.wav and not args.mic:
        ap.error("one of --wav, --mic or --list-devices is required")

    transcriber = build_transcriber(args.arch, args.update_interval, args.context)
    listener = ProbeListener()
    transcriber.add_listener(listener)
    transcriber.start()

    if args.wav:
        audio = load_audio(args.wav)
        audio_seconds = len(audio) / SAMPLE_RATE
        processing = feed_recording(transcriber, listener, audio, pace=not args.no_pace)
    else:
        processing = feed_microphone(transcriber, listener, args.mic, args.seconds)
        audio_seconds = time.perf_counter() - listener.t0
    transcriber.stop()
    transcriber.close()

    summary = summarize(listener.records)
    summary["add_audio_realtime_factor"] = round(processing / audio_seconds, 3) if audio_seconds else None
    summary["paced"] = bool(args.mic) or not args.no_pace
    if args.reference:
        reference = normalize_words(open(args.reference, encoding="utf-8").read())
        heard = normalize_words(" ".join(r["text"] for r in listener.records if r["kind"] == "LineCompleted"))
        summary["word_error_rate_vs_reference"] = round(word_error_rate(reference, heard), 3)
    if args.events_out:
        with open(args.events_out, "w", encoding="utf-8") as handle:
            handle.writelines(json.dumps(r) + "\n" for r in listener.records)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
