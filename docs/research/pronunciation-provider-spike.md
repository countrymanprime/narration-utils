# Pronunciation provider spike (story bible and import UX briefs, Phase 9)

**Status: decided, docs only.** This is the Phase 9 spike `docs/prds/story-bible-and-import-ux-briefs.prd.md` asks for
(open questions P1-P2): what "provider" means for Story Bible pronunciation, whether the preview can speak a chosen
phonetic form, and a GPL exposure check before any further engine. The storage/preview implementation itself (Phase 10)
and its UI (Phase 11) are out of scope for this stack (S19d) and deferred.

## What exists today

- `sidecars/manuscript-guide/core/manuscript_guide.py`'s `pronunciation(name, espeak_library)` tries `cmudict` first,
  then falls back to `phonemizer`'s `espeak` backend (`pronounce_source`, `PRONUNCIATION_SOURCES = {"cmu", "espeak"}`),
  storing an IPA string in `entity["pronunciation"]["ipa"]` with its `source`. A narrator-chosen source is available
  through the `pronounce()` command and the `GuidePronounce` binding (stack S19a), marked `chosen` so `merge_locked`
  keeps it across a rebuild.
- The preview path (`render_audio` in the same file, called by `apps/desktop/internal/guide/service.go`'s `Service.Preview`
  via `apps/desktop/bindings.go`'s `GuidePreview`) **ignores the stored pronunciation entirely**: it calls
  `voice.synthesize_wav(spoken, wav_file)` with `spoken = entity["canonical_name"]` (or the alias text) — Piper's own
  espeak-based grapheme-to-phoneme runs on the spelled name every time, so an edited IPA field has no audible effect.
  This matches the PRD's architecture notes ("the preview ignores IPA today") and was confirmed by reading the code in
  this session, not assumed.
- Piper (`piper-tts`) and `phonemizer`/eSpeak NG are already bundled in the frozen Story Bible sidecar as GPL-3.0-or-later
  components, recorded in [model provenance](../architecture/model-provenance.md) under owner decision D17 (this project
  is itself AGPL-3.0-or-later, [ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-or-later.md), so a GPL-3.0-or-later
  component already ships).

## P1: what does "provider" mean?

Options from the PRD: (a) a second local engine (for example MFA G2P); (b) a narrator-edited project pronunciation
dictionary; (c) a hosted IPA API (excluded); (d) no provider at all — make the preview speak narrator-authored phonemes
or respellings.

**Decided: (b) plus (d)**, per owner decision (this stack's brief): the pronunciation the narrator already edits through
`edit()`/`GuideEdit` becomes the thing the preview actually speaks, with no second engine added. `pronounce_source`
already gives the narrator a choice between two existing sources (`cmu`, `espeak`); this decision does not add a third.

### Can the preview actually speak a chosen pronunciation?

Checked against Piper's public API (`OHF-Voice/piper1-gpl`, the maintained fork the project's own vendored `piper-tts`
descends from) in this session: `PiperVoice` exposes `phonemize()` (text to phonemes), `phonemes_to_ids()` (phonemes to
the model's numeric IDs) and `phoneme_ids_to_audio()` (low-level synthesis straight from those IDs) alongside the
convenience `synthesize()`/`synthesize_wav()` that runs all three steps from raw text. **A phoneme-input bypass exists**:
`phonemes_to_ids()` followed by `phoneme_ids_to_audio()` skips espeak's own text-to-phoneme step, which is exactly what
narrator-authored phonemes need — the preview must not re-run espeak's guess over an edited IPA string and silently
undo the edit.

**Compatibility risk, not yet trial-verified**: Piper's own `phonemize()` also uses espeak-ng internally, and this
project's `espeak` pronunciation source uses `phonemizer`'s `espeak` backend — the same underlying espeak-ng library, so
an IPA string from that source is a reasonable candidate for `phonemes_to_ids()` directly. The `cmu` source produces
ARPABET, a different symbol set from IPA; feeding it to `phonemes_to_ids()` unconverted would very likely produce wrong
or silent audio. **This needs a real trial before Phase 10 ships it**, not just this desk check: synthesize a handful of
edited names through both source types and listen, and decide whether `cmu`-sourced pronunciations need an
ARPABET-to-IPA mapping step or should be excluded from the "speaks what you wrote" guarantee until they have one.

## P2: GPL exposure check

The PRD asks to schedule a licence review before adding any further engine, because `phonemizer` and eSpeak NG are GPL
upstream and run in-process in the frozen sidecar. This stack (P1 decided as b+d) **adds no new engine**: it reuses the
`cmu`/`espeak` pronunciation sources and Piper, all already recorded in [model provenance](../architecture/model-provenance.md)
as GPL-3.0-or-later, already compatible with this project's own AGPL-3.0-or-later licensing (owner decision D17). So this
phase is, as the brief anticipated, mostly a documentation item: **no new licence review is triggered by P1's decision**,
because no new licensed component is introduced. The open item is procedural, for whichever later stack adds a second
local engine (the "Could" row in the PRD's MoSCoW table, explicitly deferred past this PRD): **that stack must re-read
`docs/architecture/model-provenance.md` and this project's licence-class policy
(`docs/research/local-dependency-evaluation.md#license-classes`) before adding it**, the same gate every other candidate
in that document already goes through. This is recorded as a standing checklist item, not a new artifact evaluation,
because there is no new artifact yet to evaluate.

## Decision

See [ADR 0091](../adr/0091-story-bible-pronunciation-is-a-narrator-edited-value-the-preview-speaks-directly.md) (Proposed).
