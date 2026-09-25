# 0042. Proofing's "Suggest from manuscript" derives names from the current Story Bible and leaves out auto-extracted Needs Review entries

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

"Suggest from manuscript" on the Proofing page returned nothing for the reporter's project, after an earlier fix. The exact `vocabulary_candidates` value and toast text were not available (V1 of `docs/prds/proofing-vocabulary-hints.prd.md`), so Phase 1 reproduced the candidate causes with the real sidecar and the Go host code, on a small manuscript with invented names:

- **Empty stored list.** `create` (which manuscript import uses to seed the checked characters, without building) writes `"vocabulary_candidates": []`, and only `build` ever recomputes it. Go used the stored list whenever the key existed, so a freshly imported project with a manual character `Juno` suggested nothing, and a name added by `create` after a build (`Zeph`) was never suggested.
- **Precision filter.** On a real rules-only build (no spaCy model) the entities were `Captain Arelian` (Character), `Council of Ash` (Organization), `Kestrel and Zephyra` (Character, a poor extraction), and two lone-word invented names filed as Needs Review: `Dawnspire` (5 occurrences) and `Zephyra` (3). The sidecar's list, and the earlier Go fallback, exclude every Needs Review entity, so the two most frequent invented names are never suggested. In rules-only mode every lone-word name is Needs Review ([ADR 0020](0020-entity-extraction-precision-over-recall.md), `docs/architecture/story-bible-entity-accuracy.md`).

The owner adopted the PRD's recommendations for its open questions (decision D22): V2 option (a), Go derives candidates from the entities and the stored list is only additive; V3, include locked and manual entities and keep the exclusion for auto-extracted Needs Review entries. The reproduction shows V3 fixes the first cause fully but leaves the second in place for lone-word names, which is what a rules-only project mostly has. That is a product call about how much noise a reviewed suggestion list should carry, so it was recorded here for the owner instead of being decided silently; the owner settled it when accepting this ADR (below).

## Decision drivers

- A freshly imported project's stored `vocabulary_candidates` list is empty, since only `build` recomputes it, and a name added after a build was never suggested.
- The hints reach the recognizer as one comma-joined string.
- How much noise a reviewed suggestion list should carry is a product call for the owner.

## Considered options

1. Go derives candidates from the current entities, the stored list is only additive, and auto-extracted Needs Review entities stay out
2. Also offer auto-extracted Needs Review entities in Suggest
3. Keep the status quo: use the stored list whenever the key exists

## Decision outcome

**Chosen option: Go derives candidates from the current entities, the stored list is only additive, and auto-extracted Needs Review entities stay out**, because deriving from the current entities fixes the empty stored list, and the owner kept the exclusion of auto-extracted Needs Review entries when accepting this ADR.

`guide.VocabularyCandidates` (`apps/desktop/internal/guide/service.go`) returns the union of the stored `vocabulary_candidates` list and the names derived from the current entities, one spelling per case-insensitive name, first spelling wins, sorted. A derived entity is offered under the sidecar's own rule (`is_vocabulary_worthy`) with locked and manual entities checked first: locked or `manual` always; otherwise not filed under Needs Review or Draft, and either multi-word, or a lone word with three or more occurrences (an entity from a guide too old to carry occurrence data is kept). Names containing a comma or a line break are skipped, because the hints reach the recognizer as one comma-joined string.

**Decided by the owner on acceptance (2026-09-23): auto-extracted Needs Review entities stay out of Suggest.** The case for offering them was that every one already survived the build's three-occurrence bar (`build_entities` drops a Needs Review entity below 3 occurrences), the suggestions are dashed pills the narrator accepts or ignores, and a wrong pill costs one click, while a missing one costs typing the name. The owner kept the exclusion; including them would be one line in `vocabularyWorthy` and needs a new ADR that supersedes this one.

### Consequences

- **Good:** Suggest works on a freshly imported, unbuilt project and picks up names added after the last build, in any build mode.
- **Bad:** On a rules-only build, lone-word invented names the build could not classify (Needs Review) stay out of Suggest until the narrator reviews or locks them.
- **Neutral:** The sidecar's stored list is unchanged and still excludes Needs Review even for locked and manual entities; Go's derived names are a superset of it (the locked and manual relaxation), so the two can differ.
- **Neutral:** Changing the rule later means editing `vocabularyWorthy` and its tests, and writing a new ADR that supersedes this one.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Also offer auto-extracted Needs Review entities

- Good, because every one already survived the build's three-occurrence bar.
- Good, because the suggestions are dashed pills the narrator accepts or ignores: a wrong pill costs one click, while a missing one costs typing the name.

### Use the stored list whenever the key exists

- Bad, because `create` writes an empty list and only `build` recomputes it, so a freshly imported project suggested nothing and a name added by `create` after a build was never suggested.
