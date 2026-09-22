# Native Recording Suite

**Source:** user request of 2026-09-21 ("we should create a prd to plan implementing our own recording suite instead of relying on audacity or reaper. long-term goal since audacity is free and easy to use and that is already planned"). Nothing here is built yet; this is a long-term, deferred initiative like the Audacity adapters it supersedes in intent (`docs/roadmap.md:59`). Citations are `file:line` on branch `claude/recording-suite-prd-1b03c7`.

## Problem Statement

- Recording a narration take today requires a narrator to already own, install, and operate a third-party DAW (REAPER) or editor (Audacity, deferred per `docs/roadmap.md:59`) before the suite can help them at all. The app itself never captures audio — it only reads REAPER project state through a file-based bridge (`docs/architecture/reaper-bridge.md:1-25`) and never writes new audio (`docs/architecture/threat-model.md:24`).
- REAPER is a paid, general-purpose DAW with a learning curve; Audacity is free but was only ever slated as a second *adapter* for the same bridge-and-review model, not a capture engine we control (`docs/roadmap.md:59`, `docs/prds/project-workspace-and-daw-link.prd.md:55`). Neither path gives the narrator a zero-install, first-run recording experience, and both keep the suite's core review pipeline (duplicate/pickup detection, character continuity, diagnostics — `docs/roadmap.md:20-42`) dependent on an external program being installed, licensed (REAPER), launched, and kept in sync (`docs/prds/project-workspace-and-daw-link.prd.md:21`, W10: no liveness check exists).
- The requested end state is a recording capability the app owns end to end — capture, monitor, review takes, do basic non-destructive editing — so a narrator can go from "open the app" to "recorded, reviewable audio" with nothing else installed. This is explicitly long-term: it is a new subsystem class (real-time audio I/O, waveform storage, an editing model) the codebase has never built, not a bridge extension.

## Evidence

- **The REAPER bridge cannot capture audio and was never meant to.** It exchanges percent-encoded command/response lines through files in a shared session directory, polled on REAPER's `reaper.defer` tick (`docs/architecture/reaper-bridge.md:19-25`); it requires REAPER running with the launcher script imported (`reaper-bridge.md:9,43-46`); there is no loopback server (ADR 0031, `reaper-bridge.md:3`) and no audio-hardware access — "The harness cannot show the app's UI, or anything that needs audio hardware" (`reaper-bridge.md:143`). It dispatches named commands for markers, regions, and item extension data (`reaper-bridge.md:100-109,120`) and creates takes only as a narrator-approved, undoable REAPER action (`docs/roadmap.md:69`) — it reviews and annotates what REAPER already recorded; it does not record.
- **Audacity was scoped as a second adapter to the same model, not a capture engine we own.** `docs/roadmap.md:59` lists "Audacity adapters after the shared contract and REAPER workflow are proven" under deferred work; `docs/prds/project-workspace-and-daw-link.prd.md:55` scopes DAW support to REAPER only — "Multiple DAW files per project, or non-REAPER DAWs" is explicitly out of scope. Neither document proposes native capture.
- **One narrow, non-shipping capture path already exists — speech recognition, not recording.** The Manuscript Teleprompter's "local microphone listening with a Whisper model and word highlighting" (`docs/roadmap.md:63`, `docs/architecture/manuscript-teleprompter.md:3,8`) opens the mic via PyAV's Windows `dshow` input in the Python sidecar (`sidecars/manuscript-teleprompter/core/live_asr.py:418-429`), resamples with `av.AudioResampler`, and streams transcription events over stdout/NDJSON to the Go host (ADR 0022) — no audio file is ever written, no waveform exists, and the code comment marks the dshow path "manual-testing only," untested by CI (`live_asr.py:420-423`). A separate, explicitly non-product spike (`sidecars/manuscript-teleprompter/spikes/moonshine_probe.py:174,186,237`) uses `sounddevice` instead, but spikes are research tools, not shipped code (pattern per `reaper-bridge.md:14`). Device enumeration/picker UX for even this narrow mic path is unresolved (`docs/prds/teleprompter-engines-and-input-devices.prd.md`).
- **No Go/Wails-side audio code exists at all.** No `getUserMedia`/`AudioContext`/`MediaStream` usage in `apps/ui/src`; all capture logic today lives in a Python sidecar, not the Go host or the React UI. No waveform-rendering code exists anywhere in the repository.
- **The threat model has no boundary for microphone access or audio-file writing.** `docs/architecture/threat-model.md` models sidecar-argument injection for the `--mic` flag (row 4a, `:90`, argv-only via `exec.CommandContext`, no shell, inside a Windows Job Object) and native audio *decoders* reading existing WAV files (row 6d, `:114`), but the asset table treats project audio as read-only today (`threat-model.md:24`). Nothing addresses a new trust boundary where the app itself captures live audio and writes new files to disk.
- **Two standing architectural rules this PRD must respect.** (1) "Analyzers report findings and never change audio or manuscript on their own" (`docs/adr/0032-analyzers-report-findings-and-never-change-audio-or-manuscript-on-their-own.md`) — a native recorder is not an analyzer, so it is allowed to write audio, but every downstream analyzer keeps the same read-only contract regardless of where the audio came from. (2) "Take creation requires narrator approval, explicit target item identity, and an undoable REAPER action" (`docs/roadmap.md:69`) — the equivalent native rule (approval, explicit identity, undo) has to be designed fresh, since there is no REAPER undo stack to lean on.
- **Platform scope today is Windows-only, unsigned first stable** (`docs/roadmap.md:52`, owner decision D7; ADR 0030 "Windows first"), desktop framework is Go + Wails host with a React/TS UI and Python sidecars for heavier processing (`docs/architecture/codebase-map.md:12,54,76`). A native recorder's capture layer would need a real-time-safe audio API reachable from Go (e.g., WASAPI via a CGo/malgo-style binding) — nothing like this exists in the codebase yet; this is genuinely greenfield, not an extension of an existing library choice.
- **No prior research file covers this.** `docs/research/` has no recording, waveform, or capture-engine document; no ASIO/WASAPI research exists. `docs/research/local-dependency-evaluation.md` is a general dependency-evaluation doc, not on-topic here.

## Proposed Solution

Do not attempt to rebuild REAPER. Build a narrow, purpose-built **capture-and-take** subsystem — record, monitor, name/organize takes, basic non-destructive trim/mark — that plugs into the *same* review pipeline REAPER audio already feeds (findings, duplicate/pickup detection, character continuity, diagnostics), behind a DAW-agnostic contract analogous to the existing [findings contract](../architecture/findings-contract.md). REAPER stays fully supported as an option for narrators who want a full DAW; native recording becomes a second, always-available source of takes for narrators who don't want to install one. This keeps the bet small and reversible: if native capture proves inadequate for narrators' real needs, REAPER support is untouched and nothing downstream has to change.

Explicitly **not** proposed: a general audio editor, a multitrack mixer, plugin/VST support, or feature parity with Audacity's or REAPER's editing depth. The target is "record a clean take, hear it back, mark the good one" — the minimum a narrator needs before any of this suite's review tooling can run.

## Key Hypothesis

We believe a narrator who currently must install and learn REAPER (or plans to add Audacity) just to get audio into the review pipeline will instead use a built-in recorder if it can (a) capture a clean take from a chosen input device with visible level metering and low enough monitoring latency to read comfortably against, and (b) hand that take to the existing review tooling with no manual export/import step. We'll know we're right when a narrator can complete a full chapter's first-pass recording using only this app, and the resulting takes flow into duplicate/pickup detection and diagnostics without conversion.

## What We're NOT Building

- A multitrack DAW, mixing console, or plugin/VST/VST3 host.
- Destructive waveform editing (spectral repair, noise reduction, EQ, compression) — that class of editing stays REAPER/Audacity's job if a narrator wants it.
- Cross-platform capture (macOS/Linux) in the first phases — platform scope stays Windows-only per the existing roadmap (`docs/roadmap.md:52,60`) until the Windows path is proven.
- Removing or deprecating the REAPER bridge. It stays the supported path for narrators who prefer a full DAW; this PRD adds an alternative, it does not retire one.
- Cloud recording, remote sessions, or multi-narrator collaboration.
- Automatic take selection or comping — per ADR 0032's spirit, the recorder captures and organizes; a human always picks the keeper.
- A firm timeline. This is long-term, deferred work like the Audacity adapters it replaces in intent; it is not scheduled against a milestone until the open questions below are answered by the owner.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Capture round-trip latency (input to monitor) | Under a narrator-comfortable threshold (owner to set; ballpark 20-30ms is typical for WASAPI shared-mode monitoring) | Manual measurement with a loopback/latency test rig; recorded as an ADR once a technical spike answers Q3 |
| Recorded take integrity | Bit-exact, no dropouts/clicks under sustained recording (chapter-length, 30+ min) | Automated soak test once the capture engine exists; spectral/silence analysis for dropout detection |
| Device enumeration coverage | Every input device Windows exposes via WASAPI appears and is selectable | Manual test across at least two physical machines/interfaces |
| Downstream compatibility | A native take is indistinguishable from a REAPER-recorded take to every existing analyzer (duplicate/pickup, diagnostics, character continuity) | Contract test: same finding output for equivalent audio regardless of source |
| No silent audio edits | Every trim/mark is narrator-confirmed and undoable | Unit tests on the take-editing model |
| Adoption signal (post-ship) | Narrators who try native recording continue using it for a full project rather than falling back to REAPER | Owner follow-up, not an automated metric |

## Open Questions

- [ ] **Q1. Scope of "recording suite."** Record-and-organize only (this PRD's default), or does the owner want basic non-destructive trim/split/normalize too? Editing scope changes every phase below.
- [ ] **Q2. Does this replace or coexist with the REAPER bridge?** Recommendation: coexist — REAPER stays supported, native recording is an alternative entry point that feeds the same review pipeline. Full replacement is a much larger bet (project-file format, undo model, region/marker parity) that should not be assumed without owner sign-off.
- [ ] **Q3. Capture engine choice.** No Go audio-capture library is in use anywhere in the codebase today. Candidates: a CGo binding to WASAPI (e.g., `malgo`/miniaudio), a small dedicated Go audio package, or keeping capture in a Python sidecar (consistent with the existing teleprompter pattern, `live_asr.py:418-429`) and only surfacing controls/monitoring in Go/React. A spike phase should answer this before any UI is built.
- [ ] **Q4. Where does captured audio and take metadata live?** A project-owned folder (parity with `<project>/TranscriptCompare/`-style layout) versus something REAPER-project-shaped. Affects whether a native take can later be dragged into a REAPER project by narrators who switch tools.
- [ ] **Q5. Undo/approval model for native takes**, replacing REAPER's own undo stack (which the current "narrator-approved, undoable REAPER action" rule leans on, `docs/roadmap.md:69`). What does "undoable" mean when the app itself owns the file on disk?
- [ ] **Q6. Device-permission UX.** Windows doesn't gate microphone access the way macOS does, but the teleprompter's device-picker problem is already open and unresolved (`docs/prds/teleprompter-engines-and-input-devices.prd.md`) — should this PRD's device selection and that PRD's be the same shared component, built once?
- [ ] **Q7. Monitoring path.** Does the narrator monitor through the app (direct/loopback monitoring, adds latency risk) or through their existing audio interface's own hardware monitoring (no latency, but then the app can't show a live level meter as reliably)? This is a design decision a technical spike needs to inform, not guess at.
- [ ] **Q8. Chapter/region structure parity.** REAPER's regions and item extension data currently carry line-identity information the review pipeline depends on (ADR 0026). A native recorder needs an equivalent identity scheme from day one, or downstream review tooling can't consume its takes.
- [ ] **Q9. Priority relative to other deferred/queued PRDs.** This sits alongside macOS/Linux support, non-English languages, and the Audacity adapters in the deferred list (`docs/roadmap.md:59-62`) with no committed order. The owner should say whether this jumps the REAPER-automation-follow-through queue or waits behind it.

## Users & Context

**Primary User**: a narrator who wants to record a chapter without installing or learning a DAW first, or who already uses this suite's review tooling with REAPER and wants a lighter alternative for quick pickups.
**Current behavior**: install and configure REAPER (cost, licensing, learning curve) or Audacity (free, but not yet integrated at all) before any review feature can run.
**Trigger**: starting a new recording session, or wanting a fast pickup without switching to an external program.
**Success state**: the narrator opens the app, picks an input device, sees levels, records a take, hears it back, marks it as the keeper, and the review pipeline picks it up with no export/import step.
**Job to Be Done**: When I sit down to record, I want everything — capture, monitoring, and review — in one place, so I don't need a second paid or separately-learned program just to get audio onto disk.
**Non-Users**: narrators who already have a REAPER-based workflow they're happy with and never intend to change it (they keep using the bridge, unaffected).

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | Enumerate and select an input device (WASAPI, Windows) | 1 (spike) / 2 |
| Must | Record to a project-owned audio file with visible level metering | 2 |
| Must | Play back a recorded take | 2 |
| Must | Organize takes (name, timestamp, chapter/line association) so downstream review can find them | 3 |
| Must | A native take produces the same findings as an equivalent REAPER take (contract parity) | 3 |
| Should | Mark the "keeper" take among several; narrator-confirmed, undoable | 3 |
| Should | Basic non-destructive trim (start/end only, no mid-clip edits) | 4 (pending Q1) |
| Could | Punch-in re-record over a marked region | 4 (pending Q1) |
| Won't | Multitrack mixing, plugins, spectral editing, cross-platform capture, cloud sessions | - |

**User flow (target, Must-scope only):** open a project, go to a new "Record" area, pick an input device from a list, see a live level meter, press Record, read from the manuscript/teleprompter, press Stop, hear the take played back, name/accept it as a take for that line, see it appear in the same take-review UI that REAPER-sourced takes already use.

## Technical Approach

**Feasibility**: LOW-MEDIUM at this stage — not because any single piece is exotic, but because the codebase has zero existing real-time audio I/O, and real-time capture without dropouts is a different reliability bar than the batch/offline audio processing (Python sidecars, WAV decoding) the codebase already does well. A dedicated spike phase (Phase 1) is required before any UI or file-format commitment; without it, every other phase's estimate is a guess.

**Architecture notes**

- **Capture layer.** Two realistic shapes: (a) a CGo/native binding to WASAPI reachable from the Go host (keeps capture close to the UI process, but CGo has cross-compilation and Windows-toolchain implications the current pure-Go/Wails build may not have); (b) a dedicated capture sidecar (Python or a small Go binary) mirroring the existing sidecar-per-concern pattern (`docs/architecture/codebase-map.md:76`), streaming audio to the host over a local, unauthenticated file/pipe channel similar to the REAPER bridge's design but for raw audio instead of text commands. Both need a spike before choosing (Q3).
- **File format and storage.** Reuse the existing project-folder convention (`<project>/<Feature>/...`, as `TranscriptCompare` and `ManuscriptGuide` already do) rather than inventing a new project-root concept; write WAV (already a first-class format per the existing decoder work, `threat-model.md:114`) rather than a compressed format, to avoid adding a new decode/encode dependency.
- **Contract with the review pipeline.** Extend or sibling the [findings contract](../architecture/findings-contract.md) pattern: define a take/recording-session contract that both the REAPER bridge's take-creation path and a new native recorder satisfy, so duplicate/pickup detection, character continuity, and diagnostics never need to know which one produced a given file (mirrors "the dashboard consumes findings but does not reproduce analyzer algorithms," `docs/roadmap.md:68`).
- **Line identity.** REAPER's item extension data carries line identity today (ADR 0026); a native recorder needs an equivalent scheme (e.g., a sidecar metadata file keyed by take) designed in the same phase that defines the take contract, not bolted on after.
- **Threat model.** This is a new trust boundary — the app writes new audio files and opens a live hardware device it did not open before. A phase must add a row to `docs/architecture/threat-model.md` covering device access, file-write permissions/paths, and any local IPC channel the capture layer uses, before the capture engine ships.
- **Reuse the teleprompter's device-picker work if it lands first.** `docs/prds/teleprompter-engines-and-input-devices.prd.md` is already trying to solve microphone enumeration/selection UX; check its status before duplicating that work (Q6).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Real-time capture drops samples or glitches under load (no prior art in this codebase) | High | Phase 1 spike with a soak test before any UI commitment; consider a proven library (miniaudio/malgo) over hand-rolled WASAPI calls |
| CGo build/cross-compilation breaks the existing pure-Go Wails build pipeline | Medium | Evaluate a sidecar-based capture path as a fallback (mirrors existing sidecar pattern) if CGo proves too disruptive |
| Scope creep toward "build a DAW" | High | Hold the line at Must-scope (record, play back, organize, hand off) until Q1 is answered; every editing feature beyond trim is Won't by default |
| Downstream analyzers silently assume REAPER-specific metadata (item extension data) that native takes can't produce | Medium | Design the take contract and line-identity scheme together (Phase 3), test both sources against the same analyzer suite |
| This competes for owner attention with the already-queued REAPER Automation Follow-Through PRD (25 phases, in delivery) | Medium | Q9 asks the owner directly; do not silently reprioritize |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Capture engine spike | Answer Q3/Q7: prototype WASAPI capture (CGo/sidecar), measure round-trip latency, soak-test for dropouts; no shipped UI | pending (owner answers Q1-Q3 first) | - | Owner answers to Q1-Q3 | - |
| 2 | Minimum recorder | Device selection, live metering, record-to-file, playback; project-folder storage | pending | - | 1 | - |
| 3 | Take contract and identity | DAW-agnostic take/recording-session contract; line-identity scheme for native takes; downstream analyzers verified against both sources | pending | - | 2 | - |
| 4 | Take review integration | Native takes appear in the same take-review UI as REAPER takes; keeper marking, undo | pending | - | 3 | - |
| 5 | Threat model and hardening | New row(s) in `threat-model.md` for mic access and audio-file writing; security review before wider use | pending | Can start once Phase 2's architecture is fixed | 2 | - |
| 6 | Basic non-destructive editing (trim/punch) | Only if Q1 says yes | pending (scope gated on Q1) | - | 4 | - |

**Phase 1.** Goal: know whether native capture is technically sound on this stack before committing to anything else. Success: a working, if throwaway, capture prototype with measured latency and a dropout-free soak test; a written recommendation on Q3/Q7 recorded as a Decisions Log entry or new ADR.
**Phase 2.** Goal: a narrator can record and play back a take with nothing but this app. Success: manual test across at least two machines/interfaces; no crash or corruption across a chapter-length session.
**Phase 3.** Goal: native takes are invisible to the review pipeline as a distinction. Success: the same analyzer test suite passes on a native take and an equivalent REAPER take.
**Phase 4.** Goal: one take-review experience regardless of source. Success: Playwright/visual coverage of the merged UI; narrator can mark a keeper and undo it.
**Phase 5.** Goal: the new attack surface is modeled and reviewed. Success: `security-reviewer` sign-off; `threat-model.md` updated.
**Phase 6.** Goal (conditional): trim without destructive edits. Success: unit tests proving the original capture is never overwritten in place.

**Parallelism Notes**: strictly sequential through Phase 4 — each phase's architecture depends on the prior phase's chosen shape (capture engine, then storage, then contract, then UI). Phase 5 can start once Phase 2's on-disk/IPC design is fixed, in parallel with Phase 3-4. Phase 6 is conditional on Q1 and only starts after Phase 4.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | New spike code under `sidecars/` or a throwaway `apps/desktop/internal/recording/spike/`, not shipped | None expected; spikes are isolated by convention |
| 2 | New `apps/desktop/internal/recording/`, new Wails bindings (`hostAPIVersion` bump), new `apps/ui/src` recording page/components | Teleprompter Engines and Input Devices PRD (device picker, Q6) |
| 3 | Findings-contract-adjacent code (`docs/architecture/findings-contract.md` and its Go/TS implementations), analyzer test suites | REAPER Automation Follow-Through PRD phases that also touch take/marker handling |
| 4 | Take-review UI (shared with `take-review-pickups-duplicates-take-intelligence.prd.md`'s delivered work) | Take Review PRD — check its current file layout before touching shared components |
| 5 | `docs/architecture/threat-model.md`, `SECURITY.md` | Any other in-flight PRD that also touches the threat model (check at merge time per repo convention) |
| 6 | Recording UI and storage from Phase 2-4 | None expected if phases 1-5 landed first |

Cross-cutting: every phase follows `CLAUDE.md`'s plan → `change-impact-scan` → TDD → `full-verification-gate` → `feature-cleanup` sequence; a Wails binding change bumps `hostAPIVersion` in all three places (`docs/prds/README.md:105`); any nav addition (a "Record" page) serializes against other nav-adding PRDs per the cross-PRD sequencing notes (`docs/prds/README.md:107`).

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Replace vs. coexist with REAPER | Coexist (proposed, Q2 open for owner confirmation) | Full replacement of the REAPER bridge | Full replacement is a much larger, riskier bet; coexistence keeps today's shipped REAPER workflow untouched while native recording is proven |
| Scope of editing | Record/organize only by default; trim/punch conditional on Q1 | Full waveform editor matching Audacity/REAPER | Matches the project's incremental, evidence-first PRD pattern; avoids silently building a DAW |
| Capture engine language/location | Not yet decided — spike first (Q3) | Assume CGo/WASAPI without validation | No prior art in this codebase for real-time audio I/O; guessing here would make every later estimate unreliable |
| Platform scope | Windows-only, matching the rest of the roadmap (`docs/roadmap.md:52,60`) | Cross-platform from day one | Consistent with standing scope; revisit only after macOS/Linux support is itself prioritized |
| Timeline | Explicitly unscheduled/long-term, like the Audacity adapters it supersedes in intent | Commit to a milestone now | The owner asked for this as a long-term goal, and Q1-Q3 are unanswered technical unknowns that would make any date fictional |

## Research Summary

**Technical Context**: verified in code and docs on this branch — the REAPER bridge's architecture and limits, the Audacity/DAW-dependency stance in the roadmap and the Project Workspace PRD, the one existing (non-shipping) microphone-capture path in the teleprompter sidecar, the absence of any Go/Wails-side audio code or waveform rendering anywhere in the repo, and the threat model's current silence on microphone/audio-write trust boundaries. See the background research citations embedded in the Evidence section above.
**Not verified**: actual latency figures for WASAPI capture on this stack (no prototype exists yet — Phase 1's job), narrator appetite for a native recorder versus continuing with REAPER/Audacity (owner/user research, not code research), and whether CGo is viable in the current build pipeline without disruption.

---

*Generated: 2026-09-21*
*Status: DRAFT — open questions unanswered; no phase scheduled*
