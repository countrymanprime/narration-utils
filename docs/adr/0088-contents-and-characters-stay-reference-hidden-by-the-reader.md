# 0088. Contents and Characters stay stored as reference chapters; hiding them in the reader is the reader PRD's own phase

**Status:** Accepted
**Date:** 2026-09-21

## Context

The import-structure-toc-and-characters PRD's Open Questions S1 and S2 asked whether a detected Contents (table of contents) section
and an accepted Characters section should be dropped at import, given a new `contents` classification, or kept as `reference` and
hidden from the reader. `docs/prds/implementation-plan.md` D22 (owner instruction of 2026-09-20) adopts each PRD's stated
recommendation where the owner did not already decide it: recommendation (a) for S1 (keep `reference`, hide in the reader) and the
matching recommendation for S2 (Characters stays stored and hidden the same way; the Story Bible entries are its readable form).

Both are already true at the storage/classification layer: `isReferenceHeading` in `apps/desktop/internal/importer/model.go`
classifies a Characters heading and a recognised Contents/TOC heading as `contentKind: "reference"` unconditionally, independent of
this PRD (ADR 0004, ADR 0005). The Manuscript page's chapter-navigation panel already excludes `reference` chapters
(`apps/ui/src/components/manuscript/state.ts`, ADR 0005). What ADR 0005 has never covered is the reader itself: `Manuscript.tsx`
renders every chapter it is handed, `reference` included, so a narrator who pages through the book still meets Contents and
Characters as ordinary, readable chapters.

Fixing that read-through view is manuscript-reader-search-and-controls Phase 5 (delivered since, PRD
deleted, see [the manuscript guide](../guides/using-the-app/manuscript.md) and
[ADR 0090](0090-the-page-flip-reader-hides-reference-chapters-superseding-the-reader-half-of-adr-0005.md)),
which reverses the reader half of ADR 0005. That PRD had not landed (stack S19b of `implementation-plan.md`'s train, section
4) when this stack ran, so this PRD's Phase 2 cannot itself change what the reader displays without duplicating or pre-empting that
phase's own design. This ADR records the decision the storage side has already settled, and leaves the reader wiring to the PRD that
owns `Manuscript.tsx`.

## Decision

- Contents/TOC sections and Characters sections stay `contentKind: "reference"`. No new `contents` kind is added (S1 option (c) is
  declined): a distinct wire value would touch the `service.go` validator, the TS enum, the `Home.tsx` section-kind options and both
  denylist consumers (`apps/desktop/app.go`'s counts, `state.ts`'s panel filter) for no behavioural gain over the existing
  `reference` value, since nothing today needs to tell a Contents section apart from any other reference section.
- An accepted Characters section is not dropped and gets no special non-chapter treatment beyond the existing `reference`
  classification; the Story Bible entries created from its candidates (Phase 3 of this PRD) are its readable form, matching S2's
  recommendation.
- Hiding these `reference` chapters from the reader's own page-flip view (not just the chapter-navigation panel) was left to
  manuscript-reader-search-and-controls Phase 5, which owned `Manuscript.tsx` and reverses the reader half of ADR 0005 - now
  delivered as [ADR 0090](0090-the-page-flip-reader-hides-reference-chapters-superseding-the-reader-half-of-adr-0005.md). This
  PRD's own Phase 2 was `partial` for that reason at the time this ADR was written: the decision and the storage-side
  classification were settled here, and the read-through hiding was deferred to that phase rather than built twice; that phase has
  since landed, and import-structure-toc-and-characters.prd.md's own Phase 2 row now reads `complete`.

## Consequences

- No code change was needed for the storage-side half of this decision; it was already the existing behaviour, pinned by stack
  S19c's Phase 1 tests (`TestNewDraftGivesContentsItsOwnGroupInsteadOfLeakingIntoPriorSection` and the new Phase 1 docx/markdown
  TOC-recognition tests) and a new explicit regression test for the Characters heading itself
  (`TestNewDraftClassifiesACharactersHeadingAsReference`, `model_test.go`).
- A narrator importing today still meets Contents and Characters as readable chapters in the page-flip reader until
  manuscript-reader-search-and-controls Phase 5 lands; this is unchanged by this stack and is not a regression it introduces.
- This ADR does not itself supersede ADR 0005: the reader PRD's own Phase 5 will record that supersession jointly when it reverses
  the reader half, per `docs/prds/README.md`'s "Accepted ADRs reversed by PRDs" note.
