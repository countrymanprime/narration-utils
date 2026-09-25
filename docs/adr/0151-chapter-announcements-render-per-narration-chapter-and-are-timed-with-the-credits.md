# 0151. Chapter announcements render per narration chapter and are timed with the credits; room tone is the narrator's setting

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

`audiobook-credits-templates.prd.md` Phase 5 ("Extras") carries the optional chapter announcement template (Open Question C8:
"[Chapter], [Chapter Title] computed from manuscript.json") and the room tone setting the Phase 2 time model left at 0 with no
Settings field (C9, ADR 0025: published room-tone guidance disagrees, so no number is baked in without a user setting). The
`chapter_announcement` kind already existed in the template store (`internal/credits/templates.go`) and could be saved, but
nothing rendered it: Settings did not offer it, and `CreditsPreview` has no chapter to fill `[Chapter]` from. Optional `{...}`
segments, the other Phase 5 item, shipped in Phase 1 (C5, `renderer.go`). Imported chapters carry a heading (`title`, "Chapter
1") and, when the importer split one from it, a `subtitle` ("Down the Rabbit-Hole", ADR 0013); `chapter.wordCount` counts
paragraph text only, so a spoken heading is in no estimate today.

## Decision drivers

- Open Question C8: `[Chapter]`, `[Chapter Title]` computed from `manuscript.json`.
- C9 and ADR 0025: published room-tone guidance disagrees, so no number is baked in without a user setting.
- `CreditsPreview` has no chapter to fill `[Chapter]` from.

## Considered options

1. `[Chapter]` as the heading and `[Chapter Title]` as the subtitle, rendered per narration chapter, with room tone as the narrator's setting
2. Computing an ordinal chapter number

## Decision outcome

**Chosen option: `[Chapter]` as the heading and `[Chapter Title]` as the subtitle, rendered per narration chapter, with room tone as the narrator's setting**, because the heading already says what the book calls the chapter, and room-tone guidance disagrees, so no number is baked in without a user setting.

- **`[Chapter]` is the chapter's heading and `[Chapter Title]` its subtitle.** `credits.RenderAnnouncements`
  (`internal/credits/announcements.go`) renders one body once per chapter through `credits.Render`, adding those two tokens to
  the project's own (`creditTokens`), so `[Chapter]{: [Chapter Title]}.` reads "Chapter 1: Down the Rabbit-Hole." and
  "Prologue." for a chapter with no subtitle. No ordinal number is computed: the heading already says what the book calls it.
- **One new binding renders them for the narration chapters.** `CreditsChapterAnnouncements(body)` (`creditsextras.go`) reads
  `manuscript.json` through `h.services()` and answers one `{chapterId, chapter, result}` per chapter whose `contentKind` is
  `narration` or unset (the UI's own narration rule), never front matter or reference. Settings > Credits offers the kind and
  previews the first chapter ("Shown for Chapter 1, one of 12 chapters").
- **The estimate times the first announcement template for every chapter, with no room tone.** The Home Credits stat
  (`useCreditsSeconds.ts`) adds `estimateAnnouncementSeconds` (the same 155 words a minute) for the first `chapter_announcement`
  template (ADR 0093's "first of the kind" convention), next to the opening and closing files. Announcements are read at the
  head of each chapter's own file, so they take no room tone of their own; they stay out of the narration total like the rest
  of the credits.
- **Room tone is `General.credits_room_tone_seconds`**, a global choice of 0 to 10 seconds (0 by default, mirrored in
  `config/defaults.json` and `builtinDefaults`), added once to the opening and once to the closing file
  (`estimateCreditsSeconds`'s existing per-file allowance). The label says "per credits file"; the tooltip says it counts head
  and tail together and cites ACX's 1 to 5 seconds at each end.

### Consequences

- **Good:** One renderer still: the announcement preview and the estimate use `credits.Render`, and the `{...}` segment that drops a
  missing subtitle is the Phase 1 grammar, not a new one.
- **Neutral:** The Credits stat grows by every chapter's announcement, which is honest (the words are read) but new: a narrator who adds an
  announcement template sees the stat rise by about a second or two per chapter.
- **Bad:** The announcement is not shown in the Manuscript reader or read on the teleprompter, and Proofing still prepends only the
  spoken chapter title (`compare.py`): an announcement with more words than the heading and subtitle is reported as extra words.
  The guide says to keep it to those. Reading announcements on the teleprompter, or prepending the rendered announcement in
  Proofing, would each need their own change and ADR.
- **Neutral:** `hostAPIVersion` goes to 35 for the new binding. A later per-project template choice (ADR 0093's open follow-up) changes only
  which template `useCreditsSeconds` picks.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Computing an ordinal chapter number

- Bad, because the heading already says what the book calls it.
