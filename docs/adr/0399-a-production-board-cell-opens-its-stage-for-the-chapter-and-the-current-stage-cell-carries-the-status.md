# 0399. A Production board cell opens its stage for the chapter, and the current-stage cell carries the status

**Status:** Proposed
**Date:** 2026-09-28

## Context

[Stage navigation](../prds/stage-navigation-and-page-replacement.prd.md) Phase 2 replaces Home with the **Production home** at `/`, built to mock 01. The mock's chapter pipeline says "every cell opens that stage for the chapter", and the PRD says the board's cells open "the surfaces Home opened (recording check, stage evidence, editing check, chapter track panel) with the same slide-overs". Three things were left to the phase:

- **Which cell opens which surface.** Home's table had a Track button, a status select with the stage suggestion under it (Confirm, Dismiss, Revert, Why), and a recording-check status button per row. The board has one cell per stage and no room for controls.
- **Where the status override goes.** Home's status select was the narrator's way to set a chapter's stage by hand; the stage suggestion never moves a status on its own (ADR 0160). Losing it would be a lost capability (ADR 0407).
- **The credits rows.** Home drew Opening and Closing credits as table rows with their own status; the stage engine does not assess credits.

## Decision

1. **Recorded** opens the chapter's track slide-over (`ChapterTrackPanel`), where the measured length comes from.
2. **The chapter's current-stage cell** (its status's column, or Record for a chapter not started yet) opens the stage slide-over (`StageEvidence`). Its top carries the **status select**, the recording check's state, and **Recording check** and **Editing check**; the suggestion with Confirm, Dismiss and Revert follows. The cell reads the verdict: Ready, Not ready, Not checked, In progress, or Evidence changed.
3. **A passed or later Record, Edit or Proof cell** opens that stage: the recording check, the editing check, or the chapter's Proof view. **Prep** opens the chapter on Script; **Delivery** opens nothing until Master & QC (Phase 8).
4. **A credits row's cell** opens a credits slide-over (`CreditsRowPanel`) with its template, words, estimated length, unresolved tokens, Open in Script and its status, written only through `setCreditsStatus`.
5. The cells keep `StageGrid`'s words (Done, Not yet, Ready, …) rather than mock 01's glyphs (✓, –): a cell's label is its accessible name, and a glyph reads as "check mark". Glyphs need `StageGrid` to separate a visual label from a spoken one, which is a primitive change for lane U.

## Consequences

- Every surface Home opened is one click from the board, under the same slide-over names, so their aria snapshots and visual states carry over as `production/*`.
- Setting a status by hand takes two clicks instead of one (the cell, then the select). The suggestion and the override sit together, which is what Home's row did.
- The summary chips above the board open the first chapter they count, since there is no collapsed breakdown to expand.
- Mock 01's compact glyph cells wait for a `StageGrid` spoken-label slot (lane U).
