import argparse
import importlib.util
import json
import re
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import MagicMock, patch

MODULE_PATH = Path(__file__).parents[1] / "manuscript_guide.py"
SPEC = importlib.util.spec_from_file_location("manuscript_guide", MODULE_PATH)
guide = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guide)


def _write_manuscript(root: Path, chapter_title: str, paragraph_texts: list[str]) -> Path:
    """Writes a minimal canonical manuscript.json directly at the path
    manuscript_guide.py reads via canonical_manuscript.load_file.

    Import (turning a .docx/.md source into this file) is Go-host-only now -
    see shell/cmd/manuscript-import and shell/internal/manuscript.
    These tests only need a real, valid canonical file to build a Story
    Bible from, not the import step itself.
    """
    paragraphs = [
        {
            "id": f"p-{index + 1:06d}",
            "index": index,
            "chapterId": "c-0001",
            "chapterTitle": chapter_title,
            "sectionId": None,
            "text": text,
            "sourceIndex": index,
        }
        for index, text in enumerate(paragraph_texts)
    ]
    data = {
        "schemaVersion": guide.canonical_manuscript.SCHEMA_VERSION,
        "documentId": "test-document",
        "importedAt": "2026-01-01T00:00:00+00:00",
        "importer": {"format": "markdown", "version": guide.canonical_manuscript.IMPORTER_VERSION},
        "source": {"fileName": "fixture.md", "sha256": "0" * 64, "storedPath": "narration-utils/manuscript/sources/fixture.md"},
        "chapters": [
            {
                "id": "c-0001",
                "title": chapter_title,
                "subtitle": None,
                "index": 0,
                "wordCount": sum(len(text.split()) for text in paragraph_texts),
                "sections": [],
            }
        ],
        "paragraphs": paragraphs,
    }
    path = guide.canonical_manuscript.manuscript_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


class ManuscriptGuideTests(unittest.TestCase):
    def test_reference_material_is_not_scanned_as_narration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "manuscript.json"
            path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "documentId": "test",
                        "chapters": [
                            {"id": "c-1", "title": "Chapter 1", "contentKind": "narration"},
                            {"id": "c-2", "title": "Characters", "contentKind": "reference"},
                        ],
                        "paragraphs": [
                            {"id": "p-1", "chapterId": "c-1", "chapterTitle": "Chapter 1", "text": "Ada arrives."},
                            {"id": "p-2", "chapterId": "c-2", "chapterTitle": "Characters", "text": "Ben Holt."},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(["Ada arrives."], [item["text"] for item in guide.load_manuscript(str(path))])

    def test_spacy_empty_result_does_not_activate_rule_fallback(self):
        paragraphs = [{"chapter": "Chapter 1", "text": "Captain Arelian arrives."}]
        with (
            patch.object(guide, "spacy_candidates", return_value=[]),
            patch.object(guide, "rule_candidates", side_effect=AssertionError("rules should not run")),
        ):
            self.assertEqual([], guide.build_entities(paragraphs, "unused", None))

    def test_rule_fallback_strips_articles_and_keeps_names_seen_three_times(self):
        paragraphs = [
            {"chapter": "Chapter 1", "text": "A Black Halo appeared. About noon, it vanished."},
            {"chapter": "Chapter 2", "text": "Black Halo appeared again."},
            {"chapter": "Chapter 3", "text": "Black Halo appeared once more."},
        ]
        candidates = guide.rule_candidates(paragraphs)
        self.assertIn("Black Halo", [candidate["name"] for candidate in candidates])
        self.assertNotIn("About", [candidate["name"] for candidate in candidates])
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities = guide.build_entities(paragraphs, "unused", None)
        self.assertEqual(["Black Halo"], [entity["canonical_name"] for entity in entities])

    def test_locked_edit_survives_rebuild(self):
        generated = [
            {
                "id": "entity-abc",
                "canonical_name": "Arelian",
                "category": "Character",
                "pronunciation": {"say_as": "Arelian"},
                "description": {"text": ""},
                "personality_notes": [],
                "locked": False,
            }
        ]
        previous = {
            "entities": [
                {
                    "id": "entity-abc",
                    "canonical_name": "Arelian",
                    "category": "Character",
                    "pronunciation": {"say_as": "ah-RELL-ee-in"},
                    "description": {"text": ""},
                    "personality_notes": [],
                    "locked": True,
                }
            ]
        }
        merged = guide.merge_locked(generated, previous)
        self.assertEqual("ah-RELL-ee-in", merged[0]["pronunciation"]["say_as"])

    def test_edit_rejects_every_field_on_a_locked_entity_except_unlocking(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
            guide.write_json(
                str(guide_file),
                {"entities": [{"id": "entity-1", "canonical_name": "Alice", "category": "Character", "locked": True}]},
            )
            with self.assertRaises(ValueError):
                guide.edit(
                    argparse.Namespace(
                        guide=str(guide_file), entity_id="entity-1", field="description", value="A new description.", manuscript=None, espeak_library=""
                    )
                )
            # Unlocking itself must still be allowed.
            guide.edit(argparse.Namespace(guide=str(guide_file), entity_id="entity-1", field="locked", value="false", manuscript=None, espeak_library=""))
            data = json.loads(guide_file.read_text(encoding="utf-8"))
            self.assertFalse(data["entities"][0]["locked"])

    def test_direct_trait_has_evidence(self):
        occurrences = [{"chapter": "Chapter 1", "text": "Arelian was brave and wary.", "start": "0", "end": "7"}]
        notes = guide.trait_notes("Arelian", occurrences)
        self.assertEqual({"Described as brave.", "Described as wary."}, {note["text"] for note in notes})
        self.assertEqual("Chapter 1", notes[0]["evidence"]["chapter"])

    def test_fiction_fixture_extracts_candidates_and_source_evidence(self):
        paragraphs = [
            {"chapter": "Chapter 1", "text": "Captain Arelian said the Council of Ash would meet in Dawnspire."},
            {"chapter": "Chapter 1", "text": "Arelian was a veteran navigator, brave and wary before the council arrived."},
        ]
        entities = guide.build_entities(paragraphs, "model-that-is-not-installed", None)
        by_name = {entity["canonical_name"]: entity for entity in entities}
        self.assertIn("Captain Arelian", by_name)
        self.assertEqual("Character", by_name["Captain Arelian"]["category"])
        self.assertTrue(by_name["Captain Arelian"]["occurrences"][0]["excerpt"])
        self.assertEqual("Explicitly described as veteran navigator.", by_name["Captain Arelian"]["description"]["text"])

    def test_status_and_hotword_export_are_independent_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manuscript = _write_manuscript(root, "Chapter 1", ["fixture manuscript"])
            guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
            guide.write_json(
                str(guide_file),
                {
                    "source": {"sha256": guide.document_hash(str(manuscript))},
                    "entities": [
                        {
                            "id": "entity-1",
                            "canonical_name": "Dawnspire",
                            "aliases": [{"text": "the Spire", "pronunciation": {}, "occurrences": []}],
                        }
                    ],
                },
            )
            status_file = root / "ManuscriptGuide" / "status.txt"
            guide.status(argparse.Namespace(manuscript=str(manuscript), guide=str(guide_file), out=str(status_file)))
            self.assertEqual("STATUS|CURRENT\n", status_file.read_text(encoding="utf-8"))
            self.assertFalse((root / "TranscriptCompare").exists())

    def test_build_uses_project_owned_guide_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manuscript = _write_manuscript(
                root,
                "Chapter 1",
                ["Captain Arelian said the Council of Ash would meet in Dawnspire."],
            )
            output = root / "ManuscriptGuide" / "manuscript_guide.json"
            guide.build(
                argparse.Namespace(
                    manuscript=str(manuscript),
                    out=str(output),
                    progress=str(root / "ManuscriptGuide" / "progress.txt"),
                    spacy_model="en_core_web_sm",
                    espeak_library="",
                )
            )
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(guide.document_hash(str(manuscript)), data["source"]["sha256"])
            self.assertTrue(data["entities"])
            expected_candidates = sorted(
                {name for entity in data["entities"] for name in [entity["canonical_name"], *(alias["text"] for alias in entity["aliases"])]},
                key=str.casefold,
            )
            self.assertEqual(expected_candidates, data["vocabulary_candidates"])
            self.assertTrue((root / "ManuscriptGuide" / "progress.txt").read_text(encoding="utf-8").startswith("DONE|100"))

    def test_create_initializes_a_guide_file_when_none_exists_yet(self):
        # A manuscript import can seed manual character candidates before the
        # Story Bible has ever been Built - see shell/bindings.go's
        # ManuscriptImportCommit - so create() must not require a prior build.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manuscript = _write_manuscript(root, "Chapter 1", ["Alice arrives in Dawnspire."])
            guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
            self.assertFalse(guide_file.exists())
            guide.create(
                argparse.Namespace(
                    guide=str(guide_file),
                    name="Alice",
                    category="Character",
                    aliases="",
                    manuscript=str(manuscript),
                    espeak_library="",
                )
            )
            data = json.loads(guide_file.read_text(encoding="utf-8"))
            self.assertEqual(["Alice"], [entity["canonical_name"] for entity in data["entities"]])
            self.assertTrue(data["entities"][0]["manual"])

    def test_preview_uses_bundled_piper_api_not_a_checkout_executable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
            guide.write_json(str(guide_file), {"entities": [{"id": "entity-1", "canonical_name": "Dawnspire", "aliases": []}]})
            voice = MagicMock()

            def synthesize(_spoken, wav_file):
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(22050)
                wav_file.writeframes(b"\0\0")

            voice.synthesize_wav.side_effect = synthesize
            with patch.object(guide.PiperVoice, "load", return_value=voice) as load:
                guide.render_audio(
                    argparse.Namespace(
                        guide=str(guide_file),
                        entity_id="entity-1",
                        audio_dir=str(root / "ManuscriptGuide" / "audio"),
                        piper_model=str(root / "voice.onnx"),
                        alias_index=None,
                        output_name="preview.wav",
                    )
                )
            load.assert_called_once_with(str(root / "voice.onnx"))
            voice.synthesize_wav.assert_called_once()
            self.assertTrue((root / "ManuscriptGuide" / "audio" / "preview.wav").is_file())


def _paragraphs(*texts: str) -> list[dict[str, str]]:
    return [{"chapter": "Chapter 1", "text": text} for text in texts]


def _stub_spacy(entities: dict[str, str]):
    """Patches spacy.load with a fake pipeline. `entities` maps a literal entity
    text to its NER label; every whole-word occurrence in each paragraph is
    reported as an entity of that label."""

    def pipe(texts):
        for text in texts:
            found = [
                SimpleNamespace(text=literal, label_=label, start_char=match.start(), end_char=match.end())
                for literal, label in entities.items()
                for match in re.finditer(r"(?<![A-Za-z])" + re.escape(literal) + r"(?![A-Za-z])", text)
            ]
            yield SimpleNamespace(ents=sorted(found, key=lambda ent: ent.start_char))

    return patch("spacy.load", return_value=SimpleNamespace(pipe=pipe))


COMMON_WORD_PARAGRAPHS = _paragraphs(
    "Abandoned ships drifted past. Nobody wanted an abandoned hull.",
    "Adorable puppies barked. The adorable pair ran off.",
    "Afraid to speak, she waited. She was afraid of the dark.",
    "Active minds wander. An active mind is a happy mind.",
    "ACCEPTABLE terms were offered. The terms were acceptable to all.",
)
COMMON_WORD_LABELS = {word: "PERSON" for word in ("Abandoned", "Adorable", "Afraid", "Active", "ACCEPTABLE")}
NAME_PARAGRAPHS = _paragraphs(
    "Captain Arelian said the Council of Ash would meet in Dawnspire.",
    "Arelian was a veteran navigator, brave and wary before the council arrived.",
    "Later they saw Dawnspire burning. The road to Dawnspire was long.",
    "Everyone knew Dawnspire well.",
)
HOPE_PARAGRAPHS = _paragraphs("They loved Hope dearly.", "Ada stood near Hope and wept.", "Without hope there is nothing.")


class StrictEntityExtractionTests(unittest.TestCase):
    """Precision over recall: see docs/architecture/story-bible-entity-accuracy.md."""

    # (a) common words never become entities -------------------------------

    def test_rules_only_rejects_sentence_initial_common_words(self):
        self.assertEqual([], guide.rule_candidates(COMMON_WORD_PARAGRAPHS))
        with patch.object(guide, "spacy_candidates", return_value=None):
            self.assertEqual([], guide.build_entities(COMMON_WORD_PARAGRAPHS, "unused", None))

    def test_spacy_path_rejects_common_words_even_when_tagged_person(self):
        with _stub_spacy(COMMON_WORD_LABELS):
            self.assertEqual([], guide.spacy_candidates(COMMON_WORD_PARAGRAPHS, "stub"))
            self.assertEqual([], guide.build_entities(COMMON_WORD_PARAGRAPHS, "stub", None))

    def test_rules_only_rejects_common_word_capitalized_mid_sentence_twice(self):
        self.assertEqual([], guide.rule_candidates(HOPE_PARAGRAPHS))

    def test_rules_only_rejects_adjective_suffix_words_without_spacy_support(self):
        paragraphs = _paragraphs("They fled Blazing near Hollowed at dusk.", "Ada left Blazing near Hollowed behind.")
        self.assertEqual([], guide.rule_candidates(paragraphs))

    def test_spacy_tag_plus_two_mid_sentence_mentions_rescues_a_common_looking_word(self):
        with _stub_spacy({"Hope": "PERSON"}):
            self.assertEqual(["Hope", "Hope"], [c["name"] for c in guide.spacy_candidates(HOPE_PARAGRAPHS, "stub")])

    def test_spacy_tag_alone_does_not_rescue_a_common_looking_word_with_one_mid_sentence_mention(self):
        paragraphs = _paragraphs("They loved Hope dearly.", "Without hope there is nothing.")
        with _stub_spacy({"Hope": "PERSON"}):
            self.assertEqual([], guide.spacy_candidates(paragraphs, "stub"))

    def test_spacy_tag_rescues_suffix_word_only_with_two_mid_sentence_mentions(self):
        paragraphs = _paragraphs("They fled Blazing at dusk.", "Ada left Blazing behind.")
        with _stub_spacy({"Blazing": "GPE"}):
            self.assertEqual(2, len(guide.spacy_candidates(paragraphs, "stub")))
        with _stub_spacy({"Blazing": "GPE"}):
            self.assertEqual([], guide.spacy_candidates(paragraphs[:1], "stub"))

    def test_stopword_single_word_spacy_entities_are_dropped(self):
        with _stub_spacy({"They": "PERSON"}):
            self.assertEqual([], guide.spacy_candidates(_paragraphs("Ada saw them. They ran. They hid."), "stub"))

    # (b) filler prefixes and no default-to-Character ----------------------

    def test_spacy_strips_leading_filler_from_entity_text(self):
        text = "They talked About S-Dawn all night."
        with _stub_spacy({"About S-Dawn": "GPE"}):
            candidates = guide.spacy_candidates(_paragraphs(text), "stub")
        self.assertEqual(["S-Dawn"], [c["name"] for c in candidates])
        self.assertEqual("S-Dawn", text[int(candidates[0]["start"]) : int(candidates[0]["end"])])

    def test_spacy_entity_made_only_of_filler_is_dropped(self):
        with _stub_spacy({"The": "ORG", "of the": "ORG"}):
            self.assertEqual([], guide.spacy_candidates(_paragraphs("The end of the road."), "stub"))

    def test_rules_strip_leading_filler_and_stopwords_from_multi_word_names(self):
        paragraphs = _paragraphs("He asked About S-Dawn twice.", "Then Ada Voss arrived. With Ada Voss came rain.")
        names = [c["name"] for c in guide.rule_candidates(paragraphs)]
        self.assertNotIn("About S-Dawn", names)
        self.assertNotIn("Then Ada Voss", names)
        self.assertNotIn("With Ada Voss", names)
        self.assertEqual(["Ada Voss", "Ada Voss"], [name for name in names if name.startswith("Ada")])

    def test_unexplained_single_word_is_never_categorized_as_character(self):
        paragraphs = _paragraphs(
            "S-Dawn said nothing for a long while.",
            "They talked About S-Dawn all night.",
            "Nobody trusted S-Dawn, and S-Dawn looked away.",
        )
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities = guide.build_entities(paragraphs, "unused", None)
        by_name = {entity["canonical_name"]: entity for entity in entities}
        self.assertIn("S-Dawn", by_name)
        self.assertEqual("Needs Review", by_name["S-Dawn"]["category"])
        self.assertEqual("needs review", by_name["S-Dawn"]["review_state"])
        self.assertNotIn("About S-Dawn", by_name)

    def test_proximity_cues_only_apply_to_multi_word_names(self):
        single = {"name": "Zyx", "source": "rule", "text": "Zyx said hello.", "start": "0", "end": "3"}
        multi = {"name": "Zyx Qor", "source": "rule", "text": "Zyx Qor said hello.", "start": "0", "end": "7"}
        self.assertEqual("Needs Review", guide.classify(single))
        self.assertEqual("Character", guide.classify(multi))

    def test_explicit_title_place_and_org_rules_still_apply(self):
        def candidate(name):
            return {"name": name, "source": "rule", "text": name, "start": "0", "end": str(len(name))}

        self.assertEqual("Character", guide.classify(candidate("Captain Arelian")))
        self.assertEqual("Place", guide.classify(candidate("Silver River")))
        self.assertEqual("Organization", guide.classify(candidate("Council of Ash")))

    def test_needs_review_entities_need_three_occurrences(self):
        two = _paragraphs("Ada met Zyx Qor there.", "Later Ada left Zyx Qor alone.")
        three = [*two, *_paragraphs("Ada forgot Zyx Qor entirely.")]
        with patch.object(guide, "spacy_candidates", return_value=None):
            self.assertEqual([], guide.build_entities(two, "unused", None))
            entities = guide.build_entities(three, "unused", None)
        self.assertEqual([("Zyx Qor", "Needs Review", 3)], [(e["canonical_name"], e["category"], e["occurrence_count"]) for e in entities])

    # (c) real names survive ------------------------------------------------

    def test_rules_only_keeps_real_multi_occurrence_names(self):
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities = guide.build_entities(NAME_PARAGRAPHS, "unused", None)
        by_name = {entity["canonical_name"]: entity for entity in entities}
        self.assertEqual({"Captain Arelian", "Council of Ash", "Dawnspire"}, set(by_name))
        self.assertEqual("Character", by_name["Captain Arelian"]["category"])
        self.assertEqual(["Arelian"], [alias["text"] for alias in by_name["Captain Arelian"]["aliases"]])
        self.assertEqual("Organization", by_name["Council of Ash"]["category"])
        self.assertEqual(4, by_name["Dawnspire"]["occurrence_count"])

    def test_rules_only_drops_a_single_word_seen_capitalized_mid_sentence_once(self):
        paragraphs = _paragraphs("They sailed to Dawnspire.", "Dawnspire fell. Dawnspire burned.")
        self.assertEqual([], guide.rule_candidates(paragraphs))

    def test_spacy_path_keeps_real_names_with_their_categories(self):
        labels = {"Captain Arelian": "PERSON", "Arelian": "PERSON", "Council of Ash": "ORG", "Dawnspire": "GPE"}
        with _stub_spacy(labels):
            entities = guide.build_entities(NAME_PARAGRAPHS, "stub", None)
        categories = {entity["canonical_name"]: entity["category"] for entity in entities}
        self.assertEqual({"Captain Arelian": "Character", "Council of Ash": "Organization", "Dawnspire": "Place"}, categories)

    # (d) vocabulary candidates --------------------------------------------

    def test_vocabulary_candidates_exclude_needs_review_and_low_count_singletons(self):
        def entity(name, category, count, **extra):
            return {"canonical_name": name, "category": category, "occurrence_count": count, "aliases": [], "locked": False, "manual": False, **extra}

        entities = [
            entity("Captain Arelian", "Character", 1, aliases=[{"text": "Arelian", "occurrences": []}]),
            entity("Halo", "Character", 2),
            entity("Dawnspire", "Place", 3),
            entity("Vex", "Character", 1, locked=True),
            entity("Nyx", "Draft", 0, manual=True),
            entity("Black Halo", "Needs Review", 9),
            entity("Mystery", "Needs Review", 5),
        ]
        self.assertEqual(["Arelian", "Captain Arelian", "Dawnspire", "Nyx", "Vex"], guide.vocabulary_candidates(entities))

    # (e) locked / manual entities survive a rebuild ------------------------

    def test_locked_and_manual_entities_survive_rebuild_unchanged(self):
        with patch.object(guide, "spacy_candidates", return_value=None):
            generated = guide.build_entities(NAME_PARAGRAPHS, "unused", None)
        locked_dawnspire = {
            "id": guide.entity_id("Dawnspire"),
            "canonical_name": "Dawnspire",
            "aliases": [],
            "category": "Place",
            "occurrences": [],
            "occurrence_count": 0,
            "pronunciation": {"ipa": "custom"},
            "description": {"text": "Hand written.", "evidence": {}},
            "personality_notes": [],
            "locked": True,
            "manual": False,
        }
        # Would never be extracted (single word, one mention) but is locked.
        locked_vex = {**locked_dawnspire, "id": guide.entity_id("Vex"), "canonical_name": "Vex", "category": "Character", "occurrence_count": 1}
        manual_nyx = {**locked_dawnspire, "id": guide.entity_id("Nyx"), "canonical_name": "Nyx", "category": "Lore", "locked": False, "manual": True}
        previous = {"entities": [locked_dawnspire, locked_vex, manual_nyx]}
        merged = {entity["id"]: entity for entity in guide.merge_locked(generated, previous)}
        self.assertEqual(locked_dawnspire, merged[locked_dawnspire["id"]])
        self.assertEqual(locked_vex, merged[locked_vex["id"]])
        self.assertEqual(manual_nyx, merged[manual_nyx["id"]])
        self.assertIn(guide.entity_id("Captain Arelian"), merged)
        vocabulary = guide.vocabulary_candidates(list(merged.values()))
        self.assertTrue({"Dawnspire", "Vex", "Nyx"} <= set(vocabulary))


if __name__ == "__main__":
    unittest.main()
