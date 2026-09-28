# 0324. Structural front matter captured at import outranks the plain-text guess and DOCX properties in credits detection

**Status:** Proposed
**Date:** 2026-09-27

## Context

[Credits Token Setup and Front Matter Detection](../prds/credits-token-setup-and-front-matter-detection.prd.md) Phase 4 (Could) asks the importer to keep two structural signals it was already discarding: a Markdown file's leading YAML front matter (`title:`, `author:`, `series:`), and a DOCX's own `Title`/`Subtitle` paragraph styles. Phase 1's front matter parser (`internal/credits/frontmatter.go`) already guesses these from plain text with real false-positive risk (a bare name line, a descriptor line); Phase 1's DOCX properties reader (`internal/importer/coreprops.go`) reads `docProps/core.xml`, which is often an editor's or typesetter's account name, not the author. Neither can see structure the source format already states outright.

CS10 (in the PRD) recommends against changing the importer's own `classifyPreHeading` "Cover" heuristic for this: that heuristic decides section grouping for every importer and would move the import-structure goldens, for no credits gain. So this capture had to be additive and separate from it.

## Decision

1. `importer.Draft` gets an additive `SourceMetadata *SourceMetadata` field (`Title`, `Subtitle`, `Author`, `Series`), serialized to `manuscript.json` as a top-level `sourceMetadata` object holding only the fields actually detected (`internal/manuscript/service.go:canonicalize`). The key is absent entirely when nothing was detected, so every manuscript.json written before this phase, and every import with nothing to report, keeps its exact existing shape.
2. Markdown: a leading `---` ... `---` fence is read for `title`/`author`/`series` scalar keys only (`internal/importer/frontmatter_yaml.go`, a minimal scalar reader, not a YAML library) and removed from the text entirely before the existing paragraph pipeline runs, so the fence never appears as a "Front Matter" paragraph whether or not it yielded a recognized key. A fence with no closing `---` within 200 lines is left as ordinary text (a lone `---` is a common horizontal rule or heading underline) rather than swallowing the rest of the file looking for one.
3. DOCX: only the document's very first heading, if it carries Word's built-in `Title` style, seeds `SourceMetadata.Title`; only a `Subtitle`-styled paragraph immediately following it seeds `SourceMetadata.Subtitle` (`internal/importer/docx.go`). A `Subtitle`-styled paragraph under some other, later heading is that chapter's own subtitle (the existing F4 handling, import heading misreads), never the book's - position, not style alone, is what distinguishes them.
4. `internal/credits/detect.go`'s `Detect` merges `SourceMetadata` into its candidates at `ConfidenceHigh`, right after the plain-text front matter guess and before the EPUB/DOCX-properties merge. This extends the CS6 precedence table: structural capture is an explicit marker the narrator can see and edit on the page, so it beats the plain-text guess the same way an explicit `Title:` prefix or a byline's `by` already does, and - unlike DOCX's `docProps/core.xml` - it is never a machine default, so `mergeDocxProperties`'s existing "only fills a token still absent" rule already makes it win there too, with no change to that function.

## Consequences

- A Markdown file with real YAML front matter, or a DOCX built from Word's Title/Subtitle styles, is detected at high confidence without depending on the plain-text heuristics' false-positive-prone guessing, and without touching import structure or its goldens (CS10).
- `manuscript.json`, `narration_common.manuscript.validate` (already permissive - no code change, pinned by a new Hypothesis case) and the Lua bridge (only checks `manuscript.json`'s existence, never its fields, per the harness in `integrations/reaper/tests/compare_test.lua`) are all unaffected beyond the additive key.
- No new trust boundary: both readers operate on the same manuscript source already fully read into memory during import (row 6d, [threat model](../architecture/threat-model.md)), and `credits.Detect` already reads `manuscript.json` and the stored source a second time (row 6a); this only adds more already-bounded string fields to that same read, confirmed by a short `-fuzz` run of `FuzzMarkdownFile` and `FuzzDocx` finding nothing, so neither row needed an update.
- A future change that wants Markdown `subtitle:` or DOCX author/series styles would extend the same `SourceMetadata` struct and `mergeSourceMetadata`, not add a second mechanism.
