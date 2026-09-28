# Pronunciation: sources, the chosen value, and its default

How a Story Bible entry's or alias's pronunciation is generated, chosen, made audible and defaulted. Delivered by the
story-bible-and-import-ux-briefs PRD's P brief (phases 9-11): a docs-only spike on what "provider" should mean, then
storage and preview, then the UI and a settings default. This page replaces that PRD (its Open Questions P1-P2 hold
the spike's reasoning) now that it is deleted.

## What "provider" means here

[ADR 0091](../adr/0091-story-bible-pronunciation-is-a-narrator-edited-value-the-preview-speaks-directly.md) rejected a
second local G2P engine and a hosted IPA API: "provider" is the pronunciation value the narrator already edits through
`edit()`/`GuideEdit`, and the preview should speak that value directly instead of re-guessing from the spelled name.
`phonemizer`, eSpeak NG and Piper were already GPL-3.0-or-later components in this AGPL-3.0-or-later project (owner
decision D17, [model provenance](model-provenance.md)), so reusing them added no new licence question.

## Sources

`sidecars/manuscript-guide/core/providers.py` registers three pronunciation sources into the shared
`narration_common.ports.pronunciation.SOURCES` registry, in the offline precedence order the automatic build-time
fallback tries them: **CMU dictionary** (quick, high-quality for names it knows), **Wiktextract** (broader headword
coverage than CMU, a real dictionary hit; prep-depth Phase 8, [ADR 0405](../adr/0405-pronunciation-stays-local-first-behind-cmu-wiktextract-and-espeak-with-merriam-webster-as-the-one-narrator-keyed-online-source.md)),
then **eSpeak NG** (a letter-to-sound guess for anything neither dictionary has). Every source normalizes to IPA before
storage — `CmuSource.pronounce()` runs CMU's ARPABET through `arpabet_to_ipa()` — so the value a narrator sees and
chooses is always IPA regardless of which source produced it. `apps/desktop/internal/pronunciationport` is the Go
side's read-only mirror of the same three names, used to validate the narrator's explicit choice before the sidecar
starts (`Pronounce`'s `CheckPronounce`).

## Choosing and previewing a pronunciation

- **Generated automatically** at build time and whenever an alias is added, by `pronunciation(name, espeak_library,
  default_source)`: tries the sources in order (the narrator's default source first, if set — see below), stores
  `{ipa, source, confidence}`, and falls back to `{"ipa": "", "source": "not generated", "confidence": "unknown"}`
  rather than raising.
- **Chosen explicitly** through `GuideDetail.tsx`'s edit-mode Generate/Replace control, for the entity and
  independently for each alias (phase 11): a `Menu` offering "From the CMU dictionary" / "From eSpeak NG" next to the
  Play button, calling `Host.GuidePronounce` (which asks `pronounce_source()` for exactly the named source and raises
  when it has nothing for the name, unlike the automatic fallback) and marking the result `chosen: true` so a rebuild
  never silently replaces it (`merge_locked`). The narrator's own typed pronunciation
  (`PronunciationWork`, prep-depth Phase 1, [ADR 0346](../adr/0346-a-pronunciation-carries-a-status-and-note-and-the-narrators-own-sits-beside-the-dictionarys-as-the-alternate.md))
  and the kept alternate work the same way for an alias as for the entity — every one of `GuidePronounce`,
  `GuidePronounceUser`, `GuidePronunciationUseAlternate` and `GuidePronunciationSetStatus` has always taken an
  optional alias index end to end; phase 11 only wired the aliases table to controls that were already alias-aware.
- **Spoken by the preview:** [ADR 0680](../adr/0680-the-story-bible-preview-speaks-a-chosen-pronunciation-through-pipers-raw-phoneme-block.md)
  changed `render_audio` to speak a **chosen** pronunciation as a Piper raw-phoneme block (`"[[ipa]]"`) instead of the
  spelled name; an unchosen (freshly auto-generated) pronunciation never changes what the preview says, since
  `merge_locked` keeps regenerating a guess on every rebuild and the preview must not flip on its own. The Go preview
  cache key folds in the chosen pronunciation's IPA, so choosing or changing one invalidates a stale cached render.

## The default source setting

[ADR 0695](../adr/0695-alias-pronunciation-gets-the-entitys-own-control-and-a-default-source-only-reorders-the-automatic-fallback.md)
(phase 11) added `ManuscriptGuide.default_pronunciation_source` (Settings > Story Bible): `""` (Automatic, the
original CMU-then-Wiktionary-then-eSpeak order) or one of the three source names. It only **reorders** the automatic
fallback to try the narrator's preferred source first — the rest of the chain still runs if that source has nothing
for a name — and never limits the entity/alias Generate/Replace control's own explicit per-name choice.
`apps/desktop/internal/guide/service.go` passes it to the sidecar's `build`, `create`, and an `edit` that adds an
alias; it is left off the command line entirely while unset, so an untouched project's command line is unchanged.

## Open, owner-only item

A real listening trial (does the phoneme block actually sound like the chosen pronunciation, for each source) needs a
human ear; it is filed as owner QA on issue #510 per D65/D70, not a blocker for any of phases 9-11.

## Tests

Python: `sidecars/manuscript-guide/tests/test_providers.py` (the fallback order, a narrator's default source tried
first and ignored when unregistered, each source's conformance suite) and `test_pronunciation_preview.py` (chosen vs.
unchosen, the pronounce-then-rebuild-then-preview round trip). Go: `apps/desktop/internal/guide/service_test.go` (the
default-source argument reaches build/alias-edit/create and only those) and `preview_test.go` (the cache key). Vitest:
`GuideDetail.pronunciation.test.tsx`, `GuideDetail.aliasPronunciation.test.tsx` and
`GuideDetail.pronunciationWork.test.tsx`. Visual: `storybible/entry-pronunciation-missing`,
`entry-pronunciation-work`, `entry-pronunciation-online` and `alias-pronunciation-editing`.
