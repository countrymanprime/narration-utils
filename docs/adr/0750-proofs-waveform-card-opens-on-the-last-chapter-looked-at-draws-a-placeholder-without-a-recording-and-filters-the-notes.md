# 0750. Proof's waveform card opens on the last chapter looked at, draws a placeholder without a recording, and filters the notes

**Status:** Accepted (owner ruling D100, 2026-09-29, on [#509](https://github.com/countrymanprime/narration-utils/issues/509); stream N-F2)
**Date:** 2026-09-29
**Supersedes:** the default-chapter, empty-state and unfiltered-table parts of [ADR 0715](0715-proofs-book-level-waveform-card-belongs-to-the-chapter-its-selector-names.md). The rest of 0715 stands: the card is `ChapterWaveformCard`, it reuses `WaveformStrip`, and it adds no wire contract.

## Context

ADR 0715 put a waveform card on Proof's book level that follows a chapter selector. It left three things to the owner: which chapter the card opens on (first narration chapter, recommended), what a chapter with no recording shows (an empty-state sentence), and whether the selector also filters the notes table (undecided). Owner ruling D100 answers all three: the card follows the chapter the page shows and defaults to the last chapter the narrator looked at; with no recording it draws a greyed placeholder waveform; and the selector also filters the notes table to that chapter.

## Decision

- **Default chapter.** The card opens on the last chapter the narrator looked at in this project: the chapter picked in the card's selector, or opened in its own view (`/proof/:chapterId`). It is remembered per project in browser storage (`lastChapterStorage.ts`, `narration.proof.lastChapter.<projectFolder>`), the app's existing per-viewer store for this kind of choice (like `creditsExpandedStorage.ts`), not a host field. A stored chapter that is not a narration chapter of the project, or storage that is missing or blocked, falls back to the first narration chapter.
- **No recording.** A chapter with no linked track or no playable recording draws a greyed-out placeholder waveform (a fixed pattern, `role="img"`, labelled as a placeholder) with the label "<chapter> has no recording to draw yet. The grey shape is a placeholder, not this chapter's audio." It is never drawn from data and never in the accent colour. A failed read still shows only the inline alert, with no placeholder.
- **Filter.** Picking a chapter in the card's selector sets the notes table's chapter filter to it (the same `chapterId` the Filters popover's Chapter control sends to the host), so the table lists only that chapter's notes. While the table is narrowed the card says "Notes below: this chapter only" and offers **Show all chapters**, which lifts the filter and leaves the card on its chapter. Picking a chapter in the Filters popover moves the card to it. Until the narrator picks a chapter the table lists every chapter's notes: opening on the remembered chapter does not narrow the table by itself, so notes without a chapter (delivery findings) are never hidden by a default.

## Consequences

- The card and the table can never name different chapters while the filter is on.
- A narrator who wants every chapter's notes has one visible control for it, on the card, in addition to Clear filters.
- Notes that belong to no chapter appear only while the table is not narrowed.
- The remembered chapter is per browser profile, like the other per-viewer choices; it is not shared through the project folder.
- The visual catalog gains `proof / no-recording`, `proof / chapter-selected` and `proof / chapter-filtered`, and `docs/images/ui` gains their screenshots.
