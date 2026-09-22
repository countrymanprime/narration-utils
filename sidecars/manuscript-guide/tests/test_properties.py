"""Entity properties: an ordered list of {key, value} facts the narrator keeps on an entry (story bible entries PRD, phase 1).

The list is additive: a Story Bible file written before it existed has no ``properties`` and reads as an empty list, and
``schema_version`` stays 2. Edits go through ``edit()``, so a locked entry refuses them (ADR 0007), and a rebuild carries them.
"""

import argparse
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).parents[1] / "core" / "manuscript_guide.py"
SPEC = importlib.util.spec_from_file_location("manuscript_guide", MODULE_PATH)
guide = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guide)

PAIRS = [{"key": "Codename", "value": "Wren"}, {"key": "Abilities", "value": "Flight, sleight of hand"}, {"key": "Dossier", "value": "Sealed."}]


def _write_manuscript(root: Path, paragraph_texts: list[str]) -> Path:
    paragraphs = [
        {"id": f"p-{i + 1:06d}", "index": i, "chapterId": "c-0001", "chapterTitle": "Chapter 1", "sectionId": None, "text": text, "sourceIndex": i}
        for i, text in enumerate(paragraph_texts)
    ]
    data = {
        "schemaVersion": guide.canonical_manuscript.SCHEMA_VERSION,
        "documentId": "test-document",
        "importedAt": "2026-01-01T00:00:00+00:00",
        "importer": {"format": "markdown", "version": guide.canonical_manuscript.IMPORTER_VERSION},
        "source": {"fileName": "fixture.md", "sha256": "0" * 64, "storedPath": "narration-utils/manuscript/sources/fixture.md"},
        "chapters": [{"id": "c-0001", "title": "Chapter 1", "subtitle": None, "index": 0, "wordCount": 1, "sections": []}],
        "paragraphs": paragraphs,
    }
    path = guide.canonical_manuscript.manuscript_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _guide_file(root: Path, **fields) -> Path:
    path = root / "ManuscriptGuide" / "manuscript_guide.json"
    entity = {"id": "entity-1", "canonical_name": "Alice", "category": "Character", "description": {"text": ""}, "aliases": [], **fields}
    guide.write_json(str(path), {"entities": [entity]})
    return path


def _edit(path: Path, properties: object) -> None:
    value = properties if isinstance(properties, str) else json.dumps(properties)
    guide.edit(argparse.Namespace(guide=str(path), entity_id="entity-1", field=["properties"], value=[value], manuscript=None, espeak_library=""))


def _entity(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["entities"][0]


class NormalizePropertiesTests(unittest.TestCase):
    def test_a_list_of_pairs_keeps_its_order(self):
        self.assertEqual(PAIRS, guide.normalize_properties(PAIRS))

    def test_keys_and_values_are_trimmed_and_a_value_may_be_empty(self):
        self.assertEqual([{"key": "Codename", "value": ""}], guide.normalize_properties([{"key": "  Codename ", "value": "  "}]))

    def test_an_empty_key_is_refused_with_its_position(self):
        with self.assertRaisesRegex(ValueError, "Property 2 has no name"):
            guide.normalize_properties([{"key": "A", "value": "1"}, {"key": " ", "value": "2"}])

    def test_two_properties_with_one_name_are_refused_whatever_the_case(self):
        with self.assertRaisesRegex(ValueError, "two properties named"):
            guide.normalize_properties([{"key": "Codename", "value": "1"}, {"key": "codename", "value": "2"}])

    def test_anything_that_is_not_a_list_of_string_pairs_is_refused(self):
        for bad in ({"Codename": "Wren"}, ["Codename"], [{"key": "A"}], [{"key": 1, "value": "x"}], [{"key": "A", "value": None}], "Codename"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                guide.normalize_properties(bad)

    def test_the_text_a_command_line_carries_is_parsed_as_json(self):
        self.assertEqual(PAIRS, guide.parse_properties(json.dumps(PAIRS)))
        self.assertEqual([], guide.parse_properties(""))
        with self.assertRaisesRegex(ValueError, "not valid JSON"):
            guide.parse_properties("{not json")


class EditPropertiesTests(unittest.TestCase):
    def test_edit_sets_the_list_in_order_and_counts_as_a_review(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), review_state="needs review")
            _edit(path, PAIRS)
            entity = _entity(path)
            self.assertEqual(PAIRS, entity["properties"])
            self.assertEqual("reviewed", entity["review_state"])

    def test_reordering_and_removing_rows_persist(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), properties=PAIRS)
            _edit(path, [PAIRS[2], PAIRS[0]])
            self.assertEqual([PAIRS[2], PAIRS[0]], _entity(path)["properties"])
            _edit(path, [])
            self.assertEqual([], _entity(path)["properties"])

    def test_a_locked_entry_refuses_a_property_change_and_stays_as_it_was(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), locked=True, properties=PAIRS[:1])
            before = path.read_text(encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "locked"):
                _edit(path, PAIRS)
            self.assertEqual(before, path.read_text(encoding="utf-8"))

    def test_a_bad_list_changes_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), properties=PAIRS[:1])
            before = path.read_text(encoding="utf-8")
            with self.assertRaises(ValueError):
                _edit(path, [{"key": "", "value": "x"}])
            self.assertEqual(before, path.read_text(encoding="utf-8"))

    def test_the_command_line_takes_the_list_as_one_json_value(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            argv = ["manuscript_guide.py", "edit", "--guide", str(path), "--entity-id", "entity-1", "--field", "properties", "--value=" + json.dumps(PAIRS)]
            with patch.object(sys, "argv", argv), patch.object(sys, "stdout", io.StringIO()):
                guide.main()
            self.assertEqual(PAIRS, _entity(path)["properties"])

    def test_a_file_written_before_properties_existed_reads_as_an_empty_list(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            self.assertNotIn("properties", _entity(path))
            self.assertEqual([], guide.entity_properties(_entity(path)))


class CreatePropertiesTests(unittest.TestCase):
    def _create(self, root: Path, **extra) -> dict:
        manuscript = _write_manuscript(root, ["Juno walked in."])
        path = root / "ManuscriptGuide" / "manuscript_guide.json"
        args = {"guide": str(path), "manuscript": str(manuscript), "category": "Character", "aliases": "", "espeak_library": "", "name": "Juno", **extra}
        guide.create(argparse.Namespace(**args))
        return json.loads(path.read_text(encoding="utf-8"))["entities"][0]

    def test_create_takes_the_properties_in_the_same_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            entity = self._create(Path(temporary), properties=json.dumps(PAIRS))
            self.assertEqual(PAIRS, entity["properties"])

    def test_a_new_entity_without_properties_has_an_empty_list(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.assertEqual([], self._create(Path(temporary))["properties"])
            self.assertEqual([], self._create(Path(temporary) / "other", properties="")["properties"])

    def test_the_command_line_takes_create_properties(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manuscript = _write_manuscript(root, ["Juno walked in."])
            path = root / "ManuscriptGuide" / "manuscript_guide.json"
            argv = ["manuscript_guide.py", "create", "--guide", str(path), "--manuscript", str(manuscript), "--name", "Juno", "--category", "Character"]
            argv += ["--properties=" + json.dumps(PAIRS)]
            with patch.object(sys, "argv", argv), patch.object(sys, "stdout", io.StringIO()):
                guide.main()
            self.assertEqual(PAIRS, json.loads(path.read_text(encoding="utf-8"))["entities"][0]["properties"])

    def test_bad_properties_create_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manuscript = _write_manuscript(root, ["Juno walked in."])
            path = root / "ManuscriptGuide" / "manuscript_guide.json"
            with self.assertRaises(ValueError):
                guide.create(
                    argparse.Namespace(
                        guide=str(path), manuscript=str(manuscript), category="Character", aliases="", espeak_library="", name="Juno", properties="[1]"
                    )
                )
            self.assertFalse(path.exists())


class RebuildPropertiesTests(unittest.TestCase):
    def _generated(self, name: str = "Alice") -> dict:
        return {
            "id": guide.entity_id(name),
            "canonical_name": name,
            "aliases": [],
            "category": "Character",
            "occurrences": [],
            "occurrence_count": 0,
            "pronunciation": {},
            "description": {"text": "", "evidence": {}},
            "personality_notes": [],
            "context": "",
            "relationships": [],
            "properties": [],
            "locked": False,
            "manual": False,
            "review_state": "generated",
        }

    def test_a_built_entity_starts_with_an_empty_list(self):
        paragraphs = [{"chapter": "Chapter 1", "text": "Captain Arelian said the Council of Ash would meet in Dawnspire."}] * 3
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities = guide.build_entities(paragraphs, "unused", None)
        self.assertTrue(entities)
        self.assertTrue(all(entity["properties"] == [] for entity in entities))

    def test_a_rebuild_keeps_the_properties_of_a_generated_entry(self):
        prior = {**self._generated(), "properties": PAIRS, "review_state": "reviewed"}
        merged = guide.merge_locked([self._generated()], {"entities": [prior]})
        self.assertEqual(PAIRS, merged[0]["properties"])

    def test_a_rebuild_keeps_the_properties_of_a_locked_and_a_manual_entry(self):
        locked = {**self._generated("Vex"), "locked": True, "properties": PAIRS}
        manual = {**self._generated("Nyx"), "manual": True, "properties": PAIRS[:1]}
        merged = {entity["id"]: entity for entity in guide.merge_locked([self._generated("Vex")], {"entities": [locked, manual]})}
        self.assertEqual(PAIRS, merged[locked["id"]]["properties"])
        self.assertEqual(PAIRS[:1], merged[manual["id"]]["properties"])

    def test_a_rebuild_over_a_file_without_properties_gives_an_empty_list(self):
        prior = self._generated()
        del prior["properties"]
        merged = guide.merge_locked([self._generated()], {"entities": [prior]})
        self.assertEqual([], merged[0]["properties"])


class MergePropertiesTests(unittest.TestCase):
    def test_merging_keeps_the_target_values_and_adds_the_sources_other_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "guide.json"
            source = {
                "id": "s",
                "canonical_name": "Wren",
                "category": "Character",
                "aliases": [],
                "relationships": [],
                "occurrences": [],
                "properties": [{"key": "Codename", "value": "Source"}, {"key": "Eyes", "value": "Grey"}],
            }
            target = {
                "id": "t",
                "canonical_name": "Alice",
                "category": "Character",
                "aliases": [],
                "relationships": [],
                "occurrences": [],
                "properties": [{"key": "codename", "value": "Target"}],
            }
            guide.write_json(str(path), {"entities": [source, target]})
            guide.merge(argparse.Namespace(guide=str(path), source_id="s", target_id="t"))
            merged = json.loads(path.read_text(encoding="utf-8"))["entities"][0]
            self.assertEqual([{"key": "codename", "value": "Target"}, {"key": "Eyes", "value": "Grey"}], merged["properties"])


if __name__ == "__main__":
    unittest.main()
