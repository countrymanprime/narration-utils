# Story Bible entity-extraction accuracy

**Status: Planned — documented, not fixed in the accompanying bug-fix pass.**

Per explicit user direction, this is heuristic/NLP tuning work, not a quick fix — it's recorded here as a backlog item with a concrete proposed approach, and was **not** changed in `tools/manuscript-guide/core/manuscript_guide.py` alongside the rest of this session's fixes.

## Known failure modes (confirmed this session)

All in `manuscript_guide.py`:

1. **Common-word false positives.** The `CAPITALIZED` regex (`:32`) matches any capitalized word/phrase, including ALL-CAPS common words like "ACCEPTABLE". `STOPWORDS` (`:34-71`) is a small, hand-maintained closed list that doesn't (and can't practically) cover every common English word that might appear capitalized — "Aboveground", "Abandoned", "Accurate", "Accidentally" and similar are not filtered.
2. **Filler-word contamination.** `rule_candidates` (`:254`) only drops a candidate if the *whole* multi-word name is a stopword or *every* word in it is — a phrase like "About S-Dawn" survives because "S-Dawn" alone isn't a stopword, even though "About" is clearly a sentence-leading filler word, not part of a name.
3. **Proximity-heuristic misclassification.** `classify()` (`:305-330`): when spaCy NER doesn't confidently tag something, a ±28-character proximity heuristic against `PERSON_WORDS`/`PLACE_WORDS` guesses a category, defaulting ambiguous cases toward `"Character"`. This is why something like "S-Dawn" (the user's own example — a lore/world-building term, not a person) can land as a Character if a person-associated word happens to sit nearby in the text.
4. **Repetition doesn't imply legitimacy.** `build_entities` (`:432`) drops single-occurrence rule-based "Needs Review" candidates, but anything appearing ≥2 times survives regardless of whether it's a real name — a term repeated across reference/glossary material (which is exactly where character names cluster) gets no extra scrutiny for being noise.

## Proposed scoped fix (for a future pass)

1. **Strip leading filler words** before a multi-word candidate is evaluated (e.g. a small `FILLER_PREFIXES = {"about", "the", "a", "an", "with", "from", "near"}` set, checked against the first word) — turns "About S-Dawn" into "S-Dawn" before classification runs.
2. **Generalize common-word rejection** beyond the hand-maintained `STOPWORDS` list — e.g. reject a single-word candidate that matches a bundled common-English-word frequency list, or that has a common adjective/adverb suffix (`-able`, `-ing`, `-ed`, `-ly`) *unless* spaCy NER independently tagged it as `PERSON`/`GPE`/`FAC`/`ORG`/`LOC`.
3. **Bias ambiguous proximity guesses to "Needs Review"** instead of defaulting to `"Character"` — matches the user's own example directly: an unclear case should ask for review, not confidently mis-tag as a person.
4. **Fixture-driven regression testing**: add a small, explicit fixture set of known-good and known-bad names — including the user's own reported examples ("ACCEPTABLE" should be rejected; "S-Dawn"/"About S-Dawn" should not default to Character) — to `tools/manuscript-guide/core/tests/test_manuscript_guide.py`, and iterate the heuristics against it rather than promising a general accuracy guarantee. This is a heuristic-tuning problem with both false-positive and false-negative tradeoffs on any change; treat it as ongoing, not a one-shot fix.

## Not proposed here

Replacing the rule/spaCy approach with a different model or an LLM-based extractor — that's a bigger architectural change that would need its own research/cost tradeoff discussion, out of scope for this backlog note.
