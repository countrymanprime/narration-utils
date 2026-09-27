# CoreAudio Capture

**Source:** [Provider Ports](../architecture/provider-ports.md#not-built-here-and-where-it-went) P15/#696's "Not built here" table ("No PRD yet: the app is Windows first"); the owner has since said the un-PRD'd Coulds are wanted work, not backlog (#509, 2026-09-27: "I want to do everything it proposed... if nothing else is going on, then we pick up the nice to haves as well"). This PRD fills that row.

**Tracking:** [#711](https://github.com/countrymanprime/narration-utils/issues/711).

## Problem Statement

The capture port (`docs/architecture/provider-ports.md#the-ports`, ADR 0301) has exactly one registered backend, `dshow`, and it declares `platforms: ("windows",)` (`libs/python/narration_common/ports/capture.py:40-45`, `sidecars/manuscript-teleprompter/core/capture_dshow.py:40`). `apps/desktop/internal/captureport/captureport.go:51-65`'s `ForIn` returns a `*port.NotSupportedError` ("There is no capture backend for %s.") for every other `GOOS`, macOS included. The app is Windows-first by roadmap decision (ADR 0030), but nothing about the capture port, the teleprompter's microphone path, or the registry pattern is Windows-specific by design — only the one row that exists is. A narrator on macOS who opens the Manuscript Teleprompter's live session gets no microphone at all, not a degraded one: `live_asr.py`'s `iter_microphone_chunks` looks the backend up through the registry (PR #696's own description: "the microphone reader... takes its chunks from the `dshow` row of `BACKENDS`") and there is no row to find.

## Evidence

- **The port is already platform-generic; only the row is missing.** `narration_common.ports.capture.CaptureBackend` is a `Protocol` with `list_devices()` and `chunks(device, chunk_seconds)` (`libs/python/narration_common/ports/capture.py:56-64`); nothing in its shape, or in `apps/desktop/internal/captureport/captureport.go`'s `Backend` interface (`Name() string`, `captureport.go:24-27`), mentions Windows or DirectShow. `CaptureDescriptor.__post_init__` only requires `platforms` to be non-empty and `modes` to be empty (`capture.py:40-45`) — a `("darwin",)` row is exactly as valid as `("windows",)`.
- **The dshow backend is the concrete pattern to mirror, and it settles native-recording-suite's Q3 in Python's favor.** [Native Recording Suite](native-recording-suite.prd.md) Phase 1 (still `pending`) asks "CGo binding to WASAPI... a small dedicated Go audio package, or keeping capture in a Python sidecar" (`native-recording-suite.prd.md:57`, Q3) and lists "CGo build/cross-compilation breaks the existing pure-Go Wails build pipeline" as a Medium-likelihood risk (`native-recording-suite.prd.md:108`). Provider Ports P10/P11 already answered the *teleprompter's* capture-engine-location question without waiting for that spike: `capture_dshow.py`'s module docstring says the port only "gives it the port's shape" — the capture code (PyAV open/resample/chunk loop) "was already here" in the Python sidecar (`capture_dshow.py:1-13`), and `provider-ports.md`'s own Decisions Log confirms "Go learns a Python engine's capability from a static descriptor plus the probes that exist, not from asking the sidecar" (`provider-ports.md:83`) — i.e. Go never touches the audio device at all. `captureport.go`'s package comment states this plainly: "Nothing calls this yet except the provider capabilities binding... `teleprompterinput.go`'s `deviceLister` stays the test seam" (`captureport.go:10-11`) — the Go side is a declaration, not an implementation.
- **PyAV already wraps a macOS capture path via FFmpeg's `avfoundation` demuxer, the direct analog of `dshow`.** `capture_dshow.py:51` opens `av.open(file=f"audio={device}", format="dshow")`; PyAV is a thin Python binding over the FFmpeg libraries the project already vendors as a dependency for `dshow` (no new package). FFmpeg's `avfoundation` input device is Apple's own supported capture path for audio (it opens devices through `AVCaptureDevice`/`AVCaptureSession`, which sits on top of Core Audio) and is the macOS counterpart FFmpeg ships to `dshow` on Windows and `alsa`/`pulse` on Linux — the same demuxer family, addressed the same way (`format=` plus a device string) `av.open` already takes.
- **Device listing already has a working, non-hardware pattern to mirror.** `devices.py`'s module docstring (`devices.py:1-33`) records that PyAV can list `dshow` devices without shelling out to `ffmpeg` directly, by opening the device in "list" mode (which always raises after logging) and capturing FFmpeg's own log lines through `av.logging.Capture` filtered to the `"dshow"` log context (`devices.py:64-70`, `parse_device_list`). FFmpeg's `avfoundation` demuxer has the identical private option (`list_devices=true`) and the identical behavior — it logs every audio/video device to its own `"AVFoundation input device"` log context, then fails to open, rather than starting a capture. The same `av.logging.Capture` + regex-parse shape applies; only the log-context name and the two-line device format differ.
- **Addressing differs from `dshow` in one concrete way that the port's contract already anticipates loosely, not precisely.** `dshow` opens a device by the exact string `list_devices()` returned (`capture.py`'s module docstring: "The name a device is listed under is the name that opens it", `capture.py:10-12`; `InputDevice.name`, `capture.py:48-53`). FFmpeg's `avfoundation` demuxer instead addresses a device by **index** (`av.open(file=":0", format="avfoundation")` for the first audio device, `-list_devices` prints `[AVFoundation input device] [0] Built-in Microphone`) — it has no by-name open path. A `CoreAudioBackend.chunks(device)` therefore cannot pass `device` straight through to `av.open` the way `DshowBackend.chunks` does (`capture_dshow.py:51`); it must resolve the name back to the index FFmpeg reported at listing time. This is the one real design decision this PRD adds beyond "port a working adapter" — see Open Questions Q1 and the Decisions Log.
- **The trust boundary this needs already has a Windows-only row that must widen.** `docs/architecture/threat-model.md` row 4a covers "sidecar-argument injection for the `--mic` flag... argv-only via `exec.CommandContext`, no shell, inside a Windows Job Object" (cited by [Native Recording Suite](native-recording-suite.prd.md), Evidence section); the current wording and any Windows-specific enforcement (the Job Object) need a re-read for a platform where that specific sandbox doesn't exist, not a new row — the trust boundary (an untrusted device-name string reaching a subprocess argv) is unchanged in kind.
- **Nothing in the UI reads capture rows yet, so this ships with no UI change.** `ProviderCapabilities` (`apps/desktop/bindings_providers.go:14-20`) already reports every capture row generically, keyed by platform support, but "No screen reads it yet" (`bindings_providers.go:17`, `provider-ports.md:54`). Adding a `darwin` row changes that binding's payload (a new key under `capture`) but adds no narrator-visible control, matching how the port has no chooser UI for capture today (one backend per platform, no modes: `provider-ports.md:14`).
- **The guard already generalizes for free.** `libs/python/tests/test_provider_guard.py` and `apps/desktop/providerguard_test.go` read provider names from the registries and the adapters' own `descriptor = …Descriptor(…)` declarations (`provider-ports.md:48-50`), not from a hardcoded list — a new `coreaudio` row needs no guard change, the same way adding an engine needs "no change" to the guards (`provider-ports.md:61`, step 4).

## Proposed Solution

Add one new capture-port row, `coreaudio`, following the exact shape `dshow` already established end to end:

1. A Python adapter, `sidecars/manuscript-teleprompter/core/capture_avfoundation.py`, registering a `CoreAudioBackend` into `narration_common.ports.capture.BACKENDS` with `descriptor = CaptureDescriptor(name="coreaudio", label="Core Audio", platforms=("darwin",))`, implementing `list_devices()` (via the FFmpeg-log-capture pattern, mirroring `devices.py`) and `chunks(device, chunk_seconds)` (via `av.open(file=f":{index}", format="avfoundation")`, mirroring `capture_dshow.py`'s resample/chunk loop) — resolving `device` (a name) to FFmpeg's device index internally, so the Protocol's by-name contract holds for every caller.
2. A Go row, `apps/desktop/internal/captureport/captureport.go`: `const CoreAudio = "coreaudio"`, a new `Register` call declaring `Platforms: []string{"darwin"}` — a declaration only, exactly as `dshow`'s row is (`captureport.go:34-42`).
3. Extend the capture conformance suite (`captureporttest`, `capture_conformance.py`) with a fake `coreaudio`-shaped row proving the same rules `dshow` proves today (`provider-ports.md:44`), and add device-listing/name-resolution unit tests for the FFmpeg-log-parsing and index-translation logic, mirroring `sidecars/manuscript-teleprompter/tests/test_capture_dshow.py`'s structure (its exact assertions are for `dshow`; the new tests are `test_capture_avfoundation.py`'s own, not copies).
4. Re-read threat-model row 4a for the new platform and its subprocess-argv path (no Job Object equivalent assumed without verifying what sandboxing, if any, macOS gets); update the row's wording rather than adding a new one, since the boundary is the same kind of risk on a second platform.
5. No UI, no Wails binding change, no `hostAPIVersion` bump: `ProviderCapabilities` already reports the row for free once it exists in the Go registry (`bindings_providers.go:52-54` iterates `captureport.Backends.Entries()` with no per-name logic).

This is scoped as **listing and streaming only** — the minimum a `CaptureBackend` Protocol implementation requires (`capture.py:56-64`). It does not touch the teleprompter's session/level-meter callers (`live_asr.py`), which already resolve backends generically through the registry and need no change to gain a second platform, the same way [adding an engine](../architecture/provider-ports.md#adding-an-engine) needs no call-site edits.

## Key Hypothesis

We believe a `coreaudio` row, implemented as a PyAV `avfoundation` adapter mirroring `dshow`'s shape exactly, is sufficient to make the teleprompter's live microphone path (`list_devices`, `chunks`) work on macOS with no change to any caller, any Go binding, or any UI. We'll know we're right when the capture conformance suite passes for the new row on the same terms `dshow` passes it, and a manual verification on real Apple hardware (Q2) shows device listing and streamed chunks matching the same rules `dshow`'s spike proved on Windows hardware (`devices.py:27-30`, "Verified on real hardware").

## What We're NOT Building

- Any UI: no device picker, no capture-source setting. Capture has no chooser (`provider-ports.md:14`: "Capture, `CaptureBackend` | none (one backend per platform)"); this stays true with two platforms.
- A native Swift/Objective-C binding to `AVAudioEngine`, or a CGo binding to the Core Audio HAL — see Technical Approach for why PyAV's `avfoundation` demuxer is chosen instead, and the Decisions Log for the rejected alternatives.
- Any change to [Native Recording Suite](native-recording-suite.prd.md)'s scope, timeline, or open questions (it stays deferred, long-term, Windows-first, and unrelated to the teleprompter's existing narrow capture path — see that PRD's Evidence section, which already distinguishes the two).
- Windows or Linux capture changes. `dshow` is untouched.
- A new project-owned audio file format, waveform storage, or any of [Native Recording Suite](native-recording-suite.prd.md)'s "record and organize takes" scope — this PRD only makes the existing teleprompter microphone path (listen, transcribe, throw away — no file is written, `capture_dshow.py`'s docstring: same behavior for `coreaudio`) available on a second platform.
- Non-English language support, or any change to the ASR/live-transcription engines themselves.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Conformance parity | `coreaudio` passes every rule `capture_conformance.run` and `captureporttest.Run` check for `dshow` | Automated (fake device), CI-safe |
| Device listing coverage | Every input device macOS/Core Audio exposes to `avfoundation` appears and is selectable by the name it is listed under | Manual test on real Apple hardware (Q2), at least one built-in and one external mic |
| Round-trip open-by-name | A name from `list_devices()` opens the same physical device via `chunks()` | Manual test, mirrors `devices.py`'s "the name that is listed is the name that opens" verification for `dshow` |
| No regression to `dshow` or other platforms | Existing `dshow`/Windows tests and the guard fixtures stay green | `pnpm check` / targeted Python and Go suites |
| Threat-model currency | Row 4a accurately describes the sandboxing (or lack of one) on both platforms | `security-reviewer` sign-off before merge of Phase 2 |

## Open Questions

- [ ] **Q1. Device addressing: name-keyed with internal index translation, or a new addressing scheme in the port itself?** Recommendation: keep `CaptureBackend.chunks(device: str, ...)`'s signature unchanged and have `CoreAudioBackend` translate the name it listed back to FFmpeg's index internally (Evidence above). Alternative considered: widen `InputDevice`/`chunks` to carry an opaque backend-specific key instead of assuming a name is always what opens a device. Rejected as the default because it changes the Protocol every existing caller and the conformance suite already assume, for a difference only one backend has; if `avfoundation` device indices turn out to be unstable across boot/plug-unplug (untested — Q2 covers verifying this), Phase 1 should re-open this question with real evidence rather than guessing now.
- [ ] **Q2. Real-hardware verification.** `devices.py`'s `dshow` work was verified against real Windows hardware before being trusted (`devices.py:27-30`). This PRD's author has no Apple hardware; Phase 1's device-listing and Phase 2's streaming work need the same verification the dshow spike got, but on a Mac. Recommendation: mark the verification step **pending the owner or another session with macOS access**, same as REAPER-hardware checks are marked pending elsewhere in this repo's PRDs (see [Native Recording Suite](native-recording-suite.prd.md) and the diagnostics PRD's own owner-pending phases in `docs/prds/README.md`'s index). Do not claim "verified" from CI or a Linux/Windows dev box's `pyav` import check alone — that only proves the code imports and the fake-device conformance suite passes, not that a real Core Audio device streams cleanly.
- [ ] **Q3. Does `avfoundation`'s device index stay stable across a session, or can macOS renumber devices on hot-plug?** Unresearched; affects whether resolving name→index once at `chunks()` open time is safe, or whether it must re-resolve on every open. Recommendation: resolve at open time only (matches `dshow`'s one-shot open), and treat mid-session unplug as the same class of failure `chunks()` already raises for a `dshow` device that disappears (untested for dshow either — no existing behavior to diverge from).
- [ ] **Q4. Priority relative to the rest of the deferred/Could queue.** This is explicitly a Could (`provider-ports.md`'s "Not built here" row said so, and this PRD keeps that framing in its own Phase table). Recommendation: filler-tier, same as this PRD's sibling ([Sidecar Capabilities Flag](sidecar-capabilities-flag.prd.md)) and the older PRDs' remaining phases, per the [agent train queue](../operations/agent-train.md#queue)'s "Filler" row — not scheduled ahead of any wave.
- [ ] **Q5. Should `chunks()`'s FFmpeg-log device-listing trick reuse `devices.py`'s regex/parsing helpers via a shared module, or duplicate them per-backend?** `devices.py`'s parsing (`_DEVICE_LINE`, `_join_context_lines`, `parse_device_list`) is written specifically around `dshow`'s two-line "Name" (kind) / Alternative-name log format (`devices.py:44-90`); `avfoundation`'s log format is `[AVFoundation input device] [N] Name` (single line, index instead of a name-based alternative). Recommendation: a new `devices_avfoundation.py` (or an `avfoundation` branch inside `devices.py` if the shared `av.logging.Capture` plumbing is worth factoring out) rather than forcing one regex to parse two different FFmpeg log shapes — decide during Phase 1's implementation, once the real macOS log output is in hand (Q2 blocks confirming the exact format).

## Users & Context

**Primary User**: a narrator on macOS who opens the Manuscript Teleprompter's live reading mode and expects the microphone to work, the same as it does on Windows.
**Current behavior**: `iter_microphone_chunks`/`list_devices` resolve through `BACKENDS`, find no `darwin` row, and the narrator gets the port's `NotSupportedError` message ("There is no capture backend for darwin.") instead of a device list.
**Trigger**: starting a live teleprompter session, or opening the (currently narrator-invisible) device list, on macOS.
**Success state**: the narrator sees their microphones listed, picks one, and live transcription starts — identical experience to Windows, with no code path aware a different demuxer is underneath.
**Job to Be Done**: When I use the teleprompter on my Mac, I want the same microphone support Windows narrators get, so switching platforms doesn't mean losing a feature.
**Non-Users**: Linux narrators (no capture row exists there either, and this PRD does not add one — out of scope, no evidence of demand); narrators who only ever use REAPER/Audacity for capture and never open the teleprompter's live mode.

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | `coreaudio` row registers with a valid `CaptureDescriptor(platforms=("darwin",))` and passes the capture conformance suite | 1 |
| Must | `list_devices()` lists real Core Audio input devices by a name that later opens them | 1 (code), 2 (real-hardware verification, Q2) |
| Must | `chunks(device, chunk_seconds)` streams mono float32 chunks at `SAMPLE_RATE` from the named device, resolving to FFmpeg's index internally | 2 |
| Must | The Go `captureport` row declares `darwin` and `ProviderCapabilities` reports it with no binding change | 1 |
| Must | Threat-model row 4a re-read and updated for the new platform | 2 |
| Should | A soak/duration check (chapter-length live session, no dropouts) comparable to what a future native-recording-suite spike would need anyway | 2 |
| Won't | Any UI, any device picker, any file-writing capture, any change to `dshow` | - |

**User flow (target, Must-scope only):** narrator on macOS opens the teleprompter's live session, picks their microphone from the same list mechanism Windows narrators use (no new UI — the existing, currently Windows-only, device-list plumbing just returns real rows on macOS instead of an empty/error list), reads, and gets the same live transcription behavior.

## Technical Approach

**Feasibility**: MEDIUM. The port's shape, the conformance suite, the guard, and the resample/chunk loop are all proven and unchanged; the only new code is a second FFmpeg-demuxer adapter and its device-listing parse, both smaller in scope than the `dshow` adapter they mirror (no `alternative_name` disambiguation is known to be needed — Q5). The main unknowns (Q2, Q3) are about real Apple hardware behavior this PRD's author cannot verify directly, not about architecture.

**Capture engine choice: PyAV's `avfoundation` demuxer, not `AVAudioEngine` or the Core Audio HAL directly**

Three shapes were considered, framed by [Native Recording Suite](native-recording-suite.prd.md) Q3's original two candidates ("a CGo binding... or... a Python sidecar") plus the option that PRD didn't have evidence for yet because the capture port didn't exist:

| Option | What it is | Why not chosen |
| --- | --- | --- |
| **`AVAudioEngine`** | Apple's high-level Swift/Objective-C audio framework | Needs a native macOS binding reachable from either the Go host (CGo + Obj-C/Swift interop — the exact risk native-recording-suite's Technical Risks table already flags as disruptive to "the existing pure-Go/Wails build pipeline", `native-recording-suite.prd.md:108`) or a new non-Python sidecar language, when neither the host nor any sidecar in this codebase does this today (`native-recording-suite.prd.md:16`: "No Go/Wails-side audio code exists at all"). Breaks the provider-ports decision that Go never touches a provider directly (`provider-ports.md:83`). |
| **Core Audio HAL** | Apple's lower-level C API for audio device I/O | Same CGo-or-new-language problem as `AVAudioEngine`, with more code (HAL is a manual C API, not a batteries-included framework) for no capability `avfoundation` doesn't already give a capture-only use case. |
| **PyAV's `avfoundation` demuxer (chosen)** | FFmpeg's supported macOS input device, wrapped by the library the codebase already depends on for `dshow` | Zero new dependencies; identical `av.open(format=..., file=...)` call shape already proven by `capture_dshow.py`; keeps every architectural rule provider-ports already decided (capture stays in the Python sidecar, Go only declares rows, the guard stays generic); the one real gap (name vs. index addressing, Q1) is a small, contained translation inside the new adapter, not a new capture layer. |

`avfoundation` itself is implemented by FFmpeg on top of `AVFoundation`'s `AVCaptureDevice`/`AVCaptureSession` APIs, which is Apple's own recommended device-capture path and does reach Core Audio underneath for audio devices — so this choice does reach Core Audio, just through the same demuxer library the project already uses for Windows, instead of a hand-written native binding.

**Architecture notes**

- **New files only**, mirroring `dshow`'s file layout: `sidecars/manuscript-teleprompter/core/capture_avfoundation.py` (the adapter, mirrors `capture_dshow.py`), a device-listing helper (Q5 decides whether it's a new module or a branch of `devices.py`), and `sidecars/manuscript-teleprompter/tests/test_capture_avfoundation.py`.
- **No new Go file** beyond the one `Register` call in `captureport.go` — no new package, no interface change.
- **No `hostAPIVersion` bump**: no binding signature changes (`ProviderCapabilities`'s shape already generalizes over registry rows, `bindings_providers.go:46-54`).
- **Conformance suite extension**, not a new suite: the capture port's `captureporttest`/`capture_conformance` suites already run over every registered row (`provider-ports.md:42-44`, "each registry's own test runs the suite over every row, so a new row cannot skip it"); the new row is picked up automatically once registered, per [Adding an engine](../architecture/provider-ports.md#adding-an-engine) step 4 ("They pick up the new row by themselves").

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| No Apple hardware available to this PRD's author or (potentially) its implementing session | High | Phase 1 ships code + fake-device conformance tests (CI-safe, cross-platform); Phase 2's real-device verification is explicitly marked pending the owner or a macOS-capable session (Q2), matching how this repo already marks REAPER-hardware and audio-hardware checks pending elsewhere |
| `avfoundation` device indices renumber on hot-plug, breaking the name→index resolution if cached across a long session | Medium | Resolve at each `chunks()` open, not once at process start (Q3); soak-test once real hardware is available |
| FFmpeg's `avfoundation` log format differs from what this PRD's evidence (public FFmpeg documentation/source, not a local capture) predicts | Medium | Phase 1's device-listing code is written defensively (unmatched lines ignored, same as `parse_device_list` already does for `dshow`, `devices.py:82-90`) and gets its final parsing rules confirmed against real log output in Phase 1 review, before Phase 2 depends on it |
| Threat-model row 4a's Windows Job Object language doesn't generalize cleanly to macOS sandboxing (which may not exist or may differ) | Medium | Phase 2 explicitly re-reads and rewords the row rather than assuming parity; `security-reviewer` sign-off gates the phase |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | Ports used | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Adapter and registry row | `capture_avfoundation.py` (list + chunks), the Go `coreaudio` row, device-listing parser, conformance suite extension, fake-device tests | pending | - | Q1 answered (this PRD's recommendation stands unless the owner overrides) | Capture port (`CaptureBackend`, `captureport.Backends`) | - |
| 2 | Real-hardware verification and hardening | Verify device listing and streaming on real Apple hardware; soak test; threat-model row 4a re-read and update | pending (owner or macOS-capable session, Q2) | - | 1 | Capture port | - |

**Phase 1.** Goal: a `coreaudio` row that behaves identically to `dshow` under the conformance suite and a fake device, with no caller or binding change needed to reach it. Success: `captureporttest.Run`/`capture_conformance.run` pass for the new row; the provider guard stays green with no new exception; `ProviderCapabilities`'s golden payload gains a `coreaudio` key with no other diff.
**Phase 2.** Goal: prove Phase 1's code against a real Core Audio device, and bring the threat model current. Success: manual verification note (device listed, opened by the name it was listed under, streamed chunk-length audio matches `SAMPLE_RATE`/`CHUNK_SECONDS`, no dropout across a chapter-length session) recorded the way `devices.py`'s module docstring records `dshow`'s; `security-reviewer` sign-off; row 4a's wording updated.

**Parallelism Notes**: strictly sequential — Phase 2 verifies Phase 1's code and cannot start meaningfully before it exists. Both phases touch only files this PRD's own Evidence section lists as new; no other in-flight PRD is known to touch `sidecars/manuscript-teleprompter/core/` capture code or `apps/desktop/internal/captureport/` (check `docs/operations/agent-train.md`'s lane table and issue #509's active-lanes list at launch time, since capture code is lane B, `integrations/reaper`/sidecars/adapters).

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | New `sidecars/manuscript-teleprompter/core/capture_avfoundation.py`, a new device-listing module or a `devices.py` addition (Q5), `sidecars/manuscript-teleprompter/tests/test_capture_avfoundation.py`, `apps/desktop/internal/captureport/captureport.go` (one new `Register` call), `apps/desktop/internal/captureport/captureporttest`/`libs/python/narration_common/ports/capture_conformance.py` fixtures, `libs/python/tests/test_ports_capture.py` | Low: additive rows in files no other known PRD edits. Confirm no concurrent lane-B stream is mid-edit on `captureport.go` at launch time |
| 2 | `docs/architecture/threat-model.md` row 4a, `SECURITY.md` if its wording also names the Windows-only sandbox explicitly | Any other in-flight PRD that also touches the threat model (check at merge time per repo convention, same note [Native Recording Suite](native-recording-suite.prd.md) Phase 5 carries) |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Capture engine for macOS | PyAV's `avfoundation` demuxer, in a Python sidecar adapter | `AVAudioEngine` (native Swift/Obj-C); Core Audio HAL (native C, CGo) | Zero new dependencies, mirrors the `dshow` adapter's exact shape, keeps capture out of the Go host per provider-ports' existing decision, avoids CGo/cross-compilation risk the native-recording-suite PRD already flagged for a different (but architecturally similar) capture problem. Recorded in [ADR 0402](../adr/0402-coreaudio-capture-is-a-pyav-avfoundation-sidecar-backend-addressed-by-device-name.md) (Proposed) |
| Device addressing | Name-keyed at the Protocol boundary; the adapter resolves name → FFmpeg `avfoundation` index internally | Widen `CaptureBackend`/`InputDevice` to carry an opaque backend-specific key | Keeps every existing caller, the Protocol, and the conformance suite unchanged for a difference only one backend has; revisit if Q3's hardware verification shows index instability makes this unsafe. Recorded in [ADR 0402](../adr/0402-coreaudio-capture-is-a-pyav-avfoundation-sidecar-backend-addressed-by-device-name.md) |
| Relationship to Native Recording Suite | Independent; this PRD only extends the teleprompter's existing narrow (non-recording, non-file-writing) capture path to a second platform | Treat this as native-recording-suite's macOS capture-engine spike | Native Recording Suite's Q3 is about a *different* capture use case (record-to-file, chapter-length soak-tested capture for a new recording product), still unscheduled and owner-gated on Q1-Q3 there; conflating the two would misattribute this PRD's narrower scope to a much larger, unstarted initiative |
| Priority | Could, filler-tier | Schedule ahead of wave-3/wave-4 work | The app is Windows-first (ADR 0030); this fills a documented gap but has no evidence of narrator demand pulling it forward, consistent with how `provider-ports.md`'s "Not built here" row framed it before this PRD existed |

## Research Summary

**Technical Context**: verified in code — the capture port's Protocol and descriptor rules (`libs/python/narration_common/ports/capture.py`), the Go `captureport` package and its declared "nothing calls this yet" status (`apps/desktop/internal/captureport/captureport.go`), the `dshow` adapter's full implementation and its module-docstring history of the device-listing spike (`sidecars/manuscript-teleprompter/core/capture_dshow.py`, `devices.py`), the `ProviderCapabilities` binding's generic iteration over registry rows (`apps/desktop/bindings_providers.go`), the provider-ports guard's registry-driven (not hardcoded) name list (`apps/desktop/providerguard_test.go`, `libs/python/tests/test_provider_guard.py`), and PR #696's own record of this row being deferred for being macOS-only on a Windows-first roadmap.
**Not verified**: real Core Audio/`avfoundation` device behavior (listing format, index stability across hot-plug, actual round-trip latency) — no Apple hardware was available while writing this PRD (Q2); FFmpeg's exact `avfoundation` log line format was reasoned from its well-documented CLI behavior (`-f avfoundation -list_devices true`), not confirmed against a local capture, and Phase 1 should confirm it against real log output before Phase 2 depends on it.

---

*Generated: 2026-09-27*
*Status: DRAFT — open questions unanswered; no phase started*
