# Teleprompter Engines and Input Devices

**Supersedes:** in `docs/architecture/manuscript-teleprompter.md`, the "Open items for task planning" list (engine, Moonshine provisioning and packaging, device selection; the tracker-placement decision and the tracker-limits note stay as record), the "Still open here" list under "UI: what shipped and what is still open", and the "Direction, in order" item 4 (record the default in an ADR). **Source:** `manuscript-teleprompter.md` stays as the design record of the shipped sidecar, host relay and page (event contract, tracker behavior, measurements, prior-art survey, license and attribution notes); the older briefs' engine survey is carried into Research Summary below.

This is "PR C" of the teleprompter initiative plus its open follow-ups. Sibling PRD: `teleprompter-manuscript-integration.prd.md` (PRD 1) owns the Manuscript reading-mode modal, flags, seek, DAW resume, punch-and-roll and microphone detection inside REAPER. This PRD owns the live engine choice, device enumeration and its settings, Moonshine provisioning and packaging, and the standalone reading-experience follow-ups (auto-stop, manual scroll). Citations are `file:line` on `main` (d5cc994; no code in the desktop host, the sidecars or the shared Python library changed since b9d348d apart from tests and dependency bumps) for anything checked in code; "per docs" marks a claim taken from a document and not verified.

## Problem Statement

A narrator using the Teleprompter today must type their microphone's exact Windows device name, cannot choose or persist which live engine or model listens, and cannot use Moonshine at all even though both engines were built behind one event contract to be compared in the real UI. Finishing a chapter leaves a live microphone session running until Stop is pressed, and scrolling by hand fights the auto-follow. Until the engines are selectable, provisioned and packaged, the recorded decision to pick a default engine after evaluating both cannot be made, and the feature cannot leave "Deferred".

## Evidence

Verified in code (main, d5cc994):

- **Typed device name.** The Teleprompter page takes the device as free text, remembered only in browser storage (`apps/ui/src/components/teleprompter/TeleprompterPage.tsx:30,49-63,267-282`); the hint tells the narrator to copy the name from Windows Sound settings. Capture is `av.open(file=f"audio={device_name}", format="dshow")` (`sidecars/manuscript-teleprompter/core/live_asr.py:418-444`, especially `:426`). There is no `--list-devices` in the sidecar (`live_asr.py:628-664`). The only device lister in the repo is the Moonshine spike, which uses `sounddevice` (PortAudio), not `dshow` (`sidecars/manuscript-teleprompter/spikes/moonshine_probe.py:173-182,236-242`), so its names are not guaranteed to be openable by the capture path.
- **No engine or model settings.** `fieldSchemas` has no Teleprompter entry (`apps/desktop/app.go:673-679`); `saveSettings` validates only `color` and `choice` kinds (`app.go:715-724`), so a free-text device value has no kind or validation today. The page keeps the model in component state (`TeleprompterPage.tsx:106`) and offers only Tiny and Small (`:26-29`), while the catalog holds tiny, small, medium, large-v3-turbo and large-v3 (`config/whisper-assets.json`) and the CLI help still mentions a `base` model that is not in the catalog (`live_asr.py:636`).
- **The UI cannot request an engine.** `TeleprompterStartOptions` has no `engine` field (`apps/ui/src/api/contracts/teleprompter.ts:38-48`). The Go service reads `options["engine"]` but only `whisper` is launchable (`apps/desktop/internal/teleprompter/service.go:28,134-137`), and the binding resolves the model only against the Whisper catalog (`apps/desktop/bindings.go:402-425`). The service's fallback model is `small` (`service.go:147`) while the host default is `tiny` (`apps/desktop/app.go:661-666`); harmless because the binding always sets it, but inconsistent.
- **Moonshine works only from the CLI.** `--engine moonshine` imports `moonshine_voice` lazily and, without `--model-dir`, downloads models from Moonshine's servers (`live_asr.py:507-532`). With `--model-dir` the code skips the `include_word_timestamps=True` download branch (`:519-526`), so a pre-placed directory must itself contain the word-timestamp files or timestamps silently degrade (words without a timing are spread evenly, `live_asr.py:278-307`; the tracker ignores engine times anyway). `moonshine-voice` is not in `pyproject.toml` (dependencies at `pyproject.toml:5-23`; the frozen sidecar deliberately omits it, `scripts/release/prepare-resources.py:84-94`). The engine unit tests use a fake transcriber (`tests/test_live_asr.py:222-279`).
- **Catalog install mechanism.** `assets.File` is `{Name, URL, SHA256, Size}` with a flat name; install downloads each file into a staging directory and renames it into place (`apps/desktop/internal/assets/store.go:75-138`). `download` opens `filepath.Join(staging, file.Name)` with no `MkdirAll` for the file's parent (`store.go:122`), so a Moonshine model that needs nested paths would fail today (layout TBD - needs research). `whisper.Manager.Model(id)` looks up by id only, and Whisper ids `tiny` and `small` would collide with Moonshine ids of the same name (`apps/desktop/internal/whisper/catalog.go:61-68`).
- **Duplicated install-poll loop.** `TeleprompterPage.tsx:194-214` and `apps/ui/src/components/proofing/Transcript.tsx:170-190` implement the same download/poll/start flow at 400 ms. They differ: the Teleprompter loop stops when the page unmounts and refuses to start a session on a page the narrator left (`TeleprompterPage.tsx:119-125,199,205`); the Transcript Compare loop has no unmount guard, so leaving Proofing during a download still calls `start()` afterwards (`Transcript.tsx:175-186`).
- **No auto-stop.** Reaching the end sets tracker status `done` (`script_tracker.py:207-212`), the UI shows "Done" (`TeleprompterPage.tsx:73`) and the session keeps listening until the narrator presses Stop (`:315-318`; `service.go:267-288`). The Go service parses only the event `type` and stores raw `position` JSON (`service.go:214-227`), so it does not currently know the status.
- **Pull-back while scrolling.** `ReaderText` scrolls the current word to the middle whenever it leaves the 25%-70% viewport band, on every cursor change while `follow` is true (`ReaderText.tsx:48-61`); ADR 0024 records this as a known consequence. Nothing distinguishes a user scroll from a programmatic one.
- **Chapter choice ignores REAPER.** The page preselects the reader's active chapter (`TeleprompterPage.tsx:146-160`); Transcript Compare instead resolves a chapter from a track name (`sidecars/transcript-compare/core/compare.py:900-940,1470`). The tracks package exposes `Track.Name` from the saved `.rpp` (`apps/desktop/internal/tracks/tracks.go:28-36`).
- **Roadmap status is inconsistent and the JSON is unread.** `docs/roadmap.md` lists the teleprompter under Deferred, `docs/README.md` marks it "Implemented (first cut)", `docs/architecture/manuscript-teleprompter.md` line 3 says "Planned". `config/roadmap.json` lists it in `deferred` and its `available` list omits Tracks and the Teleprompter. `docs/roadmap.md` says the in-app roadmap reads the JSON, but no code in `apps/desktop/` or `apps/ui/src` references it (grep for "roadmap" finds only a comment in `apps/desktop/internal/measure/profile.go`). The only reader is `scripts/github/sync-milestones.mjs`, which uses just the `milestones` array to generate GitHub milestones (`docs/operations/github-workflow.md`); `available` and `deferred` are read by nothing, and no milestone names the teleprompter.
- **Packaging seams.** `freeze()` accepts `collect_data` only (`prepare-resources.py:23-46`); `verify-installable.mjs` checks that the three sidecars exist (`:13-16`). Host API version is in `apps/desktop/app.go:33`, `apps/ui/src/hostApi.ts:2`, `apps/desktop/app_test.go:40`.
- **Settings layout defect.** Settings selects collapse to blank slivers at 390 px (the retired UI-defects register's defect 8, fixed by the settings mobile layout stack, see [Settings rows](../design/design-system.md#settings-rows)); new Settings fields inherit the fixed row and the suite's 64 px collapsed-control check.

Per docs (not verified in code):

- Moonshine Small: about 0.26x real time, about 215 MB with the 78 MB attention decoder timestamps need; Tiny about 0.17x and 74 MB; about 10 files each; final line identical to the last partial in 27 of 27 lines; roughly 1 in 7 shown words later revised; `moonshine-voice` 0.1.5 is MIT with a 16.5 MB Windows x64 wheel and no macOS Intel wheel; per-model license text must be confirmed at the pinned artifact because GitHub's license detector reports the repository as unrecognized (`docs/research/local-dependency-evaluation.md` entry 10; `manuscript-teleprompter.md`; ADR 0021).
- Whisper tiny with rolling decode (LocalAgreement-2, re-decode every 0.5 s): confirmed-word lag median about 1.2 s (typically 0.5-1.5 s, peaks about 2.1 s); decode about 0.15-0.2 s per pass, so decoding keeps up. Waiting for two decodes to agree puts a floor of about 1 s on confirmed-word lag regardless of model size; that is why the tracker also follows partials speculatively (expected Whisper lag about 0.5-0.8 s). `base` and `small` are untested live. True cursor lag on a live mic with `--timing` for both engines, and `--decode-interval 0.25`, are not measured (project memory).
- Replay of three real mic readings of a 55-word script (Moonshine Small with context, Small without, Tiny) through the real adapter, event layer and tracker: the cursor reached the end every time with no false restarts or skips and 0 or 1 backward moves; the speculative cursor reached each word a median of about 0.5 s (p90 0.5-1.1 s) before confirmed words alone would have; the one backward move was a genuine one-word correction; "waiting" status appeared 0-2 times per reading, detected at the next record after the pause (`manuscript-teleprompter.md`).
- Moonshine spike (Small and Tiny, real mic plus one synthetic clip, Windows CPU, 16-25 s per run, small samples): word error rate 2-6% against the read script; word timestamps on nearly every partial but noisy (6 of 23 partials on the synthetic clip had out-of-order or inverted times; its own text is authoritative and timings are aligned onto it); partials every 0.5 s by default. Estimated word lag 0.3-0.8 s, but the probe's own lag metric matched words by position and is unreliable, so it must not be used to compare engines (Phase 8 uses `--timing` instead). Moonshine's expected edge: flat cost as a segment grows, cheaper short update intervals, and `set_context()` biasing toward the script text; all figures are the vendor's or small-sample lab numbers.

Assumption - needs validation through a timed A/B in the real UI: that the two engines differ enough in felt smoothness on the narrator's machine to justify a choice. Method: Phase 8 protocol.

## Proposed Solution

Make the live engine and input device selectable and persistent, and finish provisioning Moonshine. Add a sidecar `--list-devices` (same `dshow` backend as capture) with a host binding and a dropdown-only microphone picker (no typed name, no "Other..." fallback); add a global Teleprompter settings section (engine, model, device); provision Moonshine through the hashed asset catalog with a pinned URL and SHA-256 per file and load it from a pre-placed directory; package the `moonshine-voice` wheel into the frozen sidecar for Windows; let the host and UI launch either engine; evaluate both against real scrolling and record the default in an ADR. Alongside, fix the reading experience: stop automatically at the end of the chapter, let the narrator scroll by hand without being pulled back, preselect the chapter from a REAPER track name, and share one install-poll implementation. Finally, update the roadmap files together once the feature leaves "Deferred".

## Key Hypothesis

We believe selectable, provisioned engines plus a real device picker will let the user evaluate Whisper and Moonshine side by side in the actual reading UI, and remove the typed-device-name failure mode, for narrators who read chapters aloud with the Teleprompter. We'll know we're right when (a) a session starts with the microphone chosen from a list and zero typing, every listed device opens, (b) both engines complete the same chapter read in the real app with a measured median cursor lag at or below 0.8 s (proposal; unmeasured today) and the user records a default engine in an ADR, and (c) a packaged release starts a Moonshine session from a verified catalog install on a clean Windows machine.

## What We're NOT Building

- The Manuscript reading-mode modal, flags, seek, DAW resume and punch-and-roll - owned by PRD 1.
- Detecting which microphone REAPER uses - owned by PRD 1 (this PRD supplies the device list it matches against).
- Switching microphone capture to `sounddevice` or making capture portable - decided: keep Windows-only `dshow` for now.
- macOS or Linux Moonshine builds - Windows-first; no macOS Intel wheel exists (per docs), engine choice must simply be unavailable where the wheel is.
- Other Moonshine models (medium) or languages beyond US English - unmeasured; `MOONSHINE_ARCHS` contains `medium` (`live_asr.py:101`) but it stays unexposed.
- Larger Whisper models in the live picker - live latency is measured only for tiny (median about 1.2 s); `base` is not in the catalog.
- Grammar-constrained decoding (Vosk-style closed vocabulary) as the live matching signal - rejected, it force-fits speech to the nearest allowed word and would mask genuine misreads; `hotwords` biasing (nudge, never restrict) is the accepted level and already carries over to the live case.
- Sherpa-ONNX and SimulStreaming as live engines - Sherpa-ONNX stays a fallback candidate only; SimulStreaming needs PyTorch and a GPU (see Research Summary).
- Automatic model updates or silent downloads - first-use provisioning rules: selecting never downloads, download needs an explicit confirm.
- A trailing Whisper confirmation pass, or misread findings - deferred (`manuscript-teleprompter.md`) and PRD 1 respectively.
- Bundling model weights into the installer - forbidden by the provisioning policy.
- Story Bible vocabulary as live hotwords or key terms - the sidecar accepts `--hotwords` (`live_asr.py:644`) but wiring it is a separate feature.
- A loopback server, port or REST endpoint - recorded rule.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Sessions started with zero typing | The mic is detected from the DAW or chosen from a list; there is no free-text microphone field anywhere | Manual acceptance run on the user's machine |
| Listed devices that actually open | 100% of listed devices open and close cleanly with the capture path (or are marked unavailable) | A test that opens each listed device once, run on the user's machine |
| Engine and model persistence | Choice survives an app restart | Settings unit test plus manual check |
| Cursor lag per engine | Median at or below 0.8 s, p90 at or below 1.5 s for the chosen default (proposal; docs expect 0.3-0.8 s, unmeasured) | Sidecar `--timing` log on a live mic, same chapter, same reader, both engines (Phase 8 adds a way to capture it when launched from the host) |
| False jumps and backward moves | No worse than the Whisper baseline (0 false jumps, 0-1 backward moves over 55 words, per docs) | `replay.py` on recorded readings plus live reads |
| Moonshine provisioning integrity | Every catalog file is verified by SHA-256; a corrupt or partial file yields `verification_failed` and is never launched | Go catalog and install tests (pattern of `whisper/catalog_test.go`) |
| Packaged release | Frozen sidecar starts `--engine moonshine --model-dir` on a clean Windows machine; `verify-installable` passes; installer size delta reported (limit TBD after measuring) | Release build plus install smoke test |
| Default engine decision | One accepted ADR with the evidence | ADR exists; `docs/adr/README.md` index updated |
| Auto-stop | Session ends within the configured delay after Done in 10 of 10 test reads, with 0 premature stops when the last sentence is re-read | Go service test with a fake sidecar plus manual reads |
| Manual scroll | 0 pull-backs after a user scroll until the narrator resumes following | Component test with simulated wheel/touch/key plus manual check |
| Install-poll duplication | The Whisper install loop exists in one place | Code search; both callers use it |
| Roadmap consistency | `docs/roadmap.md` and `config/roadmap.json` describe the same state in the same commit | Diff review |

## Open Questions

- [ ] **Microphone picker overlap with PRD 1.** PR #35 assigns "microphone list (enumeration and saved choice)" to its Phase 1; this PRD assigns enumeration UX and settings here. Options: (a) this PRD's picker lands first and the modal consumes it; (b) one shared `MicrophoneField` component: PRD 1 Phase 2 extracts the current typed field into it, this PRD's Phase 2 swaps its internals for the picker, PRD 1's REAPER detection later feeds it a `suggestedDevice`; (c) PRD 1 builds the picker. Recommendation: (b). No ordering constraint between the PRDs. If this PRD's Phase 2 lands first it replaces the typed field on the page directly and PRD 1 extracts the seam from the picker.
- [x] **Where device enumeration runs.** Options: (a) sidecar `--list-devices` on the same PyAV/`dshow` backend as capture (whether PyAV can list `dshow` devices without an ffmpeg call is spike 3 in PR #35; TBD - needs research); (b) Go through Windows audio APIs (names may not equal `dshow` names); (c) `sounddevice` as the spike does (different backend, host-API duplicates, names not guaranteed openable by `dshow`). Recommendation: (a), because the name that is listed must be the name that opens; fall back to the typed "Other..." field if the spike fails. **Resolved (Phase 1, 2026-09-22):** (a) confirmed - PyAV lists `dshow` devices via `av.logging.Capture` with no ffmpeg subprocess; every listed audio device opened through the exact capture call. See [Device enumeration](../architecture/manuscript-teleprompter.md#device-enumeration-teleprompter-engines-and-input-devices-prd-phase-1). No fallback needed; the standing "microphone is never typed" decision (Decisions Log) stays unaffected either way.
- [x] **Where the device, engine and model choices are stored.** Options: (a) global settings file (`%APPDATA%/narration-utils/global-settings.json`) under a new `Teleprompter` section, global scope only; (b) browser storage as the device is today; (c) project settings. Recommendation: (a). These are machine facts (hardware and CPU), Go can validate them, and they survive webview data resets. Migrate the existing browser-storage device once. Purely visual preferences stay in browser storage (the rule PRD 1 uses). This needs a free-text or device kind with validation added to `saveSettings`. **Resolved (Phase 2, 2026-09-22):** (a), for the device only - the `Teleprompter` schema's `input_device` field reuses the existing "text" kind (any string, including empty), global scope only (`saveSettings` rejects a project-scoped write). The pre-Phase-2 browser-storage value is migrated once, on first load, only when the settings value has never been set. Engine and model choices stay out of scope for this phase (phase 3's own "Teleprompter settings section").
- [ ] **Model choices exposed per engine.** Options: (a) Whisper tiny and small (the page offers both today; only tiny has live-lag data) and Moonshine tiny and small (both measured in the spike); (b) every catalog Whisper model plus Moonshine medium. Recommendation: (a). Larger models have no live-latency data, and the Phase 8 protocol adds Whisper small's lag.
- [ ] **How Moonshine is packaged.** Options: (a) add a pinned `moonshine-voice==0.1.5` to `pyproject.toml` and `uv.lock` and freeze it into the existing `manuscript-teleprompter` sidecar; (b) a second frozen executable for the Moonshine engine; (c) stay an ephemeral `uv` environment (developer only, not shippable). Recommendation: (a), measure the size delta and native-library collection in Phase 6, and fall back to (b) if the increase or the PyInstaller behavior is unacceptable (size limit TBD with the user). (c) is what blocks release today.
- [ ] **Shape of the model-management bindings.** Options: (a) copy the five `Whisper*` bindings as `Moonshine*`; (b) add engine-aware `LiveModel*` bindings (catalog, install, install state, cancel, remove keyed by engine plus id) backed by both catalogs, leaving `Whisper*` for Transcript Compare; (c) parameterize `Whisper*`, a breaking change. Recommendation: (b). Ids collide across engines (`tiny`, `small`), the existing `WhisperCatalog` returns Transcript Compare's selected model (`apps/ui/src/api/contracts/whisper.ts`), and one UI hook then serves both engines. Each new binding bumps the host API version.
- [ ] **Auto-stop trigger and delay.** Options: (a) UI calls Stop when status is `done`; (b) the Go service starts a timer on a `done` position and calls `Stop()` when it expires unless a later position clears it; (c) the sidecar exits itself. Recommendation: (b), delay TBD (start above the tracker's 1.5 s `WAIT_SECONDS`, `script_tracker.py:39`, so a re-read of the last sentence cancels it), no setting in the first cut, and a clear "Stopped at the end of the chapter" state. It does not depend on a view being open and is testable with the existing fake-sidecar pattern. PRD 1 keeps flags in its UI session, so they survive the stop.
- [ ] **Manual-scroll behavior.** Options: (a) pause following on any user scroll, resume only via an explicit "Follow" control; (b) pause on user scroll and resume automatically when the current word is back inside the follow band; (c) timed auto-resume. Recommendation: (b) plus the visible control. A timer reintroduces the pull-back being fixed. Detect user intent from wheel, touch, pointer drag on the scrollbar and navigation keys, not from scroll events alone (programmatic smooth scrolling also fires them).
- [ ] **What "chapter from REAPER track name" means.** Options: (a) suggest a chapter from the saved `.rpp` track names using the matcher (works standalone); (b) follow the selected or record-armed track in a running REAPER through the bridge; (c) both. Recommendation: (a) first, built on PRD 1 Phase 8's matcher (built once, shared with `diagnostics-delivery-and-cleanup-tools.prd.md` Phase 8 and the Review page's chapter grouping); (b) rides PRD 1 Phase 11. If this phase is scheduled before PRD 1 Phase 8, it builds the matcher and PRD 1 reuses it.
- [ ] **How the default engine is chosen.** Options: (a) numeric gate only; (b) the user's judgment after side-by-side reading only; (c) both. Recommendation: (c). Proposed gate for switching the default to Moonshine: median cursor lag at least 25% lower than Whisper tiny with no more false jumps or backward moves, on at least 3 readings across at least 2 microphones, and an acceptable download size (thresholds are proposals, not measured). The user makes the final call and the ADR records the numbers.
- [ ] **Sharing the install-poll loop.** Options: (a) a `useAssetInstall` hook used by Transcript Compare, the Teleprompter and later Settings; (b) host-side events instead of polling; (c) a shared component. Recommendation: (a). Note the behavior change: Transcript Compare would gain the Teleprompter's unmount guard, so leaving Proofing mid-download no longer auto-starts a compare run; confirm that is wanted.
- [ ] **What "leaves deferred" means for the roadmap.** Options: (a) move the whole sentence to `available` after this PRD; (b) split it: `available` gets "follows a chapter read aloud with the current word highlighted, with a selectable local engine and microphone" after Phase 8, while the reviewable misread/skip flags stay deferred until PRD 1 Phase 7; (c) wait for PRD 1 to finish. Recommendation: (b). The roadmap sentence includes "reviewable suspected substitutions, skips, or misreads", which only PRD 1 delivers. Also decide whether `docs/roadmap.md` should stop claiming an in-app roadmap reads the JSON (nothing in the app does; only the `milestones` array is read, by the GitHub milestone sync). Moving the sentence between `deferred` and `available` does not touch milestones, so no sync is needed.

## Users & Context

**Primary User**
- **Who**: a solo author-narrator on Windows reading manuscript chapters aloud, recording in REAPER, with one or more audio inputs (USB microphone, audio interface, webcam or laptop mics).
- **Current behavior**: opens the Teleprompter, types the microphone name copied from Windows Sound settings, accepts the fixed Tiny or Small model, presses Start, presses Stop after Done, and scrolls back manually when the view jumps.
- **Trigger**: starting a reading session, or wanting to compare how each engine follows their voice.
- **Success state**: picks a microphone from a list, has the engine and model remembered, reads the chapter, and the session ends by itself at the end; scrolling up to reread does not fight the view.

**Job to Be Done**
When I sit down to read a chapter, I want to choose my microphone from a list and use whichever local engine follows my voice best, so the highlight keeps up without me configuring anything by hand.

**Non-Users**
- macOS and Linux narrators (Windows-first capture).
- Users who want cloud speech (excluded by local-first).
- Editors reviewing recorded takes (Transcript Compare).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | List input devices with the names the capture path accepts; dropdown-only picker (no typed name, no "Other..." entry), a failed or empty listing blocks the phase; remembered choice | 1, 2 |
| Must | Persisted Teleprompter settings (engine, model, device), global scope | 3, 7 |
| Must | Moonshine catalog with pinned URL and SHA-256 per file; first-use download gate; load from a pre-placed directory | 5, 6 |
| Must | Moonshine packaged for Windows in the frozen sidecar and covered by the release smoke check | 6 |
| Must | Engine choice end to end (settings, start options, host, download prompt naming the engine) | 7 |
| Must | ADR recording the default engine after evaluation in the real UI | 8 |
| Must | `roadmap.md` and `roadmap.json` updated together when the feature leaves "Deferred" | 12 |
| Should | Auto-stop at Done | 9 |
| Should | Manual scroll without pull-back | 10 |
| Should | Chapter suggested from a REAPER track name | 11 |
| Should | One shared install-poll implementation | 4 |
| Could | Capture `--timing` lag from host-launched sessions for evaluation (developer aid) | 8 |
| Could | Story Bible vocabulary as hotwords or key terms | later |
| Won't | `sounddevice` capture, non-Windows Moonshine, larger live models, model auto-update, bundled weights | - |

### MVP Scope

Phases 1 to 3 (device picker and settings, Whisper only) are shippable on their own and remove the typed-name failure. Phases 5 to 8 deliver the engine choice and decision. Phases 9 to 11 are independent polish and can ship at any time. Phase 12 closes the initiative.

### User Flow

1. Settings > Teleprompter: choose engine and model. Choosing never downloads.
2. On the Teleprompter page the microphone control lists devices (with a refresh), and preselects the remembered one; it never accepts a typed name. A remembered device that is no longer present is shown as not found and must be re-picked; it is never silently replaced.
3. Start: if the chosen engine's model is missing, the same first-use dialog as today names the engine, size, publisher and license; the narrator confirms or cancels; progress is real (ADR 0015).
4. The narrator reads; a manual scroll pauses following with a visible "Follow" control; at the end of the chapter the session stops itself and says so.

## Technical Approach

**Feasibility**: MEDIUM. HIGH for settings, auto-stop, manual scroll and the shared hook (all extend existing seams). MEDIUM for device enumeration (PyAV `dshow` listing is an unverified spike). MEDIUM-LOW for Moonshine packaging (PyInstaller with native wheels, model layout and per-model license text unverified).

**Architecture Notes**

- **Enumeration.** New `devices.py` in the sidecar with a `--list-devices` mode printing one JSON object and exiting. Spike first: PyAV with `format="dshow"` and the `list_devices` option normally prints to the ffmpeg log and raises; whether PyAV exposes that log text, and how duplicate device names are disambiguated (ffmpeg uses alternative device names for that), are TBD - needs research. Go exposes a binding that runs the sidecar in this mode with a timeout and caches nothing; failures return an empty list and a message rather than a rejected call, so the UI always gets a result - the picker then blocks Start on that empty list, per the "Microphone is never typed" decision (Decisions Log).
- **Settings.** Add a `Teleprompter` tool to `fieldSchemas` (`apps/desktop/app.go:673-679`) with `engine` (choice), `model` (choice per engine), `input_device` (new validated text kind), defaults in `config/defaults.json`, a global-only category in `Settings.tsx` (categories at `Settings.tsx:12-22`), and matching `mockFixtures.ts` entries (`mockFixtures.ts:501` pattern). The fixed Settings row and the suite's collapsed-control check are delivered, so the new selects inherit them.
- **Moonshine catalog.** New `config/moonshine-assets.json` beside `whisper-assets.json`, entries per model with publisher, license, model card, provenance, and one `{name, url, sha256, size}` per file. A thin manager reusing `apps/desktop/internal/assets` (install layout `assets.Dir(root, provider, id, version)`). If files need subdirectories, extend `assets.download` to create parent directories (`store.go:122`), with a test and a check that names cannot escape the staging directory. Whether a per-file catalog can express Moonshine's required layout is TBD - needs research (about 10 files each per docs). Pin immutable URLs (a commit or release hash, not `latest`) and record SHA-256 by downloading and hashing once. Complete `local-dependency-evaluation.md` entry 10: license text confirmed at the pinned artifact, removal and update policy, packaging note. If the per-model license cannot be confirmed as permissive, Moonshine stays developer-only (policy: unclear terms are not approved).
- **Engine launch.** `supportedEngines` adds `moonshine` (`service.go:28`); `TeleprompterStart` resolves the model by engine and returns `asset_required` for whichever catalog is missing (`bindings.go:402-425`); `TeleprompterStartOptions` gains `engine` and `asset_required.model` becomes an engine-tagged type (`contracts/teleprompter.ts:38-52`); the download dialog copy stops saying "Whisper" (`TeleprompterPage.tsx:77-99`). Sidecar: pass `--engine`, `--model`, `--model-dir`; Moonshine with the chapter text as context already works (`live_asr.py:678`). Settings default resolution mirrors `resolveTeleprompterModelID` (`app.go:661-666`).
- **Packaging.** `pyproject.toml` and `uv.lock` gain the pinned wheel (Windows x64 only matters; per docs its runtime dependencies are `numpy`, `sounddevice`, `requests`, `tqdm`, `filelock`, `platformdirs`, `google-crc32c`). `freeze()` needs `--collect-all`/binary collection beyond `collect_data` (`prepare-resources.py:23-46,89-94`); `verify-installable.mjs` (`:13-16`) needs a Moonshine-capable check; measure installer growth. Whether `moonshine_voice` needs `sounddevice`'s PortAudio at import time even though capture uses PyAV is TBD - needs research. Update the comment that says Moonshine is deliberately not bundled (`prepare-resources.py:87-88`).
- **Auto-stop.** The Go service decodes `status` from `position` events (it already unmarshals each line, `service.go:214-227`), keeps a timer, and calls `Stop()`; cooperative stop and grace kill are unchanged (ADR 0022). New service phase message. UI adds no logic beyond the message.
- **Manual scroll.** Move follow logic out of `ReaderText` into a `useFollowCursor` hook that owns "following" state, listens for user-intent events on the scroll container, exposes `resume()`, and keeps the existing band check and reduced-motion behavior (`ReaderText.tsx:48-61`). One hook so PRD 1's modal reuses it.
- **Evaluation aid.** `--timing` and `--log` exist (`live_asr.py:659-663`) but the host passes neither and keeps only a stderr tail (`process.StreamChild.StderrTail`); Phase 8 adds an opt-in developer setting or environment variable to launch with `--timing --log <session dir>/teleprompter.log`, so the real-UI evaluation yields lag numbers.
- **Attribution.** `live_asr.py`'s header credits WhisperLive (MIT, `Copyright (c) 2023 Vineet Suryan, Collabora Ltd.`, ported streaming logic) and whisper_streaming (MIT, `Copyright (c) 2023 ÚFAL`, the LocalAgreement policy), and `docs/research/local-dependency-evaluation.md` entry 9 records it as the first ported-logic (not downloaded) dependency. Any code moved out of `live_asr.py` into `devices.py` or other new modules keeps the credit with it; recheck upstream terms at the exact commit ported from (engineering guidance, not legal advice). Moonshine (MIT per docs) is a downloaded dependency and follows entry 10.
- **Constraints to honor**: first-use provisioning rules (selecting never downloads, verify before use, no silent fallback to a different model), ADR 0015 (real progress only), 0021 (adapters only; UI unchanged), 0022, host-binding concurrency (snapshot service pointers under `RLock`).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| PyAV cannot list `dshow` devices without brittle log scraping | Medium | Spike first; find another listing route (ffmpeg `-list_devices` output, Windows audio endpoint enumeration); typing a name is never the fallback, so if no route yields provably openable names the phase is blocked and the owner decides |
| Listed device is held exclusively by REAPER (ASIO) so opening fails | Medium | Detect a failed open and explain it; never steal the device; show the device as busy in the dropdown and never offer typing |
| Moonshine model layout does not fit a flat `assets.File` list | Medium | Extend `download` for nested paths with path-escape tests, or record the constraint and adjust the catalog schema |
| PyInstaller misses Moonshine native libraries or grows the installer too much | Medium | Phase 6 spike with `--sidecar manuscript-teleprompter`; fall back to a second frozen executable |
| Per-model Moonshine license text cannot be confirmed permissive | Low | Keep Moonshine developer-only; policy forbids unclear terms |
| Pre-placed model directory lacks the word-timestamp files | Medium | Catalog entry must list the attention decoder; test asserts the required file set |
| Engines look equal in evaluation, or the decision stalls | Medium | Proposed numeric gate plus the user's call; default stays Whisper tiny until decided |
| Auto-stop ends a session prematurely (narrator re-reads the last line or pauses) | Medium | Delay above `WAIT_SECONDS`, later position cancels the timer, no toggle until needed |
| User-scroll detection misclassifies programmatic scrolls | Medium | Intent events (wheel, touch, keys, pointer on the scrollbar), not scroll events; component tests for each |
| Settings selects collapse on mobile (defect 8, fixed by the settings mobile layout stack) | Low | The row is fixed and gated; look at the new field's `reflow.png` |
| Concurrent host API bumps and ADR numbering | Low | Later merge bumps again; re-check `docs/adr/` before each ADR |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Device enumeration in the sidecar | Spike, then `--list-devices` in a new `devices.py`, tests, findings recorded in `manuscript-teleprompter.md` | complete | 4, 5, 9, 10 | - | - |
| 2 | Host device binding and microphone picker | Binding, contract, mock, dropdown-only picker (no typed fallback) with refresh, a "not found" state for a remembered device, and a blocking message on a failed/empty listing; remembered choice, persisted globally | complete | 5, 9, 10 | 1; PRD 1 phase 2 (soft, see Open Questions) | - |
| 3 | Teleprompter settings section | `Teleprompter` schema (engine list limited to Whisper until phase 7), model and device, defaults, Settings category, mock, mobile layout | pending | 5, 9, 10 | 2 | - |
| 4 | Shared asset-install hook | `useAssetInstall` extracted from Transcript Compare and the Teleprompter; unmount behavior unified | pending | 1, 5, 9, 10 | - | - |
| 5 | Moonshine catalog and provisioning | `moonshine-assets.json`, manager, install/state/cancel/remove, engine-aware bindings, dependency record completed | pending | 1, 2, 3, 4, 9, 10 | release-readiness Phase 3 (soft: aggregated catalog) | - |
| 6 | Moonshine in the sidecar and packaging | Load from a verified pre-placed dir, pinned dependency, PyInstaller collection, release smoke check | pending | 9, 10 | 5 | - |
| 7 | Engine choice end to end | Host and UI launch either engine, engine-aware download dialog, settings enable Moonshine, visual states | pending | 9, 10 | 3, 4, 5, 6 | - |
| 8 | Engine evaluation and default ADR | Real-UI A/B protocol, lag capture aid, ADR, default set in settings | pending | 9, 10, 11 | 7 | - |
| 9 | Auto-stop at Done | Go timer on `done`, message, tests | pending | 1, 5, 6, 10 | - | - |
| 10 | Manual scroll without pull-back | `useFollowCursor`, intent detection, Follow control, tests | pending | all except PRD 1 phases 4, 5, 7 | - | - |
| 11 | Chapter from REAPER track name | Chapter suggestions from `.rpp` track names using the shared matcher | pending | 8, 9, 10 | PRD 1 phase 8 (or builds the matcher first) | - |
| 12 | Roadmap and status bookkeeping | `roadmap.md` and `roadmap.json` together, README inventory, brief status line | pending | - | 2, 8 (and PRD 1 phase 7 per the roadmap question) | - |

### Phase Details

**Phase 1 - Device enumeration in the sidecar**
- **Goal**: prove and provide a list of names the capture path accepts.
- **Scope**: `sidecars/manuscript-teleprompter/core/devices.py`, argument wiring in `live_asr.py`, tests with a fake lister, the spike outcome and duplicate-name handling written into `manuscript-teleprompter.md`. No UI.
- **Success signal**: on the user's machine every listed name opens with the capture code and closes cleanly; if listing is not possible without an ffmpeg call the phase records that and looks for another listing route; typing a name is not an accepted fallback (see Decisions Log).
- **Done (2026-09-22):** success signal met on the development machine (see the architecture doc link above). This phase's PR also pulled forward, ahead of Phase 2, the two pieces needed to prove the enumeration backend end to end without building the picker UI: the Go `TeleprompterDevices` binding (`hostAPIVersion` 14) and the `MicrophoneField` seam extraction (Open Questions, "Microphone picker overlap", option (b)) - the field's behavior is unchanged, and nothing in the UI calls the new binding yet. Phase 2 still owns the contract/`wailsClient`/`mockApi` wiring, the dropdown-only picker itself, and the "not found" state.

**Phase 2 - Host device binding and microphone picker**
- **Goal**: choose a microphone from a list.
- **Scope**: Go binding running the sidecar `--list-devices` with a timeout (host API bump in three places, regenerate `Host.{js,d.ts}`), contract and `wailsClient.ts` and `mockApi.ts`, picker component with refresh and a "not found" state, remembered choice, `state-catalog.ts` rows and drivers, doc screenshot, atlas story if a primitive is added.
- **Success signal**: page tests pass; PNGs reviewed at four viewports; a session starts with the chosen device.
- **Done (2026-09-22):** the Phase 1 `TeleprompterDevices` binding is wired into the TS contract (`apps/ui/src/api/contracts/teleprompter.ts`), a Zod schema (`schemas/teleprompter.ts`), `wailsClient.ts` and `mockApi.ts`. `MicrophoneField` is a dropdown-only `Select` (ADR 0053) of enumerated devices - no typed name, no "Other…" entry - with a "not found" state for a remembered device the current list does not have, and a blocking message ("No microphone found" / "Couldn't list microphones") when the listing is empty or failed, so Start stays disabled until a device can be chosen from the list. This matches the "Microphone is never typed" Decisions Log row below; an earlier task brief mistakenly specified a typed fallback and it was corrected before merge (see the Decisions Log row for that correction). The device is stored in the global settings file under a new `Teleprompter` section (`input_device`, the existing "text" kind, global scope only), and the pre-Phase-2 browser-storage value is migrated once, on first load. Three viewports (desktop, small-desktop, tablet) reviewed via the Playwright visual suite for `teleprompter/setup-default` and `teleprompter/model-download-progress` (no phone viewport, ADR 0037); `docs/guides/using-the-app/teleprompter.md` updated to describe the picker instead of typing a name. The atlas run was not needed: `MicrophoneField` is a page component built from the existing `Select` primitive, not a new primitive.

**Phase 3 - Teleprompter settings section**
- **Goal**: engine, model and device persist as machine settings.
- **Scope**: `fieldSchemas`, validation for the new text kind, `defaults.json`, `Settings.tsx` category (global only), `mockFixtures.ts`, page reads defaults, one-time migration of the browser-storage device, the fixed Settings row (delivered) (land after it) or a recorded inheritance of that defect.
- **Success signal**: values persist across restart; invalid device text rejected by the host; Settings mobile PNG readable.

**Phase 4 - Shared asset-install hook**
- **Goal**: one implementation of download, poll, cancel and start-after-success.
- **Scope**: `useAssetInstall` in `apps/ui/src/api` or a hooks folder, both callers migrated (`Transcript.tsx`, `TeleprompterPage.tsx`), tests for cancel, error, unmount and success, note the Transcript Compare behavior change.
- **Success signal**: existing tests for both pages pass; loop exists once.

**Phase 5 - Moonshine catalog and provisioning**
- **Goal**: install and verify Moonshine models through the hashed catalog.
- **Depends (asset registration)**: new assets register through `release-readiness-provisioning-and-docs-site.prd.md` Phase 3's aggregated catalog (provider registry and `AssetsList`), so Moonshine appears on the "Manage local assets" page and shares the progress contract of its Phase 1 instead of adding a third bespoke `*Catalog`/`*Install` binding family. If Phase 3 has not landed, use the existing manager unchanged and migrate the provider later; do not build a parallel registry.
- **Scope**: catalog file, manager, engine-aware bindings, `assets` subdirectory support if needed, host API bump, `local-dependency-evaluation.md` entry 10 completed (license confirmed at the pinned artifact, removal and update policy), `first-use-dependency-provisioning.md` reference, tests mirroring `whisper/catalog_test.go`.
- **Success signal**: install, verification failure, cancel and remove tests pass; a hash mismatch is never launchable; no download at app start.

**Phase 6 - Moonshine in the sidecar and packaging**
- **Goal**: a frozen sidecar can run Moonshine from a catalog directory.
- **Scope**: `load_moonshine_transcriber` uses a verified directory only for the host path (library downloader remains CLI-only), assertion that the directory has the word-timestamp files, pinned dependency in `pyproject.toml` and `uv.lock`, `prepare-resources.py` collection, `verify-installable.mjs`, size measurement, comment updates.
- **Success signal**: `prepare-resources.py --sidecar manuscript-teleprompter` builds; the frozen exe starts a Moonshine replay from a catalog directory; size delta reported.

**Phase 7 - Engine choice end to end**
- **Goal**: the narrator can pick and run either engine.
- **Scope**: `supportedEngines`, engine-aware gate and `asset_required`, contract `engine`, UI controls, dialog copy, settings enable `moonshine`, mock, visual states, doc screenshots, guide text (`docs/guides/using-the-app/teleprompter.md`).
- **Success signal**: both engines start from the real app; missing Moonshine model prompts and installs; PNGs reviewed at all viewports.

**Phase 8 - Engine evaluation and default ADR**
- **Goal**: decide the default with evidence.
- **Scope**: written protocol (same chapter, mic and reader, both engines, tiny and small, three runs), opt-in `--timing --log` launch aid, results table in the ADR, default written to `defaults.json`, `manuscript-teleprompter.md` updated. The ADR states ADR 0021 still holds and that `faster-whisper` stays the offline Transcript Compare engine whichever live default wins. Include Whisper small in the runs (only tiny has live-lag data today) and do not use the spike's position-matched lag metric.
- **Success signal**: ADR accepted by the user; default changed only if the gate says so.

**Phase 9 - Auto-stop at Done**
- **Goal**: the session ends itself at the end of the chapter.
- **Scope**: `apps/desktop/internal/teleprompter/service.go` timer and state, service tests with a fake sidecar (existing pattern), UI message.
- **Success signal**: stops after the delay; a later position cancels it; a crash still reports an error.

**Phase 10 - Manual scroll without pull-back**
- **Goal**: reading and scrolling coexist.
- **Scope**: `useFollowCursor`, `ReaderText.tsx`, Follow control, tests, visual state, ADR 0024 consequence updated by a new ADR only if the decision needs recording.
- **Success signal**: no pull-back after user scroll; auto-resume when the word returns to the band.

**Phase 11 - Chapter from REAPER track name**
- **Goal**: preselect the chapter the narrator is recording.
- **Scope**: chapter picker suggestions from `.rpp` tracks with the shared matcher; never creates a track; no bridge work.
- **Success signal**: "Chapter 1" never suggests "Chapter 11"; no match leaves the current default.

**Phase 12 - Roadmap and status bookkeeping**
- **Goal**: docs say one true thing.
- **Scope**: `docs/roadmap.md` and `config/roadmap.json` in one commit, `docs/README.md` inventory, the `manuscript-teleprompter.md` status line (it still says "Planned. Deferred work item" although the sidecar, host relay and page are shipped; proposed replacement: "Shipped (first cut): the sidecar, host relay and Teleprompter page exist; open work is tracked in the two teleprompter PRDs"), and the sentence about an in-app roadmap reader if the user agrees.
- **Success signal**: no two documents disagree about the feature's status.

### Parallelism Notes

Phases 1, 4, 5, 9 and 10 have no dependencies and touch different areas (sidecar devices, shared UI hook, Go catalog, Go service, reader scroll). Phase 2 then 3 is the settings chain; 5 then 6 then 7 is the engine chain (7 also needs 3 and 4); 8 follows 7. Phases 2, 3, 4, 7, 9 and 11 all edit `TeleprompterPage.tsx`, so sequence them or expect rebases; phase 4 is best done first among them to avoid re-touching the install code. Other PRDs edit the same file: PRD 1 Phase 2 (session-core extraction into `useTeleprompterSession` and `ReadAlongView`), `release-readiness-provisioning-and-docs-site.prd.md` Phase 1 (unified install job snapshots and a shared poll hook, which overlaps this PRD's Phase 4 `useAssetInstall`; whichever lands first owns the hook and the other consumes it). Recommended order: release-readiness Phase 1, then this PRD's Phase 4, then PRD 1 Phase 2, then this PRD's Phases 2, 3, 7, 9 and 11; anyone landing out of order rebases.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | new `sidecars/manuscript-teleprompter/core/devices.py`, argument wiring in `live_asr.py`, `docs/architecture/manuscript-teleprompter.md` | PRD 1 phases 3, 6, 9 (`live_asr.py` arguments) |
| 2 | `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/contracts/teleprompter.ts,api/wailsClient.ts,api/mockApi.ts}`, `apps/ui/wailsjs/go/main/Host.*`, `components/teleprompter/*`, visual catalog, doc screenshots | Host API version bumps; PRD 1 phase 2 (`TeleprompterPage.tsx`, `MicrophoneField`) |
| 3 | `apps/desktop/app.go` (`fieldSchemas`, validation), `config/defaults.json`, `components/settings/{Settings.tsx,ScopedSetting.tsx}`, `api/mockFixtures.ts`, `TeleprompterPage.tsx` | PRD 1 phase 12 (`fieldSchemas`, Settings); other Settings work |
| 4 | new hook file, `components/proofing/Transcript.tsx`, `components/teleprompter/TeleprompterPage.tsx`, their tests | Any Proofing or Teleprompter page work; PRD 1 phase 2 extraction of session logic; release-readiness Phase 1 (same install poll loop and `TeleprompterPage.tsx`; land it first or share the hook) |
| 5 | new `config/moonshine-assets.json`, new or extended `apps/desktop/internal/{moonshine,assets}`, `apps/desktop/{app.go,bindings.go,app_test.go}`, `hostApi.ts`, Wails bindings, contracts, `docs/research/local-dependency-evaluation.md`, `docs/architecture/first-use-dependency-provisioning.md` | Host API version; ADR and catalog naming; release-readiness Phase 3 (aggregated catalog: register Moonshine there, or land before it and migrate) |
| 6 | `sidecars/manuscript-teleprompter/core/live_asr.py`, `pyproject.toml`, `uv.lock`, `scripts/release/{prepare-resources.py,verify-installable.mjs}`, CI release workflow | Any dependency or lockfile change; PRD 1 sidecar phases; `verify-installable.mjs` is also edited by `reaper-automation-follow-through.prd.md` Phase 4 and `release-readiness-provisioning-and-docs-site.prd.md` Phase 8 (all three add to its file checks: rebase, keep each check independent) |
| 7 | `apps/desktop/internal/teleprompter/service.go`, `bindings.go`, `contracts/teleprompter.ts`, `TeleprompterPage.tsx`, settings, mock, visual catalog, screenshots, `docs/guides/using-the-app/{teleprompter.md,settings.md}` | PRD 1 phases 3 and 9 (`service.go`, contract) |
| 8 | ADR, `config/defaults.json`, small launch-aid change in the Go service, `docs/architecture/manuscript-teleprompter.md` | ADR number |
| 9 | `apps/desktop/internal/teleprompter/service.go` and test, `TeleprompterPage.tsx` message | PRD 1 phases 3 and 9 (`service.go`) |
| 10 | `components/teleprompter/ReaderText.tsx`, new hook, tests, visual catalog | PRD 1 phases 4, 5, 7 (same file) |
| 11 | `TeleprompterPage.tsx` chapter picker, consumes matcher from PRD 1 phase 8 | PRD 1 phase 8; PRD 1 phase 2 |
| 12 | `docs/roadmap.md`, `config/roadmap.json`, `docs/README.md`, `manuscript-teleprompter.md` | PRD 1 phase 13 (also edits roadmap and docs) |

Cross-cutting: every phase re-checks `docs/adr/` numbering immediately before writing an ADR; every phase that adds a binding bumps `hostAPIVersion` in `apps/desktop/app.go`, `apps/ui/src/hostApi.ts`, `apps/desktop/app_test.go` and regenerates `apps/ui/wailsjs/go/main/Host.{js,d.ts}` (whichever PR lands second increments again; check `hostAPIVersion` at merge time); the user guide page `docs/guides/using-the-app/teleprompter.md` currently tells the narrator to type the microphone name, offers Tiny and Small only and says to press Stop after Done, so Phases 2, 3, 7, 9 and 10 each update it (and `settings.md` for Phase 3) in the same PR; `apps/ui/src/docsGuide.test.ts` guards its links and footers, not its wording; every `apps/ui` phase runs `visual-catalog-sync`, the Playwright suite with PNG review at desktop, small-desktop, tablet and mobile, and `doc-screenshot-sync`; primitives or `styles.css` changes add the atlas run and `design-spec-guard`; every phase follows CLAUDE.md: plan, `change-impact-scan`, TDD, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard`, `feature-cleanup`. This PRD adds no `integrations/reaper` Lua, so no manual REAPER verification is required here; the device-open test in Phase 1 does need the user's microphone.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Support both live engines behind one event contract, user-selectable (prior decision, ADR 0021) | Whisper and Moonshine | One engine | Compare them in the real UI |
| Default engine chosen only after evaluating both in the real UI (prior decision, ADR 0021) | Recorded in an ADR in phase 8 | Pick now | Measurements are small-sample |
| Keep Windows-only `dshow` capture; no `sounddevice` switch yet (prior decision) | Enumerate `dshow` names | `sounddevice` | Listed name must be the openable name |
| Ship Whisper first, Moonshine only in PR C (prior decision) | This PRD is PR C | Ship together | Reduce risk |
| Moonshine models via the hashed catalog, pre-placed directory, not the library downloader (prior decision) | Pinned URL and SHA-256 per file | Library auto-download | First-use provisioning policy |
| Selecting a model never downloads; explicit confirm at first use (prior decision, `first-use-dependency-provisioning.md`) | Existing gate | Background download | Policy |
| Local-first, no loopback server, REST or port (prior decision) | Unchanged | - | Recorded boundary |
| Findings are suspected; nothing edits text or audio (prior decision) | Unchanged | - | Product boundary |
| Windows-first (prior decision) | Moonshine Windows wheel only | Cross-platform | Scope |
| Update `roadmap.md` and `roadmap.json` together when the feature leaves "Deferred" (prior decision, `docs/roadmap.md`) | Phase 12 | Separate updates | Files must agree |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |
| Workflow and gates (prior decision, CLAUDE.md) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup; Playwright PNG review at four viewports; host API bump in three places | Fast check only | History of silent regressions |
| Live matching signal (prior decision) | Unconstrained streaming partials plus fuzzy matching against the script; `hotwords` biasing only | Vosk-style grammar-constrained decoding | A closed grammar force-fits speech to the nearest allowed word and masks misreads |
| Do not depend on WhisperLive's runtime (prior decision) | Port its VAD-chunk, rolling-decode and word-timestamp ideas into the sidecar, with attribution | Run its WebSocket server or client, or its model cache | A server violates the no-loopback rule, its cache bypasses the hashed asset catalog, and its capture client is redundant when capture and inference are both local |
| Confirmation rule (prior decision) | LocalAgreement-2 from whisper_streaming; the tracker also follows partials speculatively | SimulStreaming (AlignAtt) | It needs PyTorch and a GPU (its README calls CPU too slow for real time); LocalAgreement alone adds about 1 s of lag |
| Fallback engine (prior decision) | Sherpa-ONNX stays a fallback candidate only | Adopt it now | Never prototyped here; only Whisper and Moonshine were measured |
| Shared microphone seam with PRD 1 | Recommendation: one `MicrophoneField` component | Picker built by either PRD alone | Pending the user's answer |
| Microphone is never typed (user, 2026-09-20) | The microphone is detected from the DAW (PRD 1 phase 11) or chosen from a dropdown of listed devices; no free-text field or "Other..." entry exists, and a failed listing blocks the phase instead of falling back to typing | Typed "Other..." fallback (earlier draft) | Typed names are error-prone and were the original failure this initiative exists to remove |
| Typed microphone fallback was a task-brief mistake, corrected before merge (Phase 2, 2026-09-22) | `MicrophoneField` stays dropdown-only and a failed/empty listing blocks Start, exactly as the row above already decided; no new ADR, since the standing decision already covered this case | Kept the typed "Other…" fallback and ADR 0090 (Proposed) that Phase 2 initially shipped | An earlier task brief mistakenly told the Phase 2 agent to add a typed fallback, missing the recorded decision above; ADR 0090 was deleted rather than superseded, since it documented a mistake, not a real decision |
| Device enumeration backend (Phase 1, 2026-09-22) | PyAV `dshow` listing via `av.logging.Capture`, no ffmpeg subprocess | Windows audio APIs; `sounddevice` | Confirmed on real hardware: every listed audio device opened through the exact capture call; no fallback needed |
| Settings home, packaging shape, binding shape, auto-stop trigger, scroll behavior | Recommendations under Open Questions | See there | Pending the user's answers |

## Research Summary

**Market Context**
- The research doc surveys comparable teleprompters: PromptVO (voice-following with live misread detection), TelePrompterProTools (faster-whisper timing), Descript (no DAW sync); Autocue and PromptSmart's VoiceTrack informed the tracker shape (per `docs/research/reaper-automation-surface.md` section 7 and `manuscript-teleprompter.md`, vendor claims unverified). None documents selectable local engines; the differentiator here is a local, provisioned, user-selectable engine with verified assets.

**Prior art surveyed (2026-09-19; projects' own claims, unverified by us) and what each decided**

| Project | What it is | Disposition |
| --- | --- | --- |
| [WhisperLive](https://github.com/collabora/WhisperLive) (MIT) | VAD-gated audio windows, rolling `faster-whisper` decode, real per-word timestamps, as a WebSocket client and server | Ported, not depended on: server and own model cache conflict with the no-loopback rule and the hashed catalog; attribution required (see Attribution) |
| [whisper_streaming](https://github.com/ufal/whisper_streaming) (LocalAgreement, MIT) | Emit only words that consecutive decodes agree on; paper reports about 3.3 s latency on long-form speech | Adopted as the confirmation rule (ADR 0021); its floor of about 1 s is why partials drive the cursor speculatively |
| [SimulStreaming](https://github.com/ufal/SimulStreaming) (AlignAtt) | Lower latency, built on PyTorch and aimed at GPUs; README calls CPU "too slow for real-time" | Rejected: not a fit for this CPU-only stack |
| [Autocue](https://github.com/EdNutting/autocue) (MIT) | Streaming Vosk or Sherpa-ONNX plus a fuzzy script matcher run on every partial as a speculative "what if" from the last committed position; never backward on partials, finals re-anchor; author claims sub-250 ms | Design adopted for the tracker (`script_tracker.py` header); the claimed latency is unverified |
| [Moonshine](https://github.com/moonshine-ai/moonshine) (MIT, English streaming models) | Caches encoder state instead of re-decoding, word timestamps in streaming mode, `set_context()` biasing, Windows wheel | Adopted as the second engine (this PRD provisions it); accuracy and latency figures are the vendor's own |
| Vosk (Kaldi, MIT) grammar-constrained mode | Offline, small models, true zero-latency streaming, can restrict decoding to the script's vocabulary | Rejected for the matching signal: masks genuine misreads. Unconstrained partials plus fuzzy matching is the ordinary open-source pattern |
| Sherpa-ONNX | Streaming ASR runtime used by Autocue | Fallback candidate only |
| Browser Web Speech API teleprompters | Cloud speech recognition | Excluded by the local-first boundary |
| UltraStar, SingStar-style karaoke games | Score pitch against a known melody | Ruled out: not free ASR against prose |
| Amazon Whispersync / Immersion Reading; [open-whispersync](https://github.com/jstriblet/open-whispersync), [Storyteller](https://tildes.net/~books/1d3i/i_made_an_open_source_self_hostable_synced_narration_platform_for_ebooks), [syncabook](https://github.com/r4victor/syncabook) | Offline read-along: Whisper transcription plus Levenshtein or DTW alignment against known text | Validates the diff-based approach; all are post-hoc on a complete recording, so they inform take review, not the live path |
| [book-karaoke](https://github.com/liorwn/book-karaoke) (MIT) | Live word-by-word karaoke rendering; alignment is offline and Apple-MLX-specific | Irrelevant to the engine; confirms the UI needs only a `{word, time}` stream decoupled from its producer |
| PromptSmart VoiceTrack | Commercial voice-following teleprompter; no public implementation | Its documented continuous-alignment-with-pause-and-resume behavior validates the tracker shape; hard gates and pace-based clocks were rejected (see the reading-mode PRD's decisions log) |

**Technical Context**
- Reused, verified: the streaming supervisor, the teleprompter service and its fake-sidecar tests, the shared `assets` install lifecycle (Piper voices, Whisper models), the layered settings store, the Wails event relay.
- Unverified and gated inside phases: PyAV `dshow` listing; Moonshine model file layout and pinned URLs; per-model license text; PyInstaller collection of `moonshine-voice` native libraries and installer growth; `moonshine_voice` import-time dependency on PortAudio.
- Live-latency facts are small-sample and measured only in the lab (per docs); the real-UI evaluation in Phase 8 is the first end-to-end measurement.
- Doc and code discrepancies found while writing this PRD are listed in the hand-off message.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
