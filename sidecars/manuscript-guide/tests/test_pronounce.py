"""Generate/replace pronunciation controls (story bible entries PRD, phase 3, D13/B9/B10/B11).

`pronounce_source` gets a pronunciation from one named engine and raises when that engine has nothing for the name,
instead of the automatic-fallback ``pronunciation()`` that quietly reports "not generated". The ``pronounce`` command
applies it to an entity's own name or one of its aliases, refuses a locked entity (ADR 0007), and marks the value
``chosen`` so a rebuild (`merge_locked`) keeps it (B11) instead of overwriting it with a freshly generated one.
"""

import argparse
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).parents[1] / "core" / "manuscript_guide.py"
SPEC = importlib.util.spec_from_file_location("manuscript_guide", MODULE_PATH)
guide = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guide)


def _guide_file(root: Path, **fields) -> Path:
    path = root / "ManuscriptGuide" / "manuscript_guide.json"
    entity = {
        "id": "entity-1",
        "canonical_name": "Wren",
        "category": "Character",
        "aliases": [{"text": "the Sparrow", "pronunciation": {}, "occurrences": []}],
        **fields,
    }
    guide.write_json(str(path), {"entities": [entity]})
    return path


def _entity(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["entities"][0]


class PronounceSourceTests(unittest.TestCase):
    def test_cmu_returns_the_dictionary_pronunciation(self):
        value = guide.pronounce_source("hello", None, "cmu")
        self.assertEqual("CMU dictionary", value["source"])
        self.assertEqual("medium", value["confidence"])
        self.assertTrue(value["ipa"])

    def test_cmu_raises_for_a_name_the_dictionary_has_no_entry_for(self):
        with self.assertRaisesRegex(ValueError, "CMU dictionary has no entry"):
            guide.pronounce_source("Zzyzxqq", None, "cmu")

    def test_espeak_raises_when_it_produces_nothing(self):
        with patch("phonemizer.phonemize", return_value=""), self.assertRaisesRegex(ValueError, "eSpeak"):
            guide.pronounce_source("Name", None, "espeak")

    def test_espeak_returns_its_pronunciation_when_it_has_one(self):
        with patch("phonemizer.phonemize", return_value="n eɪ m"):
            value = guide.pronounce_source("Name", None, "espeak")
        self.assertEqual({"ipa": "n eɪ m", "source": "eSpeak NG", "confidence": "low"}, value)

    def test_an_unknown_source_is_refused(self):
        with self.assertRaises(ValueError):
            guide.pronounce_source("Name", None, "google")

    def test_pronunciation_still_falls_back_automatically_and_never_raises(self):
        with patch.object(guide, "pronounce_source", side_effect=ValueError("no")):
            self.assertEqual({"ipa": "", "source": "not generated", "confidence": "unknown"}, guide.pronunciation("Name", None))


class PronounceCommandTests(unittest.TestCase):
    def _run(self, path: Path, alias_index=None, source="cmu"):
        guide.pronounce(argparse.Namespace(guide=str(path), entity_id="entity-1", alias_index=alias_index, source=source, espeak_library=""))

    def test_sets_the_canonical_pronunciation_and_marks_it_chosen(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), canonical_name="hello")
            self._run(path)
            value = _entity(path)["pronunciation"]
            self.assertEqual("CMU dictionary", value["source"])
            self.assertTrue(value["chosen"])

    def test_sets_an_alias_pronunciation_by_index_and_leaves_the_canonical_one_alone(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), aliases=[{"text": "hello", "pronunciation": {}, "occurrences": []}])
            self._run(path, alias_index=0)
            entity = _entity(path)
            self.assertTrue(entity["aliases"][0]["pronunciation"]["chosen"])
            self.assertNotIn("pronunciation", entity)

    def test_an_alias_index_out_of_range_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            with self.assertRaisesRegex(ValueError, "out of range"):
                self._run(path, alias_index=5)

    def test_a_locked_entity_refuses_and_stays_as_it_was(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), locked=True, canonical_name="hello")
            before = path.read_text(encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "locked"):
                self._run(path)
            self.assertEqual(before, path.read_text(encoding="utf-8"))

    def test_an_engine_with_nothing_for_the_name_leaves_the_file_unchanged_and_says_why(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), canonical_name="Zzyzxqq")
            before = path.read_text(encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "CMU dictionary has no entry"):
                self._run(path)
            self.assertEqual(before, path.read_text(encoding="utf-8"))

    def test_the_command_line_runs_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), canonical_name="hello")
            argv = ["manuscript_guide.py", "pronounce", "--guide", str(path), "--entity-id", "entity-1", "--source", "cmu"]
            with patch("sys.argv", argv), patch("sys.stdout"):
                guide.main()
            self.assertTrue(_entity(path)["pronunciation"]["chosen"])


class ChosenPronunciationSurvivesRebuildTests(unittest.TestCase):
    def _generated(self, name: str = "Wren") -> dict:
        return {
            "id": guide.entity_id(name),
            "canonical_name": name,
            "aliases": [],
            "category": "Character",
            "occurrences": [],
            "occurrence_count": 0,
            "pronunciation": {"ipa": "fresh", "source": "CMU dictionary", "confidence": "medium"},
            "description": {"text": "", "evidence": {}},
            "personality_notes": [],
            "context": "",
            "relationships": [],
            "properties": [],
            "locked": False,
            "manual": False,
            "review_state": "generated",
        }

    def test_a_chosen_pronunciation_is_kept_over_a_freshly_generated_one(self):
        prior = {**self._generated(), "pronunciation": {"ipa": "chosen one", "source": "eSpeak NG", "confidence": "low", "chosen": True}}
        merged = guide.merge_locked([self._generated()], {"entities": [prior]})
        self.assertEqual(prior["pronunciation"], merged[0]["pronunciation"])

    def test_an_unchosen_pronunciation_is_replaced_by_the_fresh_one_as_before(self):
        prior = {**self._generated(), "pronunciation": {"ipa": "stale", "source": "CMU dictionary", "confidence": "medium"}}
        fresh = self._generated()
        merged = guide.merge_locked([fresh], {"entities": [prior]})
        self.assertEqual(fresh["pronunciation"], merged[0]["pronunciation"])


if __name__ == "__main__":
    unittest.main()
