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

from narration_common.docx_chapters import load_docx_paragraphs  # noqa: E402
from narration_common.logging_utils import log  # noqa: E402
from narration_common.progress import write_progress  # noqa: E402


SCHEMA_VERSION = 1
CAPITALIZED = re.compile(r"\b[A-Z][A-Za-z'’-]*(?:\s+(?:(?:of|the|and)\s+)?[A-Z][A-Za-z'’-]*){0,3}\b")
SENTENCES = re.compile(r"(?<=[.!?])\s+")
STOPWORDS = {
    "A", "An", "And", "As", "At", "But", "Chapter", "For", "He", "Her", "His",
    "I", "In", "It", "Its", "My", "No", "Not", "Of", "On", "Or", "Our", "She",
    "The", "Their", "They", "This", "That", "These", "Those", "To", "We", "When",
    "With", "You", "Your",
}
PERSON_WORDS = {"said", "asked", "replied", "cried", "whispered", "smiled", "walked", "looked", "thought"}
PLACE_WORDS = {"city", "town", "village", "kingdom", "country", "street", "river", "mountain", "forest", "castle", "planet", "station", "island"}
ORG_WORDS = {"company", "guild", "order", "society", "council", "army", "agency", "corporation", "clan", "house", "university", "church"}
TITLE_WORDS = {"captain", "commander", "doctor", "dr", "lady", "lord", "master", "miss", "mister", "mr", "mrs", "ms", "professor", "queen", "king", "prince", "princess", "saint", "sir"}
TRAITS = {
    "angry", "anxious", "arrogant", "brave", "calm", "careful", "cautious", "cheerful",
    "clever", "cold", "cruel", "curious", "determined", "fearful", "fierce", "gentle",
    "generous", "gruff", "honest", "kind", "loyal", "nervous", "patient", "proud",
    "quiet", "ruthless", "sad", "shy", "stern", "tired", "warm", "wise", "wary",
}
ARPABET_TO_IPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "EH": "ɛ", "ER": "ɝ",
    "EY": "eɪ", "F": "f", "G": "ɡ", "HH": "h", "IH": "ɪ", "IY": "i",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ",
    "OW": "oʊ", "OY": "ɔɪ", "P": "p", "R": "r", "S": "s", "SH": "ʃ",
    "T": "t", "TH": "θ", "UH": "ʊ", "UW": "u", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
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
    for item in load_docx_paragraphs(path):
        text = item["text"]
        if item["is_heading"]:
            chapter = " ".join(text.split())
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
            found.append({
                "name": name,
                "chapter": paragraph["chapter"],
                "paragraph": str(para_index),
                "text": text,
                "start": str(match.start()),
                "end": str(match.end()),
                "source": "rule",
            })
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
            found.append({
                "name": ent.text.strip(), "chapter": paragraph["chapter"],
                "paragraph": str(para_index), "text": paragraph["text"],
                "start": str(ent.start_char), "end": str(ent.end_char),
                "source": ent.label_,
            })
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
    before = re.findall(r"[a-z]+", text[max(0, start - 28):start])
    after = re.findall(r"[a-z]+", text[end:min(len(text), end + 28)])
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
    try:
        import pronouncing
        words = re.findall(r"[A-Za-z]+", name)
        phones = [pronouncing.phones_for_word(word.lower())[0] for word in words if pronouncing.phones_for_word(word.lower())]
        if words and len(phones) == len(words):
            return {"say_as": name, "ipa": " ".join(arpabet_to_ipa(phone) for phone in phones), "source": "CMU dictionary", "confidence": "medium"}
    except Exception as exc:
        log(f"CMU pronunciation unavailable ({exc}).")
    try:
        from phonemizer import phonemize
        if espeak_library:
            from phonemizer.backend.espeak.wrapper import EspeakWrapper
            EspeakWrapper.set_library(espeak_library)
        ipa = phonemize(name, language="en-us", backend="espeak", strip=True, with_stress=True)
        if ipa:
            return {"say_as": name, "ipa": ipa, "source": "eSpeak NG", "confidence": "low"}
    except Exception as exc:
        log(f"eSpeak phonetic fallback unavailable ({exc}).")
    return {"say_as": name, "ipa": "", "source": "not generated", "confidence": "unknown"}


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
        category_counts: dict[str, int] = defaultdict(int)
        for occurrence in occurrences:
            category_counts[classify(occurrence)] += 1
        category = max(category_counts, key=category_counts.get)
        evidence = [{
            "chapter": item["chapter"],
            "excerpt": excerpt(item["text"], int(item["start"]), int(item["end"])),
        } for item in occurrences[:12]]
        entities.append({
            "id": entity_id(canonical_name),
            "canonical_name": canonical_name,
            "aliases": [name for name in names if name != canonical_name],
            "category": category,
            "occurrences": evidence,
            "occurrence_count": len(occurrences),
            "pronunciation": pronunciation(canonical_name, espeak_library),
            "description": direct_description(canonical_name, occurrences),
            "personality_notes": trait_notes(canonical_name, occurrences) if category == "Character" else [],
            "locked_fields": [],
            "review_state": "needs review" if category == "Needs Review" else "generated",
        })
    return sorted(entities, key=lambda entity: (entity["category"], entity["canonical_name"].lower()))


def load_json(path: str) -> dict[str, Any] | None:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def merge_locked(generated: list[dict[str, Any]], old: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not old:
        return generated
    previous = {entity["id"]: entity for entity in old.get("entities", [])}
    for entity in generated:
        prior = previous.get(entity["id"])
        if not prior:
            continue
        entity["locked_fields"] = prior.get("locked_fields", [])
        for field in entity["locked_fields"]:
            if field in prior:
                entity[field] = prior[field]
        # User-authored material is never replaced by an empty generated value.
        for field in ("description", "personality_notes"):
            if prior.get(field) and (field in entity["locked_fields"] or not entity.get(field)):
                entity[field] = prior[field]
    return generated


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


def pct(value: str) -> str:
    return value.replace("%", "%25").replace("|", "%7C").replace("\r", "").replace("\n", "%0A")


def index(args: argparse.Namespace) -> None:
    guide = load_json(args.guide) or {"entities": []}
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        for entity in guide.get("entities", []):
            first_evidence = (entity.get("occurrences") or [{}])[0]
            row = [
                entity["id"], entity.get("category", "Needs Review"), entity.get("canonical_name", ""),
                entity.get("pronunciation", {}).get("say_as", ""), entity.get("pronunciation", {}).get("ipa", ""),
                str(entity.get("occurrence_count", 0)), ",".join(entity.get("locked_fields", [])),
                entity.get("description", {}).get("text", ""),
                "; ".join(note.get("text", "") for note in entity.get("personality_notes", [])),
                first_evidence.get("chapter", ""), first_evidence.get("excerpt", ""),
            ]
            handle.write("ENTITY|" + "|".join(pct(str(value)) for value in row) + "\n")


def edit(args: argparse.Namespace) -> None:
    guide = load_json(args.guide)
    if not guide:
        raise ValueError("Guide file does not exist; build it first.")
    entity = next((value for value in guide["entities"] if value["id"] == args.entity_id), None)
    if entity is None:
        raise ValueError("Entity not found.")
    if args.field == "say_as":
        entity.setdefault("pronunciation", {})["say_as"] = args.value
    elif args.field == "ipa":
        entity.setdefault("pronunciation", {})["ipa"] = args.value
    elif args.field == "description":
        entity.setdefault("description", {})["text"] = args.value
    elif args.field == "personality":
        entity["personality_notes"] = [{"text": args.value, "evidence": {"chapter": "User edit", "excerpt": "User-authored note."}}] if args.value else []
    elif args.field in {"canonical_name", "category", "aliases"}:
        entity[args.field] = [item.strip() for item in args.value.split(";") if item.strip()] if args.field == "aliases" else args.value
    else:
        raise ValueError("Unsupported editable field.")
    locked = set(entity.get("locked_fields", []))
    if args.lock == "on":
        locked.add(args.field)
    elif args.lock == "off":
        locked.discard(args.field)
    entity["locked_fields"] = sorted(locked)
    entity["review_state"] = "reviewed"
    write_json(args.guide, guide)
    print("EDITED|" + args.entity_id)


def export_hotwords(args: argparse.Namespace) -> None:
    guide = load_json(args.guide) or {"entities": []}
    selected = set(filter(None, (args.entity_ids or "").split(",")))
    words: list[str] = []
    for entity in guide.get("entities", []):
        if selected and entity["id"] not in selected:
            continue
        words.append(entity["canonical_name"])
        words.extend(entity.get("aliases", []))
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
    entity = next((value for value in guide["entities"] if value["id"] == args.entity_id), None)
    if entity is None:
        raise ValueError("Entity not found.")
    if not args.piper_exe or not args.piper_model:
        raise ValueError("Configure both the Piper executable and voice model before creating previews.")
    audio_dir = Path(args.audio_dir)
    audio_dir.mkdir(parents=True, exist_ok=True)
    destination = audio_dir / f"{entity['id']}.wav"
    spoken = entity.get("pronunciation", {}).get("say_as") or entity["canonical_name"]
    subprocess.run([args.piper_exe, "--model", args.piper_model, "--output_file", str(destination)], input=spoken + "\n", text=True, check=True)
    entity["audio_preview"] = str(destination)
    write_json(args.guide, guide)
    print("AUDIO|" + str(destination))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_subparsers(dest="command", required=True)
    build_parser = command.add_parser("build")
    build_parser.add_argument("--docx", required=True)
    build_parser.add_argument("--out", required=True)
    build_parser.add_argument("--progress")
    build_parser.add_argument("--spacy-model", default="en_core_web_sm")
    build_parser.add_argument("--espeak-library", default="")
    status_parser = command.add_parser("status")
    status_parser.add_argument("--docx", required=True)
    status_parser.add_argument("--guide", required=True)
    status_parser.add_argument("--out")
    index_parser = command.add_parser("index")
    index_parser.add_argument("--guide", required=True)
    index_parser.add_argument("--out", required=True)
    edit_parser = command.add_parser("edit")
    edit_parser.add_argument("--guide", required=True)
    edit_parser.add_argument("--entity-id", required=True)
    edit_parser.add_argument("--field", required=True)
    edit_parser.add_argument("--value", required=True)
    edit_parser.add_argument("--lock", choices=["on", "off", "keep"], default="keep")
    export_parser = command.add_parser("export-hotwords")
    export_parser.add_argument("--guide", required=True)
    export_parser.add_argument("--out", required=True)
    export_parser.add_argument("--entity-ids", default="")
    audio_parser = command.add_parser("render-audio")
    audio_parser.add_argument("--guide", required=True)
    audio_parser.add_argument("--entity-id", required=True)
    audio_parser.add_argument("--audio-dir", required=True)
    audio_parser.add_argument("--piper-exe", required=True)
    audio_parser.add_argument("--piper-model", required=True)
    args = parser.parse_args()
    try:
        {"build": build, "status": status, "index": index, "edit": edit, "export-hotwords": export_hotwords, "render-audio": render_audio}[args.command](args)
    except Exception as exc:
        log(f"ERROR: {exc}")
        if args.command == "build":
            write_progress(getattr(args, "progress", None), "ERROR", 0, str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
