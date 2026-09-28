# 0670. Script's chapter list keeps its to-confirm count and shows no checkmark or percentage until prep-depth's rollup lands

**Status:** Proposed
**Date:** 2026-09-28
**Supersedes:** none

## Context

mock-fidelity-primitives-and-components.prd.md Phase 15 (stream F-P15) composes the Script page's rail and chapter
list against benchmark mock 02 (`docs/research/mockups/audiobook-studio-benchmark/02-prep-script.webp`). The mock's
chapter list draws a ✓ beside every chapter but the one being read, and a right-aligned "80%" in `--accent-strong`
beside the active one.

`ScriptChapterList.tsx`'s own comment already explains why today's list shows neither: the only prep signal the app
has per chapter is `toConfirm`, a count of names first heard in it whose pronunciation the author has not confirmed
(prep-depth PRD Phase 3). A count of zero does not mean a chapter is fully prepped - nothing today tracks the other
prep steps (markup placed, pronunciations checked, queries answered) well enough to call a chapter "done", and
prep-depth PRD Phase 7's rollup, which would, has not shipped. Showing a ✓ or a percentage now would be a fabricated
claim, not a drawn one.

## Decision

`ScriptChapterList.tsx` keeps its `toConfirm` count and its "N to confirm" `StatusBadge`, with nothing shown for a
chapter with none, rather than adding a ✓ or a percentage to match mock 02. This is filed on #510 for the owner: the
mock's per-chapter completion mark is real product work (prep-depth Phase 7's rollup), not a Script-page styling
gap, and Phase 15 does not invent the data to draw it early.

## Consequences

- Script's `prep-rail-pronunciations` mock-match score (85.71%, `apps/ui/tests/visual/mock-match/mocks.ts`) stays
  under the 90% bar for this reason among others; it is named in the PR's Mockup check and on #510 rather than
  worked around with placeholder data.
- Phase 15 does still migrate what it owns outright: the rail's Characters and Queries lists move to `Table`
  (matching Pronunciations, already a table since an earlier pass), and `ParagraphView.tsx` draws a paragraph's
  speaker bar (a 3 px inset shadow in the speaker's own colour token, `speakerColor.ts`) before its chip, the same
  device the retail-sample band already used for its own inset bar.
- Whichever phase ships prep-depth's rollup can revisit this ADR and draw the mock's ✓/percentage once the data
  backing it exists, without Script-page code needing to change again beyond reading the new field.
