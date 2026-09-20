# Diagnostics, Delivery Reports and Cleanup Tools

**Supersedes:** `docs/utilities/narration-diagnostics.md`, `docs/utilities/delivery-and-review-export.md`, `docs/utilities/silence-cleanup.md`, `docs/utilities/clause-split-and-level-normalize.md`, `docs/utilities/daw-project-scan.md` (planned-work briefs, removed when this PRD landed; recoverable from git history)

Roadmap milestone 4 ("Diagnostics and delivery") plus the adjacent planned utilities that share its measurement code: Narration Diagnostics, Delivery and Review Export, Silence Cleanup, Clause Splitting and Level Normalization, and the unbuilt remainder of DAW Project Scan. Citations are `file:line` on worktree HEAD `b9d348d` for anything checked in code; "per docs" marks a claim taken from a document and not verified. `origin/main` is now at `d5cc994`. Since `b9d348d` it gained documentation (the teleprompter integration plan, the split guide `docs/guides/using-the-app/*.md` with its index and `apps/ui/src/docsGuide.test.ts` guard, `docs/operations/github-workflow.md`), GitHub metadata and CI files (a `github-scripts` job in `_quality.yml`, so the `lua` job cited below moved to `:115-123`), and two dependency bumps. No other source file cited below changed, so its line cites still hold. The next free ADR number is whatever is free at merge time (0027 at `d5cc994`).

## Problem Statement

A solo narrator or a reviewer preparing chapters for handoff has no in-app, reproducible answer to "are these chapter files technically ready, and what did we check?". They measure by hand in other tools and track results in scattered REAPER markers. The suite already contains a tested Go measurement package (loudness, RMS, peaks, noise floor, `delivery_qc` findings) that nothing calls, so milestone 4 has shipped no user value, and the silence, breath and level-matching chores stay manual and error-prone.

Narrators also need a prioritized way to find measurable audio defects and pacing anomalies while keeping subjective performance assessment (acting, interpretation) out of the tool, and a concise view of what was measured, what was reviewed and what remains open that does not depend on scattered DAW markers or a claim of distributor certification. On the cleanup side, REAPER's built-in dynamic split needs threshold settings a narrator is not confident tuning, re-adding a wrongly trimmed edge means undo or dragging it back, and a destructive editor such as Audacity makes a bad cut costlier still (per the source briefs); so cleanup must be preview-first and reversible. Splitting a take into sentence or clause items and normalizing each to one loudness point is manual, repetitive review work. Separately, Home progress is a word-count estimate rather than what is recorded, and narrators want to inspect a track's transcript and waveform, and act on a span, without leaving REAPER context or hunting through generated files (the transcript/waveform part is deferred; see What We're NOT Building).

## Evidence

Verified in code (HEAD `b9d348d`):

- **A tested measurement package exists and is unused.** `measure.Analyze` (`apps/desktop/internal/measure/measure.go:52`) returns integrated LUFS, RMS, sample peak, true peak, noise floor and duration (`Report`, `measure.go:32-49`); unmeasurable values are `nil` and serialise as JSON `null` (`measure.go:29-31`). `measure.Evaluate` (`profile.go:42`) turns a report plus a caller-supplied `Profile` into `delivery_qc` findings. 36 test functions cover it. A repo-wide grep finds no importer of `internal/measure` or `internal/findings` outside their own packages, and `bindings.go` has no measurement or findings binding (`docs/architecture/codebase-map.md` says the same).
- **No distributor profile ships.** `Profile` has no built-in instance and its comment says a profile is added only after independent validation (`profile.go:20-22`, ADR 0025).
- **Profile gaps.** `Profile` limits only LUFS, RMS, true peak and noise floor (`profile.go:23-29`); there is no sample-peak limit even though `Report.SamplePeakdBFS` exists.
- **Whole-file only.** `Analyze` takes an `io.Reader` with no range, no cancellation and no progress hook (`measure.go:52`). RMS is computed over the whole file including silence (`measure.go:96-98`). There is no clipping detection, windowed level series, silence map or room-tone segmentation. The Diagnostics MVP needs all of those.
- **Format limits.** Only mono and stereo PCM/float WAV is read (`apps/desktop/internal/measure/wav.go:74-76`); compressed formats are refused. A finished audiobook deliverable is often MP3 (per docs, research section 5.3), so the delivered artifact cannot be measured today.
- **Finding IDs ignore the audio.** `newFinding` derives the ID from analyzer, file path, profile name, metric and kind only (`profile.go:104`). Re-rendering the same path with worse audio yields the same ID, so a previously dismissed finding would stay dismissed. The findings contract says dismissed findings keep their ID "unless source evidence materially changes" (`docs/architecture/findings-contract.md`).
- **The findings package is only a record.** It has the shape, validation, `StableID` and `WithReview` (`apps/desktop/internal/findings/findings.go:112-192`) but no store, so review state has nowhere to persist yet. Persistence belongs to the dashboard package (`review-dashboard-and-findings-adoption.prd.md`).
- **The `.rpp` reader cannot map items to source audio.** `tracks.Item` carries position, length, name and source only (`apps/desktop/internal/tracks/tracks.go:18-26`); `parseItem` ignores the item `GUID` that the fixture contains (`internal/tracks/parse.go:68-97`, `testdata/basic.rpp:14`) and the source start offset and playrate. Per-item measurement and any REAPER item action need those. `teleprompter-manuscript-integration.prd.md` Phase 8 already plans the `SOFFS`/`PLAYRATE` parse and a chapter-to-track matcher.
- **Home "recorded hours" is an estimate.** `AudiobookEstimatePanel.tsx:69` multiplies estimated hours by `recordedFraction ?? RECORDED_FRACTION[status]`; `recordedFraction` is set only by mock fixtures (`api/mockFixtures.ts:222`, `api/aliceManuscript.ts:78`), never by the Go host. This is the hook where a measured value belongs.
- **Bridge Lua has none of the needed editing commands.** The dispatch chain (`integrations/reaper/narration_ui_bridge.lua:523-552`) has compare, jump and the three line-identity commands; there is no split, trim, item-volume or preview-marker command. `integrations/reaper` has no automated tests (CI `lua` job is `stylua --check` only, `.github/workflows/_quality.yml:115-123`).
- **Transcript word timing is not a persisted artifact.** `compare.py:602` writes per-chunk words to a temp file; whether the saved compare result keeps word-level timing is unverified (TBD - needs research). Clause splitting and words-per-minute both need it.
- **Long jobs must report real progress** (ADR 0015) and new bindings must snapshot service pointers under `h.mu.RLock` (the pattern is `h.services()`, documented in `docs/architecture/host-binding-concurrency.md`). The existing install-job pattern is `app.go:56-65,727-830`.
- **Host API version** is in three places, all `5`: `apps/desktop/app.go:33`, `apps/desktop/app_test.go:40`, `apps/ui/src/hostApi.ts:2`.

Per docs (not verified in code):

- ADR 0025: the DSP was checked against BS.1770's published 48 kHz coefficients and analytic signals, not the EBU's official test files, "which were not available offline"; adding them "would strengthen validation".
- The tracks doc states the track/item enumeration part of DAW Project Scan is delivered, by reading the `.rpp` directly and not through a new REAPER bridge action; chapter matching, measured duration and transcript/waveform are not (`docs/utilities/tracks.md`; the original DAW Project Scan brief is superseded by this PRD). Its planned "enumerate via a new bridge action" is deliberately not carried: the static parser already does it and works standalone.
- Published guidance on ACX room-tone lengths disagrees (research doc section 5.3), which is why no distributor profile ships.

Assumption - needs validation through observation: how narrators currently verify chapter readiness (which tools, how long, how often they re-check after re-rendering). No baseline exists. Method: watch the user run their real handoff check on two chapters before Phase 5 acceptance.

## Proposed Solution

Ship measurement first, generically, then build on it. Expose the Go `measure` package through a job-based Wails binding (real progress, cancel, byte-identical input untouched) and a Delivery page where the narrator picks rendered chapter WAVs, sees every measurement with units and "unavailable" reasons, and optionally sets their own limits (report-only by default; no built-in distributor numbers). Validate the DSP against the EBU test files. Add read-only diagnostics analyzers (clipping, windowed level, silence map, room-tone) that emit `audio_quality`, `pacing` (only when timing exists) and `silence_cleanup` findings. Add an explicit, redactable HTML/Markdown/JSON report export. Replace Home's estimated recorded hours with a measured value from the `.rpp`. Silence cleanup and clause split/level normalize are specified as preview-then-approve REAPER actions but deferred until the REAPER verification prerequisites (see `reaper-automation-follow-through.prd.md`) exist.

## Key Hypothesis

We believe a local, profile-neutral measurement page with reproducible report export will let solo narrators and their reviewers confirm chapter technical readiness without external tools or a hand-kept spreadsheet. We'll know we're right when a narrator can measure every rendered chapter of a book and export a shareable report in one sitting, the numbers match an independent reference (EBU test files, and a second tool on real chapters) within the published tolerance, and re-running on unchanged files produces an identical report apart from its timestamp.

## What We're NOT Building

- **A distributor (ACX or other) profile** - prior decision (ADR 0025, roadmap milestone 4): none ships until its rules are independently specified and validated. Which related profile work is in or out is Open Question 1.
- **Pass/fail certification language** ("ACX approved") - the export never guarantees acceptance by ACX or another distributor, never uploads audio, never replaces an engineer's review, and never conceals unresolved findings (they are always listed).
- **Any automatic audio edit or processing** - prior decision: no analyzer silently changes audio; cleanup actions are preview-then-approve, undoable, and REAPER item/take parameter changes, never rendered edits.
- **Measurement in a Python sidecar or in REAPER** - prior decision (ADR 0025): Go, so it works in a standalone launch with no REAPER.
- **Cloud analysis or upload** - prior decision: local-first.
- **Mastering, noise removal, voice-health diagnosis** - out of the diagnostics boundary.
- **A black-box quality grade, or subjective performance assessment** - diagnostics report measurement values, thresholds and source scope, never a single score; normal artistic pauses are not labelled defects without a configurable, reviewable threshold; acting quality stays out of scope.
- **Surround or compressed-format measurement in the first cut** - `measure` refuses them by design (`wav.go:74-76`); MP3 is Open Question 2.
- **Findings persistence and the review dashboard** - owned by `review-dashboard-and-findings-adoption.prd.md`; this PRD consumes them.
- **Duplicate/pickup detection and take ranking** - owned by `take-review-pickups-duplicates-take-intelligence.prd.md`.
- **Chapter-to-track matching logic** - owned once, in `teleprompter-manuscript-integration.prd.md` Phase 8; Phase 8 here only consumes it.
- **Transcript/waveform view and highlight-and-delete/apply-FX actions** from DAW Project Scan - later work; not needed by any measurement feature. Kept here so the plan is not lost: a per-track transcript view reusing Transcript Compare's Faster-Whisper output, paired with a waveform built from downsampled peak data; clicking a transcript word or sentence moves the REAPER edit cursor and plays from there (REAPER-launched only, needs the bridge); later, highlight-and-delete and highlight-and-apply-FX on a selected span, each in its own undo block with explicit per-action confirmation. Scanning itself is read-only by default; a low-confidence chapter match is surfaced for review, never silently assumed.
- **Later-work items from the source briefs, not in this cycle** (recorded so they are not lost): conservative mouth-noise and breath candidates; session-to-session environment comparison and custom narrator baselines; chapter pacing heatmaps and trends across a book; batch chapter reports and optional handoff checklists; configurable distributor profile packs, each only after its requirement is specified, versioned and tested; auto-tuning cleanup thresholds from a short narrator-approved calibration pass; batch cleanup preview across a chapter or book behind one approval gate; per-chapter and per-book level-consistency reports once diagnostics measures levels across a whole book; per-genre or per-character loudness targets; an ambiguous-match review queue for chapter matching.
- **macOS/Linux and non-US-English** - Windows-first, US-English-first.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| DSP agreement with EBU reference files | Every supplied file within the test set's published tolerance (exact tolerance TBD - needs research on the EBU documents) | Go test over the official files, gated on a fixture directory (Phase 3) |
| Reproducibility | Same file and profile produce a byte-identical JSON report except `generated_at` | Go test; run twice |
| Input never modified | 0 files change (SHA-256 before equals after) across analyze, diagnostics and export | Go test asserting file hashes |
| Unavailable is never a number | 100% of silent, short and unsupported inputs report `null` or a named error, never `0` or `-Inf` | Table test over silence, sub-window, digital-silent and float NaN fixtures |
| Second-tool agreement on real chapters | Integrated LUFS and true peak within 0.1 LU / 0.1 dB of a second meter on 3 real chapters (proposal; tool choice TBD) | Manual comparison by the user, recorded in the PR |
| Throughput | TBD - baseline needs measurement in Phase 1 (a one-hour stereo 48 kHz file) | Benchmark recorded in the PR; target set afterward |
| Progress honesty | Job progress is monotonic and reflects bytes read (ADR 0015) | Go test like `TestImportJobReportsRealProgressAndLogs` |
| New Go coverage | At least 80% on new packages and functions | `go test -cover` |
| UI verification | Every new state reviewed as PNG at desktop, small-desktop, tablet and mobile | `apps/ui/screenshots/app/<page>/<state>/<viewport>.png` per CLAUDE.md |
| Home shows measured hours | Recorded hours for a scanned project equal the sum of matched item lengths, not an estimate | Go and UI tests on the fixture `.rpp` (Phase 8) |

## Open Questions

- [ ] **1. Which profile work is in and out of v1?** Options: (A) measurements plus user-defined limits only; no built-in numeric preset. (B) A vendor-neutral preset from an independent standard (for example an EBU R128 style broadcast target) alongside (A); it is not an audiobook rule set and could mislead. (C) A distributor preset labelled "unvalidated". Recommendation: (A). It respects the recorded decision, needs no validation work, and still delivers the value (numbers, limits the narrator sets, a report). It also satisfies the source briefs' "generic audiobook measurement profile with visible thresholds and units": the profile is the narrator's own named limit set, always shown with units in the UI and the report. Revisit a distributor profile only in a change that cites the distributor's published specification and validates against it, including how the distributor defines RMS and noise floor (`measure`'s whole-file RMS at `measure.go:96` may not match; TBD - needs research).
- [ ] **2. Measured input formats.** The deliverable is often MP3, but `measure` reads only WAV. Options: (a) WAV only for v1; the report says "measured the rendered WAV". (b) Add an MP3 decoder in Go (candidate libraries and their accuracy and license: TBD - needs research). (c) Shell out to a bundled decoder (adds a binary and provenance burden). Recommendation: (a) for the MVP and a spike on (b) after Phase 3, because measuring the delivered file is a real gap but not a blocker for the generic report.
- [ ] **3. What is measured first: rendered files or REAPER items.** Options: (a) rendered chapter WAVs picked by the narrator (works standalone; no item mapping). (b) Items on a matched track (needs `SOFFS`/`PLAYRATE`, item GUID, matcher). Recommendation: (a) first; (b) later when Phase 8's matcher and parse extensions exist.
- [ ] **4. Where do review decisions and stored findings live?** The findings package has no store. Options: (a) wait for the dashboard package's store, and ship Phases 5 to 7 read-only (no accept/dismiss). (b) Add a private store here. Recommendation: (a). A second store would fork the contract; the report then lists findings as "unreviewed" until the store exists.
- [ ] **5. Finding-ID stability when audio changes.** IDs ignore the audio today (`profile.go:104`). Options: (a) include a source fingerprint (size, mtime, or content hash) in the ID so re-rendered audio yields a new finding. (b) Keep IDs stable and store the fingerprint as evidence so the dashboard can mark a dismissal "stale". Recommendation: (b), because it preserves the "dismissed stays auditable" rule and lets the UI say "dismissed against a different render"; needs agreement with the dashboard package.
- [ ] **6. EBU fixtures: commit, fetch, or skip.** Options: (a) commit the official files (size and redistribution terms TBD - needs research). (b) A gated test that reads a directory named by an environment variable and a documented fetch step, with expected values committed. (c) Skip. Recommendation: (b), and record the outcome (pass or discrepancy) in a docs note; open a new ADR only if the DSP has to change a recorded decision.
- [ ] **7. Report format and default privacy.** Options: (a) one self-contained HTML plus a JSON with identical finding IDs; (b) Markdown plus JSON; (c) also a zipped "reviewer package". Recommendation: (a) with local paths redacted by default and an explicit "include paths" checkbox; no audio embedded; no zip in the MVP.
- [ ] **8. Audition from the Delivery page.** `authorizedMediaPath` serves only files referenced by the selected `.rpp` (`apps/desktop/media.go:51-62`), so rendered files cannot be played in-app without widening that allowlist. Options: (a) no in-app audition in the MVP; navigate in REAPER only. (b) Add a per-session allowlist of files the narrator explicitly picked. Recommendation: (a), because widening a path-authorization route is a security-sensitive change that deserves its own review.
- [ ] **9. Where user-defined limits live.** Options: (a) a "Delivery" section in the layered settings (project, global, repo default) with numeric fields. (b) Named profile files in the sidecar. Recommendation: (a), consistent with `daw-integration.md` settings layering; `saveSettings` validates only `choice` and `color` kinds today (`apps/desktop/app.go:701,718-724`), so a numeric kind is part of Phase 2. The source briefs say the narrator "selects a profile" and "chooses scope and profile"; (a) gives one limit set per settings layer (project, global, repo default), so revisit named, switchable profiles (b) only if narrators need several sets per book.
- [ ] **10. Definition of "recorded duration" for Home.** Options: (a) union of item intervals on the matched track (handles stacked or overlapping takes); (b) last item end minus first start; (c) sum of item lengths. Muted items are not parsed today (TBD - needs research). Recommendation: (a), with the definition stated in the UI tooltip.
- [ ] **11. Pull cleanup and normalize into this cycle?** Options: (a) analyzers now (findings only), REAPER apply later. (b) Everything now. (c) Defer all. Recommendation: (a): Phase 9 yields value without touching REAPER; Phases 10 and 11 wait for the REAPER verification prerequisites.

## Users & Context

**Primary User**
- **Who**: a solo author-narrator recording an audiobook in REAPER on Windows, rendering chapter files themselves.
- **Current behavior**: renders chapters, checks levels in a separate tool or a web checker, tracks what was checked by hand, and re-checks after every re-render.
- **Trigger**: a chapter render is finished and about to be handed to a reviewer or a distributor, or a proofer asks for a technical report.
- **Success state**: opens Delivery, picks the chapter files, sees each measurement against their own limits with anything unmeasurable flagged, exports a report a reviewer can read without the app.

**Job to Be Done**
When I finish rendering chapters, I want a fast, reproducible technical check with an exportable record, so I can hand off with confidence and prove what was measured.

**Non-Users**
- Distributors and ACX reviewers who want certification (the app never certifies).
- Engineers who want mastering or noise removal.
- Narrators on Audacity or non-REAPER DAWs for the REAPER-action phases (measurement itself works without any DAW).
- macOS/Linux users and non-US-English books (deferred).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Measure rendered WAV files (LUFS, RMS, sample and true peak, noise floor, duration) through a cancellable job with real progress | 1 |
| Must | Report-only by default; user-defined limits from layered settings; "unavailable" shown as a state with its reason | 2, 5 |
| Must | Validate the DSP against EBU official test files, and record the result | 3 |
| Must | Delivery page with results, limits and clear error/empty states | 5 |
| Must | Explicit, redactable report export (HTML plus JSON, same finding IDs) | 7 |
| Should | Read-only diagnostics: clipping, windowed level shifts, silence map, room-tone changes, long pauses | 4, 6 |
| Should | Measured recorded duration on Home from the `.rpp`, with an ambiguous-match state; the same chapter-track mapping exposed for the Review page's chapter grouping | 8 |
| Should | Report the installed asset versions (Piper voice, Whisper model, spaCy model; exact version and provenance from the asset cache manifest, `release-readiness-provisioning-and-docs-site.prd.md` Phase 2 writes it and Phase 3's `AssetsList` exposes it) in the exported report and diagnostics, because the manifest exists so diagnostics can report them; shown as unavailable until that PRD lands | 7 |
| Should | Fingerprint evidence so dismissals go stale when audio changes | 1, 7 |
| Could | Silence/breath/click candidates as `silence_cleanup` findings (analyzer only) | 9 |
| Could | Words-per-minute and pacing findings where aligned timing exists | after 6 (timing TBD) |
| Could | Abrupt pickup-join detection (level or room-tone step at a known item boundary), with playback context in REAPER | after 8 (needs item boundaries) |
| Could | Preview markers and approve-to-apply trims in REAPER | 10 |
| Could | Clause split and per-item level normalize with before/after report | 11 |
| Won't (this cycle) | Distributor profiles, MP3 measurement, in-app audition, mouth-noise detection, cross-session comparison and narrator baselines, pacing heatmaps and trends, batch reports and handoff checklists, cleanup auto-tuning and batch preview, per-book level-consistency reports, per-genre or per-character targets (see What We're NOT Building) | later |

### MVP Scope

Phases 1 to 7 (measurement job, settings-driven limits, EBU validation, windowed analyzers, Delivery page, diagnostics view, report export) are the MVP. Phase 8 (measured Home duration) is independently shippable. Phases 9 to 11 are specified but explicitly deferred: 9 needs no REAPER, 10 and 11 need REAPER verification and are gated on `reaper-automation-follow-through.prd.md`.

### User Flow

1. The narrator opens Delivery and chooses one or more rendered WAV files (file dialog).
2. A job starts; the bar reflects bytes read and can be cancelled. Files that cannot be read (unsupported format, corrupt) show a named error and do not stop the others.
3. Each file shows integrated LUFS, RMS, sample peak, true peak, noise floor, duration and digital-silent window count with units. A value that could not be measured shows "not measurable" and why. With limits set in Settings, out-of-range values show as findings with the limit and the value.
4. The narrator opens the Diagnostics tab to see clipping, level shifts, long pauses and silence, each with a timestamp range, the threshold that triggered it (narrator-configurable, never hidden) and whether the measured file is a raw recording or a processed render. They listen in context in REAPER (no in-app audition in the MVP, Open Question 8), then resolve or document each result; until the dashboard's store exists (Open Question 4) findings show as unreviewed.
5. The narrator chooses "Export report", picks the scope (chosen files now; a chapter or project once Phase 8's matcher exists), whether to include local paths or audio references, and receives an HTML file and a JSON file in the project's sidecar folder. Every unresolved finding and every unmeasured file is listed. Nothing else changes; source files are never modified.

## Technical Approach

**Feasibility**: HIGH for Phases 1 to 3, 5 to 8 (extends verified, tested code and existing job/settings patterns). MEDIUM for Phases 4, 6 and 9 (false positives for dramatic pauses and breaths; fixtures needed). LOW-MEDIUM for Phases 10 and 11 (new Lua behavior with no automated tests and unverified item-to-source time mapping).

**Architecture Notes**

- **Service and jobs.** New `measureService` in `apps/desktop/` (or `apps/desktop/internal/measure` plus a thin host wrapper) following the job pattern in `app.go:56-65,727-830`, but with real progress (ADR 0015): extend `measure.Analyze` with a context and a progress callback driven by bytes consumed against the `data` chunk size (`wav.go` already tracks `remaining`). Bindings are operation-specific (`bindings.go:15-18` rule): start, state, cancel, plus a multi-file picker using `runtime.OpenMultipleFilesDialog` (the app already uses `runtime.OpenFileDialog` for the manuscript, `bindings.go:258`, and `OpenDirectoryDialog` for projects, `bindings.go:182`). Snapshot service pointers under `h.mu.RLock` (the `h.services()` pattern of `docs/architecture/host-binding-concurrency.md`). Bump the host API version in the three places and regenerate `apps/ui/wailsjs/go/main/Host.{js,d.ts}`.
- **Range support.** Add an optional `[start, end)` sample range to the measurement entry point so per-item and per-chapter analysis (Phases 8, 10, 11) reuse one code path.
- **Windowed analyzers** live beside `measure` (one file per analyzer: clipping runs, short-term loudness series, silence map with minimum duration, room-tone segments) and are shared by Diagnostics, Silence Cleanup and Clause Split, as the utility docs require ("share ... measurement logic instead of duplicating"). Analyzers emit findings through `apps/desktop/internal/findings` and never import REAPER. Diagnostics stays read-only; Silence Cleanup and Clause Split own the reversible edit actions. Every threshold (clipping ceiling, long-pause length, level-shift step, silence floor and minimum duration) is a narrator-configurable input reported with its finding. Findings record whether the source is a raw recording or a processed render, because room-tone and level readings mean different things for each.
- **Profile** stays a caller-supplied `measure.Profile`. Build it from layered settings (`Delivery` section); add a `SamplePeakdBFS` limit; validate `min <= max` and finiteness; no numeric defaults.
- **Fingerprint.** Record `size`, `mtime` and a content hash in finding evidence; decision on ID identity is Open Question 5.
- **Report.** Pure Go templating over findings plus reports; deterministic ordering; analyzer and app versions embedded; paths redacted unless the narrator opts in; written under `<project>/narration-utils/delivery/` (tool-specific sidecar folder per `daw-integration.md`); never writes next to source audio. Contents: per-chapter status, unresolved findings, review decisions (when the store exists), measurement summaries with limits and units, and per finding its ID, evidence summary, timestamp range and manuscript context (chapter always; a text excerpt only when the narrator opts in); the human-readable and structured exports carry the same finding IDs and review states. It states which chapters and sources were and were not measured, so incomplete coverage is visible. Optional local audio references are off by default and never embed audio.
- **UI.** New Delivery page: contract in `apps/ui/src/api/contracts/`, adapter in `wailsClient.ts`, mock in `mockApi.ts`/`mockFixtures.ts`, page under `apps/ui/src/components/delivery/`, nav entry in `AppShell.tsx`. Tables reuse the existing `table.dtable` style; anything new that looks like a primitive gets a story and an atlas pass (ADR 0023) and must not grow the a11y debt list. Honor ADR 0015 (real progress), 0016/0017.
- **Measured Home duration.** Go computes per-chapter recorded seconds from the matched track's items (matcher from `teleprompter-manuscript-integration.prd.md` Phase 8) and populates `recordedFraction`/a measured field on the chapter payload (`contracts/manuscript.ts:9`); the estimate remains the fallback when no project or no match exists.
- **Cleanup detection (Phase 9).** Energy/RMS silence detection with a minimum-duration floor, plus lightweight breath and click heuristics (spectral shape, transient detection) so a breath or a plosive onset is not read as trimmable silence. Narrator inputs: silence floor, minimum breath length, pad/hold time, an optional saved preset (layered settings). Output is a `silence_cleanup` finding with candidate region bounds, a silence, breath or click classification, confidence and a split-plus-trim `suggested_action` that only executes on explicit approval.
- **Cleanup actions (deferred).** New Lua commands (`preview_cleanup_markers`, `apply_cleanup_trims`, later `apply_item_gain`) keyed by item GUID with stale handling like `stamp_item_lines` (`narration_ui_bridge.lua:380-402`); one undo block each; nothing changes without an explicit approve. Preview places non-destructive markers or regions for every candidate with no automatic commit, ever; the narrator can adjust thresholds, reject individual candidates, then approve all or per candidate. Every trim only moves item or take edges: source media is never rendered or deleted, so a bad trim is undone like any REAPER edit.
- **Clause split and normalize (Phase 11).** Clause and sentence boundaries come from transcript word timestamps, previewed through the same marker mechanism as cleanup. The narrator sets an RMS or integrated LUFS target (ITU-R BS.1770, already implemented in `measure`) and a tolerance; the gain delta is applied as item or take volume (or a take volume envelope), never by rendering. Each item's before and after level is reported so outliers are visible instead of trusting a silent global change. Source-time to project-time mapping is `D_STARTOFFS + (t - D_POSITION) * D_PLAYRATE` and breaks with stretch markers, sections and reversed sources (research doc section 6, inference): detect and refuse such items.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Silence/breath/click heuristics misclassify dramatic pauses or soft onsets | High | Findings only, thresholds set by the narrator, preview-then-approve; fixtures for breath after a plosive, click in silence, long dramatic pause; a misclassified breath or soft consonant onset is accepted as a risk and handled by the approval gate rather than by chasing one-shot accuracy |
| Numbers differ from what a distributor's checker reports (RMS definition, window, gating) | Medium | No distributor profile; label results "generic measurement"; EBU validation; state the RMS definition in the report |
| Multi-hour WAV or a still-recording file (header sizes unfinished) | Medium | `wav.go` already reads unfinished headers to EOF; add a size cap or progress-bounded read and a test with a growing file |
| Analysis is CPU-heavy and blocks the host | Medium | Background job, cancel, bounded concurrency (one job at a time), benchmark in Phase 1 |
| Re-rendered audio keeps a dismissed finding dismissed | Medium | Fingerprint evidence and stale marking (Open Question 5) |
| Path or private manuscript-excerpt leakage in a shared report | Medium | Redaction default on (paths, audio references, manuscript excerpts); test with paths and excerpts in evidence and messages |
| Profile drift: limits or analyzer change between reports | Medium | Report embeds the limits, units, analyzer and app version used; no distributor pack until specified, versioned and tested |
| Report hides incomplete source coverage (unmeasured chapters, missing or unsupported media) | Medium | Report lists measured and unmeasured chapters and files with the reason; tests for missing media and mixed chapter status |
| Room-tone or level "changes" that are deliberate processing changes between recordings | Medium | Findings record raw versus render; thresholds narrator-set and shown; findings are candidates to review, never verdicts |
| A transcript timestamp gap or misalignment produces a bad clause split point (Phase 11) | Medium | Same preview-before-commit gate as cleanup; tests for missing word timing and short interjections |
| Waveform generation cost on very long books (deferred transcript/waveform view) | Low now | Compute downsampled peak data once and cache; plan it with the deferred view |
| Widening the media route for audition | Medium | Not in MVP (Open Question 8) |
| Item-to-source mapping wrong for trimmed, stretched or reversed items | High for Phases 10-11 | Refuse unsupported items; extend `tracks` parse and add testdata cases; manual REAPER checklist |
| Lua actions untested | High for Phases 10-11 | Gate on the REAPER PRD's manual checklist and harness; user sign-off before "verified" |
| Concurrent PRs collide on host API version, ADR number, nav and screenshots | High | See Parallel-session compatibility |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Measurement job and binding | `measure` gains context, real progress and optional range; job service, start/state/cancel/file-picker bindings; host API bump; contract and mock; fingerprint evidence | pending | 2, 3, 4 | - | - |
| 2 | Delivery settings and limits | Numeric settings kind, `Delivery` section, `Profile` built from settings (adds sample-peak limit, no defaults), validation | pending | 1, 3, 4 | - | - |
| 3 | EBU validation | Gated test over the official files, fetch/README, recorded result; docs note | pending | 1, 2, 4 | - | - |
| 4 | Windowed analyzers | Clipping, short-term loudness series, silence map, room-tone segments in Go with findings emission; fixtures | pending | 1, 2, 3 | - | - |
| 5 | Delivery page | Page, nav entry, results table, limits summary, states (empty, running, error, unavailable), visual states, docs | pending | 3, 4 | 1, 2 | - |
| 6 | Diagnostics view | Bindings and Diagnostics tab listing findings with ranges and thresholds; read-only | pending | 7, 8 | 1, 4, 5 | - |
| 7 | Report export | HTML and JSON export, redaction, sidecar folder, deterministic output; review state included when the store exists | pending | 6, 8 | 1, 5 | - |
| 8 | Measured recorded duration | Chapter-track matches to recorded seconds on Home, ambiguous-match state, mapping exposed for the Review page's chapter grouping, docs; `tracks.md` kept accurate | pending | 1-7 | `teleprompter-manuscript-integration.prd.md` Phase 8 | - |
| 9 | Silence cleanup analyzer | `silence_cleanup` findings with classification and suggested action; thresholds in settings; findings view only | pending | 8 | 4, 6 | - |
| 10 | Preview and apply in REAPER | Lua preview markers and approve-to-apply trims; Go client; manual REAPER checklist | pending | - | 9; `reaper-automation-follow-through.prd.md` (checklist run, event fan-out, item GUID mapping) | - |
| 11 | Clause split and level normalize | Boundaries from transcript timing, per-item loudness, gain via item/take volume, before/after report | pending | - | 1, 10; persisted word timing (TBD) | - |

### Phase Details

**Phase 1 - Measurement job and binding**
- **Goal**: the app can measure files without freezing and without inventing progress.
- **Scope**: `measure` (context, progress callback, sample range, fingerprint helper), job service with one running job at a time, bindings `MeasureAnalyze`/`MeasureState`/`MeasureCancel`/`MeasurePickFiles`, host API bump (3 places plus Wails bindings), TS contract, mock, wailsClient adapter and test. No UI beyond the mock. Change-impact scan: `measure` has no importers today, so blast radius is the new code.
- **Success signal**: Go tests for cancel mid-file, monotonic progress, unsupported format error, silence returns `null`, range equals slice of the whole; input hashes unchanged; benchmark recorded.

**Phase 2 - Delivery settings and limits**
- **Goal**: limits are the narrator's, stored in the existing layers, with no built-in numbers.
- **Scope**: numeric kind in `fieldSchemas` and `saveSettings` validation (`apps/desktop/app.go:672-679`, validation at `app.go:718-724`), `config/defaults.json` (empty), `Settings.tsx`, `ScopedSetting.tsx`, `mockFixtures.ts`, profile builder, `SamplePeakdBFS` limit in `Profile` and `Evaluate`, tests. The same numeric kind carries the diagnostics and cleanup analyzer thresholds (clipping ceiling, long-pause length, level-shift step, silence floor, minimum silence and breath length, pad/hold time) so the narrator can configure and review them; a saved cleanup preset is a set of these values in the layered store.
- **Success signal**: an empty `Delivery` section yields a profile with no limits, so `Evaluate` emits nothing and the page shows "no limits set"; min greater than max is rejected; a non-numeric value is rejected; project override beats global beats default.

**Phase 3 - EBU validation**
- **Goal**: replace "checked against analytic signals" with "checked against the EBU files".
- **Scope**: fetch script or documented download (source and terms TBD - needs research), test gated on a directory variable, expected-value table committed, docs note with results; new ADR only if a decision changes (re-check `docs/adr/` numbering; take the next free ADR number at merge time, 0027 at `d5cc994`).
- **Success signal**: every provided file within tolerance, or each discrepancy explained and tracked.

**Phase 4 - Windowed analyzers**
- **Goal**: shared, tested detectors for clipping, level shifts, silence and room tone.
- **Scope**: new files in `apps/desktop/internal/measure` (or a sibling package), findings emission with evidence and thresholds (`audio_quality`; `pacing` only where transcript timing exists), deterministic fixtures generated in code, no REAPER. Measurements and findings distinguish a raw source recording from a processed render path. Long pauses are reported against a configurable threshold, never as defects by default. Abrupt pickup joins need known item boundaries and follow Phase 8 (MoSCoW Could).
- **Success signal**: tests for clean read, intentional silence, clipped audio, room-tone change, unresolved transcript timing; reported timestamps reproduce the condition from the same audio; raw and render inputs are labelled differently.

**Phase 5 - Delivery page**
- **Goal**: a narrator can pick files and read results.
- **Scope**: page, contract consumption, states, nav entry, `state-catalog.ts` rows and `app.spec.ts` drivers, `doc-screenshots.json`, a guide page under `docs/guides/using-the-app/` (listed in that folder's `README.md` index, with the breadcrumb first line and the Previous / Index / Next footer, all enforced by `apps/ui/src/docsGuide.test.ts`; every curated screenshot is embedded on exactly one page), atlas stories for any new primitive, `visual-catalog-sync` and `doc-screenshot-sync`, `design-spec-guard`. A nav change regenerates every doc screenshot: coordinate timing with other nav-adding PRDs.
- **Success signal**: all states reviewed as PNGs at four viewports; no sideways overflow; `pnpm check` and the visual suite green.

**Phase 6 - Diagnostics view**
- **Goal**: read-only diagnostics with thresholds and timestamps visible.
- **Scope**: binding and Diagnostics tab; no in-app audition (Open Question 8), so "listen in context" is navigation in REAPER; words-per-minute only if timing exists; the findings are what the review dashboard later ingests for resolve or document decisions.
- **Success signal**: each finding shows the measured value, the threshold, the source scope (raw or render, file or item) and the time range, instead of a quality grade; nothing is executed.

**Phase 7 - Report export**
- **Goal**: a recipient can identify and navigate every included finding.
- **Scope**: HTML and JSON with the same finding IDs and review states, analyzer and app version, source fingerprint, the report contents listed under Technical Approach (chapter status, unresolved findings, decisions, measurement summaries, per-finding timestamp range, manuscript context and evidence), redaction option, explicit export action, an "installed assets" section listing each installed asset's id, exact version and provenance from the asset cache manifest (Should; omitted with a stated reason until the release-readiness PRD's Phase 2 and 3 land; versions only, never local cache paths unless the narrator opts in), tests (missing media, unresolved findings, redaction, mixed chapter status, determinism, asset versions present and absent). Markdown output and a zipped reviewer package are Open Question 7 options; batch chapter reports are later.
- **Success signal**: golden-file test passes; a recipient can identify every included finding and navigate to it from its timestamp and context; the redacted export contains no absolute path or manuscript excerpt unless opted in.

**Phase 8 - Measured recorded duration**
- **Goal**: Home reports what is recorded, not an estimate.
- **Scope**: consume the matcher and `SOFFS`/`PLAYRATE` parse from the teleprompter PRD's Phase 8; interval-union duration (Open Question 10); manual override for ambiguous or renamed tracks stored in the project sidecar; `AudiobookEstimatePanel.tsx` reads the measured value and keeps the estimate as fallback; the scan is read-only by default; `docs/utilities/tracks.md` already points at this PRD's Phase 8 (repointed when the DAW Project Scan brief was removed); keep it accurate as the scan ships. Track-naming conventions vary across narrators' projects, so the manual-override path ships with the first matcher use, not later. The chapter-track mapping is exposed (a host binding, not a private detail of Home) both for measured duration and for the Review page's chapter grouping in `review-dashboard-and-findings-adoption.prd.md`, so every analyzer shares this one mapping instead of reimplementing it.
- **Success signal**: tests for multi-take tracks, renamed or reordered tracks and chapters with no track; an ambiguous match is flagged, never silently assumed.

**Phase 9 - Silence cleanup analyzer**
- **Goal**: candidates as findings, no edits.
- **Scope**: classification (silence, breath, click) with conservative confidence and a split-plus-trim `suggested_action` (parameters only; requires confirmation); minimum-duration silence detection plus spectral-shape and transient heuristics for breaths and clicks; narrator thresholds (silence floor, minimum breath length, pad/hold time) and saved presets in layered settings; list in the Diagnostics area. Shares its silence and level detectors with Phase 4.
- **Success signal**: fixtures for breath after a plosive, click inside silence, long dramatic pause near the threshold; ambiguous cases stay in review, since the narrator sets the thresholds that separate intentional pauses from cuttable dead air.

**Phase 10 - Preview and apply in REAPER**
- **Goal**: preview markers, then approve-to-apply trims, undoable.
- **Scope**: new Lua commands in the bridge (prefer a new file loaded by the bridge to limit merge conflicts), Go bridge client via the event fan-out from the REAPER PRD, item GUID and source-offset parse, manual checklist, ADR if the cleanup contract is a new decision.
- **Success signal**: the previewed marker equals the eventual trim boundary exactly; declining a candidate leaves the item byte-for-byte unchanged; approve-all and per-candidate commit are each one undo step; user signs off the manual REAPER checklist.

**Phase 11 - Clause split and level normalize**
- **Goal**: split on transcript boundaries and match loudness, reversibly.
- **Scope**: boundary proposal from word timing (persistence TBD), the narrator can review and adjust boundaries before committing; narrator-set RMS or integrated LUFS target and tolerance; per-item LUFS/RMS via the range API, gain via item/take volume (or a take volume envelope), before/after report per item; shares the preview/apply mechanism from Phase 10. Each split or gain change is a reversible REAPER parameter change in an undo block.
- **Success signal**: committed splits equal previewed markers exactly; re-running converges instead of drifting; tests cover clauses with no clear transcript timing, items already at target level, and short interjections near the minimum split length.

### Standing gates for every phase

Follow CLAUDE.md: plan (find or open the tracking issue first with `gh issue list`, and put `Closes #<n>` in the PR; see `docs/operations/github-workflow.md`), `change-impact-scan`, TDD (write tests first, 80% coverage on new code), `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard` when primitives or `styles.css` change, `feature-cleanup`. When `apps/ui` changes: `visual-catalog-sync`, the Playwright visual suite for the affected page across desktop, small-desktop, tablet and mobile with the PNGs opened and reviewed, `doc-screenshot-sync`, and the atlas (`pnpm --dir apps/ui atlas`) when a primitive or `styles.css` changes. When bindings change: bump the host API version in `apps/desktop/app.go`, `apps/desktop/app_test.go`, `apps/ui/src/hostApi.ts` and regenerate the Wails bindings. Re-check `docs/adr/` numbering immediately before writing an ADR. Update `docs/roadmap.md` and `config/roadmap.json` together when milestone 4 changes state (the GitHub milestones are generated from `roadmap.json` by `scripts/github/sync-milestones.mjs`, so never edit them by hand). Any Lua change needs the user's manual REAPER verification.

### Parallelism Notes

Phases 1, 2, 3 and 4 touch disjoint areas (measurement job and host, settings, test fixtures, analyzers) and can run concurrently, subject to the shared-file notes below. Phase 5 needs 1 and 2; Phases 6 and 7 both need 5 and edit the same page, so run them in order 6, 7 or accept rebases. Phase 8 is independent of 1 to 7 except the shared Home and nav files, but depends on another PRD's Phase 8. Phases 10 and 11 are a chain gated externally.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/internal/measure/*`, new service file, `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/contracts/*,api/wailsClient.ts,api/mockApi.ts,api/mockFixtures.ts}`, `apps/ui/wailsjs/go/main/Host.*` | Every session adding a binding: host API version (merge-time serialization point) and `app.go` `Host` struct |
| 2 | `apps/desktop/app.go` `fieldSchemas`/`saveSettings`, `config/defaults.json`, `Settings.tsx`, `ScopedSetting.tsx`, `mockFixtures.ts` | Teleprompter engines/input-devices PRD settings phase (same `fieldSchemas` map and `Settings.tsx`) |
| 3 | `apps/desktop/internal/measure/*_test.go`, testdata, docs note | None expected; ADR number if a decision changes |
| 4 | new files in `apps/desktop/internal/measure` | Silence-cleanup work elsewhere; keep one owner |
| 5 | `AppShell.tsx` NAV, `App.tsx`, `App.test.tsx`, `main.tsx`, `types.ts`, new `components/delivery/*`, `tests/visual/{state-catalog.ts,app.spec.ts,app.drivers.ts,doc-screenshots.json}`, `docs/images/ui/*`, `docs/guides/using-the-app/*`, `docs/README.md`, `docs/architecture/codebase-map.md` | Any PRD adding a nav item or page (dashboard, character continuity, take review): nav change regenerates every screenshot, so land nav additions serially |
| 6, 7 | `components/delivery/*`, new report package, bindings and version | Phase 5; findings-store work in `review-dashboard-and-findings-adoption.prd.md` |
| 8 | `apps/desktop/internal/tracks/*` (+testdata), matcher from the teleprompter PRD, `AudiobookEstimatePanel.tsx`, `contracts/manuscript.ts`, `docs/utilities/tracks.md` | `teleprompter-manuscript-integration.prd.md` Phase 8 (same parser and matcher): land theirs first |
| 9 | analyzer files, settings, findings view | Phase 4 |
| 10 | `integrations/reaper/narration_ui_bridge.lua` (dispatch chain at `:523-552`), `apps/desktop/internal/bridge`, new Lua file | Every Lua-touching PRD: `reaper-automation-follow-through.prd.md`, `take-review-pickups-duplicates-take-intelligence.prd.md`, `teleprompter-manuscript-integration.prd.md` Phases 11-12; bridge event single-consumer issue (`transcript/service.go:282-296`) |
| 11 | Lua, analyzers, Go | Phase 10 |

Cross-cutting: `docs/roadmap.md` and `config/roadmap.json` are edited by every PRD that changes milestone state; ADR numbers (the next free number at merge time; 0027 at `d5cc994`) and the host API version are the two merge-time serialization points (whichever PR lands second increments again; check `hostAPIVersion` at merge time).

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Where measurement runs | Go package reading WAV directly (prior decision, ADR 0025) | Python sidecar; REAPER `CalculateNormalization` | Works standalone; no third runtime; REAPER has no noise-floor API |
| Distributor profiles | None ship until independently specified and validated (prior decision, ADR 0025, roadmap) | Ship ACX numbers now | Published guidance disagrees; avoids a false compliance claim |
| Unmeasurable values | `null`, never a fabricated number (prior decision, ADR 0025) | 0 or -Inf | A missing measurement must not read as a pass |
| Audio is never auto-edited (prior decision) | Findings only; approve-to-apply, undoable, item/take parameters | Auto-clean | Product boundary |
| Findings format first (prior decision, roadmap dependency rules) | Every analyzer emits `apps/desktop/internal/findings` before a bespoke UI | Bespoke result types | One contract for the dashboard |
| Silence/level logic shared (prior decision, utility docs) | One detector set used by diagnostics, cleanup and normalize | Per-tool detectors | Avoid drift |
| Lua-only REAPER work for now; manual REAPER verification (prior decision) | Phases 10-11 use Lua and the manual checklist | Native extension; web/OSC | Recorded scope call |
| Local-first, Windows-first, US-English-first (prior decision) | As stated | Cloud, cross-platform | Product boundary |
| Real progress only (prior decision, ADR 0015) | Progress from bytes read | Placeholder progress | Honest UI |
| Project scan reads the `.rpp` directly (prior decision, `tracks.md`) | Static parser, works with REAPER closed; extend it for chapter matching and measured duration | A new REAPER bridge action to enumerate tracks and items | Standalone launch has no bridge; the parser already exists |
| Scan is read-only; low-confidence matches are surfaced (prior decision, superseded DAW Project Scan brief) | Ambiguous or renamed tracks are flagged with a manual override, never silently assumed | Silent best-guess mapping | A wrong chapter mapping would silently corrupt progress figures |
| Profile source (proposed) | Layered `Delivery` settings, no defaults | Profile files; built-in presets | Matches settings layering and the no-preset rule |
| First measurement scope (proposed) | Rendered WAV files | REAPER items | Standalone, no item mapping needed |
| Finding-ID vs audio change (proposed) | Fingerprint in evidence, stable ID | Fingerprint in ID | Keeps dismissals auditable |
| Report format (proposed) | Self-contained HTML plus JSON, redaction on by default | Markdown-only; zip package | Reviewer without the app |
| Workflow (prior decision, CLAUDE.md) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup | Fast check only | History of silent regressions |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |

## Research Summary

**Market Context**
- Narrators today combine REAPER plus SWS loudness analysis (`NF_AnalyzeTakeLoudness`), free web checkers (one author states accuracy is not guaranteed), Audacity's analyzers, and manual notes; no public ACX-check ReaScript was found (inferred from absence in search results). Closest commercial reference for post-record technical proofing is PromptVO, whose DAW mechanism is undocumented. All per `docs/research/reaper-automation-surface.md` sections 5.3, 7; secondary sources.
- Published ACX numbers exist (RMS, peak, noise floor, MP3 bitrate) but third-party guidance disagrees on room tone, which is the stated reason for deferral.

**Technical Context**
- Reused, verified: `apps/desktop/internal/measure` (BS.1770-4 K-weighting with gating, polyphase true peak, quietest-window noise floor), `apps/desktop/internal/findings`, the layered settings store, the job and binding patterns, the `tracks` parser and `/media` route, the visual suite and atlas.
- New and unverified: EBU test-set tolerances and terms (TBD - needs research); an MP3 decoder option (TBD - needs research); persisted Transcript Compare word timing (TBD - needs research); muted-item handling in the `.rpp` parser (TBD - needs research); the accuracy of the source-to-project time mapping for trimmed, stretched and reversed items (per docs, inference).
- Discrepancies found while writing this PRD are listed in the hand-off message.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
