# 0022. The host relays live sidecar events over Wails events and stops the sidecar with a stop file

- **Status:** Accepted
- **Date:** 2026-09-19

## Context and problem

The two existing sidecars are batch jobs: `Supervisor.Start` discards their stdout and results come back through files polled every 150ms. The teleprompter sidecar is long-running and prints dozens of events per second that the UI must show immediately. The desktop host may not open a loopback server or port (`docs/architecture/daw-integration.md`), and Go cannot send Ctrl+C to a child process on Windows. The sidecar's one-off `script` event describes a whole chapter and can be very long.

## Decision drivers

- The teleprompter sidecar is long-running and prints dozens of events per second that the UI must show immediately.
- The desktop host may not open a loopback server or port.
- Go cannot send Ctrl+C to a child process on Windows.
- The one-off `script` event describes a whole chapter and can be very long.

## Considered options

1. Stream stdout lines to the UI as Wails events, and stop the sidecar cooperatively with a stop file
2. Keep the existing batch pattern: discard stdout and poll result files every 150ms
3. A loopback server or port
4. Stop the sidecar with Ctrl+C

## Decision outcome

**Chosen option: stream stdout lines to the UI as Wails events, and stop the sidecar cooperatively with a stop file**, because the UI must show events immediately, the host may not open a port, and Go cannot send Ctrl+C to a child process on Windows.

1. `shell/internal/process/stream.go` adds `Supervisor.StartStream`, alongside the unchanged `Start` and `Run`. It hands each stdout line to a callback, reads with `ReadString` (no line-length limit), keeps the tail of stderr, and returns a `StreamChild` with `Done`, `Kill` and `StderrTail`.
2. `shell/internal/teleprompter.Service` owns at most one session. It relays every valid JSON line verbatim as the Wails event `teleprompter:event`, publishes phase changes as `teleprompter:state`, and keeps the last `script` and `position` events in its snapshot so a view that opens mid-session can catch up. The host exposes `TeleprompterStart`, `TeleprompterStop` and `TeleprompterState` (host API version 5); start uses the same first-use model gate as Transcript Compare and defaults to the `tiny` model.
3. Stopping is cooperative: `Stop` creates the sidecar's `--stop-file`; the sidecar ends its audio stream, flushes, and exits 0. The service kills it if it has not exited after a grace period. This matches the `.cancel` sentinel files the other sidecars use.
4. A live session counts as busy, so the host will not switch REAPER projects under it, and `Shutdown` stops the session before closing the supervisor, without holding the host lock (the service's state callback takes it).
5. The sidecar is frozen as `manuscript-teleprompter`. The release freeze now collects `faster_whisper` package data for every sidecar that uses it, because the Silero VAD model it ships was otherwise missing from the frozen build.

### Consequences

- **Good:** No server, port or polling is introduced; the frontend subscribes to Wails events.
- **Neutral:** Event volume passes through Wails as JSON; its cost in the UI has not been measured yet.
- **Bad:** A stop that has to fall back to a kill loses any words not yet flushed.
- **Bad:** Microphone capture is Windows-only (`dshow`) for now, so the teleprompter is too until capture is made portable.
- **Good:** The VAD fix also corrected a latent defect: the frozen Transcript Compare, which uses `vad_filter=True`, had no VAD model and would have failed in a packaged release.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### The existing batch pattern

- Bad, because it discards stdout and polls result files, while the UI must show dozens of events per second immediately.

### A loopback server or port

- Bad, because the desktop host may not open a loopback server or port.

### Stop the sidecar with Ctrl+C

- Bad, because Go cannot send Ctrl+C to a child process on Windows.
