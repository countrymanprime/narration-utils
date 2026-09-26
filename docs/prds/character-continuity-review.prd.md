# Character Continuity Review

**Supersedes:** `docs/utilities/character-continuity-review.md` (planned-work brief, removed when this PRD landed; recoverable from git history)

Roadmap milestone 3 ("Character continuity", `docs/roadmap.md:32-36`), covering the Character Continuity Review brief (superseded by this PRD and removed from the tree; its line citations below refer to the brief as of d5cc994, readable with `git show d5cc994:docs/utilities/character-continuity-review.md`) and [Workflow: Character Continuity Review](../workflows/character-continuity.md), which stays as the narrative of how the utilities combine. Re-checked against `main` at d5cc994 on 2026-09-19: none of the code files cited here changed since b9d348d. Citations are `file:line` on branch `claude/features-defects-prds-planning-87c378` (b9d348d) for anything checked in code; "per docs" marks a claim taken from a document and not verified. Sibling PRDs (written in parallel; file names only): `review-dashboard-and-findings-adoption.prd.md` (milestone 1, prefix RD, the foundation), `take-review-pickups-duplicates-take-intelligence.prd.md` (milestone 2, prefix TR), `teleprompter-manuscript-integration.prd.md`, `diagnostics-delivery-and-cleanup-tools.prd.md`, `reaper-automation-follow-through.prd.md`. In Depends columns this PRD's own phases are bare numbers; other PRDs' phases are `RD-n`, `TR-n`, or named.

**Extension (2026-09-26, benchmark recommendation 8):** the [audiobook studio benchmark](../research/audiobook-studio-benchmark.md) recommendation 8 ("Series and continuity. Milestone 3 (reference clips, drift evidence), extended across the books of a series") and §1's differentiator "A series bible: characters, pronunciations and voice reference clips shared across the books of a series" [W32] add Phases 9 to 11 below: sharing approved character references and their calibrated baselines across the projects (books) of one series, with the same evidence-based, narrator-approved, never-a-verdict discipline this PRD already established for one book. Citations for the extension are `file:line` on `main` at `48a882d`; everything above this line is unchanged from the original PRD. New Open Questions are numbered Q10 onward, continuing the original Q1-Q9. Part of the [agent train](../operations/agent-train.md) (stream N-D2, wave 4), see #509.

## Problem Statement

In a long multi-character production a narrator can drift from a character's established voice without noticing, and finding that drift by re-listening to a whole book is slow and unprioritized. The cost is inconsistency discovered late, when fixing it means re-recording or cutting lines across chapters. A tool that claims to judge acting or to recognize characters from audio would be wrong and untrusted, so the useful version must be narrower: measurable differences from clips the narrator has approved, shown with evidence.

## Evidence

Verified in code:

- **Category exists, nothing produces it.** `character_continuity` is a documented category (`apps/desktop/internal/findings/findings.go:33`); no producer exists, and the store, adapters and Review page it needs are milestone 1 work.
- **No acoustic analysis exists.** A repository search for pitch, F0, embedding, Resemblyzer and Praat in `.py`, `.go` and `.toml` files finds nothing outside the virtual environment's site-packages. The declared Python dependencies are `av`, `ctranslate2`, `faster-whisper`, `numpy`, `phonemizer`, `piper-tts`, `pronouncing`, `spacy` and tooling (`pyproject.toml:5-23`); `uv.lock` has no `torch`, `scipy` or `librosa` entry (only `numpy` matched). ADR 0008 records that the repository has no PyTorch dependency and that the first one would be a material sidecar-size and provisioning cost.
- **Go has no DSP library, but a hand-written precedent.** `apps/desktop/go.mod:5-9` lists only PDF, Wails and `x/sys` as direct dependencies. `apps/desktop/internal/measure` implements K-weighted loudness, true peak and a noise-floor meter itself (`loudness.go`, `truepeak.go`), tested against analytically known signals (ADR 0025). It reports whole-file loudness, RMS, sample and true peak and noise floor only (`measure.go:32-46`): no pitch, no spectral or per-range output.
- **The Story Bible has characters but no dialogue model.** Entities carry `category` (`Character`, `Place`, `Organization`, `Needs Review`), aliases, per-alias occurrences with excerpts, `personality_notes` with evidence and `relationships` (`sidecars/manuscript-guide/core/manuscript_guide.py:571-594`). A search of `manuscript_guide.py` for dialogue, quote, speaker and scene finds nothing, so the dialogue-cue extraction and chapter and scene appearance maps that `docs/utilities/manuscript-guide.md:23-26` list as planned MVP enhancements are not built.
- **Character identity is not yet stable enough to hang approvals on.** Entity ids are a hash of the normalized name computed at build (`manuscript_guide.py:226-227`, `:581`); a rename changes `canonical_name` but keeps the id (`:819-821`); across rebuilds ids are reconciled only for locked or manual entities (`merge_locked`, `:646-727`). "Alias merge/split review with stable entity IDs" is a planned enhancement (`manuscript-guide.md:23`). Whether an unlocked, generated character keeps its id across a rebuild is TBD - needs a test.
- **Regions cannot be read with identity today.** Lua can create regions and has an internal region enumerator (`integrations/reaper/narration_ui_bridge.lua:459-509`) but no command returns regions with GUIDs; the static reader parses `TRACK` chunks only (`apps/desktop/internal/tracks/parse.go:25-41`). The research report says region and marker indices are unstable and that GUID-bearing region APIs exist from REAPER 7.62 and 7.72 (`docs/research/reaper-automation-surface.md` section 3, per docs, unverified). How a saved `.rpp` serializes region GUIDs is unverified (TBD - needs a REAPER-saved project).
- **Transcript timing that would locate dialogue in audio is not persisted.** Word timestamps live in memory in the sidecar and only marker rows are written (`sidecars/transcript-compare/core/compare.py:485-526`, `:1538-1563`); see the persisted-words phase of `take-review-pickups-duplicates-take-intelligence.prd.md` (TR-3).
- **Provisioning machinery exists for any model asset.** `apps/desktop/internal/assets` installs pinned, hash-verified files (`store.go:75`, `Install`), already backing Piper voices and Whisper models; the spaCy path is not migrated yet (`docs/architecture/first-use-dependency-provisioning.md`, Delivery slices 4, per docs).
- **Derived-data lifecycle.** Replacing or clearing a manuscript deletes derived project data (`apps/desktop/internal/manuscript/service.go:264,434-441,449`), so where character and reference data live must be decided (Q7).

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
- [x] **Q2. How is a reference identified?** Decided and implemented in Phase 3 as recommended, option A (ADR 0263): a `character.Reference` names a region by its REAPER GUID plus a snapshot of the region's own name and time range, taken at approval. Resolving the region's underlying source-audio identity is deferred to Phase 4, which needs it to locate candidate audio; Phase 3 only needed enough to detect "changed since approval." Region GUID availability and serialization, previously unverified, are now confirmed: `internal/tracks/parse.go` already parses region MARKER lines with their GUIDs, and its REAPER-saved fixtures (`internal/tracks/testdata/reaper/*.rpp`) show the serialized shape. Options considered: (B) item GUID plus source-relative offsets; (C) manuscript line id (ADR 0026) plus audio range - both rejected as the PRD recommended, since a region is the unit the narrator approves, not an item or a manuscript line.
- [x] **Q3. How does the app list regions for approval?** Decided and implemented in Phase 3 as recommended, option A (ADR 0263): `character.Service.ListRegions` parses region lines from the saved `.rpp` (reusing `internal/tracks.Parse`, already built for an unrelated feature), works standalone and is fully testable with fixtures. Option B (a live Lua bridge command) and the "save the project to see new regions" UI hint stay open follow-ups for Phase 6, adopted only if A's freshness proves inadequate once a narrator uses it; option C (a naming convention) was rejected as recommended - approval always happens in the app, never by naming a region.
- [ ] **Q4. How are dialogue lines attributed to characters?** Options: (A) rules-based cue extraction in Manuscript Guide (quote spans, adjacent "said Name" and alias patterns, per-scene continuation) with `unknown` when unclear and a narrator correction path; (B) BookNLP (needs its own trial, separate artifact records and probably PyTorch); (C) manual tagging only. Recommendation: A, staged, with corrections stored so they are never overwritten by a rebuild (mirroring locked entries, ADR 0007); B only after its own trial; C is the correction mechanism, not the scale mechanism. Wrong attribution creates false drift flags, so precision over recall applies as in ADR 0020.
- [ ] **Q5. What is the minimum "character bible" delta for this milestone?** Options: (A) stable character ids across rebuilds and merges, dialogue cues, and chapter and scene appearance maps only; (B) also relationship review and bible export. Recommendation: A. Roadmap wording ("extend the manuscript guide into a reviewable character bible") is satisfied by identity, cues and appearance maps; relationship review and export are separate later work in the guide doc.
- [ ] **Q6. How much reference audio is enough, and how is "outside the reference" decided?** Options: (A) a fixed conservative minimum per character (clips and total seconds) below which no flag is produced, and a robust percentile or spread-based rule per feature; (B) always flag but with low confidence when the reference is small. Recommendation: A, with values and rule calibrated by the trial (TBD - needs research); "insufficient reference" is displayed as unavailable evidence, consistent with the finding contract's ban on fabricated scores.
- [x] **Q7. What voice data is stored, and what happens on manuscript replace?** Decided and implemented in Phase 3 as recommended (ADR 0263): approval metadata only (a region GUID, its name/time-range snapshot, the character id, approved timestamp and an optional note) under `<project>/narration-utils/characters/references.json`, local only, no embeddings and no audio; Phase 4/5 own whether any derived scalar feature cache joins it later. Revoking a reference removes its record outright, matching "revocation deletes derived features" literally rather than soft-deleting it. On manuscript replace, `internal/manuscript`'s `resetDerived` now also clears `character.Dir(project)`, alongside every other manuscript-derived directory it already clears. A dedicated "Remove voice analysis data" action is a Phase 6 UI concern (revoking every reference already has the same effect at the data layer).
- [ ] **Q8. Which analyses may start before milestone 2's persisted-words work lands?** Options: (A) this milestone depends on TR-3's persisted, documented aligned-words artifact; (B) this milestone builds its own alignment; (C) extract the aligned-words artifact into its own small PR that both consume. Recommendation: A, or C if this milestone is scheduled first. B duplicates transcription cost and drifts from Transcript Compare's tokenization.
- [ ] **Q9. Is plain narration a first-class reference subject?** Phase 3's approval layer already accepts `character.NarrationCharacterID` as an opaque character id like any other, so approving a region as "Narration" needs no later migration; the finding-side half of this question (showing distance to both baselines) is still Phase 5's to decide, unchanged. Options: (A) yes, the narrator can approve regions as "Narration" and each finding shows the candidate's distance to both its character reference and the narration baseline; (B) characters only. Recommendation: A, because drift toward the neutral narrator voice is a plausible failure and it costs one more reference set; the trial must confirm it helps (the doc's tests include narration versus dialogue).

**Extension questions (2026-09-26, recommendation 8):**

- [ ] **Q10. Where does a shared, cross-book reference set live, given `references.json` is project-scoped (`<project>/narration-utils/characters/references.json`, Q7) and a series' books are not necessarily under one parent folder?** (A) A new user-level file, `%APPDATA%/narration-utils/series.json` (per-user, unrelated to any one project), mapping a series id to `{name, memberProjectPaths[]}`; each member project's own `references.json` stays exactly as it is and is merely read across projects when a series is active, so a book worked on alone (the common case, per this PRD's own primary-user framing) is completely unaffected. (B) Copy references into a shared file the narrator has to keep in sync by hand. (C) A required "series project" that owns the data, breaking the "one project at a time" model. Recommendation: (A). Mirrors the established per-user file pattern (`credit-templates.json`, `recent-projects.json`, both `%APPDATA%`-scoped, per docs) rather than inventing project-spanning storage; (B) risks silent divergence and (C) reopens a decision (`docs/README.md` "closing paragraph", per docs: one project at a time) this PRD does not need to reopen.
- [ ] **Q11. Does a series share raw reference clips, or only their calibrated features?** (A) Only calibrated scalar features (the same Q7 answer: no embeddings, no audio) are shared; a book's own approved region stays that book's own data, and the series file stores a reference to which book/character/region produced the shared baseline, not a copy of the audio. (B) Copy the audio across projects. Recommendation: (A), for the same biometric-like-data reason Q7 already settled for one book: sharing audio across projects multiplies where sensitive derived data lives for no analytical benefit, since only the calibrated distribution is what a comparison actually needs.
- [ ] **Q12. Does adding recommendation 8 change the Phase 1 trial's own reject gate?** (A) No: the trial (Phase 1) still runs on one book's corpus, exactly as specified; if it rejects the whole approach, the series extension never has data to share, so Phases 9-11 simply do not start (matches this PRD's own "if rejected, this milestone stops after phase 3" success signal for Phase 1). (B) The trial must include cross-book data before Phases 9-11 can be planned. Recommendation: (A). A cross-book comparison is the same statistical question one book already asks (is a candidate outside an approved reference's distribution), applied to a reference drawn from a different project; it needs no new trial, only Phase 9's own smaller validation that reading a second project's references works.
- [ ] **Q13. How is drift against a series anchor presented, given the roadmap's "evidence, not a verdict" rule (`roadmap.md:67`, per docs) and this PRD's own "neutral measurement wording only" risk mitigation?** (A) Exactly like a same-book finding: a `character_continuity` finding whose reference happens to come from another project in the series, shown with which book and chapter the anchor was approved in, never a "matches/doesn't match the series" score. (B) A new finding category or severity for cross-book drift. Recommendation: (A). No new category or wording is needed; only the evidence's reference source changes from "this book" to "book X of this series," which the mock's own captioning already frames as "evidence for the narrator to judge, not as a verdict."

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
- **Character identity and cues.** Manuscript Guide gains stable ids across rebuilds and merges, dialogue cues (quote span, attributed character or `unknown`, cue evidence, chapter and paragraph ids) and appearance maps, additive to the existing JSON and normalized in `apps/desktop/internal/guide/service.go:71-106` and `normalizeGuideEntity` (`apps/ui/src/api/contracts/storyBible.ts`). The lock guard stays authoritative (ADR 0007).
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

Every phase follows the `CLAUDE.md` workflow: plan (find or open the tracking issue first and put `Closes #<n>` in the PR, `docs/operations/github-workflow.md`), `change-impact-scan` (mandatory for `integrations/reaper` and shared UI), TDD, `full-verification-gate` (`pnpm check`), `design-spec-guard` for primitives or `styles.css`, `feature-cleanup`. Phases that change `apps/ui` also run the Playwright visual suite and the atlas and view every PNG at `desktop`, `small-desktop`, `tablet` and `mobile`. Phases that change bindings bump the host API version in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:39-42` and `apps/ui/src/hostApi.ts:2` (whichever PR lands second increments again; check `hostAPIVersion` at merge time). Phases that change `integrations/reaper` require a user-run manual REAPER checklist. Re-check `docs/adr/` before numbering an ADR (take the next free number at merge time; 0027 at d5cc994). Milestone 1 is the foundation: phases 3, 5 and 6 depend on the findings store and Review page.

| # | Phase | Description | Status | Parallel | Depends | Ports used | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Acoustic feature trial and decision record | Run the documented trial on a permissioned corpus; compare dependency-free features with Praat and Resemblyzer; adopt, defer or reject; calibrate Q6 values | pending | 2, 3 | - | none | - |
| 2 | Stable characters, dialogue cues, appearance maps | Manuscript Guide: stable ids, rules-based cues with `unknown`, appearance maps, corrections that survive rebuild; Go and TS normalization | blocked (see note below) | 1, 3 | - | none | - |
| 3 | Region listing and reference approvals | Go: list project regions with identity, approve and revoke per character, sidecar with snapshot and metadata, no analysis | complete | 1, 2, 4 | RD-1 | none | - |
| 4 | Feature extraction engine | Range-limited pitch, rate, energy and spectral features with analytic-signal tests, per Q1 outcome | pending | 2, 3 | 1, TR-8 (soft) | none | - |
| 5 | Baselines, outliers and findings | Baseline from approved references, candidate location via cues and aligned words, outlier rule, chain-difference check, `character_continuity` findings | pending | - | 2, 3, 4, TR-3, RD-1 | none | - |
| 6 | Character review UI | Bindings, character bible view, region approval, attribution correction, Review character filter, reference-versus-candidate audition, host API bump | pending | - | 5, RD-5, TR-7 (soft) | UI: existing primitives only (predates `studio-ui-primitives.prd.md`) | - |
| 7 | Intentional-change handling, privacy controls and close-out | End-to-end dismiss-with-note semantics, remove voice data action, docs, `roadmap.md` and `roadmap.json` together | pending | - | 6 | none | - |
| 8 | Optional acoustic backend (conditional) | Only if phase 1 adopts Praat or Resemblyzer: catalog entry, license record, first-use gate, packaging, ADR | pending | - | 1, 4 | none | - |
| 9 | Series storage and cross-project reads (Q10, Q11) | New user-level `series.json` (name, member project paths); reading another project's `references.json` and calibrated baseline read-only; a project's own reference data is never written by another project's session | pending | - | 3, 5 | none | - |
| 10 | Series-anchored findings (Q12, Q13) | `character_continuity` findings whose baseline reference names its source book and chapter; no new category, severity or wording | pending | 11 | 5, 9 | none | - |
| 11 | Series voice bible UI | A Series view: characters shared across a series, each with its approved reference clips and which book they came from; per-book drift evidence shown against the series anchor, framed as evidence, never a verdict | pending | 10 | 6, 9, 10 | UI: existing primitives; reuses the reference-versus-candidate audition component from Phase 6 | - |

### Phase Details

**Phase 1 - Acoustic feature trial and decision record**
- **Goal**: Decide from evidence which features work and whether any heavier backend is justified.
- **Scope**: Follow the six-step protocol in `local-dependency-evaluation.md` on 3-5 permissioned chapters, 3-5 differentiated characters plus narration, leave-one-chapter-out; compare hand-computed features against Praat and Resemblyzer outputs; verify the PyTorch and Windows-build assumptions from upstream metadata; record adopt, defer or reject and the calibrated Q6 values in the research document or a follow-up brief. Corpus, audio and outputs stay ignored local data. Needs the user's permission and materials.
- **Success signal**: A written decision with numbers; if rejected, this milestone stops after phase 3 and the roadmap wording is revisited by the user.

**Phase 2 - Stable characters, dialogue cues, appearance maps**
- **Goal**: A trustworthy manuscript-side character model with evidence.
- **Scope**: `manuscript_guide.py` stable ids across rebuild, alias merge and split; quote and cue extraction with `unknown` and evidence; chapter and scene appearance maps; narrator corrections stored so a rebuild never overwrites them; normalization in the Go guide service and TS contract; pytest fixtures for ambiguous cues, overlapping speakers and missing cues; tuning is test-driven as in ADR 0020.
- **Success signal**: Labeled-quote evaluation reported (Q4); ids stable across a rebuild test; `pnpm check` green; Story Bible page unchanged in behavior.
- **Status note (2026-09-26, stream A8):** Not delivered by this stream. This phase's own scope is centered on `sidecars/manuscript-guide/core/manuscript_guide.py` (stable-id reconciliation, rules-based quote/cue extraction) - `docs/prds/implementation-plan.md` §8 assigns all of `sidecars/**` to lane B, not lane A. The only lane-A touchpoint the PRD names (normalization in `apps/desktop/internal/guide/service.go` and the TS contract) has nothing to normalize until the sidecar defines the new fields, so building it now would be speculative scaffolding with no producer or consumer. Flagged on `#509` rather than guessed at or built across the lane boundary; recommend rescoping to lane B (alongside CC-4, already B7's in this wave) or a short lane-A/C follow-up once the sidecar JSON shape is real.

**Phase 3 - Region listing and reference approvals**
- **Goal**: The narrator can approve and revoke references safely, with no analysis yet.
- **Scope**: Region parse (Q3 A) with fixtures from a REAPER-saved project; approvals sidecar with snapshot and "changed since approval" detection; opaque character ids; tests for approve, revoke and orphaned characters; `resetDerived` decision (Q7). No bindings if it can be exercised through tests until phase 6.
- **Success signal**: Fixture and lifecycle tests; unapproved regions demonstrably ignored by any downstream consumer.
- **Delivered (2026-09-26, stream A8):** `apps/desktop/internal/character` (`ListRegions`, `Approve`, `Revoke`, `References`), ADR 0263, `internal/manuscript`'s `resetDerived` extended. No bindings added (deferred to Phase 6 as scoped). "Unapproved regions ignored by any downstream consumer" reads as vacuously true today: Phase 4/5 (the downstream consumers) do not exist yet, so this is re-checked when they land.

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
- **Scope**: Bindings and contract, mock, host API bump, character bible view, region list with play, approve and revoke, attribution correction, Review character filter, reference-versus-candidate audition; new states in the visual catalog; guide updates (the character bible view in `docs/guides/using-the-app/story-bible.md`, the character filter and audition in the Review page, `docs/guides/using-the-app/review.md` added by `RD-5`) and screenshots, keeping `apps/ui/src/docsGuide.test.ts` green.
- **Success signal**: Visual suite and atlas green with four-viewport PNG review; end-to-end on a real chapter.

**Phase 7 - Intentional-change handling, privacy controls and close-out**
- **Goal**: Finish the promises in the acceptance criteria and the docs.
- **Scope**: End-to-end test that a dismissed note persists and does not re-flag identical evidence while changed evidence returns; "Remove voice analysis data" action; docs for the workflow (`docs/workflows/character-continuity.md`) and any new utility page; `docs/README.md`; `roadmap.md` and `config/roadmap.json` updated together (the merge also re-syncs the GitHub milestone description); feature cleanup.
- **Success signal**: The acceptance items carried from the superseded brief (only approved regions affect a baseline; dismissed intentional deviations do not reappear for identical evidence; the four test scenarios in phase 5) demonstrably met; docs and roadmap consistent.

**Phase 8 - Optional acoustic backend (conditional)**
- **Goal**: Add a heavier backend only if evidence demands it.
- **Scope**: Dependency record with code and weight licenses, provenance, hashes and removal path; catalog entry through `apps/desktop/internal/assets`; explicit-Download first-use gate with no download at startup; packaging checks; ADR (a first PyTorch dependency would need one referencing ADR 0008); Praat as a separately installed process.
- **Success signal**: Provisioning acceptance criteria in `first-use-dependency-provisioning.md` met for the new asset; release smoke test passes.

**Phase 9 - Series storage and cross-project reads (extension)**
- **Goal**: A series' books can share calibrated baselines without breaking the one-book-at-a-time model for anyone not using a series.
- **Scope**: `%APPDATA%/narration-utils/series.json` (Q10), read-only cross-project access to another project's `references.json` and its calibrated baseline (Q11: features only, never audio or a copy of the region), no write path from one project's session into another project's own data.
- **Success signal**: Opening a non-series project is behaviourally unchanged (no series file read attempted); a series member project's baseline read tolerates a missing or unreadable sibling project (reported, not fatal).

**Phase 10 - Series-anchored findings (extension)**
- **Goal**: A `character_continuity` finding can cite a reference approved in a different book of the series, with no new finding shape.
- **Scope**: The existing finding's evidence gains the source book/chapter of a cross-book reference (additive to the shape Phase 5 already defined); no new category or severity (Q13).
- **Success signal**: A finding whose reference came from another project renders identically to a same-book finding except for the named source; the roadmap's "evidence, not a verdict" wording is unchanged.

**Phase 11 - Series voice bible UI (extension)**
- **Goal**: A narrator can see a character's references across every book of a series and audition drift against the series anchor.
- **Scope**: A Series view listing characters shared across member projects with their approved clips and source book; reuses Phase 6's reference-versus-candidate audition component; per-book drift shown as evidence, mirroring mock 06's own framing ("shown as evidence for the narrator to judge, not as a verdict").
- **Success signal**: Visual suite and atlas green with four-viewport PNG review; a series with one member project (the common case before a second book exists) shows an empty, honest "no other books in this series yet" state rather than an error.

### Parallelism Notes

Phases 1, 2 and 3 are independent. Phase 4 needs the phase 1 decision but can start against the recommended dependency-free path if the user accepts Q1 A early. Phases 5, 6 and 7 are a strict chain. Phase 8 exists only if the trial says so. **Extension:** Phases 9-11 depend on Phases 3 and 5 (a working single-book reference and finding model) but are otherwise independent of Phase 8's conditional backend; per Q12, if Phase 1's trial rejects the whole acoustic-feature approach, Phases 9-11 simply have no data to share and do not start.

### Parallel-session compatibility

| Phase | Files and areas touched | Likely collisions |
| --- | --- | --- |
| 1 | `docs/research/` addendum, scratch corpus outside the repo | Any session editing `local-dependency-evaluation.md`; needs the user's data and permission |
| 2 | `sidecars/manuscript-guide/core/manuscript_guide.py` and tests, `apps/desktop/internal/guide/service.go`, `apps/ui/src/api/contracts/storyBible.ts` | `RD-3` reads the guide JSON and must tolerate additive fields; any Story Bible work; teleprompter phase 5 reuses entity summaries |
| 3 | New `apps/desktop/internal/*` characters package, possibly `apps/desktop/internal/tracks/parse.go`, `apps/desktop/internal/manuscript/service.go` (`resetDerived`, line 434) | Teleprompter phase 8 and `TR-2` also edit `tracks/parse.go`; every sibling that adds a directory to `resetDerived` |
| 4 | `apps/desktop/internal/measure/*` or a new DSP package | `TR-8` and the diagnostics PRD extend `measure`; agree a single range entry point first |
| 5 | New adapter and analyzer packages, findings store use | Store API changes from `RD-1` |
| 6 | `apps/desktop/bindings.go`, `apps/desktop/app.go` (host API), `apps/desktop/app_test.go`, `apps/ui/src/{hostApi.ts,api/*,components/storybible/*,components/review/*}`, visual catalog, docs images | Every binding and UI phase in any PRD; host API number; nav or screenshot regeneration in the teleprompter final phase |
| 7 | Docs, `docs/roadmap.md`, `config/roadmap.json`, `docs/README.md` | Any milestone-status edit; roadmap files change together and alone |
| 8 | `config/*` catalog, `apps/desktop/internal/assets`, packaging scripts, `pyproject.toml` and `uv.lock` if Python | Release and provisioning work; lockfile churn |
| 9 | new `apps/desktop/internal/series/*` (or similar), a new `%APPDATA%` file alongside `recent-projects.json`/`credit-templates.json` | Any other PRD adding a per-user `%APPDATA%` file (naming, not code, collision) |
| 10 | `apps/desktop/internal/character/*` (or wherever Phase 5's findings adapter lives) | Phase 5's own findings adapter (additive field, not a rewrite) |
| 11 | new `apps/ui/src/components/series/*`, nav entry (land alone per the cross-PRD nav-item rule), visual catalog, docs images | Production Tracking PRD's own "cross-project rollup" Open Question Q6 (that PRD explicitly defers to this one, no code collision expected) |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Character reference analysis uses only clips explicitly approved by the narrator (prior decision) | Baselines from approved references only; the reference set changes only through a deliberate narrator approve or revoke, never by learning from later recordings | Learn from all recordings | `roadmap.md:67`; workflow step 5 |
| No automatic character identification from voice; no acting, emotion or accent judgement (prior decision) | Neutral measurements with evidence | Classifier or verdicts | Retired `character-continuity-review.md` non-goals; local-dependency plan |
| Findings are evidence-based, reviewable, local-first (prior decision) | `character_continuity` findings, no cloud | Cloud analysis | `roadmap.md:10`; findings contract |
| Optional models follow first-use provisioning: catalog, pinned URL, hash, explicit Download, nothing at startup, no silent fallback (prior decision) | Any backend goes through `apps/desktop/internal/assets` | Startup or unpinned downloads | `first-use-dependency-provisioning.md` |
| No dependency without a license and provenance record; GPL tools stay a separate process (prior decision) | Dependency record before adoption | Ad hoc installs | `local-dependency-evaluation.md` |
| Resemblyzer and Praat only in the character-continuity workflow and only with approved clips (prior decision) | Trial first | Adopt early | Adoption order 5 in the dependency plan |
| Measurement lives in Go, hand-written and validated on analytic signals; no third runtime (prior decision, ADR 0025) | Go features for MVP (Q1 A) | New sidecar | ADR 0025 |
| No PyTorch dependency so far; the first would be a deliberate, ADR-recorded cost (prior decision, ADR 0008) | Avoid in MVP | Adopt for embeddings | ADR 0008 context |
| Precision over recall for extraction (prior decision, ADR 0020) | `unknown` on ambiguous attribution | Guess | ADR 0020 |
| Locked entries are enforced server-side (prior decision, ADR 0007) | Corrections and locks honored by the guide backend | UI-only | ADR 0007 |
| Windows-first, REAPER-first, US-English-first (prior decision) | No other platform or language work | Cross-platform now | `docs/README.md` (closing paragraph) |
| Feature engine (proposed, Q1) | Dependency-free Go features, trial before heavier backends | Praat, Resemblyzer, numpy sidecar | Precedent and boundaries |
| Reference identity (decided and implemented, Q2, ADR 0263) | Region GUID plus a name/time-range snapshot taken at approval | Item GUID, line id, resolved source-audio identity now | Baselines stable when regions move; source-audio identity deferred to Phase 4, which is the first phase that needs it |
| Region listing (decided and implemented, Q3, ADR 0263) | Parse the saved `.rpp` in Go, no live bridge command | Lua bridge command, naming convention | Standalone, testable with fixtures; a live command is an option only if this proves inadequate |
| Attribution (proposed, Q4) | Rules-based cues with `unknown` and corrections | BookNLP, manual only | Precision, no PyTorch |
| Stored data (decided and implemented, Q7, ADR 0263) | Approval metadata only (region GUID, snapshot, character id, timestamp, note), no embeddings, no audio | Embeddings | Biometric-like data |
| Phase 2 ownership (2026-09-26, stream A8) | Not delivered by lane A; flagged on `#509` rather than built across the lane boundary or scaffolded speculatively | Build a Go-only stand-in with no producer or consumer; edit `sidecars/manuscript-guide/core/manuscript_guide.py` from lane A | `docs/prds/implementation-plan.md` §8 assigns `sidecars/**` to lane B; CLAUDE.md's workflow does not build for a JSON shape that does not exist yet |
| Series storage (proposed, 2026-09-26, Q10) | A new per-user `%APPDATA%/narration-utils/series.json` naming member project paths | A shared file the narrator syncs by hand; a required "series project" | Matches the existing per-user file pattern; keeps one-project-at-a-time as the default |
| Shared data across a series (proposed, 2026-09-26, Q11) | Calibrated scalar features only, referencing which book/character/region produced them | Copying reference audio across projects | Same biometric-like-data reasoning as Q7, applied across projects instead of within one |
| Series drift presentation (proposed, 2026-09-26, Q13) | Same `character_continuity` finding shape, evidence names the source book | A distinct cross-book category or severity | No new concept needed; only the evidence's source changes |

## Research Summary

**Market Context**: The REAPER research report (`docs/research/reaper-automation-surface.md` section 7, per docs) lists a community script set that includes a character take report; its contents were not inspected, it declares no license, and it should be learned from, not copied. The report does not survey tools that measure character-voice drift against approved references, so market coverage of this feature is TBD - needs research. Nothing in the repo shows narrators asking for this beyond the roadmap itself.

**Technical Context**: The dependency plan's candidates are Resemblyzer (Apache-2.0, pretrained encoder, embeddings that a single narrator's characters will often share), Praat (GPL-3.0-or-later, best kept a separate executable, measures pitch, intensity, formants and duration), and BookNLP (MIT plus separately recorded model artifacts, text-side attribution only); each needs a per-artifact license and provenance record, and none is an implemented dependency (`local-dependency-evaluation.md`, status "Planned evaluation"). The document still describes setup-time downloads for a source checkout and is due an update for release-time first-use provisioning (`first-use-dependency-provisioning.md`). Reusable in-repo pieces: the hand-written, analytically tested DSP approach in `apps/desktop/internal/measure` (ADR 0025), the asset installer in `apps/desktop/internal/assets`, the findings contract and Review page from milestone 1, the persisted aligned words planned in TR-3, the audition component planned in TR-7, and the Story Bible's character entities and evidence model.

**Extension research (2026-09-26):** the benchmark's own recommendation 8 and mock 06 caption ("a comparison of today's reads against the anchor clip... shown as evidence for the narrator to judge, not as a verdict... follows the roadmap's own rule for milestone 3"); the per-user `%APPDATA%` file precedent (`credit-templates.json`, `recent-projects.json`, per docs) reused for `series.json` rather than inventing project-spanning storage.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
*Extended: 2026-09-26 - Phases 9-11 and Open Questions Q10-Q13 added for benchmark recommendation 8; take their recommendation per D22 until the owner says otherwise*

## Visual Spec (extension)

Concept mock copied from [the audiobook studio benchmark](../research/audiobook-studio-benchmark.md#3-what-the-ideal-looks-like-concept-mocks) for Phase 11, **not yet owner-approved as a build spec** — kept under `mockups/character-continuity-review/` marked **concept** until the owner approves it on [#510](https://github.com/countrymanprime/narration-utils/issues/510), per the agent-train wave-0 rule. This PRD had no prior Visual Spec section (no UI phase had reached owner approval yet); this section is new, for the extension only.

![Series voice bible: approved reference clips, voice notes, measured drift evidence against the anchor](mockups/character-continuity-review/06-series-voice-bible-concept.webp)

*Series voice bible (concept)* (`06-series-voice-bible-concept.webp`) — the cross-book reference sharing and per-book drift evidence Phase 11 builds toward. A Mockup check table will be added to Phase 11's own PR once the owner approves it and building against it begins.
