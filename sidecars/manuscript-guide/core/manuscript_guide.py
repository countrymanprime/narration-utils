"""Local backend for the independent REAPER Manuscript Guide.

The only shared contract with other REAPER tools is the project's canonical
``narration-utils/manuscript/manuscript.json`` file. All output belongs in the caller-provided
ManuscriptGuide directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import wave
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, NamedTuple

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "libs" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common import manuscript as canonical_manuscript
from narration_common.config import get_default
from narration_common.logging_utils import log, set_log_file
from narration_common.progress import write_progress

if TYPE_CHECKING:
    from piper.voice import PiperVoice

SCHEMA_VERSION = 2
CAPITALIZED = re.compile(r"\b[A-Z][A-Za-z'’-]*(?:\s+(?:(?:of|the|and)\s+)?[A-Z][A-Za-z'’-]*){0,3}\b")
SENTENCES = re.compile(r"(?<=[.!?])\s+")
STOPWORDS = {
    "A",
    "About",
    "Above",
    "After",
    "An",
    "And",
    "As",
    "At",
    "But",
    "Before",
    "Chapter",
    "For",
    "He",
    "Her",
    "His",
    "I",
    "In",
    "It",
    "Its",
    "My",
    "No",
    "Now",
    "Not",
    "Of",
    "On",
    "Or",
    "Our",
    "She",
    "So",
    "The",
    "Their",
    "They",
    "This",
    "That",
    "Then",
    "These",
    "Those",
    "To",
    "We",
    "When",
    "With",
    "You",
    "Your",
}
# Story Bible extraction deliberately favours precision over recall - see
# docs/architecture/story-bible-entity-accuracy.md. Better to miss a few names
# than to surface half the dictionary.
FILLER_PREFIXES = {"about", "the", "a", "an", "with", "from", "near", "of", "in", "on", "at", "to", "by"}
LEADING_FILLER_WORDS = FILLER_PREFIXES | {word.lower() for word in STOPWORDS}
LEADING_FILLER = re.compile(r"^(?:(?:" + "|".join(sorted(map(re.escape, LEADING_FILLER_WORDS))) + r")\s+)+", re.IGNORECASE)
POSSESSIVE = re.compile(r"['’]s$", re.IGNORECASE)
TRAILING_PUNCTUATION = " ,.;:!?\"'”’"
CAPITAL_TOKEN = re.compile(r"\b[A-Z][A-Za-z'’-]*\b")
LOWERCASE_TOKEN = re.compile(r"(?<![A-Za-z])[a-z]+(?:[-'’][a-z]+)*(?![A-Za-z])")
SENTENCE_END_CHARACTERS = ".!?…"
SENTENCE_START_SKIPPABLE = " \t\r\n\"'“”‘’()[]{}"
SENTENCE_START_LOOKBEHIND = 16
SPACY_ENTITY_LABELS = {"PERSON", "ORG", "GPE", "LOC", "FAC"}
COMMON_WORD_SUFFIXES = ("able", "ible", "ing", "ed", "ly", "ous", "ful", "less", "ive")
MIN_SUFFIX_STEM_LENGTH = 3  # "Ned" and "Fred" are names, not -ed adjectives.
MIN_MID_SENTENCE_MENTIONS = 2
MIN_NEEDS_REVIEW_OCCURRENCES = 3
MIN_SINGLE_WORD_VOCABULARY_OCCURRENCES = 3
PERSON_WORDS = {"said", "asked", "replied", "cried", "whispered", "smiled", "walked", "looked", "thought"}
PLACE_WORDS = {"city", "town", "village", "kingdom", "country", "street", "river", "mountain", "forest", "castle", "planet", "station", "island"}
ORG_WORDS = {"company", "guild", "order", "society", "council", "army", "agency", "corporation", "clan", "house", "university", "church"}
TITLE_WORDS = {
    "captain",
    "commander",
    "doctor",
    "dr",
    "lady",
    "lord",
    "master",
    "miss",
    "mister",
    "mr",
    "mrs",
    "ms",
    "professor",
    "queen",
    "king",
    "prince",
    "princess",
    "saint",
    "sir",
}
TRAITS = {
    "angry",
    "anxious",
    "arrogant",
    "brave",
    "calm",
    "careful",
    "cautious",
    "cheerful",
    "clever",
    "cold",
    "cruel",
    "curious",
    "determined",
    "fearful",
    "fierce",
    "gentle",
    "generous",
    "gruff",
    "honest",
    "kind",
    "loyal",
    "nervous",
    "patient",
    "proud",
    "quiet",
    "ruthless",
    "sad",
    "shy",
    "stern",
    "tired",
    "warm",
    "wise",
    "wary",
}
ARPABET_TO_IPA = {
    "AA": "ɑ",
    "AE": "æ",
    "AH": "ʌ",
    "AO": "ɔ",
    "AW": "aʊ",
    "AY": "aɪ",
    "B": "b",
    "CH": "tʃ",
    "D": "d",
    "DH": "ð",
    "EH": "ɛ",
    "ER": "ɝ",
    "EY": "eɪ",
    "F": "f",
    "G": "ɡ",
    "HH": "h",
    "IH": "ɪ",
    "IY": "i",
    "JH": "dʒ",
    "K": "k",
    "L": "l",
    "M": "m",
    "N": "n",
    "NG": "ŋ",
    "OW": "oʊ",
    "OY": "ɔɪ",
    "P": "p",
    "R": "r",
    "S": "s",
    "SH": "ʃ",
    "T": "t",
    "TH": "θ",
    "UH": "ʊ",
    "UW": "u",
    "V": "v",
    "W": "w",
    "Y": "j",
    "Z": "z",
    "ZH": "ʒ",
}


def document_hash(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_manuscript(path: str) -> list[dict[str, str]]:
    data = canonical_manuscript.load_file(path)
    narratable_ids = {chapter["id"] for chapter in data["chapters"] if chapter.get("contentKind", "narration") == "narration"}
    paragraphs = [
        {"chapter": item["chapterTitle"], "chapterId": item["chapterId"], "paragraphId": item["id"], "text": item["text"]}
        for item in data["paragraphs"]
        if item["chapterId"] in narratable_ids
    ]
    if not paragraphs:
        raise ValueError("The manuscript has no readable text paragraphs.")
    return paragraphs


def normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def entity_id(name: str) -> str:
    return "entity-" + hashlib.sha1(normalize_name(name).encode("utf-8")).hexdigest()[:12]


def excerpt(text: str, start: int, end: int, radius: int = 150) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    value = text[left:right].strip()
    return ("…" if left else "") + value + ("…" if right < len(text) else "")


def find_occurrences(paragraphs: list[dict[str, str]], name: str) -> list[dict[str, Any]]:
    """Literal, case-insensitive, whole-word search for exactly one known name -
    used by rescan/create/merge, unlike rule_candidates/spacy_candidates which
    look for brand new candidates. Returns ready-to-store evidence dicts: the
    canonical name and each alias keep their OWN occurrence list (mirroring the
    approved design), so this is called once per name rather than once per
    entity with everything flattened together."""
    escaped = re.escape(name.strip())
    if not escaped:
        return []
    pattern = re.compile(r"\b" + escaped + r"\b", re.IGNORECASE)
    found: list[dict[str, Any]] = []
    for para_index, paragraph in enumerate(paragraphs):
        text = paragraph["text"]
        for match in pattern.finditer(text):
            found.append(
                {
                    "chapter": paragraph["chapter"],
                    "chapterId": paragraph["chapterId"],
                    "paragraph": para_index,
                    "paragraphId": paragraph["paragraphId"],
                    "excerpt": excerpt(text, match.start(), match.end()),
                }
            )
    return found


class WordStats(NamedTuple):
    """Manuscript-wide signals used to tell names from ordinary words without a dictionary."""

    # Every word that appears wholly lowercase somewhere in the manuscript.
    lowercase_forms: frozenset[str]
    # Capitalized tokens (normalized) that are NOT the first word of a sentence.
    mid_sentence_counts: Counter[str]


def is_sentence_start(text: str, index: int) -> bool:
    """True when the word at `index` opens a sentence (or the paragraph)."""
    prefix = text[max(0, index - SENTENCE_START_LOOKBEHIND) : index].rstrip(SENTENCE_START_SKIPPABLE)
    if not prefix:
        return index <= SENTENCE_START_LOOKBEHIND
    return prefix[-1] in SENTENCE_END_CHARACTERS


def word_stats(paragraphs: list[dict[str, str]]) -> WordStats:
    lowercase_forms: set[str] = set()
    mid_sentence_counts: Counter[str] = Counter()
    for paragraph in paragraphs:
        text = paragraph["text"]
        for token in LOWERCASE_TOKEN.findall(text):
            lowercase_forms.add(token)
            lowercase_forms.update(part for part in re.split(r"[-'’]", token) if len(part) > 1)
        for match in CAPITAL_TOKEN.finditer(text):
            if not is_sentence_start(text, match.start()):
                mid_sentence_counts[normalize_name(POSSESSIVE.sub("", match.group(0)))] += 1
    return WordStats(frozenset(lowercase_forms), mid_sentence_counts)


def is_stopword(word: str) -> bool:
    return word.lower() in LEADING_FILLER_WORDS


def clean_entity_text(raw: str, start: int) -> tuple[str, int, int] | None:
    """Strip filler ("About S-Dawn" -> "S-Dawn"), possessives and punctuation.

    Returns the cleaned name with its offsets in the source text, or None when
    nothing name-like is left."""
    body = raw.lstrip()
    start += len(raw) - len(body)
    body = POSSESSIVE.sub("", body.rstrip(TRAILING_PUNCTUATION))
    name = LEADING_FILLER.sub("", body)
    start += len(body) - len(name)
    if not name or all(is_stopword(word) for word in name.split()):
        return None
    return name, start, start + len(name)


def has_common_suffix(word: str) -> bool:
    letters = re.sub(r"[^a-z]", "", word.lower())
    return any(letters.endswith(suffix) and len(letters) >= len(suffix) + MIN_SUFFIX_STEM_LENGTH for suffix in COMMON_WORD_SUFFIXES)


def is_common_word(name: str, stats: WordStats, spacy_tagged: bool) -> bool:
    """A single-word candidate is a common word when it also occurs in lowercase in
    the manuscript, or looks like an adjective/adverb. Only a spaCy entity tag
    backed by two capitalized mid-sentence mentions overrides that."""
    if spacy_tagged and stats.mid_sentence_counts[normalize_name(name)] >= MIN_MID_SENTENCE_MENTIONS:
        return False
    return name.lower() in stats.lowercase_forms or has_common_suffix(name)


def make_candidate(paragraph: dict[str, str], para_index: int, name: str, start: int, end: int, source: str) -> dict[str, str]:
    return {
        "name": name,
        "chapter": paragraph["chapter"],
        "chapterId": paragraph.get("chapterId", f"legacy-chapter-{para_index}"),
        "paragraph": str(para_index),
        "paragraphId": paragraph.get("paragraphId", f"legacy-paragraph-{para_index}"),
        "text": paragraph["text"],
        "start": str(start),
        "end": str(end),
        "source": source,
    }


def is_title_prefixed(name: str) -> bool:
    words = name.split()
    return len(words) > 1 and words[0].lower().strip(".") in TITLE_WORDS


def accept_rule_name(name: str, stats: WordStats, title_aliases: set[str]) -> bool:
    """Rules-only acceptance: multi-word names pass; a single word must not look
    like a common word AND must either be the short form of an already accepted
    "Captain X" style name or be capitalized mid-sentence at least twice."""
    if len(name.split()) > 1:
        return True
    if is_common_word(name, stats, spacy_tagged=False):
        return False
    key = normalize_name(name)
    return key in title_aliases or stats.mid_sentence_counts[key] >= MIN_MID_SENTENCE_MENTIONS


def rule_candidates(paragraphs: list[dict[str, str]]) -> list[dict[str, str]]:
    stats = word_stats(paragraphs)
    mentions: list[tuple[int, str, int, int]] = []
    for para_index, paragraph in enumerate(paragraphs):
        for match in CAPITALIZED.finditer(paragraph["text"]):
            cleaned = clean_entity_text(match.group(0), match.start())
            if cleaned is not None:
                mentions.append((para_index, *cleaned))
    title_aliases = {normalize_name(name.split()[-1]) for _, name, _, _ in mentions if is_title_prefixed(name)}
    return [
        make_candidate(paragraphs[para_index], para_index, name, start, end, "rule")
        for para_index, name, start, end in mentions
        if accept_rule_name(name, stats, title_aliases)
    ]


# The model argument that builds with the rules-only extraction on purpose (the narrator chose it for this build), as opposed to a model that
# was asked for and could not be loaded. The host sends it; it is the same word as guide.RulesOnly in Go.
RULES_ONLY = "rules-only"


def spacy_candidates(paragraphs: list[dict[str, str]], model_name: str) -> list[dict[str, str]] | None:
    if model_name == RULES_ONLY:
        log("Extraction: rules-only, chosen for this build. It is lower quality than a language model.")
        return None
    try:
        import spacy

        nlp = spacy.load(model_name, disable=["parser", "lemmatizer", "textcat"])
    except Exception as exc:  # Local rule extraction is a supported fallback.  # noqa: BLE001
        log(f"WARNING: spaCy model unavailable ({exc}); using lower-quality rules-only extraction.")
        return None
    stats = word_stats(paragraphs)
    found: list[dict[str, str]] = []
    for para_index, (paragraph, doc) in enumerate(zip(paragraphs, nlp.pipe(p["text"] for p in paragraphs))):
        for ent in doc.ents:
            if ent.label_ not in SPACY_ENTITY_LABELS:
                continue
            cleaned = clean_entity_text(ent.text, ent.start_char)
            if cleaned is None:
                continue
            name, start, end = cleaned
            if len(name.split()) == 1 and is_common_word(name, stats, spacy_tagged=True):
                continue
            found.append(make_candidate(paragraph, para_index, name, start, end, ent.label_))
    return found


def classify(candidate: dict[str, str]) -> str:
    source = candidate["source"]
    if source == "PERSON":
        return "Character"
    if source in {"GPE", "LOC", "FAC"}:
        return "Place"
    if source == "ORG":
        return "Organization"
    name_words = set(re.findall(r"[a-z]+", candidate["name"].lower()))
    if name_words & ORG_WORDS:
        return "Organization"
    if name_words & PLACE_WORDS:
        return "Place"
    if name_words & TITLE_WORDS:
        return "Character"
    # Nothing confident applies to a lone word: a nearby "said" or "river" is not
    # enough to call it a person or place (e.g. "S-Dawn"), so ask for review
    # instead of guessing. spaCy-tagged entities already returned above.
    if len(candidate["name"].split()) < 2:
        return "Needs Review"
    text = candidate["text"].lower()
    start, end = int(candidate["start"]), int(candidate["end"])
    before = re.findall(r"[a-z]+", text[max(0, start - 28) : start])
    after = re.findall(r"[a-z]+", text[end : min(len(text), end + 28)])
    if any(word in after for word in PERSON_WORDS):
        return "Character"
    if any(word in before for word in PLACE_WORDS):
        return "Place"
    if any(word in before for word in PERSON_WORDS):
        return "Character"
    return "Needs Review"


def arpabet_to_ipa(phones: str) -> str:
    output: list[str] = []
    for phone in phones.split():
        output.append(ARPABET_TO_IPA.get(re.sub(r"\d", "", phone), phone.lower()))
    return " ".join(output)


PRONUNCIATION_SOURCES = {"cmu", "espeak"}


def pronounce_source(name: str, espeak_library: str | None, source: str) -> dict[str, str]:
    """Gets a pronunciation from exactly one named engine, raising when that engine has nothing for ``name``.

    Unlike ``pronunciation()`` (the automatic CMU-then-eSpeak fallback used at build time, which never raises), this
    is what the narrator's explicit Generate/Replace control uses (B10): the narrator chose the engine, so a miss is
    reported, not silently swallowed into "not generated".
    """
    if source == "cmu":
        import pronouncing

        words = re.findall(r"[A-Za-z]+", name)
        phones = [pronouncing.phones_for_word(word.lower())[0] for word in words if pronouncing.phones_for_word(word.lower())]
        if not (words and len(phones) == len(words)):
            raise ValueError(f'The CMU dictionary has no entry for "{name}".')
        return {"ipa": " ".join(arpabet_to_ipa(phone) for phone in phones), "source": "CMU dictionary", "confidence": "medium"}
    if source == "espeak":
        from phonemizer import phonemize

        if espeak_library:
            from phonemizer.backend.espeak.wrapper import EspeakWrapper

            EspeakWrapper.set_library(espeak_library)
        ipa = phonemize(name, language="en-us", backend="espeak", strip=True, with_stress=True)
        if not ipa:
            raise ValueError(f'eSpeak produced no pronunciation for "{name}".')
        return {"ipa": ipa, "source": "eSpeak NG", "confidence": "low"}
    raise ValueError(f"Unknown pronunciation source: {source!r}.")


PRONUNCIATION_UNAVAILABLE_LOG = {"cmu": "CMU pronunciation unavailable", "espeak": "eSpeak phonetic fallback unavailable"}


def pronunciation(name: str, espeak_library: str | None) -> dict[str, str]:
    # CMU is quick and high-quality for familiar names. It cannot cover most fantasy names.
    # Read-only/generated-only: there is no user-editable "say it as" respelling
    # any more, so this never needs to round-trip anything but the IPA itself.
    for source in ("cmu", "espeak"):
        try:
            return pronounce_source(name, espeak_library, source)
        except Exception as exc:  # noqa: BLE001
            log(f"{PRONUNCIATION_UNAVAILABLE_LOG[source]} ({exc}).")
    return {"ipa": "", "source": "not generated", "confidence": "unknown"}


def trait_notes(name: str, occurrences: list[dict[str, str]]) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    seen: set[str] = set()
    searchable_names = {name.lower(), name.lower().split()[-1]}
    for occurrence in occurrences:
        for sentence in SENTENCES.split(occurrence["text"]):
            if not any(searchable_name in sentence.lower() for searchable_name in searchable_names):
                continue
            words = set(re.findall(r"[a-z]+", sentence.lower()))
            for trait in sorted(words & TRAITS):
                note = f"Described as {trait}."
                if note not in seen:
                    seen.add(note)
                    notes.append({"text": note, "evidence": {"chapter": occurrence["chapter"], "excerpt": sentence.strip()}})
    return notes[:5]


def direct_description(name: str, occurrences: list[dict[str, str]]) -> dict[str, Any]:
    """Return only an explicit appositive/copular description, never a guess."""
    names = [re.escape(name), re.escape(name.split()[-1])]
    for occurrence in occurrences:
        # build_entities() candidates carry the full paragraph "text", but
        # find_occurrences() (used by create/rescan/merge) only stores a
        # truncated "excerpt" - fall back to it instead of crashing.
        source_text = occurrence.get("text", occurrence.get("excerpt", ""))
        for sentence in SENTENCES.split(source_text):
            for candidate in names:
                match = re.search(
                    rf"\b{candidate}\b\s*(?:,\s*)?(?:was|is)\s+(?:an?|the)\s+([^,.!;]+)",
                    sentence,
                    flags=re.IGNORECASE,
                )
                if match:
                    description = match.group(1).strip()
                    return {
                        "text": f"Explicitly described as {description}.",
                        "evidence": {"chapter": occurrence["chapter"], "excerpt": sentence.strip()},
                    }
    return {"text": "", "evidence": {}}


def evidence_entries(items: list[dict[str, str]]) -> list[dict[str, Any]]:
    return [
        {
            "chapter": item["chapter"],
            "chapterId": item["chapterId"],
            "paragraph": int(item["paragraph"]),
            "paragraphId": item["paragraphId"],
            "excerpt": excerpt(item["text"], int(item["start"]), int(item["end"])),
        }
        for item in items
    ]


def build_entities(paragraphs: list[dict[str, str]], model_name: str, espeak_library: str | None) -> list[dict[str, Any]]:
    spacy = spacy_candidates(paragraphs, model_name)
    candidates = rule_candidates(paragraphs) if spacy is None else spacy
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for candidate in candidates:
        name = candidate["name"]
        normalized = normalize_name(name)
        if len(normalized) < 2 or name in STOPWORDS:
            continue
        grouped[normalized].append(candidate)

    # Fiction commonly introduces "Captain Arelian" and then uses "Arelian".
    # Merge only this conservative title-prefix pattern; all other possible
    # aliases remain separate review candidates rather than risky guesses.
    for short_name in list(grouped):
        if short_name not in grouped:
            continue
        for long_name in list(grouped):
            if long_name == short_name or not long_name.endswith(short_name):
                continue
            long_words = grouped[long_name][0]["name"].lower().split()
            if long_words and long_words[0].strip(".") in TITLE_WORDS:
                grouped[long_name].extend(grouped.pop(short_name))
                break

    entities: list[dict[str, Any]] = []
    for normalized, occurrences in grouped.items():
        category_counts: dict[str, int] = defaultdict(int)
        for occurrence in occurrences:
            category_counts[classify(occurrence)] += 1
        # A confident category beats "Needs Review" votes (e.g. a bare alias of a
        # "Captain X" name); only unresolved entities stay in review.
        confident_counts = {name: count for name, count in category_counts.items() if name != "Needs Review"}
        category = max(confident_counts, key=confident_counts.get) if confident_counts else "Needs Review"
        # Ambiguous junk is not surfaced unless it recurs.
        if category == "Needs Review" and len(occurrences) < MIN_NEEDS_REVIEW_OCCURRENCES:
            continue
        names = sorted({item["name"] for item in occurrences}, key=lambda value: (-len(value), value))
        canonical_name = names[0]
        alias_names = [name for name in names if name != canonical_name]

        # Each literal spelling keeps its OWN evidence list (this is what lets
        # the UI show "alias: X" against the specific occurrences that spelling
        # produced), rather than one flat list for the whole entity.
        by_literal_name: dict[str, list[dict[str, str]]] = defaultdict(list)
        for item in occurrences:
            by_literal_name[item["name"]].append(item)

        canonical_evidence = evidence_entries(by_literal_name.get(canonical_name, []))
        aliases = [
            {
                "text": name,
                "pronunciation": pronunciation(name, espeak_library),
                "occurrences": evidence_entries(by_literal_name.get(name, [])),
            }
            for name in alias_names
        ]

        entities.append(
            {
                "id": entity_id(canonical_name),
                "canonical_name": canonical_name,
                "aliases": aliases,
                "category": category,
                "occurrences": canonical_evidence,
                "occurrence_count": len(occurrences),
                "pronunciation": pronunciation(canonical_name, espeak_library),
                "description": direct_description(canonical_name, occurrences),
                "personality_notes": trait_notes(canonical_name, occurrences) if category == "Character" else [],
                "context": "",
                "relationships": [],
                "properties": [],
                "locked": False,
                "manual": False,
                "review_state": "needs review" if category == "Needs Review" else "generated",
            }
        )
    found_counts = Counter(entity["category"] for entity in entities)
    log(
        "found entity candidates",
        level="debug",
        event="guide.entities_found",
        entity_count=len(entities),
        **{name.lower().replace(" ", "_"): count for name, count in found_counts.items()},
    )
    return sorted(entities, key=lambda entity: (entity["category"], entity["canonical_name"].lower()))


def is_vocabulary_worthy(entity: dict[str, Any]) -> bool:
    """Needs Review entries and thinly evidenced lone words stay out of the
    Proofing suggestions; locked and manual entries are the user's own."""
    if entity.get("category") == "Needs Review":
        return False
    if entity.get("locked") or entity.get("manual"):
        return True
    if len(entity.get("canonical_name", "").split()) > 1:
        return True
    count = entity.get("occurrence_count")
    if count is None:
        count = entity_occurrence_count(entity)
    return count >= MIN_SINGLE_WORD_VOCABULARY_OCCURRENCES


def vocabulary_candidates(entities: list[dict[str, Any]]) -> list[str]:
    """Return the durable, narrator-reviewable vocabulary candidate list.

    The guide already contains the manuscript-derived names and aliases we
    want Whisper to recognize.  Keeping this list in the guide manifest makes
    proofing suggestions reproducible and avoids a second ad-hoc DOCX scan.
    """
    values: list[str] = []
    for entity in entities:
        if not is_vocabulary_worthy(entity):
            continue
        values.append(entity.get("canonical_name", ""))
        values.extend(alias.get("text", "") for alias in entity.get("aliases", []))
    return sorted({value.strip() for value in values if value and value.strip()}, key=str.casefold)


def load_json(path: str) -> dict[str, Any] | None:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    # A handful of guide manifests from an earlier schema store a plain alias
    # name instead of {text, pronunciation, occurrences}; normalize once here
    # so every downstream reader can assume the current shape.
    for entity in data.get("entities", []) if isinstance(data, dict) else []:
        aliases = entity.get("aliases")
        if isinstance(aliases, list):
            entity["aliases"] = [alias if isinstance(alias, dict) else {"text": alias, "pronunciation": {}, "occurrences": []} for alias in aliases]
    return data


def merge_locked(generated: list[dict[str, Any]], old: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not old:
        return generated
    previous = {entity["id"]: entity for entity in old.get("entities", [])}
    absorbed_names: dict[str, str] = old.get("absorbed_names", {})

    # A name a previous `merge` absorbed into another entity would otherwise
    # come back as its own standalone entity on the very next rebuild, since
    # rule/spaCy extraction has no memory of the merge - it just sees "Nico" in
    # the text again. Redirect any freshly generated entity whose name was
    # absorbed into folding into its merge target as an alias instead of
    # standing alone, so a rebuild can't silently undo a merge.
    redirected: dict[str, list[dict[str, Any]]] = defaultdict(list)
    still_standalone: list[dict[str, Any]] = []
    for entity in generated:
        target_id = absorbed_names.get(normalize_name(entity["canonical_name"]))
        if target_id and target_id != entity["id"] and (target_id in previous or any(e["id"] == target_id for e in generated)):
            redirected[target_id].append(entity)
        else:
            still_standalone.append(entity)
    generated = still_standalone

    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for entity in generated:
        prior = previous.get(entity["id"])
        if prior and (prior.get("locked") or prior.get("manual")):
            # A fully locked entry is untouched by rebuilds, including its
            # occurrence list - rescan is the only way to refresh it. A manually
            # created entity is never rediscovered by rule/spaCy extraction at
            # all, so it must survive every rebuild the same way, locked or not.
            merged.append(prior)
            seen_ids.add(prior["id"])
            continue
        if prior:
            # User-authored material is never replaced by an empty generated value.
            for field in ("description", "personality_notes", "context"):
                if prior.get(field) and not entity.get(field):
                    entity[field] = prior[field]
            entity["relationships"] = prior.get("relationships", [])
            # Properties are the narrator's own facts and extraction never produces them, so a rebuild keeps them all.
            entity["properties"] = entity_properties(prior)
            # A pronunciation the narrator explicitly chose (pronounce(), marked "chosen") survives a rebuild too,
            # the same as a locked entity's - only an auto-generated one is replaced by the fresh build (B11).
            if (prior.get("pronunciation") or {}).get("chosen"):
                entity["pronunciation"] = prior["pronunciation"]
            # An alias added by hand (typed in, or the product of a merge) can
            # never be "rediscovered" by extraction the way the automatic
            # title-prefix aliases can, so anything prior-only survives too.
            fresh_alias_texts = {alias["text"].lower() for alias in entity.get("aliases", [])}
            for alias in prior.get("aliases", []):
                if alias["text"].lower() not in fresh_alias_texts:
                    entity.setdefault("aliases", []).append(alias)
                    fresh_alias_texts.add(alias["text"].lower())
            entity["occurrence_count"] = entity_occurrence_count(entity)
        merged.append(entity)
        seen_ids.add(entity["id"])
    # Locked or manual entries the rebuild didn't rediscover at all (e.g. a
    # manually created entity with no manuscript occurrences) survive too.
    for entity_id_value, prior in previous.items():
        if (prior.get("locked") or prior.get("manual")) and entity_id_value not in seen_ids:
            merged.append(prior)
            seen_ids.add(entity_id_value)

    if redirected:
        merged_by_id = {entity["id"]: entity for entity in merged}
        for target_id, absorbed_entities in redirected.items():
            target = merged_by_id.get(target_id)
            if not target:
                continue
            existing_alias_texts = {alias["text"].lower() for alias in target.get("aliases", [])} | {target["canonical_name"].lower()}
            for absorbed_entity in absorbed_entities:
                candidates = [
                    {
                        "text": absorbed_entity["canonical_name"],
                        "pronunciation": absorbed_entity.get("pronunciation", {}),
                        "occurrences": absorbed_entity.get("occurrences", []),
                    },
                    *absorbed_entity.get("aliases", []),
                ]
                for candidate in candidates:
                    key = candidate["text"].lower()
                    if key not in existing_alias_texts:
                        target.setdefault("aliases", []).append(candidate)
                        existing_alias_texts.add(key)
            target["occurrence_count"] = entity_occurrence_count(target)
    log(
        "merged generated entities with the saved guide",
        level="debug",
        event="guide.entities_merged",
        generated_count=len(generated),
        merged_count=len(merged),
        redirected_count=sum(len(absorbed) for absorbed in redirected.values()),
    )
    return merged


def write_json(path: str, data: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, target)


def build(args: argparse.Namespace) -> None:
    log("Reading canonical manuscript")
    write_progress(args.progress, "LOAD", 5, "Reading manuscript...")
    source_hash = document_hash(args.manuscript)
    paragraphs = load_manuscript(args.manuscript)
    log(f"Loaded {len(paragraphs):,} paragraphs")
    write_progress(args.progress, "EXTRACT", 30, "Finding people, places, and organizations...")
    previous = load_json(args.out)
    if args.spacy_model != RULES_ONLY:
        log(f"Extracting candidates with spaCy model {args.spacy_model}")
    entities = build_entities(paragraphs, args.spacy_model, args.espeak_library or None)
    write_progress(args.progress, "MERGE", 85, "Preserving locked edits...")
    log("Merging generated entries with locked and manual edits")
    entities = merge_locked(entities, previous)
    guide = {
        "schema_version": SCHEMA_VERSION,
        "source": {"path": str(Path(args.manuscript).resolve()), "sha256": source_hash},
        "generated_at": datetime.now(UTC).isoformat(),
        "entities": entities,
        "vocabulary_candidates": vocabulary_candidates(entities),
        "absorbed_names": (previous or {}).get("absorbed_names", {}),
    }
    write_json(args.out, guide)
    write_progress(args.progress, "DONE", 100, f"Built guide with {len(entities)} entities")
    log(f"Built Story Bible with {len(entities)} entities")
    print(f"BUILT|{len(entities)}|{args.out}")


def status(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        result = "STATUS|MISSING"
    elif guide.get("source", {}).get("sha256") != document_hash(args.manuscript):
        result = "STATUS|STALE"
    else:
        result = "STATUS|CURRENT"
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(result + "\n", encoding="utf-8")
    print(result)


def find_entity(guide: dict[str, Any], entity_id_value: str) -> dict[str, Any]:
    entity = next((value for value in guide["entities"] if value["id"] == entity_id_value), None)
    if entity is None:
        raise ValueError("Entity not found.")
    return entity


# Character/Place/Organization/Needs Review are the only categories rule/spaCy
# extraction ever produces; Lore/Item/Event are manual-only classifications a
# user assigns themselves - there is nothing in the text that would let
# automatic detection guess "this name is Lore" versus "this name is a Place".
# "Needs Review" and "Draft" are system states, not user-choosable targets:
# Needs Review only ever comes from a build, and Draft only from a fresh
# manual entity that hasn't been classified yet.
VALID_CATEGORIES = {"Character", "Place", "Organization", "Lore", "Item", "Event"}
SYSTEM_CATEGORIES = {"Needs Review", "Draft"}


def entity_occurrence_count(entity: dict[str, Any]) -> int:
    return len(entity.get("occurrences", [])) + sum(len(alias.get("occurrences", [])) for alias in entity.get("aliases", []))


def normalize_properties(raw: Any) -> list[dict[str, str]]:
    """Checks an entity's properties and returns them trimmed, in the order given.

    A property is a ``{"key", "value"}`` pair of strings: the labelled facts of a character block ("Codename", "Abilities", "Dossier").
    The list is ordered, and it is a list rather than an object because the host re-marshals the file and would sort an object's keys.
    A key is required and unique whatever its case; a value may be empty. Anything else is refused with the position of the property.
    """
    if not isinstance(raw, list):
        raise ValueError("Properties must be a list of key and value pairs.")  # noqa: TRY004 - every refused input is a ValueError here
    properties: list[dict[str, str]] = []
    seen: set[str] = set()
    for position, item in enumerate(raw, start=1):
        if not isinstance(item, dict) or not isinstance(item.get("key"), str) or not isinstance(item.get("value"), str):
            raise ValueError(f"Property {position} must have a text key and a text value.")  # noqa: TRY004 - every refused input is a ValueError here
        key, value = item["key"].strip(), item["value"].strip()
        if not key:
            raise ValueError(f"Property {position} has no name.")
        if key.casefold() in seen:
            raise ValueError(f"There are two properties named {key!r}; give each a different name.")
        seen.add(key.casefold())
        properties.append({"key": key, "value": value})
    return properties


def parse_properties(text: str) -> list[dict[str, str]]:
    """Reads the properties a command line carries as one JSON value. Empty text is no properties."""
    if not text.strip():
        return []
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"The properties are not valid JSON ({exc}).") from exc
    return normalize_properties(raw)


def entity_properties(entity: dict[str, Any]) -> list[dict[str, str]]:
    """The properties of an entity, empty for a file written before they existed."""
    properties = entity.get("properties")
    return properties if isinstance(properties, list) else []


def apply_edit(entity: dict[str, Any], field: str, value: str, paragraphs: list[dict[str, str]] | None, espeak_library: str | None) -> None:
    """Applies one field edit to ``entity`` in memory. Nothing is written here."""
    if entity.get("locked") and field != "locked":
        raise ValueError("This entity is locked. Unlock it before editing.")
    if field == "locked":
        entity["locked"] = value.strip().lower() in {"1", "true", "yes", "on"}
    elif field == "description":
        entity.setdefault("description", {})["text"] = value
    elif field == "personality":
        entity["personality_notes"] = [{"text": value, "evidence": {"chapter": "User edit", "excerpt": "User-authored note."}}] if value else []
    elif field == "context":
        entity["context"] = value
    elif field == "properties":
        entity["properties"] = parse_properties(value)
    elif field == "category":
        if value in SYSTEM_CATEGORIES or value not in VALID_CATEGORIES:
            raise ValueError(f"Unknown or reserved category: {value}")
        entity["category"] = value
    elif field == "canonical_name":
        entity["canonical_name"] = value
    elif field == "aliases":
        requested = [item.strip() for item in value.split(";") if item.strip()]
        existing_by_text = {alias["text"].lower(): alias for alias in entity.get("aliases", [])}
        new_aliases = []
        for name in requested:
            existing = existing_by_text.get(name.lower())
            if existing:
                new_aliases.append(existing)
                continue
            new_aliases.append(
                {
                    "text": name,
                    "pronunciation": pronunciation(name, espeak_library),
                    "occurrences": find_occurrences(paragraphs, name) if paragraphs is not None else [],
                }
            )
        entity["aliases"] = new_aliases
        entity["occurrence_count"] = entity_occurrence_count(entity)
    else:
        raise ValueError("Unsupported editable field.")


def edit(args: argparse.Namespace) -> None:
    """Edits one or more fields of an entity in a single run (``--field`` and ``--value`` repeat, in pairs).

    Every field is applied in memory and the file is written once, after the last one succeeded, so a bad
    field leaves the file exactly as it was. That is one process for a whole Save instead of one per field.
    """
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    fields = args.field if isinstance(args.field, list) else [args.field]
    values = args.value if isinstance(args.value, list) else [args.value]
    if len(fields) != len(values):
        raise ValueError("Every --field needs a --value.")
    # The manuscript is read only when an alias is edited, to find where the new alias occurs.
    paragraphs = load_manuscript(args.manuscript) if "aliases" in fields and args.manuscript else None
    for field, value in zip(fields, values, strict=True):
        apply_edit(entity, field, value, paragraphs, args.espeak_library or None)
    entity["review_state"] = "reviewed"
    write_json(args.guide, guide)
    print("EDITED|" + args.entity_id)


def rescan(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    paragraphs = load_manuscript(args.manuscript)
    entity["occurrences"] = find_occurrences(paragraphs, entity["canonical_name"])
    for alias in entity.get("aliases", []):
        alias["occurrences"] = find_occurrences(paragraphs, alias["text"])
    entity["occurrence_count"] = entity_occurrence_count(entity)
    if entity.get("review_state") == "needs review" and entity["occurrence_count"]:
        entity["review_state"] = "reviewed"
    write_json(args.guide, guide)
    print(f"RESCANNED|{args.entity_id}|{entity['occurrence_count']}")


def pronounce(args: argparse.Namespace) -> None:
    """Sets the pronunciation of an entity's own name, or one of its aliases, from one named engine (D13/B9/B10).

    Refused on a locked entity, the same as every other edit (ADR 0007). The value is marked ``chosen`` so a later
    rebuild's ``merge_locked`` keeps it instead of overwriting it with a freshly generated one (B11).
    """
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    if entity.get("locked"):
        raise ValueError("This entity is locked. Unlock it before editing.")
    if args.alias_index is None:
        name = entity["canonical_name"]
    else:
        aliases = entity.get("aliases", [])
        if not 0 <= args.alias_index < len(aliases):
            raise ValueError("Alias index out of range.")
        name = aliases[args.alias_index]["text"]
    value = pronounce_source(name, args.espeak_library or None, args.source)
    value["chosen"] = True
    if args.alias_index is None:
        entity["pronunciation"] = value
    else:
        aliases[args.alias_index]["pronunciation"] = value
    write_json(args.guide, guide)
    print(f"PRONOUNCED|{args.entity_id}|{value['source']}")


def create(args: argparse.Namespace) -> None:
    # A manuscript import can seed manual character candidates before the
    # Story Bible has ever been Built, so there may be no guide file yet -
    # start an empty one instead of requiring a prior build. status() then
    # correctly reports it as stale until a real build populates `source`.
    guide = load_json(args.guide) or {
        "schema_version": SCHEMA_VERSION,
        "source": {},
        "generated_at": None,
        "entities": [],
        "vocabulary_candidates": [],
        "absorbed_names": {},
    }
    category = args.category.strip() or "Draft"
    if category != "Draft" and category not in VALID_CATEGORIES:
        raise ValueError(f"Unknown category: {category}")
    name = args.name.strip()
    if not name:
        raise ValueError("Name is required.")
    properties = parse_properties(getattr(args, "properties", "") or "")
    new_id = entity_id(name)
    if any(value["id"] == new_id for value in guide["entities"]):
        raise ValueError("An entity with this name already exists.")
    alias_names = [item.strip() for item in args.aliases.split(";") if item.strip()]
    paragraphs = load_manuscript(args.manuscript)
    canonical_occurrences = find_occurrences(paragraphs, name)
    aliases = [
        {
            "text": alias_name,
            "pronunciation": pronunciation(alias_name, args.espeak_library or None),
            "occurrences": find_occurrences(paragraphs, alias_name),
        }
        for alias_name in alias_names
    ]
    entity = {
        "id": new_id,
        "canonical_name": name,
        "aliases": aliases,
        "category": category,
        "occurrences": canonical_occurrences,
        "pronunciation": pronunciation(name, args.espeak_library or None),
        "description": direct_description(name, canonical_occurrences) if canonical_occurrences else {"text": "", "evidence": {}},
        "personality_notes": [],
        "relationships": [],
        "properties": properties,
        "locked": False,
        "manual": True,
        "review_state": "reviewed",
    }
    description = getattr(args, "description", "")
    if description:
        # The same as an edit of the description right after the create, without a second process for it.
        entity["description"]["text"] = description
    entity["occurrence_count"] = entity_occurrence_count(entity)
    guide["entities"].append(entity)
    write_json(args.guide, guide)
    print(f"CREATED|{new_id}|{entity['occurrence_count']}")


def merge(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    if args.source_id == args.target_id:
        raise ValueError("Cannot merge an entity into itself.")
    source = find_entity(guide, args.source_id)
    target = find_entity(guide, args.target_id)
    if source.get("locked"):
        raise ValueError("Cannot merge a locked entity. Unlock it first.")

    def dedupe_evidence(evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[tuple[str, int, str]] = set()
        result = []
        for item in evidence:
            key = (item.get("chapter", ""), item.get("paragraph", -1), item.get("excerpt", ""))
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
        return sorted(result, key=lambda item: item.get("paragraph", 0))

    # The source's own canonical name becomes a new alias on the target (carrying
    # its pronunciation + evidence along); the source's existing aliases merge in
    # the same way, each keeping its own occurrence list rather than one flat pool.
    target.setdefault("aliases", [])
    existing_by_text = {target["canonical_name"].lower(): None, **{alias["text"].lower(): alias for alias in target["aliases"]}}
    candidates = [
        {"text": source["canonical_name"], "pronunciation": source.get("pronunciation", {}), "occurrences": source.get("occurrences", [])},
        *source.get("aliases", []),
    ]
    for candidate in candidates:
        key = candidate["text"].lower()
        existing = existing_by_text.get(key)
        if existing is not None:
            existing["occurrences"] = dedupe_evidence(existing.get("occurrences", []) + candidate.get("occurrences", []))
        elif key not in existing_by_text:
            new_alias = {"text": candidate["text"], "pronunciation": candidate.get("pronunciation", {}), "occurrences": candidate.get("occurrences", [])}
            target["aliases"].append(new_alias)
            existing_by_text[key] = new_alias

    target["occurrence_count"] = entity_occurrence_count(target)

    seen_relationships: set[tuple[str, str]] = set()
    merged_relationships = []
    for relationship in target.get("relationships", []) + source.get("relationships", []):
        if relationship["id"] in {args.source_id, args.target_id}:
            continue
        key = (relationship["id"], relationship["label"])
        if key in seen_relationships:
            continue
        seen_relationships.add(key)
        merged_relationships.append(relationship)
    target["relationships"] = merged_relationships

    if not target.get("description", {}).get("text") and source.get("description", {}).get("text"):
        target["description"] = source["description"]
    if not target.get("personality_notes") and source.get("personality_notes"):
        target["personality_notes"] = source["personality_notes"]
    # The target's own values win; the source adds the keys the target does not have.
    target_properties = entity_properties(target)
    target_keys = {item["key"].casefold() for item in target_properties}
    target["properties"] = [*target_properties, *(item for item in entity_properties(source) if item["key"].casefold() not in target_keys)]

    for other in guide["entities"]:
        if other["id"] in {args.source_id, args.target_id}:
            continue
        remapped = []
        seen_other: set[tuple[str, str]] = set()
        for relationship in other.get("relationships", []):
            entity_ref = args.target_id if relationship["id"] == args.source_id else relationship["id"]
            if entity_ref == other["id"]:
                continue
            name = target["canonical_name"] if entity_ref == args.target_id else relationship["name"]
            key = (entity_ref, relationship["label"])
            if key in seen_other:
                continue
            seen_other.add(key)
            remapped.append({"id": entity_ref, "name": name, "label": relationship["label"]})
        other["relationships"] = remapped

    guide["entities"] = [value for value in guide["entities"] if value["id"] != args.source_id]
    # Record what got absorbed so the next `build` doesn't resurrect it as a
    # standalone entity the moment it sees the name in the text again - see
    # merge_locked's redirect step, which reads this back.
    absorbed_names = guide.setdefault("absorbed_names", {})
    for absorbed_name in [source["canonical_name"], *(alias["text"] for alias in source.get("aliases", []))]:
        absorbed_names[normalize_name(absorbed_name)] = args.target_id
    write_json(args.guide, guide)
    print(f"MERGED|{args.target_id}")


def delete(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    if entity.get("locked"):
        raise ValueError("Cannot delete a locked entity. Unlock it first.")
    guide["entities"] = [value for value in guide["entities"] if value["id"] != args.entity_id]
    for other in guide["entities"]:
        other["relationships"] = [rel for rel in other.get("relationships", []) if rel["id"] != args.entity_id]
    write_json(args.guide, guide)
    print("DELETED|" + args.entity_id)


def relate(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    if args.entity_id == args.other_id:
        raise ValueError("An entity cannot have a relationship with itself.")
    entity = find_entity(guide, args.entity_id)
    other = find_entity(guide, args.other_id)
    label = args.label.strip()
    if not label:
        raise ValueError("A relationship needs a label.")
    relationships = entity.setdefault("relationships", [])
    if not any(rel["id"] == args.other_id and rel["label"] == label for rel in relationships):
        relationships.append({"id": args.other_id, "name": other["canonical_name"], "label": label})
    write_json(args.guide, guide)
    print("RELATED|" + args.entity_id)


def unrelate(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    entity["relationships"] = [rel for rel in entity.get("relationships", []) if not (rel["id"] == args.other_id and rel["label"] == args.label)]
    write_json(args.guide, guide)
    print("UNRELATED|" + args.entity_id)


def load_voice(model_path: str) -> PiperVoice:
    """Loads a Piper voice. Piper is imported here, not at the top of the module: only ``render-audio`` needs it,
    and importing it costs about a quarter of a second, which every other command (each Save, lock, rescan) would pay."""
    from piper.voice import PiperVoice

    return PiperVoice.load(model_path)


def render_audio(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    if not args.piper_model:
        raise ValueError("Install a verified Piper voice before creating previews.")
    if args.alias_index is None:
        spoken = entity["canonical_name"]
        filename = args.output_name or f"{entity['id']}.wav"
    else:
        aliases = entity.get("aliases", [])
        if not 0 <= args.alias_index < len(aliases):
            raise ValueError("Alias index out of range.")
        spoken = aliases[args.alias_index]["text"]
        filename = args.output_name or f"{entity['id']}__alias{args.alias_index}.wav"
    audio_dir = Path(args.audio_dir)
    audio_dir.mkdir(parents=True, exist_ok=True)
    destination = audio_dir / filename
    # Piper is bundled into this existing sidecar by PyInstaller.  Calling its
    # supported Python API avoids relying on a checkout-local piper.exe or
    # adding a third Python sidecar to the native host.
    try:
        voice = load_voice(args.piper_model)
    except Exception as exc:
        raise ValueError(f"The preview voice could not be loaded ({exc}). If its files are damaged, remove it in Settings and install it again.") from exc
    synthesize_to_file(voice, spoken, destination)
    print("AUDIO|" + str(destination))


def synthesize_to_file(voice: PiperVoice, spoken: str, destination: Path) -> None:
    """Synthesizes ``spoken`` and moves the WAV to ``destination`` only once it is complete.

    The host trusts any file at ``destination`` as a cached preview, so a failed run must
    leave nothing there.  Piper initialises espeak lazily inside ``synthesize_wav``, before
    it sets the WAV format; closing a wave writer in that state raises "# channels not
    specified", which would replace the real error.  So the writer is closed by hand and the
    original failure is what gets reported.
    """
    temporary = destination.with_name(f"{destination.name}.{os.getpid()}.part")
    remove_stale_partials(destination, keep=temporary)
    wav_file = wave.open(str(temporary), "wb")  # noqa: SIM115 - a with block would close it mid-error and mask the failure
    try:
        try:
            voice.synthesize_wav(spoken, wav_file)
            frames = wav_file.getnframes()
        except Exception as exc:
            raise ValueError(f'"{spoken}" could not be spoken: {str(exc) or type(exc).__name__}') from exc
        if frames == 0:
            raise ValueError(f'"{spoken}" could not be spoken: the voice produced no audio for it.')
        try:
            wav_file.close()
            os.replace(temporary, destination)
        except OSError as exc:
            raise ValueError(f"The preview could not be saved ({exc}). Close anything that has the file open and try again.") from exc
    except BaseException:
        try:
            wav_file.close()
        except (wave.Error, OSError):
            pass
        temporary.unlink(missing_ok=True)
        raise


def remove_stale_partials(destination: Path, keep: Path) -> None:
    """Deletes ``<name>.<pid>.part`` files that earlier runs left for this output.

    A run the host stopped at its timeout is killed without running any cleanup, and the
    pid in the name means no later run would overwrite its file.  The host serializes
    renders of one output, so no live run owns these.
    """
    for entry in destination.parent.iterdir():
        if entry != keep and entry.name.startswith(destination.name + ".") and entry.name.endswith(".part"):
            entry.unlink(missing_ok=True)


SELF_CHECK_WORD = "hello"


def check_cmudict() -> str:
    """Looks a common word up in the CMU dictionary. A frozen build without the dictionary's data or package metadata fails here."""
    import pronouncing

    phones = pronouncing.phones_for_word(SELF_CHECK_WORD)
    if not phones:
        raise ValueError(f"the CMU dictionary has no entry for {SELF_CHECK_WORD!r}")
    return f"{SELF_CHECK_WORD} = {phones[0]}"


def check_espeak(data_dir: Path | None = None) -> str:
    """Starts Piper's bundled espeak-ng and phonemizes a common word. A frozen build without ``piper/espeak-ng-data`` fails here."""
    from piper.phonemize_espeak import ESPEAK_DATA_DIR, EspeakPhonemizer

    directory = Path(data_dir) if data_dir is not None else Path(ESPEAK_DATA_DIR)
    if not directory.is_dir():
        raise ValueError(f"the espeak-ng data directory was not found: {directory}")
    sentences = EspeakPhonemizer(directory).phonemize("en-us", SELF_CHECK_WORD)
    phonemes = "".join("".join(sentence) for sentence in sentences)
    if not phonemes.strip():
        raise ValueError(f"espeak-ng produced no phonemes for {SELF_CHECK_WORD!r}")
    return f"{SELF_CHECK_WORD} = {phonemes}"


def check_synthesis(piper_model: str) -> str:
    """Loads a voice and speaks one word into a temporary file, the whole render-audio path without a project."""
    import tempfile

    voice = load_voice(piper_model)
    with tempfile.TemporaryDirectory() as temporary:
        destination = Path(temporary) / "self-check.wav"
        synthesize_to_file(voice, SELF_CHECK_WORD, destination)
        with wave.open(str(destination), "rb") as wav_file:
            frames = wav_file.getnframes()
    return f"spoke {SELF_CHECK_WORD!r}: {frames} frames"


def run_self_check(piper_model: str | None = None, espeak_data_dir: Path | None = None) -> list[dict[str, Any]]:
    """Runs every check, never stopping at the first failure, and returns one result per check.

    The packaged-app smoke test (``narration-utils --smoke``) runs this against the frozen sidecar. The dictionary and the espeak-ng
    data are what a freeze can silently lose (PyInstaller has no hook for either), and losing them made previews fail and names lose
    their pronunciation. The 114 MB voice is not needed for them; pass ``piper_model`` to also speak a word.
    """
    checks: list[tuple[str, Any]] = [("cmudict", check_cmudict), ("espeak", lambda: check_espeak(espeak_data_dir))]
    if piper_model:
        checks.append(("synthesis", lambda: check_synthesis(piper_model)))
    results: list[dict[str, Any]] = []
    for name, check in checks:
        try:
            results.append({"name": name, "ok": True, "detail": check()})
        except Exception as exc:  # noqa: BLE001 - the report says why, whatever it was
            results.append({"name": name, "ok": False, "detail": str(exc) or type(exc).__name__})
    return results


def self_check(args: argparse.Namespace) -> None:
    results = run_self_check(piper_model=args.piper_model or None)
    ok = all(entry["ok"] for entry in results)
    print(json.dumps({"ok": ok, "checks": results}))
    if not ok:
        sys.exit(1)


def use_utf8_stdio() -> None:
    """Writes UTF-8 to the pipes the host reads.

    On Windows a pipe defaults to the ANSI code page, so a project path outside it made
    ``print("AUDIO|" + path)`` raise after the WAV was written and the sidecar exit 1.
    The Go host reads both streams as UTF-8 (strings are bytes there).
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def main() -> None:
    use_utf8_stdio()
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_subparsers(dest="command", required=True)
    build_parser = command.add_parser("build")
    build_parser.add_argument("--manuscript", required=True)
    build_parser.add_argument("--out", required=True)
    build_parser.add_argument("--progress")
    build_parser.add_argument("--log")
    build_parser.add_argument("--spacy-model", default=get_default("ManuscriptGuide", "spacy_model", "en_core_web_sm"))
    build_parser.add_argument("--espeak-library", default="")
    status_parser = command.add_parser("status")
    status_parser.add_argument("--manuscript", required=True)
    status_parser.add_argument("--guide", required=True)
    status_parser.add_argument("--out")
    edit_parser = command.add_parser("edit")
    edit_parser.add_argument("--guide", required=True)
    edit_parser.add_argument("--entity-id", required=True)
    edit_parser.add_argument("--field", required=True, action="append")
    edit_parser.add_argument("--value", required=True, action="append")
    edit_parser.add_argument("--manuscript", default="")
    edit_parser.add_argument("--espeak-library", default="")
    rescan_parser = command.add_parser("rescan")
    rescan_parser.add_argument("--guide", required=True)
    rescan_parser.add_argument("--manuscript", required=True)
    rescan_parser.add_argument("--entity-id", required=True)
    pronounce_parser = command.add_parser("pronounce")
    pronounce_parser.add_argument("--guide", required=True)
    pronounce_parser.add_argument("--entity-id", required=True)
    pronounce_parser.add_argument("--alias-index", type=int, default=None)
    pronounce_parser.add_argument("--source", required=True, choices=sorted(PRONUNCIATION_SOURCES))
    pronounce_parser.add_argument("--espeak-library", default="")
    create_parser = command.add_parser("create")
    create_parser.add_argument("--guide", required=True)
    create_parser.add_argument("--manuscript", required=True)
    create_parser.add_argument("--name", required=True)
    create_parser.add_argument("--category", default="")
    create_parser.add_argument("--aliases", default="")
    create_parser.add_argument("--description", default="")
    create_parser.add_argument("--properties", default="", help='the properties as one JSON list, e.g. [{"key": "Codename", "value": "Wren"}]')
    create_parser.add_argument("--espeak-library", default="")
    merge_parser = command.add_parser("merge")
    merge_parser.add_argument("--guide", required=True)
    merge_parser.add_argument("--source-id", required=True)
    merge_parser.add_argument("--target-id", required=True)
    delete_parser = command.add_parser("delete")
    delete_parser.add_argument("--guide", required=True)
    delete_parser.add_argument("--entity-id", required=True)
    relate_parser = command.add_parser("relate")
    relate_parser.add_argument("--guide", required=True)
    relate_parser.add_argument("--entity-id", required=True)
    relate_parser.add_argument("--other-id", required=True)
    relate_parser.add_argument("--label", required=True)
    unrelate_parser = command.add_parser("unrelate")
    unrelate_parser.add_argument("--guide", required=True)
    unrelate_parser.add_argument("--entity-id", required=True)
    unrelate_parser.add_argument("--other-id", required=True)
    unrelate_parser.add_argument("--label", required=True)
    audio_parser = command.add_parser("render-audio")
    audio_parser.add_argument("--guide", required=True)
    audio_parser.add_argument("--entity-id", required=True)
    audio_parser.add_argument("--audio-dir", required=True)
    audio_parser.add_argument("--piper-model", required=True)
    audio_parser.add_argument("--alias-index", type=int, default=None)
    audio_parser.add_argument("--output-name", default="")
    check_parser = command.add_parser("self-check", help="prove the dictionary and the espeak-ng data this program carries load (the packaged smoke test)")
    check_parser.add_argument("--piper-model", default="", help="also load this voice and speak one word")
    args = parser.parse_args()
    log_handle = None
    if getattr(args, "log", None):
        path = Path(args.log)
        path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = path.open("a", encoding="utf-8")
        set_log_file(log_handle)
    try:
        {
            "build": build,
            "status": status,
            "edit": edit,
            "rescan": rescan,
            "pronounce": pronounce,
            "create": create,
            "merge": merge,
            "delete": delete,
            "relate": relate,
            "unrelate": unrelate,
            "render-audio": render_audio,
            "self-check": self_check,
        }[args.command](args)
    except Exception as exc:  # noqa: BLE001
        log(f"ERROR: {exc}")
        if args.command == "build":
            write_progress(getattr(args, "progress", None), "ERROR", 0, str(exc))
        sys.exit(1)
    finally:
        if log_handle is not None:
            log_handle.close()
            set_log_file(None)


if __name__ == "__main__":
    main()
