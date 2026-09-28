# 0680. The Story Bible preview speaks a chosen pronunciation through Piper's raw-phoneme block

**Status:** Accepted
**Date:** 2026-09-28
**Supersedes:** (none; resolves the open compatibility risk ADR 0091 left for this phase)

## Context

`docs/prds/story-bible-and-import-ux-briefs.prd.md` Phase 10 asks for the gap [ADR 0091](0091-story-bible-pronunciation-is-a-narrator-edited-value-the-preview-speaks-directly.md) and
[the pronunciation provider spike](../research/pronunciation-provider-spike.md) recorded: `render_audio` in
`sidecars/manuscript-guide/core/manuscript_guide.py` always spoke the entity's spelled name through Piper, so a
narrator-edited pronunciation had no audible effect. ADR 0091 picked the direction (speak the narrator's edited value
directly, no second engine) but left one risk open: the CMU dictionary source stores ARPABET, "a different symbol set
from IPA", and feeding it to Piper's phoneme-input path unconverted "would very likely produce wrong or silent audio" —
needing "a real trial" before Phase 10 could ship it.

Reading the code for this phase found that risk already closed by a concurrent stream: `sidecars/manuscript-guide/core/providers.py`
(provider-ports P8, ADR 0301) now converts every pronunciation source to IPA before it is ever stored —
`CmuSource.pronounce()` runs the CMU dictionary's ARPABET through `arpabet_to_ipa()` (a fixed ARPABET-to-IPA table)
before returning it, and `WiktextractSource`/`EspeakSource` already produce IPA. `entity["pronunciation"]["ipa"]` and an
alias's `pronunciation.ipa` are therefore IPA regardless of source by the time Phase 10 starts, which removes the
symbol-set mismatch ADR 0091 flagged. The narrator-chosen mechanism itself was also already delivered by other
concurrent work (`pronounce()`/`pronounce_user()`, the `GuidePronounce`/`GuidePronounceUser` bindings, and
`merge_locked`'s "a `chosen` pronunciation survives a rebuild" rule, both already covered by
`sidecars/manuscript-guide/tests/test_pronounce.py` and `test_pronunciation_depth.py`) — so this phase's own scope is
narrower than the PRD's phase table implies: only the preview path was still silent.

Reading `piper.voice.PiperVoice.phonemize()` (the installed `piper-tts` package) found it already supports raw phoneme
input as a documented text convention, not just through the two-step `phonemes_to_ids()`/`phoneme_ids_to_audio()` API
ADR 0091 named: text wrapped in `"[[ ... ]]"` is extracted verbatim and fed straight to `phonemes_to_ids()`, skipping
Piper's own espeak-based text-to-phoneme guess for that span. `piper.phoneme_ids.phonemes_to_ids()` also silently skips
(with a log warning) any symbol missing from the voice's phoneme map, rather than raising — so a stored IPA string this
project didn't produce (for example from the Wiktextract dataset, D72/ADR 0405) degrades instead of failing the preview
outright.

An actual listening trial (synthesize edited names through each source and judge the audio) is not something this
session can do — there is no way to play or judge audio here. Building the change on the documented API contract
(IPA-in, Piper's own graceful degradation on an unrecognized symbol) is the trial substitute; a real listening check is
an owner step (D65: hardware/audio checks are flagged on #510, never block a merge or a launch).

## Decision

`render_audio` speaks an entity's or alias's **chosen** pronunciation (`pronunciation.chosen == true`, set by
`pronounce()`/`pronounce_user()`) as a Piper raw-phoneme block (`f"[[{ipa}]]"`) instead of the spelled name, through the
new `spoken_form(holder, name)` helper. An **unchosen** pronunciation (a fresh build's own guess the narrator never
picked) never changes what the preview says — this matters because `merge_locked` keeps regenerating an unchosen guess
on every rebuild, and the preview must not flip behaviour on its own. A `chosen` pronunciation with an empty `ipa`, or
one containing `"]]"` (which would end the raw block early and corrupt the phoneme stream), falls back to the spelled
name rather than mis-speaking it.

No source-specific conversion or exclusion is added: every source already stores IPA (see Context), and Piper's own
per-symbol skip is the accepted degradation path for a symbol set variance this ADR does not otherwise try to prove
compatible offline. `apps/desktop/internal/guide/service.go`'s preview cache key (`previewFileName`) is extended to
include the chosen pronunciation's IPA (`chosenPronunciationKey`), because the cache was keyed only on the spoken text:
without this, choosing or changing a pronunciation for an already-previewed name would keep serving the old, spelled-name
audio from disk. `apps/desktop/bindings.go` needed no change: `GuidePreview`'s binding signature and response shape are
unchanged, and `GuideEdit` already forwards an arbitrary field map to the sidecar, so no new host binding was required
for this phase.

## Consequences

- A narrator who chooses a pronunciation (any of the `cmu`, `wiktextract`, `espeak` or `user` sources) now hears that
  exact pronunciation when they press Preview, and it survives a Story Bible rebuild (`merge_locked`, already covered
  by existing tests, exercised again end to end by
  `sidecars/manuscript-guide/tests/test_pronunciation_preview.py::ChosenPronunciationRoundTripTests`).
- An unrecognized IPA symbol (for example an unusual Wiktextract entry) degrades to Piper skipping that one symbol
  with a log warning, not a failed preview and not silently reverting to the spelled name for the whole word. Whether
  that degradation still sounds acceptably close to the intended pronunciation is unverified by this ADR — it is a
  real audio judgement, not a desk check.
- A real listening trial (does the phoneme block actually sound like the chosen pronunciation, for each source) is
  filed as an owner QA item on issue #510, per D65 and D70/D71's "provisional until a real check" pattern. If that
  trial finds a source's IPA needs its own conversion or should be excluded, a new ADR supersedes this one for that
  source only.
- Every existing cached preview under the old (`v2`) cache-key format is orphaned by the `previewCacheTag` bump to
  `v3` and is regenerated once on the next preview click; nothing reads the old files as valid again.
