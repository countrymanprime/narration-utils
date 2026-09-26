# Proofing Preview Suggestion

**Source:** user request of 2026-09-20: "a proofing tool that can suggest a 5 min preview based on the manuscript and possibly audio quality and performance". New work (nothing to supersede). Citations are `file:line` on `main` at 6c037d3f for anything checked in code; "per PRD" marks a claim taken from a sibling PRD and not re-verified. In Depends columns this PRD's own phases are bare numbers and other PRDs' phases are `<PREFIX>-n`. Siblings (file names only): `analysis-evidence-ledger.prd.md` (EL, fingerprints, ledger, confirmed chapter-to-track mapping), `recording-coverage-analysis.prd.md` (RC), `proofing-readiness-signals.prd.md` (PS, "is this chapter proofed", same Proofing page), `chapter-stage-recommendations.prd.md` (SR, decisions D1-D12 cited below as "SR D#"), `diagnostics-delivery-and-cleanup-tools.prd.md` (DX, windowed analyzers), `take-review-pickups-duplicates-take-intelligence.prd.md` (TR), `review-dashboard-and-findings-adoption.prd.md` (RD, findings store), `character-continuity-review.prd.md` (CC), `proofing-vocabulary-hints.prd.md` (VH). This PRD is unscheduled on the roadmap like the stage-recommendation set ([implementation plan](implementation-plan.md) D9): no edits to `docs/roadmap.md`, the roadmap JSON or milestones.

## Problem Statement

A narrator, proofer or author who wants to judge an audiobook without listening to all of it has to pick a stretch by hand. Home says how long proofing will take ("Est. proof time" is one times the finished length, `AudiobookEstimatePanel.tsx:75`) but nothing says where to listen first. A good five minutes is not arbitrary: it should be self-contained, show the range of the book (narration and dialogue, more than one character, the hard words) and, once audio exists, be a stretch that is fully recorded, free of known problems and technically clean. Choosing it means scanning the manuscript and remembering what was flagged elsewhere. The narrator asked for a suggestion, not automation, in line with the rest of the proofing tools: the tool proposes a window with its reasons and the narrator decides.

## Evidence

Verified in code:

- **The manuscript is paragraph-addressable with cheap features.** A chapter has `wordCount`, `contentKind` (`narration | opening | reference`) and ordered `paragraphIds`; a paragraph has `text`, optional formatting `spans` and `entityIds` (`apps/ui/src/api/contracts/manuscript.ts:1-28`). Word counts and paragraph order are enough to slide a window and hit a target length.
- **Duration is only estimated.** `WORDS_PER_FINISHED_HOUR = 9300` (about 155 words a minute) is a fixed rule of thumb (`apps/ui/src/state.ts:88-91`), so five minutes is about 775 words. No per-narrator pace exists. `recordedFraction` on a chapter is optional (`contracts/manuscript.ts:9`); RC owns filling it (per PRD).
- **There is no dialogue or speaker notion in the manuscript model.** `apps/desktop/internal/manuscript` has no match for `dialogue` or `quote`. Character presence exists only as Story Bible entity ids per paragraph (`contracts/manuscript.ts:27`); dialogue cues are CC's planned work (its Q5, per PRD).
- **Hard-word candidates exist.** `guide.VocabularyCandidates` reads `vocabulary_candidates` from the guide or derives names from entities (`apps/desktop/internal/guide/service.go:207-263`, per the VH PRD; not re-read here).
- **Whole-file measurements only.** `measure.Report` holds duration, integrated LUFS, RMS, sample and true peak and one noise floor per file (`apps/desktop/internal/measure/measure.go:32-49`); WAV only. There is no windowed series, clipping count or silence map (DX-4 plans them, per PRD).
- **The findings contract already names the categories a window would care about** (`pronunciation`, `pickup`, `duplicate_read`, `pacing`, `audio_quality`, `level_consistency`, `character_continuity`, `transcript_discrepancy`; `apps/desktop/internal/findings/findings.go:24-47`), but nothing emits most of them yet (`docs/architecture/findings-contract.md:3`, per PS).
- **No paragraph-to-audio-time mapping exists.** Transcript Compare rows carry a chapter title, not paragraphs; word timing is not persisted (TR-3); the Lua bridge can stamp and read manuscript line ids on items (`docs/architecture/manuscript-line-identity.md:15-16`, `stamp_item_lines` and `read_line_ids`), but no Go consumer maps a paragraph to a time range. The chapter-to-track mapping is EL's (EL-5, per PRD).
- **The Proofing page today is the compare flow only**: `apps/ui/src/components/proofing/{Transcript,Results,InlineDiffRow,options}`.
- **No preview, sample or audition feature exists** in the app or its docs (a search of `docs/` outside `prds/` finds only unrelated "audition" text about take comparison, `docs/roadmap.md:30`).

Assumptions - need validation: (1) that "preview" means a contiguous excerpt of about five minutes that the narrator listens to or shares, not a rendered audio file the app cuts. Method: ask the user; Q1 and Q11 record it. (2) That narrators pick previews by text (variety, self-containment) before they check audio. Method: watch a pick on 3-5 permissioned books. (3) That a fixed 155 wpm estimate lands within a tolerable error of real recordings. Method: compare on the `Challenges_001` media (implementation-plan D19); TBD - needs measurement.

## Proposed Solution

Compute, on read, up to three ranked five-minute candidates from the imported manuscript, each a run of whole consecutive paragraphs, and show each with the reasons it was chosen and any warnings. Two layers:

1. **Text layer (always available, MVP).** Slide a window over eligible paragraphs sized to the target length (default 5:00) by the text duration model. Score it on deterministic, explainable features: starts and ends on paragraph boundaries; mixes narration and dialogue (a precision-first quote heuristic); number of distinct Story Bible entities present; density of hard words; not front matter, reference or the tail of the book. Same manuscript, same settings, same output.
2. **Audio layer (optional, only where evidence exists).** When a chapter has a confirmed track (EL), is fully recorded (RC) and its analysis is current at the item fingerprint (EL), overlay measurable audio-quality and performance evidence on each candidate: open pickups, discrepancies, duplicate reads and pronunciation findings inside the window; clipping, silence and noise-floor findings and level stability from the windowed analyzers; pace against the manuscript. Windows with an open finding are excluded or ranked down (Q7); anything unknown is shown as unknown. A candidate is labelled "audio-checked" only when every audio signal it needs is current; otherwise it is "text only".

The output is a suggestion with evidence, never a grade or a claim that the audio is good. "Performance" means measurable pace and findings only; acting and interpretation are out (product boundary, `docs/roadmap.md:10`, per PS). Nothing is applied to the manuscript, project or audio (SR D1, draft ADR 0031, PR #44).

## Key Hypothesis

We believe a deterministic, explainable five-minute suggestion built from the manuscript, and tightened by audio evidence where it exists, will let narrators pick a preview in seconds instead of scanning the book, for narrators with an imported manuscript. We'll know we're right when (a) on 3-5 permissioned books the narrator's own blind pick appears in the top three, or a suggestion is accepted after an adjustment of a few paragraphs, at a rate the pass reports (baseline TBD - needs research), (b) no candidate is ever labelled "audio-checked" with a stale, unmapped, partial or unavailable signal (target 0), and (c) every candidate's reasons and warnings can be read without opening another tool.

## What We're NOT Building

| Item | Why |
| --- | --- |
| Automatic selection, export or upload of a preview, or any change to status, audio or manuscript | Suggestions only, the narrator decides (SR D1; draft ADR 0031) |
| Cutting, rendering or bouncing the five minutes to a file | Product boundary: the DAW renders and edits; the app measures and suggests (`docs/roadmap.md:10`, per PS). A REAPER region or marker is a Could that needs Lua (RF) |
| A quality grade, "audition ready", or any claim about a distributor's rules | ADR 0025; no distributor profile ships |
| Judging acting, interpretation or "performance quality" | Product boundary; "performance" here is measurable pace and findings only |
| Automatic dialogue attribution or speaker identification | CC owns it and its stance is precision-first; the quote heuristic only detects that quotation exists |
| Detecting pickups, clipping, noise or pronunciation problems | Owned by TR, DX-4, RD and the sibling analyzers; this PRD only reads their findings |
| New measurement jobs, or starting any analysis on read | Evaluation reads the store, ledger and file stats; the narrator starts analyses (PS rule; ADR 0015) |
| Recommending that a chapter stage is done | Owned by SR and PS; a preview is not a stage signal |
| Non-US-English tuning; macOS and Linux | Windows-first, US-English-first |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Determinism | 100%: identical inputs give byte-identical candidates, ties broken by chapter then paragraph index | Go table and property tests |
| Length accuracy | Every candidate within the tolerance of the text-model estimate for the target (Q2), except when the eligible text is too short (a named state) | Fixtures: 200, 20,000 and 120,000-word manuscripts, single-paragraph chapters, very long paragraphs |
| Eligibility | 0 candidates that include `reference` or `opening` content (default) or cross a chapter boundary (default, Q3) | Table tests over content kinds |
| False "audio-checked" | 0 candidates labelled audio-checked while a needed signal is stale, unmapped, partial, failed or unavailable | Matrix tests over signal state (Phases 5-7) |
| Open findings in a suggested window | 0 open findings inside an audio-checked Sample candidate (Q7) | Fixture with findings at known paragraphs |
| Estimate error against real recordings | Reported, not gated (TBD - needs measurement on the `Challenges_001` corpus) | Phase 6 comparison of text estimate to recorded seconds |
| Narrator agreement | Reported, not gated (TBD - baseline needed) | Dogfood on 3-5 permissioned books |
| Compute cost | TBD - baseline needs measurement; linear in paragraphs | Benchmark on a 1,000-paragraph fixture recorded in the PR |
| Gate | `pnpm check` green each phase; visual suite reviewed at the viewports in `apps/ui/tests/visual/viewports.ts` for UI phases | CI and PNG review |

## Open Questions

- [ ] **Q1. What is the preview for?** Options: (A) a representative sample to share (author review, audition, retail): best-sounding, most varied, near the start; (B) a proofing spot-check: the riskiest stretch, so the narrator finds systemic problems early; (C) both, one engine with two presets that differ only in weights and gates. The two pull in opposite directions on audio evidence (A prefers clean audio, B prefers where problems are likely or unchecked). Recommendation: C, default "Sample" because the request names audio quality and performance as selection inputs, "Spot-check" when the narrator picks it. **This is the question that most changes the design; the request reads either way.**
- [ ] **Q2. How is five minutes measured, and how strict is it?** Options: (A) fixed 9,300 words per finished hour (about 775 words), tolerance plus or minus 10% (TBD - needs measurement of estimate error); (B) the narrator's own pace, calibrated from recorded chapters once RC or DX-8 supplies recorded seconds per chapter; (C) A now, B when data exists. Recommendation: C. A matches the rest of the app; B removes the fixed-rate error once real durations exist. Target and tolerance are settings (SR D10), default 5:00.
- [ ] **Q3. Must a candidate stay inside one chapter?** Options: (A) yes; (B) may cross a chapter boundary; (C) inside one chapter unless a chapter is shorter than the target. Recommendation: A for the MVP. Audio for a chapter is one track and one render (SR D5) and a crossing breaks the mapping and any fingerprint; C is a Could.
- [ ] **Q4. Which content is eligible?** Options: (A) `narration` only; (B) `narration` plus `opening`; (C) A, but also exclude the last N% of the book (spoilers). Recommendation: A, with ending exclusion as a setting that defaults to off (previewing the ending is the narrator's call). `opening` (credits, dedication) is rarely representative. Manuscripts imported before structural classification have no `contentKind` (`contentKind?`); treat missing as `narration` and say so in the evidence.
- [ ] **Q5. How is "dialogue" detected?** Options: (A) a text heuristic over paired straight and curly double quotes, precision-first, used only to score the narration-versus-dialogue mix; (B) wait for CC's dialogue cues; (C) A now, B replaces it. Recommendation: C. A is enough to prefer a mixed passage; B is the right source of "speaking characters" and must not block this. Other languages and single-quote or dash dialogue styles are out of scope and score as no dialogue.
- [ ] **Q6. What counts as audio quality and performance?** Options: (A) only measurable things: clipping, silence and dead air, noise floor, short-term level stability (DX-4), open pickup, discrepancy, duplicate-read and pronunciation findings (TR, RD), pace against the manuscript; (B) A plus character-continuity flags (CC); (C) A plus anything a future analyzer emits. Recommendation: B, as those analyzers produce findings. Acting quality is excluded by the product boundary.
- [ ] **Q7. Are audio findings hard gates or soft scores?** Options: (A) an open finding inside a window excludes it; (B) findings only lower the rank and are listed; (C) A for `transcript_discrepancy`, `pickup`, `duplicate_read`, `pronunciation` and `audio_quality` at severity warning or above, B for the rest. Recommendation: C for Sample (a shareable excerpt should have none) and B for Spot-check (a finding is a reason to listen). Dismissed findings do not count (PS Q2: open = unreviewed, deferred, accepted).
- [ ] **Q8. How does a paragraph get an audio time range?** Options: (A) persisted word timing (TR-3) aligned to paragraphs; (B) the line stamps in the project (`stamp_item_lines`, `read_line_ids`) read from the saved `.rpp` and mapped to paragraphs; (C) a coarse per-chapter pace only (chapter recorded seconds over chapter words), no per-window audio evidence. Recommendation: C first, A or B when a spike proves one. C lets pace be evidence per chapter but never claims the window itself is clean. A and B need REAPER-saved fixtures with stamped or multi-take items (TBD - needs the user). This is Phase 6's spike.
- [ ] **Q9. Is the narrator's chosen or adjusted window stored?** Options: (A) never, always recomputed; (B) a pin per book that survives recomputation, keyed by paragraph ids; (C) B plus a note. Recommendation: B. A pin is the narrator's own decision, not a computed verdict, stored in a sidecar like the reader bookmarks and cleared by `resetDerived` because chapter and paragraph ids reset on re-import (`apps/desktop/internal/manuscript/service.go:434-441`, per PS). If the manuscript text under a pin changes, the pin shows as stale.
- [ ] **Q10. Where does it live?** Options: (A) a panel on the Proofing page; (B) a new nav item; (C) A plus a jump from the reader. Recommendation: A. Every nav addition regenerates all doc screenshots and must land serially (README cross-PRD sequencing); PS Phase 6 and SR Phase 8 also edit the Proofing page, so agree panel order at planning. C is a Could.
- [ ] **Q11. What can the narrator do with a candidate?** Options: (A) open it in the manuscript reader and copy its paragraph range and estimated length; (B) A plus "mark in REAPER" (a region over the mapped items; new Lua, RF); (C) A plus export the excerpt text. Recommendation: A for the MVP; B is a Could after the Lua harness and command registry (RF phases 3-4); C is a Could.
- [ ] **Q12. Whole book or per chapter, and how many candidates?** Options: (A) top three across the book, at most one per chapter; (B) top three overall, several from one chapter allowed; (C) A plus a per-chapter view. Recommendation: A, so the three are different stretches; C is a Could.
- [ ] **Q13. When audio exists for only part of the book, are text-only and audio-checked candidates mixed?** Options: (A) yes, each labelled; (B) only audio-checked ones when any exist; (C) two lists. Recommendation: A for Spot-check; B for Sample when at least one audio-checked candidate exists, so a shareable suggestion is never a text-only guess.

## Users & Context

**Primary User**

- **Who**: A solo author-narrator recording and proofing their own book in REAPER on Windows, with an imported manuscript and a Story Bible; sometimes sharing an excerpt with an author or proofer.
- **Current behavior**: Scrolls the manuscript, remembers where the dialogue and hard words are, and checks audio in another tool.
- **Trigger**: A chapter or the book is recorded enough to listen, or the narrator needs a short excerpt to hand to someone.
- **Success state**: The narrator sees three candidate stretches, each with a one-line reason and any warning, opens one in the reader, and knows how long it runs.

**Job to Be Done**: When I need a short stretch of the book to listen to or share, I want a suggested five minutes that represents the book and is free of known problems, so that I do not scan the whole manuscript or the audio to find one.

**Non-Users**: Reviewers who want certification; narrators without an imported manuscript; anyone expecting the app to cut or publish the audio.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Notes |
| --- | --- | --- |
| Must | Window engine over whole paragraphs with a target length, tolerance, eligibility rules and deterministic ranking | Phase 1 |
| Must | Explainable text features; per-candidate reasons and warnings | Phase 1 |
| Must | Binding, contract and mock; Proofing page panel showing candidates, length, reasons; open in reader; copy range | Phases 2-3 |
| Must | Named states: no manuscript, no eligible text, text shorter than the target, computing | Phase 3 |
| Should | Settings for target, tolerance, preset and ending exclusion | Phase 4 |
| Should | Overlay of open findings (TR, RD, CC) by paragraph | Phase 5 |
| Should | Audio-checked label from current, mapped, recorded evidence with windowed analyzers; pace as evidence | Phases 6-7 |
| Should | Narrator pin and adjustment with stale detection | Phase 8 |
| Could | Pace calibrated from the narrator's recorded chapters (Q2 B) | After RC or DX-8 |
| Could | REAPER region over the mapped items; text export; per-chapter view; jump from the reader | After RF phases 3-4 |
| Won't | Auto-select, auto-export, render or upload, quality grade, acting judgment | See table above |

### MVP Scope

Phases 1 to 3, with Phase 4's target setting if it is cheap: the manuscript-only suggestion with evidence, on the Proofing page. Phases 5 to 8 are Should and ship as their inputs (findings store, EL mapping, RC, DX-4) exist.

### User Flow

1. The narrator opens the Proofing page. The Preview panel lists up to three candidates (at most one per chapter): chapter, paragraph range, estimated length, word count and reasons ("dialogue between two characters", "starts at a paragraph boundary", "no open findings in this range").
2. A candidate with a warning shows it in text and an icon ("text only: this chapter's audio is not mapped", "unknown: recording coverage not checked"), never by colour alone.
3. The narrator opens a candidate in the manuscript reader, reads it, and copies the range and length.
4. When audio evidence is current the candidate says "audio-checked" and lists what was checked and when; otherwise it says "text only".
5. The narrator can pin a window or move its edges by paragraphs; the panel recomputes the length and evidence for the adjusted range (Phase 8).
6. If the manuscript, findings or audio change, the next read recomputes; a pin whose text changed shows as stale. Nothing changes without the narrator.

## Technical Approach

**Feasibility**: HIGH for the text layer (pure Go over data that exists, table-tested). MEDIUM for the findings overlay (depends on RD-1 and on findings carrying a paragraph anchor). LOW-MEDIUM for the audio layer: it needs EL mapping and fingerprints, RC coverage, DX-4 windowed analyzers and a paragraph-to-time mapper that does not exist. No Lua and no Python change in the MVP.

**Cross-cutting decisions as they apply here**

| Decision | Applies as |
| --- | --- |
| SR D1 Computed, never applied | Candidates computed on read; only a narrator pin is stored |
| SR D2 Tri-state | Each audio signal is met, not met or unknown; unknown never counts as good and blocks the "audio-checked" label |
| SR D5 Mapping is an input | Audio evidence uses EL's confirmed track-to-chapter map; a fuzzy match is unknown |
| SR D6, D7 Fingerprint, ledger | A candidate's audio evidence is current only at EL's fingerprint with a complete ledger record; basis reads "saved project, file modified <time>" |
| SR D10 Settings | Target, tolerance, preset and exclusions are settings; no shipped distributor profile |
| Implementation plan D19 | Thresholds and pace calibration are validated only on the `Challenges_001` media and synthetic fixtures (probably one narrator and one room); evidence says so |

**Architecture Notes**

- **Pure engine.** A new Go package (proposed `apps/desktop/internal/preview`, name at planning) takes the reader's chapters and paragraphs, the guide's entities and vocabulary candidates, settings, and optional finding and analysis providers as small read-only interfaces. Prefix sums over paragraph words make each window's length O(1), so a scan is linear in paragraphs. The engine has no I/O and no clock.
- **Scoring.** Hard rules first (eligible content kind, chapter boundary, length within tolerance, paragraph boundaries), then a weighted sum of named features with fixed weights per preset. Each feature returns its value and a human reason; the reasons are the evidence. Weights are constants documented in the package until real feedback exists (TBD); nothing is learned.
- **Quote heuristic.** Paired double quotes across straight and curly forms, counted per paragraph; a dialogue share of the window inside a band scores best. No speaker attribution.
- **Providers for the audio layer.** Findings by range (RD-1), ledger record and staleness for a chapter (EL), recording coverage (RC), windowed analyzer findings (DX-4), pace (chapter words over recorded seconds), a paragraph-to-time mapper (Phase 6). Each provider answers `met`, `not_met` or `unknown` with a reason and action; the engine composes them. Evaluation is a read and starts no analysis.
- **Host surface.** One read binding for candidates, later bindings for pin and clear. Host API version bumps in `apps/desktop/app.go`, `apps/desktop/app_test.go` and `apps/ui/src/hostApi.ts`, and `Host.{js,d.ts}` is regenerated (take the next number at merge). Bindings read services through `h.services()` and add a row to `stressReaders` in `hostrace_test.go` ([host binding concurrency](../architecture/host-binding-concurrency.md)). The wire contract gets a Zod schema behind `parseWire` (implementation plan D16).
- **UI.** A `Panel` on the Proofing page with the existing `table.dtable` style; state shown as text plus icon, never colour alone; reuse SR's evidence popover if it exists by then. New primitives, if any, need stories and atlas coverage. New states get `state-catalog.ts` rows and drivers in `app.drivers.ts`, `doc-screenshots.json`, and `docs/guides/using-the-app/proofing.md` updates (`visual-catalog-sync`, `doc-screenshot-sync`; `apps/ui/src/docsGuide.test.ts` guards the guide).
- **ADR.** After code lands, use `adr-author` for the preview definition (eligibility, the audio-checked rule, findings gating). Take the next free number at merge time.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| The request is interpreted wrongly (sample versus spot-check) | Medium | Q1 first; one engine, presets differ only in weights and gates |
| Text-only picks feel arbitrary | Medium | Every score component names its reason; the narrator can adjust (Phase 8); agreement measured on 3-5 books |
| The fixed pace misjudges length | Medium | Tolerance setting; calibration from recorded chapters (Q2); estimate error reported |
| A candidate looks audio-clean but its evidence is stale or partial | Medium | Tri-state, currency rules, label discipline with target 0 |
| The quote heuristic mislabels styles (single quotes, dash dialogue, non-English) | High | Precision-first, treated as a weak feature; unsupported styles score as no dialogue; documented |
| Paragraph-to-audio mapping has no reliable source yet | High | Q8 spike; ship pace-only evidence until a mapper is proven; never claim per-window audio quality without it |
| Manuscripts imported before structural classification have no `contentKind` | Medium | Treat as narration and say so; suggest re-import in the evidence text |
| Very long paragraphs or one-paragraph chapters cannot hit the target | Medium | Named states (shorter than target, single paragraph); never split a paragraph |
| Merge collisions: Proofing page, `app.go` host API, `fieldSchemas`, `resetDerived`, state catalog | High | See Parallel-session compatibility |

## Implementation Phases

Every phase follows the `CLAUDE.md` workflow: plan (find or open the tracking issue first and put `Closes #<n>` in the PR, `docs/operations/github-workflow.md`), `change-impact-scan` (this PRD reads `manuscript`, `guide` and `findings` and touches shared UI on the Proofing page), TDD, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard` when `primitives/` or `styles.css` change, `feature-cleanup`. Coverage follows the ratchet on logic directories with an 80% floor for a new logic directory (implementation plan D18). UI phases run the Playwright visual suite for the Proofing page and view every PNG at each viewport in `apps/ui/tests/visual/viewports.ts`, plus the atlas when a primitive changes. Phases that change bindings bump the host API version in the three places and regenerate `Host.{js,d.ts}`. There is no Lua in this PRD, so no manual REAPER checklist; the user supplies REAPER-saved fixtures (TBD) for Phase 6.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Window engine and text scoring | Pure Go package: eligibility, length model, prefix-sum windows, features, ranking, reasons, tie-breaks; table and property tests | complete | - | - | - |
| 2 | Binding, contract and mock | Read binding for candidates, TypeScript contract with Zod schema, mock fixtures for every state, host API bump, `stressReaders` row | pending | - | 1 | - |
| 3 | Proofing page Preview panel | Panel, candidate rows, reasons and warnings, open in reader, copy range, named states; catalog rows and drivers, docs, screenshots | pending | 4 | 2 | - |
| 4 | Preview settings | Target length, tolerance, preset, ending exclusion in Settings; defaults; validation | pending | 3 | 1, DX-2 (numeric settings kind) | - |
| 5 | Findings overlay | Exclude or rank down windows overlapping open findings by paragraph; open-finding evidence; dismissed ignored | pending | 6 | 2, RD-1, TR-4 | - |
| 6 | Audio position mapper (spike, then build) | Paragraph-to-time mapping for a confirmed, recorded chapter, or the decision to ship pace-only; REAPER-saved fixtures | pending | 5 | EL-5, RC, TR-3 or the stamp reader | - |
| 7 | Audio quality and performance signals | Windowed clipping, silence, noise and level evidence per candidate; pace evidence; "audio-checked" label rule; matrix tests | pending | - | 5, 6, DX-4, EL-6 | - |
| 8 | Pin, adjust and close-out | Narrator pin and edge adjustment, stale detection, `resetDerived` entry, docs, ADR, cleanup | pending | - | 3 (7 optional) | - |

### Phase Details

**Phase 1 - Window engine and text scoring**
- **Goal**: A tested, deterministic answer to "which five minutes" from the manuscript alone.
- **Scope**: New Go package; inputs as read-only interfaces; eligible content kinds (Q4); text length model (Q2 option A) with tolerance; sliding window over whole paragraphs within one chapter (Q3); features: boundary quality, narration-and-dialogue mix (Q5 heuristic), entity variety, hard-word density, position; presets (Q1); ranking with one candidate per chapter (Q12); reasons and warnings; named outcomes for short or empty text; no I/O.
- **Success signal**: The length, eligibility and determinism metrics pass on fixtures; a manuscript with no dialogue, no entities and one chapter still returns a candidate with honest reasons; a property test shows equal inputs give equal output; coverage meets the ratchet.

**Phase 2 - Binding, contract and mock**
- **Goal**: The UI can read candidates in Wails and in mock mode.
- **Scope**: `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/contracts/*,api/wailsClient.ts,api/mockApi.ts,api/mockFixtures.ts}`, generated `Host.{js,d.ts}`; mock fixtures that drive every state deterministically.
- **Success signal**: Contract and mock tests pass; `hostguard_test.go` and the race test pass with the new row; host API bumped in all three places.

**Phase 3 - Proofing page Preview panel**
- **Goal**: The narrator sees and uses the suggestion.
- **Scope**: Panel on the Proofing page; states (default, computing, no manuscript, nothing eligible, shorter than target, warnings); open in reader, copy range and length; `state-catalog.ts` rows and `app.drivers.ts` drivers; `doc-screenshots.json`; `docs/guides/using-the-app/proofing.md`; PNG review at every viewport.
- **Success signal**: Every state reviewed as PNGs at each viewport with no sideways overflow; `pnpm check` and the visual suite green; the panel starts no analysis.

**Phase 4 - Preview settings**
- **Goal**: The narrator controls target, tolerance and preset.
- **Scope**: A settings tool with defaults (5:00, tolerance TBD, preset per Q1), validation and UI; the engine reads them.
- **Success signal**: Changing the target changes candidates deterministically; invalid values are rejected at the boundary.

**Phase 5 - Findings overlay**
- **Goal**: Do not suggest a window the tools already flagged.
- **Scope**: Findings-by-range provider over the RD-1 store; paragraph anchoring; the Q7 rule; evidence lists open findings per candidate; dismissed findings ignored; a finding without a paragraph anchor produces a chapter-level warning, not a silent pass.
- **Success signal**: A fixture with open, dismissed and unanchored findings gives the expected exclusions, ranks and warnings.

**Phase 6 - Audio position mapper (spike, then build)**
- **Goal**: Decide and build how a paragraph gets an audio time range, or decide to ship pace-only.
- **Scope**: Compare Q8 options A, B and C on REAPER-saved fixtures; record the result; build the chosen mapper against the EL confirmed mapping and fingerprint; measure text-estimate error against recorded seconds on the `Challenges_001` corpus.
- **Success signal**: A documented decision; a mapper (if built) that returns `unknown` for unmapped, stale or multi-take-ambiguous items; estimate error reported.

**Phase 7 - Audio quality and performance signals**
- **Goal**: Say which candidates are audio-checked and what was checked.
- **Scope**: Providers for DX-4 windowed findings, level stability, pace and RC coverage; tri-state composition; the audio-checked rule; evidence with basis and time; text-only otherwise.
- **Success signal**: The false "audio-checked" matrix is 0; unknown never counts as good; every warning names its reason and action.

**Phase 8 - Pin, adjust and close-out**
- **Goal**: Let the narrator settle on a window and keep it.
- **Scope**: Pin and edge adjustment by paragraph with recomputed length and evidence; sidecar store with atomic write and stale detection; `resetDerived` entry; docs (`proofing.md` and a steady-state architecture doc); ADR via `adr-author`; `feature-cleanup`.
- **Success signal**: A pin survives restart and recomputation; changed text under a pin shows stale; re-import clears the store; docs consistent.

### Parallelism Notes

Phase 1 stands alone. Phases 2 and 3 are sequential; Phase 4 runs beside Phase 3 once Phase 1 exists (it only needs the settings kind). Phases 5 and 6 are independent of each other and of the UI phases; Phase 7 needs both. The MVP (1 to 3) can ship without any sibling PRD; the rest waits for RD-1, EL, RC and DX-4.

### Parallel-session compatibility

| Phase | Files and areas touched | Who else collides |
| --- | --- | --- |
| 1 | New `apps/desktop/internal/preview/*` | None expected |
| 2 | `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/*}`, `Host.{js,d.ts}` | Every binding PR: the host API number is a merge-time serialization point (the later PR rebases and bumps again) |
| 3 | `apps/ui/src/components/proofing/*`, `apps/ui/tests/visual/{state-catalog.ts,app.spec.ts,app.drivers.ts,doc-screenshots.json}`, `docs/images/ui/*`, `docs/guides/using-the-app/proofing.md` | PS Phase 6 and SR Phase 8 (Proofing page panels), VH (`Transcript.tsx`), RD-2, TR; nav-changing PRs regenerate screenshots |
| 4 | `apps/desktop/app.go` (`fieldSchemas`), `config/defaults.json`, `apps/desktop/internal/settings/store.go`, `Settings.tsx`, `mockFixtures.ts` | DX-2 (numeric kind), SR Phase 6, the teleprompter settings phase |
| 5 | Preview package, findings provider | RD-1 store API, TR-4 finding shape |
| 6 | Preview package; EL's `tracks` parser if it needs fields; fixtures | EL Phase 1, TM Phase 8, TR Phase 2 (parser), RC; land after them or rebase |
| 7 | Preview package | DX-4 finding shape, EL staleness API |
| 8 | Preview package, `apps/desktop/internal/manuscript/service.go` (`resetDerived`, line 434), docs, ADR | RD-1, EL, SR and PS add to the same slice literal (textual conflicts); ADR numbering (check `docs/adr/` at merge) |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Suggestions only; the narrator decides (prior decision, user; SR D1) | Nothing is applied, exported or changed | Auto-export | Draft ADR 0031 (PR #44); consistent with the proofing tools |
| No new Lua in the MVP (prior decision, user; stage set) | The text layer needs none; REAPER regions are a Could | Region over mapped items now | Lua-only-for-now; the harness comes first (implementation plan D2) |
| Product boundary (prior decision) | No audio cutting, no acting judgment, no cloud | Render the excerpt | `docs/roadmap.md:10` (per PS) |
| No distributor profile (prior decision, ADR 0025) | No "audition ready" claim | Ship limits | ADR 0025 |
| Real progress and honest unknowns (prior decision, ADR 0015) | Unknown is shown, never good | Placeholder scores | ADR 0015 |
| Text layer first (proposed) | Manuscript-only MVP; audio evidence later | Wait for audio | Works today on data that exists; audio inputs are planned by siblings |
| Whole paragraphs inside one chapter (proposed, Q3) | Never split a paragraph or cross a chapter | Cross chapters | Keeps audio mapping and fingerprints valid |
| Deterministic explainable scoring (proposed) | Fixed named features and reasons | Learned or LLM ranking | Reproducible, testable, no cloud |
| One engine, two presets (proposed, Q1) | Sample and Spot-check differ by weights and gates | Two features | The request reads either way |
| Audio-checked is a strict label (proposed) | Only with every signal current | Soft indicator | A false "clean" is worse than "text only" (SR D2) |
| Workflow (prior decision, CLAUDE.md) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup | Fast check only | History of silent regressions |

## Research Summary

**Market Context**: Not researched for this PRD. Audiobook retail and audition samples and proofing services are known references, but no distributor guidance is cited here and none should be, per ADR 0025 (published guidance disagrees and no profile ships). Nothing in the repository's research establishes what narrators regard as a good preview; that is assumption 1 and Q1.

**Technical Context**: Reused and verified: the manuscript reader model (`contracts/manuscript.ts:1-28`), the fixed words-per-hour estimate (`state.ts:88-91`), whole-file measurements (`measure.go:32-49`), the findings categories (`findings.go:24-47`), the line-stamp commands (`manuscript-line-identity.md:15-16`), the Proofing page components and the host binding accessor pattern. Planned by siblings and consumed here: ledger, fingerprint and confirmed mapping (EL), recording coverage (RC), windowed analyzers (DX-4), the findings store (RD-1), pickup and duplicate findings and persisted word timing (TR), dialogue cues (CC), vocabulary candidates (VH). Unverified: whether findings carry a paragraph anchor for every category; how a saved `.rpp` serializes stamped or multi-take items (TBD - needs REAPER-saved fixtures); the error of the fixed pace on real recordings (TBD - needs measurement on the `Challenges_001` corpus); compute cost on a large manuscript (unmeasured).

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
