# 0168. A coverage region carries its bounds as optional `before` and `after` points, with no version bump

**Status:** Proposed
**Date:** 2026-09-23
**Amends:** ADR-0127 (the `COVERAGE_REGION` payload)

## Context

The model cascade ([PRD](../prds/recording-check-model-cascade.prd.md), Phase 2) re-checks each missing region with a stronger model over a window of audio. The window has to be bounded by the words the first pass did match on either side of the gap, because the missing text can only be between them. [ADR 0127](0127-the-coverage-sidecar-mode-reads-a-json-manifest-keeps-one-words-file-per-item-and-writes-tagged-json-lines.md) gives a region one point in the audio, `position`: the start of the transcript word at the region's audio index, or the end of the last word for a tail. One point cannot say where a gap starts and ends, and it is not always a matched word: for a region of different text it is the first word of the speech said in its place. The alignment knows the matched words on either side, but the sidecar did not write them.

Three questions came with the new fields:

- Which matched words bound a region. A read title is optional text (Q11); a chance match of a heading word could land anywhere in the audio, and a window bounded by it could leave out the audio where a misheard first paragraph really is.
- How a bound names a place. `position` maps a joined-timeline time back to an item, so a time exactly where one item ends and the next starts falls into the next item.
- Whether the change needs a version. `RESULT_SCHEMA_VERSION`, the host's `AnalyzerVersion` (part of the parameter hash) and `wordsVersion` (part of the words cache key) could each go up.

## Decision

Every `COVERAGE_REGION` payload gains two keys, `before` and `after`, each `{itemIndex, itemGuid, sourceTime}` or `null`. `position` is unchanged.

- **The bounds are anchors with body text.** `recording_coverage.compute_coverage` gives each `Region` `audio_before`, the last transcript token of the nearest anchor holding a body token that ends at or before the region, and `audio_after`, the first transcript token of the nearest such anchor that starts at or after it (`_body_anchors`, `_bounds`). An anchor of heading tokens only never bounds a region. So a head has no `before`, even after a read title, a tail has no `after`, and a region with nothing said has neither. Chance matches have already joined their gap, and the speech inside a gap (a misread or different text) lies between the bounds.
- **A bound is a word's edge in its own item.** `coverage_mode._region_bounds` maps each token through `alignment["index_map"]` to a timeline word and writes `before` as that word's end and `after` as its start, in the source seconds of the item the word came from (`_Timeline.word_edge`). A bound never moves into the next item.
- **No version goes up.** The keys are additive. The counts, paragraphs, regions and so the verdict are the same bytes as before apart from the two new keys, so `RESULT_SCHEMA_VERSION` stays 1, `AnalyzerVersion` stays `"1"` (a bump would make every stored result stale with `analyzer_changed` for no change in what it measures), and `wordsVersion` stays `"1"` (words files do not change). Go reads the keys as `RegionLine.Before` and `RegionLine.After` (`*RegionPosition`, `null` when absent), which the Zod schema reads as optional (`apps/ui/src/api/schemas/coverage.ts`). A results file or stored result from before this change reads with no bounds and stays current.

## Consequences

- The re-check planner (cascade Phase 4) can bound each window in one item's source seconds without re-aligning, and a region split across two items reads as `before` in one and `after` in the next.
- A result made before this change has no bounds. A reader that needs them, the planner, must treat a missing bound as the edge of the item's played range, as it would for a head or a tail, or run the check again. Nothing forces that re-run.
- The UI and the stage recommendations do not show the bounds yet; `position` still names the place in the Home dialog and the signal's evidence.
- The bounds are data the host reads from a sidecar's file ([threat model](../architecture/threat-model.md) row 4e): they are labels until the planner uses them, and the planner must check them against the manifest's items before it turns one into a slice of audio.
- Changing what bounds a region (for example, letting a read title bound a head) means a new ADR that supersedes this one, and bumping `AnalyzerVersion` if the verdict could change.
