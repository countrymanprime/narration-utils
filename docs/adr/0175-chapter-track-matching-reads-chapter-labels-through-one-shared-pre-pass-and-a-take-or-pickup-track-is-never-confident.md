# 0175. Chapter-track matching reads chapter labels through one shared pre-pass, and a take or pickup track is never confident

**Status:** Proposed
**Date:** 2026-09-24
**Amends:** ADR-0110

## Context

[DAW Chapter-Track Auto-Sync](../prds/daw-chapter-track-auto-sync.prd.md) measured the matcher of [ADR 0110](0110-one-go-chapter-to-track-matcher-ported-from-transcript-compare-with-explicit-confidence-states.md)
against real track-name habits. "Ch. 6", "Ch6", "CH06", "06" and "Sixth Chapter" matched nothing; "Chapter 06",
"Chapter6" and "Chap 6" matched only as fuzzy guesses that can never link; and two names matched the wrong chapter:
"Chapter VI" went to Chapter 1 and "Chapter 6 v2" to Chapter 2. A pickup or take track ("Chapter 6 (pickups)",
"Chapter 6 - take 2") matched nothing at all. Automatic linking (the PRD's later phases) needs every conventional name
to match its chapter or nothing, never a wrong one. S5 lists the forms; S9 asks that Transcript Compare, which has the
same gaps, keep parity.

## Decision

1. **A label pre-pass on both sides.** `chaptermatch.LabelTokens` (`apps/desktop/internal/chaptermatch/label.go`) and
   `label_tokens` (`sidecars/transcript-compare/core/compare.py`) replace `normalized_tokens` inside
   `MatchTitle` / `find_chapter_by_track_name`, for track names, region names and chapter titles alike. In order:
   accents fold; letters split from the digits after them; `ch`/`chap`/`chapt`/`chpt` before a number read as
   "chapter"; a Roman numeral (I to C) right after chapter/part/book reads as its number; an ordinal ("sixth",
   "twenty first", "6th") reads as a number and moves after the label it precedes; "the" between a label and an
   ordinal goes; the homophone canon, the possessive fold and the number-word merge run as before; leading zeros go; a
   track number before a label goes ("06 - Chapter 6"); "Intro", "Forward" and "Acknowledgements" fold when they open
   the name. A Roman numeral, an abbreviation or an ordinal anywhere else stays a word, so "I Am Legend" and "a nice
   chap" are untouched. `normalized_tokens` itself, and its parity cases, do not change.
2. **Markers, reported not matched.** A trailing run of take markers (`take N`, `v N`, `version`, `comp`, `final`,
   `edit`, `alt`) or pickup markers (`pickup(s)`, `pu`) after a number or a front/back-matter heading is removed and
   reported as the match's `Marker`. A take or pickup match scores at most 0.9 and is never confident, so a
   "Chapter 6 pickups" track stays 0.1 behind "Chapter 6" (no tie) and a lone "Chapter 6 v2" is only a candidate the
   narrator confirms. "Opening/Intro/Closing/End Credits" is reported as `credits` and matches no chapter (ADR 0150).
3. **A pickup track is never a link candidate.** `ForChapter` and `ForTrack` leave out a track or region whose match
   carries the pickup marker, because a pickup track is not the chapter's own recording (the PRD's S11 records it as a
   separate, typed link in a later phase). A take track stays a candidate.
4. **Parity.** `tests/fixtures/chapter-track-match/parity-cases.json` gains `labelTokens` cases and the Evidence
   table's names as `matches` cases, with the Python matcher's answers; both suites read them. The fuzz target checks
   that a take or pickup match is never confident.

## Consequences

- Every conventionally named track in the PRD's Evidence table now matches its right chapter, confidently where the
  name is the chapter's own, and "Chapter VI" and "Chapter 6 v2" can no longer land on Chapter 1 or 2.
- Transcript Compare's track-name lookup gains the same forms, so a "Ch. 6" track in REAPER compares against
  Chapter 6 instead of asking for a chapter.
- A title whose own words look like a marker after a number ("Chapter 12 Final") reads without them; both sides of a
  match go through the same pass, so this only matters when a track name and a title differ in those words.
- The confidence rule of ADR 0110 (the kind of match, not the score) is unchanged; a marker only lowers a match.
- Changing the rules means changing both implementations and the parity file together; a new form is a new
  `labelTokens` case.
