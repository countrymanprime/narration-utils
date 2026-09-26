# Editing Readiness Analysis

**Source:** New work; nothing is superseded. It draws on `docs/utilities/silence-cleanup.md` (planned brief, as of d5cc994, removed when `diagnostics-delivery-and-cleanup-tools.prd.md` lands), the findings contract, and the PRDs on PR #44. Sibling PRDs (written in parallel; file names only): `chapter-stage-recommendations.prd.md` (prefix SR, umbrella: owns the signal contract and the recommendation engine), `analysis-evidence-ledger.prd.md` (EL: parser extension, fingerprint, ledger, cache, confirmed track mapping), `recording-coverage-analysis.prd.md` (RC), `proofing-readiness-signals.prd.md` (PS); and existing PRDs `diagnostics-delivery-and-cleanup-tools.prd.md` (no prefix stated in its header; written `DX` here), `review-dashboard-and-findings-adoption.prd.md` (RD), `teleprompter-manuscript-integration.prd.md` (TM), `reaper-automation-follow-through.prd.md` (RF). In Depends columns this PRD's own phases are bare numbers and other PRDs' phases are `<PREFIX>-n`. Phase numbers for EL, SR and PS were not fixed when this was written, so those Depends cells name the capability in parentheses after the prefix, to be replaced with numbers.

Citations are `file:line` on `main` at d5cc994 (worktree branch `claude/track-completion-recommendations-b69f51`) for anything checked in code; "per docs" marks a claim taken from a document and not verified; "TBD - needs <what>" marks an unknown. Cross-cutting decisions D1 to D12 come from the shared brief for this PRD set; each is applied in the table under Technical Approach. Draft ADRs 0027-0035 exist only on PR #44 and are named as "draft ADR n (PR #44)".

## Problem Statement

A narrator decides that a chapter is "edited" by ear and then changes its status by hand. Nothing in the app can say whether the common editing chores are still outstanding: dead air left between phrases, mouth clicks, loud breaths. The chore list is machine-checkable in principle, but no detector exists, nothing records that a check ran, and a clean result is indistinguishable from a check that never ran. The product wants to suggest "editing looks done" and let the narrator confirm. A wrong suggestion is costly in one direction: telling a narrator that editing is finished while a breath or click is still in the file hides real work until proofing or delivery. So the analysis must prefer to say "unknown" or "not done" whenever it cannot be sure.

## Evidence

Verified in code (main at d5cc994):

- **No detector exists for the three chores.** `docs/utilities/silence-cleanup.md` is spec only ("Status: Planned", as of d5cc994). The only audio analysis is `apps/desktop/internal/measure`: `Analyze(io.Reader)` returns whole-file integrated LUFS, RMS, sample peak, true peak, noise floor and digital-silent window count (`measure.go:32-52`). The noise floor is the quietest non-silent 500 ms window (`measure.go:26`, `:137-186`). There is no range, no windowed series, no cancellation and no progress hook. No Go file outside the package imports `internal/measure` (repo grep).
- **WAV only, and RIFF only.** `readFmtChunk` accepts mono or stereo PCM/float and refuses everything else (`wav.go:170-180`). The header check requires `RIFF`/`WAVE` (`wav.go:85`), so an `RF64` file (needed once a single WAV exceeds what 32-bit chunk sizes can express) is refused; how often narrators reach that size is TBD - needs corpus data. `tracks` accepts MP3, FLAC, OGG, AIFF and WavPack sources (`apps/desktop/internal/tracks/parse.go:16`), so analysis of items will meet formats `measure` cannot read.
- **Clean is indistinguishable from never ran.** `Evaluate` returns an empty slice for a compliant report (`profile.go:42-64`), and an unmeasurable limited metric becomes an `info` finding with `evidence["available"]=false` (`profile.go:90-95`). Findings carry `Source.File` only (`profile.go:106`).
- **The findings record already fits.** Categories `audio_quality` and `silence_cleanup` exist (`findings.go:35,37`). `Source` holds file and track, item and take GUIDs (`:78-83`). `TimeRange` is documented as project seconds (`:85-89`), while the contract says "source-relative offsets when applicable" (`docs/architecture/findings-contract.md`, `time_range` row). `Manuscript.ChapterID` exists (`:91-96`), `SuggestedAction` is a proposal with `RequiresConfirmation` (`:98-104`), review states are `unreviewed | accepted | dismissed | deferred` (`:59-66`), and `Confidence` is a non-nullable float with a required reason (`:122`, `:142-145`). There is no store, no supersession, no evidence version, and nothing populates track or chapter attribution (see `review-dashboard-and-findings-adoption.prd.md` Phase 1).
- **The `.rpp` reader cannot scope analysis to what is heard.** `parseItem` reads `POSITION`, `LENGTH`, `NAME` and the first `<SOURCE>` (`parse.go:68-96`); `Item` has no GUID, source offset, playrate, mute or take list (`tracks.go:18-26`). A `SECTION` source is unwrapped to the inner file and the section's own offsets are dropped (`parse.go:77-84`). The only fixture (`apps/desktop/internal/tracks/testdata/basic.rpp`, 48 lines) has an item `GUID` at line 12 that the parser ignores, and no `SOFFS`, `PLAYRATE`, mute, take or FX line. Dead air trimmed out of an item stays in the source file, so whole-file analysis would keep reporting it, and an edit cannot be detected from the source file's hash. Multi-take, section and FX samples: TBD - needs a REAPER-saved project from the user.
- **In-app playback would refuse some analyzed sources.** `authorizedMediaPath` allows only each item's first `<SOURCE>` (`apps/desktop/media.go:51-64`); an active take that is not the first take is refused.
- **Existing timing proxies are the wrong tool.** `PAUSE_GAP_SECONDS = 0.6` (`compare.py:64`) splits sentences from ASR word gaps (`:358`), `_boundary_gap_seconds` labels marker confidence (`:1001-1014`), and `vad_filter=True` is a transcription pre-filter (`:513`). They measure gaps between recognized words, not silence in the audio, and none is exported.
- **The only range decoder is unsuitable for click detection.** `decode_segment` decodes a source range through PyAV to mono float32 at 16 kHz (`compare.py:386-441`, `SAMPLE_RATE` at `:63`; `av==18.1.0` at `pyproject.toml:6`), seeking to the nearest keyframe (`:391-395`). A 16 kHz mono stream cannot hold content above 8 kHz and mixes channels, so it is a transcription feed, not an editing-analysis feed (reasoning, not measured).
- **Settings hold strings only.** `fieldSchemas` knows the kinds `choice` and `color` (`apps/desktop/app.go:672-679`, validation `:718-724`), and the project sidecar is `<project>/narration-utils/settings.json` (`apps/desktop/internal/settings/store.go:135-140`). `diagnostics-delivery-and-cleanup-tools.prd.md` Phase 2 adds a numeric kind; this PRD depends on it.

Planned by other PRDs and depended on, not duplicated (per PR #44 documents, not code): DX Phase 1 (measurement job, sample-range entry point, progress, fingerprint helper), DX Phase 2 (numeric settings, analyzer thresholds), DX Phase 4 (windowed analyzers including a silence map), DX Phase 9 (`silence_cleanup` findings classifying silence, breath and click, thresholds set by the narrator, findings view only), RD Phase 1 (findings store, `evidence_version`, merge on re-run), TM Phase 8 (Go track-to-chapter matcher). This PRD adds what none of them owns: played-range scoping, the per-item cache and ledger records for these analyzers, validation of the click and breath heuristics, and the editing-complete rule.

Per docs (not verified in code): REAPER can apply take and track FX (action 40209, `docs/research/reaper-automation-surface.md:64`) and ships a Repair Pops/Clicks dialog since 7.80 (`:219`), so the audio a narrator hears can differ from the source file. Published guidance on ACX room-tone length disagrees between sources (`:202`), which is why no head or tail rule is baked in. Third-party REAPER script sets already detect and reduce breaths and clicks (`:229`, no licence declared: learn, do not copy; `:236` Magnolius is GPL-3.0). Praat is GPL-3.0-or-later, so any use stays a separate executable (`docs/research/local-dependency-evaluation.md:309-312`). Silero VAD yields speech regions and cannot tell a breath from other non-speech sound (`local-dependency-evaluation.md:318`, and its "What VAD cannot do" paragraph).

Assumption - needs validation: that a narrator's own notion of "done editing" can be approximated by three detectors with narrator-set thresholds, and that the residual review cost (dismissing false candidates) is acceptable. No labeled audio exists in the repo. Method: Phase 1 corpus plus a timed dogfood on the same chapters.

## Proposed Solution

Add a read-only editing scan for one chapter's track. It decodes only the played range of each unmuted audio item, measures three classes of editing chore once per item (empty space to trim, clicks, breaths), and caches the measurements keyed by what the audio is, so editing one item re-analyzes only that item. Every scan writes ledger records, so "clean" means "a complete scan at the current state found nothing", never "no scan". A cheap evaluation step applies the narrator's policy (maximum gap, optional head and tail limits) to the cached measurements and composes empty space across item boundaries and timeline gaps. The result is three tri-state signals, `editing.empty_space`, `editing.clicks` and `editing.breaths`, in the shape defined by `chapter-stage-recommendations.prd.md`: `met` only when the scan is complete and current for every played range and no open candidate remains, `not_met` when candidates remain, `unknown` for everything else. The narrator sees the remaining candidates with a way to hear each one, fixes them in REAPER, saves, and re-checks. The app never edits audio and never changes the chapter status; suggesting "ready for proofing" and confirming it belong to the SR engine and the narrator.

## Key Hypothesis

We believe that scanning the played range of a chapter's items for empty space, clicks and breaths, with staleness tracked per item and unknown treated as not done, will let a narrator learn whether editing chores remain without listening back through the chapter, for narrators who edit in REAPER and save the project. We'll know we're right when, on the annotated corpus, (a) every class reaches the proposed recall target (Success Metrics), (b) no chapter is recommended editing-complete while a labeled task remains, (c) after any edit type the signal is never `met` on stale evidence, and (d) narrators on 3-5 permissioned chapters accept the residual review cost (baseline TBD - needs the dogfood).

## What We're NOT Building

| Item | Why |
| --- | --- |
| Any change to audio, items or chapter status | Recorded rule: suggestions only; draft ADR 0031 (PR #44) and `docs/roadmap.md:10` |
| Automatic trimming, breath removal, de-clicking, noise reduction | Product boundary; those are edits, not analysis. REAPER's own tools stay the narrator's |
| REAPER preview markers and approve-to-apply trims | Owned by DX Phase 10 (Lua, manual REAPER checklist). No new Lua in this PRD |
| Distributor head or tail room-tone rules | ACX sources conflict (`reaper-automation-surface.md:202`); ADR 0025 requires a cited spec first. A minimum room-tone length is a delivery check (DX, PS), not an editing chore |
| Judging performance, pacing quality or dramatic intent | Out of boundary (`docs/roadmap.md:10`). A long pause is reported against the narrator's threshold, never as a defect by default |
| Non-WAV decoding in this cycle | Such items report `unknown` with a reason (Q1). Decoder choice is a later phase |
| A second silence or level detector | DX Phases 4 and 9 own the detectors; this PRD scopes, caches, validates and rolls them up |
| A second chapter-to-track matcher, or a second store | The matcher is TM Phase 8; the confirmed mapping, ledger and cache are EL; findings are RD Phase 1 |
| Cloud analysis, PyTorch or Kaldi models | ADR 0008 and 0025: local, Go or the existing PyAV runtime only |
| Live tracking of unsaved REAPER edits | The saved `.rpp` is the basis (D6); a live change counter is at most an EL "Could" and needs Lua |
| Multi-track chapters | v1 is one track per chapter (D5) |
| Surround or more than two channels | `measure` refuses them (`wav.go:172-173`); such items are `unknown` |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Recall of labeled editing chores, per class (empty space, click, breath) | Proposed 90% or better for each class (assumption, calibrate on the corpus) | Phase 1 harness: labeled locations vs detector output within a labeled tolerance, on a held-out half never used for tuning |
| Precision per class | Reported, target TBD - set after the Phase 1 baseline | Same harness; also median dismissals per chapter, which feeds Q4 |
| False "done" | 0 chapters on the held-out set recommended `met` while a labeled chore remains | Run the signals on raw, partly edited and edited versions of the corpus chapters |
| Played-range correctness | 0 candidates inside dead air trimmed out of an item's played range | Go fixtures with `SOFFS` beyond the dead air |
| Unknown is never met | 100% of unmapped, never-run, stale, partial, failed, unsupported-format, missing-file, playrate-not-1 and unvalidated-detector inputs yield `unknown` | Table test over the signal function (Phase 6) |
| Edit sensitivity | After each edit type (split, trim head or tail, move, delete, mute, source replaced, rate change, item added, neighbor changed) the signal is never `met` from stale evidence, and after re-check reflects the new file | Table test (Phase 6) |
| Incremental re-check | Editing one item re-decodes only that item; unchanged items cost 0 decodes | Decode-counter test (Phase 5) |
| Policy change costs no decode | Changing maximum gap, head or tail limit re-evaluates with 0 decodes | Decode-counter test (Phase 3) |
| Reproducibility | Same audio, project and settings produce identical candidates and ids | Go test, run twice |
| Input never modified | 0 files change (SHA-256 before equals after) | Go test over analysis and job |
| Progress honesty | Monotonic, cache hits count as done, cancel yields a `partial` record (ADR 0015) | Go test like the install-job progress test |
| Analysis time per audio hour | TBD - baseline needed | Benchmark recorded in Phases 2 and 3 (DX Phase 1 benchmarks one hour of stereo audio) |
| Gate | `pnpm check` green each phase; new Go code at 80% coverage or better; UI states reviewed as PNG at four viewports | CI, `go test -cover`, `apps/ui/screenshots/app/<page>/<state>/<viewport>.png` |

## Open Questions

- [ ] **Q1. Where does decoding of non-WAV sources live?** Options: (A) WAV only in v1; other formats yield `unknown` with the reason "format not analyzable"; (B) a Go decoder for MP3 and FLAC (candidate libraries and licences: TBD - needs research); (C) a PyAV sidecar mode that decodes a source range at its native rate and channel layout to a temporary WAV, then Go analyzes it (PyAV is already a pinned dependency, `pyproject.toml:6`; `decode_segment` at `compare.py:386-441` is the pattern but resamples to 16 kHz mono). Recommendation: A for v1, spike C after Phase 4. It keeps analysis standalone in Go (ADR 0025) and never guesses on a format it cannot read; C reuses a runtime the product already ships. Temporary file size for hour-long items is TBD - needs measurement.
- [ ] **Q2. What is the default maximum gap for "empty space to trim"?** Options: (A) no built-in value: the empty-space signal is `unknown` with the reason "no maximum gap set" until the narrator sets one in Editing settings; (B) a built-in default calibrated on the corpus (value TBD); (C) derive a starting value from the chapter's own pause distribution. Recommendation: A for the first release, B once the Phase 1 corpus supports a defensible number. No number in the repo has a cited source, a too-large default causes false "done", a too-small one makes "done" unreachable, and dramatic pauses differ by book. The evidence always states the value in use.
- [ ] **Q3. Is there a head and tail rule?** Options: (A) none by default; the narrator may set a maximum leading silence and a maximum trailing silence, and unset means "head and tail not checked" (stated in the evidence); (B) ship ACX-derived numbers; (C) also require a minimum room-tone length. Recommendation: A. ACX guidance conflicts (`reaper-automation-surface.md:202`), and a minimum room-tone length is a delivery check owned by DX and PS, not an editing chore.
- [ ] **Q4. Do low-confidence candidates block "done"?** Options: (A) every open candidate blocks, whatever its confidence, and the narrator's dismissal is the exit; (B) only candidates at or above a confidence threshold block, the rest are advisory; (C) decided per class. Recommendation: A. A false "done" is worse than a false "not done", and a dismissal is remembered (Q7), so a false candidate is paid for once. Revisit with the Phase 1 dismissals-per-chapter figure if "done" proves unreachable.
- [ ] **Q5. Which of the three signals are required, by default?** ER emits three signals; which are required is SR's per-project required-check selection. Options: (A) all three required by default; (B) empty space only until click and breath detectors are validated; (C) the narrator chooses at first check. Recommendation: A, because it matches the product definition, plus a gate: a class signal can be `met` only for an analyzer version recorded as validated on the corpus (Phase 4), otherwise `unknown` with the reason "detector not yet validated". A narrator who deselects breaths in SR can still get an empty-space and click recommendation.
- [ ] **Q6. Rendered chapter WAV or items: which counts?** Options: (A) items on the chapter's track only; (B) the narrator chooses per chapter, default items, and the evidence names which was analyzed; (C) the render wins when one is associated. Recommendation: A in the MVP, B in Phase 8. Editing happens on items; a render is normally made afterwards, so using it as the primary evidence for "editing done" is circular, and automatic precedence would hide which audio was checked. Render analysis also bypasses take FX and played-range problems, so it is useful as an explicit second source. The chapter-to-render association is owned by `proofing-readiness-signals.prd.md`.
- [ ] **Q7. How do dismissals survive edits and re-scans?** This covers intentional dramatic pauses and the fingerprint interaction. Options: (A) `evidence_version` includes analysis parameters, so any threshold change resets every dismissal; (B) `evidence_version` is a hash of the local audio evidence only (source identity, class, source-relative range, a content hash of the region and its margin, and for composed empty space the parts' source ranges plus gap length), excluding parameters, played range and item position; candidate ids are inherited from the previous run by source-range overlap before the RD-1 merge; (C) dismissals are never remembered. Recommendation: B. A narrator who marks a pause intentional should not lose that when tuning sensitivity or trimming elsewhere, but must be asked again when the audio at that spot or the composed pause actually changes. Needs agreement with RD Phase 1 (merge keys by id and version).
- [ ] **Q8. Is the silence floor absolute or relative?** Options: (A) an absolute dBFS value; (B) relative to the chapter's measured noise floor (`measure.go:137-186` style); (C) both, narrator picks. Recommendation: B by default, decided with DX Phases 2 and 4, which own the silence map. Item gain, different microphones and rooms shift absolute levels (item gain is not applied to source analysis), so a relative floor is more robust; calibrate on the corpus.
- [ ] **Q9. Where does the narrator start a check?** Options: (A) an action in SR's evidence popover and on the Tracks page, opening a slide-over panel; (B) a new page and nav entry; (C) the Proofing page. Recommendation: A. A nav entry regenerates every doc screenshot (see DX Phase 5 notes) and editing is not a proofing task. Analysis is never started in the background: it is heavy and its result is only meaningful for the saved project.
- [ ] **Q10. Where does the annotated corpus come from?** Options: (A) the user's own permissioned chapters plus at least one other narrator and room; (B) synthetic audio only; (C) A plus public-domain volunteer recordings (licensing and availability of raw takes: TBD - needs a check). Recommendation: A, with synthetic generators for unit tests only. Synthetic breaths and clicks are not a validation. Audio stays outside the repo.

## Users & Context

**Primary User**

- **Who**: A narrator, often also the editor, who edits chapters in REAPER on Windows and saves the project between passes.
- **Current behavior**: Listens through, trims dead air, hunts clicks and breaths by ear or with REAPER's own repair tools, and sets the chapter status by hand.
- **Trigger**: An editing pass on a chapter feels finished, or the narrator wants to know what is left before moving on.
- **Success state**: The app lists exactly which chores remain, says how old and how complete that answer is, and suggests "ready for proofing" only when nothing remains and every part was checked.

**Job to Be Done**: When I finish an editing pass, I want to know whether any trimming, click or breath chore is left in this chapter, so that I can move on to proofing without listening back through it.

**Non-Users**: Narrators wanting automatic cleanup; reviewers receiving reports (owned by DX Phase 7); anyone who edits in a DAW other than REAPER (Audacity deferred).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Played-range scoped analysis of unmuted audio items on the chapter's confirmed track; anything unanalyzable is typed and becomes `unknown` | 2 |
| Must | Empty-space candidates: silence runs longer than the narrator's maximum gap, composed across item edges and timeline gaps; optional head and tail limits | 3 |
| Must | Click and breath candidates from DX Phase 9's detectors, validated on the annotated corpus before they may report `met` | 1, 4 |
| Must | Ledger records and per-item cache per class; scan job with real progress and cancel | 5 |
| Must | Three tri-state signals with evidence, basis and reasons; `unknown` never `met`; stale never `met` | 6 |
| Must | Label "analysis of source audio; take FX, item gain and fades not applied" on every result | 2, 6, 7 |
| Should | Candidate panel: time range, class, confidence and reason, hear it in the app, dismiss, accept or defer | 7 |
| Should | Policy (maximum gap, head and tail limits) applied on read, so changing it never re-decodes | 3 |
| Should | Dismissals that survive threshold changes and unrelated edits (Q7) | 5 |
| Should | Presence of take or track FX chains shown as evidence (needs the parser extension, EL) | 2 |
| Could | Go to the candidate in REAPER through RD Phase 7's navigation | 7 |
| Could | Rendered chapter WAV as an explicit second source (Q6) | 8 |
| Could | Gain-adjusted thresholds; playrate other than 1; pre-labeling from raw versus edited project pairs | later |
| Won't | See What We're NOT Building | - |

### MVP Scope

Phases 1, 2, 3, 5 and 6 with the empty-space class end to end, then Phase 4 for clicks and breaths, then Phase 7 for the panel. Until Phase 4 validates the click and breath detectors, their signals are `unknown`; a narrator who deselects them in SR can already get an empty-space recommendation. Phase 8 is optional.

### User Flow

1. The narrator edits a chapter in REAPER and saves. On Home, a chapter in `editing` shows the editing signals as `unknown` ("never checked").
2. The narrator opens the editing check from the evidence popover. If the track mapping is unconfirmed, EL's confirm step comes first; an unconfirmed fuzzy match is never used.
3. The check runs as a job with real progress and a cancel button. Cached items finish immediately.
4. The panel shows, per class, the state, the maximum gap and thresholds in use, how many items and how much audio were checked, the basis ("saved project, file modified <time>"), and the caveat about source audio. Remaining candidates list a time range, class, confidence and reason. The narrator hears each one, dismisses those that are intentional, or fixes them in REAPER.
5. After fixing, the narrator saves and re-checks. Only changed items are decoded. Edits made without saving are not visible; the panel says so.
6. When every required signal is `met`, SR suggests advancing to proofing with this evidence; the narrator confirms in SR.

## Technical Approach

**Feasibility**: MEDIUM. Decoding, composition and the signal rule are Go with generated fixtures (HIGH). Whether the click and breath heuristics reach a usable precision and recall is unproven and gated on the corpus (MEDIUM-LOW). The played-range model depends on parser fields not yet verified against a REAPER-saved project (MEDIUM).

**Architecture Notes**

- **Audio source and played range (D6).** A Go package (proposed `apps/desktop/internal/editing`) turns each parsed item into an analysis source: file, played range `[SOFFS, SOFFS + LENGTH * PLAYRATE]`, and a typed state. Muted items and non-audio items (for example MIDI) are excluded from the analysis, not refused. Every other item that cannot be analyzed gets a stable typed reason, and each reason becomes `unknown`: PLAYRATE other than 1, reversed sources, stretch markers, `SECTION` sources until their offsets are verified (`parse.go:77-84` drops them), non-WAV formats (Q1), files the reader refuses (`wav.go:85`), more than two channels (`wav.go:172-173`), missing files. The fields needed to detect these (stretch markers, reverse, section offsets, mute, FX-chain presence) need a REAPER-saved fixture (TBD) and are requested as part of EL's parser phase; if EL does not carry them, Phase 2 adds them and coordinates the collision. Decoding streams blocks at the native sample rate, per channel, without loading the file, with context cancellation and progress from DX Phase 1's range entry point. Detection runs per channel and reports the union.
- **Scan measures, evaluation decides.** The expensive scan stores measurements only: all silence runs above DX Phase 2's minimum silence length (relative to the played range), and click and breath candidates with scores. The cheap evaluation step applies policy on read: maximum gap, head and tail limits, and, if Phase 4 finds scores separate cleanly, sensitivity. Changing policy therefore re-evaluates without decoding. Evaluation is pure and deterministic and runs wherever a result is needed (SR, the panel); its findings are persisted to the RD store at scan end and when the narrator changes a policy value, never as a side effect of a read. Decisions are looked up by candidate id and `evidence_version`.
- **Empty space is the complement of speech-bearing audio.** For each analyzed item, the speech-bearing intervals are the played range minus its silence runs, mapped to timeline time. The union across unmuted items on the track is the audible content; every complement interval inside the chapter span is empty space. This handles a tail plus a timeline gap plus a head that together exceed the maximum although each is below it, overlapping or crossfaded items, and gaps left after trimming. Head and tail are the complement before the first and after the last audible interval. A candidate records its parts (item tail, gap, item head) and the item GUIDs.
- **Ledger and cache (D7, D8; EL owns the stores).** One decode pass over an item writes three records, `editing.silence`, `editing.click` and `editing.breath`, each with analyzer version, parameter hash, scope, outcome `complete | partial | failed`, and counts, so a class can go stale alone when its detector version changes. Cache entries are keyed by source identity, played range, analyzer version and parameter hash. Requirement on EL: expose two keys, an analysis key (what the audio content is: source identity, played range, playrate) and the full item fingerprint (adds position, mute, active take). A position-only move must be a cache hit that recomposes, not a re-decode. A trim changes the played range, so its features must be sliceable from the source's already-computed values or cost one re-decode of that item: whether the cache stores per-source features or per-range results is EL's decision, ER requires that trimming one item does not force a re-decode of unrelated items and measures the cost in Phase 5.
- **Signal rule (D2).** For each class over the relevant items (unmuted audio items on the chapter's confirmed track): `not_met` when any open candidate exists in a current-fingerprint result (open per D9: `unreviewed`, `deferred`, `accepted`; `dismissed` is not open); else `unknown` when anything is not covered (chapter unmapped or mapping unconfirmed, an item never analyzed, stale, partial, failed or unsupported, required policy unset, detector version not validated, analysis key unavailable); else `met`. Stale results never count as current and never produce `not_met` either; the evidence says how many candidates were open at the last check. `accepted` candidates stay open until a re-scan at a new fingerprint no longer produces them. Basis: ledger record ids, the chapter's item-fingerprint hash, and the saved project's file modified time.
- **Candidate identity and dismissal (Q7).** Candidate ids and `evidence_version` follow Q7 option B and are agreed with RD Phase 1. `confidence` is an uncalibrated detector score mapped to 0..1 with a reason saying so, until RD Q3's nullable confidence lands.
- **Findings shape.** `silence_cleanup` for all three classes, with `evidence.class` of `silence`, `click` or `breath`, matching DX Phase 9's classification. `source` carries item and take GUIDs and file, `time_range` is project seconds in the saved project plus the source-relative range in `evidence`, `manuscript.chapter_id` is filled from the confirmed mapping, and `suggested_action` is the DX Phase 9 trim or split proposal with `requires_confirmation: true`, parameters only.
- **Processed-audio caveat.** Analysis reads source files. Take and track FX, item and take gain, fades and REAPER's repair tools are not applied, so an FX gate can make source dead air irrelevant and a de-clicker can make a source click moot. Every result carries the label "analysis of source audio; take FX, gain and fades not applied", plus the names of any FX chains found in the project once the parser reads them. The narrator's remedy for persistent false candidates is dismissal or, later, the rendered-file source (Q6).
- **Settings (D10).** The numeric kind and analyzer thresholds come from DX Phase 2. This PRD adds an `Editing` section: `max_gap_seconds`, `head_max_seconds`, `tail_max_seconds`, unset by default (Q2, Q3). Silence floor, minimum silence length and click and breath sensitivity are DX Phase 2 and Phase 9 settings with defaults calibrated in Phase 4.
- **Host and UI.** Job pattern and real progress as in DX Phase 1 (`app.go:56-65,727-830` per DX); service pointers snapshotted under `h.mu.RLock` (`h.services()`, see `docs/architecture/host-binding-concurrency.md`); bindings for start, state, cancel and candidates; host API bump in `apps/desktop/app.go`, `apps/desktop/app_test.go`, `apps/ui/src/hostApi.ts` plus regenerated `apps/ui/wailsjs/go/main/Host.{js,d.ts}`. UI is a `SlideOver` panel launched from SR's surfaces; new visible states get rows in `apps/ui/tests/visual/state-catalog.ts` and drivers in `app.drivers.ts`, and any new primitive gets a story and atlas pass. In-app audition uses `/media` (ADR 0012) at the candidate's source offset with pre-roll, which needs EL's `/media` change for takes that are not first.
- **No Lua.** Everything computes from the saved `.rpp` and audio files, so the feature works with REAPER closed. Navigation into REAPER is only the optional reuse of RD Phases 6 and 7.

**Cross-cutting decisions as applied**

| Decision | Here |
| --- | --- |
| D1 computed, never applied | Signals computed on read from ledger, cache and decisions; only SR's Confirm changes status; dismissal remembered against its basis (Q7) |
| D2 tri-state | Three signals; rule above; `unknown` for every uncovered case |
| D3 stage mapping | Evaluated only while status is `editing`; recommends `proofing`; no new enum value |
| D4 confirmation record | Consumed from SR, not built here |
| D5 mapping is an input | Needs EL's confirmed `trackGuid -> chapterId`; an unconfirmed fuzzy match is `unknown` |
| D6 fingerprint and played range | Core of Phase 2; saved-project basis shown on every result |
| D7 ledger | Three records per item per pass; `met` needs a complete current record |
| D8 per-item cache | Requirement on EL keys; measured in Phase 5 |
| D9 open semantics | Adopted as written; `accepted` stays open; recorded in the findings contract by whichever phase lands first |
| D10 settings | `Editing` section on DX Phase 2's numeric kind; policy values unset by default |
| D11 recordedFraction | Not applicable (RC) |
| D12 corpus first | Phase 1; no threshold is a fact before Phase 4 |

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A false "done" hides real breaths or clicks | Medium | Tri-state rule, all open candidates block (Q4), validated-detector gate (Q5), corpus false-"done" metric of 0, unknown on anything unanalyzable |
| Heuristics mislabel dramatic pauses, breaths after plosives, soft onsets or mouth clicks in speech | High | Candidates only, narrator thresholds, dismissal that survives edits (Q7), corpus fixtures for each case, ambiguous stays in review |
| Source analysis disagrees with what is heard (take FX, gain, fades, de-clickers, stretch markers) | High | Label on every result, refuse items with unsupported processing, FX presence as evidence, rendered-file source later (Q6) |
| Saved `.rpp` lags the open project | High | Basis "saved project, file modified <time>" on every result; the panel says unsaved edits are not seen (general REAPER behavior; no repo doc states it, TBD - confirm with a REAPER-saved fixture pair) |
| Parser fields (SOFFS, PLAYRATE, SECTION offsets, mute, stretch, FX) serialize differently than assumed | Medium | REAPER-saved fixtures from the user (TBD); until verified, affected items are `unsupported` and give `unknown` |
| Hour-long items are slow or memory-heavy | Medium | Stream decode, cancel, real progress, per-item cache, benchmark in Phases 2-3 |
| Click detection needs full-bandwidth samples; compressed sources lose or smear them | Medium | WAV only in v1 (Q1); never reuse the 16 kHz transcription feed |
| Composed silence across items is wrong for overlaps, muted items, crossfades | Medium | Interval-complement model with fixtures for each |
| Cache invalidated by position moves, or stale after a neighbor edit | Medium | Two keys required of EL; composition on read; edit-type table test |
| Corpus is small or unrepresentative (one mic, one room) | High | At least two narrators or rooms (Q10); held-out split; targets stay proposals; results labeled by conditions |
| Detector precision too low, so "done" is unreachable | Medium | Q4 revisit with dismissals-per-chapter; per-class deselect in SR; ship a class as `unknown` rather than unvalidated |
| Collisions on `measure`, `parse.go`, `app.go` fieldSchemas, host API version | High | See Parallel-session compatibility |

## Implementation Phases

Every phase follows the `CLAUDE.md` workflow: find or open the tracking issue first (`gh issue list`) and put `Closes #<n>` in the PR (`docs/operations/github-workflow.md`), `change-impact-scan` for shared files, TDD, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard` for primitives or `styles.css`, `feature-cleanup`. Phases that change bindings bump `hostAPIVersion` in `apps/desktop/app.go`, `apps/desktop/app_test.go` and `apps/ui/src/hostApi.ts` (whichever PR lands second increments again; check at merge time) and regenerate the Wails bindings. Phases that change `apps/ui` add state-catalog rows and drivers, run the Playwright visual suite and review every PNG at `desktop`, `small-desktop`, `tablet` and `mobile`, and refresh doc screenshots. No phase touches `integrations/reaper`. Take the next free ADR number at merge time (0027 at d5cc994; PR #44 uses 0027-0035); write ADRs with `adr-author` after code lands.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Editing corpus and evaluation harness | Labeling format, permissioned corpus outside the repo, synthetic generators, per-class recall and precision harness with held-out split, baseline note; no product code | pending | 2 | - (soft: DX-4, DX-9 to score) | - |
| 2 | Audio source and played-range scoping | Played range from parsed items, typed refusals, streaming native-rate decode with cancel and progress, FX-presence evidence | complete | 1 | DX-1, EL-1, EL-2 | - |
| 3 | Empty-space analysis | Per-item silence runs cached, ledger record, timeline composition, maximum gap and head or tail policy on read, `silence_cleanup` findings, `Editing` settings | complete | 4 | 2, DX-2, DX-4, EL-3, EL-4 | - |
| 4 | Click and breath validation | Run DX-9 detectors on the corpus, tune, record results, validated-version gate, ledger and cache records for both classes | pending | 3 | 1, 2, DX-9 | - |
| 5 | Editing check job and bindings | Chapter to track to items, cache-first scan, three ledger records per item, one job with progress and cancel, findings persisted, bindings, host API bump | complete | - | 3, EL-5, RD-1; also 4 for the click and breath classes | - |
| 6 | Editing signals for SR | Three signals per SR's contract, evidence and basis, edit-type table tests, wiring into SR's engine | complete | 7 | 5, SR-1 | - |
| 7 | Editing check panel | Slide-over with run, progress, per-class candidates, hear, dismiss, accept, defer, optional Go to in REAPER, states, docs, screenshots | pending | 6 | 5, RD-4, SR-5, EL-7 | - |
| 8 | Rendered chapter WAV source (Could) | Whole-file source for a narrator-picked render, per-chapter choice, labeled evidence | pending | - | 5, 6, PS-4 | - |

### Phase Details

**Phase 1 - Editing corpus and evaluation harness**
- **Goal**: Replace guessed thresholds with measured ones (D12).
- **Scope**: A labeling format (CSV: source file identity, start, end, class among `silence_to_trim`, `click`, `breath`, `keep_pause`, `keep_breath`, note) with negative labels for intentional pauses and kept breaths; a sample plan of 3-5 permissioned chapters from at least two narrators or rooms with at least 25 labeled locations per class (proposed, assumption); raw and edited versions of the same chapters where available, since the cuts in the edited project mark what an editor removed; audio stays outside the repo and tests read a directory named by an environment variable, while labels and code-generated synthetic signals (known silence lengths, impulses at known positions) are committed; a Go harness computing per-class recall, precision and a sensitivity sweep on a tuning half and a held-out half; a note under `docs/research/` with conditions and baseline numbers.
- **Success signal**: The harness runs on DX Phase 4's silence map (or a stub) and prints a per-class table; labels validate against the format; synthetic unit tests pass; corpus size and conditions recorded.

**Phase 2 - Audio source and played-range scoping**
- **Goal**: Analyze exactly what is heard, and say so when that is not possible.
- **Scope**: `apps/desktop/internal/editing` source type built from the extended parse (EL); played range per D6; typed refusal reasons listed above; streaming decode of a range at native rate per channel through DX Phase 1's range entry point, with context cancellation and byte progress; FX-chain presence carried as evidence when the parser exposes it; generated WAV fixtures; no UI, no binding.
- **Success signal**: A fixture with dead air before `SOFFS` reports nothing for that dead air; a range decode equals the slice of a whole decode; every refusal reason has a test and a stable `unknown` reason string; input hashes unchanged.

**Phase 3 - Empty-space analysis**
- **Goal**: Empty-space candidates and their signal input, end to end without UI.
- **Scope**: Consume DX Phase 4's silence map over played ranges; store per-item runs in EL's cache with an `editing.silence` ledger record; interval-complement composition across unmuted items; maximum gap, head and tail policy on read; `silence_cleanup` findings (`class: silence`) with parts, GUIDs, project-time range and a parameters-only trim proposal; `Editing` settings section on DX Phase 2's numeric kind, unset by default; candidate ids per Q7.
- **Success signal**: Fixtures for a gap between items, tail plus gap plus head composed above the maximum while each part is below it, overlapping items, a muted item, head and tail limits on and off; changing the maximum gap re-evaluates with 0 decodes; deterministic output.

**Phase 4 - Click and breath validation**
- **Goal**: Know how good the click and breath heuristics actually are before they may say `met`.
- **Scope**: Run DX Phase 9's detectors on the tuning half, choose conservative defaults, report precision and recall on the held-out half per class and condition, add fixtures for each failure found (breath after a plosive, click inside silence, soft onset, plosive versus click); decide whether sensitivity is a read-time filter or an analysis parameter; per-item cache and ledger records `editing.click` and `editing.breath`; a recorded set of validated analyzer versions, so any other version yields `unknown`; research note under `docs/research/`. If a class misses the proposed target it ships gated off (`unknown`), not tuned to pass.
- **Success signal**: Held-out results recorded next to the proposed targets; the gate demonstrably turns a signal to `unknown` for an unvalidated version; no threshold documented as fact without the run behind it.

**Phase 5 - Editing check job and bindings**
- **Goal**: A narrator-triggered scan that is incremental, honest and cancellable.
- **Scope**: Service resolving chapter to confirmed track to items (an unconfirmed mapping refuses to start and reports why); cache lookup per item, decode only misses in one pass writing the three ledger records; outcomes `complete | partial | failed` per item, with cancel producing `partial` and one failed item not aborting the rest; progress as audio processed over audio needed with cache hits counted done; evaluation persisted to the RD store at scan end; one job at a time; bindings for start, state, cancel and candidates; TS contract, mock, wailsClient adapter and test; host API bump. The `resetDerived` entry for the ledger belongs to EL; the findings directory to RD-1.
- **Success signal**: Cache hit costs 0 decodes; trimming one item re-decodes only that item's changes; cancel writes `partial` and the signal reads `unknown`; monotonic progress; no input file modified; the measured cost of a trim recorded (feeds EL's cache design).

**Phase 6 - Editing signals for SR**
- **Goal**: The editing stage plugs into SR's engine without rework.
- **Scope**: A pure function from parsed project, mapping, ledger, cache, policy and decisions to three `Signal` values (`id`, `stage`, `state`, `reason`, typed `evidence[]`, `basis`, `computedAt`) per the SR contract; evidence lists the policy in use, coverage (items and audio checked), the caveat label, and the remaining candidates with time range, class, confidence and reason; precedence as in the signal rule; registration in SR's engine. Table tests over every edit type, policy change and decision state.
- **Success signal**: The table in Success Metrics passes; a property test finds no path from unknown or stale input to `met`; reasons are short human strings SR can show as is.

**Phase 7 - Editing check panel**
- **Goal**: The narrator can run the check and act on the remaining candidates.
- **Scope**: A `SlideOver` panel opened from SR's evidence popover and the Tracks page: run and cancel with progress; per-class summary; candidate rows (time range, class, confidence, reason) with a hear control through `/media` at the source offset plus pre-roll, dismiss, accept and defer through RD-4 bindings, and Go to in REAPER through RD Phase 7 when the bridge is present; states (never checked, running, partial, complete with candidates, complete and clean, stale, unmapped, unsupported items, settings unset); the source-audio caveat wording; a guide page or section listed in `docs/guides/using-the-app/README.md` (breadcrumb and footers enforced by `apps/ui/src/docsGuide.test.ts`); catalog rows, drivers, doc screenshots, stories for any new primitive.
- **Success signal**: All states reviewed as PNGs at four viewports with no sideways overflow; atlas green if a primitive changed; hear works in the desktop app (the browser mock plays silence, `docs/utilities/tracks.md`).

**Phase 8 - Rendered chapter WAV source (Could)**
- **Goal**: Let the narrator check a render, without letting it silently replace the item check.
- **Scope**: An analysis source for a whole WAV (no played range, no composition); ledger scope is the file fingerprint; the chapter-to-render association and its fingerprint come from PS; a per-chapter choice of which source counts (Q6); evidence says "rendered file: FX and edits included".
- **Success signal**: A render with a known click reports it; switching the chosen source changes the signal and the evidence names the source; a render older than the last item edit is stale.

### Parallelism Notes

Phases 1 and 2 are independent. Phase 3 needs 2; Phase 4 needs 1 and 2 and can run beside 3 if the silence code and the detector code stay in separate files. Phase 5 needs 3 and, for full value, 4. Phases 6 and 7 can run in parallel once 5 lands, since 6 is pure Go and 7 is UI over the bindings. Phase 8 waits on PS.

### Parallel-session compatibility

| Phase | Files touched | Who else collides |
| --- | --- | --- |
| 1 | `docs/research/` (new note), test-only harness and labels under `apps/desktop/internal/editing/` | None expected; corpus permissions and storage outside the repo |
| 2 | New `apps/desktop/internal/editing/*`; `apps/desktop/internal/measure/*` range API; `apps/desktop/internal/tracks/*` only if EL leaves out the extra fields | DX-1 (range API, agree it once), EL parser phase and TM-8 (same parse functions) |
| 3 | `apps/desktop/internal/editing/*`, `apps/desktop/app.go` `fieldSchemas`, `config/defaults.json`, `Settings.tsx`, `ScopedSetting.tsx`, `mockFixtures.ts` | DX-2 and DX-4 (settings map and silence map), teleprompter settings PRD (same `fieldSchemas`) |
| 4 | `apps/desktop/internal/measure/*` or the detector package, harness, research note | DX-9 owns the detectors; agree who edits them |
| 5 | `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/*}`, `apps/ui/wailsjs/go/main/Host.*`, findings store use | Every phase that adds a binding: host API version is the merge-time serialization point; RD-1 store API; EL ledger API |
| 6 | New `apps/desktop/internal/editing/signals*`, SR engine registration | SR engine phase; RC and PS register their signals in the same place |
| 7 | New `components/editing/*`, SR Home and popover files, `tests/visual/{state-catalog.ts,app.drivers.ts,doc-screenshots.json}`, `docs/images/ui/*`, `docs/guides/using-the-app/*` | SR Home UI phase, RD-5 Review page, any nav or screenshot regeneration |
| 8 | New source implementation, per-chapter choice UI | PS render association phase |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| The app suggests, the narrator confirms (prior decision, user; draft ADR 0031 (PR #44)) | No audio or status change from analysis | Auto-advance | Recorded rule |
| No new Lua in this PRD (prior decision, user) | Compute from the saved `.rpp` plus audio; works with REAPER closed | Live REAPER queries | REAPER work is Lua-only for now, verified by hand later |
| Product boundary (prior decision, `docs/roadmap.md:10`) | No automatic edit, no acting judgment, no cloud | - | Recorded |
| Real progress only (prior decision, [ADR 0015](../adr/0015-real-progress-only.md)) | Progress from audio processed; cache hits count as done | Placeholder progress | Honest UI |
| Measurement in Go, WAV only, no fabricated values (prior decision, [ADR 0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md)) | Reuse the Go reader; unreadable formats are `unknown` | Python sidecar | Standalone, no third runtime |
| No distributor profile without a cited spec (prior decision, ADR 0025) | No head or tail numbers shipped | ACX numbers | Sources conflict |
| Signals are tri-state and unknown is never met (D2) | Applied to all three classes | Boolean | A false "done" is worse than a false "not done" |
| Played range, not whole file (D6) | Analyze `[SOFFS, SOFFS + LENGTH * PLAYRATE]` | Whole-file analysis | Trimmed dead air would keep being reported |
| Open finding semantics (D9) | `accepted` stays open until a re-scan clears it | Accepted means resolved | Accepting says "real", not "fixed" |
| Empty space defined as the complement of audible content (proposed) | Interval union across unmuted items | Per-item silence only | Catches tail plus gap plus head and overlaps |
| Scan measures, evaluation decides policy (proposed) | Store measurements; apply maximum gap and limits on read | Bake policy into the scan | Changing a setting must not re-decode hours of audio |
| Detector versions gated by corpus validation (proposed, Q5) | Unvalidated version yields `unknown` | Ship and tune later | D12 and the false-"done" asymmetry |
| All open candidates block, regardless of confidence (proposed, Q4) | Dismissal is the exit | Confidence threshold | Asymmetry |
| No maximum-gap default until calibrated (proposed, Q2) | `unknown` until set | Arbitrary default | No cited source for a number |
| Dismissals anchored to local audio evidence (proposed, Q7) | Version excludes parameters and item position | Parameters in the version | Do not lose decisions when tuning |
| Rendered file is an explicit second source, not a replacement (proposed, Q6) | Narrator chooses per chapter | Render wins | Editing precedes rendering |
| Check starts only on narrator action (proposed, Q9) | No background analysis | Automatic | Heavy, and meaningful only for the saved project |
| Workflow (prior decision, `CLAUDE.md`) | Plan, impact scan, TDD, `pnpm check`, spec guard, cleanup | Fast check only | History of silent regressions |

## Research Summary

**Market Context** (per `docs/research/reaper-automation-surface.md`, secondary sources, not re-verified): narrators already have repair tools for these chores: REAPER's Repair Pops/Clicks dialog (7.80, `:219`), a community script set with breath and click detect and reduce (`:229`, no licence declared), and Magnolius offline de-click and mouth-noise repair (`:236`, GPL-3.0). The research ranks "cleanup launchers" as an opportunity (`:272`). None of the listed tools is described as reporting whether such chores remain across a chapter; that is inference from the doc's tool table, not a market survey.

**Technical Context**: Reused and verified: the Go WAV reader and noise-floor meter (`apps/desktop/internal/measure`), the findings record and its categories, the layered settings store, the `tracks` parser and `/media` route, the job and binding patterns, PyAV as an existing pinned runtime. Planned elsewhere and depended on: DX Phases 1, 2, 4 and 9, RD Phases 1, 4 and 7, TM Phase 8, EL, SR. New and unverified: the parser fields for `SOFFS`, `PLAYRATE`, `SECTION`, mute, stretch markers and FX chains as REAPER writes them (TBD - needs REAPER-saved fixtures); click and breath detector precision and recall (TBD - needs the Phase 1 corpus); analysis throughput on hour-long items (TBD - needs the Phase 2 and 3 benchmark); decoder options for MP3 and FLAC (TBD - needs research); whether raw takes from public-domain recordings are available for the corpus (TBD - needs a licensing check).

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
