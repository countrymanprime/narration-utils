# 0333. A credits check's basis is its rendered template text, via a synthetic manuscript the sidecar reads unmodified

**Status:** Proposed
**Date:** 2026-09-28

## Context

`credits-in-chapter-table.prd.md` Phase 3 lets a narrator run the same recording check the chapter table already
offers a manuscript chapter against an Opening or Closing credits row (CT4 option (c)). The Transcript Compare
sidecar (`sidecars/transcript-compare`, ADR 0127) measures a chapter's saved recording against text it reads from
`narration-utils/manuscript/manuscript.json` (`compare.py`'s `load_manuscript_chapters`), keyed by a chapter id that
must be in that file's `chapters` array. Credits are deliberately not manuscript chapters (ADR 0150, ADR 0183: "The
credits are not manuscript chapters and must never become one") — they are rendered on demand from the narrator's
template library and the project's credits values (`internal/credits`, `apps/desktop/creditsbindings.go`'s
`creditsScript`), the same render the teleprompter already reads as a host-written script file rather than a
manuscript entry.

ADR 0183 said a credits id must never reach "coverage" among the chapter-only consumers it listed; that clause is
this ADR's whole subject, not something it quietly drops — Phase 3 is the first time coverage needs to say anything
about a credits id at all, and it says it deliberately, in one narrow, additive place.

The sidecar itself is out of this stream's scope (`sidecars/**` is lane B). Changing `compare.py` to accept raw text
instead of a manuscript-chapter lookup would be the more "natural" fix, but it would also touch a shared,
Lua/harness-adjacent surface this stream does not own, for a problem the host can solve entirely on its own side.

## Decision

- **`coverage.ChapterBasis` gains a credits variant, not a new type.** `creditsBasis(documentID, kind, title, text)`
  builds the same `ChapterBasis{DocumentID, ChapterID, Title, Hash}` shape `chapterBasis` does for a manuscript
  chapter, so every consumer already keyed off `ChapterBasis` (the ledger, the mapping store, staleness, the
  sidecar's `--chapter-id`) needs no new case for "is this a credits row?" beyond the one dispatch point,
  `Service.basisAndText`. `Hash` is a digest of the kind, the rendered title and the rendered text — never manuscript
  paragraphs — so a template edit (a different body, a resolved token, a changed narrator name) changes the hash and
  makes a stored result stale, the same contract a manuscript chapter's edited paragraph already gives.
- **`DocumentID` is the current manuscript's own `documentId`, not a fixed "credits" placeholder.**
  `evidence.MappingStore` keeps one project's confirmed track links in one file, active for one `documentId` at a
  time (`chapter-track-map.json`); a separate scope for credits would either silently lose the manuscript's own
  links or need a second mapping file this PRD does not ask for. A credits row's link lives beside every manuscript
  chapter's, told apart only by `ChapterID` ("credits-opening" / "credits-closing" can never collide with a
  manuscript "c-XXXX" id, ADR 0183).
- **The sidecar is never changed.** When `Service.prepareAndLaunch` resolves a credits basis, it writes a synthetic,
  single-chapter manuscript.json (`writeCreditsManuscript`) - the rendered text as that one chapter's one paragraph -
  and passes its path as `--manuscript` for that run only, instead of the project's real manuscript file. The
  unmodified `narration_common.manuscript.load_file` and `compare.load_manuscript_chapters` already read this shape;
  from the sidecar's side a credits check looks exactly like a check of an ordinary one-paragraph chapter. The file
  is written two directories below the project root (`narration-utils/analysis/credits-manuscript.json`) - the same
  depth as the real `narration-utils/manuscript/manuscript.json` - so `compare.py`'s `project_data_dir`
  (`Path(manuscript_path).resolve().parents[2]`) still resolves to `<project>/TranscriptCompare`, and the narrator's
  own word-equivalence list and vocabulary hints still apply to a credits check exactly as they do to a manuscript
  one. The file is removed, best-effort, once the run ends (`finish`), the same way the run's own folder is.
- **Two new typed reasons**, not a reuse of the manuscript ones: `ReasonCreditsNotSetUp` (CT5: the kind checked has
  no rendered template - `Config.LoadCredits` erroring or unset) and `ReasonCreditsChanged` (the credits staleness
  reason `evaluate` reports in place of `ReasonManuscriptChanged` when `CreditsKind` holds for the basis being
  read), so the UI can word a credits refusal or staleness message on its own terms rather than borrowing "the
  manuscript changed." Both are wire-contract additions (`tests/fixtures/contracts/coverage-reasons.json`,
  `apps/ui/src/api/schemas/coverage.ts`'s `COVERAGE_REFUSAL_REASONS`, `recordingCheckText.ts`'s
  `COVERAGE_REASON_TEXT`).
- **`RecordingCheck.tsx` needs no structural change to run a credits check.** It already treats its `chapter` prop's
  `id` as an opaque key for every host call; `creditsCheckChapter(kind, title)` builds a synthetic-but-real
  `ManuscriptChapter` (never sent anywhere as a chapter, never entering `manuscriptChapters`) with the one paragraph
  id `writeCreditsManuscript`'s stand-in file gives the credits kind, so a reported gap numbers as "paragraph 1" the
  same way a real chapter's first paragraph would. This stream stops at exporting that helper: wiring a live "Check"
  button into the Home table (`AudiobookEstimatePanel.tsx`, a different phase's file, about to move to the
  Production home in stage-navigation Phase 2) is a follow-up phase's work.

## Consequences

- A credits check reuses every existing coverage code path (the job runner, the ledger, staleness, the model
  cascade) with zero sidecar or Lua change; `sidecars/transcript-compare` and `integrations/reaper` are untouched by
  this PRD phase.
- A credits row's confirmed track link and a manuscript chapter's now share one `chapter-track-map.json`; nothing
  about `evidence.MappingStore` itself changed; a caller building a suggestion candidate list to include the two
  credits titles (the PRD's "suggestByMatch adds the two credits titles as candidates") still has to do so itself
  (`evidence.ChapterCandidate` already accepts any id/title pair) - no such caller exists yet outside the stage
  engine, which this PRD explicitly keeps manuscript-only, so that wiring waits for whichever surface (a Tracks-page
  suggestion list) ends up needing it.
- The Check button on a credits row stays disabled on Home until a follow-up phase wires it; this ADR only makes
  the check itself possible and correct once something calls it.
- The synthetic manuscript file's lifecycle is best-effort cleanup, matching the run folder's own; a killed process
  between writing it and removing it leaves a stale `narration-utils/analysis/credits-manuscript.json` with an old
  template's text, overwritten by the next credits check before it is ever read again, so nothing reads it stale.
