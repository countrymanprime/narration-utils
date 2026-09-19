# Using the app

A screenshot walkthrough of the narration workspace, page by page. The screenshots on this
page are generated from the same mock data used by the app's Playwright visual test suite
(`shared/ui/tests/visual/`) — see [`doc-screenshot-sync`](../../.claude/skills/doc-screenshot-sync/SKILL.md)
for how they're kept current when the UI changes.

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

## Manuscript

The manuscript reader shows the imported chapter text with characters, places, and other
entities highlighted inline. Text size is adjustable independently of the rest of the app.

![Manuscript reader at the medium text size](../images/ui/manuscript-reader.webp)

![Manuscript reader at the large text size](../images/ui/manuscript-reader-large.webp)

Chapters default to fully expanded inline; collapsing them switches to a compact list for
jumping between chapters without scrolling through the full text.

![Manuscript, collapsed chapter list](../images/ui/manuscript-chapter-list.webp)

## Proofing

Proofing transcribes a recorded chapter and compares it against the manuscript. The Setup
step picks the transcription model, chunk length, and any vocabulary hints before starting
a comparison.

![Proofing setup panel before starting a comparison](../images/ui/proofing-setup.webp)

Model, chunk length, and worker count are independent selections — picking a slower, more
accurate model can force other settings to adjust (here, workers dropped to 1 because the
Large model doesn't support Auto).

![Proofing setup panel with a different model, chunk length, and worker count selected](../images/ui/proofing-setup-alt.webp)

Once a comparison finishes, the Results step lists every discrepancy between what was written
and what was heard, expandable for the full context around each one.

![Proofing results table with a discrepancy row expanded](../images/ui/proofing-results.webp)

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
