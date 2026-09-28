# Native Recording Capture Engine Spike: WASAPI Through PortAudio in the Sidecar

**Status:** spike report, 2026-09-28 ([Native Recording Suite](../prds/native-recording-suite.prd.md) Phase 1, stream N-B37, [#842](https://github.com/countrymanprime/narration-utils/issues/842)). The decision it informs is [ADR 0357](../adr/0357-the-built-in-recorders-capture-engine-is-a-wasapi-shared-mode-row-of-the-capture-port-through-portaudio-in-the-sidecar.md). The numbers below are from CI's Windows runner and a synthetic source. **Every real-microphone result is owner-pending** (D65): the exact check is at the end and on [#510](https://github.com/countrymanprime/narration-utils/issues/510).

**Question (PRD Q3 and Q7):** Can this stack capture a narrator's microphone to a correct WAV file with no dropouts, at an acceptable cost, and which engine should do it? What does that mean for monitoring?

**Short answer.**

- **Yes, for everything a machine without a microphone can prove.** The engine is WASAPI in shared mode through PortAudio (`sounddevice`), as the capture port's Experimental `wasapi` row in the teleprompter sidecar (ADR 0357).
- **The soak was clean.** A 30-minute, wall-clock-paced 48 kHz / 24-bit take on the Windows runner had no dropout and was bit-exact against its source. It used 2.3 % of one core.
- **One writer stall.** The writer once stalled for 0.9 s, and the recorder's 4-second queue absorbed it without a lost sample.
- **Not measured yet: latency and a real device.** The runner has no audio endpoint, so latency and real-device dropouts wait for the owner's check.
- **Monitoring (Q7): hardware monitoring.** The app meters the capture stream itself, which needs no monitoring path.

## What was built

| Piece | Where | What it does |
| --- | --- | --- |
| The `wasapi` capture row | `sidecars/manuscript-teleprompter/core/capture_wasapi.py`; Go row `captureport.WASAPI` | Lists WASAPI input endpoints. Gives the port's 16 kHz mono chunks. `record(device, path)` records a take at the endpoint's own rate |
| The recording core | `libs/python/narration_common/recording/` | `WavWriter`, `LevelMeter`, `LinearResampler` and `Framer`, and `Recorder` with its dropout accounting. Numpy and the standard library only |
| The probe | `sidecars/manuscript-teleprompter/spikes/wasapi_probe.py` | The measurements below, as one JSON report |
| Tests | `libs/python/tests/test_recording.py` (38), `sidecars/manuscript-teleprompter/tests/test_capture_wasapi.py` (13), `test_wasapi_probe.py` (4), the Go `captureporttest` suite | WAV writing, framing, metering and the recorder against synthetic input. The row against a faked `sounddevice`, through the capture port's conformance suite |

## How it was measured

A temporary CI job ran the probe once, on the `windows-latest` runner, on 2026-09-28 (PR [#846](https://github.com/countrymanprime/narration-utils/pull/846), commit `435e3df`). The job was removed afterwards. To run it again anywhere:

```powershell
uv run --no-project --python 3.12 --with numpy==2.5.3 --with sounddevice==0.5.6 `
  python sidecars/manuscript-teleprompter/spikes/wasapi_probe.py `
  --seconds 1800 --stereo-seconds 120 --throughput-seconds 1800 --out wasapi-probe-out
```

**Environment:**

- Windows Server 2025 (10.0.26100), on an AMD EPYC 7763 with 2 cores and 4 logical processors.
- Python 3.12.10, `sounddevice` 0.5.6, PortAudio V19.7.0-devel.
- PortAudio's host APIs were MME, DirectSound, **WASAPI** and WDM-KS.
- The Windows Audio service (`audiosrv`) was running, but **the runner exposes no WASAPI input endpoint** (`wasapiInputs: []`), so the device section recorded nothing.
- Loopback is not an option: PortAudio 19.7 has no WASAPI loopback, and installing a virtual audio driver on the runner is out of scope. So the paced synthetic source stands in for a device. It calls the recorder from its own thread every 10 ms, as PortAudio's callback does.

## Results

### Soak: 30 minutes, 48 kHz, 24-bit, mono, paced to the wall clock

| Measure | Result |
| --- | --- |
| Audio written | 86,400,000 frames = 1,800.000 s, in 1,800.005 s of wall time |
| Dropouts | **0** (0 overflow flags, 0 blocks dropped) |
| File correctness | Header and file size consistent. **Bit-exact** against the source: largest error half a 24-bit step, which is rounding |
| CPU | **2.27 %** of one core for the whole process, including the synthetic generator |
| Writer time per 10 ms block | p50 0.108 ms, p99 0.284 ms, **max 892.7 ms** |
| Delivery to written (the queue's lag) | p50 0.22 ms, p99 0.54 ms, **max 1,760.9 ms** |

**The one stall.** In 30 minutes the writer stalled once, for 0.9 s. The queue behind it reached 1.8 s. The recorder's queue holds 4 s (`QUEUE_SECONDS`), so nothing was dropped, and the audio thread never waited. That is the design working as intended: the device is never blocked by the disk.

The stall's cause is unknown. It could be the runner's shared disk, antivirus scanning the growing file, or a VM pause. The same bound on real hardware is part of the owner's check. If a real machine stalls longer than 4 s, Phase 2 should raise the queue rather than let the device wait.

### Stereo: 2 minutes, 48 kHz, 24-bit, paced

- 5,760,000 frames, 0 dropouts, bit-exact.
- CPU 2.55 % of one core.
- Writer p50 0.119 ms, max 1.37 ms.

### Overload: unpaced, 1,800 s of audio pushed as fast as the generator can

This run deliberately overloads the recorder: the generator never waits. It checks that the dropout accounting holds when the writer cannot keep up.

- **The producer outran the writer.** The generator made blocks far faster than real time, at 103 % CPU. The writer wrote 1,092,480 frames and the recorder dropped and counted **177,724 blocks = 85,307,520 frames**.
- **The accounting is exact.** 1,092,480 + 85,307,520 = 86,400,000, every frame fed in.
- **The file is still valid.** Its header matches the frames written. It is not bit-exact against a continuous tone because of the counted gaps, which is correct.
- **What this shows:** under overload the recorder loses audio only in whole blocks, counts every one, and never corrupts the file or blocks the source.
- **Writer headroom.** Even while fighting the generator for the GIL, the writer's median time per 10 ms block was 0.084 ms, about 100 times faster than real time. Its p99 of 48 ms is contention with the generator, which a device does not cause.

### Checked by the unit tests, not by the probe

- **Headers.** The header is patched every second, so a take interrupted by a crash leaves a readable file.
- **Never overwrites.** A take cannot overwrite an existing file: the path is created with `open(path, "xb")`.
- **Errors keep the audio.** A device that fails mid-take, a full disk, the 4 GiB RIFF limit and a listener that raises each end the take with the audio before the error, plus a sentence saying why.
- **Metering.** The meter gives one `level` event per 100 ms at any rate and block size, and counts clipped samples.
- **Resampling.** 48 kHz to 16 kHz gives the same result whatever the block sizes, and keeps the sample count.
- **The capture port.** The row passes the capture port's conformance suite against a faked `sounddevice` that delivers from its own thread, as PortAudio does.

## What this means for the open questions

- **Q3, the engine.** Answered as ADR 0357 records.
  - **CGo is out.** The Windows build is `CGO_ENABLED=0`, so a CGo binding would disrupt it, as the PRD's risk table foresaw.
  - **No hand-written COM calls.** A pure-Go binding would mean writing them ourselves, and the PRD advises against that.
  - **PortAudio is proven and already locked.** It runs in the sidecar the capture port already lives in.
  - **The cost is negligible.** About 2 % of one core, and well under a millisecond per block.
- **Q7, monitoring.** Hardware monitoring through the narrator's interface.
  - The meter reads the capture stream, so it is as reliable as the capture itself and needs no monitoring path.
  - Software monitoring would add the round trip the PRD's latency metric worries about, and CI cannot measure that round trip. Phase 2 gets the numbers from the owner's check (PortAudio's reported input latency is saved with each take) before offering it.
- **Latency.** Not measured: no endpoint on the runner. It is owner-pending.

## The owner's check (pending on #510, D65)

On the owner's Windows machine, with the microphone they narrate with, from a checkout of #846:

1. **Run the probe.** Use the command above, with `--device-seconds 1800 --devices 1 --seconds 60 --throughput-seconds 60`.
   - It records 30 minutes from the first WASAPI input endpoint. Speak or leave the room quiet: both are fine.
   - It writes `wasapi-probe-out/report.json` and `device-0.wav`. Nothing leaves the machine.
2. **Read `report.json`'s `device` entry and pass it when:**
   - `overflows` and `droppedBlocks` are 0;
   - `framesVsWallPercent` is within 0.1 % of 100;
   - `file.framesMatch` and `file.sizesConsistent` are true;
   - `lagMs.max` is under 4,000.
   - Note `latencyMs` (PortAudio's reported input latency) and `sampleRate` for Phase 2.
3. **Listen.** Play `device-0.wav` in any player, and scrub to a few points. Pass when there are no clicks or gaps and it sounds like the microphone.
4. **Post the `device` entry on #510.** When the check passes, the `wasapi` row moves from Experimental to Supported in a follow-up (ADR 0357).
