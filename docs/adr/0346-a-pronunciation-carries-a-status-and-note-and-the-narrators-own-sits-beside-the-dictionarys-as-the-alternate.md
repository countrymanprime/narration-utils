# 0346. A pronunciation carries a status and a note, and the narrator's own sits beside the dictionary's as the alternate

**Status:** Accepted
**Date:** 2026-09-27
**Supersedes:** none. It extends the Story Bible pronunciation of [ADR 0091](0091-story-bible-pronunciation-is-a-narrator-edited-value-the-preview-speaks-directly.md) and keeps the `chosen` rule of the story bible entries PRD (B11). Prep depth PRD ([`docs/prds/prep-depth.prd.md`](../prds/prep-depth.prd.md)) Phase 1, Open Question Q2 (recommendation taken, D22).

## Context

Each Story Bible name (an entity's own, and each alias) has exactly one pronunciation object, `{ipa, source, confidence, chosen?}`. Its source is always a dictionary (`CMU dictionary`, `eSpeak NG`, from the pronunciation source registry, ADR 0301). A narrator could not type their own, and nothing said whether the author had confirmed a pronunciation or been asked about it, which the benchmark lists as a prep must-have ("the word, the chosen pronunciation, the source ... and whether the author confirmed it").

The PRD's Q2 asks whether a narrator's own pronunciation replaces the dictionary's answer or sits beside it, and recommends beside, "one `chosen`". The data has one object per name, not a list, and every consumer (the reader's entity summary, the preview, the review findings) reads that one object's `ipa`.

## Decision

- **One pronunciation stays in use; the other kind is kept as `alternate`.** The object keeps its shape, and gains an optional `alternate: {ipa, source, confidence}`: the most recent pronunciation of the other kind (the narrator's own, or a dictionary's). Setting one of the other kind moves the one in use there; setting one of the same kind keeps the existing alternate. Switching (`pronunciation-use-alternate`) swaps the two, so going back and forth is lossless and never re-runs a lookup. Every consumer still reads the one `ipa` in use, unchanged.
- **The narrator's own pronunciation has source `user`, confidence `narrator`, and is `chosen`.** `user` is a provenance label, not a registered pronunciation source: it is never looked up, so it is not in the `SOURCES` registry, the `pronounce` command does not offer it, and `CheckPronounce` still refuses it. Its own command (`pronounce-user`) never calls CMU or eSpeak. The text is one line of at most 200 characters, checked by the host before any process starts and again by the sidecar, and passed as `--ipa=VALUE` so a value starting with `-` stays a value.
- **`status` is one of `researched`, `query_sent`, `author_confirmed`, with an optional `note` (at most 1000 characters).** It is about the name, not the source, so it travels with the pronunciation when the one in use changes, with one exception: `author_confirmed` confirmed a particular IPA, so it is withdrawn to `researched` whenever the IPA in use changes (a narrator override, a switch, a Replace from a dictionary, or a rebuild that regenerates an unchosen value). `query_sent` stays, because the question is still out. The note stays.
- **Migration-free.** An entry written before status existed has none and reads as `researched` (the UI's Zod schema defaults it; the sidecar's `pronunciation_status_of`). Nothing rewrites existing files; the fields appear only once the narrator uses them.
- **A rebuild keeps the narrator's work.** A `chosen` pronunciation (including every `user` one) is kept whole, as before, and now for a rediscovered alias as well as the entity's own name; an unchosen one is replaced by the fresh value but keeps its status (subject to the withdrawal rule), note and alternate.
- **Three bindings, void results:** `GuidePronounceUser(id, aliasIndex, ipa)`, `GuidePronunciationUseAlternate(id, aliasIndex)`, `GuidePronunciationSetStatus(id, aliasIndex, status, note)` (a `null` note leaves it alone, an empty one clears it). `hostAPIVersion` 68 to 69.

## Consequences

- The query list of Phase 3 is a pure function of these fields: every name whose status is not `author_confirmed`.
- A narrator who mistypes an override switches back in one step, with no lookup and nothing lost; the one they typed stays as the alternate.
- An author confirmation never silently vouches for a pronunciation the author did not hear. The cost: a narrator who changes a confirmed pronunciation on purpose (a typo fix in the IPA) marks it confirmed again by hand.
- Only two pronunciations per name are kept, one of each kind. A second dictionary Replace overwrites the first dictionary answer (as it always did); the narrator's own survives as the alternate. Keeping a full history is out of scope.
- The reader's entity summary shows the `user` source as "Yours"; any later surface that shows the source should use the same label (`pronunciationSourceLabel`).
