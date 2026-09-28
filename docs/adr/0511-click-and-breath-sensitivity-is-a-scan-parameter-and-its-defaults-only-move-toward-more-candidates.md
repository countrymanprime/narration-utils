# 0511. Click and breath sensitivity is a scan parameter, and its defaults only move toward more candidates

**Status:** Proposed (editing-readiness-analysis PRD Phase 4, stream N-K11; provisional per D70 until the permissioned re-run on #510)
**Date:** 2026-09-28
**Supersedes:** none

## Context

The PRD's Phase 4 asks for three things:

- decide whether click and breath sensitivity is a read-time filter or an analysis parameter;
- choose conservative defaults on the tuning half;
- persist the click and breath results so the signals can use them.

The PRD's Architecture Notes allow a read-time filter only "if Phase 4 finds scores separate cleanly". DX Phase 9's
detectors emit fixed confidences (0.35, 0.5, 0.6), not a continuous score. The app passes no scan options, so every
scan used DX's `measure.DefaultCleanupOptions()`. Phase 5 wrote click and breath ledger records but persisted only
empty-space findings. A validated class signal would therefore have read `met` with its candidates unsaved.

## Decision

1. **Sensitivity is a scan parameter**, part of the parameter hash in `scanParamHash`. Changing it re-decodes, as
   before. There is no score to filter on at read time.
2. **Defaults are chosen on the tuning half by a recall-first rule**, recorded in `validationrun_test.go`:
   1. the highest recall;
   2. then only values at least as sensitive as DX's default;
   3. then the highest precision;
   4. then the value nearest DX's default.

   A precision gain measured on synthetic audio is never traded for fewer candidates on real audio.
   `editing.DefaultScanOptions()` is the result: DX's defaults with `BreathBelowSpeechDB` 8 (DX ships 12, which missed
   loud breaths). `TestShippedDefaultsAreTheTuningHalfChoice` keeps it equal to the rule's choice.
3. **Click and breath candidates are persisted** as `silence_cleanup` findings (`ClassCandidateFinding`). Each carries
   its project time, source range and class analyzer version. Its evidence version covers the source file, class and
   source range only (Q7).

## Consequences

- The editing check panel now lists click and breath candidates. Breath candidates are more numerous than at DX's 12 dB.
  Each is still review-only.
- The first scan after this change re-decodes every item: the parameter hash and the cache version both changed, and
  the old records read stale ("the editing check settings changed").
- DX-9's own findings view keeps DX's defaults. Only the editing check uses the Phase 4 defaults.
- A later continuous detector score could make a read-time filter possible. That needs a new ADR and a new run.
