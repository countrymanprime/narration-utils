# 0112. The resume card looks up where the recording ends when the dialog opens, and a choice only sets where Start begins

- **Status:** Proposed
- **Date:** 2026-09-23
- **Related:** Decisions 4 and 5 are superseded by [ADR-0187](0187-the-resume-prompt-is-a-compact-notice-that-settles-once-per-dialog-open.md); decision 3 is amended by [ADR-0206](0206-resume-reconciles-the-recording-with-the-prompters-last-word-in-the-host-and-asks-only-when-they-disagree.md) (a choice is no longer the only thing that sets where Start begins)

## Context and problem

`docs/prds/teleprompter-manuscript-integration.prd.md` Phase 10 ("Resume UI") puts the resume point from Phase 9
([ADR 0111](0111-the-resume-point-comes-from-transcribing-the-recorded-tail-and-placing-it-with-the-tracker.md),
`TeleprompterLocate`) in the read-aloud dialog. The PRD's user flow says the modal asks the host about the chapter's
track and shows "Resume at word N / Start from the top / Pick a word", and that it "never starts anything by itself".
Its success signal: "without a matching track the modal starts from the top and says so; with one it never starts by
itself". Three things were left to settle while building it:

- when the lookup runs: it transcribes up to 30 s of audio with Whisper, a second or two with the tiny model on a CPU
  and longer with a bigger one, and it may need a model that is not downloaded;
- what "Resume from here" does before a session exists: the tracker only takes a word to seek to once it is running,
  and the reader cannot make words clickable before the sidecar has sent the script's spans;
- what happens to the card, and to a chosen word, while a session is running.

## Decision drivers

- The modal never starts anything by itself; without a matching track it starts from the top and says so.
- The lookup transcribes up to 30 s of audio with Whisper and may need a model that is not downloaded.
- The tracker only takes a word to seek to once it is running, and the reader cannot make words clickable before the sidecar has sent the script's spans.
- The PRD's "under 30 s" target for seeing where a chapter stopped.

## Considered options

1. Look up when the dialog opens, and let a choice only set where Start begins
2. Wait for a button press before looking up

## Decision outcome

**Chosen option: look up when the dialog opens, and let a choice only set where Start begins**, because waiting for a button press would put a click and a wait between opening a chapter and seeing where it stopped, the step the PRD's "under 30 s" target is about.

1. **The card asks the host once, when the dialog opens**, with the session's Whisper model, and again only when the
   narrator picks a track, presses Try again, or has just downloaded the model it needed. It only reads: the host's
   `TeleprompterLocate` records, moves and links nothing. Waiting for a button press first would put a click and a wait
   between opening a chapter and seeing where it stopped, the step the PRD's "under 30 s" target is about.
2. **A missing model is asked for, never fetched.** When the host answers `asset_required` the card says so and offers
   "Download model…", which opens the shared first-use confirm (`AssetInstallPrompt` through `WhisperModelPrompt`);
   only its confirm starts a download, and a finished download runs the lookup again. The dialog never opens that
   confirm by itself.
3. **A choice only sets where Start begins.** "Resume from here" sets the session's start word
   (`useTeleprompterSession.startWord`), which Start reading passes to `TeleprompterStart` as `startWord`, the start-at-a-
   word half of the Phase 3 seek channel, so a resumed session never reads from the top first. "Start from the top"
   clears it. "Pick a word" says to start reading and click the word (Phase 4's "Start here"), because before the script
   arrives the reader's words are not yet positions the tracker knows. Nothing starts until the narrator presses Start
   reading.
4. **The card never guesses between tracks.** When the host answers `no_track` (the match is `uncertain`, `ambiguous`
   or `none`) the card shows a track picker, the matcher's candidates first, and reads the track the narrator picks with
   `trackGuid`. The narrator can also read another track when the matched one is wrong. Picking a track is not saved as
   the chapter's confirmed link: that stays the Tracks page's explicit Confirm (ADR 0100).
5. **The card is shown only between sessions.** While a session runs it is gone (the word click moves the tracker), and
   when it comes back it asks again and clears the start word, so a word chosen before one session never silently starts
   the next.
6. **Every answer is labelled "as of the project's last save"** with the `.rpp`'s save time, because the lookup reads
   the saved project, not REAPER's live state (Phase 11).

### Consequences

- **Bad:** Opening the dialog on a recorded chapter costs one short Whisper run on the narrator's CPU even when they meant to
  start from the top. A narrator on a slow machine sees "Finding where your recording of this chapter ends…" for longer;
  reading can still be started at any time, from the top.
- **Neutral:** `?mockResume=` (main.tsx, `resumeMockSeed.ts`) reaches every card state in the browser mock, and the visual suite
  captures each one (`manuscript/read-aloud-resume-*`); the aria suite pins the card's region, quote and choices.
- **Neutral:** Resuming a session that is already running (the dialog opened onto a session the host kept) is not offered: the
  narrator stops, or clicks the word. A later phase that wants a "Go to where I stopped" during a session can seek with
  `TeleprompterSeek` instead of setting the start word.
- **Neutral:** Changing when the lookup runs (for example only on request, if its CPU cost matters on real machines) supersedes
  point 1 in a new ADR.

### Confirmation

`?mockResume=` reaches every card state in the browser mock; the visual suite captures each one (`manuscript/read-aloud-resume-*`), and the aria suite pins the card's region, quote and choices.

## Pros and cons of the options

### Look up when the dialog opens

- Bad, because it costs one short Whisper run on the narrator's CPU even when they meant to start from the top.

### Wait for a button press

- Bad, because it would put a click and a wait between opening a chapter and seeing where it stopped.
