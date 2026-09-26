# Render, Encode and Master: From Rendered Chapters to a Delivery-Ready Package

**Source:** [Audiobook studio benchmark](../research/audiobook-studio-benchmark.md) recommendation 7 ("Built-in render and encode (MP3, M4B). A mastering chain.") and §1 "Editing and mastering" (must-haves: "A mastering order of EQ, then a limiter, then gain into the RMS window (ACX's own advice)" [W3]; differentiator "A one-click 'master to spec' with a report you can keep. Hindenburg Narrator's ACX export is the benchmark" [W23]) and "Quality check and delivery" (differentiator "One master exported as several platform packages" [W23]). Part of the benchmark train wave 4 ([agent train](../operations/agent-train.md)).

**Implements:** the `Encoder` and `Packager` ports [Provider Ports](provider-ports.prd.md) declares with no implementation ("The Encoder and Packager ports are declared only. The future render-encode-master PRD implements them"). **Builds on:** the delivered per-chapter render configuration (`internal/renderconfig`, reaper-automation-follow-through Phase 11/12, per docs), the delivered MP3 container check ([Delivery Platform Profiles](delivery-platform-profiles.prd.md) Phase 6, ADR 0237) and its selected delivery profile (Phase 1-4), and the delivered ID3 chapter embedding (`internal/chaptertags`, ADR 0099).

Citations are `file:line` on `main` at `48a882d` for anything checked in code; "per docs" marks a claim taken from another PRD and not independently re-verified in this session.

## Problem Statement

The app can configure a REAPER render (file name, pattern, bounds) and can embed ID3 chapter tags into an already-rendered combined MP3, but it never encodes anything. The scorecard's own line: "MP3 or M4B encoding, naming templates | Missing." A narrator today renders WAV in REAPER, then has to encode to MP3 themselves (in REAPER's own render dialog, in Audacity, or with a separate tool), apply any mastering by hand, and assemble the exact set of files ACX (or another platform) expects — separate opening/closing credits, one section per file, a retail sample, chapter metadata — with no app-side checklist confirming the package is complete. The benchmark names Hindenburg Narrator's one-click "master to spec" export as the bar to clear [W23], and its own concept mock (05) shows one mastering chain and "outputs for each platform (MP3, M4B, FLAC, a QC report)" from one master.

## Evidence

Verified in code (`48a882d`):

- **Render configuration is narrator-approved and refuses to trigger a render itself, on purpose.** `internal/renderconfig` "never sends a command that renders anything - it only asks Lua to set `RENDER_FILE`, `RENDER_PATTERN` and `RENDER_BOUNDSFLAG` and to read `RENDER_TARGETS` back, so the narrator can see the resulting file names before pressing Render themselves in REAPER" (`apps/desktop/internal/renderconfig/service.go:8-11`), because "the S5 spike found that a render action's ID passed to the `RENDER_STATS` getter can trigger a real render" (`:10-11`). Any render-encode-master phase that reads render output reuses this narrator-triggered discipline; it must not close that gap by finding another way to auto-render.
- **Chapter tag embedding already reads rendered per-chapter files and writes to a new copy, never the source.** `internal/chaptertags` "reads already-rendered MP3 files, computes a chapter timeline from them, and writes ID3v2 CHAP/CTOC frames into a NEW copy of a narrator-supplied MP3 - never the file it is given, and never the per-chapter render files it reads durations from" (`chaptertags.go:3-6`, ADR 0099, per docs). This "new copy, never the source" rule is the precedent Encoding and Mastering (below) both follow.
- **An MP3 frame parser already exists, for durations only, not levels.** `internal/chaptertags/mp3.go` walks MPEG frame headers to compute per-file durations for the chapter timeline (Evidence above; `mp3.go:1-15` names the MPEG version/layer tables it reads). A second, independent MP3 frame parser was built by [Delivery Platform Profiles](delivery-platform-profiles.prd.md) Phase 6 (`internal/measure/mp3header.go`, ADR 0237, per docs) for bitrate/CBR/sample-rate container checks. Neither decodes audio or reads levels from an MP3. This PRD's Encoder produces MP3 bytes that both of those readers must accept; it does not merge the two parsers (Q6 covers whether a later cleanup should).
- **No encoder exists anywhere in the repository.** A search of `apps/desktop`, `sidecars` and `libs/python` for `lame`, `ffmpeg`, `libav`, `mp4box` and `m4b` (case-insensitive) outside this PRD, the benchmark doc and Python's own `av` dependency's internal FFmpeg linkage finds nothing that encodes. The Python sidecars already depend on `av` (PyAV, which links FFmpeg) for capture (`pyproject.toml:5-23`, per docs Evidence in [Provider Ports](provider-ports.prd.md)) and for chapter duration reads, but nothing in the repo calls its encode path.
- **The `Encoder` and `Packager` ports are already named and scoped to this PRD.** `provider-ports.prd.md`'s own "What We're NOT Building": "An encoder implementation - The Encoder and Packager ports are declared only. The future render-encode-master PRD implements them" (per docs), alongside that PRD's Could-priority row "`Encoder` and `Packager` ports declared, no implementation."
- **The DAW port already names the two capabilities this PRD's mastering chain would use when a DAW is present.** `daw-port-and-capabilities.prd.md`'s capability table (per docs): `fx_chains` (`FXManager`, `Actions.ListFXChains/ApplyFXChain/ListFX/AddTakeFX`, Experimental today) and `render_config` (`RenderConfigurer`, `internal/renderconfig`, Supported). The benchmark's own mock 05 caption: "One mastering chain, which runs as a REAPER FX chain or in the built-in engine" — this PRD's mastering phase is the "or" clause's built-in half, and reads `fx_chains` through the DAW port when a REAPER-driven alternative is wanted (Q3).
- **ACX's own mastering order is already recorded.** [Delivery Platform Profiles](delivery-platform-profiles.prd.md) Evidence, quoting the benchmark: "A mastering order of EQ, then a limiter, then gain into the RMS window (ACX's own advice)" [W3]; that PRD's ACX rule table already states the RMS window (−23 to −18 dB) and peak ceiling (−3 dB, sample-peak judged) this PRD's mastering chain targets, so the two numbers are not re-derived here.
- **Measurement (levels) is already in Go, hand-written and validated on analytic signals, by prior decision.** ADR 0025 (per docs, cited by [Character Continuity Review](character-continuity-review.prd.md) Evidence and Decisions Log): "Measurement lives in Go, hand-written and validated on analytic signals; no third runtime." `internal/measure` implements loudness, true peak and noise-floor metering itself. This PRD's mastering gain stage reuses `measure`'s existing loudness/RMS/peak readers rather than re-measuring with a new library.
- **Downloadable, hash-verified, catalog-backed assets are the established pattern for anything heavier than the repository wants to vendor.** `apps/desktop/internal/assets` (per docs, cited by multiple sibling PRDs) already backs Piper voices and Whisper models with pinned URLs, hashes and an explicit-Download first-use gate (`docs/architecture/first-use-dependency-provisioning.md`, per docs). An encoder binary (Q1) follows the same gate rather than shipping inside the installer or downloading silently at startup.

Per docs (not independently re-verified in this session): FFmpeg's own LGPL/GPL licensing split depends on exactly which build configuration is used (a GPL build enables more codecs, including some MP3 encoders, than an LGPL one); this PRD's Phase 0 settles which build and license class is acceptable before any binary is catalogued, mirroring how Praat (GPL, per docs) was kept a separate process rather than linked into the app.

## Proposed Solution

Three narrator-triggered, chain-of-custody-preserving stages, each writing new files and never the source:

1. **Encode.** A catalog-backed, downloadable encoder (Q1) turns a rendered WAV (per chapter, credits, retail sample) into MP3 (CBR, ACX's 192 kbps floor and above) and M4B/AAC with embedded chapters, through the `Encoder` port `provider-ports.prd.md` declared.
2. **Master (optional, narrator-triggered).** A fixed EQ-then-limiter-then-gain-into-RMS-window chain (ACX's own order [W3]), applied to a rendered WAV before encoding, either as a REAPER FX chain (when the DAW port's `fx_chains` capability is available and the narrator opts into it, Q3) or as a built-in Go chain reusing `measure`'s existing meters for the gain stage's target. Writes a new mastered WAV; the recording itself is never touched (mirrors `chaptertags`' "new copy, never the source" rule and ADR 0032's "analyzers never change audio on their own").
3. **Package.** The `Packager` port assembles one platform's full delivery set from the encoded files and the project's existing data (credits files, retail sample, chapter metadata) per the [Delivery Platform Profiles](delivery-platform-profiles.prd.md) book checklist and the profile's own file-naming and structure rules, with a checklist report the narrator can keep (mirroring the delivery report's own "not a certification" framing) — "one master exported as several platform packages" [W23] by running the packager once per profile.

## Key Hypothesis

We believe that a narrator-triggered encode-master-package pipeline, built on the ports the platform-profiles and provider-ports PRDs already declared, will let a narrator go from rendered chapters to an ACX-ready (or another platform's) delivery package inside the app, matching Hindenburg Narrator's one-click export bar [W23], without the app ever changing audio the narrator did not ask it to change. We'll know we're right when: encoding a rendered WAV set produces MP3/M4B files that pass the existing delivery-profile checks (`internal/deliveryprofile`, MP3 container check, ID3 chapters) with no manual step; the mastering chain's output measurably lands inside ACX's RMS window and under its peak ceiling on the fixture set; and a package assembled for ACX contains exactly the files and names the selected profile's book checklist expects, no more and no less.

## What We're NOT Building

| Item | Why |
| --- | --- |
| Native recording (the built-in recorder itself) | [Native Recording Suite](native-recording-suite.prd.md) (per docs) owns capturing audio; this PRD starts from an already-rendered WAV, from REAPER or (later) the built-in engine |
| Automatic, un-triggered mastering or "fix it for me" audio changes | ADR 0032 ("analyzers report findings and never change audio... on their own", per docs) and this train's own delivery-platform-profiles Decisions Log ("the app never changes audio without the narrator's action", per docs) both hold here: mastering runs only when the narrator presses the button, on a copy |
| A general-purpose FX chain editor or plugin host | The mastering chain is one fixed order (EQ, limiter, gain); a narrator wanting a custom chain in REAPER already has `fx_chains` (Experimental, this train's DAW port PRD) for that |
| Levels measurement on the encoded MP3 itself | Out of scope; [Delivery Platform Profiles](delivery-platform-profiles.prd.md)'s own DX-2 (per docs) owns MP3 level *measurement*; this PRD only *produces* the MP3 and confirms it against the existing container check |
| Distributor upload (ACX, INaudio, etc.) | Local only, per the roadmap's product boundary; the package is a folder or zip the narrator uploads themselves |
| FLAC or other lossless delivery formats beyond what a platform's profile calls for | The mock's "FLAC" mention is a Could (Q7); MVP targets MP3 and M4B, the two formats every profile researched so far actually requires or accepts |
| A new, third MP3 frame parser | Reuses `chaptertags/mp3.go` (durations) and `internal/measure/mp3header.go` (container checks, ADR 0237) as consumers of this PRD's *output*; Q6 covers whether they should later share code, which this PRD does not force |
| Encoding on macOS or Linux | Windows-first, matching every other adapter in the app (D7, per docs) |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Encode correctness | Every produced MP3 passes the existing `acx.format`/`acx.sample_rate` container rules (`internal/deliveryprofile`, ADR 0237) with no manual re-check | Go test: encode a fixture WAV, run it through the existing MP3 container check |
| Chain of custody | No encode or master step ever overwrites its source file; every output is a new path | Go test asserting distinct source/destination paths, refused if equal |
| Mastering target | On the fixture set, mastered output's RMS lands within ACX's −23 to −18 dB window and sample peak at or below −3 dB | Go test against `internal/measure`'s own readers |
| Package completeness | An ACX package assembled for a fixture project contains exactly the profile's book-checklist files (credits, retail sample, one file per chapter, chapter metadata), named per its template | Go table test |
| Multi-platform from one master | The same mastered/encoded source produces a distinct, correctly-named package for each profile the narrator selects, with no re-encode unless the profile's format differs | Go test over two profiles sharing one MP3 format |
| Trust boundary | The encoder binary is downloaded only after an explicit narrator action, hash-verified, with a license record | `first-use-dependency-provisioning.md` acceptance criteria (per docs); a dependency record file |
| Wire contracts | Every new payload has a Zod schema, a golden, a `wireContracts.test.ts` row and a passing mock | `pnpm check` |
| Gate | `pnpm check` (full) green; visual suite for the Master & QC package flow at every viewport | CI and PNG review |

## Open Questions

Every question takes its recommendation by default (D22, per the [implementation plan](implementation-plan.md)); anything genuinely needing the owner is filed as a Proposed ADR and a comment on #510.

- [ ] **Q1. What encodes the audio?** (A) A catalog-backed, downloadable FFmpeg build (static Windows binary), gated through `apps/desktop/internal/assets` like Whisper/Piper, with its exact build and license class recorded in Phase 0 before it is catalogued. (B) A pure-Go MP3/AAC encoder library. (C) Shell out to REAPER's own render/encode (defeats the point: REAPER is not always present in the built-in-engine future, and the app would depend on REAPER's own LAME build). **Recommendation: (A).** A vendored static FFmpeg build is the most tested, most format-complete option, matches the existing asset-provisioning pattern exactly, and (per Evidence) the Python sidecars already depend on FFmpeg's own libraries through PyAV, so the licensing question is not new to this PRD, only its Go-host encode path is.
- [ ] **Q2. Where does the encoder run: the Go host, or a small helper process?** (A) The Go host shells out to the catalogued FFmpeg binary directly (matching how `internal/process` already launches sidecars, per docs), one call per file, with bounded timeouts and narrator-visible progress. (B) A Python sidecar wraps PyAV's own encode path, reusing the dependency already present. **Recommendation: (A).** A vendored binary avoids adding PyAV's encode surface (used today only for capture and duration reads) to this PRD's trust boundary, and keeps the encode step a simple, killable child process like every other host-launched tool.
- [ ] **Q3. Does the mastering chain ever run inside REAPER, or only the built-in Go chain?** (A) Built-in Go chain only for v1 (EQ, limiter, gain, each a small, analytically-testable DSP stage per the `measure` package's own precedent, ADR 0025); a REAPER-FX-chain alternative is a Could, gated on the DAW port's `fx_chains` capability reaching Supported. (B) REAPER FX chain only, no built-in chain. **Recommendation: (A).** The built-in chain works in every mode (REAPER-linked or, later, the built-in recorder) and needs no Experimental capability; a REAPER-side alternative can follow once `fx_chains` is trusted enough to promote (this train's booth-actions-enablement PRD's job, per docs).
- [ ] **Q4. Does the narrator pick specific EQ/limiter parameters, or is the chain fixed?** (A) Fixed defaults tuned to ACX's own advice [W3], with the RMS target read from the selected delivery profile (so a non-ACX profile with different numbers masters to its own target automatically). (B) Narrator-adjustable EQ bands and limiter ceiling. **Recommendation: (A)** for v1 ("master to spec" is the differentiator [W23], not a general mastering suite); adjustable parameters are a later Could once narrators ask for it.
- [ ] **Q5. Where does a package land on disk?** (A) A narrator-chosen output folder per package (profile name and date in the folder name by default), never inside the project's own `narration-utils/` sidecar tree (which holds derived app data, not deliverables). (B) Always inside the project folder. **Recommendation: (A).** A delivery package is the narrator's own deliverable, not derived app state; defaulting outside the sidecar tree matches how a rendered WAV already lands wherever REAPER's render dialog was pointed, not inside `narration-utils/`.
- [ ] **Q6. Should the two existing MP3 frame parsers (`chaptertags/mp3.go`, `measure/mp3header.go`) be merged now that a third package produces MP3s?** (A) No, not in this PRD — each serves a different, narrow purpose (durations vs. container checks) and merging is a refactor with its own review cost, not required for this PRD's own scope. (B) Yes, extract a shared `internal/mp3frame` package. **Recommendation: (A)**, revisited as a `feature-cleanup` note only if this PRD's own work makes the duplication newly painful (for example if the encoder needs frame-level detail neither existing parser reads).
- [ ] **Q7. FLAC or other lossless delivery in v1?** (A) No; MP3 and M4B/AAC only, matching every profile this train has researched so far. (B) Yes, since INaudio's research (delivery-platform-profiles Evidence, per docs) mentions FLAC as accepted. **Recommendation: (A)** for v1; FLAC encoding is a straightforward Encoder-port addition later if a profile that requires it ships.

## Users & Context

**Primary user:** a solo author-narrator who has rendered chapters (and credits, and a retail sample) in REAPER and wants a complete, correctly-named, ACX-ready delivery package without hand-encoding or hand-assembling files.

**Current behavior:** encodes MP3 in REAPER's own render dialog or a separate tool, applies any mastering by ear in REAPER, and manually renames and collects files into a folder before uploading to ACX.

**Trigger:** chapters are rendered and the narrator is ready to deliver.

**Job to be done:** when my chapters are rendered, I want one action that masters (if I ask for it), encodes and packages them exactly to my chosen platform's spec, so I do not hand-assemble a delivery folder every time.

**Non-users:** narrators who deliver raw WAV with no encoding step; anyone wanting the app to upload to a distributor directly.

## Solution Detail

### Core capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Phase 0: encoder binary choice, license record, build verification | 0 |
| Must | `Encoder` port implementation: WAV to MP3 (CBR), progress, cancellation | 1 |
| Must | M4B/AAC encoding with embedded chapters (reusing the existing chapter-timeline logic) | 2 |
| Should | Built-in mastering chain (EQ, limiter, gain-into-RMS-window), narrator-triggered, writes a new file | 3 |
| Must | `Packager` port implementation: assembles a profile's book checklist into a named, structured output (Q5) | 4 |
| Must | Master & QC page: an "Export package" flow, per-platform, with a keepable checklist report | 5 |
| Could | One master exported as several platform packages in one action (no re-encode when formats match) | 6 |
| Could | FLAC output (Q7) | 7 |
| Won't | Native recording, distributor upload, a general FX host, MP3 level measurement | See table above |

### MVP scope

Phases 0 to 5: a narrator can encode rendered WAVs to MP3/M4B, optionally master first, and export one complete, checked package.

### User flow

1. On the Master & QC page (this train's extended [Delivery Platform Profiles](delivery-platform-profiles.prd.md) page), the narrator selects rendered chapters (plus credits, retail sample) and presses **Master & encode**.
2. If mastering is on, the chain runs on a copy per file, targeting the selected delivery profile's own RMS/peak rules (Q4); the narrator can audition before and after.
3. Encoding runs (Q1/Q2), with per-file progress; the app never blocks past its usual 100 ms acknowledgement rule (ADR 0075, per docs).
4. **Package for ACX** (or another selected profile) assembles the full set into a chosen output folder (Q5), naming files per the profile's template, and shows a checklist (files present, chapter metadata embedded, retail sample included) the narrator can export as a report.
5. **Package for another platform** reuses the same encoded/mastered files where the format already matches, re-encoding only what a different profile's format requires (Phase 6, Could).

## Technical Approach

**Feasibility: MEDIUM** overall. Encoding (Phases 1, 2) is MEDIUM (a well-trodden FFmpeg CLI wrapper, but Phase 0's license/build verification gates it). Mastering (Phase 3) is MEDIUM (three small, analytically-testable DSP stages, following `measure`'s own precedent, but tuning the limiter to sound acceptable needs real listening, not just numbers — flagged to #510 as an owner listening check). Packaging (Phase 4) is HIGH (mostly file assembly against an already-specified profile checklist).

**Architecture:**

- **Package.** New `apps/desktop/internal/encodeport` implementing the `Encoder` interface `provider-ports.prd.md`'s architecture sketch names (`type Encoder interface { Encode(ctx, WavIn, Format, Options) (Result, error) }`, exact shape frozen in Phase 1 against that PRD's `port.Registry[P]` pattern), backed by a catalogued FFmpeg binary (Q1) launched through `internal/process` (Q2) with bounded timeouts, cancellation and narrator-visible progress (mirroring how every other host-launched tool in the repo reports progress). A parallel `apps/desktop/internal/packager` implements the `Packager` port: `Assemble(profile, files, outputDir) (Manifest, error)`.
- **Mastering.** New `apps/desktop/internal/mastering`: `EQStage`, `LimiterStage`, `GainStage` in that fixed order, each pure functions over PCM samples (in the spirit of `internal/measure`'s own hand-written, analytically-tested DSP, ADR 0025), with the gain stage's target read from the selected delivery profile's `acx.rms` rule (or the equivalent rule of a custom profile). Writes a new WAV; the source is opened read-only.
- **Chapter metadata for M4B.** Reuses the existing per-file duration/chapter-timeline logic already proven in `internal/chaptertags` (Evidence) rather than re-deriving chapter boundaries; M4B's own chapter-atom format (distinct from ID3 CHAP/CTOC) is new code in Phase 2, informed by the same `Chapter`/`TimedChapter` shapes `chaptertags.go` already defines.
- **Packaging against a profile.** `packager.Assemble` reads the selected `deliveryprofile.Profile`'s book-scope rules (`acx.credits`, `acx.retail_sample`, `acx.one_section_per_file`, `acx.channels`, per [Delivery Platform Profiles](delivery-platform-profiles.prd.md) Phase 7, per docs) to decide which files a complete package needs and how they are named, so a profile change (a new platform, or a narrator's custom profile) changes packaging with no code edit here — the profile is the single source of truth for "what a complete delivery looks like," matching that PRD's own architecture.
- **Bindings.** `EncodeStart(files, format, options)`, `EncodeCancel(jobId)`, `MasterStart(files, options)`, `PackageAssemble(profileId, files, outputDir)`, each with a job-progress event following ADR 0075's acknowledgement rule and `internal/tools`' existing run-logging pattern (`docs/architecture` tool-run-logging, per docs). Each on `h.services()` with a `stressReaders` row; `hostAPIVersion` bumps once per phase adding bindings.
- **Wire contracts (CLAUDE.md).** `apps/ui/src/api/schemas/renderEncodeMaster.ts` (encode job, master job, package manifest); goldens `tests/fixtures/contracts/render-encode-*.json` written by Go tests with `UPDATE_CONTRACTS=1`; rows in `wireContracts.test.ts`; mocks in `mockApi.ts`. No `as` cast or bare `JSON.parse`.
- **UI.** Extends the Master & QC page (this train's delivery-platform-profiles extension) with an export flow; uses existing job-progress patterns (no new primitive expected beyond `StatusBadge`/`Toolbar` from `studio-ui-primitives.prd.md` if that has landed by Phase 5, else existing `Dialog`/`ProgressBar`). Visual suite: encode/master progress states, package checklist, all viewports; axe clean; guide page and screenshots.
- **Trust boundary.** The catalogued encoder binary is a new asset-provider row (pinned URL, hash, explicit-Download gate, license record); a row in `docs/architecture/threat-model.md` and `SECURITY.md` for both the binary itself and for reading narrator-supplied output-folder paths (path traversal considerations, matching how every other narrator-chosen-path feature in the repo is guarded). A dependency record entry (per docs, mirroring `local-dependency-evaluation.md`'s own format) for the FFmpeg build and its license class (Q1).
- **ADRs.** One ADR at Phase 0/1 (encoder choice and license class, mirroring how Praat's GPL boundary got its own record, per docs) and one at Phase 3 if the mastering chain's exact order/targets need a durable record (parallels ADR 0236/0237's own precedent for a newly-measured or newly-produced audio property). Next free number in lane D's block (0400-0409), checked at write time and again before the last push (D52 on #509).

**Technical risks:**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| The vendored encoder's license is incompatible with the project's own AGPL-3.0-or-later license (ADR 0039, per docs) or with an acceptable build configuration | Medium | Phase 0 is a dedicated verification step before any binary is catalogued; if a build is unacceptable, fall back to Q1's option (B), a pure-Go/permissively-licensed encoder |
| Mastering output sounds acceptable by the numbers but not by ear | Medium | Owner listening check flagged to #510, matching the pattern the delivery-profiles PRD used for its own ACX Check comparison |
| Packaging silently omits a file a profile actually requires | Medium-High | Packager reads the profile's book checklist as the single source of truth (no separate hard-coded file list); a missing required item refuses the export rather than silently shipping incomplete |
| Encoder binary crashes or hangs on an unusual WAV | Medium | Bounded timeout, cancellation, and the same "not checked by the app" honesty pattern for anything the encoder cannot confirm |
| Two MP3 parsers (Q6) drift in what they consider valid, and a file this PRD produces fails one but not the other | Low-Medium | Phase 1's own test runs the produced file through both existing parsers before Phase 1 is called done |
| Output-folder path handling (Q5) introduces a path-traversal or overwrite risk | Low | Threat-model row; refuse to overwrite an existing package without narrator confirmation |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | Ports used | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Encoder verification | Pick and verify the encoder build (Q1), record its license class, confirm it produces MP3/M4B this app's own MP3 checks accept | pending | - | - | none | - |
| 1 | `Encoder` port: MP3 | `internal/encodeport`, WAV to MP3 (CBR), progress, cancellation, catalog asset row | pending | 2 | 0 | `Encoder` (`provider-ports.prd.md`) | - |
| 2 | `Encoder` port: M4B/AAC | M4B chapters (reusing the chapter-timeline shape from `chaptertags`), AAC encode | pending | 1 | 0 | `Encoder` (`provider-ports.prd.md`) | - |
| 3 | Mastering chain (Should) | `internal/mastering`: EQ, limiter, gain into the profile's RMS window; narrator-triggered, writes new files | pending | 4 | - | none (reads `internal/measure`); `fx_chains` (Q3, Could, gated on that capability reaching Supported) | - |
| 4 | `Packager` port | `internal/packager`, reads the selected delivery profile's book checklist, assembles and names a complete package (Q5) | pending | 3 | 1, 2; [Delivery Platform Profiles](delivery-platform-profiles.prd.md) Phase 7 | `render_config` (reads confirmed render targets); `Packager` (`provider-ports.prd.md`) | - |
| 5 | Master & QC export flow | Bindings, UI export flow, checklist report, visual suite | pending | - | 3, 4 | UI primitives `StatusBadge`, `Toolbar` (`studio-ui-primitives.prd.md`, if landed) | - |
| 6 | Multi-platform export (Could) | One mastered/encoded source produces packages for several selected profiles in one action | pending | - | 5 | none | - |
| 7 | FLAC output (Could, Q7) | `Encoder` gains a FLAC target | pending | - | 1 | `Encoder` | - |

### Phase details

- **Phase 0.** Output: a dated note in `docs/research/` naming the exact FFmpeg build, its license class, and a table of the encode/decode paths this PRD actually exercises (mirrors `local-dependency-evaluation.md`'s own format, per docs). Blocks Phases 1 and 2 only; Phase 3's mastering DSP has no dependency on it.
- **Phase 1.** Tests: encoding a fixture WAV produces an MP3 that passes `internal/deliveryprofile`'s `acx.format`/`acx.sample_rate` rules and both existing MP3 parsers (Q6); cancellation mid-encode leaves no partial output file at the destination path; a source path never equals a destination path (refused).
- **Phase 2.** Tests: M4B chapter boundaries match the same per-file durations `chaptertags` already computes for ID3 CHAP/CTOC, on the same fixture set (cross-checked, not re-derived).
- **Phase 3.** Tests: analytic-signal fixtures (known RMS, known peak) prove each stage in isolation and the chain end to end; the source file is opened read-only throughout; a non-ACX custom profile's different RMS target is honored without a code change.
- **Phase 4.** Tests: a profile with `acx.credits`/`acx.retail_sample`/`acx.one_section_per_file` requirements produces exactly those files, named per the profile's template; a project missing a required item (no retail sample picked, say) refuses with a clear reason rather than shipping an incomplete package.
- **Phase 5.** Visual states: encode/master progress, a completed package checklist, a refused/incomplete package state; guide page and screenshots.
- **Phase 6.** Tests: two profiles sharing MP3 at the same bitrate reuse one encoded file; a profile requiring M4B triggers a second encode only for that format.
- **Phase 7.** Tests: FLAC round-trips through a profile that declares it accepted (INaudio, per docs, once that platform's own profile exists).

### Standing gates

Every phase: plan, `change-impact-scan` (render config, chaptertags, the delivery profile and its report are all shared), TDD, `pnpm check` (full), Playwright visual suite for `apps/ui` changes (all viewports), `feature-cleanup` including the threat-model and dependency-record rows, `Closes #<n>` on the tracking issue.

### Parallelism notes

Phase 0 gates Phases 1 and 2 but not Phase 3 (mastering has no encoder dependency; it operates on WAV throughout). Phases 1 and 2 can run in parallel once Phase 0 settles the encoder choice. Phase 4 needs both encoder phases and the delivery-profiles book checklist (Phase 7 of that PRD); if that phase has not landed yet, Phase 4 degrades to the profiles' currently-`not_yet`/`listen` book rules exactly as that PRD's own Phase 7 already does, and tightens automatically once it lands.

### Parallel-session compatibility

| Phase | Files touched | Collides with |
| --- | --- | --- |
| 0 | `docs/research/` (new note), a new dependency-record entry | Any other PRD adding a dependency record in the same window |
| 1, 2 | new `apps/desktop/internal/encodeport/*`, an `assetregistry.go` row | [Delivery Platform Profiles](delivery-platform-profiles.prd.md) Phase 6 (`internal/measure/mp3header.go`, read-only consumer, not edited here); any other PRD adding an asset-provider row |
| 3 | new `apps/desktop/internal/mastering/*`; reads `internal/measure/*` (read-only) | None expected; `fx_chains` capability owners if Q3's Could is pursued |
| 4 | new `apps/desktop/internal/packager/*`; reads `internal/deliveryprofile/*` (read-only) | [Delivery Platform Profiles](delivery-platform-profiles.prd.md) Phase 7 (shares the book-checklist rule shape; coordinate rather than duplicate) |
| 5 | `apps/desktop/{app.go,bindings.go,app_test.go,hostrace_test.go}`, `apps/ui/src/components/delivery/*`, `apps/ui/src/{hostApi.ts,api/*}`, `tests/visual/*`, `docs/images/ui/*` | Every binding-adding PRD (`hostAPIVersion`); Delivery Platform Profiles' own UI phases (same page) |
| 6, 7 | `internal/encodeport/*`, `internal/packager/*` | None expected |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Encoder choice (proposed, Q1) | A catalogued, hash-verified static FFmpeg build via `internal/assets` | A pure-Go encoder; shelling out to REAPER's own render | Matches the existing asset-provisioning pattern; most format-complete; PyAV's own FFmpeg dependency already exists in the sidecars |
| Encoder process shape (proposed, Q2) | Go host launches the binary directly via `internal/process` | A Python sidecar wrapping PyAV's encode path | Keeps a simple, killable child process; avoids widening PyAV's role beyond capture/duration reads |
| Mastering location (proposed, Q3) | Built-in Go chain for v1 | REAPER FX chain only | Works with or without a DAW; no dependency on promoting an Experimental capability |
| Mastering parameters (proposed, Q4) | Fixed defaults from the selected delivery profile's own RMS/peak rule | Narrator-adjustable EQ/limiter | Matches "master to spec," not a general mastering suite, for v1 |
| Package output location (proposed, Q5) | A narrator-chosen folder, outside the project's derived-data sidecar tree | Always inside the project folder | A deliverable, not derived app state |
| MP3 parser consolidation (proposed, Q6) | Not in this PRD | Merge into a shared `internal/mp3frame` | Each existing parser serves a narrow, different purpose; merging is its own refactor cost |

## Research Summary

**In the repo:** the narrator-triggered render-configuration discipline (`internal/renderconfig`), the "new copy, never the source" precedent (`internal/chaptertags`, ADR 0099), the existing MP3 frame-header work in two separate packages (`chaptertags/mp3.go`, `internal/measure/mp3header.go`, ADR 0237), the Go-only, analytically-tested measurement precedent (ADR 0025), the asset-provisioning pattern (`internal/assets`, per docs), and the `Encoder`/`Packager` ports this PRD implements (`provider-ports.prd.md`).

**From the benchmark:** recommendation 7's built-in render/encode/mastering items, the ACX mastering order [W3], and Hindenburg Narrator's one-click export as the differentiator bar [W23].

**Not verified in this session:** the exact FFmpeg build and license class to vendor (Phase 0's job); whether the mastering chain's numeric targets, once implemented, actually sound acceptable to the owner (an owner listening check, filed to #510).

---

*Generated: 2026-09-26*
*Status: DRAFT - open questions Q1 to Q7 take their recommendation per D22 until the owner says otherwise*

## Visual Spec

Concept mock copied from [the audiobook studio benchmark](../research/audiobook-studio-benchmark.md#3-what-the-ideal-looks-like-concept-mocks), **not yet owner-approved as a build spec** — kept under `mockups/render-encode-master/` marked **concept** until the owner approves it on [#510](https://github.com/countrymanprime/narration-utils/issues/510), per the agent-train wave-0 rule. Names and numbers are placeholders.

![Master & QC: per-file checks by platform, mastering chain, delivery package](mockups/render-encode-master/05-master-delivery-concept.webp)

*Master, QC and delivery (concept)* (`05-master-delivery-concept.webp`) — the one mastering chain and "outputs for each platform" this PRD's Encoder and Packager ports build toward; the per-platform QC checks themselves are [Delivery Platform Profiles](delivery-platform-profiles.prd.md)' own page, which this PRD's export flow extends. A Mockup check table will be added once the owner approves it and building against it begins.
