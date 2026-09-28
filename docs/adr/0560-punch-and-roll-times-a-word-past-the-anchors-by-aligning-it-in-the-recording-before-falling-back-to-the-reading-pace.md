# 0560. Punch and roll times a word past the anchors by aligning it in the recording, before falling back to the reading pace

**Status:** Proposed (teleprompter-manuscript-integration PRD Phase 12, stream N-B46; the owner checks it on a real recording on #510)
**Date:** 2026-09-28
**Supersedes:** (none; refines the fallback half of ADR 0246)

## Context

"Punch from here" moves REAPER's edit cursor to a flagged word's project time minus the pre-roll
(teleprompter-manuscript-integration.prd.md Phase 12, [ADR 0246](0246-punch-and-roll-moves-only-the-edit-cursor-and-anchors-words-by-a-polled-play-position.md)).
The owner chose on 2026-09-23 where that time comes from: live anchors first (the host polls REAPER's play position
during a session and pairs it with the word being read, `internal/teleprompter/anchors.go`), offline alignment over
the resolved range when no anchor covers the word. Booth Actions Enablement Phase 3 built the anchors and labelled
anything outside them `alignment`, but that answer was an extrapolation of the anchors' pace, not an alignment: it
drifts with every pause the narrator took since the last anchor, and there is nothing at all without two anchors (a
session with the `punch` capability off, a chapter recorded before the teleprompter was open). The poll runs every
3 s, so the word a flag was just raised on is very often past the last anchor.

The sidecar already had what an alignment needs: the tail-audio locate ([ADR 0111](0111-the-resume-point-comes-from-transcribing-the-recorded-tail-and-placing-it-with-the-tracker.md))
cuts a range out of a take's source file, decodes it with faster-whisper with word timestamps and Silero VAD, and
places the heard words in the chapter by ranking every place they fit with the tracker's own alignment step.
Forced alignment stays out (ADR 0008).

## Decision

A punch time has three sources, tried in order, and the UI names the one used:

1. **`anchor`**: an anchor on the word, or two bracketing it (`teleprompter.ResolveWordTime`, unchanged).
2. **`alignment`**: the word timed from the chapter's recording by a new sidecar mode,
   `live_asr.py --align-word N` (`sidecars/manuscript-teleprompter/core/align_word.py`). It takes the locate's own
   arguments and checks (`locate.check_args`, the same 120 s cap, `--model-dir` required, never a download), decodes
   the range with the same decoder, picks the best place with the locate's ranking, then maps each heard word to a
   script word with a longest-matching-blocks pass over that passage (the tracker's walk steps over at most two words,
   so a longer run the decoder dropped would lose it the rest of the range), with the tracker's fuzzy match between
   blocks. The word's time is the start the decoder gave it. A word the decoder dropped or misheard is placed between
   its heard neighbours at the range's own pace, after the pause when punctuation before it is the stronger pause
   point and before it otherwise. It prints one `word_time` line, seconds into the source file, or a null time when
   the word is not in the range.
   The host (`apps/desktop/teleprompterpunchalign.go`) chooses the range: the chapter's confident track (the resume
   prompt's match, `teleprompterlocate.go`), REAPER's live items when it answers for the selected project and the saved
   `.rpp` otherwise, the item holding the anchors' pace estimate (at most 120 s centred on it) or, with none, the last
   120 s of the item that ends last. It skips muted items, missing or unsupported sources and takes with stretch
   markers, runs nothing while REAPER records onto the track, and maps the answer back through the item's position,
   source offset and rate. `teleprompter.Service.AlignWord` refuses a time outside the decoded range. The last answer
   is kept (`punchAlignCache`) so the punch after its preview does not decode the same range again.
3. **`estimate`**: the anchors' pace extrapolation, only when the recording cannot answer (no confident track, nothing
   recorded, no Whisper model installed, a sidecar failure, or the word not in the range). With fewer than two anchors
   and no alignment the punch is refused, as before.

Measured on the LibriVox Alice corpus (ADR 0416), Kara Shallenberg's Chapter I, four 120 s ranges, with every fifth
reference word removed and every seventh garbled: every word the reference heard is timed, the median error is 0 and
the 95th percentile 0.13-0.22 s; the worst, a dropped word right after a pause, is 0.52-1.01 s
(`tests/test_align_word.py`, in CI with no audio, from the committed word timings). The same file has a gated test of
the real decode (the recording fetched with `build.py fetch` and a model in `NARRATION_WHISPER_MODEL_DIR`) against the
committed large-v3-turbo timings.

## Consequences

- Most punches past the last anchor land on the word as it was recorded, not on a guess, and a chapter recorded without
  the teleprompter's poll can still be punched into.
- The preview can take seconds (a model load and a decode of up to 120 s of audio, bounded by the locate's 3-minute
  timeout); the button shows it is pending. The interaction-feedback row now says `python`.
- A new sidecar argument crosses the trust boundary: `--align-word` takes an integer the host formats, and every other
  value is the locate's, with the locate's checks on both sides (threat model row 4a).
- Only one item is decoded. A word recorded in another item than the one the estimate points to, or before the
  estimate's item when there is no estimate, falls back to the estimate. A retake inside the range is timed at the
  reading the matching blocks pick, which is usually the first.
- The alignment's accuracy on a real narrator's own recording, and whether the time the decoder gives lines up with
  REAPER's play position as spike 1 will define it, are owner checks (on #510), with the manual REAPER checklist.
- Superseding this (a forced aligner, a per-word timing from Transcript Compare, a second item) needs a new ADR.
