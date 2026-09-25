# 0110. One Go chapter-to-track matcher, ported from Transcript Compare, with explicit confidence states

- **Status:** Proposed
- **Date:** 2026-09-23
- **Related:** Amended by [ADR-0175](0175-chapter-track-matching-reads-chapter-labels-through-one-shared-pre-pass-and-a-take-or-pickup-track-is-never-confident.md)

## Context and problem

`docs/prds/teleprompter-manuscript-integration.prd.md` Phase 8 needs "given a chapter, find its track and where the
recorded audio ends", and the same answer is wanted by Home's measured duration, line identity, the review
dashboard's chapter grouping, teleprompter-engines Phase 11 and the diagnostics DAW scan. Where the matcher lives was
settled in the PRD (Open Question, option a): a Go port of Transcript Compare's `find_chapter_by_track_name`
(`sidecars/transcript-compare/core/compare.py`), number-word merge included, with shared parity cases, replacing the
exact-title placeholder in `apps/desktop/internal/evidence/mapping.go`, and with [ADR 0100](0100-analysis-evidence-is-two-hash-keys-one-ledger-record-per-run-and-a-narrator-confirmed-track-map.md)'s
`chapter-track-map.json` as the manual override.

What the PRD left open: how faithful the port is, how a track-name-to-chapter matcher answers the reverse question
(chapter to track), how region names take part, and what "never silently picks between near-equal candidates" means
in numbers. The Python matcher itself does pick silently: several whole-token prefix matches return the shortest
title at 0.9, and its fuzzy fallback accepts any ratio from 0.75, so "Chapter 1" against a manuscript with only
"Chapter 11" matches it at 0.947.

## Decision drivers

- Several consumers want the same chapter-to-track answer (Home's measured duration, line identity, the review dashboard's chapter grouping, teleprompter-engines Phase 11, the diagnostics DAW scan).
- The PRD settled a Go port of Transcript Compare's `find_chapter_by_track_name`, with shared parity cases and `chapter-track-map.json` as the manual override.
- The matcher must never silently pick between near-equal candidates.
- The Python matcher itself picks silently: "Chapter 1" against a manuscript with only "Chapter 11" matches at 0.947.

## Considered options

1. A faithful Go port in one package, with explicit confidence states
2. Keep the status quo: the exact-title placeholder in `apps/desktop/internal/evidence/mapping.go`

## Decision outcome

**Chosen option: a faithful Go port in one package, with explicit confidence states**, because the PRD settled on a Go port with shared parity cases, and explicit states keep near-equal candidates from being picked silently.

1. **A faithful port, one package.** `apps/desktop/internal/chaptermatch` ports `tokenize` (quote normalization,
   `TOKEN_RE`, the homophone canon, the possessive fold), `merge_number_words`, `normalized_tokens`,
   `find_chapter_by_track_name` and `difflib.SequenceMatcher.ratio` as they are. The homophone list is embedded as a
   copy of `homophones.csv`; a Go test and a Python test fail when the copy drifts. The per-manuscript custom
   equivalence list is not ported (Transcript Compare loads it per run from a folder the matcher does not have).
   `tests/fixtures/chapter-track-match/parity-cases.json` holds inputs and the Python matcher's own answers;
   `chaptermatch` and `sidecars/transcript-compare/tests/test_chapter_track_parity.py` both read it.
2. **Chapter to track by asking every track which chapter it is.** `ForChapter` runs the ported matcher once per
   track name against every chapter title; a track is a candidate for a chapter only when that chapter is its best
   match. So "Chapter 1" is never offered for "Chapter 11" while Chapter 11 exists, and a manuscript's own headings
   decide ties the way Transcript Compare already does.
3. **Region names are a second source.** Each region name goes through the same matcher; every track with an unmuted
   item inside a matching region is a candidate, and its recorded end is measured inside the region (one long track
   holding several chapters). A track found by both keeps the better score, its own name on a tie.
4. **Explicit states, and only confident ones choose.** `confirmed` (one narrator-confirmed link to a track the
   project still has), `matched` (the best candidate is an exact or single whole-token prefix match, score 0.95 or
   more, and the next is at least 0.05 below), `uncertain` (the best is only the Python matcher's ambiguous-prefix
   pick or its fuzzy fallback), `ambiguous` (two candidates within 0.05, or two confirmed links) and `none`. Only
   `confirmed` and `matched` carry a track and a recorded end; the others return the ranked candidates and every
   track for the narrator to pick. Nothing is ever created.
5. **Confirmed links win and survive renames.** A confirmed link resolves by track GUID, so a renamed or reordered
   track stays linked, flagged `confirmed-track-renamed` when neither its name nor a region still matches. A track
   confirmed for another chapter is never a candidate. A link to a track the project no longer has is flagged
   `confirmed-track-missing` and the name match applies.
6. **The evidence suggester uses the same matcher**, suggesting only exact or single-prefix matches (0.95 or more).
7. **Recorded end** is the unmuted item ending last (`POSITION + LENGTH`) and, in its active take's source, SECTION
   start + `SOFFS` + `LENGTH` x `PLAYRATE` (rate 1 when absent), flagged approximate when the take has stretch markers
   or plays past its section's end. It is read from the saved `.rpp`, so the binding returns the file's save time for
   an "as of last save" label.

### Consequences

- **Good:** Transcript Compare and the app agree on what a track name means; a change to one matcher that the other does not
  follow fails a parity test, and the homophone list cannot drift silently.
- **Good:** Consumers get one answer shape (`chaptermatch.Result`) and one binding (`ChapterTrackMatch`, host API 31) instead of
  each scoring names.
- **Neutral:** A Python-confident match can be `uncertain` here (the 0.9 prefix pick and any fuzzy score): the narrator confirms
  it once and the confirmed link takes over.
- **Neutral:** Roman numerals are not merged ("Chapter I" is the token `i`), as in Transcript Compare; whole-token prefix matching
  still pairs "Chapter I" with "Chapter I: Down the Rabbit-Hole" and not with "Chapter II".
- **Neutral:** Stretch markers, looped sources and unsaved recording make the source time inexact; the result says so rather than
  guessing, and live REAPER state (PRD Phase 11) is the later refinement.

### Confirmation

`tests/fixtures/chapter-track-match/parity-cases.json` holds inputs and the Python matcher's own answers, read by both `chaptermatch` and `test_chapter_track_parity.py`; a Go test and a Python test fail when the embedded homophone copy drifts.
