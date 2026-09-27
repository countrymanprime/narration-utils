# 0327. DX-4 windowed findings need a chapter and paragraph anchor and a store scope before a consumer can gate on them

**Status:** Proposed
**Date:** 2026-09-27

## Context

[Proofing Preview Suggestion](../prds/proofing-preview-suggestion.prd.md) Phase 7 ("audio quality and performance signals") needs to know, per chapter, whether a windowed audio-quality finding (clipping, a level shift, room tone, a long pause) falls inside a suggested window, so a Sample candidate can be excluded or ranked down the same way Phase 5 already does for the RD-1 findings store's own findings (Q6, Q7).

Reading the delivered code (not the PRD's proposal text) for [diagnostics-delivery-and-cleanup-tools.prd.md](../prds/diagnostics-delivery-and-cleanup-tools.prd.md)'s Phase 4 (DX-4, delivered): `measure.Diagnose`/`DiagnoseFile` (`apps/desktop/internal/measure/diagnostics.go`) does produce a real windowed series (`Diagnostics.ShortTermLoudness`, `.Clipping`, `.LevelShifts`, `.Silences`, `.RoomTone`, `.Pacing`) and `Diagnostics.Findings()` (`apps/desktop/internal/measure/diagnosticfindings.go:34`) does turn it into `findings.Finding` records. But:

1. Every one of those findings carries only `Source.File` and a **source-file-relative** `TimeRange`; `Finding.Manuscript` is never set, so it has no `ChapterID` and no paragraph `Span` at all. `findings.Query`'s own `ChapterID` filter (and its store-side `matches` function) can never find one of these findings by chapter, because the field it filters on is absent.
2. The host binding that runs a diagnostics check (`apps/desktop/diagnostics_job.go`'s `startDiagnostics`/`runDiagnostics`/`complete`) keeps its result only in the in-memory `diagnosticsJob` for that one run's UI (the Diagnostics page's own job snapshot). It never calls `findings.Store.SaveAnalyzerFindings` (contrast [ADR 0322](0322-delivery-findings-are-saved-for-review-per-measured-file-versioned-by-the-audio-and-the-rules-bound.md), which did exactly this for delivery findings, the closest precedent). A restart, or simply not having the Diagnostics page open in this session, loses every DX-4 finding.

Both gaps predate this PRD's Phase 7 and are not this PRD's files to fix: `internal/measure` and `diagnostics_job.go` belong to the diagnostics-delivery-and-cleanup-tools PRD's own scope (and, on the agent-train's current lane map, to a different lane than this stream). Phase 7's own success metric ("0 candidates labelled audio-checked while a needed signal is stale, unmapped, **partial, failed or unavailable**") already has a tri-state answer for exactly this case - `unknown`, with a stated cause - so this PRD does not need to wait on the fix to ship a preview suggestion that is honest about what it could not check.

## Decision

1. Phase 7's audio-checked composition (`apps/desktop/internal/preview/audiochecked.go`) treats "windowed audio-quality findings for this chapter" as its own named signal, answered `unknown` with a stated, typed cause (`measurement_unavailable`-equivalent) whenever the caller has no persisted, chapter-anchored DX-4 result to give it - which is every real chapter today, since neither gap above is fixed. This is not a workaround pending a real answer: it is the same tri-state discipline (SR D2, [ADR 0015](0015-real-progress-only.md)) every other signal in this app already uses for a check that has not run, and it composes correctly the moment a caller does have a real answer (the composition is exercised by matrix tests with a constructed "met" and "not met" windowed-finding signal, not only "unknown").
2. This PRD does not modify `internal/measure` or `diagnostics_job.go` to add the missing anchor or persistence. That is real work (a `Manuscript`/`Span` field DX-4's own finding-building would need to fill in, plus a `SaveAnalyzerFindings` call analogous to ADR 0322's delivery-findings scope) that belongs to whichever stream next touches the diagnostics-delivery-and-cleanup-tools PRD or the Diagnostics page.
3. Flagged on [#510](https://github.com/countrymanprime/narration-utils/issues/510) for the owner's queue, not as a blocker: until it is done, a Sample preview candidate can never be excluded or ranked down for an open clipping/silence/level/pacing finding, only for the RD-1 categories Phase 5 already reads (which do carry a chapter, in TR-4's case, though never yet a paragraph). Phase 7 still reports every candidate honestly as "text only" rather than a false "audio-checked".

## Consequences

- Phase 7 ships a complete, tested composition rule now, rather than waiting on a cross-PRD, cross-lane fix.
- "Audio-checked" is unreachable in production today for a second, independent reason beyond Phase 6's own finding (no UI stamps a paragraph yet): this DX-4 signal is also always `unknown`. Both are named honestly in a candidate's evidence text rather than silently assumed clean.
- Whoever later adds the anchor and the store scope to DX-4's findings needs no further change on this PRD's side: `ChapterAudioEvidence.WindowedFindings` (`internal/preview/audiochecked.go`) already accepts real, chapter-anchored findings in the same plain shape (`ParagraphFinding`) Phase 5's `OpenFinding` uses, and the binding wiring (`bindings_preview.go`) only needs a real reader added where it currently has none to give.
