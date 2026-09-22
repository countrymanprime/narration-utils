# Import Review Redesign: Subtitles, Grouped Sections and a Summary

**Source:** user request of 2026-09-19 (items 4, 5 and 6). Related to Phases 3 and 5 of [story-bible-and-import-ux-briefs.prd.md](story-bible-and-import-ux-briefs.prd.md), which it splits (see Evidence). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet.

## Problem Statement

The "Import manuscript" review dialog is a flat, unbounded list that hides what the importer actually found:

- Chapter **subtitles are missing**: a heading such as "CHAPTER ONE / Bad Ideas Look Great in Neon" shows only "Chapter One", so the narrator cannot tell chapters apart or confirm the split was right.
- A permanent **explanatory sentence** about reference material sits above the list instead of next to the control it explains.
- Front matter, narration chapters, reference material and character suggestions are **one undifferentiated list** with no summary, so the narrator must read every row to learn what was detected.

## Evidence

- **Subtitles cannot be fixed in the UI alone.** The preview payload has no subtitle: `sections` carries `{id, title, contentKind, paragraphCount}` (`apps/ui/src/api/contracts/manuscript.ts:54-59`, Go `DraftSection` `apps/desktop/internal/importer/model.go:20-25`, built at `:177-211`), `chapterTitles` is title-only (`docx.go:266`, `markdown.go:93`), and paragraphs are not sent in the preview (`apps/desktop/internal/manuscript/service.go:176`). The subtitle exists on `Paragraph.ChapterSubtitle` (`model.go:11-18`, set at `docx.go:274-278`, `markdown.go:71-75`, split by `headingParts`, `headings.go:90-97`) and reaches the chapter only at commit (`service.go:403`, first paragraph's value), then the reader renders "Title - subtitle" (`Manuscript.tsx:366-367`; `AudiobookEstimatePanel.tsx:163-175` uses the same pattern).
- **Subtitle display was never in the modal.** `git log -S"subtitle" -- apps/ui/src/components/home/Home.tsx` finds nothing; the section review was introduced with the four-field `DraftSection` in 6cd65d1 and never carried a subtitle. Inferred (from the code path, not a pre-fix screenshot): before PR #27 (b3c3a07, ADR 0013) the docx importer dropped soft breaks, so the heading text was the glued string "CHAPTER ONEBad Ideas Look Great in Neon" and the modal displayed the subtitle, glued to the title. Fixing the split (`headingParts`) removed it from the modal.
- **The dialog today** (`apps/ui/src/components/home/Home.tsx`, rendered when `importJob?.phase === 'ready'`, `:204`), as a `ConfirmDialog` (`:205-216`, primitive `ConfirmDialog.tsx`, `Dialog.tsx`): a body string `FORMAT · N paragraphs · N proposed chapters.` plus the reset warning (`:207`); a native Markdown heading-level select (`:217-239`, markdown only; changing it re-runs the preview and swaps the dialog to the `WorkDialog`, resetting `importSelection`, `:225`); a dead PDF chapter list (`:240-242`, the host rejects PDF); a "Review imported structure" fieldset with the sentence "Reference material stays readable but is excluded from audiobook totals and Proofing." (`:243-250`) and one label + native select per section (`:253-270`; options "Narration chapter", "Front Matter", "Reference material"); "Story Bible character suggestions" checkboxes (`:275-307`); and "Preview activity" (a progress bar and an `h-36` log, `:308-322`).
- **The count is wrong.** `chapterTitles.length` includes reference sections such as Characters and Glossary (they are titles before classification), so "N proposed chapters" disagrees with the section kinds, and there is no pluralization ("1 proposed chapters"). Sections list in `titles`-first order, so Front Matter appears last (`model.go:166-172`), and sections are deduplicated by title (`model.go:155-165`), so repeated titles merge and the first subtitle wins.
- **The sentence is half right.** "Excluded from audiobook totals and Proofing" holds (`AudiobookEstimatePanel.tsx:63`, `sidecars/transcript-compare/core/compare.py:784`, `manuscript_guide.py:211`, `chapter_script.py:65`, `TeleprompterPage.tsx:151`, `apps/desktop/app.go:596`) but is narration-only, so Front Matter is excluded the same way and the sentence implies otherwise. "Stays readable" is ADR 0005 (reference material is filtered at the listing layer only, `isListableChapter`, `apps/ui/src/state.ts:7`); the ADR does not contain the sentence. It appears in no test, doc or story.
- **No grouping primitives exist.** `Panel` is a bare `<section>` (`Panel.tsx:3-4`), `Heading` is always `<h1>` (`Heading.tsx:3`), `Field` has no select variant (`Field.tsx:1`). There is no Disclosure or Badge; the only disclosure pattern is a hand-built chevron button with `aria-expanded` (`AudiobookEstimatePanel.tsx:92-100`), badge-like chips are inline classes (`EntitySummary.tsx:18`, `Home.tsx:350-357,378-382`, `Results.tsx:51`), and the uppercase legend classes are repeated in 8 files. `docs/design/design-system.md:19-26` lists only Dialog, Button, Highlight, SlideOver, Pill and MeterBar. `Tooltip` was a portaled "i" icon that keyboard users could not reach; it is now an info button with a popover ([ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)). No Tooltip sits inside a dialog today, and one inside a `Dialog` stays above it and takes the first Escape ([ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md), [ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)).
- **The dialog is untested and unseen.** There is no `Home.test.tsx`; only `App.test.tsx:221-285` covers the import (activity log and refresh) and `wailsClient.test.ts:41-52` covers forwarding checked candidates. The section selects, character checkboxes, heading-level select and grouping are never rendered by a test. The mock preview is `{format:'docx', sourceName:'Alice.docx', paragraphCount:240, chapterTitles:['Chapter 1']}` with no `sections` or `characterCandidates` (`mockApi.ts:319,333`), and its log says "3 chapters, 0 suggestions" (`:351`). The visual rows `home/import-confirm`, `import-activity-log` and `manuscript-candidate-offer` (`state-catalog.ts:34-40`, drivers `app.drivers.ts:126-138`) therefore show only the body line and "Preview activity" in `docs/images/ui/home-import-confirm.webp`.
- **Constraints from ADRs.** ADR 0001 (dialog `max-w-[70vw]`, body scroll capped at 80dvh, no horizontal scroll; about 273px wide at 390px), ADR 0002 (action row: Cancel left, affirmative right), ADR 0009/0017 (Tailwind utilities only, mutually exclusive state classes, no new unlayered CSS), ADR 0004 ("Front Matter" title, `"opening"` enum), ADR 0005, ADR 0013 (repaired splits are guesses and go to `Draft.Notices`, shown only in the log at 70%), ADR 0015 (no invented progress), ADR 0019 (review dialog is "section review, character suggestions, then commit"; the offer dialog is separate).
- **Overlap with the briefs PRD.** Its Phase 5 bundles "subtitle in the preview payload" with `subtitleOverrides`, a `ManuscriptImportCommit` signature change and an API bump, gated on Phase 4 evidence ("If Phase 4 finds no failures, we don't build it", `story-bible-and-import-ux-briefs.prd.md:45,186,216-218`). Request 5 is only the *display* half, needs no binding change (the preview is a `map[string]any`, `service.go:176`, and `decode<WorkJob>` does not whitelist fields, `wailsClient.ts:74-75`), and would give Phase 4 its evidence. Its Phase 3 adds a per-import "Build the Story Bible after import" checkbox to this same dialog (`:88,208`).

- **"Preview activity" is not wanted on the review screen (user, 2026-09-20).** The panel is `Home.tsx:308-322` (a progress bar at `importJob.percent`, always 100 when ready, and an `h-36` log). It is fed by `Service.report`, which raises percent and appends a log line together (`apps/desktop/internal/manuscript/service.go:88-96`, ADR 0015). The only content that exists nowhere else is `Draft.Notices` (glued-heading repairs, docx only), which reaches the UI only through `progress.report(70, ...)` (`docx.go:280-282`); the `preview` map (`service.go:176`) does not include `notices`, so removing the panel alone would hide repairs entirely. `job.Logs` is never reset between preview and commit (`service.go:126-139`), so the log also accumulates duplicate lines after a heading-level re-preview. The commit-time `WorkDialog` keeps its own progress bar and log. Tests that assert the panel: `App.test.tsx:280` (`getByText('Preview activity')`) and `:281` (`.progressbar` in the ready dialog); `:285` (`.progressbar` in the commit `WorkDialog`) must keep passing. Also affected: visual states `home/import-confirm` and `import-activity-log`, `doc-screenshots.json`, `docs/guides/using-the-app/home.md:16-19,33`.

## Proposed Solution

Three steps, in order:

1. **Make the dialog visible and testable**: a realistic mock preview (sections of every kind, a subtitle, character candidates, a markdown variant), a Vitest suite, a visual state that renders the review, and extraction of the review body from `Home.tsx` into its own component, with no behavior change.
2. **Show subtitles**: add `subtitle` to the section payload and render it after the title.
3. **Regroup with a summary**: a summary line of what was detected (narration chapters, front matter, reference material, character suggestions), one collapsible group per kind holding its rows, the explanatory sentence removed and its content moved to a tooltip on the Reference material group (or its selects), plus correct counts and plurals.

## Key Hypothesis

We believe showing each chapter's subtitle and summarizing what was detected before listing anything will let a narrator confirm an import at a glance and drill in only where the importer guessed wrong. We'll know we're right when the review for the user's manuscript shows "Chapter One - Bad Ideas Look Great in Neon", the summary matches the effective section kinds and updates live when a row is reclassified, and the reference-material note appears on hover or focus and nowhere else.

## What We're NOT Building

- The subtitle **override** (per-heading toggle, `subtitleOverrides`, commit signature change, API bump): still Phase 5 of the briefs PRD, gated on its Phase 4 evidence. This PRD's rows leave room for a trailing control so that work does not redo them.
- The "Build the Story Bible after import" checkbox (briefs PRD Phase 3); the redesign reserves an options group for it.
- A settings step or a second dialog; the review stays one dialog (ADR 0019).
- Changes to how sections are detected or classified (`newDraft`, `headings.go`), including merging repeated titles.
- The Markdown heading-level re-run behavior.
- The modal dialog overhaul (Escape, focus trap): delivered by the Base UI foundation ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Subtitle shown | A section with a subtitle renders "Title - subtitle"; a section without one renders the title only | Go `model_test.go` case on a soft-break docx (fixtures at `docx_test.go:15-70`) plus Vitest |
| No API bump | `hostAPIVersion` unchanged (12; the subtitle and notices are additive fields) | Diff review |
| Summary is exact | Counts equal the effective kinds, update on reclassification, correct plurals | Vitest with the mock preview |
| Chapter count | "proposed chapters" counts narration sections only | Vitest |
| Reference note | Absent from the dialog body; present as a tooltip on the Reference material group | Vitest and PNG review |
| No sideways overflow | 0 at desktop, small-desktop, tablet, mobile (ADR 0001) | Playwright visual suite (a failing gate) |
| Coverage of the dialog | Vitest for grouping, summary, subtitle, candidates and heading level; new visual states for collapsed and expanded groups | `pnpm check`, visual suite |
| Existing import flow | `App.test.tsx:221-285` still passes except the two assertions on the removed panel (`:280` "Preview activity", `:281` ready-dialog `.progressbar`), which are replaced by assertions on the summary and the repairs note; the commit `WorkDialog` progress assertion (`:285`) is unchanged | `pnpm check` |
| No activity panel on the review screen | Absent; glued-heading repairs still visible as a note | Vitest with a docx preview carrying `notices` |
| Screenshots and guide | `home-import-confirm` and `home.md:16-19` updated | `doc-screenshot-sync` |

## Open Questions

- [x] **I1. Where does the reference-material tooltip go?** Options: (a) an "i" on the Reference material group header (recommended, one place, not repeated per row); (b) a `TooltipTarget` around each row's select (repeats N times); (c) around only rows currently set to Reference. A native `<option>` cannot host a tooltip. The "i" is not keyboard-reachable until the Tooltip PRD lands, and the tooltip may render behind a native-top-layer dialog after the dialog PRD's Phase 2. Recommendation: (a), and verify against both PRDs' status at delivery. **Answered (D6, ADR 0049):** (a): an info-icon button beside the Reference material group header, whose text is a popover; the Tooltip dependency is delivered.
- [x] **I2. Tooltip wording.** The current sentence omits that Front Matter is excluded too. Options: keep the wording for reference only, or say "Excluded from audiobook totals and Proofing. Still readable in the manuscript." on Reference and add an equivalent for Front Matter. Recommendation: one short string per group, accurate for that group. **Answered (D22):** one short string per group, accurate for that group (Reference and Front matter each say what they are excluded from).
- [x] **I3. Subtitle source.** The first paragraph's `ChapterSubtitle`, as commit does (`service.go:403`), or title-keyed? Repeated titles merge (`model.go:155-165`) and heading-only sections have none. Recommendation: the first paragraph's, matching commit exactly. **Answered (D22):** the first paragraph's subtitle, as commit does.
- [x] **I4. What does "chapters" count in the summary?** Narration only (matches Home's "narratable chapters", `AudiobookEstimatePanel.tsx:63`) or narration plus front matter (`isListableChapter`, ADR 0005)? Recommendation: narration only in the headline, front matter listed as its own line. **Answered (D22):** narration only in the headline, front matter as its own line.
- [x] **I5. Disclosure component.** Options: (a) a real `Disclosure` primitive with stories and an atlas entry (`atlasCoverage.test.ts`), also usable by `AudiobookEstimatePanel`; (b) reuse the inline chevron + `aria-expanded` pattern; (c) native `<details>`, unused in the codebase. Recommendation: (a) if a second consumer is accepted in the same PRD, otherwise (b). **Answered (owner, D1):** a real `Disclosure` primitive built on the wrapped Base UI `Collapsible`, with stories and an atlas entry.
- [x] **I6. Default expansion.** Recommendation: expand the exceptions (Front matter and Reference material, and Characters when any candidate is unchecked), collapse narration chapters when there are many. **Answered (D22):** expand the exceptions (Front matter, Reference material, Characters when any is unchecked); collapse narration chapters when there are many.
- [x] **I7. Where does expand/collapse state live?** Changing the heading level swaps the dialog to the `WorkDialog` and resets `importSelection` (ids change), which would also reset local state. Recommendation: hold it in the extracted component's parent, reset only on a new preview. **Answered (D22):** the open/closed choices are held by `Home`, above the swapped component, and reset when a new file is chosen.
- [x] **I8. Character selection semantics.** `characterCandidateIds` undefined means all checked, and commit always sends the full explicit list (`Home.tsx:98-99,105,284,293`); "3 of 5 selected" must compute that default, and "select all / none" writes an explicit list. Recommendation: keep the wire behavior and compute the display. **Answered (D22):** keep the wire behaviour, compute the display.
- [x] **I9. Interim.** Ship request 4 alone first (drop the sentence, tooltip on the current select rows), or fold it into the regroup? Recommendation: fold it in, the placement depends on the grouping. **Answered (D22):** folded into the regroup.
- [x] **I10. Native selects.** Unstyled selects (`Home.tsx:220,255`) differ from token-styled ones (`ScopedSetting.tsx:43-44`); `Field` has no select. Converge now or leave? Recommendation: leave, unless the regroup needs a shared row component anyway. **Answered (owner):** the token-styled `Select` primitive (delivered by S10b) is used for every select.
- [x] **I11. Accessible name.** Rows use `aria-label="{title} content type"` (`:256`); should the name include the subtitle? Recommendation: yes, when present. **Answered (D22):** the accessible name includes the subtitle when present.
- [x] **I12. Split the briefs PRD.** Amend Phase 5 of `story-bible-and-import-ux-briefs.prd.md` so display ships here and only the override stays gated. Recommendation: yes, in the PR that delivers Phase 2 below. **Answered (D22):** the briefs PRD is amended in phase 2; only the override stays gated.

## Users & Context

**Primary User**: an independent narrator importing a manuscript (docx or Markdown) into a project, Windows first.
**Current behavior**: scans a long flat list to work out what was detected; cannot see subtitles, so cannot verify title/subtitle splits; reads a fixed paragraph of policy text every time.
**Trigger**: importing or replacing a manuscript.
**Success state**: a two-line summary says what was found; groups open where a decision is needed; subtitles confirm the split.
**Job to Be Done**: When I import a manuscript, I want to see what the importer found and change only what is wrong, so I can commit with confidence and start recording.
**Non-Users**: narrators who never import (they start from a candidate offer, unchanged); developers testing the importer directly.

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | `DraftSection.subtitle` (Go) and `ManuscriptImportSection.subtitle?` (TS), filled from the first paragraph with a subtitle; no binding change | 2 |
| Must | Rows render title plus subtitle (faint, after the title) with a `title` attribute for truncation | 2 |
| Must | Summary of detected counts by effective kind, updating live | 3 |
| Must | Groups by kind (Narration chapters, Front matter, Reference material, Character suggestions), each with a count and a collapse control | 3 |
| Must | Remove the "Reference material stays readable..." sentence; tooltip on the Reference material group | 3 |
| Must | Remove the "Preview activity" panel from the review screen; add `notices` to the preview payload and show repairs as a summary note (commit-time `WorkDialog` keeps its log) | 3 |
| Must | Mock preview with sections of every kind, a subtitle and candidates; Vitest; visual state(s); component extraction | 1 |
| Should | Correct chapter count and pluralization in the body | 3 |
| Should | Options group (heading level) reserved above the groups for the Story Bible checkbox | 3 |
| Should | Groups list in document order within a kind; Front Matter no longer last only by accident of `newDraft` | 3 |
| Could | A `Disclosure` primitive with stories | 3 |
| Could | Select-all / none for character suggestions | 3 |
| Won't | Subtitle override, section detection changes, dialog modality work | - |

**User flow**: choose a manuscript; the dialog opens on `Import Alice.docx` with "12 chapters · 1 front matter · 2 reference · 3 character suggestions" (illustrative) and the groups collapsed except where a decision is likely; the narrator opens Reference material, sees the tooltip on hover or focus, changes a row, watches the summary update, and confirms with **Import**.

## Technical Approach

**Feasibility**: HIGH; every part exists except the component structure, and the payload change is one optional field.

**Architecture notes**
- **Payload**: `apps/desktop/internal/importer/model.go` adds `Subtitle string \`json:"subtitle,omitempty"\``, filled in `newDraft` from the first paragraph in `group.indexes` with a non-nil `ChapterSubtitle` (no signature change). Rejected: putting the subtitle into `chapterTitles`, which is also used for counts, the PDF line and the log, and would re-glue the title.
- **UI**: extract the review body (heading-level select, groups, candidates, activity) from `Home.tsx` into a component and pass it as `children` of `ConfirmDialog` (the body prop is a `string`, `ConfirmDialog.tsx:46-48`; the dialog PRD Phase 4 changes it to `ReactNode`, which would let the summary live in `body`). Compute counts from `importSelection.sectionKinds?.[id] ?? section.contentKind`. Reuse Tailwind token classes only.
- **Coordination**: `Home.tsx` is also edited by briefs PRD phases 2, 3 and 5, the dialog work that is now delivered ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md) changed the `ConfirmDialog` API and the `Home.tsx` call site; [ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md) leaves the import `cancel` logic alone), the interaction feedback work (delivered by stack S14: the choose-a-file button is busy while the host dialog is open and the import's end is a `job:ended` event) and `chapter-stage-recommendations.prd.md` (phase 5). Extracting the component in Step 1 shrinks that surface, and the citations to `Home.tsx:217/243/275` in the briefs PRD go stale.
- **Tests**: Go `model_test.go` case for `Sections[i].Subtitle`; Vitest for the extracted component (grouping, live summary, subtitle, candidate default and explicit lists, heading-level reset); extend `mockApi.ts` (add `mockImportPreview`) and a `main.tsx` seam; catalog rows for the review, expanded and collapsed, and a Markdown variant (heading-level select), each with a driver (`visual-catalog-sync`); a `ConfirmDialog`-with-long-content story already exists (`LongScrollingChildren`).
- **Docs**: `docs/guides/using-the-app/home.md:16-19` and the `home-import-confirm` screenshot (`doc-screenshots.json:87-92`); `docs/architecture/docx-import-quirks.md` if subtitle display becomes tested behavior; amend the briefs PRD Phase 5 (I12). Possibly an ADR if a `Disclosure` primitive or the "display now, override later" split counts as a decision; do not edit ADRs 0001, 0002 or 0005.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Long titles and subtitles overflow at 390px (about 238px of content) | High | ADR 0001 wrapping (`break-words`, no horizontal scroll); Playwright overflow gate at all four viewports |
| Summary and rows disagree after reclassification | Medium | Derive both from one effective-kind function; Vitest |
| Heading-level change resets the dialog and group state | Medium | Hold state above the swapped component (I7) |
| First Tooltip inside a dialog is clipped or hidden (z-index, top layer) | Medium | Verified: a hint inside a dialog stays above it and takes the first Escape ([ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md), [ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)) |
| Merge conflicts on `Home.tsx` with several PRDs | High | Extract the component first; small hunks; rebase |
| Subtitle looks wrong for merged or heading-only sections | Low | Document I3; first subtitle wins, as at commit |
| The user's manuscript splits differently than the fixtures | Medium | Add the user's "CHAPTER ONE / Bad Ideas Look Great in Neon" shape as a fixture and check on their file |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Coverage and extraction | Mock preview with sections/candidates/subtitle, Vitest, visual states, extract the review component; no behavior change | complete | - | - | - |
| 2 | Show subtitles | `Subtitle` in `DraftSection` and the contract, render in rows, Go and Vitest tests, screenshot and guide refresh, amend the briefs PRD (I12) | complete | - | 1 | - |
| 3 | Grouped summary layout | Summary, groups, counts and plurals, tooltip replacing the sentence, options group, optional `Disclosure`, states, screenshots, guide | pending | - | 1 (2 preferred) | - |

### Phase Details

**Phase 1 - Coverage and extraction**
- **Goal**: make the review dialog seen and pinned before changing it.
- **Scope**: `mockImportPreview` (docx with narration, opening, reference sections, one subtitle, three candidates) and a Markdown variant; a `main.tsx` seam; Vitest pinning today's behavior (per-section select, candidate default and explicit, heading-level re-run); visual rows and drivers for the review; extract the component from `Home.tsx`; keep `App.test.tsx:221-285` green.
- **Success signal**: new tests pass against the unchanged UI; PNGs of the review reviewed at four viewports; no visible change beyond the richer mock.

**Phase 2 - Show subtitles**
- **Goal**: chapter subtitles appear in the review.
- **Scope**: Go field and `newDraft` fill; TS contract; row rendering with a faint subtitle and a `title` attribute; `model_test.go` on a soft-break docx; Vitest; `home-import-confirm` screenshot and `home.md`; amend the briefs PRD.
- **Success signal**: the user's manuscript shows "Chapter One - Bad Ideas Look Great in Neon"; `hostAPIVersion` unchanged; `pnpm check` and the visual suite green.

**Phase 3 - Grouped summary layout**
- **Goal**: summarize what was found and group the choices.
- **Scope**: "Preview activity" panel removed from the review screen (`notices` added to the preview payload and `ManuscriptImportPreview`, no binding signature change; repairs shown as a summary note; `App.test.tsx:280-281` replaced), effective-kind counts, summary line, collapsible groups, correct chapter count and plurals, sentence removed and tooltip added (I1, I2), an options group for the heading select, tests, states (collapsed, expanded, characters partially checked, markdown), screenshots, `home.md`, and `Disclosure` with stories if I5 chooses it.
- **Success signal**: PNGs at desktop, small-desktop, tablet and mobile reviewed with no overflow; the summary matches after reclassification; the tooltip is reachable by hover and keyboard.

**Parallelism Notes**: strictly sequential (all three edit the same component); Phase 3 could start after Phase 1 if Phase 2's row change is expected to conflict trivially.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `Home.tsx`, new review component, `mockApi.ts`, `main.tsx`, `state-catalog.ts`, `app.drivers.ts`, new tests | Briefs PRD phases 2, 3, 5; interaction audit phase 5; chapter-stage-recommendations phase 5 (all edit `Home.tsx`) |
| 2 | `apps/desktop/internal/importer/model.go` and tests, `contracts/manuscript.ts`, review component, `doc-screenshots.json`, `home.md`, briefs PRD | Briefs PRD phase 5 (importer, contract), any change to `newDraft` |
| 3 | review component, possible new `Disclosure` primitive (`components/primitives/`, story, `docs/ui/`), Tooltip use, catalog/drivers, screenshots | the delivered dialog family and tooltips ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md), [ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)), palette PRD (tokens) |

Cross-cutting: `visual-catalog-sync`, the Playwright visual suite with PNG review of `apps/ui/screenshots/app/<page>/<state>/<viewport>.png` at all four viewports, `doc-screenshot-sync`, the atlas and `design-spec-guard` when a primitive is added; ADR numbering re-checked at merge time (0037 at dc9d01a); each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `design-spec-guard`, `feature-cleanup`. No Lua, so no manual REAPER step.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Reference material is filtered only at the listing layer (prior, ADR 0005) | Unchanged; the note becomes a tooltip | Keep the sentence | Requested |
| The review is one dialog, offered not imported silently (prior, ADR 0019) | Kept | Extra step | Standing decision |
| Dialog width and overflow, action row placement (prior, ADR 0001, 0002) | Kept | New layout | Standing decisions |
| Real progress only (prior, ADR 0015) | No invented progress in any summary | - | Standing decision |
| Subtitle display is separate from the override (proposed) | Display now, override stays evidence-gated | Ship both | Display needs no binding change and produces the evidence |
| Subtitle payload | New `subtitle` field on the section (proposed) | Put it in `chapterTitles` | Keeps titles clean for counts and logs |
| Order | Coverage and extraction, then subtitles, then regroup (proposed) | Regroup first | The dialog is untested today |
| Owner decisions applied (2026-09-21, plan section 1) | D1 and D6 (a wrapped Base UI `Collapsible` and `Disclosure`, an info-icon popover for the note), D8 (the Story Bible build after import is on by default: this PRD reserves the checkbox and leaves a documented seam, the chaining is built by the briefs PRD), D16 (`subtitle` and `notices` are added to the schemas and the mock passes them), D22 (the recommendations of I2, I3, I4, I6 to I9, I11, I12) | | The plan's decisions override the text above where they differ |

## Research Summary

**Technical Context**: verified in code on this branch: the dialog structure and copy, the importer payload path and its history, the primitives and their gaps, ADR constraints, test and fixture coverage, the visual rows and screenshot, and the overlap with the briefs and dialog PRDs.
**Not verified**: that PR #27 is what removed the glued subtitle from the modal (inferred, no pre-fix screenshot); how the user's own manuscript splits its headings; whether a tooltip inside the dialog is reachable and visible once the dialog PRD lands.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
