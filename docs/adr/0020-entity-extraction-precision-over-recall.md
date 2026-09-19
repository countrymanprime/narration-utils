# 0020. Story Bible entity extraction favors precision over recall

**Status:** Accepted
**Date:** 2026-09-18

## Context

Rebuilding the Story Bible surfaced dictionary words — "Abandoned", "Adorable", "Afraid", "Active" — as entities, drowning the real names and places and polluting the Proofing vocabulary suggestions. The failure modes were documented in `docs/architecture/story-bible-entity-accuracy.md` as planned work. The user's direction: "I would rather miss a few due to being stricter than picking up half the dictionary in single words because we let anything in."

## Decision

`tools/manuscript-guide/core/manuscript_guide.py` extracts conservatively:

- A single-word candidate that also appears in lowercase elsewhere in the manuscript is a common word and is rejected — a dictionary-free signal — unless spaCy tagged it PERSON/ORG/GPE/LOC/FAC and it appears capitalized mid-sentence at least twice. Common adjective/adverb suffixes (`-able`, `-ing`, `-ed`, `-ly`, …) are treated the same way.
- In the rules-only fallback (spaCy model unavailable), sentence-initial capitalization never counts; a single word must appear capitalized mid-sentence at least twice.
- Leading filler words are stripped before evaluation ("About S-Dawn" becomes "S-Dawn").
- An unconfident classification is "Needs Review", not "Character"; the proximity guess applies only to multi-word names or spaCy-tagged ones; a Needs Review entity needs three or more occurrences to appear.
- `vocabulary_candidates` (Proofing's "Suggest from manuscript") excludes Needs Review entities and unlocked, non-manual singletons with fewer than three occurrences.
- Locked and manual entities are untouched (ADR-0007 still holds).

## Consequences

- Some real one-off names will be missed; adding one manually (or from a manuscript selection) is the intended path, and manual entries survive rebuilds.
- Thresholds are exercised by fixtures built from the reported words, so tuning is test-driven.
- Replacing rules/spaCy with a different extractor would need its own ADR.
