# 0020. Story Bible entity extraction favors precision over recall

- **Status:** Accepted
- **Date:** 2026-09-18

## Context and problem

Rebuilding the Story Bible surfaced dictionary words — "Abandoned", "Adorable", "Afraid", "Active" — as entities, drowning the real names and places and polluting the Proofing vocabulary suggestions. The failure modes were documented in `docs/architecture/story-bible-entity-accuracy.md` as planned work. The user's direction: "I would rather miss a few due to being stricter than picking up half the dictionary in single words because we let anything in."

## Decision drivers

- The user's direction: rather miss a few entities by being stricter than pick up half the dictionary in single words.
- Dictionary words drowned the real names and places and polluted the Proofing vocabulary suggestions.

## Considered options

1. Conservative extraction that favors precision over recall
2. Keep the status quo: let anything in, favoring recall

## Decision outcome

**Chosen option: conservative extraction that favors precision over recall**, because the user would rather miss a few names by being stricter than pick up half the dictionary.

`tools/manuscript-guide/core/manuscript_guide.py` extracts conservatively:

- A single-word candidate that also appears in lowercase elsewhere in the manuscript is a common word and is rejected — a dictionary-free signal — unless spaCy tagged it PERSON/ORG/GPE/LOC/FAC and it appears capitalized mid-sentence at least twice. Common adjective/adverb suffixes (`-able`, `-ing`, `-ed`, `-ly`, …) are treated the same way.
- In the rules-only fallback (spaCy model unavailable), sentence-initial capitalization never counts; a single word must appear capitalized mid-sentence at least twice.
- Leading filler words are stripped before evaluation ("About S-Dawn" becomes "S-Dawn").
- An unconfident classification is "Needs Review", not "Character"; the proximity guess applies only to multi-word names or spaCy-tagged ones; a Needs Review entity needs three or more occurrences to appear.
- `vocabulary_candidates` (Proofing's "Suggest from manuscript") excludes Needs Review entities and unlocked, non-manual singletons with fewer than three occurrences.
- Locked and manual entities are untouched (ADR-0007 still holds).

### Consequences

- **Bad:** Some real one-off names will be missed; adding one manually (or from a manuscript selection) is the intended path, and manual entries survive rebuilds.
- **Good:** Thresholds are exercised by fixtures built from the reported words, so tuning is test-driven.
- **Neutral:** Replacing rules/spaCy with a different extractor would need its own ADR.

### Confirmation

Thresholds are exercised by fixtures built from the reported words, so tuning is test-driven.

## Pros and cons of the options

### Let anything in, favoring recall

- Good, because fewer real one-off names are missed.
- Bad, because it surfaced dictionary words as entities, drowning the real names and places and polluting the Proofing vocabulary suggestions.
