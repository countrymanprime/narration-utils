# Using the app

A screenshot walkthrough of the narration workspace, page by page. The screenshots on this
page are generated from the same mock data used by the app's Playwright visual test suite
(`shared/ui/tests/visual/`) — see [`doc-screenshot-sync`](../../.claude/skills/doc-screenshot-sync/SKILL.md)
for how they're kept current when the UI changes.

## Home

The landing page after opening a project: manuscript status, audiobook time estimates,
recording progress, and shortcuts into the latest Proofing comparison and Story Bible review.

![Home, manuscript found](../images/ui/home-default.webp)

## Manuscript

The manuscript reader shows the imported chapter text with characters, places, and other
entities highlighted inline. Text size is adjustable independently of the rest of the app.

![Manuscript reader at the medium text size](../images/ui/manuscript-reader.webp)

![Manuscript reader at the large text size](../images/ui/manuscript-reader-large.webp)

## Proofing

Proofing transcribes a recorded chapter and compares it against the manuscript. The Setup
step picks the transcription model, chunk length, and any vocabulary hints before starting
a comparison.

![Proofing setup panel before starting a comparison](../images/ui/proofing-setup.webp)

Once a comparison finishes, the Results step lists every discrepancy between what was written
and what was heard, expandable for the full context around each one.

![Proofing results table with a discrepancy row expanded](../images/ui/proofing-results.webp)

## Story Bible

Story Bible tracks every character, place, and organization extracted from the manuscript,
with pronunciation, aliases, and narration notes. Category tabs filter the list.

![Story Bible filtered to the Characters category](../images/ui/storybible-characters.webp)

Selecting an entry opens its detail panel for editing pronunciation, aliases, and notes.

![Story Bible entity detail panel](../images/ui/storybible-entity.webp)

## Settings

Settings are split into Global (defaults for every project) and This Project (overrides for
the current one), organized by category.

![Settings, Global scope, General category](../images/ui/settings-general.webp)

Appearance controls the light/dark theme.

![Settings, Global scope, Appearance category](../images/ui/settings-appearance.webp)
