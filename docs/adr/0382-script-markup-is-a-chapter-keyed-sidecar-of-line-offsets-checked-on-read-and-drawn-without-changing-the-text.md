# 0382. Script markup is a chapter-keyed sidecar of line offsets, checked on read and drawn without changing the text

**Status:** Proposed
**Date:** 2026-09-27

## Context

[Prep Depth](../prds/prep-depth.prd.md) Phase 5 adds a markup layer: stress, pause and character-tag spans the narrator places on the script while prepping, which must "carry through to the booth view" and must never land silently on the wrong words when the text changes. The PRD left three things to planning or to a recommendation (D22):

- **Q5 (where markup lives):** recommendation A, a project sidecar `<project>/narration-utils/prep/markup.json` of offset spans, not the manuscript JSON.
- **Q6 (validation):** recommendation A, check every span against the current text on read and report a mismatch as stale rather than apply it at the wrong position; the risk table asks that whitespace-only edits not flag staleness.
- **Where the code lives** (`apps/desktop/internal/prepmarkup` or sidecar-side) and **how spans render**: the PRD says "with the existing `Highlight` primitive (ADR 0016)".

Two facts from the code shaped the answer. The reader's selection offsets (`useTextSelection`) are measured from the text content of the line's `<p data-paragraph-text>`, so anything drawn as DOM text inside it (a pause slash, a speaker name) would shift every later note and mark anchor. And `Highlight` (a lane-U primitive this stream may only consume) is a tinted, clickable `<mark>` whose kinds are Story Bible categories and read-aloud flags; it has no stress, pause or speaker kind, and a clickable mark inside an entity highlight is the nested-interactive debt already tracked as #155.

## Decision

- **Store.** `apps/desktop/internal/prepmarkup` keeps `<project>/narration-utils/prep/markup.json`: `{schemaVersion: 1, chapters: {<chapterId>: [span]}}`, each span `{id, paragraphId, start, end, anchorText, kind: stress|pause|character_tag, value, nonSpaceStart, createdAt}`. Offsets are **UTF-16 code units into one line** (the reader's own unit and scope), not into the whole chapter, so an edit elsewhere in the chapter never moves a mark. `value` is `short`/`long` for a pause and the speaker's name for a tag. The file is narrator data under ADR 0069 (`persist`: a corrupt file is kept aside, a newer version refused and never overwritten), written temp-then-rename. The host derives `anchorText` from the line itself and trims whitespace from the selection's edges; the UI's own text is never trusted.
- **Staleness (Q6).** `PrepMarkupList` resolves every span on every read: a span whose line is gone is `stale` with `staleReason: paragraph_missing` and `paragraph: null`; one whose words differ is `stale` with `text_changed` at its stored offsets. Words are compared with whitespace collapsed, and the span is located by `nonSpaceStart` (the count of non-whitespace characters before it), so a whitespace-only edit before or inside it neither flags it nor draws it in the wrong place; any other change is stale, never repositioned. `stale` is computed, never stored.
- **Lifetime.** A manuscript re-import keeps the file (`resetDerived` does not remove it), because keeping unchanged lines' marks and flagging changed ones is the point of Q6; only the explicit Clear project data removes it.
- **Bindings.** `PrepMarkupList(chapterId)`, `PrepMarkupSave(chapterId, paragraphId, start, end, kind, value)` and `PrepMarkupDelete(chapterId, id)`, `hostAPIVersion` 68, with Zod schemas in `apps/ui/src/api/schemas/prepMarkup.ts` and goldens `tests/fixtures/contracts/prep-markup-*.json`.
- **Drawing.** The reader composes markup through the same annotation compositor as entities, notes and formatting (`annotations.ts`, a `markup` kind in the innermost layer) and draws it with a feature-level `MarkupMark` (`apps/ui/src/components/manuscript/`), not `Highlight`: stress is a dotted accent underline, a pause is `/` (breath) or `//` (pause) after the words and a tag is a name chip before them, the glyph and the chip being **CSS generated content** so the line's text content is exactly the manuscript's. A mark is not a control; it is placed and removed from the selection menu's **Mark up** dialog, and a stale mark is said beside its line (or above the chapter when the line is gone) with its own Remove.

## Consequences

- A later booth view reads one small, plain, versioned file and gets the same resolution rules by calling `PrepMarkupList`, without knowing how the reader draws a mark.
- Adding markup cannot shift note anchors or selection offsets, and it adds no nested interactive element to the reader.
- Deviates from the PRD's "rendered with the existing `Highlight` primitive": this is **Proposed** for the owner (#510). If a stress/pause/speaker kind should live in `Highlight` instead, that is a lane-U change to the primitive and its atlas story, after which `MarkupMark` becomes a thin caller; the store, the contract and the staleness rules do not change.
- The concept mock (`docs/prds/mockups/prep-depth/02-prep-script-concept.webp`) is not owner-approved; the chip, underline and slash styling follow it and may change with it.
- A span whose words move within their line (not a whitespace edit) is reported stale rather than followed; the narrator removes it and places it again. Re-finding it automatically is a later decision, not a silent default.
- Chapter ids and paragraph ids are what a span is keyed by: if a re-import assigns new ids, every mark of that chapter shows as stale (line gone), which is safe but noisy.
