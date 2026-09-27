"""The Story Bible entities as the sidecar really builds them, pinned as a contract file (ADR 0069).

The entities come from ``manuscript_guide.build_entities`` (the rules-only path, so no language model is needed) over a few
paragraphs, plus one manual entity as the Story Bible page creates it. The Go host reads them back through ``guide.Service`` and pins
what it sends to the UI, and the TypeScript contract tests validate both files against the UI's schemas.
"""

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

from narration_common import contract_files

MODULE_PATH = Path(__file__).parents[1] / "core" / "manuscript_guide.py"
SPEC = importlib.util.spec_from_file_location("manuscript_guide", MODULE_PATH)
guide = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guide)

PARAGRAPHS = [
    {"chapter": "Chapter 1", "text": text}
    for text in (
        "Captain Arelian said the Council of Ash would meet in Dawnspire.",
        "Arelian was a veteran navigator, brave and wary before the council arrived.",
        "Later they saw Dawnspire burning. The road to Dawnspire was long.",
        "Everyone knew Dawnspire well.",
    )
]


class ContractGoldenTests(unittest.TestCase):
    def test_the_built_entities_match_the_committed_contract_file(self):
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities = guide.build_entities(PARAGRAPHS, "unused", None)

        self.assertEqual({"Captain Arelian", "Council of Ash", "Dawnspire"}, {entity["canonical_name"] for entity in entities})
        contract_files.check("guide-entities-sidecar", entities)


class PronunciationDepthContractGoldenTests(unittest.TestCase):
    """The narrator's own pronunciation, its alternate, a status and a note, as the sidecar writes them (prep-depth P1)."""

    def test_an_entity_with_the_narrators_pronunciation_work_matches_the_committed_contract_file(self):
        import argparse
        import json
        import tempfile

        entity = {
            "id": "entity-wren",
            "canonical_name": "Wren",
            "category": "Character",
            "aliases": [{"text": "the Sparrow", "pronunciation": {"ipa": "ðə ˈspæɹoʊ", "source": "CMU dictionary", "confidence": "medium"}, "occurrences": []}],
            "occurrences": [],
            "occurrence_count": 0,
            "pronunciation": {"ipa": "ɹɛn", "source": "CMU dictionary", "confidence": "medium"},
            "description": {"text": "", "evidence": {}},
            "personality_notes": [],
            "relationships": [],
            "properties": [],
            "locked": False,
            "review_state": "reviewed",
        }
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "manuscript_guide.json")
            guide.write_json(path, {"schema_version": 2, "entities": [entity]})
            target = {"guide": path, "entity_id": "entity-wren"}
            guide.pronounce_user(argparse.Namespace(**target, alias_index=None, ipa="wɹɛn"))
            guide.pronunciation_status(argparse.Namespace(**target, alias_index=None, status="query_sent", note="Asked the author by email."))
            guide.pronunciation_status(argparse.Namespace(**target, alias_index=0, status="author_confirmed", note=None))
            with open(path, encoding="utf-8") as handle:
                entities = json.load(handle)["entities"]
        contract_files.check("guide-entities-pronunciation-sidecar", entities)
