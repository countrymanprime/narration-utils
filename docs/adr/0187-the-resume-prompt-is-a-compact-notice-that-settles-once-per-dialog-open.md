# 0187. The resume prompt is a compact notice that settles once per dialog open

- **Status:** Proposed
- **Date:** 2026-09-24
- **Related:** Supersedes [ADR-0112](0112-the-resume-card-looks-up-where-the-recording-ends-on-open-and-a-choice-only-sets-where-start-begins.md), decisions 4 and 5

## Context and problem

The read-aloud dialog's resume card (ADR 0112) sat above the reading view as a bordered `Panel`, centred on the dialog
body rather than the text column beside the reading panel (`read-aloud-control-bar.prd.md`). The owner reported it
differently: it never went away after a choice (it folded into a "Change" summary instead), it came back and asked
again every time a session ended, and a fully recorded chapter was still offered a word to "resume" at, past the last
word of the script (`docs/prds/read-aloud-resume-from-daw.prd.md`). Phase 1 of that PRD fixes the UI's behaviour and
shape without yet reading REAPER's live state or a stored prompter position (its own Phases 2-5).

## Decision drivers

- The owner reported that the resume card never went away after a choice, folding into a "Change" summary instead.
- It came back and asked again every time a session ended.
- A fully recorded chapter was still offered a word to "resume" at, past the last word of the script.
- The card was centred on the dialog body rather than the text column beside the reading panel.
- Phase 1 fixes the UI's behaviour and shape without yet reading REAPER's live state or a stored prompter position.

## Considered options

1. A compact resume prompt in the text column's header slot that settles once per dialog open
2. Keep the status quo: ADR 0112's bordered resume card, which folds into a "Change" summary and asks again after every session

## Decision outcome

**Chosen option: a compact resume prompt in the text column's header slot that settles once per dialog open**, because the owner reported that the card never went away after a choice, came back every time a session ended, and offered a fully recorded chapter a word to resume at.

1. **The resume card becomes a resume prompt**: one compact bordered notice (`ResumePrompt.tsx`, replacing
   `ResumeCard.tsx`/`ResumeOffer.tsx`), not a `Panel`, rendered in the text column's `header` slot
   (`read-aloud-control-bar.prd.md` Phase 1) so it shares the text's own left and right edges.
2. **It settles once and stays gone for the dialog's whole open.** `ResumePrompt` is mounted for the dialog's entire
   life (`ReadAloudDialog` no longer conditionally mounts it on `!session.active`), and it tracks its own `settled`
   flag: any of the three choices ("Resume from here", "Start from the top", "Pick a word") or a session starting sets
   it, and it never resets itself. This amends ADR 0112 decision 5, which asked the mount/unmount cycle to reset and
   re-ask every time a session ended; now the dialog explicitly resets the session's start word to `null` when a
   session ends (`ReadAloudDialog`'s existing active/inactive transition effect), so the next Start still begins at
   the top without a prompt to clear.
3. **A choice never leaves a summary to change.** Choosing an option calls `onStartWord` and settles at once; there is
   no "Change" affordance, because the whole point is that nothing sits there once a choice is made.
4. **A placed word at or past the chapter's last word is `complete`**, not a resume offer: `located.word >= located.tokens`
   (computed in the UI this phase; a later phase moves it into the host's verdict) shows "This chapter is recorded to
   the end" with only "Pick a word" as an alternative, fixing the reported "word 323 of 323" case.
5. **Track linking leaves the resume area.** This amends ADR 0112 decision 4: instead of an inline track picker for an
   uncertain, ambiguous or missing match, and instead of an inline warning paragraph for a confirmed track that was
   renamed, missing or linked twice, the prompt shows one line naming the problem with a link to the Tracks page
   (`/tracks`). Choosing a different track in place is [Chapter Track Link Control](../prds/chapter-track-link-control.prd.md)'s
   job, not this dialog's.

### Consequences

- **Neutral:** `ResumeCard.tsx`, `ResumeOffer.tsx` and their test are deleted; `ResumePrompt.tsx` and `ResumePrompt.test.tsx` replace
  them. The eleven `manuscript/read-aloud-resume-*` visual states become nine: offer, low-confidence, complete,
  not-found, no-track, model-required, error, after-choice (no prompt) and after-session (no prompt).
  `dialog-read-aloud-resume.aria.yml` drops the card's heading (the prompt is named by `aria-label`, not a visible
  `<h2>`) and the "Another track" button.
- **Bad:** A narrator who wants to read a different track than the one matched must go to the Tracks page; this is a narrower
  affordance than before, deliberately, until Chapter Track Link Control's own picker exists.
- **Neutral:** The prompt still reads only the saved `.rpp` tail (ADR 0111); reading REAPER's live state, a stored prompter
  position and reconciling the two are `read-aloud-resume-from-daw.prd.md` Phases 2-5, not built here.

### Confirmation

`ResumePrompt.test.tsx`, the nine `manuscript/read-aloud-resume-*` visual states (offer, low-confidence, complete, not-found, no-track, model-required, error, after-choice and after-session) and `dialog-read-aloud-resume.aria.yml`.

## Pros and cons of the options

### Keep the status quo: ADR 0112's bordered resume card, which folds into a "Change" summary and asks again after every session

- Bad, because it never went away after a choice and came back every time a session ended.
- Bad, because a fully recorded chapter was still offered a word to resume at.
