# Transcript Compare

**Status: Implemented; dashboard integration planned.**

## Current capability and problem

The current local Faster-Whisper backend stitches a selected REAPER chapter track, matches it to a Word heading, and transcribes it for misreads, skipped words, and extras. It saves a unified diff and supports custom equivalences, hotwords, chunking, cancellation, and model selection. It finds likely read errors without a cloud service.

## Target workflow

Select a chapter track, confirm its manuscript mapping and settings, run comparison, review each discrepancy and any existing matching markers, then explicitly select **Export markers** to add only new take markers.

## Inputs and outputs

- Inputs: REAPER item manifest, chapter-track name, canonical manuscript JSON, local model configuration, hotwords, and equivalence lists.
- Whisper model provisioning: the selected model (`config/whisper-assets.json`) is a catalog-managed, hash-verified local asset installed through the same first-use gate as Piper preview voices — see [First-Use Dependency Provisioning](../architecture/first-use-dependency-provisioning.md). Starting a comparison with a model that is not yet installed prompts to download it before anything runs; it no longer relies on `faster-whisper`'s own implicit, unverified download.
- Outputs: current marker protocol and diff files; planned structured transcript-discrepancy findings.
- Narrator actions: select chapter, set recognition controls, add reviewed equivalences, navigate/loop findings, explicitly export new markers, and accept/dismiss/defer them.

## Alignment and confidence

Discrepancy detection transcribes freely (Faster-Whisper, with word-level timestamps) and then diffs the transcript against the manuscript text — it does not align the manuscript directly to the audio. As of this change, each marker also carries a `confidence` label (`high`/`medium`/`low`/`unknown`) and the raw `timing_gap_seconds` it was derived from: the audio-timing gap at the discrepancy's boundary, reusing the same natural-pause threshold already used to split audio into sentences. A tight/no-gap boundary is weaker evidence that a flagged discrepancy is a genuine misread/skip/insertion rather than a token-split artifact of the diff itself. This is a secondary, transparent signal only — not proof either way, same as ASR confidence itself (see Acceptance and risks below). Backend-only for now: the two new marker fields are written and parsed but not yet surfaced in the REAPER UI.

Recording coverage ([PRD](../prds/recording-coverage-analysis.prd.md)) reads this same alignment to tell how much of a chapter was read in order, including the unread head and tail that the markers ignore. The model is `core/recording_coverage.py`, and `compare.py --coverage` runs it for one chapter over a JSON manifest of the track's items, keeping one words file per item so a later check transcribes only what changed ([ADR 0127](../adr/0127-the-coverage-sidecar-mode-reads-a-json-manifest-keeps-one-words-file-per-item-and-writes-tagged-json-lines.md)). The app does not start it yet: the Go service is Phase 4 of the PRD. The Phase 2 spike compared this `SequenceMatcher` alignment with a word-level DP on the synthetic fixtures and kept `SequenceMatcher`: no false "met" and no false "not met" on 16 committed and 104 generated cases. The table is in [the spike note](../research/recording-coverage-alignment-spike.md), and the decision is [ADR 0126](../adr/0126-recording-coverage-reads-the-take-markers-sequencematcher-alignment-and-folds-chance-matches-into-gaps.md).

A heavier alternative — true forced alignment (aligning the manuscript directly to audio via a CTC/wav2vec2 model, e.g. WhisperX's approach) — was evaluated and deliberately deferred; it would be this project's first PyTorch dependency. See [ADR 0008](../adr/0008-timing-confidence-over-forced-alignment-model-for-transcript-compare.md).

## Planned features

### MVP enhancements

- Emit the shared finding contract in parallel with the existing marker protocol.
- Persist finding review state and narrator notes in a project sidecar.
- Surface the new `confidence`/`timing_gap_seconds` marker fields in the REAPER UI, with controls to suppress low-value false positives.
- Consume approved Manuscript Guide pronunciation/hotword exports through an explicit import action.

### Later work

- True forced alignment (manuscript-to-audio, CTC/wav2vec2-based) if the timing-confidence signal above proves insufficient in real usage — see ADR 0008.
- A comparison summary by chapter, error category, and unresolved count.
- Optional analysis of a selected take rather than only the assembled active timeline.

## Non-goals and review boundary

The transcript is not the authoritative performance record. The utility does not correct text, choose a take, or create markers for unrecorded chapter material. Analysis never writes markers automatically: it labels a result as already marked when a same-kind prefix occurs on the active take within 0.15 seconds, and the explicit export action skips those rows. It rechecks immediately before adding a marker and reports how many were added or skipped.

## Acceptance and risks

- Each existing marker becomes one navigable finding with the same text evidence.
- Re-runs do not duplicate equivalent unresolved findings or erase review history when audio is unchanged.
- Tests (`sidecars/transcript-compare/tests/`, `libs/python/tests/test_transcript_compare.py`) cover: homophones, spoken numbers and split compounds producing no marker; an invented name spelled another way being a misread until a custom equivalence is added; a partial recording marking no skips outside the recorded span, while a skip inside it is marked; a spoken or omitted title producing no marker; the reference-section filter; marker timing confidence; marker context; repeated-span detection; property tests for tokenizing, number merging and sentence splitting; and the exact markers for every recording-coverage fixture, held by a golden file. Chunk seams (`transcribe_chunked`) and stale item mappings have no tests yet.
- Main risk: ASR confidence is not proof of a spoken error; UI language must retain that distinction.
