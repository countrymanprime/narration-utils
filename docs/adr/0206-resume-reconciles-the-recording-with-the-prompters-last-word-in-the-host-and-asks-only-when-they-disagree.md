# 0206. Resume reconciles the recording with the prompter's last word in the host, and asks only when they disagree

**Status:** Accepted
**Date:** 2026-09-25
**Amends:** ADR-0112 decision 3 (a choice is no longer the only thing that sets where Start begins)

## Context

The owner's report of 2026-09-24 (`docs/prds/read-aloud-resume-from-daw.prd.md`) asked for resume to find where the track is, find where the prompter last was in the script, keep going when they match, and ask only when they do not. Two sources exist now. One is the tail locate over the saved project (ADR 0111). The other is the prompter's last word per chapter, which ADR 0205 stores when a session ends. ADR 0112 made every resume a confirm, because the tail locate was then the only, unverified source. D39 (implementation plan §6) takes the PRD's recommended answers: RD1 (c) says two places agree within ten words or in the same sentence; RD3 (a) says the DAW word wins on agreement; RD8 (a) says a last reading alone is offered, never taken silently. The alternative was to compare the two in the UI. That would put the rule in TypeScript, untested against the Go types, and make each later surface re-derive it.

## Decision

- **One pure host function decides.** `teleprompter.Reconcile(daw *Located, prompter *Reading, script ChapterScript, tolerance int) ResumeVerdict` (`apps/desktop/internal/teleprompter/reconcile.go`) returns one of `agree`, `disagree`, `complete`, `daw_only`, `prompter_only` or `none`. It also returns each source's place: the zero-based next word, the same word one-based for display, the sentence holding the last word read before it, and whether it is confident. `start` is set only for `agree`.
- **The rules.** Two places agree when their next words are within `ResumeTolerance` (10) words, or when their last read words are in the same sentence. On agreement the DAW word is the start. A low-confidence DAW word never agrees by itself: within tolerance of the prompter's word it agrees with `confirmedBy: "prompter"`, and otherwise it is a disagreement. A DAW word with no readable words after it (at or past the last token, or only punctuation left) is `complete`, unless it is a low-confidence guess the prompter contradicts. A DAW word alone is `daw_only`, and a reading alone is `prompter_only`: each is offered, never preset. A reading that reached the last word is not offered. A source counted over a different token count than the chapter's is ignored rather than compared.
- **The host quotes the script itself.** `teleprompter.LoadChapterScript` and `ChapterScript.SentenceAt` port the sidecar's `load_chapter_script` tokenising (Python's `str.split()`, including U+001C to U+001F) and `locate.sentence_bounds`. The host can then quote the prompter's sentence without running the sidecar.
- **It rides on the existing binding.** `TeleprompterLocate` gains `lastReading` (ADR 0205's record, or null) and `verdict` on every answer except the model gate's `asset_required`, so a chapter with no track still offers its last reading. No binding is added. The result's shape changed, so `hostAPIVersion` went to 50. The goldens are `teleprompter-locate-{found,agree,disagree,complete,prompter-only}.json`. The schema is `teleprompterResumeVerdictSchema`. The mock follows the same rules (`?mockResume=agree|disagree|prompter_only|complete`).
- **The UI renders, never recomputes.** The resume prompt shows the notice or the choice from `verdict.kind`. On `agree` it presets Start reading to `verdict.start`. Agreement presets the start word; it does not start listening (RD4 (a)).

## Consequences

- Agreement needs no click, and a finished chapter never offers a resume, whatever surface asks.
- The Go tokenising must stay in step with the sidecar's. A change to `load_chapter_script` or `sentence_bounds` changes it here too. A mismatch shows as token counts that differ, and then that source is dropped rather than misplaced.
- Phase 4 adds a live DAW source. `ResumePlace.source` already says `saved`, so the live one adds a value, not a field.
- The rule in the prompt's UI (Phase 3 UI, lane C) is presentation only. Changing what counts as agreement means changing `Reconcile` and this ADR.
