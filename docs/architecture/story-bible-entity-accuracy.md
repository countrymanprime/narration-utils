# Story Bible entity-extraction accuracy

**Status: Implemented** in `sidecars/manuscript-guide/core/manuscript_guide.py`, with regression tests in `sidecars/manuscript-guide/tests/test_manuscript_guide.py` (`StrictEntityExtractionTests`).

**Policy: precision over recall, chosen deliberately by the user.** Direct quote: "i would rather miss a few due to being stricter than picking up half the dictionary in single words because we let anything in." Every rule below trades missed names for fewer junk entries. A real name that gets missed can be added by hand (manual entities); junk that floods the Story Bible cannot be reviewed away one entry at a time.

## Failure modes this addressed

1. **Common-word false positives.** The `CAPITALIZED` regex matches any capitalized word, including sentence-initial descriptive words ("Abandoned", "Adorable", "Afraid", "Active") and ALL-CAPS words ("ACCEPTABLE"). The hand-maintained `STOPWORDS` list cannot cover every English word.
2. **Filler-word contamination.** "About S-Dawn" survived as a name because "S-Dawn" alone is not a stopword.
3. **Proximity-heuristic misclassification.** `classify()` guessed Character/Place from words within 28 characters, so an unexplained term like "S-Dawn" could land as a Character.
4. **Repetition implies legitimacy.** Anything seen twice survived regardless of whether it was a name.

## Rules that shipped

**Shared signals (computed once per build by `word_stats`).**

- `lowercase_forms`: every word that appears wholly lowercase anywhere in the manuscript. This is the dictionary-free "common word" signal: if the manuscript itself uses "abandoned" in lowercase, "Abandoned" is not a name.
- `mid_sentence_counts`: how often each capitalized word appears somewhere other than the first word of a sentence. Sentence starts are detected after `.`, `!`, `?`, `…` (skipping quotes and brackets) or at the paragraph start.

**Cleaning (both paths).** `clean_entity_text` strips leading filler words (`FILLER_PREFIXES`: about, the, a, an, with, from, near, of, in, on, at, to, by, plus every `STOPWORDS` entry), trailing punctuation and a trailing possessive, keeping the character offsets in step. "About S-Dawn" becomes "S-Dawn". A name that is nothing but filler is dropped.

**Common-word test (`is_common_word`, single-word candidates only).** Rejected when its lowercase form is in `lowercase_forms`, or when it has a common adjective/adverb suffix (-able, -ible, -ing, -ed, -ly, -ous, -ful, -less, -ive; the stem must be at least 3 letters so "Ned" and "Fred" are not caught). The one override: a spaCy entity tag (PERSON/ORG/GPE/LOC/FAC) **and** at least two capitalized mid-sentence mentions.

**spaCy path (`spacy_candidates`).** Keeps PERSON/ORG/GPE/LOC/FAC entities, cleans them as above, and drops single-word entities that fail the common-word test.

**Rules-only fallback (`rule_candidates`, used when the spaCy model is unavailable).** A cleaned candidate is accepted only if it is multi-word, or a single word that passes the common-word test (no spaCy override here) **and** either appears capitalized mid-sentence at least twice or is the short form of an accepted title-prefixed name ("Arelian" after "Captain Arelian"). Sentence-initial-only words are therefore rejected.

**Classification (`classify`).** The explicit rules are unchanged (ORG_WORDS, PLACE_WORDS, TITLE_WORDS, spaCy labels). The `PERSON_WORDS`/`PLACE_WORDS` proximity guess now applies only to multi-word names. Anything else returns `"Needs Review"` instead of defaulting toward Character. When an entity's occurrences vote for several categories, a confident category beats "Needs Review" votes.

**Build filter (`build_entities`).** A `"Needs Review"` entity is dropped unless it has at least 3 occurrences (was: dropped only when rule-based with fewer than 2).

**Proofing vocabulary (`vocabulary_candidates`).** Excludes every `"Needs Review"` entity and any single-word entity that is neither locked nor manual and has fewer than 3 occurrences, so "Suggest from manuscript" is not polluted.

**Unchanged.** Locked and manual entities are never touched by these rules: `merge_locked` still preserves them (including ones a rebuild would no longer extract), and `edit()` still rejects field changes on locked entities (ADR-0007).

## Known trade-offs

- In the rules-only fallback, a lone-word name is always "Needs Review" (no proximity guessing) and so needs 3 occurrences to appear. Installing the spaCy model gives real Character/Place/Organization labels.
- Multi-word capitalized phrases are trusted as proper-name-shaped, so a run such as "Abandoned And Afraid" can still appear; it stays "Needs Review" and is dropped below 3 occurrences.
- Names that are also lowercase words in the manuscript ("Hope", "Grace") and names ending in a common suffix ("Sterling") are missed unless spaCy tags them and they appear capitalized mid-sentence twice. Add these as manual entities.
- Name matching is not a general accuracy guarantee; the fixtures in `StrictEntityExtractionTests` pin the reported examples ("ACCEPTABLE", "Abandoned", "About S-Dawn") and should grow with any new report.

## Not proposed here

Replacing the rule/spaCy approach with a different model or an LLM-based extractor — that's a bigger architectural change that would need its own research/cost tradeoff discussion, out of scope for this note.
