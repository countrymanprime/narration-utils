# 0012. Manuscript import preserves structural whitespace and repairs glued headings

**Status:** Accepted
**Date:** 2026-09-18

## Context

After importing a Word manuscript, a chapter appeared as "CHAPTER ONEBad Ideas Look Great in Neon" — title and subtitle fused with no space — and line breaks inside paragraphs (verse, address blocks, dialogue set on separate lines) were lost. The same class of bug had already been fixed and regressed more than once during revisions, because nothing recorded *why* it happens.

Root cause: Word stores a soft line break (`<w:br/>`) and a tab (`<w:tab/>`) as empty elements, not as characters inside `<w:t>`. The importer concatenated `<w:t>` text only, so the visible separation between "CHAPTER ONE" and its subtitle simply vanished. `docx.go` even contained the split-on-`"\n"` logic for subtitles, but no code path ever produced a `"\n"`. Markdown had the mirror-image problem: wrapped source lines were joined with spaces, and hard breaks (two trailing spaces, trailing backslash, `<br>`) were ignored. Another variant is a heading whose number and title are separate runs with a style change but no whitespace between them.

## Decision

The importer treats structural whitespace as content, not noise.

- **DOCX** (`shell/internal/importer/docx.go`): `<w:br/>` and `<w:cr/>` become `"\n"`; `<w:tab/>` becomes a space in body text and a title/subtitle separator in headings; `<w:noBreakHyphen/>` becomes `-`. Tab stops declared in paragraph properties are ignored (they are not inside a run).
- **Markdown** (`markdown.go`, `markdown_inline.go`): hard breaks and `<br>` become `"\n"`; soft-wrapped lines still join with a space; `<br>` in a heading separates title from subtitle.
- **Normalization** (`richtext.go`): all whitespace collapses to a single space, a break becomes exactly one `"\n"` with no spaces beside it, and leading/trailing whitespace is trimmed — in one pass, so formatting offsets ([ADR-0013](0013-inline-formatting-as-offset-spans.md)) are computed against the final text.
- **Glued headings** (`headings.go`): as a last resort, a heading shaped `<chapter|part|book> <number><Capitalized word>` (number = digits, uppercase roman numeral, or number word) is split at the capital. It fires only on that unambiguous shape, and every repair is reported in `Draft.Notices` so the import log says what was changed.

The catalogue of known formatting hazards and how each is handled lives in [`docs/architecture/docx-import-quirks.md`](../architecture/docx-import-quirks.md). New hazards found in the wild are added there with a test next to the fix.

## Consequences

- `Paragraph.Text` may now contain `"\n"`; consumers must treat it as whitespace (the Python sidecars already split on whitespace) and the reader renders it with `white-space: pre-line`.
- A heading such as "Chapter Oneness" is never split (the number must be complete), but a real title like "Chapter MIDnight" can be mis-split; that trade-off was accepted over leaving `ONEBad` glued.
- Existing imported manuscripts keep the old glued text until re-imported; Replace manuscript is the supported path while the product is in dev/QA.
- Changing this behavior means superseding this ADR and updating the quirks catalogue and its tests.
