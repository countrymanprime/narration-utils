# 0152. The retail sample is a paragraph range on the project manifest, held to five minutes by the host

**Status:** Proposed
**Date:** 2026-09-23

## Context

ACX asks for a retail sample of 5 minutes or less. The PRD recommended a computed marker on the first five minutes of chapter
one (Open Question C10); the owner decided on 2026-09-23 that the narrator picks the range, at most 5 minutes, anywhere in the
book, stored per project, and that it adds no time to the estimate (Phase 5: "a sample range over 5 minutes is refused, and the
estimate is unchanged by a sample"). Before any audio exists the only measure of "5 minutes" is the estimate's own rate, 9,300
words per finished hour (`WORDS_PER_FINISHED_HOUR`, `apps/ui/src/state.ts`). Credits data must not live in `manuscript.json`
or any folder that Replace or "Clear derived project data" deletes (PRD Evidence); the project manifest already holds the
credits values (`project.Manifest.Credits`).

## Decision

- **Stored by paragraph id on the manifest.** `project.Manifest.RetailSample` (`{startParagraphId, endParagraphId}`, both
  included, additive and omitted when unset) holds the range. Paragraph ids are what notes and Transcript Compare anchor to;
  line numbers are derived, never stored.
- **The host measures and refuses.** `credits.MeasureSample` (`internal/credits/sample.go`) walks `manuscript.json`'s paragraphs
  in book order, counts `strings.Fields` words, gives each end its chapter and reader line (1-based within the chapter, the
  number the Manuscript reader shows), and refuses a missing paragraph, an end before the start, or more than
  `MaxRetailSampleSeconds` (300) at `WordsPerFinishedHour` (9,300). The comparison is in whole numbers, so exactly 775 words
  (5:00) is accepted. The Go constant restates the UI's rate; both are pinned by tests (`sample_test.go`, `state.test.ts`).
- **Two bindings.** `CreditsRetailSample()` answers `{sample, problem}`: the measured sample, or, when a saved range no longer
  measures (a replaced manuscript lost its lines), `sample: null` and the reason, keeping the saved range rather than failing
  the read. `CreditsSaveRetailSample(start, end)` measures first and saves only a range that passes, so a refusal keeps the
  previous sample; two empty ids clear it.
- **A marker only.** Settings > Credits > Retail sample picks it by chapter and line; the Manuscript reader tags the chapter
  header and marks the sampled rows (`retailSampleRange.ts`, from each chapter's `paragraphIds`, so no paragraph text is
  loaded). The Home estimate never reads it.

## Consequences

- The sample survives Replace and Clear (the manifest is outside both), and a replaced manuscript that keeps its paragraph ids
  keeps the sample in place; one that does not reports the problem and asks for a new pick instead of marking the wrong lines.
- "5 minutes" is an estimate from words, not a measured recording: a slow read of a 775-word range can run past 5 minutes. The
  guide says it is measured at about 155 words a minute. Measuring the recorded audio would need the chapter's audio and a new
  decision.
- Picking by chapter and line in Settings is less direct than selecting text in the reader; a reader action to set the sample
  from a selection could be added later without changing the stored shape.
- `hostAPIVersion` goes to 35 with ADR 0151's binding; the golden payloads are `credits-retail-sample*.json`.
