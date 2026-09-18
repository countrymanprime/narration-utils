# Expanded import settings & pre-scan confirm workflow

**Status: Planned — not implemented.**

## Problem

The only per-import configuration today is the Markdown heading-level picker and the post-preview "review imported structure" step (`Home.tsx`'s `ConfirmDialog`, where the user can override each section's `sectionKinds` classification and check/uncheck character candidates). There's no equivalent for other import ambiguities — e.g. whether a multi-line heading's second line is a subtitle or part of the main title, which the importer currently just guesses (`docx.go`: first line = title, remaining lines = subtitle, unconditionally).

## Proposal

Generalize the existing confirmation step into a small settings pass, run after a quick automatic pre-scan and before the real commit:

1. **Pre-scan** (already effectively happens via `manuscriptImportPreview` — the `Draft` it builds already has titles/sections/character candidates). Surface more of what it already infers as editable settings, not just `sectionKinds`.
2. **Candidate settings to expose:**
   - **Subtitle detection**: per multi-line heading (or a global toggle), let the user say "this second line is a subtitle" vs. "it's part of the title" — the importer already splits `lines[0]` / `lines[1:]` (`docx.go`), so this just needs a UI override that feeds back into `Paragraph.ChapterSubtitle` before commit.
   - Anything else the pre-scan is already uncertain about, following the same pattern as the existing section-kind override `<select>`.
3. **Confirm-and-commit**: the user reviews the pre-scan's guesses, corrects what's wrong, and only then does the real `manuscriptImportCommit` run — mirroring the "reference material" review that already exists for `sectionKinds`.

## Design constraint

This should extend the existing `ConfirmDialog` step in `Home.tsx` (`importSelection.sectionKinds`/`characterCandidateIds`), not introduce a second, parallel settings step — the existing round-trip through `ManuscriptImportSelection` (`shared/ui/src/api/contracts/manuscript.ts`) is the natural place to add new fields (e.g. `subtitleOverrides?: Record<string, boolean>`).

## Out of scope for this doc

Which settings are worth exposing beyond subtitle detection — that needs real manuscripts with more classification failures to motivate specific additions.
