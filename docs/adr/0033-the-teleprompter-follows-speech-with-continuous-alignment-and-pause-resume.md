# 0033. The teleprompter follows what was said, with continuous alignment and pause/resume

**Status:** Proposed
**Date:** 2026-09-19

## Context

The Manuscript Teleprompter has to keep a highlight on the word the narrator is reading in a known script, while narrators pause, ad-lib, repeat a sentence, and skip. "Where in the script am I" had three plausible answers. A **hard gate** that will not advance until the next word is said exactly right turns every filler word or ad-lib into a stall. A **pace-based clock** that scrolls at an expected speed and rewinds on mismatch has no grounding in what was said, drifts for slow readers and dense passages, and implies the system is scoring the narrator against a timeline. **Continuous alignment** follows the recognized speech itself. The design record is [manuscript-teleprompter.md](../architecture/manuscript-teleprompter.md). The engines that feed the tracker are [ADR 0021](0021-live-speech-engines-behind-one-event-contract.md); how the highlight is drawn is [ADR 0024](0024-teleprompter-highlight-follows-the-sidecars-spans.md).

## Decision

The tracker follows the narrator by continuous alignment, with no gate and no clock. `tools/manuscript-teleprompter/core/script_tracker.py` consumes the engine-independent `partial`, `word` and `segment_end` events and emits `position` events:

1. **Advance on a match.** Recognized words are fuzzy-matched forward from the current position, stepping over up to `MAX_SKIP = 2` script words (a misread or a skip). A heard word that fits nothing nearby, such as a filler or a bad first word, is ignored, not treated as an error. A forward-only speculative cursor follows every partial; a committed position follows confirmed words.
2. **Pause, do not block.** With no forward progress for `WAIT_SECONDS = 1.5` the status becomes `waiting` and the highlight holds. Nothing rewinds, and progress returns it to `listening`. Reaching the end reports `done`.
3. **Jump only on strong evidence.** A restart behind or a skip ahead is reported as a `jump` only when at least `MIN_JUMP_MATCHES = 3` heard words match and beat the nearby alignment by `JUMP_MARGIN = 2`, searched within `BACK_WORDS = 40` before and `AHEAD_WORDS = 30` after the current position. A skip reports the skipped span.
4. **Speech, not timestamps.** Only word order and arrival time drive the tracker. Engine word times are ignored.

The shape follows commercial voice-following teleprompters such as PromptSmart's VoiceTrack, known only from its documented behavior, and the tracker's design follows Autocue (MIT), as its module docstring says.

## Consequences

- A narrator can ad-lib, pause or restart without the app fighting them; the highlight simply waits or jumps back.
- Recovery is limited to the search window. A restart more than 40 words back, or a skip more than 30 words ahead, is not found by `locate` (`script_tracker.py:98-122`). Read from the code, and not exercised with a real long skip.
- Restarts and skips shorter than three matching words are not reported as jumps, and a single word that also appears elsewhere never moves the cursor (`test_a_single_word_that_appears_elsewhere_in_the_script_is_not_enough_to_jump`).
- The thresholds are judgment calls. They were set against three replayed readings of a 55-word script, and the tracker's tests use synthetic sequences (`core/tests/test_script_tracker.py`), so real long-form reading may need retuning.
- Matching is normalization plus a close-spelling check (ratio 0.8, words of four or more letters). It lacks Transcript Compare's homophone, number-word and hyphenation handling, so invented names and spoken numbers are the likely misses.
- No flags are emitted. A skipped or repeated span becomes a `jump` event and a dotted underline (ADR 0024), not a finding; turning it into one is planned in the teleprompter integration PRD.
- The design record still describes an earlier plan (a window of the current paragraph plus the next, a debounce, and matching with the same primitive as `InlineDiffRow.tsx` and `compare.py`). The code uses word-count windows and its own matcher, and this ADR follows the code.
- Replacing this with a gate, a clock, or a forced-alignment model would need a new ADR that supersedes this one.
