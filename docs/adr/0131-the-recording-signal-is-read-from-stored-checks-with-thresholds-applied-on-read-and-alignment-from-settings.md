# 0131. The recording signal is read from stored checks, with thresholds applied on read and the alignment taken from settings

**Status:** Proposed
**Date:** 2026-09-23

## Context

Phase 7 of `docs/prds/recording-coverage-analysis.prd.md` gives the stage recommendations engine
([ADR 0160](0160-stage-recommendations-are-computed-from-tri-state-signals-by-a-pure-engine.md)) its `recording` signal, and
moves the four numbers of Q3 into settings. The PRD fixes the tri-state rule (D2: `unknown` is never `met`), that a
confirmed mapping is an input (D5), that thresholds are applied in Go on read (a change never re-runs ASR), and that a
different model or language keeps a result current while different alignment parameters make it stale (Q13). Some things
were left open:

- The signal's id, and how it maps the coverage service's refusal and staleness words to the contract's ten causes.
- What a partial or failed run newer than a current complete one means.
- Where the settings live, and how the start and the read of a check (Phase 5 used `DefaultAlignmentParams` in both)
  stay in step.
- What `not_met` names when several things fail.

## Decision

- **One signal, `recording.text_present`,** from `coverage.RecordingSignal(SignalInput)`, a pure function (no file, no
  clock) over the result reader's answer, the chapter's newest coverage ledger record, whether a check of it is running,
  why a check cannot run here (for example the model is not installed), whether an unconfirmed name match exists, the
  settings and a timestamp. `coverage.SignalProvider` is its `stages.Provider`. It reads the shared, already parsed saved
  project from `EvidenceView` (`Service.ResultIn`) and never starts a check (Q14).
- **Causes, first match wins:** a result the reader could not evaluate maps to its cause: `unmapped` to `unmapped_track`,
  or to `unconfirmed_mapping` when an unlinked track has the chapter's title (the same exact-title rule as EL's
  `TitleSuggester`). `multiple_tracks` stays `multiple_tracks`. A missing linked track maps to `unmapped_track`, no or an
  unreadable project file to `project_unreadable`, and not a narration chapter to `measurement_unavailable`. Next, a running check of this
  chapter gives `analysis_running`. Without a current result, a check that cannot be run here gives
  `measurement_unavailable`. A newest record that is `partial` or `failed` gives `incomplete_run`. Otherwise `never` gives
  `never_analyzed`, `stale` gives `stale` with the reasons named, and only a current result is judged.
- **A newer incomplete run holds the signal at unknown** even when an older complete result is still current, as the
  contract's "the latest record is partial or failed" says. The Home dialog still shows that older result. The signal
  is the stricter of the two, and one more check resolves it.
- **Thresholds are applied on read.** `Report.TextComplete(Thresholds)` over the stored report: `met` when every
  paragraph passes, `not_met` otherwise, naming the largest region over the missing-run limit ("paragraph 2: 14 words not
  read"). With no such region it names the paragraph with the longest run over the limit, and then the paragraph with the
  smallest share read. Paragraphs are numbered from 1 within the chapter, as the Home check numbers them. Evidence is typed
  `coverage`, `region` (largest first, with paragraph ids and the source time), `items` and `analysis`, and the analysis
  entry labels the thresholds Proposed and uncalibrated. A stale signal carries one `stale` entry with the reasons.
- **Basis:** the compared complete record's id and fingerprint (equal to the chapter's current fingerprint when the
  result is current), a newer incomplete record's id, and the saved project's modified time. So a threshold change keeps the basis
  key, and a new check changes it.
- **Settings:** a `RecordingCoverage` settings tool with four `number` fields (DX-2's kind, ADR 0155):
  `min_paragraph_present` (0 to 1, step 0.01), `max_missing_run` (0 to 200 words), `max_misread_run` (0 to 200 words)
  and `min_anchor_run` (1 to 50 words). The defaults are 0.95, 3, 8 and 3 in `config/defaults.json` and
  `builtinDefaults`, labelled on the Settings page as Proposed values, not yet calibrated (Q15), until Phase 8.
  `coverage.ResolveSettings` falls back per key to the default for a value it cannot use.
- **One source for the alignment.** `CoverageStart`, `CoverageResult` and the chapter payload's `recordedFraction` all take
  the alignment from `coverageSettings(store)`, so a start and a read cannot disagree. Changing an alignment setting
  makes earlier results stale (`params_changed`, Q13 B). Changing a threshold only changes the verdict. The signal also
  treats a current result whose stored alignment differs from the settings as stale, as a guard.

## Consequences

- The umbrella's service (a later SR phase) plugs in `NewSignalProvider` with the settings, the model check and a clock.
  Nothing calls the provider until then.
- A narrator who lowers a threshold sees the verdict change at once, without a transcription. A narrator who changes an
  alignment setting sees every recorded chapter go back to "check again", and the Home recorded column goes back to
  estimates until they check again. The Settings page says so.
- The Home dialog still states counts, not the verdict. Showing `met` or `not_met` beside the counts is the umbrella's
  Home work.
- The numbers are placeholders by design. Phase 8 runs the synthetic fixtures through this path and either keeps them or
  tightens them, still labelled uncalibrated until a real corpus exists.
