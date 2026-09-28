# The preview suggestion: engine, evidence and the narrator's pin

**Status: delivered, all eight phases, PRD deleted.** The pure ranking engine, its findings and audio-checked
composition, and the narrator's pin are in
[`apps/desktop/internal/preview`](../../apps/desktop/internal/preview) (`engine.go`, `types.go`, `findings.go`,
`audiomapper.go`, `audiochecked.go`, `pace.go`, `pin.go`, `rangeeval.go`, `store.go`). The host read binding is
`apps/desktop/bindings_preview.go` (`PreviewCandidates`); the pin bindings are
`apps/desktop/bindings_preview_pin.go` (`PreviewPin`, `PreviewPinSet`, `PreviewPinAdjust`, `PreviewPinClear`). The
UI is the Preview panel in the Proof chapter view
([`apps/ui/src/components/proof/PreviewPanel.tsx`](../../apps/ui/src/components/proof/PreviewPanel.tsx); see
[the Proof guide](../guides/using-the-app/proof.md)). This page
replaces `docs/prds/proofing-preview-suggestion.prd.md` (deleted per `docs/operations/github-workflow.md`; its
tracking issue, [#728](https://github.com/countrymanprime/narration-utils/issues/728), stays as the historical
record of the eight phases).

## What the feature does

A narrator who wants to judge an audiobook without listening to all of it is shown up to three candidate
five-minute excerpts, one per eligible chapter, each with the reasons it was chosen and any warnings. Nothing is
ever applied, exported or cut: `Suggest` recomputes fresh from the manuscript's current chapters and paragraphs on
every read (SR D1, the same "computed, never applied" rule the chapter-stage recommendations engine follows -
[the signal contract](stage-recommendations.md)). The one exception is the narrator's own pin (below), which is a
decision the narrator made, not a computed verdict, and so is the only thing this feature stores.

## The text-layer engine (`Suggest`)

`Suggest(Input) Result` slides a window over each eligible chapter's paragraphs (narration content, or a missing
`contentKind` from before structural classification - never `opening` or `reference`), sized to the target length
(default 5:00, ±10% tolerance) by the app's fixed pace estimate (`WordsPerFinishedHour`, matching
`apps/ui/src/state.ts`'s `WORDS_PER_FINISHED_HOUR`). It never crosses a chapter boundary and never splits a
paragraph. Each candidate is scored on named, explainable features (paragraph-boundary quality, a
narration-and-dialogue mix from a precision-first quote heuristic, distinct Story Bible entities, hard-word
density) and returns up to three, one per chapter, ranked highest score first, ties broken by chapter order then
paragraph index - the same input always gives byte-identical output.

Two optional layers compose onto a candidate before it is ranked:

- **Findings** (`findings.go`): open findings (unreviewed, accepted or deferred - a dismissed finding is never
  read at all) anchored to a paragraph inside the window are read as evidence; for the Sample preset, a hard-gate
  category (`transcript_discrepancy`, `pickup`, `duplicate_read`, `pronunciation`, `audio_quality`) at severity
  warning or above excludes the window outright rather than merely ranking it down (Spot-check only ranks down,
  never excludes).
- **Audio-checked** (`audiomapper.go`, `audiochecked.go`, `pace.go`): a candidate is labelled "audio-checked" only
  when the chapter's recording coverage is current and complete, every paragraph in the window maps to a real
  audio position (`MapParagraphsToTime`, built and tested against a real REAPER-saved fixture -
  `internal/tracks/testdata/reaper/line-identity.rpp`), and no windowed audio-quality finding falls inside it.
  Unknown never counts as good (SR D2, [ADR 0015](../adr/0015-real-progress-only.md)); a DX-4 windowed finding
  cannot be read from a real chapter today for reasons unrelated to this package
  ([ADR 0327](../adr/0327-dx-4-windowed-findings-need-a-chapter-and-paragraph-anchor-and-a-store-scope-before-a-consumer-can-gate-on-them.md)),
  so every candidate today reports pace evidence (Q8 option C, `ChapterPace`/`EstimateErrorFraction`) but never the
  audio-checked label in production.

## The narrator's pin

The narrator may pin one candidate to keep it, and move its edges by one paragraph at a time
([ADR 0383](../adr/0383-the-preview-pin-is-one-per-book-stale-by-anchor-text-and-never-re-ranked.md)):

- **One pin per book** (`preview.PinStore`, `store.go`): setting a new pin replaces whatever was pinned before, in
  any chapter. The sidecar is `<project>/narration-utils/preview-pin.json`, an atomic write (temp file, rename)
  like `chaptersync` and `prepmarkup`'s own sidecars, and disposable like a reader bookmark - a file that cannot be
  read is treated as no pin, never surfaced as an error.
- **Staleness** (`CheckStale`, `pin.go`): the pin stores each pinned paragraph's text at pin (or last adjustment)
  time; a read compares it against the paragraph's current text. `text_changed` (still recomputes evidence, marked
  stale) and `paragraph_missing` (nothing left to evaluate) are reported separately, never silently.
- **Adjustment** (`AdjustRange`, `pin.go`): grows or shrinks the range by one paragraph at either edge; a no-op,
  not an error, once that edge reaches the chapter's own boundary or the range is down to one paragraph.
- **Evaluation** (`EvaluateRange`, `rangeeval.go`): a pinned-and-adjusted window is scored with the same building
  blocks `Suggest`'s own candidates use, but is never subjected to `Suggest`'s three-candidate cap or the Sample
  preset's hard-gate exclusion - those are rules for what `Suggest` offers, not limits on what the narrator may
  keep.
- **Cleared by re-import**: `resetDerived` (`apps/desktop/internal/manuscript/service.go`) removes the pin file,
  the same reason `chaptersync`, `stages` and `proofing` clear their own chapter-id-keyed state on a re-import that
  renumbers ids.

## The bindings

| Binding | Reads | Writes |
| --- | --- | --- |
| `PreviewCandidates` | manuscript, guide, findings, coverage, Phase 6 mapper | nothing |
| `PreviewPin` | the pin store, resolved against current text | nothing |
| `PreviewPinSet(chapterId, paragraphIds)` | the manuscript, for anchor text | the pin store |
| `PreviewPinAdjust(edge, grow)` | the manuscript and the pin store | the pin store |
| `PreviewPinClear` | nothing | the pin store (removes it) |

The narrator's four Preview settings (target length, tolerance, preset, ending exclusion) live under the
`Preview` settings tool (`app.go`'s `fieldSchemas`), read fresh on every `PreviewCandidates` call.
