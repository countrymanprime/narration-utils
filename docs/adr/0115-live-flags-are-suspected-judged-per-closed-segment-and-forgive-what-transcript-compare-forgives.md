# 0115. Live flags are suspected, judged per closed segment, and forgive what Transcript Compare forgives

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

`docs/prds/teleprompter-manuscript-integration.prd.md` Phase 6 asks the teleprompter sidecar to report suspected misreads,
extra words, skipped words and (owner decision 2026-09-23) restarts, with precision over recall, as engine-independent
events ([ADR 0021](0021-live-speech-engines-behind-one-event-contract.md)), and leaves three design points to the phase:
whether the flag normalization shares Transcript Compare's number-word merge and homophone canon or duplicates a subset,
whether the host's `teleprompter:state` snapshot keeps flags, and which findings category a restart flag is persisted under
in Phase 7 (`Validate` rejects unknown categories). The script tracker (`script_tracker.py`) already aligns heard words with
the script but deliberately ignores what does not fit. A live word is never proof: a wrong engine word looks exactly like a
misread, and Transcript Compare over the recorded take is authoritative.

Measured while building this (Whisper tiny, the host default, over Piper speech of four passages, see the PRD's Phase 6
evidence): most false flags on clean reads were the engine's own errors, and two kinds were artefacts that text alone could
not tell from a narrator's mistake: the engine re-emitting the same audio's words (up to six words, identical timestamps)
and splitting one written word across a matched neighbour ("7 o" + "clock" for "seven o'clock").

## Decision drivers

- Precision over recall, as engine-independent events (ADR 0021).
- A live word is never proof: a wrong engine word looks exactly like a misread, and Transcript Compare over the recorded take is authoritative.
- Most false flags on clean reads were the engine's own errors, and re-emitted and split words were artefacts that text alone could not tell from a narrator's mistake.
- `Validate` rejects unknown findings categories.

## Considered options

1. Suspected flags judged per closed segment, with normalization shared with Transcript Compare
2. Duplicating a subset of Transcript Compare's normalization
3. Keeping flags in the host's `teleprompter:state` snapshot

## Decision outcome

**Chosen option: suspected flags judged per closed segment, with normalization shared with Transcript Compare**, because a live word is never proof, so precision is kept over recall, and a shared normalization makes a live flag and Transcript Compare forgive the same spellings.

1. A new `flag` event joins the stream: `{"type": "flag", "id", "kind", "start", "end", "heard"}` with `kind` one of
   `misread`, `extra`, `skipped`, `restart`; `start`/`end` are `script_words()` indices (an `extra` is zero-width at the
   word after the inserted words); `id` counts a session's flags from 1. `sidecars/manuscript-teleprompter/core/flags.py`
   produces it: `FlaggingTracker` wraps `ScriptTracker`, which now hands over each closed segment (`SegmentReading`: the
   confirmed words, their engine text and times, the anchor and the final `Location`, which also names the start and first
   match of the alignment it chose), and `segment_flags` walks `align()` over it. Flags are only ever suspected.
2. Precision gates: confirmed words only, judged when the segment closes; a discrepancy only between two matched script
   words, never among a segment's first two words or at its ragged edges; not when the heard run says the written words
   in other spelling (`spoken_key` equality, the tracker's own 0.8 spelling tolerance on the run, or the run joined with a
   matched neighbour); not a hesitation as an extra, a single dropped article as a skip, a re-read shorter than three
   words as a restart, a misread of more than three heard words, a skip-ahead with anything heard in place of the skipped
   words, or a gap whose first word starts before the matched word ahead of it ended (engine times are used only to
   withhold a flag, never to raise one, consistent with ADR 0021). A tracker jump on confirmed words is otherwise flagged
   as it stands; a seek is never flagged.
3. Normalization is shared, not duplicated: `NUMBER_WORDS`, `FILLER_WORDS`, the built-in homophone groups, the quote
   fold, `canonical_tokens` and `merge_number_words` move to `libs/python/narration_common/spoken_forms.py` as Python data,
   and `sidecars/transcript-compare/core/compare.py` imports them (its tokenizer is unchanged, pinned by a test).
   `core/homophones.csv` is deleted: a data file next to a script is not bundled by the PyInstaller freeze, so the frozen
   Transcript Compare could not load it; an imported module always is.
4. The Go relay is unchanged and the snapshot keeps no flags. Phase 7 persists each flag as a finding, and that store is
   what a view opened mid-session reads, so a bounded flag list in the snapshot would be a second copy.
5. Findings mapping for Phase 7: `misread`, `extra` and `skipped` are category `transcript_discrepancy`; `restart` is
   category `pickup` with `evidence.kind` `restart`, the mapping take review already uses
   (`apps/desktop/internal/repeats`). `flags.FINDING_CATEGORIES` records it.
6. `replay.py` measures it: it replays a Moonshine probe recording or a printed `live_asr.py` session (`--stream`)
   through `FlaggingTracker` and reports flags per 100 heard words by kind, the false-flag rate on a clean read.

### Consequences

- **Good:** The UI can show or hide each kind (skipped and misread by default, extra behind a toggle, per the owner) without the
  sidecar changing; no engine-specific flag logic exists.
- **Neutral:** A live flag and Transcript Compare forgive the same spellings, and a new homophone added in one place reaches both.
  Editing the homophone list is now a code change in `spoken_forms.py` rather than a CSV edit.
- **Bad:** Recall is given up on purpose: short restarts, engine-dropped articles, discrepancies at segment edges and anything a
  spelling difference could explain are never flagged. The measured clean-read rate with Whisper tiny over synthetic
  speech (2,852 heard words: `misread` 2.07, `skipped` 0.42, `restart` 0.04, `extra` 0.00 per 100; 41 of 44 planted
  errors flagged) is mostly real engine mishearings, which no text rule can remove; Phase 7 should hold a kind off by default while its measured
  rate misses the PRD target, and human microphone readings are still owed.
- **Neutral:** A flag arrives up to one segment late (a pause or the 12 s buffer cap), which is acceptable for review marks and not
  meant for anything that must react mid-sentence.
- **Neutral:** Changing the event shape, the gates' meaning, the shared normalization home or the restart category needs a new ADR
  that supersedes this one.

### Confirmation

`replay.py` measures flags per 100 heard words by kind, the false-flag rate on a clean read; a test pins Transcript Compare's tokenizer as unchanged.

## Pros and cons of the options

### Shared normalization

- Good, because a new homophone added in one place reaches both.
- Bad, because editing the homophone list is now a code change in `spoken_forms.py` rather than a CSV edit.

### Keeping flags in the snapshot

- Bad, because the findings store is what a view opened mid-session reads, so a bounded flag list in the snapshot would be a second copy.
