# 0247. The input level comes from the sidecar's own capture, and a model-free meter child runs before Start

**Status:** Accepted
**Date:** 2026-09-25

## Context

The Read Aloud control bar ([read-aloud-control-bar PRD](../prds/read-aloud-control-bar.prd.md) Phase 4) shows a live microphone level in the bar and a larger one in the microphone popover, so the narrator can see the microphone is live before and while reading. The owner approved the PRD's recommendation for Q6 (D39): measure in the sidecar, not in the webview. A webview meter (`getUserMedia`) would open the microphone through a second path that Wails grants silently, under a name that may not match the `dshow` name the recognizer opens. Q5 was answered "meter only" (D37): no gain. The sidecar's capture yields 0.32 s chunks, too coarse for a meter, and ADR 0022 noted that the cost of Wails events was unmeasured.

## Decision

- **The level is measured where the recognizer hears.** `levels.py` takes the capture path's own 16 kHz mono chunks after resampling and reports `{"type": "level", "peak", "rms"}` for every 100 ms of audio: `peak` is the largest absolute sample, `rms` the loudest of two 50 ms windows, both in dBFS, rounded to 0.1 dB, from a floor of −100 (silence; JSON has no −∞) to 0 (full scale, clipped values clamp). That is about ten events a second whatever the chunk size. Every session sends them beside its words, before the engine sees the chunk.
- **A meter-only mode.** `live_asr.py --meter --mic NAME [--stop-file PATH]` opens the device and prints only `level` events: no model, no script, nothing written. It refuses every session option (`--wav`, `--manuscript`, `--script`, `--control-file`, `--start-word`, `--locate`, `--list-devices`, `--check-moonshine`).
- **The host runs it as a second, separate child** (`internal/teleprompter/meter.go`): `TeleprompterMeterStart(device)` and `TeleprompterMeterStop()` (host API 54). At most one meter runs and a new start replaces it. It is refused while a session is starting, running or stopping, and a session start stops it and waits until it has released the device. It also stops when the UI asks (the popover closes) and on shutdown. It stops like a session: through a stop file, killed after the grace period.
- **One event stream.** The meter relays only its `level` lines, on the session's own `teleprompter:event` channel, so the UI's meter reads one stream whichever child measured it. When a meter ends, the host adds `{"type": "meter_stopped", "error": string | null}`. `error` is the sidecar's last stderr line when the meter ended by itself on a failure (a microphone that would not open), and null when it was asked to stop. The level events are not part of the snapshot and are not reduced into the session model.
- **The mock** gives each replay step a level (no timer of its own, so a replay still ends), sends one level when the meter starts and `meter_stopped` when it stops. `?mockLevel=` fixes every level's RMS for a still capture.

## Consequences

- The meter shows the device the recognizer opens, by the name it opens, and adds no microphone path. It says nothing about REAPER's input, which may be a different device or an ASIO driver. The guide says monitoring and recording level are set in REAPER and the interface.
- About ten more events a second cross Wails during a session. The rate is measured in the owner's run; if the reader stutters, the report interval grows in `levels.py` alone.
- A failed meter says why instead of looking like a silent microphone.
- The meter in the bar and the popover is built: `useInputLevel` (`apps/ui/src/components/teleprompter`) subscribes to the shared event stream apart from the session model, holds a peak for 1.5 s before a lower one replaces it, and runs the meter-only child only while the microphone popover is open and no session is running. `InputLevelMeter` draws a small decorative (`aria-hidden`) version in the bar's microphone button and the real `role="meter"` one in the popover, its `aria-valuetext` throttled to once a second; the fill's width transition is `motion-safe`, so reduced motion shows a new level at once. The owner's check that the meter moves with their own microphone is still pending (#510).
