# The import review dialog

**Status: implemented.** When a narrator chooses a manuscript (or accepts the offer of one in the project folder), the host reads it into a draft and the app shows a review dialog, "Import <file>", before anything is written. This page is how that dialog is built and what it promises. The decisions are [ADR 0086](../adr/0086-the-import-review-is-grouped-by-what-each-section-will-be-and-reports-repairs-instead-of-a-log.md) (the grouping, the subtitle, the repairs), [ADR 0015](../adr/0015-real-progress-only.md) (real progress only), [ADR 0019](../adr/0019-detected-manuscript-is-offered-not-imported.md) (one review, offered never silent), [ADR 0001](../adr/0001-import-dialog-max-width-and-overflow.md) (width, no sideways scroll) and [ADR 0005](../adr/0005-reference-material-excluded-from-chapter-nav.md) (reference material is filtered at the listing layer only). The work was specified in the import review redesign PRD (deleted when it was done: `git show <commit>:docs/prds/import-review-redesign.prd.md`, see the [PRD index](../prds/README.md)).

## What the narrator sees

Two lines in the dialog message say what was found, counted from the choices as they stand:

> DOCX · 221 paragraphs · 5 narration chapters.
> 1 front matter section · 2 reference sections · 3 of 3 character suggestions checked

The headline counts **narration chapters only**, the sections that are audiobook chapters. Front matter, reference material, the character suggestions and any repairs are on the second line, and a line that has nothing to say is left out. A PDF (the host rejects new ones, but an old preview shape exists) has no sections, so it keeps the host's title count as "proposed chapters". Replacing a manuscript adds what is cleared to the first line.

Under them, one group per kind, each a `Disclosure` with a count:

| Group | Holds | Starts | Note (info icon) |
| --- | --- | --- | --- |
| Narration chapters | sections that will be written as narration | open, closed when there are more than 8 (`MANY_NARRATION_CHAPTERS`) | none |
| Front matter | sections written as `opening` | open | left out of the audiobook totals and Proofing; still listed and readable |
| Reference material | sections written as `reference` | open | left out of the audiobook totals, Proofing and the chapter list; still readable |
| Story Bible character suggestions | the checkboxes, with Select all and Select none | closed while every one is checked, open once one is unchecked | none |
| Repairs | what the importer repaired in the source | open for 3 or fewer, else closed | none |

Each note is one short string that is true for its group (the old sentence spoke of reference material only). A group with no rows is not drawn.

Each row is the section's title, its subtitle in a fainter colour (`Chapter One — Down the Rabbit-Hole`) and a select for its kind. A long line is cut short with an ellipsis and the whole line is in the row's `title` attribute; the select's accessible name includes the subtitle. For a Markdown file an **Import options** group above the groups holds the chapter heading level; reading the file again at another level drops the choices made for the old sections.

## Where the data comes from

The preview job (`ManuscriptImportPreview`, `apps/ui/src/api/contracts/manuscript.ts`) carries, besides the format, size and titles:

- `sections[]`: `id`, `title`, `subtitle?`, `contentKind`, `paragraphCount`. The subtitle is the **first paragraph's** (`DraftSection.Subtitle`, `apps/desktop/internal/importer/model.go`), which is the paragraph `manuscript.canonicalize` writes the chapter from, so the review shows exactly what the chapter will be called. A repeated title is merged into its first section and takes its first subtitle; a heading with no text has none (see [import quirks](docx-import-quirks.md#where-the-subtitle-shows)).
- `characterCandidates[]`, as before.
- `notices?`: the importer's repairs (a title and subtitle that were run together and had to be split, [ADR 0013](../adr/0013-import-preserves-structural-whitespace.md)), as sentences, only when there are some (`previewPayload`, `apps/desktop/internal/manuscript/service.go`).

Both new fields are optional and additive, so `hostAPIVersion` did not change. They are in the Zod schema (`schemas/manuscript.ts`) and in the golden files the Go contract tests write (`manuscript-import-preview.json`, and `manuscript-import-preview-repaired.json` for a Word file whose heading had to be repaired), so the mock cannot send a shape the host does not.

The preview log ("Preview activity") is **not** on the review screen any more; the commit dialog keeps its own progress bar and log. The host still reports every stage as it happens (ADR 0015).

## How it is built

| Piece | Where | Role |
| --- | --- | --- |
| `Home` | `apps/ui/src/components/home/Home.tsx` | Holds the choices (`importSelection`), which groups the narrator opened or closed by hand (`groupOpen`) and the heading level, sends the choices with the commit, and passes the dialog message. Both the choices and `groupOpen` are dropped when a new file is chosen, and kept across a heading-level re-read (the dialog is swapped for a progress dialog meanwhile, so state below it would be lost). |
| `ImportSummary`, `ImportReview` | `components/home/ImportReview.tsx` | The dialog message and the dialog body. Controlled: they show the state they are given and report a change. |
| `importReviewModel.ts` | `components/home/` | The pure half: the kind a section will be written as, the counts, which group starts open, plurals and the two summary lines. The message, the group headers and the rows all read the same function, so they cannot disagree. |
| `Disclosure` | `components/primitives/Disclosure.tsx` | The group: the whole title row is the button and its summary is part of its name. An `aside` beside the button holds the info icon (a control inside a button is not valid). |
| `Tooltip` (the info icon) | `components/primitives/Tooltip.tsx` | A button with the note as its description and a popover; `label` names it ("About reference material"). Escape closes it wherever focus is. |

Reclassifying a row moves it to the group of its new kind. The select is put back in focus in its new place (so a keyboard narrator keeps their place), and the group it moved into opens.

**The seam for "Build the Story Bible after import".** `ImportReview` takes an optional `buildStoryBible: { checked, onChange }` and, when it is given, draws a checkbox "Build the Story Bible after import" in the Import options group. `Home` does not pass it yet, so nothing appears. Owner decision D8 makes the choice on by default; the state, the setting that holds its default, and the build that follows a successful import are the Story Bible briefs work, which adds that state and the chaining without touching the dialog.

## Tests and states

- Go: `model_test.go`, `docx_test.go`, `markdown_test.go` (the subtitle), `service_test.go` (the review's subtitle equals the written chapter's; the repairs travel in the preview) and the contract tests.
- Vitest: `Home.test.tsx` (the dialog through `Home` with the mock host: sections, kinds, commit payloads, heading-level re-read, reset, cancel, subtitles, the summary, the groups kept across a re-read and reset for a new file), `ImportReview.test.tsx`, `importReviewModel.test.ts`, and `App.test.tsx` for the import flow end to end.
- Mock: `mockImportPreview.ts` (a Word book with every kind of section, a Markdown variant behind `?mockImportPreview=markdown`, and `?mockImportPreview=repaired`). The mock passes the same schemas as the host.
- Visual (`apps/ui/tests/visual`): `home/import-confirm`, `import-confirm-markdown`, `import-review-collapsed`, `import-review-characters`, `import-review-repaired`. A long subtitle in the mock (Chapter Four) keeps the truncation under the overflow gate at every viewport.
- Aria (`tests/aria/dialogs.spec.ts`): the dialog's role tree, and that the note on Reference material closes on the first Escape (opened by hover) and the dialog on the second.
