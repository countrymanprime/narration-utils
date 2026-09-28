# 0455. The built-in recorder records each take to a partial file in the project's Recordings folder and links it to its take name

**Status:** Proposed (native-recording-suite PRD Phase 2, stream N-B40; the owner confirms it with the real-microphone check on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-28
**Supersedes:** none

## Context

Phase 1 ([ADR 0357](0357-the-built-in-recorders-capture-engine-is-a-wasapi-shared-mode-row-of-the-capture-port-through-portaudio-in-the-sidecar.md)) built the capture engine: the capture port's Experimental `wasapi` row in the teleprompter sidecar, which records a take to a WAV file it creates with `open(path, "xb")`. Phase 2 is the minimum recorder: device selection, live metering, record-to-file and playback. The owner took the PRD's recommendations (D86 on [#509](https://github.com/countrymanprime/narration-utils/issues/509)):

- **Q4:** takes live in a project-owned folder following the `<project>/<Feature>/` convention, as plain WAV files, so a narrator who switches tools can drag one into a DAW.
- **Q5:** the app never overwrites or deletes a take on its own; the audio is never edited in place.
- **Q6:** one device picker, shared with the teleprompter's.
- **Q7:** hardware monitoring; the app meters the capture stream.
- **D79:** no recording page. The recorder is the Booth's Record surface, and the engine chip reads "Built-in recorder".

Left open for this phase: the folder's name, how a take gets its name without ever replacing a file, how the host reaches the row without depending on WASAPI, and what chooses "Built-in recorder" (the stage navigation PRD's Q7 left the chip's `builtin` state to "the native recording suite's own binding").

## Decision

**The recorder is `apps/desktop/internal/recording`, behind a port.**

- `recording.Engine` is the port: one capture row's `Devices`, `Meter` and `Record`, with `Level` and `Recorded` events. It depends on the capture row's name and level (`captureport.Backend`), never on WASAPI.
- The sidecar adapter (`recording.Sidecar`) runs `live_asr.py --list-devices`, `--meter` or `--record PATH` with `--capture wasapi` and a stop file. `--record` and `--capture` are new in the sidecar: `--record` records one take through the row's `record()` and ends with one `recorded` event with the take's numbers.
- `recordingtest.Fake` stands in for the engine in Go tests, and `apps/ui/src/api/recordingMock.ts` stands in for the whole recorder in the UI (D67), so the Booth and the visual suite run with no microphone.

**The takes are `<project>/Recordings/Take NNN.wav`.**

- A take is recorded to `Take NNN.partial.wav`. NNN is one past the highest number in the folder, a partial included, so a name is never reused.
- When the engine reports the take finished, the host gives it its name with a hard link and then removes the partial. A link fails when the name exists, so `Take NNN.wav` appears only with a finished file and never replaces one (`os.Rename` would, on Windows). A volume that cannot link falls back to a rename after checking the name is free.
- A take whose engine died keeps its partial name. The writer patches the header every second (ADR 0357), so it plays up to the last second written, and the Booth lists it as unfinished.
- The host never edits, overwrites or deletes a take. The one file it removes is a partial holding no audio at all: a header left by a device that never opened.

**The project chooses its engine.**

- "Record with" in the Booth's setup offers REAPER (the default) or the built-in recorder, marked Experimental. The choice is the project settings row `Recording.engine`, and the device the project last recorded with is `Recording.device`. Both are written only by the recorder's bindings (the pattern `Mastering.provider` set, `bindings_mastering.go`), so the Settings page neither lists nor saves them.
- The built-in recorder is refused where the `wasapi` row is not available (off Windows).
- `RecorderState.engine` sets the engine chip. The `?mockEngine=builtin` flag now seeds the mock recorder instead of the chip.

**The Booth is the Record surface (mock 03's Record area, with the built-in recorder in REAPER's place).**

- The status line shows "REC · Built-in" while a take runs, the recorder's input meter with its peak readout ("−14.2 pk") and the chip "Built-in · take 4".
- The command bar's Record replaces Record in REAPER and reads "REC 00:42" while a take runs.
- The setup holds "Record with", the recorder's input (the shared `MicrophoneField`, Q6), Check level (the meter, which writes nothing) and where the takes are saved.
- The rail's Takes lists them newest first, each playable through the `/media` route, which now also serves a file the recorder lists. It never serves the take being recorded.
- The recorder records independently of the reading session: reading and recording are two actions, as in REAPER. Leaving the Booth stops a take (it is saved), so a take never records on with no Record control on screen.

**The wire.** `RecorderState`, `RecorderChooseEngine`, `RecorderDevices`, `RecorderMeterStart`, `RecorderMeterStop`, `RecorderStart` and `RecorderStop`, with the live events `recording:state` and `recording:level` (`hostAPIVersion` 78). They have Zod schemas, goldens and `wireContracts.test.ts` rows. Neither event crosses the REAPER bridge, so `bridge/wire.go` is unchanged.

**The build.** `sounddevice` is off the freeze's exclude list, and `verify-installable.mjs` checks that the frozen sidecar carries PortAudio's DLL (ADR 0357's consequence).

## Consequences

- **A second source of takes, beside REAPER.** Native takes are plain WAV in a folder. Phase 3 defines the take contract and line identity (Q8), a metadata file keyed by take, so the review pipeline can consume them. Until then, a native take is audio only.
- **Monitoring stays hardware.** The recorder shows each take's reported input latency. Whether to offer software monitoring waits for real-hardware numbers (Q7, owner-pending).
- **Experimental.** Nothing here has recorded a real microphone. The owner's check on #510 is: two machines or interfaces, a chapter-length take with no dropouts or clicks, the latency, and playback. The row, the recorder and this ADR stay Proposed and Experimental until then.
- **Security.** Threat model rows 4g (the engine) and 4h (the host side: where it writes, never over a file, what the media route serves) and `SECURITY.md` name the take files.
- **What would change this.** A narrator workflow that needs takes per chapter folder, or a volume where hard links are the norm to fail (network shares), would change the layout or the naming step; the rule that a take is never replaced would stay.
