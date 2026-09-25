# 0238. Silence cleanup candidates are classed in the diagnostics pass and raised apart from the diagnostics findings

- **Status:** Proposed
- **Date:** 2026-09-25

## Context and problem

[Diagnostics, Delivery Reports and Cleanup Tools](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) Phase 9 asks for a silence cleanup analyzer. It classes candidates as silence, breath or click, with a conservative confidence and a split-plus-trim suggested action that runs only on approval. It uses narrator thresholds, and it must share the silence detector with the windowed diagnostics ([ADR 0158](0158-windowed-diagnostics-are-one-read-pass-with-fixed-windows-narrator-thresholds-and-candidate-findings.md)) rather than run a second one. Its fixtures are a breath after a plosive, a click inside silence and a long dramatic pause near the threshold. The PRD accepts that a breath and a soft consonant onset will sometimes be confused, and leaves that to the approval gate. The Diagnostics tab lists every finding of `Diagnostics.Findings`, and a chapter has hundreds of pauses.

## Decision drivers

- Phase 9 asks for an analyzer that classes silence, breath and click with a conservative confidence and a split-plus-trim action that runs only on approval, on narrator thresholds.
- It must share the silence detector with the windowed diagnostics rather than run a second one.
- The PRD accepts that a breath and a soft consonant onset will sometimes be confused, and leaves that to the approval gate.
- The Diagnostics tab lists every finding, and a chapter has hundreds of pauses.

## Considered options

1. Class candidates in the diagnostics pass and raise them apart from `Diagnostics.Findings`
2. Run a second silence detector for cleanup
3. Raise cleanup candidates with the other diagnostics

## Decision outcome

**Chosen option: class candidates in the diagnostics pass and raise them apart from `Diagnostics.Findings`**, because the analyzer must share the silence detector with the windowed diagnostics, and the Diagnostics tab lists every finding while a chapter has hundreds of pauses.

1. The classifier runs inside `measure.Diagnose`'s one read pass (`apps/desktop/internal/measure/cleanup.go`), into `Diagnostics.Cleanup`:
   - **Silence** is a region of the silence map (the diagnostics floor and minimum silence). The candidate cut is the region less a hold at each side (`pad_seconds`, 0.15 s by default). A region with nothing left to cut is no candidate.
   - **Breath** is a run of 10 ms windows above the silence floor but at least `breath_below_speech_db` (12 dB) below the read's speech level (the 90th percentile of the windows above the floor, needing at least 50 of them). The run lasts `min_breath_seconds` to `max_breath_seconds` (0.12 to 0.9 s), and its zero-crossing rate is 0.2 or more (noise-like, not voiced). It is cut whole.
   - **Click** is a burst of at most three 10 ms windows with five silent windows on each side, whose peak stands `click_above_silence_db` (30 dB) above that silence. A plosive has speech beside it, so it is never a click.
2. Confidence is conservative and says why:
   - 0.3 for a silence of 2 s or more (it may be meant) or one whose level is within 3 dB of the floor (a marginal call);
   - 0.35, or 0.5 when strongly noise-like, for a breath;
   - 0.6 for a click or an ordinary silence;
   - 0.8 for digital silence.
3. `Diagnostics.CleanupFindings` raises each candidate as an info `silence_cleanup` finding. The evidence carries its class, level, thresholds and source kind; the id is the file, `silence_cleanup_<class>` and the start millisecond. The suggested action is `{kind: "split_and_trim", parameters: {class, cut_start_seconds, cut_end_seconds}, requires_confirmation: true}`, in source-file seconds. `Diagnostics.Findings` does not include them, so the Diagnostics tab is unchanged until a caller lists cleanup where the narrator asked for it.
4. The thresholds are `DiagnosticInput.Cleanup` (`measure.CleanupOptions`); unset means the defaults above, and each is validated. The settings keys and saved presets in the layered store, and running `CleanupFindings` in the diagnostics job, are the host's (lane A). The list is the UI's (lane C). Nothing here edits audio or REAPER: applying a cut belongs to the REAPER actions of PRD Phases 10 and 11, behind their verification.

### Consequences

- **Neutral:** Cleanup and the diagnostics cannot disagree about what is silent, and cleanup adds no second read of the file. The cost is one more meter in the pass and about 16 bytes per 10 ms window held until the end (about 6 MB for an hour).
- **Neutral:** Zero crossings stand in for spectral shape: no FFT, and a soft "s" or "f" can read as a breath (confidence at most 0.5, and never cut without approval). A breath quieter than the silence floor is silence, not a breath.
- **Neutral:** The finding shape and the `split_and_trim` action are the contract the UI list and the future REAPER action will read. Changing them needs a new ADR and the findings contract kept in step.
- **Neutral:** Superseding this needs a new ADR, for example to add spectral features or to raise cleanup candidates with the other diagnostics.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Run a second silence detector for cleanup

- Bad, because cleanup and the diagnostics could then disagree about what is silent, and the file would be read twice.

### Raise cleanup candidates with the other diagnostics

- Bad, because the Diagnostics tab lists every finding, and a chapter has hundreds of pauses.
