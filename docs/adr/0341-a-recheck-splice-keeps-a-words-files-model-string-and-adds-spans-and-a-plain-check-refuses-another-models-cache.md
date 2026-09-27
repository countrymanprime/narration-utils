# 0341. A recheck splice keeps a words file's `model` string and adds `spans`; a plain check refuses another model's cache

**Status:** Accepted (owner, 2026-09-23, via the Decisions Log's adopted recommendations)
**Date:** 2026-09-27
**Amends:** ADR-0127 (the words file), ADR-0128 (the words cache key)

## Context

The model cascade (the recording-check-model-cascade PRD, deleted and delivered; Phase 3) re-checks only the
windows of audio a first pass called missing, with a stronger model, and splices the result into
the affected items' words files without touching the timeline or the manifest. Two questions came
with the new `--coverage --recheck <windows.json>` mode:

- **What a spliced words file says its model is.** `ItemWords.model` (`coverage_mode.py:109`) has
  always been one string for the whole file. After a splice, the file can hold words from two
  models over different ranges, and `StoredResult.Model` and the calibration harness already read
  `.model` as the file's single label (Q7, Q13).
- **Whether a plain check may keep reusing a words file another model made.** The sidecar's reuse
  check (`covers`, `coverage_mode.py:229-232`) has only ever compared the played range, never the
  model; a narrator who changes their Transcript Compare model setting between two checks of the
  same chapter would silently keep the old model's words (the PRD's Should item).

## Decision

- **A words file gains an optional `spans` list**, `{start, end, model}` in the file's own source
  seconds, additive like ADR 0168's `before`/`after` (`ItemWords.spans`, `_parse_words`,
  `write_words_file`, `coverage_mode.py`). A file `--recheck` has never touched omits the key
  entirely; `ItemWords.spans_or_default()` gives such a file one span, the whole range under its
  single `model`, so every reader that does not know about spans still sees the one model it always
  did. `WORDS_SCHEMA_VERSION` stays 1.
- **`splice_window` never changes `ItemWords.model`.** It replaces the words a window covers
  (dropping the window's own new words that touch its edge, since the window's independent decode
  may have cut them short) and reassigns that range of `spans` to the recheck's model
  (`_drop_replaced_words`, `_drop_edge_words`, `_overwrite_spans`). `.model` keeps naming the file's
  original transcription, so `StoredResult.Model` and every existing reader of the single-model
  field stay correct without a change; `.spans` is where per-range provenance lives (cascade Phase
  4/5 read it for the result's own label; nothing does yet).
- **`covers` takes an optional `model`.** A plain check (`_words_for`, `_is_covered`, including
  `--align-only`) now passes `args.model`, so a words file another model made is treated as a cache
  miss and transcribed again, never silently reused. `--recheck`'s own splice never calls `covers`
  with a model: it is a targeted overwrite of exactly the windows it is given, model mismatch or
  not, so the cascade's own re-check (a different model than the first pass, by design) is
  unaffected.
- **`wordsVersion` (`apps/desktop/internal/coverage/params.go`) rises once, to 2.** The words file
  the sidecar writes can now carry `spans`, and the evidence cache's words-blob entries are opaque
  JSON the sidecar validates on read, so this is not a correctness fix, only a clean one-time
  invalidation of blobs cached before this PR, matching the AnalyzerVersion convention (raise the
  version when what a cache holds changes shape).

## Consequences

- An all-cached re-run after a splice (`--align-only` or a plain check with the same model) still
  loads no model: the splice never narrows `source_start`/`source_end`, so `covers` still holds.
- A words file's `model` can now be one model even though parts of it came from another; a reader
  that wants the truth per range reads `spans`, not `.model`. Cascade Phase 4/5 is expected to do
  so for the result's own "checked with X; N passages re-checked with Y" label.
- The plain-check model refusal also applies to `--align-only`, which never transcribes: a model
  mismatch there raises `AlignOnlyError` rather than silently aligning from another model's words,
  pushing the caller back to a real check. This is intentional and symmetric with the plain path.
- Every cached words-blob entry from before this PR misses once under the new `wordsVersion` and is
  re-transcribed; nothing else invalidates from this change.
- A future change to how spans are computed or merged, or one that starts trusting `.model` less
  than `spans`, needs a new ADR that supersedes this one.
