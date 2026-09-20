# Audiobook Credits Templates

**Source:** user request of 2026-09-20 (item 2): audiobooks carry opening and closing credits that vary by narrator and contract; the app should ship standard templates, let the user add their own, and support tokens such as `[Title]. Written by [Author]. Read by [Narrator]. Copyright by [Copyright].` that are filled from project and user data, shown as the narrator will read them, and counted in the total time. Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet. Related: [project-workspace-and-daw-link.prd.md](project-workspace-and-daw-link.prd.md) (the project manifest, W1), [teleprompter-manuscript-integration.prd.md](teleprompter-manuscript-integration.prd.md).

## Problem Statement

The app models only the chapters a manuscript contains. Opening and closing credits, which every published audiobook has and which the narrator reads aloud, exist nowhere: no place to write them, no fill-in from project data, no way to read them on the teleprompter, and no time in the audiobook estimate.

## Evidence

- **No project metadata exists.** `manuscript.json` holds `schemaVersion, documentId, importedAt, importer{format,version}, source{fileName,sha256,storedPath}, chapters, paragraphs` (`shell/internal/manuscript/service.go:431`): no title or author. `docx.go:216-217` reads only `word/styles.xml` and `word/document.xml`, not `docProps/core.xml` (title and creator). `classifyPreHeading` has a cover heuristic (first 1-3 short lines are "Cover" if line 2 starts with "by " or contains "copyright" or "author", or line 1 starts with "title:"; otherwise "Front Matter", `importer/model.go:52-68`), so cover lines could seed suggested Title, Author and Copyright as unverified values. `Bootstrap.projectName` is REAPER's project name or the folder basename (`shell/app.go:439`, `shell/bindings.go:196-202`), a label and not a book title; `manuscript.sourceName` is a file name (`api/contracts/system.ts:19`). Nothing in `shell/` or `shared/ui/src` stores narrator, author, copyright, publisher or ISBN.
- **"Opening" is taken.** `contentKind: "opening"` means Front Matter (ADR 0004); "Opening Credits" was floated as its label and rejected as "not standard" (`docs/adr/0004-front-matter-naming.md:8-10`). Credits must not reuse that kind.
- **Settings store cannot hold a list of templates.** Layers are project (`<project>/narration-utils/settings.json`), global (`%APPDATA%\narration-utils\global-settings.json`) and repo defaults (`shell/internal/settings/store.go:24-35,135-149`); `readTool` keeps only string values (`:150-160`), so structured data is dropped; `fieldSchemas` (`shell/app.go:673-679`) validates only `choice` and `color` (`:718-722`); the UI already allows a `text` kind (`system.ts:7`, `ScopedSetting.tsx:68-69`), single-line only; `builtinDefaults` (`store.go:36-42`) must mirror `shared/config/defaults.json`. A narrator name fits a flat global `text` setting (Settings "General" is global-only, `Settings.tsx:13-21`); a named list of templates does not.
- **Where credits data must not live.** `resetDerived` deletes `ManuscriptGuide`, `TranscriptCompare`, `manuscript-notes.json` and `.narration-last-comparison.json` (`service.go:434-435`), and `Clear` removes the whole `manuscript/` folder (`:442`), so credits values cannot be stored in those or in `manuscript.json` (schema `validate` at `narration_common/manuscript.py:32`). Precedents for user-level files: `recent-projects.json` (ADR 0030) beside `global-settings.json`; the pending project manifest `narration-utils/project.json` (`project-workspace-and-daw-link.prd.md` W1).
- **No template code exists.** A grep for `{{`, `[Title]`, "interpolat", "template" finds nothing relevant.
- **How total time is computed.** `WORDS_PER_FINISHED_HOUR = 9300` and `estimateFinishedHours = words / 9300` (`shared/ui/src/state.ts:91-92`), that is 155 words per minute; the label says "~150 words/min" (`AudiobookEstimatePanel.tsx:86`); there is no WPM setting; `Manuscript.tsx:374` uses a different 200 words per minute for silent "min read". Only narration chapters count (`AudiobookEstimatePanel.tsx:63`; Go `narratableManuscriptStats`, `shell/app.go:591-607`, skips `opening` and `reference`), `chapter.wordCount` counts paragraph text only (`service.go:399`), so spoken chapter titles are not counted. Record, edit and proof time are finished time times 3, 2 and 1 (`:70-76`). `fmtHours` rounds to whole minutes (`:13-17`), so a 20 s addition displays as 0 or 1 minute.
- **How opening material is treated on reading surfaces.** Every narration-only consumer skips `opening` (`AudiobookEstimatePanel.tsx:63`, `TeleprompterPage.tsx:151`, `chapter_script.py:65`, `compare.py:784`, `manuscript_guide.py:211`, `shell/app.go:596`). The teleprompter Go service requires a chapter (`shell/internal/teleprompter/service.go:130-147`); the sidecar builds tokens from title words plus paragraph text (`chapter_script.py:62-90`) and emits the `script` event with spans only in `--manuscript` mode (`live_asr.py:46-52`); `--script FILE` (`:648`) accepts plain text and emits `position` events without spans, while the UI reader model needs spans and a tokenizer matching Python `str.split()` (`readerModel.ts:4,34-58`). Showing credits on the teleprompter therefore needs sidecar work (spans for `--script`, or a pseudo-chapter).
- **Proofing precedent.** `compare.py:1498-1508` prepends the spoken chapter title because narrators read titles aloud; otherwise "every spoken title shows up as a false EXTRA IN AUDIO discrepancy". Credits recorded at the head of a chapter file would produce the same false extras; ACX asks for separate credit files, which avoids it.
- **ACX conventions** (official page: [ACX audio submission requirements](https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements), read 2026-09-20): opening credits "must state the audiobook's title, author(s), and narrator(s)" and be consistent with the title's metadata and cover art; closing credits "must indicate finality" (best practice: "You have been listening to...", restate title, author and narrator, end with "The End"); "Opening and closing credits should be separate files"; a retail sample of 5 minutes or less; 1 to 5 seconds of room tone at the beginning and end of each file; each file no longer than 120 minutes and starting with a section header. The page requires neither copyright nor publisher lines and names no credit file names. A third-party guide ([HumanizeAudio](https://blog.humanizeaudio.com/acx-opening-and-closing-credits/), not official) shows a closing example with "Copyright 2026 by Author Name" and typical durations of 6-20 s (opening) and 10-25 s (closing). So `Copyright by [Copyright]` is a publisher or contract variant, not an ACX requirement; official publisher templates were not found, so those variants are unverified. ADR 0025 and `reaper-automation-surface.md:202` record that published room-tone guidance disagrees; do not bake room-tone numbers in without a user setting.

## Proposed Solution

A credits feature with three parts:

1. **Templates.** A user-level library of named templates of two kinds (opening, closing), seeded with standard defaults, that the user can duplicate, edit and add to.
2. **Tokens.** Bracketed tokens (`[Title]`, `[Author]`, `[Narrator]` ...) resolved from project values and user defaults, with a live preview of the text exactly as it will be read and a clear marker for any unresolved token.
3. **Where they show up.** Read-only credits before the first and after the last chapter in the Manuscript view, selectable on the teleprompter, and a Credits line in the audiobook estimate (rendered words / 155 wpm).

## Key Hypothesis

We believe templated credits filled from project data, previewed as they will be read and counted in the estimate, will save narrators from retyping and misreading them each project and make the time estimate honest. We'll know we're right when a narrator can pick a standard template, fill in the fields once, see the finished text, read it on the teleprompter and see its seconds in the estimate.

## What We're NOT Building

- Recording, editing or exporting credit audio files, or metadata for retailers.
- Enforcing ACX or any publisher's rules; the standard templates are starting points and contractual variants are the user's.
- Reusing `contentKind: "opening"` or storing credits in `manuscript.json` or any derived folder.
- Retail-sample authoring (computed marker at most; see C10).
- Chapter announcements beyond an optional template kind (C8).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Interpolation | Every known token resolves from its source; unknown tokens are reported by name; unresolved tokens never render as empty text silently | Go unit tests over a token table |
| Preview | Rendered text equals what the teleprompter and estimate consume (one renderer) | Go tests, Vitest |
| Estimate | Credits seconds equal rendered words / 155 wpm and appear as a separate stat | Vitest; the narration total is unchanged |
| Survival | Credits values and templates survive Replace manuscript and "Clear derived project data" | Go tests on the store location |
| Templates | Defaults are shipped, duplicable and deletable; user templates persist across projects | Go tests, Vitest |
| Teleprompter | Credits selectable and readable with the highlight following | Sidecar tests, manual live check (per teleprompter PRDs) |
| No new false extras in Proofing | Credits are not prepended to chapter scripts | Existing compare tests unchanged |

## Open Questions

- [ ] **C1. Where do credits appear first?** Options: Manuscript view, teleprompter, estimate only. Recommendation: templates plus preview plus estimate first (no sidecar work), then Manuscript pseudo-entries, then the teleprompter.
- [ ] **C2. Ownership of each token.** Recommendation: `[Narrator]` global default with project override; `[Title]`, `[Subtitle]`, `[Author]`, `[Series]`, `[Book Number]`, `[Copyright]`, `[Year]`, `[Publisher]` per project; `[Chapter]`, `[Chapter Title]` computed from `manuscript.json` (chapter announcement templates only).
- [ ] **C3. Seeding.** Suggest Title and Author from the cover lines (`model.go:52-68`) and `docProps/core.xml` (not read today), always as editable suggestions; never write back to the manuscript.
- [ ] **C4. `[Copyright]` as one string or holder plus year?** Recommendation: keep `[Copyright]` free-form and add optional `[Year]` and `[Copyright Holder]` so contracts that phrase it differently still work.
- [ ] **C5. Optional segments and custom tokens.** Support `[Subtitle]` dropping cleanly when empty (for example a segment syntax) and user-defined tokens? Recommendation: optional segments yes; custom tokens later.
- [ ] **C6. Missing values.** Preview shows a highlighted placeholder chip and an unresolved-token count; saving is never blocked; the teleprompter Start and a "mark ready" state warn or block, because "Read by ." on a recording is worse than a warning (consistent with "disabled, not hidden", `design-system.md:34`, and ADR 0032's report-do-not-act).
- [ ] **C7. Storage.** Recommendation: user templates in `%APPDATA%\narration-utils\credit-templates.json` (a versioned list, alongside `recent-projects.json`); project values in the project manifest when `project.json` lands (W1), otherwise a small file under `narration-utils/` outside every folder `resetDerived` and `Clear` delete; a flat `General.narrator_name` `text` setting for the global narrator default.
- [ ] **C8. Template kinds.** Opening, closing, and an optional chapter announcement; retail sample is a computed marker, not a template.
- [ ] **C9. Time model.** Credits seconds = rendered words / 155 wpm; do they enter the record, edit and proof multipliers? Optional room tone as a user seconds-per-file setting defaulting to 0 (ADR 0025). Should the estimate gain a WPM setting instead of the fixed 155, and reconcile the "~150" label and the 200 wpm reading figure?
- [ ] **C10. Retail sample.** A marker on the first five minutes of chapter one at most; it adds no time.
- [ ] **C11. Recorded inside chapter files?** If narrators record credits in the chapter file, Proofing must prepend them (compare.py precedent) or it reports false extras. Recommendation: assume separate files (ACX) and document it.
- [ ] **C12. Sequencing.** Wait for the project manifest (W1) before adding a project file, or ship with a dedicated file and migrate? Recommendation: a dedicated file behind one Go accessor so the move is a one-place change.

## Users & Context

**Primary User**: an independent narrator or producer delivering to ACX, a publisher or a client with contract-specific credits, Windows first.
**Current behavior**: types the credits from memory or a contract every project; the estimate ignores them.
**Trigger**: setting up a project or preparing to record the first and last files.
**Success state**: the credits text is right, previewed, readable on the teleprompter and included in the time.
**Job to Be Done**: When I start a book, I want the standard credits filled from what I already told the app, so I record them exactly right without retyping.
**Non-Users**: narrators who never record credits; producers who add them in post.

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | Token vocabulary and a single Go renderer that reports unresolved tokens | 1 |
| Must | User template library (opening, closing) with shipped defaults, duplicate, edit, delete, add | 1 |
| Must | Project values editor (title, author, copyright, year, publisher, series) and a global narrator default | 1 |
| Must | Live preview of the rendered text; unresolved-token markers and count | 1 |
| Must | Credits stat in the estimate (rendered words / 155 wpm) | 2 |
| Should | Read-only credits entries before the first and after the last chapter in the Manuscript view | 3 |
| Should | Teleprompter: "Opening credits" and "Closing credits" selectable | 4 |
| Should | Suggested Title/Author from cover lines and `docProps/core.xml` | 1 |
| Could | Optional segments, chapter announcement template, room tone setting, retail sample marker | 5 |
| Won't | Audio export, retailer metadata, rule enforcement | - |

**Default templates (editable, shipped):** ACX minimum opening (`[Title], written by [Author], narrated by [Narrator].`); ACX best-practice closing (`You have been listening to [Title], written by [Author], narrated by [Narrator]. The End.`); with-copyright variant (`[Title]. Written by [Author]. Read by [Narrator]. Copyright by [Copyright].`), marked contractual.

**User flow**: Settings > Credits: pick the standard opening template, add a project value for Title and Author, see "Bad Ideas Look Great in Neon. Written by A. Writer. Read by You." with any missing token chip-highlighted; Home shows "Credits ~18 s" beside the narration estimate; the teleprompter offers Opening credits before Chapter One.

## Technical Approach

**Feasibility**: HIGH for templates, tokens, preview and the estimate; MEDIUM for the Manuscript entries; MEDIUM-LOW for the teleprompter (sidecar and Go contract).

**Architecture notes**
- **One renderer in Go** (new small package, for example `shell/internal/credits`): parse `[Token]` and optional segments, look up values, return `{text, words, unresolved[]}`. Whitespace word counting matches the teleprompter tokenizer contract. The estimate, the preview and the teleprompter file all call it.
- **Storage** per C7: a versioned JSON list for templates with atomic writes; values in the manifest or a dedicated project file behind one accessor; a flat `General.narrator_name` `text` setting for the narrator default. Add a `Credits` category to Settings (`Settings.tsx:13-21`), with a textarea and live preview, which needs a `Field`/textarea with more props (primitives and a11y PRDs) or a local component.
- **Bindings** (new): list/save/delete templates, get/set project values, render preview; a `hostAPIVersion` bump (5 in `shell/app.go:33`, `shell/app_test.go:39-41`, `shared/ui/src/hostApi.ts:2`), regenerate `Host.{js,d.ts}`; write on the host accessor (`host-binding-data-race.prd.md`).
- **Estimate**: a separate `creditsSeconds` beside `Est. finished audio`, never folded into `narratableWordCount`; `fmtHours` shows seconds below one minute.
- **Manuscript view**: read-only synthetic entries (not chapters, not in `manuscript.json`), excluded from `isListableChapter` logic and search; reader PRD coordination.
- **Teleprompter**: extend the sidecar so `--script` emits spans (or load credits as a pseudo-chapter), and the Go service accepts a credits source instead of a chapter id; teleprompter PRDs own the live-recognition work (`teleprompter-manuscript-integration.prd.md`).
- **Docs and ADR**: an ADR for the token grammar and storage (next free number, 0037 at dc9d01a); a guide page; a `Credits` row in `docs/architecture/`.
- **Tests**: Go (renderer, store, survival of Replace/Clear), Vitest (editor, preview, estimate), visual states (empty, filled, unresolved token, long text at 390 px), doc screenshots.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Collision with `contentKind: "opening"` and denylist consumers | Medium | Credits are never chapters; a separate store and renderer |
| Flat-string settings drop structured data (`store.go:150-160`) | Certain if templates go there | Dedicated JSON store for templates |
| Project data in folders that get wiped | Medium | Store outside `resetDerived`/`Clear` targets; test it |
| False EXTRA discrepancies if credits are recorded inside chapter files | Medium | C11 documented; no auto-prepend |
| Teleprompter needs sidecar and contract changes | High | Later step, owned with the teleprompter PRDs |
| Standard-template wording is a contract matter | Medium | Label variants as contractual; the user edits everything |
| Estimate constants disagree (155 vs "~150" vs 200) | Medium | Single constant with the label derived from it |
| API bump and Settings collisions | High | One bump per phase; small hunks |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Templates, tokens and preview | Renderer, template store, project values, Settings Credits category, preview, ADR | pending | - | C7, C12 | - |
| 2 | Estimate | Credits stat, seconds formatting, tests | pending | - | 1 | - |
| 3 | Manuscript entries | Read-only credits before/after chapters | pending | 4 | 1; reader PRD | - |
| 4 | Teleprompter | Credits selectable, sidecar spans, Go contract | pending | 3 | 1; teleprompter PRDs | - |
| 5 | Extras | Optional segments, chapter announcements, room tone, retail sample marker | pending | - | 1-4 | - |

**Phase 1.** Goal: templates that fill from data and preview. Success: renderer tests; a template survives Replace and Clear; PNGs at four viewports.
**Phase 2.** Goal: honest total time. Success: narration total unchanged; credits stat correct.
**Phase 3.** Goal: see credits where the book is read. Success: entries present, not searchable chapters, not counted twice.
**Phase 4.** Goal: read credits with the teleprompter. Success: manual live check on the user's machine.
**Phase 5.** Goal: optional polish. Success: per item.

**Parallelism Notes**: Phase 1 is the base; 3 and 4 are independent after it.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | new `shell/internal/credits`, `shell/{app.go,bindings.go,app_test.go}`, `shared/ui/src/{hostApi.ts,api/*,components/settings/*}`, `Host.*`, `shared/config/defaults.json` and `builtinDefaults`, `docs/architecture/` | Every binding phase (API version), `fieldSchemas`/Settings editors, project manifest (project-workspace Phase 3), host-binding PRD |
| 2 | `AudiobookEstimatePanel.tsx`, `state.ts` | Chapter-stage-recommendations, interaction audit, import-review (Home.tsx) |
| 3 | `Manuscript.tsx`, `ChapterNav.tsx` | Reader search and controls PRD (all phases) |
| 4 | `shell/internal/teleprompter`, `tools/manuscript-teleprompter/core/*`, `TeleprompterPage.tsx`, `readerModel.ts` | Both teleprompter PRDs (Phases 2-8) |

Cross-cutting: `hostAPIVersion` re-checked at merge; ADR numbering re-checked; `visual-catalog-sync`, the Playwright suite with PNG review at four viewports, `doc-screenshot-sync`; each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `design-spec-guard`, `feature-cleanup`. No Lua.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Front Matter keeps `contentKind: "opening"` (prior, ADR 0004) | Credits are a separate concept and store | Reuse the kind | Avoids the name collision |
| Reference and non-narration material is excluded from totals (prior) | Credits reported separately in the estimate | Fold into the narration total | Keeps the narration figure stable |
| Local-first (prior) | All data local | - | Standing scope |
| Template store | User-level JSON list (proposed) | Flat settings strings | Store cannot hold lists |
| Renderer | One Go renderer (proposed) | Per-surface rendering | One source of truth |
| Missing tokens | Warn, block only at read time (proposed) | Block saving | Editing must stay possible |

## Research Summary

**Technical Context**: verified in code on this branch: absence of project metadata, importer cover heuristic and what it does not read, settings store limits, wipe targets, the estimate constants and consumers, teleprompter and Proofing treatment of non-narration text.
**Not verified**: contractual variants beyond ACX (no official publisher templates found), real credit durations, and whether ACX guidance has changed since the page read on 2026-09-20; the third-party durations are unofficial.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
