# 0239. Host and sidecar chapter names follow the display rule through one helper per language, and matching keys keep their own form

- **Status:** Proposed
- **Date:** 2026-09-25

## Context and problem

[ADR 0191](0191-a-chapters-name-is-title-em-dash-subtitle-in-source-casing-through-one-formatter-and-one-primitive.md) set one rule for a chapter's name in the UI: "Title — Subtitle" in source casing, through `apps/ui/src/chapterName.ts`. Phase 4 of [Chapter Title Display Consistency](../prds/chapter-title-display-consistency.prd.md) asked the Go host and the Python sidecars to follow the same rule, pinned by one fixture, and to replace three `": "`-joining `display_title`/`displayTitle` copies. It also asked that matching not change. Two of those copies are matching keys, not display text:
- `compare.py`'s `display_title` builds the chapter candidates, resolves an explicit chapter selection, and titles a take comparison. `apps/desktop/takecompare_job.go`'s `displayTitle` compares against that title.
- `chapter_script.py`'s `display_title` is a form a caller may name a chapter by.

Owner decision D34 adds that plain-text outputs use " - " where an em dash could break a consumer.

## Decision drivers

- Phase 4 asked the Go host and the Python sidecars to follow ADR 0191's rule, pinned by one fixture, replacing three `": "`-joining copies.
- It also asked that matching not change, and two of those copies are matching keys, not display text.
- Owner decision D34: plain-text outputs use " - " where an em dash could break a consumer.

## Considered options

1. One display helper per language, with matching keys keeping their own `": "` form
2. Move the matching keys to the display rule

## Decision outcome

**Chosen option: one display helper per language, with matching keys keeping their own `": "` form**, because the PRD asked that matching not change, and changing a key would need every side of the match to change together and the saved selections to migrate.

1. Each language has one helper on the rule:
   - Go: `apps/desktop/internal/chaptername` (`Name(title, subtitle, form)`, with `Full`, `Short`, `Plain` and `Context(prefix)`).
   - Python: `narration_common.chapter_names.chapter_display_name(title, subtitle, form, context)`.
   - TypeScript: `chapterName.ts`, unchanged.

   All three read a title that still holds its subtitle after a line break the same way. `Plain` joins with " - " (D34); the UI has no plain form.
2. `tests/fixtures/chapter-names.json` is written by the Go test (`UPDATE_CONTRACTS=1`, never by hand), and pytest reads it. It lives outside `tests/fixtures/contracts/`, because it is not a payload and every file there needs a UI schema row.
3. Text a person reads uses the helper:
   - Transcript Compare's log lines, its `MATCH:` summary and its diff heading;
   - the teleprompter's list of chapters to choose from, whose names `chapter_script._select` also accepts, as it still accepts the old `": "` form.
4. A matching key keeps its form:
   - `compare.py`'s `display_title`, and so the chapter candidates, `find_chapter_by_exact_title` and the take comparison's title;
   - `takecompare_job.go`'s `displayTitle`.

   They are documented as keys. Changing one would need every side of the match to change together, and the saved selections to migrate.

### Consequences

- **Good:** A log, a diff heading or a chapter list reads the same as the app's screens, and the fixture fails a language that drifts.
- **Neutral:** Two forms of a name remain in the code: the display name and the `": "` key. The key is never shown as a name by any of these sites.
- **Neutral:** The Vitest read of the fixture belongs in `apps/ui/src/chapterName.test.ts` (lane C); a local check found `chapterName.ts` agrees on every case.
- **Neutral:** REAPER region names, render file names and ID3 chapter titles (PRD Q7) are not wired yet. When they are, they use `Plain`.
- **Neutral:** Superseding this needs a new ADR, for example to move a matching key to the display rule with a migration.

### Confirmation

`tests/fixtures/chapter-names.json`, written by the Go test and read by pytest, fails a language that drifts.

## Pros and cons of the options

### Move the matching keys to the display rule

- Bad, because every side of the match would need to change together, and the saved selections to migrate.
