"""
Spike: measure the built-in recorder's capture engine (native-recording-suite PRD Phase 1, ADR 0357). This is not
shipped code. It drives the same `capture_wasapi` row and `narration_common.recording.Recorder` the app will use, and
prints one JSON report, which the research note (docs/research/native-recording-capture-engine-spike.md) records.

    uv run --no-project --python 3.12 --with numpy==2.5.3 --with sounddevice==0.5.6 \\
        python sidecars/manuscript-teleprompter/spikes/wasapi_probe.py --seconds 60 --out probe-out

It measures four things:
  1. environment: PortAudio's host APIs, and every WASAPI input endpoint with its shared-mode rate, channels and
     PortAudio's own low-latency figure;
  2. device: a real take of --device-seconds from each of the first --devices WASAPI endpoints, when there are any.
     It reports the stream's reported input latency, dropouts, the process's CPU time and whether the file is correct.
     CI's Windows runner has no audio endpoint, so there this section says so; a real microphone is the owner's check;
  3. synthetic: a take of --seconds at 48 kHz in mono (the soak) and one of --stereo-seconds in stereo, paced to the wall clock the way a device paces
     its callbacks. It reports the same numbers plus a bit-exact comparison of the file with the tone that was fed in;
  4. throughput: the same pipeline unpaced, for --throughput-seconds of audio. It reports how many times faster than
     real time the writer runs, which is its headroom against a slow disk.
It writes only under --out and sends nothing anywhere (D72).
"""

import argparse
import json
import platform
import sys
import time
from pathlib import Path

import numpy as np

CORE = Path(__file__).resolve().parents[1] / "core"
SHARED = Path(__file__).resolve().parents[3] / "libs" / "python"
for path in (CORE, SHARED):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import capture_wasapi
from narration_common.recording import Recorder, SyntheticSource, read_wav_header, synthetic_tone
from narration_common.recording.wav import HEADER_BYTES, from_pcm


def environment(load=capture_wasapi._sounddevice) -> dict:
    report: dict = {"platform": platform.platform(), "python": platform.python_version(), "machine": platform.machine()}
    try:
        sd = load()
    except (ImportError, OSError) as error:
        report["sounddevice"] = f"unavailable: {error}"
        return report
    report["sounddevice"] = getattr(sd, "__version__", "?")
    report["portaudio"] = sd.get_portaudio_version()[1] if hasattr(sd, "get_portaudio_version") else "?"
    report["hostApis"] = [api["name"] for api in sd.query_hostapis()]
    devices, error = capture_wasapi.WasapiBackend(load=lambda: sd).list_devices()
    report["wasapiInputs"] = [
        {"name": d.name, "sampleRate": d.sample_rate, "channels": d.channels, "lowLatencyMs": round(d.low_latency * 1000, 2)} for d in devices
    ]
    report["listingError"] = error
    return report


def check_file(path: Path, frames: int, expected=None) -> dict:
    """Is the file a WAV of exactly `frames` frames, and (for a synthetic take) sample for sample what was fed in?"""
    header = read_wav_header(path)
    size_ok = path.stat().st_size == HEADER_BYTES + header.data_bytes and header.riff_bytes == 36 + header.data_bytes
    report = {"headerFrames": header.frames, "framesMatch": header.frames == frames, "sizesConsistent": size_ok}
    if expected is not None:
        raw = path.read_bytes()[HEADER_BYTES:]
        written = from_pcm(raw, header.bits, header.channels)
        want = expected(0, header.frames)
        step = 1 / (1 << (header.bits - 1))
        worst = float(np.max(np.abs(written - want))) if header.frames else 0.0
        report["maxErrorSteps"] = round(worst / step, 3)
        report["bitExact"] = worst <= step / 2 + 1e-9
    return report


def timed(recorder_factory, run) -> dict:
    cpu0, wall0 = time.process_time(), time.perf_counter()
    recorder = recorder_factory()
    run(recorder)
    result = recorder.stop()
    cpu, wall = time.process_time() - cpu0, time.perf_counter() - wall0
    summary = result.summary()
    summary["cpuPercentOfOneCore"] = round(100 * cpu / wall, 2) if wall else None
    summary["realtimeFactor"] = round(result.seconds / wall, 2) if wall else None
    return {"result": result, "summary": summary}


def synthetic(out: Path, seconds: float, channels: int, realtime: bool, tag: str) -> dict:
    rate, block = 48000, 480
    source = SyntheticSource(rate, channels, block, realtime=realtime, stop_after=int(seconds * rate / block))
    path = out / f"synthetic-{tag}.wav"
    run = timed(lambda: Recorder(source, path).start(), lambda _recorder: source.wait())
    run["summary"]["file"] = check_file(path, run["result"].frames, lambda start, count: synthetic_tone(start, count, rate, channels))
    if not realtime:
        path.unlink()  # the throughput file is only there to be written
    return run["summary"]


def device(out: Path, seconds: float, limit: int, backend=None) -> list[dict]:
    backend = backend or capture_wasapi.WasapiBackend()
    devices, _error = backend.list_devices()
    runs = []
    for index, endpoint in enumerate(devices[:limit]):
        path = out / f"device-{index}.wav"
        try:
            run = timed(lambda endpoint=endpoint, path=path: backend.record(endpoint.name, path), lambda recorder: recorder.failed.wait(seconds))
        except Exception as error:  # noqa: BLE001 - a spike reports every failure and moves on
            runs.append({"device": endpoint.name, "error": f"{type(error).__name__}: {error}"})
            continue
        summary = run["summary"]
        summary["device"] = endpoint.name
        summary["file"] = check_file(path, run["result"].frames)
        # A device delivers exactly its rate: a gap between frames and wall time is audio lost before PortAudio saw it.
        summary["framesVsWallPercent"] = round(100 * run["result"].seconds / run["result"].wall_seconds, 3) if run["result"].wall_seconds else None
        runs.append(summary)
    return runs


def main(argv=None) -> dict:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seconds", type=float, default=60.0, help="length of the paced synthetic mono take (the soak)")
    parser.add_argument("--stereo-seconds", type=float, default=None, help="length of the paced stereo take (default: --seconds)")
    parser.add_argument("--throughput-seconds", type=float, default=600.0, help="audio pushed through unpaced")
    parser.add_argument("--device-seconds", type=float, default=20.0, help="length of each real device take")
    parser.add_argument("--devices", type=int, default=2, help="how many WASAPI endpoints to record from")
    parser.add_argument("--out", type=Path, default=Path("wasapi-probe-out"))
    args = parser.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)

    report = {"type": "wasapi_probe", "environment": environment()}
    report["device"] = device(args.out, args.device_seconds, args.devices)
    report["synthetic"] = {
        "mono48k": synthetic(args.out, args.seconds, 1, True, "mono"),
        "stereo48k": synthetic(args.out, args.seconds if args.stereo_seconds is None else args.stereo_seconds, 2, True, "stereo"),
    }
    report["throughput"] = synthetic(args.out, args.throughput_seconds, 1, False, "throughput")
    text = json.dumps(report, indent=2)
    (args.out / "report.json").write_text(text, encoding="utf-8")
    print(text)
    return report


if __name__ == "__main__":
    main()
