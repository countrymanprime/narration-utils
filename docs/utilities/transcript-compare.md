# Transcript Compare

**Status: Implemented; dashboard integration planned.**

## Current capability and problem

The current local Faster-Whisper backend stitches a selected REAPER chapter track, matches it to a Word heading, transcribes it, and creates take markers for misreads, skipped words, and extras. It saves a unified diff and supports custom equivalences, hotwords, chunking, cancellation, and model selection. It finds likely read errors without a cloud service.

## Target workflow

Select a chapter track, confirm its manuscript mapping and settings, run comparison, listen to marker locations, then record a review decision for each discrepancy.

## Inputs and outputs

- Inputs: REAPER item manifest, chapter-track name, `Manuscript.docx`, local model configuration, hotwords, and equivalence lists.
- Outputs: current marker protocol and diff files; planned structured transcript-discrepancy findings.
- Narrator actions: select chapter, set recognition controls, add reviewed equivalences, navigate/loop findings, and accept/dismiss/defer them.

## Planned features

### MVP enhancements

- Emit the shared finding contract in parallel with the existing marker protocol.
- Persist finding review state and narrator notes in a project sidecar.
- Add transparent confidence/reason fields and controls to suppress low-value false positives.
- Consume approved Manuscript Guide pronunciation/hotword exports through an explicit import action.

### Later work

- Better phrase-level and punctuation-aware alignment.
- A comparison summary by chapter, error category, and unresolved count.
- Optional analysis of a selected take rather than only the assembled active timeline.

## Non-goals and review boundary

The transcript is not the authoritative performance record. The utility does not correct text, choose a take, or create markers for unrecorded chapter material.

## Acceptance and risks

- Each existing marker becomes one navigable finding with the same text evidence.
- Re-runs do not duplicate equivalent unresolved findings or erase review history when audio is unchanged.
- Tests cover invented names, homophones, numbers, partial recordings, title reads, chunk seams, and stale item mappings.
- Main risk: ASR confidence is not proof of a spoken error; UI language must retain that distinction.
