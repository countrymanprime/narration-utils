# 0016. One `Highlight` primitive for entity, note and review highlights

**Status:** Accepted (amended by [ADR 0063](0063-the-proofing-diff-marks-its-own-words-and-adr-0016-covers-entry-highlights.md), which reads "the only way to render highlighted text" as covering entry highlights, so the proofing diff's own word marks are outside it; and by [ADR 0118](0118-read-aloud-flags-are-highlight-kinds-with-an-inline-hint-and-skips-and-restarts-show-by-default.md), proposed, which adds the read-aloud flag kinds; the rest stands)
**Date:** 2026-09-18
**Amends:** ADR-0009 (replaces the `HL_STYLE`/`hlClassName` lookups it lists)

## Context

Highlighted text was implemented three ways: the Manuscript drew notes as a bare `border-b-2` underline (so only a thin line, and visibly offset), entity names used `HL_STYLE` plus an inset shadow, and Story Bible evidence excerpts used the same lookup keyed by the raw category. `HL_STYLE` had no entry for `"Needs Review"` (only `"Review"`), so review entries fell through to the browser's default yellow `<mark>` — a different yellow from the review color. The user asked for one consistent treatment matching each entry's type color, filling the whole line height.

## Decision

`shared/ui/src/components/primitives/Highlight.tsx` is the only way to render highlighted text.

- `highlightKind(category)` is the single category→kind mapping (`Needs Review`/`Draft`/unknown → `Review`, `Location` → `Place`); an unfamiliar category degrades to the review color, never the UA default.
- The tint is `color-mix(in srgb, <token> 20%, transparent)` so it reads correctly on the reader's alternating row backgrounds; entities also tint their text, notes keep the text color; all carry a 1.5px inset underline in the kind color.
- Vertical padding on the inline `<mark>` (`--hl-pad-y`, set per reader text size in `Manuscript.tsx`) fills the whole line height without changing line layout.
- Interactive highlights (`onActivate`) are `role="button"` with Enter/Space handling; static ones (evidence excerpts) are plain `<mark>`. Every highlight carries `data-highlight="<Kind>"`, which is what tests select on.
- `ParagraphView`, `EntitySummary` and `GuideDetail` use it; `HL_STYLE` and `hlClassName` are removed.

Note anchors are also corrected: offsets are measured from the paragraph's prose element (`data-paragraph-text`), not the row that includes the line-number gutter, whose digits previously shifted every underline to the right. Anchors saved with the old offsets are re-located by their stored `anchorText` at render time (`resolveNoteAnchor`), falling back to the stored range if the text cannot be found.

## Consequences

- A new highlight color or kind is one edit in `Highlight.tsx`.
- Tests select `[data-highlight="…"]`; the legacy `.note-overlay` / `hl-*` marker classes no longer exist.
- Per-size `--hl-pad-y` values are visual constants; retune them if reader line-heights change.
