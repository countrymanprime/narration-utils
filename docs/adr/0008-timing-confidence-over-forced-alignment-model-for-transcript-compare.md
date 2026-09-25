# 0008. Timing-confidence signal over a forced-alignment model for Transcript Compare, for now

- **Status:** Accepted
- **Date:** 2026-09-17

## Context and problem

Transcript Compare's discrepancy detection transcribes a recording freely with Faster-Whisper, then diffs that transcript's tokens against the manuscript's tokens using `difflib.SequenceMatcher` (`diff_and_build_markers()` in `tools/transcript-compare/core/compare.py`). This diffs two independently-generated text streams rather than aligning the *known* manuscript text directly to the audio, which research into the state of the art flagged as structurally weaker at localizing skips and insertions than true forced alignment (e.g. WhisperX's wav2vec2/CTC alignment step, Montreal Forced Aligner).

While planning the upgrade, reading the actual codebase surfaced a constraint the original framing missed: this repo has zero PyTorch dependency anywhere (confirmed against `uv.lock`) — its only ML runtime is `ctranslate2` (Faster-Whisper's backend), a materially lighter footprint than PyTorch. The two Python tools are packaged as PyInstaller-frozen sidecars (`shell/app.go`'s `sidecarPath` wiring). WhisperX-style forced alignment needs `torch` + `torchaudio`; Montreal Forced Aligner needs Kaldi via conda. Either would be this project's first heavy ML dependency, with real costs to sidecar size, build time, and a new first-run model download — not a drop-in swap.

## Decision drivers

- The repo has zero PyTorch dependency; its only ML runtime is `ctranslate2`, a materially lighter footprint.
- A heavy ML dependency has real costs to sidecar size, build time, and a new first-run model download.
- Free-transcribe-then-diff is structurally weaker at localizing skips and insertions than true forced alignment.
- The marker output contract should change additively, without changing which markers are produced.

## Considered options

1. Keep free-transcribe-then-diff and add a per-marker timing-confidence signal from Faster-Whisper's word timestamps
2. WhisperX-style forced alignment (wav2vec2/CTC)
3. Montreal Forced Aligner

## Decision outcome

**Chosen option: keep free-transcribe-then-diff and add a per-marker timing-confidence signal from Faster-Whisper's word timestamps**, because it uses data the tool already had and avoids the project's first heavy ML dependency and its sidecar-size cost.

For this pass, `tools/transcript-compare/core/compare.py` keeps the existing free-transcribe-then-diff approach and instead adds a transparent per-marker confidence signal computed from data it already had: Faster-Whisper's word-level timestamps. Two new helpers, `_boundary_gap_seconds()` and `_marker_timing_confidence()`, measure the audio-timing gap at each discrepancy's boundary and label it `high`/`medium`/`low`/`unknown`, reusing the file's existing `PAUSE_GAP_SECONDS` (0.6s, already used to split audio into sentences on a natural pause) plus a new `TIGHT_GAP_SECONDS` (0.05s) constant. A tight/no-gap boundary is weaker evidence that a flagged discrepancy is a genuine misread/skip/insertion rather than a token-split artifact of the diff itself.

This is additive to the existing `MARKER|` pipe-delimited output contract: `confidence` and `timing_gap_seconds` are appended as two new trailing fields, changing nothing about which markers are produced. `shared/reaper/narration_ui_bridge.lua`'s two `pipe_fields(body, 10)` call sites (in `inspect_results()` and `export_results()`) were bumped to `pipe_fields(body, 12)` — without this, the trailing fields would have been silently absorbed into the `audio_context` field, corrupting it. The new fields are parsed by the Lua bridge but not yet forwarded into the `COMPARE_MARKER` event or surfaced in the REAPER UI; `tools/transcript-compare/core/tests/test_compare.py` and `shared/python/tests/test_transcript_compare.py` were updated for the marker tuple's new shape, and `tools/transcript-compare/core/tests/test_compare.py` gained direct coverage of the new confidence thresholds.

True forced alignment (aligning the manuscript directly to audio via a CTC/wav2vec2 model) remains a documented, deliberately deferred option — see `docs/utilities/transcript-compare.md`'s "Alignment and confidence" section — gated on the timing-confidence heuristic proving insufficient in real usage (measured by false-positive/negative rate against real recordings), given the PyTorch dependency and sidecar-size cost it would add.

### Consequences

- **Good:** Reviewers/narrators get a transparent, low-value-flag-suppressing signal (confidence/timing gap) without the project taking on its first PyTorch dependency or a heavier PyInstaller sidecar.
- **Bad:** The underlying alignment technique is unchanged: this does not fix cases where `SequenceMatcher` picks a poor alignment among repeated/common words or homophones — it only annotates the markers that approach already produces. Real forced alignment would still catch cases this heuristic cannot.
- **Neutral:** The confidence/timing-gap fields exist in the marker contract and the Lua parser today but are not yet visible in the REAPER UI — a future change adding that UI surface must not re-litigate the field count/shape decided here.
- **Neutral:** If a future change wants true forced alignment (Phase 2), it must write a new ADR superseding this one, and should bring evidence (false-positive/negative rate data) that the timing-confidence heuristic here is insufficient, per the gating condition stated above.

### Confirmation

`tools/transcript-compare/core/tests/test_compare.py` has direct coverage of the confidence thresholds, and it and `shared/python/tests/test_transcript_compare.py` cover the marker tuple's shape. Moving to true forced alignment is gated on false-positive/negative rate data from real recordings showing the heuristic is insufficient.

## Pros and cons of the options

### WhisperX-style forced alignment

- Good, because aligning the known manuscript directly to the audio is structurally stronger at localizing skips and insertions, and would catch cases the heuristic cannot.
- Bad, because it needs `torch` + `torchaudio`, the project's first heavy ML dependency, with costs to sidecar size, build time, and a new first-run model download.

### Montreal Forced Aligner

- Good, because aligning the known manuscript directly to the audio is structurally stronger at localizing skips and insertions.
- Bad, because it needs Kaldi via conda, the project's first heavy ML dependency, with costs to sidecar size, build time, and a new first-run model download.
