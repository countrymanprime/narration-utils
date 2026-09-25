# 0183. Credits rows in the chapter table are not chapters, and their status lives on the project manifest

- **Status:** Proposed
- **Date:** 2026-09-24

## Context and problem

The owner reported that the Home chapter table lists only manuscript chapters, even though opening and closing credits are
recorded too (`docs/prds/credits-in-chapter-table.prd.md`). Phase 1 of that PRD adds a status the narrator can set for the
opening and closing credits rows, so a later phase can show them as the first and last rows of the table. ADR 0150 already
established that the credits are not manuscript chapters ("The credits are not manuscript chapters and must never become
one") for the teleprompter, and ADR 0004 keeps `contentKind: "opening"` reserved for Front Matter, not for a synthetic
"Opening Credits" chapter. Chapter statuses live in `manuscript-notes.json` (`manuscript.Service.SetChapterStatus`), which
`resetDerived` deletes on Replace manuscript and on "Clear derived project data" (`credits-in-chapter-table.prd.md`
Evidence); a credits status stored there would not survive either, but the credits text itself already lives on
`project.Manifest.Credits` (ADR-less, PRD `audiobook-credits-templates.prd.md` C12) precisely because it must survive both.

## Decision drivers

- ADR 0150: the credits are not manuscript chapters and must never become one.
- ADR 0004 keeps `contentKind: "opening"` reserved for Front Matter, not for a synthetic "Opening Credits" chapter.
- The status must survive Replace manuscript and "Clear derived project data", as the credits text on `project.Manifest.Credits` already does.

## Considered options

1. Credits rows that are never chapters, with their status on the project manifest
2. Store the credits status in `manuscript-notes.json` beside the chapter statuses
3. A synthetic "Opening Credits" chapter

## Decision outcome

**Chosen option: credits rows that are never chapters, with their status on the project manifest**, because a status in `manuscript-notes.json` would not survive Replace manuscript or "Clear derived project data", while the manifest already holds the credits text for exactly that reason.

- **Credits rows are never chapters.** They keep the fixed ids `credits-opening` and `credits-closing`, matching the
  teleprompter's `--script-id credits-<kind>` (ADR 0150). They never enter `manuscript.json`, `ManuscriptChapters`,
  `ChapterNav`, search, `contentKind`, stage suggestions, or coverage; a later phase renders them outside the chapter array
  the same way the Manuscript page already does, so every chapter-only consumer stays chapter-only by construction, not by a
  filter one might forget to add.
- **The status is stored on the project manifest, not in `manuscript-notes.json`.** `project.Manifest.CreditsStatus` is an
  additive `map[string]string` (`json:"creditsStatus,omitempty"`), keyed `"opening"` and `"closing"`, alongside `Credits` and
  `RetailSample`. A kind absent from the map means "not_started", the same default a manuscript chapter with no note has.
- **The same five values a chapter status has.** `credits.ValidStatus` (`internal/credits/status.go`) accepts exactly
  `not_started`, `recording`, `editing`, `proofing`, `finalized` — the same set `manuscript.Service.SetChapterStatus`
  validates — so the chapter table's select and status colours can be reused for a credits row as-is, with no new status
  vocabulary for the UI to learn.
- **Two bindings.** `CreditsStatuses()` reads the map (empty when nothing is set); `CreditsSetStatus(kind, status)` refuses an
  unknown kind (anything but `"opening"`/`"closing"`) or an unknown status without writing anything, then saves the whole map
  back to the manifest. `hostAPIVersion` goes to 48 for these two bindings.

### Consequences

- **Good:** The status survives Replace manuscript and "Clear derived project data" (the manifest is outside both operations), matching
  the credits values it sits beside; a Go test clears derived data and confirms the status is unchanged while a manuscript
  chapter's own status is gone.
- **Neutral:** Nothing here builds the rows themselves, the disabled Check button, or the progress-text change (Phase 2 of the PRD); this
  ADR only fixes where the status lives and what values it takes, so Phase 2 has a stable, already-persisted signal to render.
- **Good:** A `credits-<kind>` id can never collide with a manuscript chapter id (`c-XXXX`), so no chapter-only binding needs to special-
  case it; the risk this ADR is written against is a credits id leaking into `ManuscriptSetChapterStatus`, stage suggestions
  or coverage, which the id scheme and the separate bindings rule out rather than a runtime check.

### Confirmation

A Go test clears derived data and confirms the credits status is unchanged while a manuscript chapter's own status is gone.

## Pros and cons of the options

### Store the credits status in `manuscript-notes.json` beside the chapter statuses

- Bad, because `resetDerived` deletes that file on Replace manuscript and on "Clear derived project data", so the status would not survive either.

### A synthetic "Opening Credits" chapter

- Bad, because ADR 0150 says the credits must never become a chapter, and ADR 0004 keeps `contentKind: "opening"` reserved for Front Matter.
