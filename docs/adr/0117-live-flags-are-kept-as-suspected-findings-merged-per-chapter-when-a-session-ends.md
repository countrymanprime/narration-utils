# 0117. Live flags are kept as suspected findings, merged per chapter, when a session ends

**Status:** Proposed
**Date:** 2026-09-23

## Context

`docs/prds/teleprompter-manuscript-integration.prd.md` Phase 7 carries an owner decision (2026-09-23, overriding the
recommendation to keep flags for the session only): the read-aloud dialog's suspected flags are written as findings with
status `unreviewed` through `apps/desktop/internal/findings`, the shared contract (`docs/architecture/findings-contract.md`),
not a parallel data model. [ADR 0115](0115-live-flags-are-suspected-judged-per-closed-segment-and-forgive-what-transcript-compare-forgives.md)
already fixed the category mapping (misread, extra and skipped are `transcript_discrepancy`; a restart is `pickup` with
`evidence.kind` `restart`) and kept flags out of the host's snapshot. Left to this phase: which side builds the finding, when
it is written, how a re-run avoids duplicates, how a dismiss is kept, and what a finding anchors to when no take is known.

Two facts shape it. A flag names chapter word indices of the sidecar's script, and only the manuscript knows what those words
say; and a live session usually reads part of a chapter, and each session is a new take, so a flag that a later session does
not raise again is no evidence that the first one went away. `Store.SaveAnalyzerFindings` treats every run as a full one and
marks whatever it did not reproduce `not_in_latest_run`, which would hide the first session's flags after the second.

## Decision

1. **One host binding, `TeleprompterSaveFlags(chapterId, flags)`** (host API 34). The dialog sends each flag as its paragraph
   and that paragraph's words (`[wordStart, wordEnd)`, the reader's own split, JavaScript's `\S+` runs), the event's chapter
   indices as evidence only, what was heard, and whether the narrator dismissed it. The host
   (`apps/desktop/internal/liveflags`) reads the paragraph from the imported manuscript, rejects the whole save if any flag
   names an unknown kind or paragraph or words outside it (at most 2,000 flags, 2,000 characters heard), and builds the
   findings itself: the expected text, the character span (UTF-16 offsets, the unit the reader's notes already use) and the
   id come from the manuscript, never from the caller. It answers one finding per flag, in order, as stored.
2. **Identity follows the contract.** `id` is `StableID("teleprompter", chapter, paragraph, kind, the flagged words, ordinal)`,
   the ordinal counting earlier places in the paragraph where the same words start (ignoring case); `evidence_version` is a
   hash of what was heard, lowercased with its spacing collapsed. The same misread heard the same way in another session is
   the same finding with the same evidence; heard differently, it is the same finding with new evidence, so an earlier
   dismissal returns to `unreviewed` and keeps its note.
3. **Merged, not replaced.** `findings.Store` gains `MergeAnalyzerFindings` (additive; `SaveAnalyzerFindings` is unchanged in
   meaning): the fresh findings are written over the chapter's stored ones by id, and a stored finding the session did not
   raise is kept exactly as it was. Both now keep one finding per id when a run repeats one. The scope is the chapter id (or a
   short hash of it when it is not a safe file name), under `narration-utils/findings/teleprompter/`.
4. **When.** The dialog saves when a session ends while it is open (Stop, the sidecar stopping, auto-stop at Done: the host
   reports the phase only after the sidecar's last flags arrived), when it closes, and when a flag is dismissed after the
   session ended. Saving again is harmless (decision 3), so there is no guard. A failed save is shown in the Flags tab.
5. **A dismiss is a decision, never a delete.** The host records `dismissed` in the append-only review history only when the
   stored finding is not already dismissed, so repeated saves add nothing. A flag an earlier session dismissed with the same
   heard text comes back dismissed and the dialog hides it. There is no un-dismiss here; the review surface owns other
   decisions.
6. **Every kind is kept, whatever the dialog shows.** Which kinds show in the text is a per-viewer display preference; the
   findings are the session's record, so misreads and extras hidden by default are kept too, all at `confidence: null` with a
   `confidence_reason` that says they are suspected and that Transcript Compare over the recorded take is authoritative.
   Severity follows Transcript Compare's adapter: misread and skipped `warning`, extra `info`, restart `info`.
7. **No take, no time.** With no REAPER take known (Phases 11 and 12 add that), a finding's anchor is its manuscript span
   alone: `source` is empty and there is no `time_range`. When the bridge can say what is recording, the same finding gains
   the take's GUIDs first and project time as the fallback, per `daw-integration.md`; the id does not change.

## Consequences

- A live flag and a Transcript Compare row about the same words are separate findings from separate analyzers; the review
  surface lists both, and Transcript Compare stays the authoritative one.
- Re-running a chapter never piles up duplicates, and a partial session never hides an earlier one's flags. The cost is that
  a flag stays `unreviewed` until someone reviews it, even after a clean re-read, because the earlier take may still be the
  one used.
- Flags on the title (not a manuscript paragraph) or in a paragraph whose words disagree with the sidecar's script are shown
  but not kept. A flag across two paragraphs is kept as one finding per paragraph.
- Flags that arrive after a close while reading (the sidecar's last segment, flushed on stop) are not kept, because the
  dialog is gone; a session stopped with Stop first keeps them. A view opened mid-session does not see the flags raised
  before it opened until the review surface reads the store (the review dashboard's read bindings, another PRD).
- The standalone Teleprompter page draws no flags and keeps none; it is retired in Phase 13.
- Hidden misreads are kept at the measured synthetic rate of about 2 per 100 words, so a long chapter can add dozens of
  unreviewed `transcript_discrepancy` findings; if that is too noisy for the review surface, keep only the kinds shown, which
  is a change to decision 6 only.
- Changing what a flag's id or evidence is made of, or replacing merge with full-run semantics, needs a new ADR that
  supersedes this one.
