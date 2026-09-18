# Transcript Compare

**Status: Implemented; dashboard integration planned.**

## Current capability and problem

The current local Faster-Whisper backend stitches a selected REAPER chapter track, matches it to a Word heading, and transcribes it for misreads, skipped words, and extras. It saves a unified diff and supports custom equivalences, hotwords, chunking, cancellation, and model selection. It finds likely read errors without a cloud service.

## Target workflow

Select a chapter track, confirm its manuscript mapping and settings, run comparison, review each discrepancy and any existing matching markers, then explicitly select **Export markers** to add only new take markers.

## Inputs and outputs

- Inputs: REAPER item manifest, chapter-track name, canonical manuscript JSON, local model configuration, hotwords, and equivalence lists.
- Outputs: current marker protocol and diff files; planned structured transcript-discrepancy findings.
- Narrator actions: select chapter, set recognition controls, add reviewed equivalences, navigate/loop findings, explicitly export new markers, and accept/dismiss/defer them.

## Alignment and confidence

Discrepancy detection transcribes freely (Faster-Whisper, with word-level timestamps) and then diffs the transcript against the manuscript text — it does not align the manuscript directly to the audio. As of this change, each marker also carries a `confidence` label (`high`/`medium`/`low`/`unknown`) and the raw `timing_gap_seconds` it was derived from: the audio-timing gap at the discrepancy's boundary, reusing the same natural-pause threshold already used to split audio into sentences. A tight/no-gap boundary is weaker evidence that a flagged discrepancy is a genuine misread/skip/insertion rather than a token-split artifact of the diff itself. This is a secondary, transparent signal only — not proof either way, same as ASR confidence itself (see Acceptance and risks below). Backend-only for now: the two new marker fields are written and parsed but not yet surfaced in the REAPER UI.

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
- Tests cover invented names, homophones, numbers, partial recordings, title reads, chunk seams, and stale item mappings.
- Main risk: ASR confidence is not proof of a spoken error; UI language must retain that distinction.
