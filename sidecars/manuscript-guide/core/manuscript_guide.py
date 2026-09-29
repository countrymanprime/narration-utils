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
from typing import Any, NamedTuple

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "libs" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))
# providers.py is this sidecar's own sibling module; a test that spec-loads this file does not have core/ on sys.path
# the way running the script directly does, so this mirrors the _SHARED_PYTHON insertion above.
_CORE_DIR = Path(__file__).resolve().parent
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

from narration_common import manuscript as canonical_manuscript
from narration_common.config import get_default
from narration_common.logging_utils import log, set_log_file
from narration_common.ports.pronunciation import SOURCES
from narration_common.ports.tts import ENGINES as TTS_ENGINES
from narration_common.progress import write_progress

# Importing this also registers Piper into ENGINES and CMU/eSpeak into SOURCES (ADR 0301, provider-ports P8).
from providers import load_voice, synthesize_to_file

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
# A paragraph made only of this punctuation (***, - - -, # # #, a bullet or dash) is a scene break: it starts a
# new scene and is not itself part of any scene. Character Continuity Review phase 2 (CC-2).
SCENE_BREAK = re.compile(r"^[*#\-–—•·\s]+$")
# Verbs that mark a name next to a quotation as its speaker. Deliberately narrower than PERSON_WORDS above
# (which also accepts "smiled"/"walked"/"looked"/"thought" as a proximity signal for classifying an entity's
# category) - a cue's attribution is precision-first (ADR 0020, Q4): only an unambiguous speech verb counts.
SPEECH_VERBS = {
    "said",
    "asked",
    "replied",
    "cried",
    "whispered",
    "murmured",
    "shouted",
    "answered",
    "exclaimed",
    "muttered",
    "called",
    "continued",
    "added",
    "interrupted",
    "announced",
    "demanded",
    "gasped",
    "laughed",
    "stated",
    "remarked",
    "snapped",
    "yelled",
}
# A double-quoted span (straight or curly quotes; either character may open or close, so this doesn't try to
# track directional pairing). Bounded length avoids a runaway match across an unrelated later quote mark.
QUOTE_PATTERN = re.compile(r'[“"]([^”"]{1,400}?)[”"]')
# Up to three capitalized words, for the name beside a speech verb.
NAME_TOKEN = r"[A-Z][A-Za-z'’\-]*(?:\s+[A-Z][A-Za-z'’\-]*){0,2}"
AFTER_QUOTE_TAG = re.compile(r"^[,.\s]*(" + NAME_TOKEN + r")\s+([A-Za-z]+)")
BEFORE_QUOTE_TAG = re.compile(r"(" + NAME_TOKEN + r")\s+([A-Za-z]+)[,:]?\s*$")
TAG_WINDOW = 60

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


# The narrator's choices for --source, now the pronunciation source registry's own names (ADR 0301, provider-ports P8).
PRONUNCIATION_SOURCES = SOURCES.names()


def pronounce_source(name: str, espeak_library: str | None, source: str) -> dict[str, str]:
    """Gets a pronunciation from exactly one named source, raising when that source has nothing for ``name``.

    Unlike ``pronunciation()`` (the automatic CMU-then-eSpeak fallback used at build time, which never raises), this
    is what the narrator's explicit Generate/Replace control uses (B10): the narrator chose the source, so a miss is
    reported, not silently swallowed into "not generated".
    """
    engine = SOURCES.lookup(source)
    engine.espeak_library = espeak_library
    return engine.pronounce(name)


# The narrator's own pronunciation (prep-depth P1, ADR 0346). It is a provenance label, not a registered source: it is never looked
# up, so it is not in SOURCES and the pronounce command does not offer it.
USER_SOURCE = "user"
# Where the narrator is with a pronunciation: looked up (the default, and what an entry written before status existed reads as),
# asked of the author, or confirmed by the author.
PRONUNCIATION_STATUSES = ("researched", "query_sent", "author_confirmed")
DEFAULT_PRONUNCIATION_STATUS = "researched"
MAX_USER_PRONUNCIATION = 200
MAX_PRONUNCIATION_NOTE = 1000
# The fields that are the pronunciation itself; status, note and the alternate are about the name and travel with it.
_PRONUNCIATION_VALUE_FIELDS = ("ipa", "source", "confidence")


def pronunciation_status_of(value: dict[str, Any] | None) -> str:
    """The status of a pronunciation, ``researched`` when it has none (an entry written before status existed) or an unknown one."""
    status = (value or {}).get("status")
    return status if status in PRONUNCIATION_STATUSES else DEFAULT_PRONUNCIATION_STATUS


def _is_user(value: dict[str, Any] | None) -> bool:
    return (value or {}).get("source") == USER_SOURCE


def _pronunciation_core(value: dict[str, Any]) -> dict[str, Any]:
    return {field: value[field] for field in _PRONUNCIATION_VALUE_FIELDS if field in value}


def carry_pronunciation_work(prior: dict[str, Any] | None, fresh: dict[str, Any]) -> dict[str, Any]:
    """``fresh`` with the narrator's status, note and alternate from ``prior``, the pronunciation it replaces.

    An ``author_confirmed`` status confirmed the old IPA, not the new one, so it is withdrawn to ``researched`` when the IPA in use
    changes; ``query_sent`` stays, because the question is still out. Nothing is added to a value that had none of these.
    """
    prior = prior or {}
    value = dict(fresh)
    if "status" in prior:
        status = pronunciation_status_of(prior)
        if status == "author_confirmed" and prior.get("ipa", "") != value.get("ipa", ""):
            status = DEFAULT_PRONUNCIATION_STATUS
        value["status"] = status
    if prior.get("note"):
        value["note"] = prior["note"]
    if prior.get("alternate") and "alternate" not in value:
        value["alternate"] = prior["alternate"]
    return value


def set_pronunciation(prior: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    """Puts ``new`` in use in place of ``prior``, keeping the narrator's own and the dictionary's answers side by side (Q2).

    The ``alternate`` is the most recent pronunciation of the other kind (the narrator's own or a dictionary's): when ``prior`` is of the
    other kind and has an IPA it becomes the alternate, otherwise ``prior``'s alternate is kept. So switching back never re-runs a
    lookup and never loses what the narrator typed.
    """
    prior = prior or {}
    value = carry_pronunciation_work(prior, new)
    value.pop("alternate", None)
    if prior.get("ipa") and _is_user(prior) != _is_user(new):
        value["alternate"] = _pronunciation_core(prior)
    elif prior.get("alternate"):
        value["alternate"] = prior["alternate"]
    return value


def user_pronunciation(ipa: str) -> dict[str, Any]:
    """The narrator's own pronunciation, typed in; it never asks CMU or eSpeak."""
    text = (ipa or "").strip()
    if not text:
        raise ValueError("Type a pronunciation first.")
    if "\n" in text or "\r" in text:
        raise ValueError("A pronunciation is one line.")
    if len(text) > MAX_USER_PRONUNCIATION:
        raise ValueError(f"A pronunciation is at most {MAX_USER_PRONUNCIATION} characters.")
    return {"ipa": text, "source": USER_SOURCE, "confidence": "narrator"}


def pronunciation(name: str, espeak_library: str | None, default_source: str | None = None) -> dict[str, str]:
    # CMU is quick and high-quality for familiar names. It cannot cover most fantasy names.
    # Read-only/generated-only: there is no user-editable "say it as" respelling
    # any more, so this never needs to round-trip anything but the IPA itself.
    order = SOURCES.fallback_order()
    # default_source (story-bible-and-import-ux-briefs PRD phase 11, the settings default) only reorders the chain: an
    # unregistered value (a stale setting from a removed source) is ignored rather than raising, and every other
    # source is still tried afterwards in its usual order if the preferred one has nothing for this name.
    if default_source and default_source in order:
        order = [default_source, *(source for source in order if source != default_source)]
    for source in order:
        try:
            return pronounce_source(name, espeak_library, source)
        except Exception as exc:  # noqa: BLE001
            adapter = SOURCES.lookup(source)
            log(f"{getattr(adapter, 'unavailable_log', adapter.descriptor.label + ' unavailable')} ({exc}).")
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


def assign_scene_indices(paragraphs: list[dict[str, str]]) -> list[int | None]:
    """One scene index per paragraph position, restarting at 0 for each chapter. A scene-break paragraph
    (SCENE_BREAK) gets `None` - it is a separator, not part of either scene it sits between - and starts the
    next scene."""
    indices: list[int | None] = []
    scene = 0
    current_chapter: object = object()
    for paragraph in paragraphs:
        chapter_id = paragraph.get("chapterId")
        if chapter_id != current_chapter:
            current_chapter = chapter_id
            scene = 0
        if SCENE_BREAK.match(paragraph.get("text", "").strip()):
            indices.append(None)
            scene += 1
        else:
            indices.append(scene)
    return indices


def scene_by_paragraph_id(paragraphs: list[dict[str, str]]) -> dict[str, int | None]:
    """Maps each paragraph's id (the same legacy-id fallback `make_candidate` uses) to its scene index."""
    return {
        paragraph.get("paragraphId", f"legacy-paragraph-{index}"): scene
        for index, (paragraph, scene) in enumerate(zip(paragraphs, assign_scene_indices(paragraphs), strict=True))
    }


def appearance_map(occurrences: list[dict[str, Any]], scenes: dict[str, int | None]) -> list[dict[str, Any]]:
    """Which (chapter, scene) pairs an entity's evidence touches - one row per pair, in reading order."""
    seen: set[tuple[str, int]] = set()
    appearances: list[dict[str, Any]] = []
    for item in occurrences:
        scene = scenes.get(item.get("paragraphId"))
        if scene is None:
            continue
        key = (item.get("chapterId", ""), scene)
        if key in seen:
            continue
        seen.add(key)
        appearances.append({"chapterId": item.get("chapterId", ""), "chapter": item.get("chapter", ""), "sceneIndex": scene})
    return sorted(appearances, key=lambda item: (item["chapterId"], item["sceneIndex"]))


def merge_appearances(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, int]] = set()
    merged: list[dict[str, Any]] = []
    for group in groups:
        for item in group:
            key = (item["chapterId"], item["sceneIndex"])
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return sorted(merged, key=lambda item: (item["chapterId"], item["sceneIndex"]))


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


def build_entities(paragraphs: list[dict[str, str]], model_name: str, espeak_library: str | None, default_source: str | None = None) -> list[dict[str, Any]]:
    scenes = scene_by_paragraph_id(paragraphs)
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
                "pronunciation": pronunciation(name, espeak_library, default_source),
                "occurrences": evidence_entries(by_literal_name.get(name, [])),
            }
            for name in alias_names
        ]
        all_evidence = canonical_evidence + [item for alias in aliases for item in alias["occurrences"]]

        entities.append(
            {
                "id": entity_id(canonical_name),
                "canonical_name": canonical_name,
                "aliases": aliases,
                "category": category,
                "occurrences": canonical_evidence,
                "occurrence_count": len(occurrences),
                "pronunciation": pronunciation(canonical_name, espeak_library, default_source),
                "description": direct_description(canonical_name, occurrences),
                "personality_notes": trait_notes(canonical_name, occurrences) if category == "Character" else [],
                "context": "",
                "relationships": [],
                "properties": [],
                "locked": False,
                "manual": False,
                "review_state": "needs review" if category == "Needs Review" else "generated",
                "appearances": appearance_map(all_evidence, scenes),
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


def entity_name_keys(entity: dict[str, Any]) -> set[str]:
    """Every normalized spelling (canonical name plus aliases) this entity currently answers to."""
    keys = {normalize_name(entity.get("canonical_name", ""))}
    keys.update(normalize_name(alias.get("text", "")) for alias in entity.get("aliases", []) or [])
    keys.discard("")
    return keys


def merge_locked(generated: list[dict[str, Any]], old: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not old:
        return generated
    previous = {entity["id"]: entity for entity in old.get("entities", [])}
    absorbed_names: dict[str, str] = old.get("absorbed_names", {})

    # CC-2 (character-continuity-review.prd.md phase 2): an entity's id is a hash of whichever spelling gets
    # picked as canonical_name (entity_id()), and that pick can shift between builds - e.g. a title-prefixed
    # mention ("Captain Arelian") joining a group that previously only had the short form ("Arelian") makes the
    # long form win as canonical_name, hashing to a different id. Reconcile by name overlap, not only by exact
    # id, so a freshly generated entity that shares ANY spelling with a previous one (locked/manual or not)
    # reclaims that previous entity's id and its reviewed history, instead of silently orphaning both.
    previous_id_by_name_key: dict[str, str] = {}
    for previous_id, previous_entity in previous.items():
        for key in entity_name_keys(previous_entity):
            previous_id_by_name_key.setdefault(key, previous_id)
    claimed_prior_ids: set[str] = set()

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
        if prior is not None:
            claimed_prior_ids.add(prior["id"])
        else:
            for key in entity_name_keys(entity):
                candidate_id = previous_id_by_name_key.get(key)
                if candidate_id is not None and candidate_id not in claimed_prior_ids:
                    prior = previous[candidate_id]
                    claimed_prior_ids.add(candidate_id)
                    entity["id"] = candidate_id  # reclaim the stable identity even though the spelling shifted
                    break
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
            # Otherwise the narrator's status, note and alternate carry over to the fresh one (prep-depth P1).
            if (prior.get("pronunciation") or {}).get("chosen"):
                entity["pronunciation"] = prior["pronunciation"]
            elif prior.get("pronunciation"):
                entity["pronunciation"] = carry_pronunciation_work(prior["pronunciation"], entity.get("pronunciation") or {})
            # The same for a rediscovered alias: a chosen alias pronunciation is kept whole, an unchosen one keeps the narrator's work.
            prior_aliases = {alias["text"].lower(): alias for alias in prior.get("aliases", []) if isinstance(alias, dict)}
            for alias in entity.get("aliases", []):
                prior_alias = prior_aliases.get(alias["text"].lower())
                prior_value = (prior_alias or {}).get("pronunciation") or {}
                if prior_value.get("chosen"):
                    alias["pronunciation"] = prior_value
                elif prior_value:
                    alias["pronunciation"] = carry_pronunciation_work(prior_value, alias.get("pronunciation") or {})
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
    entities = build_entities(paragraphs, args.spacy_model, args.espeak_library or None, getattr(args, "default_source", "") or None)
    write_progress(args.progress, "MERGE", 85, "Preserving locked edits...")
    log("Merging generated entries with locked and manual edits")
    entities = merge_locked(entities, previous)
    fresh_cues = extract_dialogue_cues(paragraphs, character_name_index(entities))
    dialogue_cues = merge_dialogue_cues(fresh_cues, (previous or {}).get("dialogue_cues", []))
    guide = {
        "schema_version": SCHEMA_VERSION,
        "source": {"path": str(Path(args.manuscript).resolve()), "sha256": source_hash},
        "generated_at": datetime.now(UTC).isoformat(),
        "entities": entities,
        "dialogue_cues": dialogue_cues,
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


def apply_edit(
    entity: dict[str, Any],
    field: str,
    value: str,
    paragraphs: list[dict[str, str]] | None,
    espeak_library: str | None,
    default_source: str | None = None,
) -> None:
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
                    "pronunciation": pronunciation(name, espeak_library, default_source),
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
        apply_edit(entity, field, value, paragraphs, args.espeak_library or None, getattr(args, "default_source", "") or None)
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


def _pronunciation_holder(guide: dict[str, Any], entity_id_value: str, alias_index: int | None) -> tuple[dict[str, Any], str]:
    """The entity (alias_index None) or the alias whose ``pronunciation`` an edit changes, and the name it is for.

    Refused on a locked entity, the same as every other edit (ADR 0007).
    """
    entity = find_entity(guide, entity_id_value)
    if entity.get("locked"):
        raise ValueError("This entity is locked. Unlock it before editing.")
    if alias_index is None:
        return entity, entity["canonical_name"]
    aliases = entity.get("aliases", [])
    if not 0 <= alias_index < len(aliases):
        raise ValueError("Alias index out of range.")
    return aliases[alias_index], aliases[alias_index]["text"]


def _load_guide_for_edit(path: str) -> dict[str, Any]:
    guide = load_json(path)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    return guide


def pronounce(args: argparse.Namespace) -> None:
    """Sets the pronunciation of an entity's own name, or one of its aliases, from one named engine (D13/B9/B10).

    Refused on a locked entity, the same as every other edit (ADR 0007). The value is marked ``chosen`` so a later
    rebuild's ``merge_locked`` keeps it instead of overwriting it with a freshly generated one (B11). A narrator's own
    pronunciation it replaces is kept as the ``alternate`` (prep-depth Q2).
    """
    guide = _load_guide_for_edit(args.guide)
    holder, name = _pronunciation_holder(guide, args.entity_id, args.alias_index)
    value = pronounce_source(name, args.espeak_library or None, args.source)
    value["chosen"] = True
    holder["pronunciation"] = set_pronunciation(holder.get("pronunciation"), value)
    write_json(args.guide, guide)
    print(f"PRONOUNCED|{args.entity_id}|{value['source']}")


def pronounce_user(args: argparse.Namespace) -> None:
    """Sets the narrator's own pronunciation (source ``user``) beside the dictionary's, which is kept as the alternate (prep-depth P1)."""
    value = user_pronunciation(args.ipa)
    guide = _load_guide_for_edit(args.guide)
    holder, _ = _pronunciation_holder(guide, args.entity_id, args.alias_index)
    value["chosen"] = True
    holder["pronunciation"] = set_pronunciation(holder.get("pronunciation"), value)
    write_json(args.guide, guide)
    print(f"PRONOUNCED|{args.entity_id}|{USER_SOURCE}")


def pronunciation_use_alternate(args: argparse.Namespace) -> None:
    """Puts the kept alternate back in use, and keeps the one it replaces as the new alternate: lossless both ways, no lookup."""
    guide = _load_guide_for_edit(args.guide)
    holder, _ = _pronunciation_holder(guide, args.entity_id, args.alias_index)
    current = holder.get("pronunciation") or {}
    alternate = current.get("alternate")
    if not alternate:
        raise ValueError("There is no other pronunciation to switch to.")
    value = {**_pronunciation_core(alternate), "chosen": True}
    holder["pronunciation"] = set_pronunciation(current, value)
    write_json(args.guide, guide)
    print(f"PRONOUNCED|{args.entity_id}|{value.get('source', '')}")


def pronunciation_status(args: argparse.Namespace) -> None:
    """Sets a pronunciation's status and, when ``note`` is given, its note (an empty note clears it). The IPA is untouched."""
    if args.status not in PRONUNCIATION_STATUSES:
        raise ValueError(f"Unknown pronunciation status: {args.status}")
    note = None if args.note is None else args.note.strip()
    if note is not None and len(note) > MAX_PRONUNCIATION_NOTE:
        raise ValueError(f"A pronunciation note is at most {MAX_PRONUNCIATION_NOTE} characters.")
    guide = _load_guide_for_edit(args.guide)
    holder, _ = _pronunciation_holder(guide, args.entity_id, args.alias_index)
    value = dict(holder.get("pronunciation") or {})
    value["status"] = args.status
    if note is not None:
        if note:
            value["note"] = note
        else:
            value.pop("note", None)
    holder["pronunciation"] = value
    write_json(args.guide, guide)
    print(f"PRONUNCIATION_STATUS|{args.entity_id}|{args.status}")


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
            "pronunciation": pronunciation(alias_name, args.espeak_library or None, getattr(args, "default_source", "") or None),
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
        "pronunciation": pronunciation(name, args.espeak_library or None, getattr(args, "default_source", "") or None),
        "description": direct_description(name, canonical_occurrences) if canonical_occurrences else {"text": "", "evidence": {}},
        "personality_notes": [],
        "relationships": [],
        "properties": properties,
        "locked": False,
        "manual": True,
        "review_state": "reviewed",
        "appearances": [],
    }
    description = getattr(args, "description", "")
    if description:
        # The same as an edit of the description right after the create, without a second process for it.
        entity["description"]["text"] = description
    entity["occurrence_count"] = entity_occurrence_count(entity)
    guide["entities"].append(entity)
    write_json(args.guide, guide)
    print(f"CREATED|{new_id}|{entity['occurrence_count']}")


def split(args: argparse.Namespace) -> None:
    """The inverse of `merge`: gives one of an entity's aliases its own standalone identity back.

    Clears any `absorbed_names` entry for that spelling, or the very next `build` would fold the freshly
    generated entity straight back into the parent through `merge_locked`'s redirect step."""
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    if entity.get("locked"):
        raise ValueError("This entity is locked. Unlock it before editing.")
    alias_text = args.alias_text.strip()
    aliases = entity.get("aliases", [])
    match_index = next((index for index, alias in enumerate(aliases) if alias["text"].lower() == alias_text.lower()), None)
    if match_index is None:
        raise ValueError("Alias not found.")
    alias = aliases.pop(match_index)
    new_id = entity_id(alias["text"])
    if any(value["id"] == new_id for value in guide["entities"]):
        raise ValueError("An entity with this name already exists.")
    new_entity = {
        "id": new_id,
        "canonical_name": alias["text"],
        "aliases": [],
        "category": entity.get("category", "Needs Review"),
        "occurrences": alias.get("occurrences", []),
        "pronunciation": alias.get("pronunciation", {}),
        "description": {"text": "", "evidence": {}},
        "personality_notes": [],
        "context": "",
        "relationships": [],
        "properties": [],
        "locked": False,
        "manual": False,
        "review_state": "reviewed",
        "appearances": [],
    }
    new_entity["occurrence_count"] = entity_occurrence_count(new_entity)
    entity["occurrence_count"] = entity_occurrence_count(entity)
    guide["entities"].append(new_entity)
    absorbed_names = guide.setdefault("absorbed_names", {})
    absorbed_names.pop(normalize_name(alias["text"]), None)
    write_json(args.guide, guide)
    print(f"SPLIT|{new_id}")


def cue_id(paragraph_id: str, start: int, quote_text: str) -> str:
    digest = hashlib.sha1(f"{paragraph_id}:{start}:{quote_text}".encode()).hexdigest()[:12]
    return "cue-" + digest


def character_name_index(entities: list[dict[str, Any]]) -> dict[str, str]:
    """Maps every normalized Character name and alias to its entity id - only Character (never Place,
    Organization, or an unresolved Needs Review candidate), since only a character speaks."""
    index: dict[str, str] = {}
    for entity in entities:
        if entity.get("category") != "Character":
            continue
        for key in entity_name_keys(entity):
            index.setdefault(key, entity["id"])
    return index


def find_speech_tag(text: str, quote_start: int, quote_end: int, character_index: dict[str, str]) -> tuple[str | None, str, str]:
    """Looks for a speech-verb tag naming a known character right after or right before the quote
    ('"..." Ada said.' / 'Ada said, "..."'). Anything else, including a tag naming someone who never became
    a real Character entity, is left `unknown` rather than guessed at (ADR 0020)."""
    after = text[quote_end : quote_end + TAG_WINDOW]
    match = AFTER_QUOTE_TAG.match(after)
    if match and match.group(2).lower() in SPEECH_VERBS:
        entity_id_value = character_index.get(normalize_name(match.group(1)))
        if entity_id_value:
            return entity_id_value, "tag", (text[quote_start:quote_end] + " " + match.group(0)).strip()
    before = text[max(0, quote_start - TAG_WINDOW) : quote_start]
    match = BEFORE_QUOTE_TAG.search(before)
    if match and match.group(2).lower() in SPEECH_VERBS:
        entity_id_value = character_index.get(normalize_name(match.group(1)))
        if entity_id_value:
            return entity_id_value, "tag", (match.group(0) + " " + text[quote_start:quote_end]).strip()
    return None, "unknown", ""


def extract_cues_from_text(text: str, character_index: dict[str, str], chapter_id: str = "", paragraph_id: str = "") -> list[dict[str, Any]]:
    """One dialogue cue per double-quoted span in `text`, each with its own tag lookup and evidence.
    Per-scene continuation (an untagged quote alternating between exactly two known speakers) is
    `extract_dialogue_cues`'s job, since it needs the paragraphs around this one."""
    cues: list[dict[str, Any]] = []
    for match in QUOTE_PATTERN.finditer(text):
        start, end = match.start(), match.end()
        quote_text = match.group(1)
        speaker_entity_id, source, tag_evidence = find_speech_tag(text, start, end, character_index)
        cues.append(
            {
                "id": cue_id(paragraph_id, start, quote_text),
                "chapterId": chapter_id,
                "paragraphId": paragraph_id,
                "quote_start": start,
                "quote_end": end,
                "quote_text": quote_text,
                "speaker_entity_id": speaker_entity_id,
                "speaker_source": source,
                "evidence": {"chapterId": chapter_id, "paragraphId": paragraph_id, "excerpt": excerpt(text, start, end), "tag": tag_evidence},
                "corrected": False,
            }
        )
    return cues


def extract_dialogue_cues(paragraphs: list[dict[str, str]], character_index: dict[str, str]) -> list[dict[str, Any]]:
    """Rules-based cue extraction (CC-2, Q4 option A): quote spans, adjacent speech-verb tags resolved
    against known Character names/aliases, and per-scene continuation for exactly two active speakers.
    A scene-break paragraph resets who is "active" - continuation never crosses one. Three or more active
    speakers in a scene, or only one so far, leaves an untagged quote `unknown` rather than guessing which
    of several people it might be (ADR 0020)."""
    cues: list[dict[str, Any]] = []
    scene_speakers: dict[tuple[str, int], list[str]] = defaultdict(list)
    last_speaker: dict[tuple[str, int], str] = {}
    for paragraph, scene in zip(paragraphs, assign_scene_indices(paragraphs), strict=True):
        if scene is None:
            continue
        chapter_id = paragraph.get("chapterId", "")
        paragraph_id = paragraph.get("paragraphId", "")
        scene_key = (chapter_id, scene)
        for cue in extract_cues_from_text(paragraph.get("text", ""), character_index, chapter_id, paragraph_id):
            if cue["speaker_entity_id"] is None:
                active = scene_speakers[scene_key]
                if len(active) == 2 and scene_key in last_speaker:
                    other = next((speaker_id for speaker_id in active if speaker_id != last_speaker[scene_key]), None)
                    if other:
                        cue["speaker_entity_id"] = other
                        cue["speaker_source"] = "continuation"
            speaker_id = cue["speaker_entity_id"]
            if speaker_id:
                if speaker_id not in scene_speakers[scene_key]:
                    scene_speakers[scene_key].append(speaker_id)
                last_speaker[scene_key] = speaker_id
            cues.append(cue)
    return cues


def merge_dialogue_cues(fresh: list[dict[str, Any]], previous_cues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A narrator's correction (`correct_cue`) survives a rebuild the same way a locked entity does (ADR 0007):
    matched by `cue_id`, which is itself a hash of the paragraph, the quote's position and its text, so a cue
    whose underlying text is unchanged always gets the same id back and reclaims its correction; a cue whose
    paragraph text changed gets a new id and simply does not carry a stale correction onto unrelated content."""
    previous_by_id = {cue["id"]: cue for cue in previous_cues}
    merged = []
    for cue in fresh:
        prior = previous_by_id.get(cue["id"])
        if prior and prior.get("corrected"):
            cue = {**cue, "speaker_entity_id": prior.get("speaker_entity_id"), "speaker_source": prior.get("speaker_source", "correction"), "corrected": True}
        merged.append(cue)
    return merged


def correct_cue(args: argparse.Namespace) -> None:
    """Records the narrator's own attribution for one cue (or clears it back to `unknown`), so the next
    rebuild's `merge_dialogue_cues` keeps it instead of overwriting it with fresh, possibly-`unknown`,
    extraction - the same durability `merge_locked` already gives a locked entity (ADR 0007)."""
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    cues = guide.get("dialogue_cues", [])
    cue = next((value for value in cues if value["id"] == args.cue_id), None)
    if cue is None:
        raise ValueError("Cue not found.")
    value = args.speaker_entity_id.strip()
    cue["speaker_entity_id"] = None if value.lower() in {"", "unknown"} else value
    cue["speaker_source"] = "correction"
    cue["corrected"] = True
    write_json(args.guide, guide)
    print(f"CORRECTED|{args.cue_id}")


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
    target["appearances"] = merge_appearances(target.get("appearances", []), source.get("appearances", []))

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


def _phoneme_block(ipa: str) -> str | None:
    """Piper's own inline raw-phoneme escape (``"[[ ... ]]"``, ``PiperVoice.phonemize``) skips its espeak
    text-to-phoneme step, speaking exactly the stored symbols instead of re-guessing them from the spelled name
    (Phase 10, ADR 0680). ``None`` when ``ipa`` is empty or would break out of the block early.
    """
    text = ipa.strip()
    if not text or "]]" in text:
        return None
    return f"[[{text}]]"


def spoken_form(holder: dict[str, Any] | None, name: str) -> str:
    """What a preview should hand to Piper for ``holder`` (an entity or an alias): its chosen pronunciation as
    raw phonemes when it has one and it converts cleanly, else the spelled ``name``, exactly as before this phase.
    An auto-generated pronunciation the narrator never picked (``pronounce()``/``pronounce_user()`` mark ``chosen``)
    must not silently change what the preview says.
    """
    pronunciation = (holder or {}).get("pronunciation") or {}
    if not pronunciation.get("chosen"):
        return name
    block = _phoneme_block(str(pronunciation.get("ipa", "")))
    return block if block is not None else name


def render_audio(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    if not args.piper_model:
        raise ValueError("Install a verified Piper voice before creating previews.")
    if args.alias_index is None:
        holder = entity
        name = entity["canonical_name"]
        filename = args.output_name or f"{entity['id']}.wav"
    else:
        aliases = entity.get("aliases", [])
        if not 0 <= args.alias_index < len(aliases):
            raise ValueError("Alias index out of range.")
        holder = aliases[args.alias_index]
        name = holder["text"]
        filename = args.output_name or f"{entity['id']}__alias{args.alias_index}.wav"
    spoken = spoken_form(holder, name)
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


def _capability_row(descriptor) -> dict:
    """One row of a `capabilities` report: a Descriptor's label, platforms and modes, plus its asset kind when it
    has one (TtsDescriptor only). "loadable" is always null: this reports registration only, never whether the row
    actually loads (sidecar-capabilities-flag PRD Q2, ADR 0403) - the same shape live_asr.py's --capabilities uses."""
    row = {"label": descriptor.label, "platforms": list(descriptor.platforms), "modes": list(descriptor.modes), "loadable": None}
    asset_kind = getattr(descriptor, "asset_kind", "")
    if asset_kind:
        row["asset"] = asset_kind
    return row


def capabilities_report(engines=TTS_ENGINES, sources=SOURCES) -> dict:
    """`capabilities`: every row this sidecar process has actually registered in ENGINES (voice engines) and SOURCES
    (pronunciation) by the time this runs - after `providers` module-level registration, before any voice or source is
    touched. `engines`/`sources` are overridable so a test can stand in a reduced registry for "an adapter failed to
    register" without needing a real broken import."""
    return {
        "type": "capabilities",
        "tts": {engine.descriptor.name: _capability_row(engine.descriptor) for engine in engines},
        "pronunciation": {source.descriptor.name: _capability_row(source.descriptor) for source in sources},
    }


def capabilities(args: argparse.Namespace) -> None:
    print(json.dumps(capabilities_report()))


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
    build_parser.add_argument("--wiktextract-index", default="")
    build_parser.add_argument("--default-source", default=get_default("ManuscriptGuide", "default_pronunciation_source", ""))
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
    edit_parser.add_argument("--wiktextract-index", default="")
    edit_parser.add_argument("--default-source", default=get_default("ManuscriptGuide", "default_pronunciation_source", ""))
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
    pronounce_parser.add_argument("--wiktextract-index", default="")
    # The narrator's own pronunciation and the note are free text: pass them as --ipa=VALUE / --note=VALUE so one that starts with
    # "-" is still a value, not another option (the host always does).
    user_parser = command.add_parser("pronounce-user")
    user_parser.add_argument("--guide", required=True)
    user_parser.add_argument("--entity-id", required=True)
    user_parser.add_argument("--alias-index", type=int, default=None)
    user_parser.add_argument("--ipa", required=True)
    alternate_parser = command.add_parser("pronunciation-use-alternate")
    alternate_parser.add_argument("--guide", required=True)
    alternate_parser.add_argument("--entity-id", required=True)
    alternate_parser.add_argument("--alias-index", type=int, default=None)
    status_parser = command.add_parser("pronunciation-status")
    status_parser.add_argument("--guide", required=True)
    status_parser.add_argument("--entity-id", required=True)
    status_parser.add_argument("--alias-index", type=int, default=None)
    status_parser.add_argument("--status", required=True, choices=PRONUNCIATION_STATUSES)
    status_parser.add_argument("--note", default=None)
    create_parser = command.add_parser("create")
    create_parser.add_argument("--guide", required=True)
    create_parser.add_argument("--manuscript", required=True)
    create_parser.add_argument("--name", required=True)
    create_parser.add_argument("--category", default="")
    create_parser.add_argument("--aliases", default="")
    create_parser.add_argument("--description", default="")
    create_parser.add_argument("--properties", default="", help='the properties as one JSON list, e.g. [{"key": "Codename", "value": "Wren"}]')
    create_parser.add_argument("--espeak-library", default="")
    create_parser.add_argument("--wiktextract-index", default="")
    create_parser.add_argument("--default-source", default=get_default("ManuscriptGuide", "default_pronunciation_source", ""))
    merge_parser = command.add_parser("merge")
    merge_parser.add_argument("--guide", required=True)
    merge_parser.add_argument("--source-id", required=True)
    merge_parser.add_argument("--target-id", required=True)
    split_parser = command.add_parser("split", help="give one of an entity's aliases its own standalone identity back (the inverse of merge)")
    split_parser.add_argument("--guide", required=True)
    split_parser.add_argument("--entity-id", required=True)
    split_parser.add_argument("--alias-text", required=True)
    correct_cue_parser = command.add_parser("correct-cue", help="record the narrator's own attribution for a dialogue cue; a rebuild never overwrites it")
    correct_cue_parser.add_argument("--guide", required=True)
    correct_cue_parser.add_argument("--cue-id", required=True)
    correct_cue_parser.add_argument("--speaker-entity-id", required=True, help='an entity id, or "unknown" to clear the attribution')
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
    command.add_parser(
        "capabilities",
        help="print every row this process has registered in ENGINES (voice engines) and SOURCES (pronunciation), by "
        "port then name (one JSON object: {type: capabilities, tts, pronunciation}; registration only, not verified)",
    )
    args = parser.parse_args()
    wiktextract_index = getattr(args, "wiktextract_index", "") or None
    if wiktextract_index:
        # Set once per process on the registered singleton (D72, Q7-Q8): the path never changes between calls within one
        # invocation, so there is nothing to gain from threading it through pronunciation()/pronounce_source() the way
        # --espeak-library is, and every call site that already builds a pronunciation keeps working unchanged.
        SOURCES.lookup("wiktextract").index_path = wiktextract_index
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
            "pronounce-user": pronounce_user,
            "pronunciation-use-alternate": pronunciation_use_alternate,
            "pronunciation-status": pronunciation_status,
            "create": create,
            "merge": merge,
            "split": split,
            "correct-cue": correct_cue,
            "delete": delete,
            "relate": relate,
            "unrelate": unrelate,
            "render-audio": render_audio,
            "self-check": self_check,
            "capabilities": capabilities,
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
