# 0035. Live transcription techniques are ported into the sidecar, not taken as dependencies

- **Status:** Accepted
- **Date:** 2026-09-19

## Context and problem

Two open-source projects solve parts of live transcription with `faster-whisper`. WhisperLive (Collabora, MIT) provides VAD-gated audio windows, a rolling decode and per-word timestamps, as a WebSocket client and server. whisper_streaming (ÚFAL, MIT) provides the LocalAgreement policy: emit only the words that consecutive decodes agree on. Using WhisperLive as a package would mean running its server, which the app may not do ([daw-integration.md](../architecture/daw-integration.md) rules out a loopback server, and [ADR 0022](0022-live-sidecar-events-over-wails-and-stop-file.md) relays events over Wails instead). It also keeps its own model cache, bypassing the hashed asset catalog and first-use provisioning flow in [first-use-dependency-provisioning.md](../architecture/first-use-dependency-provisioning.md), and its client-side audio capture is redundant when capture and inference are both local.

## Decision drivers

- Using WhisperLive as a package would mean running its server, which the app may not do (no loopback server; events are relayed over Wails).
- WhisperLive keeps its own model cache, bypassing the hashed asset catalog and first-use provisioning flow.
- Its client-side audio capture is redundant when capture and inference are both local.

## Considered options

1. Re-implement the techniques from scratch in `live_asr.py` against the repository's own pinned `faster-whisper` stack
2. Import, vendor or run WhisperLive and whisper_streaming (using WhisperLive as a package, with its server and client)

## Decision outcome

**Chosen option: re-implement the techniques from scratch in `live_asr.py` against the repository's own pinned `faster-whisper` stack**, because using WhisperLive as a package would mean running a server the app may not run and a model cache that bypasses the hashed asset catalog.

`sidecars/manuscript-teleprompter/core/live_asr.py` re-implements those techniques from scratch against this repository's own pinned `faster-whisper` stack. It does not import, vendor or run either project, and no server or client split is introduced. Its module header attributes both sources and their copyright holders (`live_asr.py:16-26`): WhisperLive (`Copyright (c) 2023 Vineet Suryan, Collabora Ltd.`) for the windowed rolling decode and word timestamps, and whisper_streaming (`Copyright (c) 2023 ÚFAL`) for LocalAgreement (`_confirm_agreed_words`, `live_asr.py:138`). The model is resolved through the existing asset catalog: the host looks up the model in `apps/desktop/internal/whisper` and passes `--model-dir` (`apps/desktop/bindings.go`, `apps/desktop/internal/teleprompter/service.go`), so the desktop host never relies on an auto-downloaded cache. A sidecar started by hand without `--model-dir` can still fall back to faster-whisper's own download. Both reuses are recorded in [local-dependency-evaluation.md](../research/local-dependency-evaluation.md).

### Consequences

- **Good:** No new runtime dependency, server or port, and model integrity is checked by the same catalog as every other model.
- **Bad:** The port freezes a snapshot of two upstream designs. Improvements to either project are not picked up unless someone re-reads them and ports them deliberately.
- **Neutral:** MIT requires the notice to travel with copied code. Because this is a clean-room re-implementation of the design, there is no upstream commit to pin, and the attribution is of the technique; if any upstream source is ever copied verbatim, the exact commit and full notice must be added at that point.
- **Neutral:** The tracker's design also follows Autocue (MIT), credited in `script_tracker.py`'s docstring ([ADR 0033](0033-the-teleprompter-follows-speech-with-continuous-alignment-and-pause-resume.md)), and is recorded beside the two above in [local-dependency-evaluation.md](../research/local-dependency-evaluation.md).
- **Bad:** We own the streaming loop's bugs and its CPU cost, which grows with segment length because each decode re-reads the whole open segment (bounded by `MAX_BUFFER_SECONDS`).
- **Neutral:** Adopting a package or server for live transcription, or a different streaming framework, would need a new ADR that supersedes this one.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Import, vendor or run WhisperLive and whisper_streaming

- Bad, because using WhisperLive as a package would mean running its server, which the app may not do.
- Bad, because WhisperLive keeps its own model cache, bypassing the hashed asset catalog and first-use provisioning flow.
- Bad, because its client-side audio capture is redundant when capture and inference are both local.
