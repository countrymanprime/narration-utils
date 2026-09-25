# 0102. EPUB `epub:type` forces a section's content kind by an explicit override, not by renaming its title to one the classifier already knows

- **Status:** Accepted
- **Date:** 2026-09-22

## Context and problem

The txt-and-epub-import PRD's Phase 2 (PR #345) reads an EPUB's own chapters but classifies every section the same way DOCX and Markdown do: by matching its title text against `model.go`'s heading tables (`isReferenceHeading`, the `cover`/`front matter` checks). Phase 3 ("EPUB structure and repairs") adds `epub:type` as a second, more authoritative classification signal (`<body epub:type="dedication">`, `"endnotes"`, `"bodymatter"`, and so on — Architecture notes, "Classification"), because a real dedication page is often titled something like "For My Mother" that the text classifier would never recognize as front matter. The PRD explicitly left the mechanism open: "Phase 3 either passes a kind through `Paragraph`/`Draft` or renames groups to titles the classifier already knows; decide in Phase 3 with `change-impact-scan` on `service.go:390`" — no recommendation either way, so per `implementation-plan.md` D22 this is recorded here rather than decided silently.

A `change-impact-scan` on `service.go:390` (`canonicalize`) found that `DraftSection.Title` and `Paragraph.Chapter` are used verbatim as the final manuscript chapter's `title` — nothing downstream tolerates a title being swapped for a generic label.

## Decision drivers

- `epub:type` is a more authoritative classification signal than title text: a real dedication page is often titled something the text classifier would never recognize as front matter.
- `DraftSection.Title` and `Paragraph.Chapter` are used verbatim as the final manuscript chapter's `title`, and nothing downstream tolerates a title swapped for a generic label.
- Keep each page's real title and subtitle.
- Avoid a field that would need its own schema and golden payload when nothing consumes it.

## Considered options

1. An explicit `kindOverrides` map keyed by a group's exact title
2. Renaming a chapter's title to a canonical string the classifier already recognizes
3. Putting the raw `epub:type` value on the wire

## Decision outcome

**Chosen option: an explicit `kindOverrides` map keyed by a group's exact title**, because the override keeps the real title while still forcing the correct kind.

`newDraft` (`apps/desktop/internal/importer/model.go`) takes a new `kindOverrides map[string]string` parameter, keyed by a group's exact title, that forces `contentKind` ahead of every text-based rule. `epub.go` builds this map from each chapter's `epub:type` via a new `epubTypeKind()` table (`cover`/`titlepage`/`frontmatter`/`dedication`/`epigraph`/`copyright-page` → `opening`; `toc`/`acknowledgments`/`glossary`/`index`/`bibliography`/`endnotes`/`footnotes`/`backmatter` → `reference`; `bodymatter`/`chapter`/`prologue`/`epilogue` → `narration`), read from `<body epub:type="...">` on each spine document. DOCX, Markdown and TXT pass `nil` and are unaffected. No wire shape changes: `contentKind` was already on the wire (`DraftSection.ContentKind`); this only changes how EPUB computes it.

The alternative (renaming a chapter's title to a canonical string the classifier already recognizes, e.g. every `opening`-kind page to `"Front Matter"`) was rejected: it would either merge distinct pages (cover, title page, dedication, copyright) into one section and lose their real titles and subtitles, or require guessing a canonical rename per `epub:type` token that may not match what the reader actually shows. The override keeps the real title while still forcing the correct kind.

A second alternative — putting the raw `epub:type` value on the wire (a new `Paragraph`/`DraftSection` field) — was rejected as heavier than the problem needs: `contentKind` is already the wire-facing signal `service.go:390` reads, nothing else consumes a raw `epub:type`, and an unused-by-UI field would need its own schema and golden payload (wire-contracts discipline) that this decision does not require.

### Consequences

- **Good:** DOCX, Markdown and TXT importers are behaviorally unchanged (they pass `nil`).
- **Good:** A future importer with a similar out-of-band classification signal (independent of title text) can reuse the same `kindOverrides` seam instead of inventing another one.
- **Bad:** `newDraft`'s signature changed (an internal, non-wire Go function), so every call site — `docx.go`, `markdown.go`, `txt.go`, `epub.go`, and every `newDraft(...)` call in `model_test.go` — needed a trailing argument; a future caller must remember to pass `nil` rather than accidentally forcing a kind.
- **Neutral:** The classification stays whole-document: an `epub:type` read from `<body>` applies to every chapter start inside that one spine document. A book that mixes, say, a footnote body inline within an otherwise-narration chapter file (rather than in its own file) is not classified by this mechanism — the title-text fallback still applies to it, same as before Phase 3.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Renaming titles to canonical strings

- Bad, because it would either merge distinct pages (cover, title page, dedication, copyright) into one section and lose their real titles and subtitles, or require guessing a canonical rename per `epub:type` token that may not match what the reader actually shows.

### Putting the raw `epub:type` value on the wire

- Bad, because it is heavier than the problem needs: nothing else consumes a raw `epub:type`, and an unused-by-UI field would need its own schema and golden payload.
