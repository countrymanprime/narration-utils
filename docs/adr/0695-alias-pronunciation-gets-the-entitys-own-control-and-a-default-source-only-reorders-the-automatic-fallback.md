# 0695. Alias pronunciation gets the entity's own control, and a default source only reorders the automatic fallback

**Status:** Accepted
**Date:** 2026-09-28
**Supersedes:** (none)

## Context

`docs/prds/story-bible-and-import-ux-briefs.prd.md` Phase 11 ("expose it") asks for an edit-mode control in
`GuideDetail.tsx` for the entity **and each alias** ("try another provider" next to the preview button, persisted so a
rebuild does not clobber it), plus a settings default. Phase 10 (ADR 0680) made a chosen pronunciation audible; this
phase's job is to let the narrator reach that mechanism from the UI.

Reading the code before building anything found the entity side of this already shipped, by an earlier stack (the
story-bible-entries PRD, D13/B8-B11): `GuideDetail.tsx` already has a Play button gated on a pronunciation existing, an
edit-mode Generate/Replace `Menu` offering "From the CMU dictionary" / "From eSpeak NG", and `PronunciationWork` (a
separate, later feature — prep-depth Phase 1, ADR 0346 — the narrator's own status/note/alternate work on a
pronunciation). Every wire-level piece these controls call was **already alias-aware**: `GuidePronounce`,
`GuidePronounceUser`, `GuidePronunciationUseAlternate` and `GuidePronunciationSetStatus` all take an optional alias
index end to end (`apps/ui/src/api/wailsClient.ts` through `apps/desktop/bindings.go` to
`sidecars/manuscript-guide/core/manuscript_guide.py`'s `--alias-index`), and the mock (`api/mockHost/storyBible.ts`)
already branches on it. Only the aliases `<Table>` in `GuideDetail.tsx` had never been wired to any of it — it had a
Play button and nothing else.

For the settings default, `manuscript_guide.py`'s `pronunciation()` (the automatic build-time lookup, as opposed to the
narrator's explicit `pronounce_source()` call) already tries a fixed order, `SOURCES.fallback_order()` (`cmu`, then
`wiktextract`, then `espeak`; provider-ports P8, prep-depth Phase 8's ADR 0405): CMU is fast for familiar names,
Wiktextract has broader headword coverage, eSpeak is the letter-to-sound guess of last resort. The PRD's "default
provider" setting is this order's starting point, not a second mechanism: `apps/desktop/internal/pronunciationport`
already lists the same three names for the host side (`CheckPronounce`), and Settings already has a Story Bible
category (`ManuscriptGuide`, `app.go`'s `fieldSchemas`) with the append-only-rows convention CLAUDE.md and
`docs/operations/agent-train.md`'s "Serial points" describe.

## Decision

**Alias control.** The entity's own Generate/Replace `Menu`, its source/confidence caption and its `PronunciationWork`
panel are each instantiated once per alias in `GuideDetail.tsx`'s aliases table, scoped by alias index, calling the
same four API methods the entity already calls — no new binding, no wire-contract change, since every one of them
already accepted an alias index. `pronounceEntity`/`pronounceUser`/`switchToAlternatePronunciation`/
`setPronunciationStatus` take an optional `aliasIndex` and build their host-API call as one of two argument-count
variants (a tuple spread, not two call expressions) so: (a) the entity's own call keeps its exact old argument shape,
which existing tests already assert on with `toHaveBeenCalledWith`, and (b) `interactionFeedback.catalog.ts`'s static
call-site scan (one `<method>#<n>` per literal call expression, ADR 0075) still counts exactly one call site per
method, since the feedback pattern is identical whether the target is the entity or an alias. Button labels for the
alias controls (`Generate alias pronunciation`, `Replace alias pronunciation`) follow the existing
`Play alias pronunciation` convention: one accessible name shared by every alias row, disambiguated by table structure,
not a per-alias unique label — consistent with how the alias Play button already worked. `PronunciationWork` needed no
change at all: it already took `name` generically and every one of its sub-controls (`Use {alternate} instead`,
`Pronunciation status for {name}`) already parameterizes by it.

**Default source setting.** A new choice field, `ManuscriptGuide.default_pronunciation_source` (`""` — Automatic — or
one of `pronunciationport.FallbackOrder`'s names), appended to the existing Story Bible category rather than a new one
(the PRD's "or a new Pronunciation category" was the fallback, not a stated preference; D22 defaults to the PRD's own
first-listed option). It reorders `SOURCES.fallback_order()` to try the chosen source first, in
`manuscript_guide.py`'s `pronunciation()`: an unregistered value (a stale setting from a removed source) is ignored
rather than raising, and the rest of the chain still runs if the preferred source has nothing for the name — a
preference, not an exclusive restriction, since the automatic path already has no way to surface "not generated" back
to a narrator who was not looking. `apps/desktop/internal/guide/service.go` reads it once
(`defaultPronunciationSourceArgs`) and passes `--default-source` to the sidecar's `build`, `edit` (only when the edit
touches `aliases`, since that is the only `apply_edit` branch that generates a pronunciation) and `create` commands;
left off entirely (not passed as an explicit empty value) when unset, so a project that never touches this setting has
the exact command line it had before this phase. It never changes the narrator's own explicit Generate/Replace choice
above, which always lets them pick a specific source regardless of the default.

## Consequences

- A narrator can now set, replace, or work on the pronunciation of an alias exactly the way they already could for an
  entity's own name — Generate/Replace, "Use mine", the kept alternate, status and note — with no gap between the two file
  the PRD's "the entity and each alias" scope named.
- No `hostAPIVersion` bump, new Zod schema, or `wireContracts.test.ts` row: the wire layer for these four calls already
  shipped alias-aware, and the settings field is the existing generic `GetSettings`/`SaveSettings` path's own row
  (`Settings.tsx` and `fieldSchemas` are on the append-only list in `docs/operations/agent-train.md`'s "Serial points").
  `tests/fixtures/contracts/settings-global.json` and `settings-project.json` are regenerated to include the new row.
- A rebuild's automatic pronunciations (and a freshly added alias's) now honor the narrator's preferred source before
  falling back, without ever silently dropping a name that preferred source has nothing for.
- `apps/ui/tests/visual/catalog/storybible.ts` gains one new state, `alias-pronunciation-editing`, mirroring
  `entry-pronunciation-work`'s depth but scoped to an alias; PNGs reviewed at all three viewports.
