"""Local backend for the independent REAPER Manuscript Guide.

The only shared contract with other REAPER tools is the project's
``Manuscript.docx`` file. All output belongs in the caller-provided
ManuscriptGuide directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "shared" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common.config import get_default  # noqa: E402
from narration_common.docx_chapters import NON_CHAPTER_HEADINGS, load_docx_paragraphs  # noqa: E402
from narration_common.logging_utils import log  # noqa: E402
from narration_common.progress import write_progress  # noqa: E402


SCHEMA_VERSION = 2
CAPITALIZED = re.compile(r"\b[A-Z][A-Za-z'’-]*(?:\s+(?:(?:of|the|and)\s+)?[A-Z][A-Za-z'’-]*){0,3}\b")
SENTENCES = re.compile(r"(?<=[.!?])\s+")
STOPWORDS = {
    "A",
    "An",
    "And",
    "As",
    "At",
    "But",
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
    "Not",
    "Of",
    "On",
    "Or",
    "Our",
    "She",
    "The",
    "Their",
    "They",
    "This",
    "That",
    "These",
    "Those",
    "To",
    "We",
    "When",
    "With",
    "You",
    "Your",
}
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


def load_docx(path: str) -> list[dict[str, str]]:
    chapter = "Front matter"
    paragraphs: list[dict[str, str]] = []
    for item in load_docx_paragraphs(path, detect_outline_headings=True):
        text = item["text"]
        if item["is_heading"]:
            heading = " ".join(text.split())
            # Structural headings like "Table of Contents" describe the document,
            # not a chapter to narrate - skip them rather than starting a chapter.
            if heading.strip().lower() in NON_CHAPTER_HEADINGS:
                continue
            chapter = heading
            continue
        paragraphs.append({"chapter": chapter, "text": " ".join(text.split())})
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
            found.append({"chapter": paragraph["chapter"], "paragraph": para_index, "excerpt": excerpt(text, match.start(), match.end())})
    return found


def rule_candidates(paragraphs: list[dict[str, str]]) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    for para_index, paragraph in enumerate(paragraphs):
        text = paragraph["text"]
        for match in CAPITALIZED.finditer(text):
            name = match.group(0).strip(" ,.;:!?\"'”’")
            words = name.split()
            if not name or name in STOPWORDS or all(word in STOPWORDS for word in words):
                continue
            # A lone capital at the beginning of a normal sentence is usually not a name.
            if len(words) == 1 and match.start() == 0 and name in STOPWORDS:
                continue
            found.append(
                {
                    "name": name,
                    "chapter": paragraph["chapter"],
                    "paragraph": str(para_index),
                    "text": text,
                    "start": str(match.start()),
                    "end": str(match.end()),
                    "source": "rule",
                }
            )
    return found


def spacy_candidates(paragraphs: list[dict[str, str]], model_name: str) -> list[dict[str, str]]:
    try:
        import spacy

        nlp = spacy.load(model_name, disable=["parser", "lemmatizer", "textcat"])
    except Exception as exc:  # Local rule extraction is a supported fallback.
        log(f"spaCy model unavailable ({exc}); using rules only.")
        return []
    found: list[dict[str, str]] = []
    allowed = {"PERSON", "ORG", "GPE", "LOC", "FAC"}
    for para_index, (paragraph, doc) in enumerate(zip(paragraphs, nlp.pipe(p["text"] for p in paragraphs))):
        for ent in doc.ents:
            if ent.label_ not in allowed or not ent.text.strip():
                continue
            found.append(
                {
                    "name": ent.text.strip(),
                    "chapter": paragraph["chapter"],
                    "paragraph": str(para_index),
                    "text": paragraph["text"],
                    "start": str(ent.start_char),
                    "end": str(ent.end_char),
                    "source": ent.label_,
                }
            )
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


def pronunciation(name: str, espeak_library: str | None) -> dict[str, str]:
    # CMU is quick and high-quality for familiar names. It cannot cover most fantasy names.
    # Read-only/generated-only: there is no user-editable "say it as" respelling
    # any more, so this never needs to round-trip anything but the IPA itself.
    try:
        import pronouncing

        words = re.findall(r"[A-Za-z]+", name)
        phones = [pronouncing.phones_for_word(word.lower())[0] for word in words if pronouncing.phones_for_word(word.lower())]
        if words and len(phones) == len(words):
            return {"ipa": " ".join(arpabet_to_ipa(phone) for phone in phones), "source": "CMU dictionary", "confidence": "medium"}
    except Exception as exc:
        log(f"CMU pronunciation unavailable ({exc}).")
    try:
        from phonemizer import phonemize

        if espeak_library:
            from phonemizer.backend.espeak.wrapper import EspeakWrapper

            EspeakWrapper.set_library(espeak_library)
        ipa = phonemize(name, language="en-us", backend="espeak", strip=True, with_stress=True)
        if ipa:
            return {"ipa": ipa, "source": "eSpeak NG", "confidence": "low"}
    except Exception as exc:
        log(f"eSpeak phonetic fallback unavailable ({exc}).")
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
        for sentence in SENTENCES.split(occurrence["text"]):
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


def build_entities(paragraphs: list[dict[str, str]], model_name: str, espeak_library: str | None) -> list[dict[str, Any]]:
    candidates = rule_candidates(paragraphs) + spacy_candidates(paragraphs, model_name)
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
        names = sorted({item["name"] for item in occurrences}, key=lambda value: (-len(value), value))
        canonical_name = names[0]
        alias_names = [name for name in names if name != canonical_name]
        category_counts: dict[str, int] = defaultdict(int)
        for occurrence in occurrences:
            category_counts[classify(occurrence)] += 1
        category = max(category_counts, key=category_counts.get)

        # Each literal spelling keeps its OWN evidence list (this is what lets
        # the UI show "alias: X" against the specific occurrences that spelling
        # produced), rather than one flat list for the whole entity.
        by_literal_name: dict[str, list[dict[str, str]]] = defaultdict(list)
        for item in occurrences:
            by_literal_name[item["name"]].append(item)

        def evidence_for(literal_name: str) -> list[dict[str, Any]]:
            return [
                {
                    "chapter": item["chapter"],
                    "paragraph": int(item["paragraph"]),
                    "excerpt": excerpt(item["text"], int(item["start"]), int(item["end"])),
                }
                for item in by_literal_name.get(literal_name, [])
            ]

        canonical_evidence = evidence_for(canonical_name)
        aliases = [
            {
                "text": name,
                "pronunciation": pronunciation(name, espeak_library),
                "occurrences": evidence_for(name),
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
                "locked": False,
                "manual": False,
                "review_state": "needs review" if category == "Needs Review" else "generated",
            }
        )
    return sorted(entities, key=lambda entity: (entity["category"], entity["canonical_name"].lower()))


def vocabulary_candidates(entities: list[dict[str, Any]]) -> list[str]:
    """Return the durable, narrator-reviewable vocabulary candidate list.

    The guide already contains the manuscript-derived names and aliases we
    want Whisper to recognize.  Keeping this list in the guide manifest makes
    proofing suggestions reproducible and avoids a second ad-hoc DOCX scan.
    """
    values: list[str] = []
    for entity in entities:
        values.append(entity.get("canonical_name", ""))
        values.extend(alias.get("text", "") for alias in entity.get("aliases", []))
    return sorted({value.strip() for value in values if value and value.strip()}, key=str.casefold)


def load_json(path: str) -> dict[str, Any] | None:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


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
    return merged


def write_json(path: str, data: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, target)


def build(args: argparse.Namespace) -> None:
    write_progress(args.progress, "LOAD", 5, "Reading manuscript...")
    source_hash = document_hash(args.docx)
    paragraphs = load_docx(args.docx)
    write_progress(args.progress, "EXTRACT", 30, "Finding people, places, and organizations...")
    previous = load_json(args.out)
    entities = build_entities(paragraphs, args.spacy_model, args.espeak_library or None)
    write_progress(args.progress, "MERGE", 85, "Preserving locked edits...")
    entities = merge_locked(entities, previous)
    guide = {
        "schema_version": SCHEMA_VERSION,
        "source": {"path": str(Path(args.docx).resolve()), "sha256": source_hash},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entities": entities,
        "vocabulary_candidates": vocabulary_candidates(entities),
        "absorbed_names": (previous or {}).get("absorbed_names", {}),
    }
    write_json(args.out, guide)
    write_progress(args.progress, "DONE", 100, f"Built guide with {len(entities)} entities")
    print(f"BUILT|{len(entities)}|{args.out}")


def status(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        result = "STATUS|MISSING"
    elif guide.get("source", {}).get("sha256") != document_hash(args.docx):
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


def edit(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    if args.field == "locked":
        entity["locked"] = args.value.strip().lower() in {"1", "true", "yes", "on"}
    elif args.field == "description":
        entity.setdefault("description", {})["text"] = args.value
    elif args.field == "personality":
        entity["personality_notes"] = [{"text": args.value, "evidence": {"chapter": "User edit", "excerpt": "User-authored note."}}] if args.value else []
    elif args.field == "context":
        entity["context"] = args.value
    elif args.field == "category":
        if args.value in SYSTEM_CATEGORIES or args.value not in VALID_CATEGORIES:
            raise ValueError(f"Unknown or reserved category: {args.value}")
        entity["category"] = args.value
    elif args.field == "canonical_name":
        entity["canonical_name"] = args.value
    elif args.field == "aliases":
        requested = [item.strip() for item in args.value.split(";") if item.strip()]
        existing_by_text = {alias["text"].lower(): alias for alias in entity.get("aliases", [])}
        paragraphs = load_docx(args.docx) if args.docx else None
        new_aliases = []
        for name in requested:
            existing = existing_by_text.get(name.lower())
            if existing:
                new_aliases.append(existing)
                continue
            new_aliases.append(
                {
                    "text": name,
                    "pronunciation": pronunciation(name, args.espeak_library or None),
                    "occurrences": find_occurrences(paragraphs, name) if paragraphs is not None else [],
                }
            )
        entity["aliases"] = new_aliases
        entity["occurrence_count"] = entity_occurrence_count(entity)
    else:
        raise ValueError("Unsupported editable field.")
    entity["review_state"] = "reviewed"
    write_json(args.guide, guide)
    print("EDITED|" + args.entity_id)


def rescan(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    paragraphs = load_docx(args.docx)
    entity["occurrences"] = find_occurrences(paragraphs, entity["canonical_name"])
    for alias in entity.get("aliases", []):
        alias["occurrences"] = find_occurrences(paragraphs, alias["text"])
    entity["occurrence_count"] = entity_occurrence_count(entity)
    if entity.get("review_state") == "needs review" and entity["occurrence_count"]:
        entity["review_state"] = "reviewed"
    write_json(args.guide, guide)
    print(f"RESCANNED|{args.entity_id}|{entity['occurrence_count']}")


def create(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    category = args.category.strip() or "Draft"
    if category != "Draft" and category not in VALID_CATEGORIES:
        raise ValueError(f"Unknown category: {category}")
    name = args.name.strip()
    if not name:
        raise ValueError("Name is required.")
    new_id = entity_id(name)
    if any(value["id"] == new_id for value in guide["entities"]):
        raise ValueError("An entity with this name already exists.")
    alias_names = [item.strip() for item in args.aliases.split(";") if item.strip()]
    paragraphs = load_docx(args.docx)
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
        "locked": False,
        "manual": True,
        "review_state": "reviewed",
    }
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


def export_hotwords(args: argparse.Namespace) -> None:
    guide = load_json(args.guide) or {"entities": []}
    selected = set(filter(None, (args.entity_ids or "").split(",")))
    words: list[str] = []
    for entity in guide.get("entities", []):
        if selected and entity["id"] not in selected:
            continue
        words.append(entity["canonical_name"])
        words.extend(alias["text"] for alias in entity.get("aliases", []))
    deduplicated = list(dict.fromkeys(word for word in words if word.strip()))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(
        "# Generated by Manuscript Guide. Copy values into another tool if desired.\n" + ", ".join(deduplicated) + "\n",
        encoding="utf-8",
    )
    print(f"EXPORTED|{len(deduplicated)}|{args.out}")


def render_audio(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = find_entity(guide, args.entity_id)
    if not args.piper_exe or not args.piper_model:
        raise ValueError("Configure both the Piper executable and voice model before creating previews.")
    if args.alias_index is None:
        spoken = entity["canonical_name"]
        filename = f"{entity['id']}.wav"
    else:
        aliases = entity.get("aliases", [])
        if not 0 <= args.alias_index < len(aliases):
            raise ValueError("Alias index out of range.")
        spoken = aliases[args.alias_index]["text"]
        filename = f"{entity['id']}__alias{args.alias_index}.wav"
    audio_dir = Path(args.audio_dir)
    audio_dir.mkdir(parents=True, exist_ok=True)
    destination = audio_dir / filename
    subprocess.run([args.piper_exe, "--model", args.piper_model, "--output_file", str(destination)], input=spoken + "\n", text=True, check=True)
    print("AUDIO|" + str(destination))


def export_manuscript(args: argparse.Namespace) -> None:
    """Emits full chapter text with stable paragraph indices for the
    Manuscript reader page. Reuses load_docx() rather than re-parsing the
    .docx, so a paragraph's index here is guaranteed to line up with the
    "paragraph" field already stored in entity occurrences by build()/
    find_occurrences() - both walk the exact same list in the exact same
    order."""
    paragraphs = load_docx(args.docx)
    chapters: list[dict[str, object]] = []
    seen_chapters: dict[str, int] = {}
    for paragraph in paragraphs:
        chapter = paragraph["chapter"]
        word_count = len(paragraph["text"].split())
        if chapter not in seen_chapters:
            seen_chapters[chapter] = len(chapters)
            chapters.append({"title": chapter, "index": len(chapters), "wordCount": 0})
        chapters[seen_chapters[chapter]]["wordCount"] += word_count
    payload = {
        "chapters": chapters,
        "paragraphs": [{"chapter": p["chapter"], "index": i, "text": p["text"]} for i, p in enumerate(paragraphs)],
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(payload), encoding="utf-8")
    print(f"EXPORTED|{len(chapters)}|{len(paragraphs)}|{args.out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_subparsers(dest="command", required=True)
    build_parser = command.add_parser("build")
    build_parser.add_argument("--docx", required=True)
    build_parser.add_argument("--out", required=True)
    build_parser.add_argument("--progress")
    build_parser.add_argument("--spacy-model", default=get_default("ManuscriptGuide", "spacy_model", "en_core_web_sm"))
    build_parser.add_argument("--espeak-library", default="")
    status_parser = command.add_parser("status")
    status_parser.add_argument("--docx", required=True)
    status_parser.add_argument("--guide", required=True)
    status_parser.add_argument("--out")
    edit_parser = command.add_parser("edit")
    edit_parser.add_argument("--guide", required=True)
    edit_parser.add_argument("--entity-id", required=True)
    edit_parser.add_argument("--field", required=True)
    edit_parser.add_argument("--value", required=True)
    edit_parser.add_argument("--docx", default="")
    edit_parser.add_argument("--espeak-library", default="")
    rescan_parser = command.add_parser("rescan")
    rescan_parser.add_argument("--guide", required=True)
    rescan_parser.add_argument("--docx", required=True)
    rescan_parser.add_argument("--entity-id", required=True)
    create_parser = command.add_parser("create")
    create_parser.add_argument("--guide", required=True)
    create_parser.add_argument("--docx", required=True)
    create_parser.add_argument("--name", required=True)
    create_parser.add_argument("--category", default="")
    create_parser.add_argument("--aliases", default="")
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
    export_parser = command.add_parser("export-hotwords")
    export_parser.add_argument("--guide", required=True)
    export_parser.add_argument("--out", required=True)
    export_parser.add_argument("--entity-ids", default="")
    export_manuscript_parser = command.add_parser("export-manuscript")
    export_manuscript_parser.add_argument("--docx", required=True)
    export_manuscript_parser.add_argument("--out", required=True)
    audio_parser = command.add_parser("render-audio")
    audio_parser.add_argument("--guide", required=True)
    audio_parser.add_argument("--entity-id", required=True)
    audio_parser.add_argument("--audio-dir", required=True)
    audio_parser.add_argument("--piper-exe", required=True)
    audio_parser.add_argument("--piper-model", required=True)
    audio_parser.add_argument("--alias-index", type=int, default=None)
    args = parser.parse_args()
    try:
        {
            "build": build,
            "status": status,
            "edit": edit,
            "rescan": rescan,
            "create": create,
            "merge": merge,
            "delete": delete,
            "relate": relate,
            "unrelate": unrelate,
            "export-hotwords": export_hotwords,
            "render-audio": render_audio,
            "export-manuscript": export_manuscript,
        }[args.command](args)
    except Exception as exc:
        log(f"ERROR: {exc}")
        if args.command == "build":
            write_progress(getattr(args, "progress", None), "ERROR", 0, str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
