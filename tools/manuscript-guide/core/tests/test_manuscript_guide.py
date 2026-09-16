import argparse
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "manuscript_guide.py"
SPEC = importlib.util.spec_from_file_location("manuscript_guide", MODULE_PATH)
guide = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guide)


def _write_manuscript(root: Path, chapter_title: str, paragraph_texts: list[str]) -> Path:
    """Writes a minimal canonical manuscript.json directly at the path
    manuscript_guide.py reads via canonical_manuscript.load_file.

    Import (turning a .docx/.md source into this file) is Rust-only now -
    see shared/manuscript-import and shell/src-tauri/src/server/manuscript_canonical.rs.
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
    def test_spacy_empty_result_does_not_activate_rule_fallback(self):
        paragraphs = [{"chapter": "Chapter 1", "text": "Captain Arelian arrives."}]
        with (
            patch.object(guide, "spacy_candidates", return_value=[]),
            patch.object(guide, "rule_candidates", side_effect=AssertionError("rules should not run")),
        ):
            self.assertEqual([], guide.build_entities(paragraphs, "unused", None))

    def test_rule_fallback_strips_articles_and_prunes_singletons(self):
        paragraphs = [
            {"chapter": "Chapter 1", "text": "A Black Halo appeared. About noon, it vanished."},
            {"chapter": "Chapter 2", "text": "Black Halo appeared again."},
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
            hotwords = root / "ManuscriptGuide" / "whisper_hotwords.txt"
            guide.export_hotwords(argparse.Namespace(guide=str(guide_file), out=str(hotwords), entity_ids=""))
            self.assertIn("Dawnspire", hotwords.read_text(encoding="utf-8"))
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


if __name__ == "__main__":
    unittest.main()
