# Character Continuity Review

**Supersedes:** `docs/utilities/character-continuity-review.md` (planned-work brief, removed when this PRD landed; recoverable from git history)

Roadmap milestone 3 ("Character continuity", `docs/roadmap.md:32-36`), covering the Character Continuity Review brief (superseded by this PRD and removed from the tree; its line citations below refer to the brief as of d5cc994, readable with `git show d5cc994:docs/utilities/character-continuity-review.md`) and [Workflow: Character Continuity Review](../workflows/character-continuity.md), which stays as the narrative of how the utilities combine. Re-checked against `main` at d5cc994 on 2026-09-19: none of the code files cited here changed since b9d348d. Citations are `file:line` on branch `claude/features-defects-prds-planning-87c378` (b9d348d) for anything checked in code; "per docs" marks a claim taken from a document and not verified. Sibling PRDs (written in parallel; file names only): `review-dashboard-and-findings-adoption.prd.md` (milestone 1, prefix RD, the foundation), `take-review-pickups-duplicates-take-intelligence.prd.md` (milestone 2, prefix TR), `teleprompter-manuscript-integration.prd.md`, `diagnostics-delivery-and-cleanup-tools.prd.md`, `reaper-automation-follow-through.prd.md`. In Depends columns this PRD's own phases are bare numbers; other PRDs' phases are `RD-n`, `TR-n`, or named.

## Problem Statement

In a long multi-character production a narrator can drift from a character's established voice without noticing, and finding that drift by re-listening to a whole book is slow and unprioritized. The cost is inconsistency discovered late, when fixing it means re-recording or cutting lines across chapters. A tool that claims to judge acting or to recognize characters from audio would be wrong and untrusted, so the useful version must be narrower: measurable differences from clips the narrator has approved, shown with evidence.

## Evidence

Verified in code:

- **Category exists, nothing produces it.** `character_continuity` is a documented category (`shell/internal/findings/findings.go:33`); no producer exists, and the store, adapters and Review page it needs are milestone 1 work.
- **No acoustic analysis exists.** A repository search for pitch, F0, embedding, Resemblyzer and Praat in `.py`, `.go` and `.toml` files finds nothing outside the virtual environment's site-packages. The declared Python dependencies are `av`, `ctranslate2`, `faster-whisper`, `numpy`, `phonemizer`, `piper-tts`, `pronouncing`, `spacy` and tooling (`pyproject.toml:5-23`); `uv.lock` has no `torch`, `scipy` or `librosa` entry (only `numpy` matched). ADR 0008 records that the repository has no PyTorch dependency and that the first one would be a material sidecar-size and provisioning cost.
- **Go has no DSP library, but a hand-written precedent.** `shell/go.mod:5-9` lists only PDF, Wails and `x/sys` as direct dependencies. `shell/internal/measure` implements K-weighted loudness, true peak and a noise-floor meter itself (`loudness.go`, `truepeak.go`), tested against analytically known signals (ADR 0025). It reports whole-file loudness, RMS, sample and true peak and noise floor only (`measure.go:32-46`): no pitch, no spectral or per-range output.
- **The Story Bible has characters but no dialogue model.** Entities carry `category` (`Character`, `Place`, `Organization`, `Needs Review`), aliases, per-alias occurrences with excerpts, `personality_notes` with evidence and `relationships` (`tools/manuscript-guide/core/manuscript_guide.py:571-594`). A search of `manuscript_guide.py` for dialogue, quote, speaker and scene finds nothing, so the dialogue-cue extraction and chapter and scene appearance maps that `docs/utilities/manuscript-guide.md:23-26` list as planned MVP enhancements are not built.
- **Character identity is not yet stable enough to hang approvals on.** Entity ids are a hash of the normalized name computed at build (`manuscript_guide.py:226-227`, `:581`); a rename changes `canonical_name` but keeps the id (`:819-821`); across rebuilds ids are reconciled only for locked or manual entities (`merge_locked`, `:646-727`). "Alias merge/split review with stable entity IDs" is a planned enhancement (`manuscript-guide.md:23`). Whether an unlocked, generated character keeps its id across a rebuild is TBD - needs a test.
- **Regions cannot be read with identity today.** Lua can create regions and has an internal region enumerator (`shared/reaper/narration_ui_bridge.lua:459-509`) but no command returns regions with GUIDs; the static reader parses `TRACK` chunks only (`shell/internal/tracks/parse.go:25-41`). The research report says region and marker indices are unstable and that GUID-bearing region APIs exist from REAPER 7.62 and 7.72 (`docs/research/reaper-automation-surface.md` section 3, per docs, unverified). How a saved `.rpp` serializes region GUIDs is unverified (TBD - needs a REAPER-saved project).
- **Transcript timing that would locate dialogue in audio is not persisted.** Word timestamps live in memory in the sidecar and only marker rows are written (`tools/transcript-compare/core/compare.py:485-526`, `:1538-1563`); see the persisted-words phase of `take-review-pickups-duplicates-take-intelligence.prd.md` (TR-3).
- **Provisioning machinery exists for any model asset.** `shell/internal/assets` installs pinned, hash-verified files (`store.go:75`, `Install`), already backing Piper voices and Whisper models; the spaCy path is not migrated yet (`docs/architecture/first-use-dependency-provisioning.md`, Delivery slices 4, per docs).
- **Derived-data lifecycle.** Replacing or clearing a manuscript deletes derived project data (`shell/internal/manuscript/service.go:264,434-441,449`), so where character and reference data live must be decided (Q7).

Per docs (not verified in code): [`local-dependency-evaluation.md`](../research/local-dependency-evaluation.md) covers the candidates and their license classes. Resemblyzer is Apache-2.0 with a pretrained encoder, gives a 256-value embedding, will report all clips of one narrator as similar, and is only usable as distance-to-approved-reference; its embeddings are "biometric-like" personal data (candidate 5). Praat is GPL-3.0-or-later and should be a separately installed executable (candidate 6). BookNLP is MIT with separately downloaded model artifacts that need their own records and does the reliable direction manuscript to likely character, never audio to character (candidate 2). The prescribed trial is 3-5 clearly differentiated characters plus narration, leave-one-chapter-out, and "reject if a stable threshold cannot be calibrated" (candidate 5). Adoption order places Praat and Resemblyzer "only with the character-continuity workflow and explicitly approved reference clips" (Adoption order 5).

Not stated in that document and unverified here: Resemblyzer and BookNLP both depend on PyTorch as far as this author knows, which would make either the repository's first PyTorch dependency (Assumption - verify against the exact pinned package metadata before relying on it). Windows build requirements for Resemblyzer's dependencies are also unverified.

Assumptions - needing validation through the trial in phase 1: that simple explainable features (pitch distribution, speaking rate, energy distribution, coarse spectral summary) separate a character's reference reads from other voices for one narrator well enough to flag drift usefully, and that recording-chain or room changes between sessions do not swamp the signal (session-condition baselines are "later work" in the utility doc, which suggests the risk is real). No corpus exists in the repo.

## Proposed Solution

Build the feature in three narrator-controlled layers. First, extend the Story Bible into a stable character identity with dialogue cues and appearance maps, each carrying manuscript evidence and an explicit `unknown` when attribution is ambiguous. Second, let the narrator approve REAPER regions as voice references per character (and for plain narration), stored with a snapshot of the source range in a project sidecar, revocable at any time; only approved references ever form a baseline. Third, measure explainable acoustic features locally for reference clips and for later dialogue lines located through the cues and transcript timing, and emit `character_continuity` findings only for candidates outside the reference distribution, with the reference ids, per-feature values and ranges, sample sizes and a confidence reason. Findings are neutral measurements ("differs from the approved reference"), reviewed in the milestone 1 Review page with reference-versus-candidate audition, and a dismissed intentional change stays dismissed for identical evidence. Optional heavier backends (Praat, Resemblyzer) are adopted only if the trial shows the basic features are insufficient.

## Key Hypothesis

We believe flagging measurable acoustic deviation from narrator-approved references will let narrators find possible character-voice drift across a long book without listening to every line, for narrators producing multi-character fiction in one recording setup. We'll know we're right when (a) in the documented trial, same-character comparisons cluster measurably more tightly than different-character comparisons and a stable per-narrator threshold can be calibrated (otherwise the approach is rejected, as the local-dependency plan requires), (b) narrators confirm at least a proposed share of flagged lines as worth listening to (assumption: 50% or better, to be calibrated), and (c) intentional changes can be dismissed once and do not return for identical evidence.

## What We're NOT Building

| Item | Why |
| --- | --- |
| Identifying which character is speaking from audio | Recorded boundary; one narrator voices every character, and the plan says embeddings will often call all clips similar (the retired `character-continuity-review.md` brief's non-goals; local-dependency candidate 5) |
| Judging acting, emotion, accent, health, or "in character" | Out of boundary; findings are neutral measurements with evidence |
| Using any recording as reference without explicit approval | `roadmap.md:67` |
| Automatic dialogue attribution presented as fact | Attribution is a review candidate with `unknown`; ADR 0020's precision-first stance applies |
| Storing voice embeddings, or exporting or cloning voices | Embeddings are biometric-like (per docs); MVP stores scalar features only (Q7); voice cloning is explicitly excluded in the dependency plan |
| Adopting Praat, Resemblyzer or BookNLP before the trial | Each needs the provenance gate, held-out corpus and adopt/defer/reject record; Resemblyzer or BookNLP would likely add PyTorch (see Evidence) |
| Multiple voice modes per character and session-condition baselines | Documented "later work" |
| Assisted review of ambiguous attribution beyond a simple correction path | Documented "later work" |
| Full character-bible relationship review and export | `manuscript-guide.md:30` later work; only dialogue cues and appearance maps are needed here (Q5) |
| Ranking takes by closeness to a character reference | Take Intelligence "later work" (the retired `take-intelligence.md` brief, now `take-review-pickups-duplicates-take-intelligence.prd.md`); consumes this milestone's output afterwards |
| Optional model downloads at startup, moving-alias URLs, or silent model choice | First-use provisioning rules; see Q1 and phase 8 |
| Languages other than US English; Audacity | Deferred (`roadmap.md`) |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Feature separability on the trial corpus | TBD - calibrate; the plan's gate is that a stable per-narrator threshold exists, else reject | Phase 1 trial: 3-5 characters plus narration, leave-one-chapter-out, held-out from tuning |
| Narrator-confirmed useful flags | Proposed 50% or better (assumption) | Accept versus dismiss counts on the trial corpus |
| Only approved regions affect a baseline | 100% | Go tests: unapproved or revoked regions never change any baseline value |
| Intentional deviations do not reappear for identical evidence | 100% | Go tests with the milestone 1 evidence-version merge |
| Insufficient reference behavior | No flags below the minimum reference amount, and "insufficient reference" shown as unavailable evidence, 100% | Go tests; minimum value TBD from the trial (Q6) |
| Attribution quality of dialogue cues | TBD - measured on 50-100 hand-labeled quotes (the size the dependency plan uses); ambiguous cases must return `unknown` | Pytest fixtures plus the labeled set |
| Explainability | Every finding lists reference ids, per-feature value, reference range and sample size | Schema test on adapter output |
| Privacy | Derived voice data removable in one action; nothing leaves the machine | Test that the analyzer performs no network calls; manual removal check |
| Gate | `pnpm check` green each phase; visual suite at four viewports for UI phases | CI and PNG review |

## Open Questions

- [ ] **Q1. Which feature engine ships in the MVP?** Options: (A) dependency-free features in Go: loudness and RMS from the existing meters extended per range, F0 by a hand-written autocorrelation or YIN tracker, speaking rate from aligned word counts over duration, a coarse spectral summary from a hand-written FFT; (B) numpy in the existing Transcript Compare sidecar as a new mode; (C) Praat as a separately installed executable driven by scripts; (D) Resemblyzer embeddings. Recommendation: A for the MVP, following ADR 0025 (measurement in Go, no third runtime), and run the documented trial to decide whether C or D are ever worth adding. Costs to accept: no Go DSP dependency exists, so a tracker and FFT are hand-written and must be validated against analytic signals, and pitch trackers have octave-error failure modes the trial must quantify. If the trial says A is insufficient, C is preferred over D because it avoids PyTorch and biometric embeddings, but it brings GPL process-boundary and provisioning work (phase 8).
- [ ] **Q2. How is a reference identified?** Options: (A) REAPER region GUID plus a snapshot of the resolved source file identity and source start and end at approval; (B) item GUID plus source-relative offsets; (C) manuscript line id (ADR 0026) plus audio range. Recommendation: A. Baselines are computed from the snapshot so moving or editing the region does not silently change them; if the live region no longer matches the snapshot the reference is flagged "changed since approval" and needs re-approval; the region GUID is a navigation hint, not the analysis source. Region GUID availability and serialization are unverified (TBD - needs research and a REAPER-saved sample).
- [ ] **Q3. How does the app list regions for approval?** Options: (A) parse region lines from the saved `.rpp` in Go (works standalone, testable with fixtures, but blind to unsaved regions); (B) a new read-only Lua command returning regions with GUIDs (live, needs a running bridge, no automated tests, manual REAPER checklist); (C) a naming convention such as `REF: Name` read by either route. Recommendation: A first, with a "save the project to see new regions" hint, because `daw-integration.md:8` puts anything derivable from the saved project in Go; B only if A's serialization or freshness proves inadequate. The approval itself always happens in the app, never by naming.
- [ ] **Q4. How are dialogue lines attributed to characters?** Options: (A) rules-based cue extraction in Manuscript Guide (quote spans, adjacent "said Name" and alias patterns, per-scene continuation) with `unknown` when unclear and a narrator correction path; (B) BookNLP (needs its own trial, separate artifact records and probably PyTorch); (C) manual tagging only. Recommendation: A, staged, with corrections stored so they are never overwritten by a rebuild (mirroring locked entries, ADR 0007); B only after its own trial; C is the correction mechanism, not the scale mechanism. Wrong attribution creates false drift flags, so precision over recall applies as in ADR 0020.
- [ ] **Q5. What is the minimum "character bible" delta for this milestone?** Options: (A) stable character ids across rebuilds and merges, dialogue cues, and chapter and scene appearance maps only; (B) also relationship review and bible export. Recommendation: A. Roadmap wording ("extend the manuscript guide into a reviewable character bible") is satisfied by identity, cues and appearance maps; relationship review and export are separate later work in the guide doc.
- [ ] **Q6. How much reference audio is enough, and how is "outside the reference" decided?** Options: (A) a fixed conservative minimum per character (clips and total seconds) below which no flag is produced, and a robust percentile or spread-based rule per feature; (B) always flag but with low confidence when the reference is small. Recommendation: A, with values and rule calibrated by the trial (TBD - needs research); "insufficient reference" is displayed as unavailable evidence, consistent with the finding contract's ban on fabricated scores.
- [ ] **Q7. What voice data is stored, and what happens on manuscript replace?** Options: (a) store scalar features and approvals only, or also embeddings; (b) delete with the manuscript's derived data, keep approvals and detach them from missing characters, or keep everything. Recommendation: scalar features and approval metadata only, no embeddings; a "Remove voice analysis data" action and revocation both delete derived features; on manuscript replace, follow the existing derived-data rule and clear with the existing confirmation, because characters are manuscript-derived. Data lives under `<project>/narration-utils/characters/`, local only, and is never embedded in shareable reports.
- [ ] **Q8. Which analyses may start before milestone 2's persisted-words work lands?** Options: (A) this milestone depends on TR-3's persisted, documented aligned-words artifact; (B) this milestone builds its own alignment; (C) extract the aligned-words artifact into its own small PR that both consume. Recommendation: A, or C if this milestone is scheduled first. B duplicates transcription cost and drifts from Transcript Compare's tokenization.
- [ ] **Q9. Is plain narration a first-class reference subject?** Options: (A) yes, the narrator can approve regions as "Narration" and each finding shows the candidate's distance to both its character reference and the narration baseline; (B) characters only. Recommendation: A, because drift toward the neutral narrator voice is a plausible failure and it costs one more reference set; the trial must confirm it helps (the doc's tests include narration versus dialogue).

## Users & Context

**Primary User**

- **Who**: A narrator (or narrator-editor) producing multi-character fiction, recording in one setup in REAPER on Windows.
- **Current behavior**: Relies on memory and notes, spot re-listens to earlier chapters when a character returns, sometimes a proofer notices drift.
- **Trigger**: A character returns after many chapters, a new recording session begins, or a proofer reports a character sounds different.
- **Success state**: The narrator has a short list of dialogue lines whose measured voice differs from the approved reference, hears each against the reference, and either re-records, accepts, or dismisses with a note that documents an intentional change.

**Job to Be Done**: When a character has been established, I want later lines that measurably differ from my approved reference flagged with evidence, so that I can check for unintended drift without re-listening to the whole book.

**Non-Users**: Anyone wanting character identification from audio, performance grading, or voice conversion; reviewers who cannot approve references (they receive reports, owned by the diagnostics work); Audacity users.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Notes |
| --- | --- | --- |
| Must | Stable character ids, dialogue cues with manuscript evidence and `unknown`, appearance maps | Phase 2 |
| Must | Reference region list, approve and revoke per character, sidecar with snapshot and approval metadata | Phase 3 |
| Must | Explainable features: pitch distribution, speaking rate, energy, coarse spectral summary | Phase 4 (engine per Q1) |
| Must | Baseline from approved references only; outlier flags with confidence and reason; unavailable evidence rules | Phase 5 |
| Must | `character_continuity` findings with reference ids, feature differences, manuscript context | Phase 5 |
| Must | Reference versus candidate A/B audition in the Review page; character filter | Phase 6 (needs `RD-5`) |
| Must | Dismiss with note; identical evidence does not reappear | Phases 5 and 7 (uses `RD-1` evidence version) |
| Should | Narration as a reference subject (Q9) | Phase 5 |
| Should | Attribution correction path | Phase 6 |
| Should | "Changed since approval" and "recording chain differs" warnings that suppress a drift flag instead of raising one | Phase 5 |
| Could | Optional Praat or Resemblyzer backend | Phase 8 only if the trial says so |
| Won't | Voice ID, acting judgement, embeddings, voice modes, session baselines, take ranking by reference | See table above |

### MVP Scope

Phases 1 to 7. Phase 8 is conditional on the trial.

### User Flow

1. In the character bible view the narrator picks a character, sees appearance and dialogue cues with their evidence, and corrects any wrong attribution.
2. Lists the project's regions, plays one, and approves it as a reference for that character (or Narration). Revoking removes it and its derived features.
3. Runs the analysis for a chapter or range. If reference audio is insufficient, the app says so and produces no flags.
4. Opens flagged lines in Review: sees feature values against the reference range, sample sizes and confidence with its reason, the surrounding manuscript, and plays reference against candidate.
5. Accepts, dismisses with a note ("intentional: character is ill in this scene"), or defers. The same evidence never re-flags a dismissed line.

## Technical Approach

**Feasibility**: MEDIUM-LOW overall. Identity, approvals, storage, findings and UI are HIGH (Go and React, automatable). Whether basic acoustic features separate drift usefully for a single narrator, and whether attribution is accurate enough, are research questions that could reject the approach; the plan's own gate says so. Anything needing a real REAPER (region GUIDs) is unverified and cannot be tested in CI.

**Architecture Notes**

- **Data model.** `<project>/narration-utils/characters/` holds `references.json` (per character: approved and revoked references with region GUID, source file identity, source start and end, approved timestamp, optional note) and a derived-features cache keyed by source identity, range and feature version. Only the Go host writes (atomic temp-then-rename, as in `transcript/service.go:177-182`), reusing the milestone 1 store conventions; the record treats character ids as opaque strings.
- **Character identity and cues.** Manuscript Guide gains stable ids across rebuilds and merges, dialogue cues (quote span, attributed character or `unknown`, cue evidence, chapter and paragraph ids) and appearance maps, additive to the existing JSON and normalized in `shell/internal/guide/service.go:71-106` and `normalizeGuideEntity` (`shared/ui/src/api/contracts/storyBible.ts`). The lock guard stays authoritative (ADR 0007).
- **Locating candidate audio.** Dialogue cue spans map to audio time through the persisted aligned words from TR-3 (Q8). A line with no reliable alignment yields no candidate rather than a guess.
- **Features and baselines.** Per reference clip and per candidate: median and spread of F0, speaking rate as aligned words over voiced duration (manuscript word count over duration as a coarse fallback, labeled), energy distribution from RMS and loudness, a coarse spectral summary. Baseline per character and per Narration is a robust summary across reference clips; the candidate is compared per feature, and the finding lists each feature's value, the reference range and the sample size. A large shift in noise floor or overall level between candidate and references is reported as "recording chain may differ" and lowers confidence instead of raising a drift flag. Thresholds are calibrated in phase 1 (Q6).
- **Findings.** Category `character_continuity`; severity kept at `info` or `warning`, never `error`; confidence numeric with a stated reason from reference size and feature stability; `evidence` carries reference ids and feature table; `source` and `time_range` from the candidate; `suggested_action` is navigation or audition only. Wording is neutral measurement, never "out of character".
- **Provisioning.** The MVP downloads nothing. Any later optional backend must be catalog-backed, pinned, hash-verified, offered only when used and only after an explicit Download, and needs a dependency record with code and weight licenses and provenance in the local-dependency plan; Praat stays a separate process (GPL boundary).
- **UI.** Character bible view in the Story Bible area, region list and approval controls, character filter and A/B audition in Review (reuse the TR-7 audition component if it has landed). New primitives need stories, atlas coverage and `design-spec-guard`.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Basic features do not separate drift from normal variation, or thresholds cannot be calibrated | Medium | Phase 1 trial with a reject gate; ship nothing that cannot pass it |
| Wrong dialogue attribution creates false drift flags | High | `unknown` on ambiguity, precision-first rules (ADR 0020), correction path, no flag without an attributed cue |
| Recording-chain or room changes mimic drift | High | Chain-difference check that suppresses flags; session-condition baselines stay later work |
| Too little reference audio | High | Minimum reference rule (Q6); unavailable evidence, never a guess |
| Hand-written pitch tracker is unreliable (octave errors, breathy voice) | Medium | Analytic and recorded fixtures, confidence from voiced fraction, trial quantifies; escalate to Praat only if needed |
| Character ids change on rebuild, orphaning approvals | Medium | Stable ids in phase 2 before approvals depend on them; orphan detection |
| Region identity or serialization differs from assumptions | Medium | Snapshot-based analysis (Q2), REAPER-saved fixture, fallback route (Q3 B) |
| Narrators or reviewers read acoustic metrics as meaning (for example higher pitch as "angry" or a flag as "out of character") | Medium | Neutral measurement wording only, the raw feature table shown next to every flag, no emotion or acting labels anywhere in findings or UI, confidence reason stated |
| Biometric-like data mishandled | Low-Medium | Scalar features only, local, removable, excluded from shareable reports |
| PyTorch or GPL dependencies sneak in | Low | Conditional phase 8, dependency record, ADR, first-use gate, process boundary for Praat |
| Phase 1 needs a permissioned real corpus that may not be available | Medium | Blocker for calibration only; other phases can proceed with fixtures |
| Merge conflicts in shared areas (guide service, `measure`, bindings, `resetDerived`) | High | See Parallel-session compatibility |

## Implementation Phases

Every phase follows the `CLAUDE.md` workflow: plan (find or open the tracking issue first and put `Closes #<n>` in the PR, `docs/operations/github-workflow.md`), `change-impact-scan` (mandatory for `shared/reaper` and shared UI), TDD, `full-verification-gate` (`pnpm check`), `design-spec-guard` for primitives or `styles.css`, `feature-cleanup`. Phases that change `shared/ui` also run the Playwright visual suite and the atlas and view every PNG at `desktop`, `small-desktop`, `tablet` and `mobile`. Phases that change bindings bump the host API version in `shell/app.go:33`, `shell/app_test.go:39-42` and `shared/ui/src/hostApi.ts:2` (whichever PR lands second increments again; check `hostAPIVersion` at merge time). Phases that change `shared/reaper` require a user-run manual REAPER checklist. Re-check `docs/adr/` before numbering an ADR (take the next free number at merge time; 0027 at d5cc994). Milestone 1 is the foundation: phases 3, 5 and 6 depend on the findings store and Review page.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Acoustic feature trial and decision record | Run the documented trial on a permissioned corpus; compare dependency-free features with Praat and Resemblyzer; adopt, defer or reject; calibrate Q6 values | pending | 2, 3 | - | - |
| 2 | Stable characters, dialogue cues, appearance maps | Manuscript Guide: stable ids, rules-based cues with `unknown`, appearance maps, corrections that survive rebuild; Go and TS normalization | pending | 1, 3 | - | - |
| 3 | Region listing and reference approvals | Go: list project regions with identity, approve and revoke per character, sidecar with snapshot and metadata, no analysis | pending | 1, 2, 4 | RD-1 | - |
| 4 | Feature extraction engine | Range-limited pitch, rate, energy and spectral features with analytic-signal tests, per Q1 outcome | pending | 2, 3 | 1, TR-8 (soft) | - |
| 5 | Baselines, outliers and findings | Baseline from approved references, candidate location via cues and aligned words, outlier rule, chain-difference check, `character_continuity` findings | pending | - | 2, 3, 4, TR-3, RD-1 | - |
| 6 | Character review UI | Bindings, character bible view, region approval, attribution correction, Review character filter, reference-versus-candidate audition, host API bump | pending | - | 5, RD-5, TR-7 (soft) | - |
| 7 | Intentional-change handling, privacy controls and close-out | End-to-end dismiss-with-note semantics, remove voice data action, docs, `roadmap.md` and `roadmap.json` together | pending | - | 6 | - |
| 8 | Optional acoustic backend (conditional) | Only if phase 1 adopts Praat or Resemblyzer: catalog entry, license record, first-use gate, packaging, ADR | pending | - | 1, 4 | - |

### Phase Details

**Phase 1 - Acoustic feature trial and decision record**
- **Goal**: Decide from evidence which features work and whether any heavier backend is justified.
- **Scope**: Follow the six-step protocol in `local-dependency-evaluation.md` on 3-5 permissioned chapters, 3-5 differentiated characters plus narration, leave-one-chapter-out; compare hand-computed features against Praat and Resemblyzer outputs; verify the PyTorch and Windows-build assumptions from upstream metadata; record adopt, defer or reject and the calibrated Q6 values in the research document or a follow-up brief. Corpus, audio and outputs stay ignored local data. Needs the user's permission and materials.
- **Success signal**: A written decision with numbers; if rejected, this milestone stops after phase 3 and the roadmap wording is revisited by the user.

**Phase 2 - Stable characters, dialogue cues, appearance maps**
- **Goal**: A trustworthy manuscript-side character model with evidence.
- **Scope**: `manuscript_guide.py` stable ids across rebuild, alias merge and split; quote and cue extraction with `unknown` and evidence; chapter and scene appearance maps; narrator corrections stored so a rebuild never overwrites them; normalization in the Go guide service and TS contract; pytest fixtures for ambiguous cues, overlapping speakers and missing cues; tuning is test-driven as in ADR 0020.
- **Success signal**: Labeled-quote evaluation reported (Q4); ids stable across a rebuild test; `pnpm check` green; Story Bible page unchanged in behavior.

**Phase 3 - Region listing and reference approvals**
- **Goal**: The narrator can approve and revoke references safely, with no analysis yet.
- **Scope**: Region parse (Q3 A) with fixtures from a REAPER-saved project; approvals sidecar with snapshot and "changed since approval" detection; opaque character ids; tests for approve, revoke and orphaned characters; `resetDerived` decision (Q7). No bindings if it can be exercised through tests until phase 6.
- **Success signal**: Fixture and lifecycle tests; unapproved regions demonstrably ignored by any downstream consumer.

**Phase 4 - Feature extraction engine**
- **Goal**: Reproducible, explainable features with honest failure modes.
- **Scope**: Range-limited analysis (coordinate one shared range API with `TR-8`), pitch tracker, rate, energy distribution, coarse spectral summary; analytic-signal and recorded fixtures; voiced-fraction and octave-error reporting; unavailable results rather than fabricated numbers; WAV mono and stereo only (ADR 0025).
- **Success signal**: Known-frequency and known-rate fixtures pass; results identical across runs; failure cases return null.

**Phase 5 - Baselines, outliers and findings**
- **Goal**: Produce reviewable findings only from approved references.
- **Scope**: Baseline builder, candidate locator, outlier rule with the calibrated thresholds, minimum-reference rule, chain-difference suppression, narration comparison (Q9), findings adapter with evidence and confidence reason, ids and evidence version so identical evidence stays dismissed.
- **Success signal**: Tests for the narrator's normal voice (no flag), narration versus dialogue, overlapping character voices, missing or ambiguous speaker cues, small references; performance on a real chapter recorded; findings validate against the contract.

**Phase 6 - Character review UI**
- **Goal**: Narrator-facing surfaces for approval, correction, review and audition.
- **Scope**: Bindings and contract, mock, host API bump, character bible view, region list with play, approve and revoke, attribution correction, Review character filter, reference-versus-candidate audition; new states in the visual catalog; guide updates (the character bible view in `docs/guides/using-the-app/story-bible.md`, the character filter and audition in the Review page, `docs/guides/using-the-app/review.md` added by `RD-5`) and screenshots, keeping `shared/ui/src/docsGuide.test.ts` green.
- **Success signal**: Visual suite and atlas green with four-viewport PNG review; end-to-end on a real chapter.

**Phase 7 - Intentional-change handling, privacy controls and close-out**
- **Goal**: Finish the promises in the acceptance criteria and the docs.
- **Scope**: End-to-end test that a dismissed note persists and does not re-flag identical evidence while changed evidence returns; "Remove voice analysis data" action; docs for the workflow (`docs/workflows/character-continuity.md`) and any new utility page; `docs/README.md`; `roadmap.md` and `shared/config/roadmap.json` updated together (the merge also re-syncs the GitHub milestone description); feature cleanup.
- **Success signal**: The acceptance items carried from the superseded brief (only approved regions affect a baseline; dismissed intentional deviations do not reappear for identical evidence; the four test scenarios in phase 5) demonstrably met; docs and roadmap consistent.

**Phase 8 - Optional acoustic backend (conditional)**
- **Goal**: Add a heavier backend only if evidence demands it.
- **Scope**: Dependency record with code and weight licenses, provenance, hashes and removal path; catalog entry through `shell/internal/assets`; explicit-Download first-use gate with no download at startup; packaging checks; ADR (a first PyTorch dependency would need one referencing ADR 0008); Praat as a separately installed process.
- **Success signal**: Provisioning acceptance criteria in `first-use-dependency-provisioning.md` met for the new asset; release smoke test passes.

### Parallelism Notes

Phases 1, 2 and 3 are independent. Phase 4 needs the phase 1 decision but can start against the recommended dependency-free path if the user accepts Q1 A early. Phases 5, 6 and 7 are a strict chain. Phase 8 exists only if the trial says so.

### Parallel-session compatibility

| Phase | Files and areas touched | Likely collisions |
| --- | --- | --- |
| 1 | `docs/research/` addendum, scratch corpus outside the repo | Any session editing `local-dependency-evaluation.md`; needs the user's data and permission |
| 2 | `tools/manuscript-guide/core/manuscript_guide.py` and tests, `shell/internal/guide/service.go`, `shared/ui/src/api/contracts/storyBible.ts` | `RD-3` reads the guide JSON and must tolerate additive fields; any Story Bible work; teleprompter phase 5 reuses entity summaries |
| 3 | New `shell/internal/*` characters package, possibly `shell/internal/tracks/parse.go`, `shell/internal/manuscript/service.go` (`resetDerived`, line 434) | Teleprompter phase 8 and `TR-2` also edit `tracks/parse.go`; every sibling that adds a directory to `resetDerived` |
| 4 | `shell/internal/measure/*` or a new DSP package | `TR-8` and the diagnostics PRD extend `measure`; agree a single range entry point first |
| 5 | New adapter and analyzer packages, findings store use | Store API changes from `RD-1` |
| 6 | `shell/bindings.go`, `shell/app.go` (host API), `shell/app_test.go`, `shared/ui/src/{hostApi.ts,api/*,components/storybible/*,components/review/*}`, visual catalog, docs images | Every binding and UI phase in any PRD; host API number; nav or screenshot regeneration in the teleprompter final phase |
| 7 | Docs, `docs/roadmap.md`, `shared/config/roadmap.json`, `docs/README.md` | Any milestone-status edit; roadmap files change together and alone |
| 8 | `shared/config/*` catalog, `shell/internal/assets`, packaging scripts, `pyproject.toml` and `uv.lock` if Python | Release and provisioning work; lockfile churn |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Character reference analysis uses only clips explicitly approved by the narrator (prior decision) | Baselines from approved references only; the reference set changes only through a deliberate narrator approve or revoke, never by learning from later recordings | Learn from all recordings | `roadmap.md:67`; workflow step 5 |
| No automatic character identification from voice; no acting, emotion or accent judgement (prior decision) | Neutral measurements with evidence | Classifier or verdicts | Retired `character-continuity-review.md` non-goals; local-dependency plan |
| Findings are evidence-based, reviewable, local-first (prior decision) | `character_continuity` findings, no cloud | Cloud analysis | `roadmap.md:10`; findings contract |
| Optional models follow first-use provisioning: catalog, pinned URL, hash, explicit Download, nothing at startup, no silent fallback (prior decision) | Any backend goes through `shell/internal/assets` | Startup or unpinned downloads | `first-use-dependency-provisioning.md` |
| No dependency without a license and provenance record; GPL tools stay a separate process (prior decision) | Dependency record before adoption | Ad hoc installs | `local-dependency-evaluation.md` |
| Resemblyzer and Praat only in the character-continuity workflow and only with approved clips (prior decision) | Trial first | Adopt early | Adoption order 5 in the dependency plan |
| Measurement lives in Go, hand-written and validated on analytic signals; no third runtime (prior decision, ADR 0025) | Go features for MVP (Q1 A) | New sidecar | ADR 0025 |
| No PyTorch dependency so far; the first would be a deliberate, ADR-recorded cost (prior decision, ADR 0008) | Avoid in MVP | Adopt for embeddings | ADR 0008 context |
| Precision over recall for extraction (prior decision, ADR 0020) | `unknown` on ambiguous attribution | Guess | ADR 0020 |
| Locked entries are enforced server-side (prior decision, ADR 0007) | Corrections and locks honored by the guide backend | UI-only | ADR 0007 |
| Windows-first, REAPER-first, US-English-first (prior decision) | No other platform or language work | Cross-platform now | `docs/README.md` (closing paragraph) |
| Feature engine (proposed, Q1) | Dependency-free Go features, trial before heavier backends | Praat, Resemblyzer, numpy sidecar | Precedent and boundaries |
| Reference identity (proposed, Q2) | Region GUID plus source-range snapshot | Item GUID, line id | Baselines stable when regions move |
| Attribution (proposed, Q4) | Rules-based cues with `unknown` and corrections | BookNLP, manual only | Precision, no PyTorch |
| Stored data (proposed, Q7) | Scalar features and approvals, no embeddings | Embeddings | Biometric-like data |

## Research Summary

**Market Context**: The REAPER research report (`docs/research/reaper-automation-surface.md` section 7, per docs) lists a community script set that includes a character take report; its contents were not inspected, it declares no license, and it should be learned from, not copied. The report does not survey tools that measure character-voice drift against approved references, so market coverage of this feature is TBD - needs research. Nothing in the repo shows narrators asking for this beyond the roadmap itself.

**Technical Context**: The dependency plan's candidates are Resemblyzer (Apache-2.0, pretrained encoder, embeddings that a single narrator's characters will often share), Praat (GPL-3.0-or-later, best kept a separate executable, measures pitch, intensity, formants and duration), and BookNLP (MIT plus separately recorded model artifacts, text-side attribution only); each needs a per-artifact license and provenance record, and none is an implemented dependency (`local-dependency-evaluation.md`, status "Planned evaluation"). The document still describes setup-time downloads for a source checkout and is due an update for release-time first-use provisioning (`first-use-dependency-provisioning.md`). Reusable in-repo pieces: the hand-written, analytically tested DSP approach in `shell/internal/measure` (ADR 0025), the asset installer in `shell/internal/assets`, the findings contract and Review page from milestone 1, the persisted aligned words planned in TR-3, the audition component planned in TR-7, and the Story Bible's character entities and evidence model.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
