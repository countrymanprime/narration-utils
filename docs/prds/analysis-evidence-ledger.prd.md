# Analysis Evidence Ledger: Item Fingerprints, Analysis Records and Confirmed Track Mapping

**Source:** New work (nothing to supersede). It is the shared foundation under four sibling PRDs: `chapter-stage-recommendations.prd.md` (prefix SR, the umbrella), `recording-coverage-analysis.prd.md` (RC), `editing-readiness-analysis.prd.md` (ER) and `proofing-readiness-signals.prd.md` (PS). It draws on `teleprompter-manuscript-integration.prd.md` (TM, Phase 8 matcher), `diagnostics-delivery-and-cleanup-tools.prd.md` (DX, Phase 1 fingerprint evidence, Phase 8 chapter-track matches), `review-dashboard-and-findings-adoption.prd.md` (RD, Phase 1 findings store and `evidence_version`), `take-review-pickups-duplicates-take-intelligence.prd.md` (TR, Phase 2) and `reaper-automation-follow-through.prd.md` (RF, Phase 14), all on PR #44 and cited as plain file names; and on [Tracks](../utilities/tracks.md), [ADR 0015](../adr/0015-real-progress-only.md), [ADR 0026](../adr/0026-manuscript-line-identity-in-item-extension-data.md) and the [findings contract](../architecture/findings-contract.md). In Depends columns this PRD's phases are bare numbers; other PRDs' phases are `<PREFIX>-n`. Design decisions D1 to D12 are the set's shared decisions (D5, D6, D7 and D8 are owned here).

## Problem Statement

Every signal behind a "suggest this stage is done" recommendation has to answer two questions the app cannot answer today: which audio does this result describe, and is that still the audio the narrator has now? Without an answer, a recommendation is either wrong after the narrator edits (a trimmed-out breath still reported, a moved item still "checked") or empty ("clean" and "never analyzed" look the same). The static project reader sees only item position, length, name and the first source file, so it cannot tell that an item was trimmed, muted or switched to another take, and no analyzer records what it looked at. There is also no stored link between a REAPER track and a manuscript chapter, so every result is attributed by a per-run fuzzy name guess.

## Evidence

Verified in code (paths on `main` at d5cc994):

- **The reader sees too little to fingerprint an edit.** `parseItem` reads `POSITION`, `LENGTH`, `NAME` and the first `<SOURCE>` (`apps/desktop/internal/tracks/parse.go:68-96`); `Item` holds only position, length, name, source kind, file and availability flags (`apps/desktop/internal/tracks/tracks.go:18-26`). It ignores the item `GUID`, `SOFFS`, `PLAYRATE`, item mute, take list and active take. A `SECTION` source is unwrapped and its offsets are dropped (`parse.go:77-84`).
- **The fixture is thin.** `apps/desktop/internal/tracks/testdata/basic.rpp` has an item `GUID` line per item (lines 12, 27, 42) and track `TRACKID` (lines 7, 22, 37), and no `SOFFS`, `PLAYRATE`, `TAKE` or item mute. There is no REAPER-saved project with edits or multiple takes in the repo (TBD - needs a fixture pair from the user).
- **Non-destructive edits leave source media unchanged.** Split, trim and fade change item state only, so a hash of the source file cannot detect them (D6). The Lua manifest already carries `startoffs` and `length*rate` per item for this reason (`integrations/reaper/narration_ui_bridge.lua:151`, `index|source_file|startoffs|length*rate`), so the played range `[SOFFS, SOFFS + LENGTH * PLAYRATE]` is the established unit.
- **A clean analysis leaves no record.** `measure.Evaluate` returns an empty slice for a compliant report (`apps/desktop/internal/measure/profile.go:42-64`); it emits `info` "unavailable" findings only for limited metrics that could not be measured (`:90-95`). Its findings carry `Source.File` only (`:101-114`). `findings.Finding` has no run id, analyzed-at, analyzer version or evidence version (`apps/desktop/internal/findings/findings.go:112-127`), and `StableID` hashes analyzer plus identity parts only (`:184-192`).
- **Transcription is not remembered.** The sidecar keeps `(word, start, end)` in memory (`sidecars/transcript-compare/core/compare.py:485-526`) and deletes chunk files after reassembly, so each compare re-transcribes the whole track. The only persisted result is `.narration-last-comparison.json`, one slot in the project root, overwritten per run, without chapter id, `documentId`, item GUIDs or source hashes (`apps/desktop/internal/transcript/service.go:531-537`).
- **No chapter to track link is stored.** Transcript Compare fuzzy-matches the track name to a chapter title per run (`compare.py:900-955`: exact, token prefix or containment, then `SequenceMatcher` ratio of at least 0.75, else `NEED_CHAPTER`); selection is by title string. The only per-project track state is `Tracks.selectedRpp` in `<project>/narration-utils/settings.json`, a strings-only, tool-scoped file (`apps/desktop/internal/settings/store.go:135-140`).
- **Chapter ids are positional and reset.** Ids are `c-%04d` (`apps/desktop/internal/manuscript/service.go:403`) and regenerate with a new `documentId` on re-import; `resetDerived` (`service.go:434-441`) deletes `ManuscriptGuide/`, `TranscriptCompare/`, `manuscript-notes.json` and `.narration-last-comparison.json`.
- **`/media` serves only the first source per item.** `authorizedMediaPath` allows only the source of each item's first `<SOURCE>` (`apps/desktop/media.go:51-64` over `parse.go:73`), so a second take that points at another file is refused.
- **Atomic-write precedent exists.** `saveNotes` writes a temp file then renames under `notesMu` (`apps/desktop/internal/manuscript/reader.go:258-281`).
- **The saved `.rpp` lags an open project.** REAPER writes the project file on save, so the disk file lags an open, unsaved project (general REAPER behavior; no repo doc states it, TBD - confirm with a REAPER-saved fixture pair). Live editing of the project file is unsafe per the research doc's framing of the file bridge. `GetProjectStateChangeCount` is named in research only; no code calls it.

Per docs and PRDs (not verified in code): the four sibling PRDs each state a requirement on this one (SR: staleness evaluator, confirmed mapping, mapping UI; RC: parser, ledger, cache, mapping, staleness; ER: an analysis key separate from the full fingerprint, sliceable cache entries, extra parser fields; PS: ledger, parser, mapping). TM Phase 8, TR Phase 2 and RF Phase 14 each extend the same parse functions, and RD-1 and DX-1 each define a form of evidence versioning or fingerprinting.

Assumption - needs validation: that REAPER's `.rpp` item chunk carries `SOFFS`, `PLAYRATE`, mute, an active-take index and per-take sources in the shape assumed below. It is a claim about REAPER's format, not verified here (TBD - needs a REAPER-saved fixture with trimmed, muted and multi-take items).

## Proposed Solution

Build a small Go platform, proposed as `apps/desktop/internal/evidence`, plus an extended `apps/desktop/internal/tracks` reader, that gives every analyzer the same five things: (1) a parsed item model rich enough to describe what plays (GUID, source, played range, rate, mute, active take, take list); (2) a source identity, an **analysis key** (what the audio content is) and an **item fingerprint** (what the item is on the timeline); (3) an **analysis ledger** that records every run with its outcome so "clean" differs from "never ran"; (4) a **per-item result cache** keyed by the analysis key so an edit re-analyzes only the item it touched; (5) a narrator-**confirmed track to chapter mapping** and a **staleness evaluator** that answers `current | stale | never` with reasons. Nothing here decides a stage. The evaluator and ledger return facts; the signal PRDs turn them into `met | not_met | unknown` (D2) and SR turns those into a suggestion the narrator confirms (D1).

## Key Hypothesis

We believe recording the exact audio state each result was computed on, and comparing it to the project as saved now, will let a recommendation say "checked, and nothing changed since" or "stale, and here is which item changed" without ever showing a false "done", for narrators who edit in REAPER between checks. We'll know we're right when (a) every edit type in the edit-type table changes the item fingerprint and only the right subset changes the analysis key, (b) a saved-but-unchanged project keeps every fingerprint, (c) a trimmed item is the only item re-analyzed after a trim, and (d) no evaluator result reads `current` when any relevant item, mapping or analyzer version differs.

## What We're NOT Building

| Item | Why |
| --- | --- |
| A second track-to-chapter matcher | The Go matcher is TM Phase 8 (consumed by DX Phase 8). This PRD stores the narrator's confirmation of its suggestion and never scores names itself |
| A findings store, review decisions or `evidence_version` merge | RD Phase 1. The ledger records that a run happened and on what; findings say what was found. They are complementary and reference each other by id |
| Any analyzer, detector, or signal | RC, ER and PS own them. The evaluator returns currentness, not verdicts |
| Chapter status changes or any recommendation UI beyond the mapping confirmation | SR (D1) |
| New Lua in the MVP | Recorded decision: Lua only for now. A live change counter is a Could (Phase 8) with a manual REAPER checklist |
| Tracking unsaved REAPER edits | The saved `.rpp` is the basis; every result states "saved project, file modified <time>" (D6) |
| A cross-project or shared cache, cloud storage, or telemetry | Product boundary (`docs/roadmap.md:10`): local-first, no cloud |
| Multi-track chapters | v1 = one confirmed track per chapter (D5); the store may hold several links, consumers treat that as unknown |
| Editing, moving or deleting `.rpp` files or media | Read-only, as the Tracks page is (`docs/utilities/tracks.md`) |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Edit-type coverage of the fingerprint | Every edit in the table (move, trim start, trim end, split, delete, add, mute, take switch, rate change, source replaced on disk, source touched but identical) yields the specified change to the analysis key and item fingerprint | Table-driven Go tests over fixture pairs, one pair per edit |
| No-op stability | Re-saving a project with no edits, or reordering unrelated `.rpp` chunks, keeps every fingerprint | Go test over a REAPER re-saved pair (TBD - needs fixtures) |
| False "current" | 0 evaluator results of `current` when any relevant item, take, mute, mapping, analyzer version or parameter hash differs | The same table plus property tests over random edit sequences |
| Re-analysis scope after one edit | Only the edited item's cache entry misses; a position-only move misses none | Cache hit and miss counters in ER's Phase 5 measurement and RC's Phase 4 tests |
| Ledger durability | An interrupted write leaves the previous record readable; a `partial` or `failed` run is never read as `complete` | Crash-injection tests on the atomic write |
| Mapping persistence | A confirmed link survives restart, project reopen and an unrelated `.rpp` save; a link to a missing track reads as `mapped_track_missing`, never as a match | Go tests; manual check in the desktop app |
| Evaluation cost on a real project | TBD - needs measurement on a full-book project; must stay usable on Home load | Timed on the corpus project during Phase 6 |
| Gate | `pnpm check` green each phase; visual suite reviewed at four viewports for the UI phase | CI and PNG review |

## Open Questions

- [x] **Q1. What is the hash policy for source files?** Options: (A) size and mtime only; (B) size, mtime and a full content hash; (C) size, mtime and a hash of head, middle and tail blocks. Recommendation: C, with B computed lazily and cached by (path, size, mtime) so a full hash is paid once per file version. A gives no protection against a same-size, same-mtime replacement (rare but silent); B alone on hour-long files costs seconds per file on every Home load. DX Phase 1 needs a fingerprint helper too, so one helper serves both (Q11). **Adopted (C).** `evidence.Identify` (`apps/desktop/internal/evidence/identity.go`, Phase 1) implements the cheap sample; `evidence.FullHash` is the expensive B-style fallback a caller invokes and caches itself - the lazy, cached-by-(path,size,mtime) wrapper Q1 describes is left to the ledger/cache phases (3, 4), not built into this helper.
- [x] **Q2. Which fields count as "edited"?** Options: (A) the analysis key fields plus position, length, mute and active take; (B) A plus item volume, fades and take or track FX presence; (C) A plus a hash of the whole `<ITEM>` chunk. Recommendation: A for the fingerprint, with FX-chain presence recorded as evidence and not part of the fingerprint, because analyses read source audio (ER's processed-audio caveat) and fades or gain do not change what the analyzers measure. C would mark every cosmetic REAPER change stale, which teaches narrators to ignore staleness. **Adopted (A).** `evidence.ComputeItemFingerprint` (`apps/desktop/internal/evidence/fingerprint.go`, Phase 2) hashes the analysis key plus GUID, position, length, mute and active-take index; item volume, fades and FX-chain presence are not inputs. One gap carried over from Phase 1: the analysis key's "playrate and reverse" (Solution Detail) is computed as source identity, played range and play rate only - `tracks.Take` has no `Reverse` field yet (the `PLAYRATE` line's reverse/pitch fields beyond the rate are unverified by any fixture per `testdata/reaper/README.md`), so no reversed-item case exists to test against; add it to the take model and this key together once a reversed-item fixture exists.
- [x] **Q3. Where do ledger records live and how long are they kept?** Options: (A) one JSON file per record under `<project>/narration-utils/analysis/ledger/`, latest per (analyzer, chapter) plus any record referenced by a confirmation or dismissal; (B) one append-only JSONL file; (C) inside `manuscript-notes.json`. Recommendation: A, because a confirmation stores ledger record ids as its basis (D4) so those records must outlive newer runs, and per-file records give atomic writes and simple pruning. C is ruled out: `normalizeNotes` drops unknown keys (`reader.go:286-302`). Add the directory to `resetDerived`. **Adopted (A).** `evidence.LedgerStore` (`apps/desktop/internal/evidence/ledger.go`, Phase 3) writes one JSON file per record under `evidence.LedgerDir` (temp-file-then-rename, the `saveNotes`/`SaveHints` pattern), and `LedgerStore.Retain(referencedIDs)` keeps the latest record per (analyzer, chapter) plus every referenced ID, deleting the rest. `manuscript.resetDerived` now includes `evidence.LedgerDir`.
- [ ] **Q4. What makes a signal "current" in v1?** Options: (A) a `complete` chapter-level record whose fingerprints equal the current ones; (B) A, or every item's cache entry present and current even without a chapter record; (C) any item-level union. Recommendation: A. It has one clear rule to test and to explain in the evidence view; B lets a signal become `met` from parts nobody ran together (different parameter hashes, different scopes). Revisit B only if re-running a whole chapter after a one-item edit proves too slow, which the per-item cache should already prevent.
- [x] **Q5. What does the cache store: per-source features or per-range results?** Options: (A) per-source features (silence runs over the whole source, transcript words over the whole source) sliced to the played range on read; (B) per-range results keyed by played range. Recommendation: A where the analyzer can slice, because a trim changes the played range and would miss every B entry, while a whole-source entry survives it (ER Phase 5 measures the cost). The store stays opaque: entries are blobs under a key (source identity, analyzer version, parameter hash), plus an optional played range for B-style analyzers. RC's words files already follow this shape (RC Phase 3). **Adopted (A).** `evidence.CacheStore` (`apps/desktop/internal/evidence/cache.go`, Phase 4) keys a sliceable entry by (source identity, analyzer version, parameter hash) with no played range, so it survives a trim; `SliceFeatures` slices a whole-source blob to an item's played range on read. A `PlayedRange`-keyed entry (option B) is kept as an explicit fallback field on `CacheEntryKey` for an analyzer that cannot slice.
- [ ] **Q6. What is the mapping's shape and identity?** Options: (A) `trackGuid -> chapterId` in a new `narration-utils/chapter-track-map.json`, keyed by manuscript `documentId`, holding chapter title and confirmedAt beside the id; (B) store in `settings.json`; (C) store in REAPER track extension data. Recommendation: A. B is strings-only and tool-scoped; C needs Lua (recorded decision) and is per-project-file. Because chapter ids reset on re-import, the map is derived state cleared by `resetDerived`, and the stored chapter title lets the app re-suggest the link after a re-import instead of asking again (Q9).
- [ ] **Q7. Where does the mapping confirm UI live?** Options: (A) an inline prompt wherever a check needs it (Home row "Check recording", the evidence view) plus a full list on the Tracks page; (B) the Tracks page only; (C) Home only. Recommendation: A. The need appears while checking a chapter, but the whole picture (which tracks are unlinked, which links point at missing tracks) belongs on the Tracks page, which already lists tracks (`docs/utilities/tracks.md`). SR Phase 9 adds the hint there.
- [ ] **Q8. How is an unsaved project labeled?** Options: (A) always show "saved project, file modified <time>"; (B) A plus a warning when the `.rpp` is older than the newest ledger record or than a source file; (C) also poll REAPER for its change count (Lua). Recommendation: B. The warning is cheap and catches the common case (record, edit, run check without saving); C is the Phase 8 Could and needs a running REAPER, which the standalone launch does not have.
- [ ] **Q9. What happens to mappings and records on manuscript re-import?** Options: (A) both are cleared by `resetDerived`, and the mapping is re-suggested from stored chapter titles for confirmation; (B) mappings survive and are re-pointed by title; (C) everything survives keyed by `documentId` and is ignored on mismatch. Recommendation: A. Re-import changes chapter ids and possibly text; auto re-pointing links would be a silent guess (D5), while re-suggesting costs one click per chapter.
- [x] **Q10. Do we extend `/media` for takes that are not first?** Options: (A) yes, authorize every take source of each item in the selected project; (B) only the active take's source; (C) not in this PRD. Recommendation: B, done in Phase 1 with the parser, because ER's audition and RC's play-from-region need the active take's source and authorizing all takes widens a security boundary (ADR 0012) for no current need. TR Phase 2 asks for all takes; it can extend from B. **Adopted (B), delivered in Phase 1**: `item.SourceFile` now resolves to the active take, so `authorizedMediaSource` (unchanged) authorizes only it; a test proves an inactive take's source is refused.
- [x] **Q11. Who owns the parser and the fingerprint helper?** Options: (A) EL Phase 1 lands the superset item model first, and TM Phase 8, TR Phase 2 and RF Phase 14 rebase onto it; EL Phase 2 owns `SourceIdentity` and DX Phase 1 calls it; (B) TM Phase 8 lands first (it needs `SOFFS` and `PLAYRATE` for recorded end) and EL extends; (C) each keeps its own. Recommendation: A, because four PRDs edit the same `parseItem` and one superset with one fixture set avoids four textual conflicts and four slightly different `Item` shapes. If TM Phase 8 must ship first, it lands only the `SOFFS` and `PLAYRATE` fields with the names used here. **Adopted (A).** EL Phase 1 (this PR) lands first, before TM Phase 8, TR Phase 2 or RF Phase 14 have touched `parseItem`. One deviation from option A's own text: `SourceIdentity` was built in Phase 1, not Phase 2, because the dispatching brief asked for it explicitly to unblock DX Phase 1 sooner; the analysis key and item/track fingerprint, which option A also implies come with `SourceIdentity`, stayed in Phase 2 as the phase table already specified.
- [ ] **Q12. Is the live change counter worth having?** Options: (A) never; (B) a Could that reads `GetProjectStateChangeCount` through the file bridge when REAPER is running, shown as "project changed since this check"; (C) required. Recommendation: B, after everything else ships. Per docs it is coarse (any change increments it) and needs Lua with a manual checklist, and nothing in the MVP depends on it.

## Users & Context

**Primary User**

- **Who**: An engineer building or reviewing the signal PRDs (RC, ER, PS) and SR's engine; the narrator is the indirect user, who sees a mapping prompt and a basis label.
- **Current behavior**: Each analyzer would invent its own "did the audio change" test and its own chapter guess.
- **Trigger**: A signal needs to know what audio a result describes and whether it is still current.
- **Success state**: One API answers `current | stale | never` with reasons, one link per track is confirmed once, and re-analysis after an edit costs one item.

**Job to Be Done**: When I edit a chapter and come back to a recommendation, I want the app to know exactly what I changed and re-check only that, so that a suggestion is never based on audio I no longer have.

**Non-Users**: Distributors and reviewers receiving reports (report export is DX); Audacity users (no `.rpp`).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Notes |
| --- | --- | --- |
| Must | Extended item model from the saved `.rpp`: item GUID, source, `SOFFS`, `PLAYRATE`, mute, take list, active take, `SECTION` offsets | Phase 1; needs a REAPER-saved fixture (TBD) |
| Must | `SourceIdentity`, analysis key, item fingerprint, played range | Phase 2 (D6) |
| Must | Analysis ledger with `complete`, `partial`, `failed` outcomes | Phase 3 (D7) |
| Must | Per-item result cache keyed by the analysis key | Phase 4 (D8) |
| Must | Narrator-confirmed `trackGuid -> chapterId` store and bindings | Phase 5 (D5) |
| Must | Staleness evaluator returning `current`, `stale` or `never` with typed reasons and a recomposable flag | Phase 6 |
| Should | Mapping confirm UI (prompt and Tracks page list) | Phase 7 |
| Should | Active take's source served by `/media` | Phase 1 (Q10) |
| Should | Warning when the saved project is older than the last check or a source | Phase 6 (Q8) |
| Could | Live change counter through the bridge | Phase 8 (Q12) |
| Could | Several tracks per chapter | Reopen with SR Q9 |
| Won't | Matcher, findings store, analyzers, recommendations, new Lua in the MVP, cloud | See table above |

### MVP Scope

Phases 1 to 6 are the platform the signal PRDs consume, with Phase 5 adding the mapping bindings. Phase 7 is the mapping UI, needed before a narrator can confirm links without a developer console; the platform can be built and tested against a hand-written mapping file until then. Phase 8 is optional.

### Data model (proposed, names not final)

- **`ItemState`**: `GUID`, `TrackGUID`, `Position`, `Length`, `Muted`, `ActiveTake`, `Takes[]` of `{Source, SOFFS, PlayRate, Reverse}`, plus FX-chain presence and stretch-marker count as evidence. Field names and REAPER's serialization are an assumption (TBD - needs a REAPER-saved fixture).
- **`SourceIdentity`**: project-relative path when inside the project folder else absolute, `Size`, `ModTime`, `ContentHash` per Q1.
- **Analysis key**: hash of `SourceIdentity`, the played range `[SOFFS, SOFFS + LENGTH * PLAYRATE]`, playrate and reverse. Excludes position, mute and active take index, so a position-only move is a cache hit.
- **Item fingerprint**: hash of the analysis key plus `GUID`, position, length, mute and active take. **Track fingerprint**: the ordered item fingerprints of the chapter's unmuted audio items.
- **Ledger record**: `id`, `analyzerId`, `analyzerVersion`, `paramHash`, `scope{documentId, chapterId, trackGuid, itemGuids[]}`, `fingerprint{trackFingerprint, itemFingerprints, analysisKeys}`, `projectFile{path, modTime}`, `startedAt`, `completedAt`, `outcome`, `counts`.
- **Evaluator result**: `state` of `current`, `stale` or `never`; `reasons[]` (`item_added`, `item_removed`, `item_trimmed`, `item_moved`, `item_muted`, `take_switched`, `source_changed`, `analyzer_changed`, `params_changed`, `mapping_changed`, `mapped_track_missing`, `project_unreadable`); `recomposable` (true when only position, mute or order changed and every analysis key still has a cache entry); the record; and the changed item GUIDs.

### Edit-type table (Phase 2 acceptance)

| Edit | Analysis key | Item fingerprint | Evaluator |
| --- | --- | --- | --- |
| Move item in time | same | changes | `stale`, `item_moved`, recomposable |
| Trim start or end | changes | changes | `stale`, `item_trimmed` |
| Split item | changes for both halves (new GUID for one) | changes | `stale`, `item_added` and `item_trimmed` |
| Delete or add item | none or new | track fingerprint changes | `stale` |
| Mute or unmute | same | changes | `stale`, `item_muted`, recomposable |
| Switch active take | changes | changes | `stale`, `take_switched` |
| Change playrate | changes | changes | `stale`, `item_trimmed` |
| Source replaced on disk | changes | changes | `stale`, `source_changed` |
| Source touched, identical content | changes only if the hash policy sees it (Q1) | same | `current` under B or C |
| Cosmetic change (color, name, notes) | same | same | `current` |
| Re-save with no edits | same | same | `current` |

### User flow

1. A signal PRD's job finishes an analysis over a chapter's items. It writes cache entries, then one ledger record with the fingerprint it ran on.
2. Later, SR or a signal asks the evaluator for the chapter. The evaluator reads the saved `.rpp`, computes the current fingerprints, finds the latest record and compares.
3. `current` lets the signal read its result. `stale` with `recomposable` lets it re-evaluate from the cache without decoding. `stale` otherwise, or `never`, becomes `unknown` with the reason, and the narrator re-runs the check, which re-analyzes only the missed entries.
4. For a chapter without a confirmed link, the first check shows a mapping prompt seeded by TM Phase 8's suggestion; the narrator confirms once.

## Technical Approach

**Feasibility**: HIGH for the identity, fingerprint, ledger, cache and mapping store (pure Go, existing atomic-write and job patterns). MEDIUM for the parser extension, because REAPER's serialization of takes, `SECTION` offsets and mute is unverified without fixtures. The evaluator is HIGH once the edit-type table exists.

**Architecture Notes**

- **Packages.** `apps/desktop/internal/tracks` gains the extended parse (additive fields on `Item`; existing consumers, `apps/desktop/tracks.go` and `apps/desktop/media.go`, keep working). New `apps/desktop/internal/evidence` holds identity, fingerprint, ledger, cache, mapping and evaluator, so signal packages import one small API.
- **Deterministic hashing.** Fingerprints hash a canonical encoding of only the listed fields (sorted, fixed precision for times), never the raw chunk text, so a re-save that reorders chunks or changes cosmetic fields keeps them. The time precision is TBD - depends on how REAPER rounds when re-saving; measure on the fixture pair.
- **Storage.** Everything lives under `<project>/narration-utils/`: `analysis/ledger/`, `analysis/cache/`, and `chapter-track-map.json`. Writes are temp file then rename (as `saveNotes`, `reader.go:258-281`) under a mutex. Each entry carries a schema version; an unknown version is treated as absent, never as an error the narrator has to fix.
- **Cache blobs are opaque.** The store keys and stores bytes; RC's words files and ER's silence and click features define their own formats (D8). Retention: entries not referenced by a current ledger record or a confirmation are pruned oldest-first past a size bound (TBD - measure on the corpus).
- **Evaluator is a pure read.** It never starts analysis (SR Q12) and never writes. Cost is one `.rpp` parse plus a stat per source; with the hash policy of Q1 a full content hash is computed only when size or mtime changed.
- **Bindings.** Mapping list, confirm and clear, plus a currentness read for the UI's basis label. Each binding phase bumps `hostAPIVersion` in `apps/desktop/app.go`, `apps/desktop/app_test.go` and `apps/ui/src/hostApi.ts` and regenerates `apps/ui/wailsjs/go/main/Host.{js,d.ts}`. Service pointers follow the `h.services()` accessor pattern (`docs/architecture/host-binding-concurrency.md`).
- **`/media`.** Phase 1 extends `authorizedMediaPath` to the active take's source (Q10), with a test that a source not referenced by the selected project is still refused.
- **Standalone.** Nothing here needs REAPER. The Lua bridge is untouched in the MVP.

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| REAPER's `.rpp` serialization differs from the assumed shape (take list, mute, `SECTION` offsets, rate) | High | Fixtures from real REAPER saves before Phase 1 merges; unknown shapes yield a typed `unknown` reason, never a guess |
| A fingerprint too sensitive marks every save stale | Medium | Canonical field set only (Q2); no-op stability test; cosmetic-change row in the edit table |
| A fingerprint too lax reads `current` after a real edit | Medium | Edit-type table and property tests; the failure that matters, so any doubt errs to `stale` |
| Full content hash cost on hour-long files | Medium | Q1 recommendation C plus lazy full hash cached by (path, size, mtime); measure |
| Four PRDs collide in `parse.go`, `resetDerived` and `app.go` | High | Q11: EL Phase 1 first; `resetDerived` is one slice literal, so expect textual conflicts and agree an order |
| Ledger records pruned while a confirmation still references them | Medium | Retention keeps referenced ids (Q3); SR's store calls `Retain` |
| Saved `.rpp` older than the analysis | High | Q8 warning and the basis label on every result |
| Stored mapping points at the wrong chapter after re-import | Medium | Q9 option A: cleared, then re-suggested for confirmation |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Item model and parser extension | GUID, `SOFFS`, `PLAYRATE`, mute, take list, active take, `SECTION` offsets, FX and stretch evidence; fixtures; active-take `/media` | complete | 3, 5 | - | - |
| 2 | Source identity, fingerprint and analysis key | `SourceIdentity`, played range, analysis key, item and track fingerprints, hash policy, edit-type table tests | complete | 3, 5 | 1; called by DX-1 | - |
| 3 | Analysis ledger | Record type, per-file atomic store, retention API, `resetDerived` entry, crash tests | complete | 1, 2, 5 | - | - |
| 4 | Per-item result cache | Opaque keyed store, size-bounded pruning, hit and miss counters, `resetDerived` entry | complete | 5 | 2, 3 | - |
| 5 | Confirmed chapter-track mapping | `chapter-track-map.json` store keyed by `documentId`, suggestion adapter over TM-8, list/confirm/clear bindings, contract, mock, host API bump | pending | 1, 2, 3, 4 | TM-8 (suggestions), 3 | - |
| 6 | Staleness evaluator | `current`, `stale` or `never` with reasons and recomposable flag, saved-project warning, basis builder for SR | pending | 7 | 2, 3, 4, 5 | - |
| 7 | Mapping confirm UI and close-out | Inline prompt, Tracks page list, states, docs, screenshots, ADR, `docs/utilities/tracks.md` update | pending | - | 5, 6 | - |
| 8 | Live change counter (Could) | Bridge read of the project change count, "changed since this check" label, manual REAPER checklist | pending | - | 6, RF (bridge plumbing) | - |

### Phase Details

**Phase 1 - Item model and parser extension** (complete)
- **Scope**: Extend `parseItem` and `Item` additively with the fields above (`parse.go:68-96`, `tracks.go:18-26`), unwrap `SECTION` with its offsets instead of dropping them, expose the active take's source to `/media` (Q10), and add REAPER-saved fixtures. Change-impact scan first: `apps/desktop/tracks.go`, `apps/desktop/media.go` and their tests are the consumers; the parser has no Lua consumers. Fields whose serialization is unverified return a typed unknown, not a default.
- **Delivered**: `Item` gained `GUID` (from `IGUID`, falling back to the legacy fixture's single `GUID` line), `Muted`, `ActiveTake`, `Takes []Take` and `Ext map[string]string`, all `json:"-"` so the `TracksList` wire contract (`tests/fixtures/contracts/tracks-project.json`) is unchanged; `Position`/`Length`/`Name`/`SourceKind`/`SourceFile`/`SourceAvailable`/`Supported` now describe the *active* take, not the first one. `Take` holds `GUID`, `Name`, source fields, `SOFFS`, `PlayRate`, `Section *SectionOffsets`, `HasFXChain`, `StretchMarkerCount` and its own `Ext`. `Track` gained `HasFXChain` (also `json:"-"`). The parser splits an `<ITEM>` chunk into takes by walking a new ordered `node.sequence` (chunk.go), since REAPER has no per-take chunk - a take is a run of repeated scalar lines (`NAME`, `SOFFS`, `PLAYRATE`, `GUID`, `SM`) and child chunks (`<SOURCE>`, `<TAKEFX>`, `<EXT>`) delimited by a bare `TAKE` line. `<EXTI>`/`<EXT>` extension data, including `<BIN>` base64 blocks, is decoded by a new `extension.go`. `apps/desktop/media.go`'s `authorizedMediaSource` needed no code change: it already authorizes by `item.SourceFile`, which now resolves to the active take (Q10, verified by a new test that an inactive take's source is refused). Tested against the real REAPER-saved fixtures (`testdata/reaper/`): multi-take (active-take resolution, per-take GUIDs), muted, `SECTION` offsets, `PLAYRATE`/stretch markers, FX chains (track and take), and item/take extension data including the hostile-value and `<BIN>` cases. `internal/tracks` coverage 96.0% (floor raised from 94 to 96 in `scripts/ci/coverage-floors.json`).
- **Also delivered, ahead of Phase 2 (a deliberate scope decision - see below)**: a standalone `SourceIdentity` helper in a new `apps/desktop/internal/evidence` package (Q1's hash policy, option C: size, modification time and a head/middle/tail block hash via `Identify`, plus a full-content `FullHash` for the expensive fallback), so DX Phase 1 (not yet started) has it to reuse per Q11(a). It does **not** include the analysis key, played range or item/track fingerprint - those stay Phase 2's, since they need the edit-type table and canonical encoding this PRD's Phase 2 section defines. Coverage 88.6% (floor 88).
- **Success signal**: Fixture pairs parse to the expected states; existing `tracks` and `media` tests pass unchanged; a source not in the selected project is still refused; multi-take items resolve the active take, not the first source.

**Phase 2 - Source identity, fingerprint and analysis key**
- **Scope**: `SourceIdentity` with the Q1 policy, the played-range function, the analysis key, item and track fingerprints over a canonical encoding, and the edit-type table as tests. One exported helper that DX Phase 1 reuses for finding evidence.
- **Success signal**: Every row of the edit-type table passes; a no-op re-save keeps all fingerprints; a property test over random edit sequences never yields an unchanged fingerprint after a change to a listed field.

**Phase 3 - Analysis ledger**
- **Scope**: Record type (D7), one file per record under `narration-utils/analysis/ledger/`, latest lookup by (analyzer, scope), a `Retain(ids)` call for SR's confirmations, `partial` and `failed` outcomes, and the `resetDerived` addition (`service.go:434-441`).
- **Success signal**: Kill-mid-write leaves the previous record intact; a `partial` or `failed` record is never returned as current; referenced records survive pruning.

**Phase 4 - Per-item result cache** (complete)
- **Scope**: Opaque blob store under `narration-utils/analysis/cache/`, key (source identity, analyzer version, parameter hash) plus an optional played range (Q5), atomic writes, bounded pruning, hit and miss counters exposed for tests and ER's measurement, and the `resetDerived` addition.
- **Success signal**: A second identical run reads every entry; a position-only move misses none; deleting one entry misses only that item; a corrupt or unknown-version entry reads as a miss.
- **Delivered**: `evidence.CacheStore` (`apps/desktop/internal/evidence/cache.go`) implements Q5's recommendation (option A): `CacheEntryKey` is (`SourceIdentity`, `AnalyzerID`, `AnalyzerVersion`, `ParamHash`) with an optional `*PlayedRange`, and deliberately excludes `SourceIdentity.ModTime` (same reasoning as `AnalysisKey`, fingerprint.go) so a merely-touched source does not invalidate an entry. A key with no `PlayedRange` is a whole-source, sliceable entry that survives a trim (its key never changes when only the played range does); a key with `PlayedRange` set is the B-style, non-sliceable fallback, which a trim correctly invalidates. `Write`/`Read` follow `LedgerStore`'s temp-file-then-rename and `persist.Reporter`-backed unknown-version-reads-as-absent pattern; `Read` also increments exported `Hits`/`Misses` counters. `Delete` and size-bounded, oldest-first `Prune(maxBytes)` round out the store. `TimedFeature` (`Start`, `End`, opaque `Payload`) and `SliceFeatures(features, played)` are the generic helper a sliceable analyzer's cache reader calls to select the entries visible in an item's current played range, without the store itself ever looking inside a blob (D8). `manuscript.resetDerived` now also clears `evidence.CacheDir`. Coverage 92.0% (floor 92, unchanged from Phase 3).

**Phase 5 - Confirmed chapter-track mapping**
- **Scope**: The store (Q6), a suggestion adapter that calls TM Phase 8's matcher and returns candidates without persisting them, bindings for list, confirm and clear, TypeScript contract, mock and `wailsClient` adapter, host API bump, `resetDerived` addition, and re-suggestion from stored titles after re-import (Q9). Links to a missing track read as `mapped_track_missing`.
- **Success signal**: A link survives restart; an unconfirmed suggestion is never treated as a link; re-import clears links and offers re-suggestions; two links to one chapter are reported as such for SR.

**Phase 6 - Staleness evaluator**
- **Scope**: Given a chapter, an analyzer id and parameter hash, read the saved `.rpp`, compute current fingerprints, find the latest record and return the evaluator result (data model above), the Q8 warning, and the basis value SR stores (`ledgerRecordIds`, track fingerprint, project file modified time; the modified time is excluded from any equality key so a re-save keeps dismissals, per SR's determinism metric).
- **Success signal**: Every edit-type row maps to its specified state and reasons; never reads `current` on any mismatch; a re-save with identical fingerprints reads `current`; evaluation time on the corpus project recorded.

**Phase 7 - Mapping confirm UI and close-out**
- **Scope**: An inline mapping prompt reusable from Home rows and evidence views, a Tracks page list showing linked, unlinked and missing-track states, `state-catalog.ts` rows and drivers, stories for any new primitive, `docs/utilities/tracks.md` and `docs/guides/using-the-app` updates with screenshots, ADRs for the fingerprint and ledger decisions (`adr-author`), and `feature-cleanup`.
- **Success signal**: The narrator confirms a link in two clicks and it persists; all states reviewed at four viewports; `pnpm check` and the Playwright visual suite green.

**Phase 8 - Live change counter (Could)**
- **Scope**: A bridge command that returns REAPER's project change count, stored in the ledger record at run time and compared later; label "project changed since this check". Lua only, manual REAPER checklist, no automated test.
- **Success signal**: Checklist passes in REAPER; the app degrades to the saved-project basis when REAPER is not running.

### Parallelism Notes

Phase 1 comes first and unblocks the parse-dependent parts of 2 and 5; Phases 3 and 4 need only the record and key types and can run beside 1 and 2 against fakes. Phase 5 needs TM Phase 8's matcher for suggestions but can ship the store and bindings with an injected suggester. Phase 6 needs 2 to 5. Phase 7 needs 5 and 6. The signal PRDs can start against Phase 2's types and the interfaces of Phases 3 and 4 before the parser lands. Phase 8 is last and optional.

### Parallel-session compatibility

| Phase | Files touched | Who else collides |
| --- | --- | --- |
| 1 | `apps/desktop/internal/tracks/{parse.go,tracks.go,chunk.go,testdata/*}`, `apps/desktop/media.go` and its tests | TM Phase 8, TR Phase 2, RF Phase 14 (all edit the same parse functions and fixtures): land this first or rebase; ER Phase 2 if it adds fields |
| 2 | New `apps/desktop/internal/evidence/*` | DX Phase 1 (fingerprint helper: agree the one helper) |
| 3 | `apps/desktop/internal/evidence/*`, `apps/desktop/internal/manuscript/service.go` (`resetDerived` slice, `:434-441`) | RD Phase 1, SR Phase 2 and PS Phase 4 add to the same slice literal: textual conflicts, agree an order |
| 4 | `apps/desktop/internal/evidence/*`, `resetDerived` | RC Phase 3 (words files), ER Phases 3 and 4 (features) as consumers, not editors |
| 5 | `apps/desktop/internal/evidence/*`, `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/contracts/*,api/mockApi.ts,api/mockFixtures.ts,api/wailsClient.ts}`, `apps/ui/wailsjs/go/main/Host.*` | Every phase in every PRD that adds a binding: host API number is a merge-time serialization point (second to merge rebases and bumps again); TM Phase 8 and DX Phase 8 (mapping consumers) |
| 6 | `apps/desktop/internal/evidence/*` | SR Phases 1 and 3 (consume the evaluator; agree the basis type) |
| 7 | `apps/ui/src/components/tracks/*`, a small mapping prompt component, Home row hooks, `tests/visual/{state-catalog.ts,app.spec.ts,app.drivers.ts,doc-screenshots.json}`, `docs/images/ui/*`, `docs/utilities/tracks.md`, `docs/guides/using-the-app/*` | SR Phases 5 and 9 (Home, Tracks page hint), DX Phase 8 and TM Phase 8 (Tracks page work), RC Phase 6 (mapping prompt reuse) |
| 8 | `integrations/reaper/narration_ui_bridge.lua` (dispatch chain), `apps/desktop/internal/bridge/*`, manual checklist doc | Every Lua PRD (RD Phase 6, RF, TR, TM Phases 11 and 12, DX Phase 10): the `if/elseif` dispatcher is a guaranteed conflict spot |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Two keys, not one | Analysis key (content) and item fingerprint (timeline) | One fingerprint | A position-only move must not force a re-decode (ER's requirement) |
| Fingerprint fields (proposed) | Analysis key plus position, length, mute, active take | Whole `<ITEM>` chunk hash | Cosmetic changes must not read as edits (Q2) |
| Currentness rule (proposed) | A `complete` chapter record at equal fingerprints | Union of item cache entries | One explainable rule; no result assembled from unrelated runs (Q4) |
| Ledger location | One file per record under `narration-utils/analysis/ledger/` (delivered Phase 3, `evidence.LedgerStore`) | JSONL; `manuscript-notes.json` | Confirmations reference record ids; `normalizeNotes` drops unknown keys |
| Mapping store (proposed) | `chapter-track-map.json` keyed by `documentId` | `settings.json`; REAPER extension data | Structured state; no Lua; cleared with the manuscript |
| Matcher | Consume TM Phase 8; store confirmations only | Build another | One matcher (D5) |
| Unconfirmed fuzzy match | `unknown`, never `met` | Use a match at or above 0.75 | A wrong chapter reads as a false "done" (D2) |
| Lua in MVP | None; live counter is a Could | Bridge counter first | Recorded decision: Lua only for now |
| Basis of every result | Saved project plus its modified time | Live REAPER state | Standalone launch has no REAPER |
| Parser ownership (proposed) | EL Phase 1 lands first; TM, TR, RF rebase | Each PRD extends separately | One `Item` shape and one fixture set (Q11) |
| `SourceIdentity` built in Phase 1, not Phase 2 | A small, standalone helper (`apps/desktop/internal/evidence.Identify`/`FullHash`) lands with the parser superset | Wait for Phase 2 (Q11 option A's literal text) | The dispatching brief asked for it explicitly so DX Phase 1 has it sooner (Q11a); it is self-contained and does not touch the item/track fingerprint or analysis key, which stayed in Phase 2 as planned |
| Workflow (prior decision, CLAUDE.md) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup | Fast check only | History of silent regressions |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |

## Research Summary

**Market context**: Not applicable; this is internal infrastructure with no user-facing product analogue. A DAW project file as the source of truth, with a saved file that can lag the open session, is the same constraint the Tracks page already lives with.

**Technical context**: The reader and its fixture, the atomic-write precedent, `resetDerived`, and the fingerprint-related lines in the siblings were checked against `main` at d5cc994 on 2026-09-19. Not verified: REAPER's serialization of takes, mute, `SOFFS` and `PLAYRATE` beyond the Lua manifest's `startoffs|length*rate` shape (a claim about REAPER's format; needs fixtures), the `app.go` job-pattern lines that DX cites, and any performance figure. The time-value precision that keeps fingerprints stable across REAPER re-saves is TBD - needs the fixture pair.

**Sibling requirements reconciled here**: SR (staleness evaluator, confirmed mapping, basis without modified time in equality keys, mapping UI on the Tracks page), RC (cache key computed in Go, sidecar reads and writes by path; ledger record per run; unknown for multi-take before the active-take parse), ER (two keys, sliceable entries, extra parser fields, typed reasons per item), PS (ledger record on Compare ingest, mapping, parser for project markers) and TM, TR, RF, DX, RD (parser and helper ownership, Q11).
