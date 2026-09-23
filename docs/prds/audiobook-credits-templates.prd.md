# Audiobook Credits Templates

**Source:** user request of 2026-09-20 (item 2): audiobooks carry opening and closing credits that vary by narrator and contract; the app should ship standard templates, let the user add their own, and support tokens such as `[Title]. Written by [Author]. Read by [Narrator]. Copyright by [Copyright].` that are filled from project and user data, shown as the narrator will read them, and counted in the total time. Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet. Related: [project-workspace-and-daw-link.prd.md](project-workspace-and-daw-link.prd.md) (the project manifest, W1), [teleprompter-manuscript-integration.prd.md](teleprompter-manuscript-integration.prd.md).

## Problem Statement

The app models only the chapters a manuscript contains. Opening and closing credits, which every published audiobook has and which the narrator reads aloud, exist nowhere: no place to write them, no fill-in from project data, no way to read them on the teleprompter, and no time in the audiobook estimate.

## Evidence

- **No project metadata exists.** `manuscript.json` holds `schemaVersion, documentId, importedAt, importer{format,version}, source{fileName,sha256,storedPath}, chapters, paragraphs` (`apps/desktop/internal/manuscript/service.go:431`): no title or author. `docx.go:216-217` reads only `word/styles.xml` and `word/document.xml`, not `docProps/core.xml` (title and creator). `classifyPreHeading` has a cover heuristic (first 1-3 short lines are "Cover" if line 2 starts with "by " or contains "copyright" or "author", or line 1 starts with "title:"; otherwise "Front Matter", `importer/model.go:52-68`), so cover lines could seed suggested Title, Author and Copyright as unverified values. `Bootstrap.projectName` is REAPER's project name or the folder basename (`apps/desktop/app.go:439`, `apps/desktop/bindings.go:196-202`), a label and not a book title; `manuscript.sourceName` is a file name (`api/contracts/system.ts:19`). Nothing in `apps/desktop/` or `apps/ui/src` stores narrator, author, copyright, publisher or ISBN.
- **"Opening" is taken.** `contentKind: "opening"` means Front Matter (ADR 0004); "Opening Credits" was floated as its label and rejected as "not standard" (`docs/adr/0004-front-matter-naming.md:8-10`). Credits must not reuse that kind.
- **Settings store cannot hold a list of templates.** Layers are project (`<project>/narration-utils/settings.json`), global (`%APPDATA%\narration-utils\global-settings.json`) and repo defaults (`apps/desktop/internal/settings/store.go:24-35,135-149`); `readTool` keeps only string values (`:150-160`), so structured data is dropped; `fieldSchemas` (`apps/desktop/app.go:673-679`) validates only `choice` and `color` (`:718-722`); the UI already allows a `text` kind (`system.ts:7`, `ScopedSetting.tsx:68-69`), single-line only; `builtinDefaults` (`store.go:36-42`) must mirror `config/defaults.json`. A narrator name fits a flat global `text` setting (Settings "General" is global-only, `Settings.tsx:13-21`); a named list of templates does not.
- **Where credits data must not live.** `resetDerived` deletes `ManuscriptGuide`, `TranscriptCompare`, `manuscript-notes.json` and `.narration-last-comparison.json` (`service.go:434-435`), and `Clear` removes the whole `manuscript/` folder (`:442`), so credits values cannot be stored in those or in `manuscript.json` (schema `validate` at `narration_common/manuscript.py:32`). Precedents for user-level files: `recent-projects.json` (ADR 0030) beside `global-settings.json`; the pending project manifest `narration-utils/project.json` (`project-workspace-and-daw-link.prd.md` W1).
- **No template code exists.** A grep for `{{`, `[Title]`, "interpolat", "template" finds nothing relevant.
- **How total time is computed.** `WORDS_PER_FINISHED_HOUR = 9300` and `estimateFinishedHours = words / 9300` (`apps/ui/src/state.ts:91-92`), that is 155 words per minute; the label says "~150 words/min" (`AudiobookEstimatePanel.tsx:86`); there is no WPM setting; `Manuscript.tsx:374` uses a different 200 words per minute for silent "min read". Only narration chapters count (`AudiobookEstimatePanel.tsx:63`; Go `narratableManuscriptStats`, `apps/desktop/app.go:591-607`, skips `opening` and `reference`), `chapter.wordCount` counts paragraph text only (`service.go:399`), so spoken chapter titles are not counted. Record, edit and proof time are finished time times 3, 2 and 1 (`:70-76`). `fmtHours` rounds to whole minutes (`:13-17`), so a 20 s addition displays as 0 or 1 minute.
- **How opening material is treated on reading surfaces.** Every narration-only consumer skips `opening` (`AudiobookEstimatePanel.tsx:63`, `TeleprompterPage.tsx:151`, `chapter_script.py:65`, `compare.py:784`, `manuscript_guide.py:211`, `apps/desktop/app.go:596`). The teleprompter Go service requires a chapter (`apps/desktop/internal/teleprompter/service.go:130-147`); the sidecar builds tokens from title words plus paragraph text (`chapter_script.py:62-90`) and emits the `script` event with spans only in `--manuscript` mode (`live_asr.py:46-52`); `--script FILE` (`:648`) accepts plain text and emits `position` events without spans, while the UI reader model needs spans and a tokenizer matching Python `str.split()` (`readerModel.ts:4,34-58`). Showing credits on the teleprompter therefore needs sidecar work (spans for `--script`, or a pseudo-chapter).
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

- [x] **C1. Where do credits appear first?** Options: Manuscript view, teleprompter, estimate only. Recommendation: templates plus preview plus estimate first (no sidecar work), then Manuscript pseudo-entries, then the teleprompter.
  **Settled:** as recommended, by delivery: templates, preview and estimate first (#302, #303), Manuscript pseudo-entries next (#306), the teleprompter next (Phase 4).
- [x] **C2. Ownership of each token.** Recommendation: `[Narrator]` global default with project override; `[Title]`, `[Subtitle]`, `[Author]`, `[Series]`, `[Book Number]`, `[Copyright]`, `[Year]`, `[Publisher]` per project; `[Chapter]`, `[Chapter Title]` computed from `manuscript.json` (chapter announcement templates only).
  **Settled:** as recommended, by Phase 1: `apps/desktop/internal/credits/values.go` resolves the project's narrator value over the global default.
- [x] **C3. Seeding.** Suggest Title and Author from the cover lines (`model.go:52-68`) and `docProps/core.xml` (not read today), always as editable suggestions; never write back to the manuscript.
  **Settled:** as recommended, by Phase 1: `apps/desktop/internal/credits/suggestions.go` offers editable suggestions and never writes back to the manuscript.
- [x] **C4. `[Copyright]` as one string or holder plus year?** Recommendation: keep `[Copyright]` free-form and add optional `[Year]` and `[Copyright Holder]` so contracts that phrase it differently still work.
  **Settled:** as recommended, by Phase 1: free-form `[Copyright]` plus optional `[Year]` and `[Copyright Holder]` (`internal/credits/values.go`).
- [x] **C5. Optional segments and custom tokens.** Support `[Subtitle]` dropping cleanly when empty (for example a segment syntax) and user-defined tokens? Recommendation: optional segments yes; custom tokens later.
  **Settled:** as recommended, by Phase 1: `{...}` optional segments in `apps/desktop/internal/credits/renderer.go` drop cleanly when a token inside is empty; custom tokens later.
- [x] **C6. Missing values.** Preview shows a highlighted placeholder chip and an unresolved-token count; saving is never blocked; the teleprompter Start and a "mark ready" state warn or block, because "Read by ." on a recording is worse than a warning (consistent with "disabled, not hidden", `design-system.md:34`, and ADR 0032's report-do-not-act).
  **Settled (preview), answered 2026-09-23 (teleprompter):** the preview part shipped in Phase 1 (highlighted unresolved tokens and a list, saving never blocked). For the teleprompter the owner chose to warn and still allow Start, not block. Phase 4 carries it.
- [x] **C7. Storage.** Recommendation: user templates in `%APPDATA%\narration-utils\credit-templates.json` (a versioned list, alongside `recent-projects.json`); project values in the project manifest when `project.json` lands (W1), otherwise a small file under `narration-utils/` outside every folder `resetDerived` and `Clear` delete; a flat `General.narrator_name` `text` setting for the global narrator default.
  **Settled:** as recommended, by Phase 1: `credit-templates.json` in `%APPDATA%\narration-utils` (`creditTemplatesPath`, `apps/desktop/app.go`), values on the project manifest, and `General.narrator_name`.
- [x] **C8. Template kinds.** Opening, closing, and an optional chapter announcement; retail sample is a computed marker, not a template.
  **Settled:** as recommended, by Phase 1: `apps/desktop/internal/credits/templates.go` defines the `opening`, `closing` and `chapter_announcement` kinds.
- [x] **C9. Time model.** Credits seconds = rendered words / 155 wpm; do they enter the record, edit and proof multipliers? Optional room tone as a user seconds-per-file setting defaulting to 0 (ADR 0025). Should the estimate gain a WPM setting instead of the fixed 155, and reconcile the "~150" label and the 200 wpm reading figure? **Resolved (Phase 2):** credits seconds are computed by `estimateCreditsSeconds` (`apps/ui/src/state.ts`), reusing the same `WORDS_PER_FINISHED_HOUR` constant as the narration estimate rather than a second 155/60 figure; they are a separate "Credits" stat and never enter the record/edit/proof multipliers, matching the Success Metrics table. Room tone is a parameter defaulting to `CREDITS_ROOM_TONE_SECONDS_PER_FILE = 0`; no Settings field exists yet (Phase 5's "Could" item), so it is not user-configurable this phase. The estimate panel's own "~150 words/min" label was corrected to "~155" (`AudiobookEstimatePanel.tsx`); Manuscript.tsx's 200 wpm figure is a distinct *silent reading* estimate (per this PRD's own Evidence section) and was intentionally left alone, not reconciled away. No WPM setting was added - the fixed 155 figure stays, per the "Single constant with the label derived from it" mitigation already in the Technical Risks table.
- [x] **C10. Retail sample.** A marker on the first five minutes of chapter one at most; it adds no time.
  **Answered 2026-09-23:** the narrator picks the retail sample range (at most 5 minutes, anywhere in the book), overriding the "first five minutes of chapter one" recommendation; it adds no time to the estimate. Phase 5 carries it.
- [x] **C11. Recorded inside chapter files?** If narrators record credits in the chapter file, Proofing must prepend them (compare.py precedent) or it reports false extras. Recommendation: assume separate files (ACX) and document it.
  **Settled:** separate files, as ADR 0093 words it; the Manuscript user guide (`docs/guides/using-the-app/manuscript.md`) now tells narrators to record credits as their own files.
- [x] **C12. Sequencing.** Wait for the project manifest (W1) before adding a project file, or ship with a dedicated file and migrate? Recommendation: a dedicated file behind one Go accessor so the move is a one-place change.
  **Moot:** the project manifest landed first, so credit values live on it (`project.Manifest.Credits`, `internal/credits/values.go`) and no dedicated file was needed.

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
- **One renderer in Go** (new small package, for example `apps/desktop/internal/credits`): parse `[Token]` and optional segments, look up values, return `{text, words, unresolved[]}`. Whitespace word counting matches the teleprompter tokenizer contract. The estimate, the preview and the teleprompter file all call it.
- **Storage** per C7: a versioned JSON list for templates with atomic writes; values in the manifest or a dedicated project file behind one accessor; a flat `General.narrator_name` `text` setting for the narrator default. Add a `Credits` category to Settings (`Settings.tsx:13-21`), with a textarea and live preview, which needs a `Field`/textarea with more props (primitives and a11y PRDs) or a local component.
- **Bindings** (new): list/save/delete templates, get/set project values, render preview; a `hostAPIVersion` bump (5 in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:39-41`, `apps/ui/src/hostApi.ts:2`), regenerate `Host.{js,d.ts}`; write on the host accessor (`h.services()`, see `docs/architecture/host-binding-concurrency.md`).
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
| 1 | Templates, tokens and preview | Renderer, template store, project values, Settings Credits category, preview, ADR | complete | - | C7, C12 | - |
| 2 | Estimate | Credits stat, seconds formatting, tests | complete | - | 1 | - |
| 3 | Manuscript entries | Read-only credits before/after chapters | complete | 4 | 1; reader PRD | - |
| 4 | Teleprompter | Credits selectable, sidecar spans, Go contract; unresolved tokens warn but Start stays allowed | partial (built and tested, ADR 0150; the manual live check with a microphone on the owner's machine is pending) | 3 | 1; teleprompter PRDs | - |
| 5 | Extras | Optional segments, chapter announcements, room tone, narrator-picked retail sample range (at most 5 minutes, anywhere in the book) | complete (ADRs 0151, 0152; optional segments shipped in Phase 1) | - | 1-4 | - |

**Phase 1.** Goal: templates that fill from data and preview. Success: renderer tests; a template survives Replace and Clear; PNGs at four viewports.
**Phase 2.** Goal: honest total time. Success: narration total unchanged; credits stat correct.
**Phase 3.** Goal: see credits where the book is read. Success: entries present, not searchable chapters, not counted twice.
**Phase 4.** Goal: read credits with the teleprompter. Scope note (C6, owner decision 2026-09-23): when the credits text has unresolved tokens, the teleprompter shows a warning naming them and still allows Start; it never blocks. Success: manual live check on the user's machine; a credits read with an unresolved token shows the warning and starts.
**Phase 5.** Goal: optional polish. Scope note (C10, owner decision 2026-09-23): the retail sample is a range the narrator picks, at most 5 minutes long and anywhere in the book (not fixed to the first five minutes of chapter one); it is a marker only and adds no time to the estimate. Success: per item; a sample range over 5 minutes is refused, and the estimate is unchanged by a sample. **Evidence:** optional segments shipped in Phase 1 (`renderer.go`); chapter announcements render per narration chapter (`announcements_test.go`, `creditsextras_test.go`) and are previewed in Settings and timed in the Credits stat (`CreditsPanel.test.tsx`, `AudiobookEstimatePanel.test.tsx`); room tone is a General setting added per credits file (same test); a range over 5 minutes is refused and the previous sample kept (`sample_test.go`, `TestCreditsSaveRetailSampleRefusesARangeOverFiveMinutesAndKeepsTheOldOne`, `CreditsPanel.test.tsx`); the estimate is identical with and without a sample (`AudiobookEstimatePanel.test.tsx`); visual states `settings/project-credits-chapter-announcement`, `settings/project-credits-retail-sample`, `settings/project-credits-retail-sample-refused`, `manuscript/retail-sample`. Not done here: announcements in the Manuscript reader, on the teleprompter or prepended in Proofing (ADR 0151).

**Parallelism Notes**: Phase 1 is the base; 3 and 4 are independent after it.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | new `apps/desktop/internal/credits`, `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/*,components/settings/*}`, `Host.*`, `config/defaults.json` and `builtinDefaults`, `docs/architecture/` | Every binding phase (API version), `fieldSchemas`/Settings editors, project manifest (project-workspace Phase 3), the delivered host accessor |
| 2 | `AudiobookEstimatePanel.tsx`, `state.ts` | Chapter-stage-recommendations, interaction audit, import-review (Home.tsx) |
| 3 | `Manuscript.tsx`, `ChapterNav.tsx` | Reader search and controls PRD (all phases) |
| 4 | `apps/desktop/internal/teleprompter`, `sidecars/manuscript-teleprompter/core/*`, `TeleprompterPage.tsx`, `readerModel.ts` | Both teleprompter PRDs (Phases 2-8) |
| 5 | `apps/desktop/internal/credits`, `apps/desktop/creditsextras.go`, `project.Manifest`, `fieldSchemas` General, `config/defaults.json`, `CreditsPanel.tsx`, `AudiobookEstimatePanel.tsx`, `Manuscript.tsx`, `ParagraphView.tsx`, `Host.*`, `hostAPIVersion` 35 | Reader PRDs (`ParagraphView.tsx`), any binding phase (API version) |

Cross-cutting: `hostAPIVersion` re-checked at merge; ADR numbering re-checked; `visual-catalog-sync`, the Playwright suite with PNG review at four viewports, `doc-screenshot-sync`; each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `design-spec-guard`, `feature-cleanup`. No Lua.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Front Matter keeps `contentKind: "opening"` (prior, ADR 0004) | Credits are a separate concept and store | Reuse the kind | Avoids the name collision |
| Reference and non-narration material is excluded from totals (prior) | Credits reported separately in the estimate | Fold into the narration total | Keeps the narration figure stable |
| Local-first (prior) | All data local | - | Standing scope |
| Template store (decided, C7, Phase 1) | User-level versioned JSON list, `credit-templates.json` in `%APPDATA%\narration-utils`; project values on the project manifest; `General.narrator_name` for the global narrator | Flat settings strings; a dedicated project file | Store cannot hold lists; the manifest landed first (C12 moot) |
| Renderer (decided, C5, Phase 1) | One Go renderer (`internal/credits/renderer.go`) with `{...}` optional segments; custom tokens later | Per-surface rendering | One source of truth |
| Missing tokens (decided, C6) | Preview marks unresolved tokens and never blocks saving; the teleprompter warns and still allows Start | Block saving; block teleprompter Start | Owner decision 2026-09-23; editing and reading stay possible, and the narrator sees the gap before recording |
| Delivery order (settled, C1) | Templates, preview and estimate (#302, #303), then Manuscript pseudo-entries (#306), then the teleprompter (Phase 4) | Manuscript or teleprompter first | Settled by delivery; no sidecar work up front |
| Token ownership and seeding (settled, C2, C3, C4, C8) | Project narrator overrides the global default (`values.go`); editable Title/Author suggestions never written back (`suggestions.go`); free-form `[Copyright]` plus optional `[Year]` and `[Copyright Holder]`; kinds `opening`, `closing`, `chapter_announcement` (`templates.go`) | Fixed copyright shape; writing suggestions back to the manuscript | Settled by Phase 1 as recommended |
| Retail sample (decided, C10) | The narrator picks the range, at most 5 minutes, anywhere in the book; a marker that adds no time | Fixed to the first five minutes of chapter one | Owner decision 2026-09-23, overriding the recommendation; the best sample is not always the opening |
| Credits recorded inside chapter files (settled, C11) | Separate files (ADR 0093 wording); the Manuscript user guide says so | Prepend credits to chapter scripts in Proofing | Settled; ACX practice, and no false extras in Proofing |
| Credits time model (Phase 2) | Reuse `WORDS_PER_FINISHED_HOUR` (155 wpm); a separate "Credits" stat; room tone defaults to 0 with no Settings field yet | A second 155/60 constant; folding into the narration total; a WPM setting now | Avoids the constants-disagree risk named in Technical Risks; keeps the narration total stable per its own Success Metric; room tone Settings UI is Phase 5 scope |
| Which template the estimate times (Phase 2, no per-project selection yet) | The first `opening`- and first `closing`-kind template in the library, by list order (ADR 0093, Proposed) | Sum every template of each kind; show no Credits stat until selection exists | Matches the PRD's own "pick a standard template" user flow closely enough to ship Phase 2 now; documented as provisional pending real per-project template selection |
| Which template the Manuscript pseudo-entries render (Phase 3) | Same convention as Phase 2 (ADR 0093): the first `opening`- and first `closing`-kind template in the library | A new per-project "which template plays here" selection now | ADR 0093 named this exact gap and recommended closing it "most naturally alongside Phase 3's Manuscript entries"; a real per-project selection is still future work (ADR 0093's own accepted consequence), not re-litigated as a new Proposed ADR here |
| Where credits pseudo-entries render (Phase 3) | Inline in the Manuscript reader's own chapter list (`Manuscript.tsx`), before the first and after the last chapter; excluded from `ChapterNav`'s list and search by construction (never added to the `chapters` array, no `manuscript.json` entry) | A separate page or panel; adding them to `ChapterNav`'s own chapter array with a filter | Matches "using the existing reader components, not a new page" and the Success Metric "not counted twice"; exclusion-by-construction cannot be forgotten the way a filter could |
| Chapter announcements and room tone (Phase 5, ADR 0151, Proposed) | `[Chapter]` is the chapter's heading and `[Chapter Title]` its subtitle, rendered per narration chapter by `CreditsChapterAnnouncements`; the first announcement template is timed for every chapter in the Credits stat with no room tone; room tone is `General.credits_room_tone_seconds` (0-10, default 0), added once per opening and closing file | An ordinal chapter number; room tone per announcement; a per-project room tone | The heading already says what the book calls the chapter; announcements sit inside chapter files; room tone is the narrator's habit (ADR 0025) |
| Retail sample (Phase 5, ADR 0152, Proposed) | A paragraph-id range on `project.Manifest.RetailSample`, measured by the host at 9,300 words per finished hour and refused over 300 s; a saved range whose lines are gone is kept and reported; marked in the Manuscript reader, never in the estimate | Line numbers stored; a UI-only limit; picking by text selection in the reader | Ids survive what line numbers do not; the host holds the limit; the chapter-and-line picker needs no new reader action |
| How the teleprompter reads the credits (Phase 4, ADR 0150, Proposed) | The UI sends only `credits: "opening" \| "closing"`; the host renders the first template of the kind (ADR 0093) with `credits.Render`, writes it to a session file and starts the sidecar with `--script FILE --script-id --script-title`, which now emits a `script` event (one paragraph span per line, no title span); offered on the Teleprompter page's picker, first and last around the chapters; unresolved tokens show a warning with "Fill them in Settings" (`/settings#credits`) and Start stays enabled (C6) | A pseudo-chapter in the manuscript; sending the text from the UI; the read-aloud dialog too | Credits are never chapters; one renderer; the text never travels from the UI to a sidecar argument; the dialog keeps its flags per chapter (ADR 0117) |

## Research Summary

**Technical Context**: verified in code on this branch: absence of project metadata, importer cover heuristic and what it does not read, settings store limits, wipe targets, the estimate constants and consumers, teleprompter and Proofing treatment of non-narration text.
**Not verified**: contractual variants beyond ACX (no official publisher templates found), real credit durations, and whether ACX guidance has changed since the page read on 2026-09-20; the third-party durations are unofficial.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
