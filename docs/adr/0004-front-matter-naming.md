# 0004. "Front Matter" as the canonical front-matter section name

- **Status:** Accepted
- **Date:** 2026-09-17

## Context and problem

The manuscript importer labeled the preliminary section of a book (half-title, title page, copyright, dedication, epigraph — everything before the first real chapter, and distinct from the separately-handled table of contents) as "Opening Pages." The user asked for the correct publishing-industry term, floating "Opening Credits" as one option. Neither is standard; the correct term in the publishing industry for this whole preliminary section is **Front Matter**.

## Decision drivers

- The user asked for the correct publishing-industry term.
- Avoid rippling a rename through `manuscript.json`, `canonicalize`, and readers.

## Considered options

1. "Front Matter"
2. Keep the status quo: "Opening Pages"
3. "Opening Credits" (floated by the user)

## Decision outcome

**Chosen option: "Front Matter"**, because it is the correct publishing-industry term for the whole preliminary section, and neither alternative is standard.

The literal string produced for this section is `"Front Matter"`, set atomically across every place that produces or compares it: `shell/internal/importer/model.go` (`classifyPreHeading`, and the `newDraft` classification check), `docx.go`, and `markdown.go` (both the default value and the pre-heading-collection check), plus the UI dropdown label in `Home.tsx`. The internal `contentKind` enum value stays `"opening"` — only the human-facing title text changed, to avoid rippling the rename through `manuscript.json`, `canonicalize`, and readers.

This is a separate, non-overlapping decision from Contents/table-of-contents handling — a heading matching "Contents"/"Table of Contents" is `isReferenceHeading`, not front matter, and the two code paths must not be merged.

### Consequences

- **Neutral:** Anyone adding a fourth importer format (beyond docx/markdown) must use the literal `"Front Matter"` string, not reintroduce "Opening pages" — `model.go:165`'s classification check is an exact string match.
- **Bad:** Renaming this again (e.g. if a different term is preferred later) must update all four call sites in the same change, or front-matter classification silently breaks for whichever site is missed.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### "Opening Pages"

- Bad, because it is not the standard publishing-industry term.

### "Opening Credits"

- Bad, because it is not the standard publishing-industry term.
