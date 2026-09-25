# 0205. The prompter remembers its last word per chapter, in a host-named file dropped when the text changes

**Status:** Accepted
**Date:** 2026-09-25

## Context

The owner's report of 2026-09-24 (`docs/prds/read-aloud-resume-from-daw.prd.md`) asked for resume to compare where the recording is with where the prompter itself last was, and to ask only when the two disagree. The host kept the last `position` event only in memory for the running session and cleared it when the next one began (`internal/teleprompter/service.go`). Nothing was kept per chapter. ADR 0111 decision 1 rejected word-to-time anchors from past sessions as a way to *place* the recorded tail. A last reading position is a different, smaller thing: one word index, used only as a check. D39 takes the PRD's recommended design for Phase 2.

## Decision

- **When a chapter session ends, the host keeps its last position.** Before the watcher publishes `stopped` (or `error`), `Service.recordReading` writes `<project>/narration-utils/teleprompter/<name>.reading.json` as `{version: 1, chapterId, read, tokens, scriptHash, status, endedAt}`. `read` is the last `position` event's `read`, the index space of locate's `word`. `tokens` comes from the session's `script` event. `status` is that position's status. The write goes through a temporary file and a rename. This covers a stop by the narrator, the auto-stop at Done (ADR 0106) and a crash after positions arrived.
- **Nothing is written without a place to remember.** A credits session (MC8, MC9), a session that never positioned, or one whose last `read` is 0 writes nothing. A write that fails is logged (`teleprompter_reading_not_saved`), never shown.
- **The host names the file.** The chapter must be a chapter of the imported manuscript before it names a file. The file name is the id itself only when the id matches `[A-Za-z0-9_-]{1,64}`, otherwise `id-<hash>` (threat model row 6k).
- **A reading applies only to the text it was read against.** `scriptHash` hashes the manuscript's document id and the chapter's title, subtitle and paragraphs. `LoadReading` returns nothing for an edited chapter, a re-imported manuscript, another chapter's file, another version, a `read` outside `[0, tokens]`, or a file that does not parse.
- **It is a wire contract.** The golden is `teleprompter-reading.json`, written by `TestContractReading`. The Zod schema is `teleprompterReadingSchema`, with a `wireContracts.test.ts` row, and the mock is `mockLastReading`. No binding reads it yet. Phase 3 adds it to the locate result as `lastReading` and bumps `hostAPIVersion` then.

## Consequences

- Phase 3 can reconcile the DAW position with the prompter's own position and ask only when they disagree.
- A narrator who reads on without recording leaves a reading ahead of the recording. Phase 3's rule (the DAW word wins on agreement, RD3) is what keeps that from moving the start.
- A reading survives a Replace manuscript on disk but no longer matches (the document id is in the hash). `resetDerived` does not delete the folder, which Phase 12's anchors will share.
- Using the stored position to place the recorded tail, rather than to check it, would reopen ADR 0111 decision 1 and needs its own ADR.
