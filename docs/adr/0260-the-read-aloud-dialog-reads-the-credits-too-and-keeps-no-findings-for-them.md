# 0260. The read-aloud dialog reads the credits too, and keeps no findings for them

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:** the read-aloud clause of ADR 0150 (the paragraph beginning "The read-aloud dialog (opened from a
Manuscript chapter) is not given the credits here"); the rest of ADR 0150 (host rendering, the `--script` file, spans,
the C6 warning) stands unchanged.

## Context

`manuscript-credits-card-parity.prd.md` Phase 2 is the owner's second complaint on the Manuscript page: "I need to be
able to use the teleprompter for [the credits] because I have to read it," with the only path today being to leave the
Manuscript page, open the standalone Teleprompter page and pick the credits from its picker. That page is scheduled for
retirement (`teleprompter-manuscript-integration.prd.md` Phase 13), which would leave the credits with no reading path
at all once it goes. ADR 0150 built everything the credits need to be read aloud (the UI sends only `credits: "opening"
| "closing"`, the host renders the text and passes it to the sidecar as a `--script` file with spans, `useTeleprompterSession`
already accepts a `credits` source) but deliberately kept `ReadAloudDialog` chapter-only, because the dialog keeps its
flags as findings **per chapter id** (`useKeptFlags(chapter.id, ...)`, ADR 0117) and shows a resume card that looks up
the chapter's REAPER track (`useResumeLocate`, ADR 0112) — neither of which has a credits equivalent. ADR 0150 named the
gap explicitly and said closing it "would need its flags kept somewhere other than a chapter's findings, and a new ADR."
This is that ADR.

## Decision

- **`ReadAloudDialog` takes a `source` union in place of `chapter`.** `type ReadAloudSource = { kind: 'chapter'; chapter:
  ManuscriptChapter } | { kind: 'credits'; credits: CreditsKind; preview: CreditsRenderResult }`
  (`apps/ui/src/components/teleprompter/ReadAloudDialog.tsx`). `Manuscript.tsx` holds `readAloud: ReadAloudSource |
  undefined` and opens the dialog from either a chapter's or a credits card's Read aloud button, the latter shown only
  once `preview.words > 0` (matching the standalone picker's own filter, `TeleprompterPage.tsx`).
- **Credits mode starts the same session the standalone page starts.** `useTeleprompterSession({ chapterId: '', chapter:
  undefined, credits: { kind, text: preview.text } })` — the same call `TeleprompterPage.tsx` already makes. No new host
  or sidecar surface: this is the existing ADR 0150 path, reached from a second UI entry point.
- **No resume card for credits.** `useResumeLocate` and the resume prompt are chapter-only; a credits session has no
  REAPER track to look up (MC9). The dialog renders `UnresolvedCreditsWarning` in the header slot a chapter dialog would
  give the resume prompt, whenever the credits preview has unresolved tokens — the same warning and the same "Fill them
  in Settings" (`/settings#credits`) the standalone page already shows, now shared from its own file
  (`UnresolvedCreditsWarning.tsx`) instead of living inside `TeleprompterPage.tsx`. Start stays enabled either way (C6).
- **Credits flags are shown, never kept.** `useKeptFlags` takes `chapterId: string | null` and no-ops, starting at
  `{ status: 'not-kept' }`, when `chapterId` is `null` — which the dialog passes for a credits source in place of a
  chapter id. The narrator still sees a word flagged as skipped or restarted while reading, exactly as in chapter mode,
  but nothing is written to `teleprompterSaveFlags` and nothing is read back on reopen. The Flags tab shows `'Flags on
  the credits are not kept.'` instead of a save state. A store for credits flags is future work behind a recording
  check for credits (MC8), not this phase.
- **Closing or leaving still confirms mid-session.** `requestClose` and the new `requestFixCredits` (for "Fill them in
  Settings" reached from inside the dialog) both go through the same "Stop reading?" confirmation as an active chapter
  session, regardless of source kind.

## Consequences

- The credits get one reading path that survives `teleprompter-manuscript-integration.prd.md` Phase 13 retiring the
  standalone Teleprompter page: Phase 2 of the parity PRD must land before Phase 13 deletes the page, so the credits are
  never left unreadable in between.
- `ReadAloudDialog` and `useKeptFlags` now branch on source kind in a small number of places (title, header slot, flags
  persistence, resume/notes availability) rather than staying chapter-only; the chapter path and its existing tests are
  unchanged in behavior.
- Credits still carry no findings of their own: nothing added here gives them an id `teleprompterSaveFlags`,
  `readerStateSave` or `manuscriptParagraphs` could accept, so ADR 0004 and ADR 0150's "credits are not chapters" holds.
- A future recording-check phase for credits that wants to keep flags durably will need a new findings anchor (not a
  chapter id) and a new ADR that supersedes the "flags are shown, never kept" clause here.
