# 0113. The Teleprompter suggests a chapter from the saved armed track, and preselects only a confident match

- **Status:** Proposed
- **Date:** 2026-09-23
- **Deciders:** the owner

## Context and problem

`docs/prds/teleprompter-engines-and-input-devices.prd.md` Phase 11 ("Chapter from REAPER track name") is to
"preselect the chapter the narrator is recording" from the `.rpp`'s track names, using the shared chapter-to-track
matcher ([ADR 0110](0110-one-go-chapter-to-track-matcher-ported-from-transcript-compare-with-explicit-confidence-states.md)).
The owner chose (2026-09-23) option (a): suggest from the *saved* `.rpp` with the matcher, standalone; following the
live selected or armed track in a running REAPER through the bridge is later work
(`teleprompter-manuscript-integration.prd.md` Phase 11). Its success signal: "Chapter 1" never suggests "Chapter 11",
and no match leaves the current default.

Three things were open:

- which track names: a project usually has a track for every chapter recorded so far, so the names alone say which
  chapters exist, not which one is being recorded;
- the matcher only answers chapter to track (`ForChapter`); the page needs track to chapter;
- how sure a suggestion must be before the picker moves by itself.

Building this also showed that ADR 0110's "a fuzzy score is uncertain" did not hold in the code: `classify` looked at
the score alone, and a difflib ratio can reach 0.95 or more ("The Rabit Hole" against "The Rabbit Hole" is 0.97), so a
near-miss name was `matched` (and suggested by the evidence suggester).

## Decision drivers

- The owner chose to suggest from the saved `.rpp` with the matcher, standalone.
- "Chapter 1" never suggests "Chapter 11", and no match leaves the current default.
- A project usually has a track for every chapter recorded so far, so track names alone say which chapters exist, not which one is being recorded.
- The matcher only answers chapter to track; the page needs track to chapter.

## Considered options

1. Suggest from the saved armed (else selected) track, and preselect only a confident match
2. Follow the live selected or armed track in a running REAPER through the bridge

## Decision outcome

**Chosen option: suggest from the saved armed (else selected) track, and preselect only a confident match**, because the owner chose the saved `.rpp` with the matcher, standalone, and following the live track is later work.

1. **The track is the saved record-armed track, else the saved selected track.** The `.rpp` stores each track's
   selection (`SEL 1`) and record arm (the first field of `REC`) as of the last save; `internal/tracks` now reads both
   (`Track.Selected`, `Track.Armed`, not on the TracksList wire). An armed track is the one being recorded on; with
   none armed, the selection is the next best sign; with neither, nothing is suggested. This is the saved state only:
   no bridge, and the UI says "as of its last save".
2. **`chaptermatch.ForTrack` is `ForChapter`'s other direction.** Its candidates are exactly the chapters whose
   `ForChapter` lists the track (same score, source and region), and its status follows the same rule
   (`classifyScores`): a narrator-confirmed link wins, a track linked to a chapter the manuscript no longer has is
   nobody's candidate (`confirmed-chapter-missing`), and only an exact or single whole-token prefix match is
   `matched`. Parity tests pin both directions against each other.
3. **Several armed (or selected) tracks** give a confident answer only when every one of them is confident about the
   same chapter; otherwise their chapters are offered together as `ambiguous`, or `none`.
4. **Only `confirmed` and `matched` preselect**, and only a chapter the picker lists (narration chapters), and never
   while a session is running. A confident suggestion wins over the last chapter read, since it names the chapter
   being recorded. `uncertain` and `ambiguous` are offered as buttons beneath the picker and never chosen. A failed
   lookup (no `.rpp`, none chosen) shows nothing: it is the normal case for a narrator who does not use REAPER.
5. **One binding, `ChapterSuggestion`** (host API 33), returning the suggestion with the `.rpp` path and its save time.
6. **Confidence is the kind of match, not its score.** `MatchTitle` keeps whether a name matched exactly or as a
   single prefix (`Confident`); `ForChapter`, `ForTrack` and the evidence suggester use it, so a fuzzy match is never
   `matched` or suggested whatever its ratio, as ADR 0110 already said.

### Consequences

- **Good:** The picker follows what the narrator set up in REAPER without a live connection, and a narrator who never arms a
  track, or does not save after arming one, sees the page exactly as before.
- **Bad:** A stale save can suggest last session's chapter; the hint names the track and says "as of its last save", and one
  click on the picker overrides it. Following the live arm is the planned refinement.
- **Neutral:** A near-miss track name that ADR 0110's code used to call `matched` is now `uncertain` in the resume card and the
  Tracks page's link suggestions too: the narrator picks once, and the confirmed link takes over.
- **Good:** The Review page's chapter grouping and the diagnostics phase that need track to chapter can use `ForTrack` rather
  than inverting `ForChapter` themselves.

### Confirmation

Parity tests pin `ForTrack` and `ForChapter` against each other.
