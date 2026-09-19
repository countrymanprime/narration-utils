# Using the app

A screenshot walkthrough of the narration workspace, page by page. The screenshots on this
page are generated from the same mock data used by the app's Playwright visual test suite
(`shared/ui/tests/visual/`) — see [`doc-screenshot-sync`](../../.claude/skills/doc-screenshot-sync/SKILL.md)
for how they're kept current when the UI changes.

## Getting started

Launching the app without a project folder attached shows a picker instead of the workspace:
recent projects to reopen, or actions to browse to an existing folder or create a new one.

![No project open yet - recent projects, browse, and create actions](../images/ui/project-picker.webp)

## Navigation

Home, Manuscript, Proofing, and Story Bible are reachable from a sidebar on the left. At
desktop widths it stays open with labels; narrower windows switch it to icon-only, then hide
it behind a hamburger menu that opens it as a slide-in drawer. Settings lives at the bottom
of the sidebar in every layout.

![Primary navigation sidebar at desktop width](../images/ui/nav-sidebar-desktop.webp)

![Primary navigation drawer opened on a narrow window](../images/ui/nav-drawer-mobile.webp)

## Home

The landing page after opening a project: manuscript status, audiobook time estimates,
recording progress, and shortcuts into the latest Proofing comparison and Story Bible review.

![Home, manuscript found](../images/ui/home-default.webp)

The estimate card's per-chapter breakdown is collapsed by default; expanding it lists every
chapter with its word count, estimated and actual recorded length, and status.

![Home, per-chapter breakdown expanded](../images/ui/home-chapter-table-expanded.webp)

Importing (or replacing) the manuscript opens a confirm dialog previewing the detected format,
paragraph count, and proposed chapters before anything changes.

![Home - import manuscript confirm dialog with format/paragraph/chapter preview](../images/ui/home-import-confirm.webp)

## Manuscript

The manuscript reader shows the imported chapter text with characters, places, and other
entities highlighted inline. Text size is adjustable independently of the rest of the app.

![Manuscript reader at the medium text size](../images/ui/manuscript-reader.webp)

![Manuscript reader at the large text size](../images/ui/manuscript-reader-large.webp)

Chapters default to fully expanded inline; collapsing them switches to a compact list for
jumping between chapters without scrolling through the full text.

![Manuscript, collapsed chapter list](../images/ui/manuscript-chapter-list.webp)

Selecting a stretch of text offers actions for it — adding a reader note or sending it to the
Story Bible as a new entry.

![Manuscript - text-selection action popup (+ Note, + Story Bible)](../images/ui/manuscript-selection-popup.webp)

Choosing "+ Note" opens a dialog to write the note against that selection.

![Manuscript - Add Note dialog open after selecting text](../images/ui/manuscript-add-note.webp)

Clicking an existing note or a highlighted entity opens a detail sidebar on the right —
the note's anchored text and content for a note, or pronunciation, description, and evidence
for an entity.

![Manuscript - detail sidebar open on a reader note](../images/ui/manuscript-note-sidebar.webp)

## Proofing

Proofing transcribes a recorded chapter and compares it against the manuscript. The Setup
step picks the transcription model, chunk length, and any vocabulary hints before starting
a comparison.

![Proofing setup panel before starting a comparison](../images/ui/proofing-setup.webp)

Model, chunk length, and worker count are independent selections — picking a slower, more
accurate model can force other settings to adjust (here, workers dropped to 1 because the
Large model doesn't support Auto).

![Proofing setup panel with a different model, chunk length, and worker count selected](../images/ui/proofing-setup-alt.webp)

Vocabulary hints teach the transcription model unusual names it's likely to mis-hear.
"Suggest from manuscript" proposes candidates from the Story Bible; accepted hints render as
solid pills, suggested-but-not-yet-accepted candidates as dashed outlines you click to accept.

![Proofing - vocabulary hint chips: an accepted term alongside suggested (pending) candidates](../images/ui/proofing-hint-chips.webp)

Once a comparison finishes, the Results step lists every discrepancy between what was written
and what was heard, expandable for the full context around each one. Each row is typed —
a misread word, a skipped one, or words heard that weren't written at all (EXTRA).

![Proofing results table with a discrepancy row expanded](../images/ui/proofing-results.webp)

![Proofing - an EXTRA (words heard but not written) discrepancy row expanded](../images/ui/proofing-results-extra.webp)

## Story Bible

Story Bible tracks every character, place, and organization extracted from the manuscript,
with pronunciation, aliases, and narration notes. Category tabs filter the list.

![Story Bible filtered to the Characters category](../images/ui/storybible-characters.webp)

Selecting an entry opens its detail panel for editing pronunciation, aliases, and notes.

![Story Bible entity detail panel](../images/ui/storybible-entity.webp)

Typing into the alias field opens a dropdown of existing entries whose name or alias matches,
so a name mentioned under a different spelling can be merged into the entry it already
belongs to instead of creating a duplicate.

![Story Bible alias field with a matching-entries dropdown open](../images/ui/storybible-alias-dropdown.webp)

## Settings

Settings are split into Global (defaults for every project) and This Project (overrides for
the current one), organized by category.

![Settings, Global scope, General category](../images/ui/settings-general.webp)

Appearance controls the light/dark theme.

![Settings, Global scope, Appearance category](../images/ui/settings-appearance.webp)

![Home with Dark theme selected](../images/ui/theme-dark.webp)

Other categories mix dropdowns and color pickers — Manuscript's own category, for example,
controls the color used to mark reader notes in the text.

![Settings - Global scope, Manuscript category (note color picker)](../images/ui/settings-manuscript.webp)

This Project's "Project data" category is a project-only danger zone: it clears the imported
manuscript, Story Bible, proofing artifacts, and reader notes for the current project, while
leaving its settings in place.

![Settings - Project scope, Project data category (clear derived project data)](../images/ui/settings-project-data.webp)
