# 0086. The import review is grouped by what each section will be, and reports the importer's repairs instead of its log

**Status:** Accepted
**Date:** 2026-09-21
**Supersedes:**

## Context

The review dialog for "Import manuscript" was a flat list of every section with a select each, a permanent sentence about reference material, the character suggestions, and a "Preview activity" progress bar and log. It hid what the importer had found (no summary, no subtitles, front matter last only because of the order `newDraft` builds sections in), it counted reference sections as "proposed chapters", it had no test, and the mock showed none of it. The user asked (2026-09-19 and 2026-09-20) for subtitles, a summary and grouped sections, the sentence turned into a tooltip, and the activity panel removed from the review screen. The implementation plan's owner decisions apply: D1 and D6 (wrapped Base UI primitives, info icons that are buttons with a popover), D8 (the Story Bible build after import is on by default, built by the briefs work), D16 (a Zod schema for every new field) and D22 (the PRD's recommendations for the open questions). [ADR 0015](0015-real-progress-only.md) (no invented progress), [ADR 0019](0019-detected-manuscript-is-offered-not-imported.md) (one review dialog) and [ADR 0001](0001-import-dialog-max-width-and-overflow.md) (width, no sideways scroll) stand.

What the work found:

- A `<fieldset>` does not shrink below the width of its content, so one long subtitle pushed every row's select out of the dialog and the overflow gate did not notice; the fieldsets are `min-w-0`.
- The only content the preview log carried that exists nowhere else is `Draft.Notices` (a heading whose number and title were run together and which the importer split). Without the log panel those repairs would be invisible, so they travel in the preview.
- A note opened by hovering an info icon inside a dialog did not close on Escape: the dialog kept the Escape for the hint that was showing, and the hint never heard it. It was invisible before because no info icon sat inside a dialog.

## Decision

- **A section shows its subtitle**, the first paragraph's (`DraftSection.Subtitle`, `json:"subtitle,omitempty"`), which is what `manuscript.canonicalize` gives the written chapter. It is an additive field, so `hostAPIVersion` is unchanged. Changing a wrong split (`subtitleOverrides`) stays with the briefs PRD and its evidence gate.
- **The review is grouped by the kind each section will be written as**, in `apps/ui/src/components/home/ImportReview.tsx`: Narration chapters, Front matter, Reference material, the Story Bible character suggestions and, when the importer repaired anything, Repairs. A row moves to its new group when it is reclassified (focus stays on its select, and the group it moves into opens). The summary in the dialog message and the group counts are read from one function (`importReviewModel.ts`), so they cannot disagree. The headline counts narration chapters only; front matter, reference material, suggestions and repairs are on the second line.
- **Groups start open where a decision is likely**: front matter, reference material, a few repairs, and the suggestions once one is unchecked; the narration chapters start closed when there are more than eight. What the narrator opens or closes is held by `Home`, above the dialog that is swapped for a progress dialog while a Markdown heading level is read again, and is dropped only when a new file is chosen.
- **`Disclosure` is a primitive** (`apps/ui/src/components/primitives/Disclosure.tsx`): the whole title row is the button, with a summary that is part of its name, over Base UI's Collapsible. It sits beside `Collapsible`, whose icon button can sit apart from its panel. An `aside` beside the button holds an info icon, because a control inside a button is not valid.
- **The reference-material sentence is gone.** Front matter and Reference material each carry an info icon (`Tooltip`, which takes a `label` so two on one page have different names) with a short note that is true for that group: reference material is left out of the audiobook totals, Proofing and the chapter list and stays readable; front matter is left out of the totals and Proofing and is listed and readable.
- **"Preview activity" is not on the review screen.** The importer's repairs are in the preview (`notices`, omitted when there are none) and shown as the Repairs group and a count in the summary; the commit dialog keeps its own progress bar and log. The host still writes its staged log line by line (ADR 0015).
- **An info icon closes on Escape wherever focus is** (`Tooltip` listens while its note is open), so a note opened by hover inside a dialog takes the first Escape and the dialog the second.
- **The Story Bible build after import has a seam, not a control.** `ImportReview` draws an "Import options" group with the Markdown heading level and, when it is handed `buildStoryBible`, a checkbox "Build the Story Bible after import". `Home` passes nothing yet, so nothing appears that does nothing. The briefs work (owner decision D8: on by default) supplies the state, the setting and the chaining.

## Consequences

- A narrator sees what was found in two lines, opens only the groups that need a decision, can confirm the title and subtitle split before anything is written, and can read the importer's repairs without the log.
- The row that moves between groups changes what is on screen after a keyboard change; the focus rule and the opened group are what keep that usable, and both are tested.
- Two disclosure shapes exist (`Collapsible`, `Disclosure`); a third caller that needs the row-as-button shape should use `Disclosure`, and one that needs the icon button beside the panel keeps `Collapsible`.
- The preview payload grows by `subtitle` and `notices`; every consumer of the preview must treat both as optional.
- A group's default open state is a rule in `importReviewModel.ts` (`MANY_NARRATION_CHAPTERS`), not a per-manuscript setting; changing the rule is a code change and a new decision if it reverses the ones above.
- Changing any of this (the groups, dropping the repairs, putting the activity panel back) needs a new ADR that supersedes this one.
