# 0239. Host and sidecar chapter names follow the display rule through one helper per language, and matching keys keep their own form

**Status:** Proposed
**Date:** 2026-09-25

## Context

[ADR 0191](0191-a-chapters-name-is-title-em-dash-subtitle-in-source-casing-through-one-formatter-and-one-primitive.md) set one rule for a chapter's name in the UI: "Title — Subtitle" in source casing, through `apps/ui/src/chapterName.ts`. Phase 4 of [Chapter Title Display Consistency](../prds/chapter-title-display-consistency.prd.md) asked the Go host and the Python sidecars to follow the same rule, pinned by one fixture, and to replace three `": "`-joining `display_title`/`displayTitle` copies. It also asked that matching not change. Two of those copies are matching keys, not display text:
- `compare.py`'s `display_title` builds the chapter candidates, resolves an explicit chapter selection, and titles a take comparison. `apps/desktop/takecompare_job.go`'s `displayTitle` compares against that title.
- `chapter_script.py`'s `display_title` is a form a caller may name a chapter by.

Owner decision D34 adds that plain-text outputs use " - " where an em dash could break a consumer.

## Decision

1. Each language has one helper on the rule:
   - Go: `apps/desktop/internal/chaptername` (`Name(title, subtitle, form)`, with `Full`, `Short`, `Plain` and `Context(prefix)`).
   - Python: `narration_common.chapter_names.chapter_display_name(title, subtitle, form, context)`.
   - TypeScript: `chapterName.ts`, with a `'plain'` form added alongside `'full'`/`'short'`/`context()`.

   All three read a title that still holds its subtitle after a line break the same way. `Plain` joins with " - " (D34).
2. `tests/fixtures/chapter-names.json` is written by the Go test (`UPDATE_CONTRACTS=1`, never by hand), and pytest reads it. It lives outside `tests/fixtures/contracts/`, because it is not a payload and every file there needs a UI schema row.
3. Text a person reads uses the helper:
   - Transcript Compare's log lines, its `MATCH:` summary and its diff heading;
   - the teleprompter's list of chapters to choose from, whose names `chapter_script._select` also accepts, as it still accepts the old `": "` form.
4. A matching key keeps its form:
   - `compare.py`'s `display_title`, and so the chapter candidates, `find_chapter_by_exact_title` and the take comparison's title;
   - `takecompare_job.go`'s `displayTitle`.

   They are documented as keys. Changing one would need every side of the match to change together, and the saved selections to migrate.
5. REAPER region names follow the rule too (Q7, adopted as D34's ASCII form B, everywhere - superseding Q7's own recommendation of C for region/track/file names). `apps/desktop/chapterlinks.go`'s `chapterTrackLinksIn` carries each chapter's subtitle alongside its title in `chapterTrackLink`, tagged `json:"-"` so it never reaches the wire (the UI already has its own copy through `manuscript.chapterSchema` and draws its own name with `chapterName()`; this is host-internal only). `chapterregions.go` names a linked chapter's planned region `chaptername.Name(title, subtitle, Plain)`. Nothing downstream changes: the render pattern still writes `$region` as the file name, and `bindings_chaptertags.go` still reads each chapter's title from that file's base name for its ID3 `CHAP` frame, so both follow the rule for free. A chapter with no subtitle plans and creates the exact region name it did before this decision. The chapter-track matcher's own comparison (`chaptermatch.Chapter.Title`) is untouched, matching item 4 above. `tracks/LinkChaptersDialog.tsx`'s REAPER item-stamp text (inventory row 19) is UI-built, not host-built, and stays title-only.

## Consequences

- A log, a diff heading or a chapter list reads the same as the app's screens, and the fixture fails a language that drifts.
- Two forms of a name remain in the code: the display name and the `": "` key. The key is never shown as a name by any of these sites.
- The Vitest read of the fixture is `apps/ui/src/chapterName.fixture.test.ts` (lane C): it reads `tests/fixtures/chapter-names.json` directly and asserts `chapterName()` against every case's `full`/`short`/`plain`/`readAloud` column, proving TypeScript agrees with Go and Python.
- REAPER region names, render file names and ID3 chapter titles (PRD Q7) are wired: see item 5. A future PRD that changes what `create_regions` is asked to name a region (for example [DAW Chapter-Track Auto-Sync](../prds/daw-chapter-track-auto-sync.prd.md)) builds on `chaptername.Name(..., Plain)`, not a bare title, and needs no REAPER Lua change of its own - `create_regions` already writes whatever title string the host sends.
- Superseding this needs a new ADR, for example to move a matching key to the display rule with a migration.
