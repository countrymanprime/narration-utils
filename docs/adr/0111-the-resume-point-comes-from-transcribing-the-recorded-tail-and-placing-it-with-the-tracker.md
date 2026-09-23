# 0111. The resume point comes from transcribing the recorded tail and placing it with the tracker

**Status:** Proposed
**Date:** 2026-09-23

## Context

`docs/prds/teleprompter-manuscript-integration.prd.md` Phase 9 ("Tail-audio locate") turns what is already recorded
for a chapter into the word the narrator resumes from. Phase 8 ([ADR 0110](0110-one-go-chapter-to-track-matcher-ported-from-transcript-compare-with-explicit-confidence-states.md))
delivered the chapter's track and where its audio ends (`tracks.RecordedEnd`: project time, source file, time in that
file). The PRD's Decisions Log already chose how, as a prior decision: "Resume point: run the tracker over the tail
audio of the track", over "anchors from past live sessions", because it also works for audio that was not recorded
through the teleprompter (most of it: a narrator who reads from paper, a take from before this feature, a pickup
session). What that decision left open:

- how much audio, from where in the source file, and what a tail shorter than that means;
- how a tail with no anchor is placed, since the live tracker's `locate()` only searches 40 words back and 30 ahead
  of where it already is;
- what "reports low confidence on the repeated-passage fixture" means in numbers, and what the accuracy target is;
- how this reaches the sidecar and the UI without a model download (the teleprompter's first-use gate) and without
  forced alignment ([ADR 0008](0008-timing-confidence-over-forced-alignment-model-for-transcript-compare.md)).

## Decision

1. **Anchors from past sessions are not used.** They exist only for audio recorded through a live session, would need
   a store kept in step with every later edit of the take, and Phase 12 introduces live anchors for punch-in, not for
   resume. The tail is the one source that describes what is actually on the track.
2. **The tail is the last 30 seconds of the last audible item, never before the item's own start.**
   `teleprompter.DefaultTailSeconds` (30 s, about 70 words of narration) is enough to tell a passage the chapter
   repeats from the one the narrator stopped in, and decodes in about a second with the tiny model. The range is
   `[max(sourceStart, sourceTime - 30), sourceTime]` in seconds of the source file, where `tracks.RecordedEnd` gains
   `sourceStart` (the SECTION start + SOFFS), so the cut never reaches audio the narrator trimmed off the item. A
   last item shorter than 30 s gives a shorter tail; only that item is read (earlier items may be in other files).
3. **Placement is in two steps, both the tracker's own code** (`sidecars/manuscript-teleprompter/core/locate.py`).
   First every script position a heard word matches is tried as a start with `script_tracker.advance` (the step the
   live tracker aligns with), and the alignments are ranked by words matched. Then `ScriptTracker` itself is run over
   the heard words from the best start, fed in 8-word segments: this is what turns a retake of the last sentence into
   a "restart" instead of a few stray matches ahead (a single forward alignment resumed three words too late on the
   recorded retake). The resume `word` is where the tracker ends, in `script_words()` indices, the space of a
   position event's `read`; `sentence` is the sentence holding the last word placed, bounded by sentence ends and
   paragraph starts, for the narrator to confirm.
4. **Confidence is fit times distinctness.** `confidence = (heard words that are words of the placed passage / heard
   words) x (1 - runnerUp / matched)`, where `runnerUp` is the best alignment that does not overlap the chosen one. A
   tail wholly inside a passage the chapter repeats scores near 0; `confident` needs a score of at least 0.5 and at
   least 6 words matched. Fewer than 3 matched words (the tracker's own bar for a jump) is no place at all
   (`word: null`). The resume point is always shown with its sentence for confirmation (PRD risk table); confidence
   decides whether the UI offers it as the answer or as a guess.
5. **Accuracy target, measured on recorded tails.** `spikes/record_locate_tails.py` speaks Chapter I of Alice
   (`tests/fixtures/alice.md`) with the app's Piper voice up to a known word, with the twist of each case (stopped at
   a sentence end, mid-sentence, a retake, a filler and false start, 40 words in, the chapter's end, an 8-second last
   item, a passage the chapter repeats with a 15 s and a 60 s tail), cuts the tail with the same `read_audio_range`
   and transcribes it with the tiny Whisper model through `live_asr.make_decoder(vad_filter=True)`. What Whisper
   heard is committed (`tests/fixtures/teleprompter-locate/tails.json`), not the audio. The target, enforced by
   `test_locate.py`: every placeable tail resumes within 2 words of the truth and is confident, and the repeated
   passage is not confident (score below 0.1). Measured: 7 of 8 placeable tails exact, the eighth one word early
   (Whisper dropped the last word), scores 0.63 to 0.89; the repeated passage 0.0.
6. **It is one more mode of the teleprompter sidecar, run synchronously.** `live_asr.py --locate --wav FILE
   --tail-start S --tail-end E --manuscript M --chapter C --model-dir D` prints one `{"type": "locate", ...}` line and
   exits; `live_asr.py` only wires the arguments. `--model-dir` is required (the sidecar never downloads a model), the
   engine is Whisper only, and the range is refused unless `0 <= S < E` and `E - S <= 120`. The Go side
   (`internal/teleprompter.Service.Locate`) validates the same things before any process starts (the audio must be an
   existing file named by an absolute path), runs it with `Supervisor.Run` under a 3-minute deadline, and accepts only
   a `locate` line whose word and sentence lie inside the chapter.
7. **One binding answers every state.** `Host.TeleprompterLocate(chapterID, trackGUID, model)` (host API 32) returns
   a status (`found`, `low_confidence`, `not_found`, `no_track`, `no_recording`, `source_missing`,
   `source_unsupported`) with the chapter's full track match, the track read, its recorded end, the tail range and the
   sidecar's result, or the Whisper first-use gate's `asset_required`. The model is checked only once there is audio
   to read, so a chapter with no track never asks for a download. An uncertain or ambiguous match is `no_track`: it
   never guesses; the narrator's pick (`trackGUID`, any track of the selected project) is read instead. No UI calls it
   yet (Phase 10 is the resume card).

## Consequences

- The resume point is "as of the .rpp's last save" (Phase 8): a take REAPER holds unsaved is not seen until Phase 11
  reads live REAPER state. Phase 10 labels it.
- A recording that ends in a long ad-lib, or a track whose last item holds another chapter, places poorly or not at
  all; that shows as low confidence or `not_found`, and the narrator picks a word (Phase 10's "Pick a word").
- Only the last item is read. A chapter whose last item is a few-second pickup gets a short tail and lower
  confidence (the 8-second fixture still scores 0.63); reading back across items is a later change if real use needs it.
- The fixtures measure recognition of a synthetic voice, not a human narrator's pacing, accent or room; a real reading
  is still a manual check, and the recorded tails should be extended with real ones when a narrator's recording can be
  committed.
- The tracker's constants (`MAX_SKIP`, `BACK_WORDS`, `JUMP_MARGIN`) now shape the resume point too: a change to them
  re-runs `test_locate.py` against the recorded tails, which is the point.
- The sidecar gains a second one-shot mode beside `--list-devices`, with the same exit-status and stderr contract the
  host already reads for it; the threat model's row 4a covers the new arguments.
