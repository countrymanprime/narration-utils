# 0715. Proof's book-level waveform card belongs to the chapter its selector names

**Status:** Accepted (the owner's 2026-09-29 ruling on ADRs 0651 and 0652; stream N-B59 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-29
**Supersedes:** [ADR 0651](0651-proofs-book-level-draws-no-waveform-header-because-its-notes-span-more-than-one-chapter.md) and [ADR 0652](0652-a-book-level-waveform-and-a-denser-notes-list-measurably-lower-mock-04s-score-so-adr-0651-stands.md), both Rejected by the owner.

## Context

ADR 0651 said the book-level Proof page draws no waveform because its notes span chapters, and ADR 0652 measured a placeholder waveform and lowered the score. The owner rejected both: each chapter is its own track, so notes never span chapters, and Proof's waveform always belongs to the chapter being viewed and follows a chapter selector. Mock 04 draws exactly that: a waveform card above the notes, with the chapter it belongs to named beside it.

The chapter view (`/proof/:chapterId`, `ProofChapterPage`) already draws a chapter's stored peaks and flags with `WaveformStrip`.

## Decision

The book-level Proof page draws a chapter waveform card (`ChapterWaveformCard.tsx`) above the notes table, in the notes column, as mock 04 does, with the detail column beside it from the top of the page.

- The card follows a chapter selector inside the card (the "Chapter to open" picker moved there, with the Open chapter button that opens that chapter's own view). It defaults to the first narration chapter until the narrator picks another.
- The card reuses `WaveformStrip` (its `bare` mode, without the strip's own frame) over the same stored peaks (`WorkspacePeaks`), alignment (`WorkspaceAlignment`) and linked track that the chapter view reads, so the two never disagree and no second waveform component exists. It draws no playhead: playing stays in the chapter view.
- A chapter with no linked track or no playable recording gets an honest empty state ("has no recording to draw yet"), never an invented waveform. A failed read shows one inline alert.
- No new wire contract: the card only calls existing, already-checked bindings.

## Consequences

- Proof's book level and chapter view share one waveform component and one data source.
- The card's flags follow the selected chapter, not the notes table: the table still lists every chapter's notes. Filtering the table by the selected chapter is a separate decision, put to the owner on [#510](https://github.com/countrymanprime/narration-utils/issues/510).
- The default chapter (first narration chapter, not the last opened or the first with a recording) is the recommended option and awaits the owner's confirmation on #510.
- The mock's dense waveform cannot be reproduced from the mock backend's sparse peaks, and sample data is not changed to raise a score, so `proof/default` stays under the D91 bar; the PR records the number.
