# 0470. Proof follows mock 04: Pickup, Edit and Waived are words over the stored status, and the chapter view leads with its notes

**Status:** Proposed (the worker's choices in carrying out the owner's D85 #2, #7, #8 and #11 on #509; the owner confirms them on #510)
**Date:** 2026-09-28
**Supersedes:** none. It changes how [ADR 0407](0407-a-new-page-replaces-its-old-counterpart-in-the-same-change-and-the-navigation-is-grouped-by-production-stage.md)'s Proof page words and lays out what it already shows, and keeps the findings contract ([findings-contract.md](../architecture/findings-contract.md)) as it is.

## Context

The [visual mockup divergence audit](../research/visual-mockup-divergence-audit.md) found Proof's book level and chapter view apart from the approved mock 04 (`docs/prds/mockups/stage-navigation-and-page-replacement/04-proof-pickups-concept.webp`) in its vocabulary (PF1), its header and sources (PF4, PF6), its detail buttons (PF8) and its chapter level (PC1, PF10). On 2026-09-28 the owner answered (D85 on #509: "the approved mocks win"):

- #2: the chapter view is mock 04's version, a waveform plus the notes table;
- #7: the vocabulary is the mock's, Pickup / Edit / Waived;
- #8: the proofer's import and export sit on Proof's notes header, with the mock's labels;
- #11: the recording-check card of edit-and-proof mock 01 is built on the chapter view.

Some of this has no data or no storage behind it yet:

- A finding's decision is one of four statuses: unreviewed, accepted, dismissed, deferred. There is no field that says whether an accepted note is to be re-recorded or fixed in the edit, and adding one would change the findings contract every analyzer writes.
- The host sends no audio peaks for a chapter, so there is no waveform to draw.
- The chapter view already carries the edit-and-proof workspace (transport, the script with flags inline, the Flags panel with its decisions), the compare run, the preview and the readiness section, all merged and tested.

## Decision

1. **The mock's words are drawn over the stored status** (`apps/ui/src/components/proof/resolution.ts`). An accepted note reads **Pickup** or **Edit** by what it asks for, and that is read from the note itself: Transcript Compare's extra words (evidence kind `EXTRA`) and the categories fixed in the edit (`duplicate_read`, `take_comparison`, `pacing`, `audio_quality`, `silence_cleanup`, `level_consistency`, `delivery_qc`) are Edit; every other category, and any a newer host adds, is Pickup, the safer fix. A dismissed note reads **Waived**. An undecided note reads **To review** and a deferred one **Deferred**: the mock's sample has every note resolved, so it draws neither, but both are real states. The decision buttons say the same: **Pickup** or **Fix in edit** (it saves `accepted`), **Waive** (`dismissed`), **Defer**, and **Reopen**. The chapter view's Flags panel uses the same words, with a flag's kind in place of the category (extra words and cleanup candidates are edits).
2. **The notes header is the mock's**: "Notes · N", a chip per resolution that has notes ("3 need pickup", "2 fix in edit", "1 waived", plus "to review" and "deferred" when there are any), and **Import proofer sheet** and **Export for proofer**. The sheet is the proofer's pickup list, sent through the same `pickupsImport` and `pickupsExport` bindings the Pickups page uses, so nothing new crosses to the UI. The book level splits the accepted count by reading the accepted notes (`findingsList({ status: 'accepted' })`), since the summary counts statuses only.
3. **A Sources line sits beside the title**, naming only the sources that have notes (proofer (CSV) while the pickup list has any, then local AI compare, Story Bible, take review and the rest). The mock's proofer name and "my flags" are left out: the sheet carries no name, and there is no narrator flag store.
4. **A note's detail has Play ±3 s** (PF8): the note's own audio file from 3 s before it to 3 s after, played in the app through `useRangePlayer` (which now takes the roll as an optional argument; every audition keeps its 1.5 s). A note with no file or no file-relative time (a Story Bible entry, an older comparison) has the button off, with the reason. The detail's title is the mock's "0:12.4 · Misread" when the note has a time.
5. **The chapter view leads with mock 04** (`ProofChapterPage.tsx`): the Sources line, a strip of the chapter's notes over its recording (`NotesStrip.tsx`, on the `Timeline` primitive, a pin per timed note coloured by its type, with a legend and the chapter's length), the chapter's notes table without its Chapter column and the selected note's detail, and the recording-check card (`RecordingCheckCard.tsx`: Recorded, Length and the check's own sentence). **The strip draws no waveform**, because the host sends no peaks: the pins sit on a plain rule rather than on an invented one. The edit-and-proof workspace, the compare run, the preview and the readiness section stay under it, unchanged, so nothing already built is lost. Its script now scrolls only its own box when following playback, never the page.

## Consequences

- The owner's answers show now, without a change to the findings contract or any analyzer. If closed-loop proofing later stores the resolution (a pickup or an edit, and the edit's kind, mock 04's "Edit · de-click"), the words come from that field instead and this mapping goes.
- The Pickup/Edit split is a rule of the UI. A category put in the wrong column reads wrong until `resolution.ts` changes, and the host's own messages (the approved marker's "Accept this finding first", `bindings_marker.go`) still say "accept".
- The waveform waits on a peaks binding, a wire contract of its own (a Zod schema, a golden, a mock), which no phase owns yet.
- The chapter view is longer than the mock: the mock draws only its top. The Pickup session panel (PF11) stays with closed-loop proofing.
- To change any of this, write an ADR that supersedes this one.
