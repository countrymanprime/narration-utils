# 0357. The built-in recorder's capture engine is a WASAPI shared-mode row of the capture port, through PortAudio in the sidecar

**Status:** Proposed (native-recording-suite PRD Phase 1, stream N-B37; the owner confirms it with the real-microphone check on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-28
**Supersedes:** none

## Context

The [Native Recording Suite](../prds/native-recording-suite.prd.md) PRD plans a recorder the app owns end to end. The owner took the PRD's recommendations for all nine open questions (D86 on [#509](https://github.com/countrymanprime/narration-utils/issues/509), 2026-09-28). The recorder is record-and-organize only (Q1), sits beside the REAPER bridge (Q2), and lives in the Booth, whose engine chip reads "Built-in recorder" (D79). Phase 1 is the spike that answers Q3, which capture engine to use. The PRD named three candidates:

- a CGo binding to WASAPI (miniaudio through `malgo`);
- a small dedicated Go audio package;
- capture in a Python sidecar, as the teleprompter already does.

It gave two mitigations that together are its recommendation:

- use "a proven library (miniaudio/malgo) over hand-rolled WASAPI calls";
- "evaluate a sidecar-based capture path as a fallback if CGo proves too disruptive".

What the spike found:

- **CGo is disruptive here.** The Windows build is `CGO_ENABLED=0` by design (`scripts/release/wails-build.mjs`, `.github/actions/setup-toolchain`), and the rest of the repository keeps to it (`cmd/spike-globalhotkeys`). A CGo binding would need a C toolchain on every Windows runner and in every worker session, and a second build mode for the one package that captures.
- **Go has no proven pure-Go WASAPI library.** A pure-Go binding means writing the COM calls ourselves (`IMMDeviceEnumerator`, `IAudioClient`, `IAudioCaptureClient`) over `go-ole`. That is exactly the "hand-rolled WASAPI calls" the PRD advises against, and it could not be exercised off Windows.
- **The capture port already lives in the sidecar.** Its backends run in Python, and the Go rows only declare them ([ADR 0301](0301-providers-sit-behind-small-ports-with-a-registry-and-a-capability-descriptor.md); `internal/captureport`). [ADR 0402](0402-coreaudio-capture-is-a-pyav-avfoundation-sidecar-backend-addressed-by-device-name.md), now superseded by [ADR 0412](0412-windows-is-the-only-supported-platform-for-now.md), already chose a sidecar row to keep CGo out of the build.
- **PortAudio's WASAPI host API is the proven library in reach.** The `sounddevice` package binds it, is MIT-licensed, ships PortAudio's DLL in its Windows wheels, and is already locked as a Windows dependency of `moonshine-voice`. The teleprompter's existing capture, PyAV's `dshow`, is DirectShow, not WASAPI, and cannot record at a device's own format.

## Decision

**The built-in recorder captures through a new `wasapi` row of the capture port.** The row opens WASAPI in shared mode through PortAudio (`sounddevice`), runs in the teleprompter sidecar, and records a take to a 24-bit PCM WAV file at the device's own rate. It is **Experimental**.

- **The row.**
  - It is `sidecars/manuscript-teleprompter/core/capture_wasapi.py`, registered in `narration_common.ports.capture.BACKENDS` after `dshow`. It imports `capture_dshow` first, so `dshow` stays the default whatever imports it first.
  - `live_asr.py` imports it, so `--capabilities` reports it and the packaged smoke test checks that the frozen sidecar registered it.
  - The Go row is `captureport.WASAPI` (`Platforms: windows`), after `dshow`.
- **Experimental.**
  - A capture row now has a level. On the Go side it is `captureport.Backend.Level()`, which the conformance suite requires to be Experimental or Supported. On the Python side it is `level` on the backend.
  - `dshow` is Supported and `wasapi` is Experimental. The provider capabilities binding reports it (`"support": {"level": "experimental", "available": true}` on Windows), and the goldens, the UI mock and `wireContracts.test.ts` pin that.
  - It becomes Supported after the owner's real-microphone check.
- **What it does.**
  - `list_devices()` lists WASAPI input endpoints (a repeated name gets ` [2]`).
  - `chunks()` gives the port's 16 kHz mono chunks from the endpoint's own rate, so the row passes the port's conformance suite unchanged.
  - `record(device, path)` records a take and returns a running `Recorder`.
- **The shared core, `narration_common.recording`.** It is engine-neutral, numpy and the standard library only:
  - `WavWriter` writes 16- or 24-bit PCM. It never overwrites an existing file (`open(path, "xb")`, Q5). It patches the header every second, so a crash leaves a playable file. It closes cleanly on an error and at the 4 GiB RIFF limit.
  - `LevelMeter` gives the Booth meter's existing `level` event at any rate and channel count, and counts clipped samples.
  - `LinearResampler` and `Framer` produce the port's chunks.
  - `Recorder` connects them. The audio thread only copies a block onto a bounded queue, and a writer thread does the disk and the meter. A full queue drops and counts the block instead of stalling the device. The engine's overflow flags are counted as dropouts. A device error, a disk error or a listener's error ends the take with the audio written before it and a sentence saying why.
- **The format.**
  - **Rate and channels.** The rate is the endpoint's shared-mode mix format rate (`default_samplerate`, usually 48 kHz), never resampled for the take. The take is mono by default, and 2 channels when asked, never more than the endpoint has.
  - **Bit depth.** 24-bit, which matches the Booth mock's "48 kHz / 24-bit" chip.
  - **Header.** The plain `WAVE_FORMAT_PCM` header that Python's `wave` and the Go decoders already read.
- **Monitoring (Q7).** The spike measured the capture path. It did not build software monitoring, and the recommendation is **hardware monitoring**: the narrator listens through their interface's direct monitoring. The app meters the capture stream, which needs no monitoring path, so the level meter is as reliable as the capture itself. PortAudio's reported input latency (owner-pending: CI's runner has no endpoint to measure) is recorded with each take for Phase 2 to decide whether to offer software monitoring.
- **No network (D72).** The row opens a local device and writes only the path its caller gives it. It sends nothing, and it adds no argument, file or process that could.

## Consequences

- **The build does not change.** There is no CGo and no new sidecar or language: the Windows build stays `CGO_ENABLED=0`, and the recorder reuses the sidecar framework: the frozen teleprompter, the Job Object, stdout NDJSON events and the stop file.
- **The frozen sidecar still excludes `sounddevice`.** `scripts/release/prepare-resources.py` excludes it (about 2 MB of PortAudio DLLs, [local dependency evaluation](../research/local-dependency-evaluation.md)). So in a release build the row registers but lists "The built-in recorder cannot list devices here", which is harmless while it is Experimental and uncalled. **Phase 2 must remove `sounddevice` from that exclude list** and add PortAudio's DLL to `verify-installable.mjs`. `pyproject.toml` now names `sounddevice==0.5.6 ; sys_platform == 'win32'` directly (it was already locked).
- **Audio moves through Python, not Go.** A take's audio passes through Python, not the Go host. The measured cost (see the [spike report](../research/native-recording-capture-engine-spike.md)) is a writer time of well under a millisecond per 10 ms block. That is small, but Python's garbage collector and the GIL are the risks a soak on real hardware must rule out (owner-pending, #510).
- **Two capture paths for now.** The teleprompter's own capture stays on `dshow`. A later change can move it to `wasapi` through the port with no caller edit, once `wasapi` is Supported.
- **The recorder writes files, a new trust boundary.** The threat model gains row 4g, and `SECURITY.md` names the take files.
- **What would change this.** A real-hardware soak showing dropouts that a native engine would avoid, or the need for exclusive mode or ASIO, would move capture into a small native binary behind the same port row. That would need a new ADR superseding this one. The port contract, the WAV writer's rules and the recorder's result would stay.
