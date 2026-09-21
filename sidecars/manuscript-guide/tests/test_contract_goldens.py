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
