# 0265. The workspace highlights by binary search over timed tokens, and groups consecutive flagged tokens into one flag

**Status:** Accepted
**Date:** 2026-09-26

## Context

[Edit and proof workspace](../prds/edit-and-proof-workspace.prd.md) Phase 2 (lane C) builds the chapter workspace
on top of Phase 1's `WorkspaceAlignment` binding (ADR 0212, ADR 0242): a chapter's tokens, each carrying a status
(`read`, `misread`, `skip`, `short_read`, `different_text`, `head`, `tail`) and, when something was heard, an item
index and a source-time interval. The PRD's Architecture section names three needs Phase 2 has to answer itself,
none decided by Phase 1: how the karaoke highlight maps a playback position to a token forty times a second without
scanning a chapter's thousands of tokens each time, how the app's own player honours each item's played range
(`sourceStart` to `sourceStart + length * playRate`) instead of playing a file from 0 to its own end (the trim bug
the PRD's Evidence section calls out in `useTrackPlayback.ts` today), and how the flags legend and its next/previous
navigation turn a token-by-token status list into something a narrator reviews one problem at a time.

## Decision

1. **A playlist builder shared by Tracks and the workspace.** `buildPlaylist` (`apps/ui/src/components/workspace/playlist.ts`)
   turns a track's items into segments honouring each item's played range, on the app's own elapsed timeline (source
   seconds actually played, gaps skipped) rather than REAPER's project-time timeline: the app plays raw source at 1x
   (or the narrator's own speed, EP17), never REAPER's real-time-stretched render ("No pitch-correct play-rate
   emulation... in the app player" - What We're NOT Building), so a segment's own duration on the app's timeline is
   its source span's length, not the item's project-time length. `useChapterPlayback` plays a whole chapter's
   playlist across items; `useTrackPlayback` is refactored onto the same builder for one track at a time, which
   fixes its trim bug as a side effect (the same source span is now honoured either way) without changing its public
   shape or the states existing tests and the visual suite already cover.
2. **The highlight is a binary search per item, not a scan of the chapter.** `buildTokenIndex` groups a chapter's
   timed tokens (the ones with a source interval) by item index once, sorted by start; `currentTokenIndex` binary-
   searches that item's list for the last token whose start is at or before the playhead - the token containing it,
   or the nearest one before it during a pause between words, matching the PRD's own "Token at time" description.
   O(log n) per item instead of O(n) over the whole chapter keeps this affordable on every `timeupdate` tick for a
   15,000-word chapter, the scale the PRD's Technical risks table flags as unmeasured.
3. **A flag is a run of consecutive same-kind tokens, not one token.** `buildFlags` (`flags.ts`) groups the token
   statuses into five kinds (`skip`, `partial` for `short_read`/`different_text`, `not_recorded` for `head`/`tail`,
   `misread`, and `extra` for an unmatched audio run) and merges a run of consecutive tokens sharing a kind into one
   flag, matching the visual spec's "skipped (2 words)" markers rather than one flag per word. A misread never merges
   with its neighbours (each is its own word, with its own heard text). This groups Evidence's "Skipped, read short,
   different text, start or end not read" row into flags a narrator steps through one problem at a time (the
   legend's next/previous), rather than one per token in a run.
4. **Reviewing a flag, and REAPER-driven controls, are left out of Phase 2 rather than shown disabled.** The flags
   panel shows script/heard text and "Play from here" (the app's own player) only: accept/dismiss/defer/note needs a
   Finding a flag can be reviewed against, which Phase 4's overlay doesn't exist yet to provide, and "Go to"/"Loop"
   in REAPER needs Phase 3's bindings. Rather than paint disabled buttons with nothing behind them, this phase omits
   them; the header's REAPER connection state is AppShell's own existing pill (shown on every page), not a second
   one, since Phase 2 has no REAPER-driven control on this page to gate.

## Consequences

- `useTrackPlayback`'s `duration`/`currentTime` now read as the shorter of the item's declared played span and the
  source file's real duration (`Math.min`), so a source trimmed shorter than declared still can't be sought past its
  own end; this is a strict fix, not a behaviour change, for the shipped fixture (`sourceStart` 0, `playRate` 1) and
  every existing test and visual state.
- A chapter whose alignment predates COVERAGE_TOKEN lines (`needsAlignAgain`, ADR 0242) has paragraphs but no
  tokens: the workspace falls back to plain paragraph text with no highlighting, flags or click-to-seek for that
  chapter, and says so, rather than rendering blank paragraphs.
- Phase 3 (Go to/Loop in REAPER) and Phase 4 (findings review in place) both add UI to the same flags panel and
  script view this ADR's data model already carries (`Flag.seekTokenIndex`, token status); neither needs a new data
  shape, only new actions wired to the existing one.
- The mock's one deterministic misread token and one extra (repeat) run (`apps/ui/src/api/workspaceMock.ts`) are a
  stand-in for real ASR output, not derived from an actual alignment - `heard` text is a simple deterministic letter
  shuffle, documented in the mock as such, so the flags legend and detail panel have something real to demonstrate.
