# 0063. The proofing diff marks its own words, and ADR 0016 covers entry highlights

**Status:** Accepted
**Date:** 2026-09-21
**Supersedes:**
**Amends:** [ADR 0016](0016-highlight-primitive.md) (what "highlighted text" means)

## Context

[ADR 0016](0016-highlight-primitive.md) says `Highlight` is "the only way to render highlighted text". [ADR 0062](0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md) turned that into a check (`src/highlightBoundary.test.ts`) and found one file that does not follow it: `components/proofing/InlineDiffRow.tsx` renders its own `<mark>` around each word that differs between the script and what the recording says (a discrepancy row's "Script" and "Heard" lines), coloured by the discrepancy kind (`MISREAD`, `SKIPPED`, `EXTRA`).

Reading ADR 0016, its problem was the reader and the Story Bible drawing *entry* highlights three ways, with a category that had no colour falling through to the browser's default yellow. Its `Highlight` is built around `highlightKind(category)`, an entry category, and around the reader's per-size line padding. The diff words are not entries: their colour comes from a different vocabulary (`KIND_STYLES`), they are plain static text with no category, no activation and no anchor. So the file is not a breach of what ADR 0016 was about, but it is a breach of what ADR 0016 says.

This is a design question, so the owner has it: the rule started with a one-entry allowlist for this file (implementation plan D22, verification PRD question 7) and the work continues on the recommended path.

## Decision

Recommended, and what the code does now: **ADR 0016's "highlighted text" means text highlighted because it belongs to a Story Bible entry or a note** (the reader, the entity summary, the guide's evidence excerpts). The proofing diff's marks are a different thing, the words that differ between two texts, and `InlineDiffRow` keeps writing its own `<mark>` (a `<mark>` is the right element for text marked for reference, and the row uses only tokens). The allowlist entry in `highlightBoundary.test.ts` stays, with this ADR as its reason, until the owner decides.

The alternatives, if the owner prefers one:

- **Give `Highlight` a second source of colour** (a `tone` for the discrepancy kinds, or accept a style object), and render the diff words through it. One place writes a `<mark>`, and the allowlist entry goes. The cost is a `Highlight` API that knows two vocabularies.
- **Render the diff words as a `<span>`** with the same background. The allowlist entry goes, and the words lose the `<mark>` semantics some screen readers announce as "highlighted". This is the worst for accessibility.

## Consequences

- Accepted as written (2026-09-23): ADR 0016 gains a sentence naming what it covers, the allowlist entry keeps its reason, and nothing changes in the code.
- If the owner chooses the first alternative: change `Highlight` and `InlineDiffRow`, delete the allowlist entry, and the visual suite (Proofing results) and the atlas (`Highlight` stories) are the check.
- The `<mark>` scan still fails on any other file, so the exception cannot spread.
