# 0004. "Front Matter" as the canonical front-matter section name

**Status:** Accepted
**Date:** 2026-09-17

## Context

The manuscript importer labeled the preliminary section of a book (half-title, title page, copyright, dedication, epigraph — everything before the first real chapter, and distinct from the separately-handled table of contents) as "Opening Pages." The user asked for the correct publishing-industry term, floating "Opening Credits" as one option. Neither is standard; the correct term in the publishing industry for this whole preliminary section is **Front Matter**.

## Decision

The literal string produced for this section is `"Front Matter"`, set atomically across every place that produces or compares it: `shell/internal/importer/model.go` (`classifyPreHeading`, and the `newDraft` classification check), `docx.go`, and `markdown.go` (both the default value and the pre-heading-collection check), plus the UI dropdown label in `Home.tsx`. The internal `contentKind` enum value stays `"opening"` — only the human-facing title text changed, to avoid rippling the rename through `manuscript.json`, `canonicalize`, and readers.

This is a separate, non-overlapping decision from Contents/table-of-contents handling — a heading matching "Contents"/"Table of Contents" is `isReferenceHeading`, not front matter, and the two code paths must not be merged.

## Consequences

- Anyone adding a fourth importer format (beyond docx/markdown) must use the literal `"Front Matter"` string, not reintroduce "Opening pages" — `model.go:165`'s classification check is an exact string match.
- Renaming this again (e.g. if a different term is preferred later) must update all four call sites in the same change, or front-matter classification silently breaks for whichever site is missed.
