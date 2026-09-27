"""Pronunciation status and the narrator's own pronunciation (prep-depth PRD, phase 1).

A pronunciation carries a ``status`` (``researched``, ``query_sent``, ``author_confirmed``; absent reads as ``researched``) and an
optional ``note``. The narrator can type their own pronunciation (source ``user``); it never asks CMU or eSpeak, and it sits beside
the dictionary's answer instead of replacing it: the one not in use is kept as ``alternate``, so switching back is lossless and
never re-runs a lookup (Q2). A rebuild keeps the status, the note and the alternate.
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

DICTIONARY = {"ipa": "wɹɛn", "source": "CMU dictionary", "confidence": "medium", "chosen": True}


def _guide_file(root: Path, **fields) -> Path:
    path = root / "ManuscriptGuide" / "manuscript_guide.json"
    entity = {
        "id": "entity-1",
        "canonical_name": "Wren",
        "category": "Character",
        "pronunciation": dict(DICTIONARY),
        "aliases": [{"text": "the Sparrow", "pronunciation": {}, "occurrences": []}],
        **fields,
    }
    guide.write_json(str(path), {"entities": [entity]})
    return path


def _entity(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["entities"][0]


def _user(path: Path, ipa: str, alias_index=None) -> None:
    guide.pronounce_user(argparse.Namespace(guide=str(path), entity_id="entity-1", alias_index=alias_index, ipa=ipa))


def _swap(path: Path, alias_index=None) -> None:
    guide.pronunciation_use_alternate(argparse.Namespace(guide=str(path), entity_id="entity-1", alias_index=alias_index))


def _status(path: Path, status: str, note=None, alias_index=None) -> None:
    guide.pronunciation_status(argparse.Namespace(guide=str(path), entity_id="entity-1", alias_index=alias_index, status=status, note=note))


class UserPronunciationTests(unittest.TestCase):
    def test_the_narrators_own_pronunciation_never_asks_a_dictionary(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            with (
                patch.object(guide, "pronounce_source", side_effect=AssertionError("a dictionary was asked")),
                patch.object(guide, "pronunciation", side_effect=AssertionError("a dictionary was asked")),
            ):
                _user(path, "  ˈwɹɛːn  ")
            value = _entity(path)["pronunciation"]
            self.assertEqual(
                {"ipa": "ˈwɹɛːn", "source": "user", "confidence": "narrator", "chosen": True}, {k: value[k] for k in ("ipa", "source", "confidence", "chosen")}
            )

    def test_the_dictionary_answer_is_kept_beside_it_as_the_alternate(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _user(path, "ˈwɹɛːn")
            self.assertEqual({"ipa": "wɹɛn", "source": "CMU dictionary", "confidence": "medium"}, _entity(path)["pronunciation"]["alternate"])

    def test_switching_back_to_the_dictionary_is_lossless_and_keeps_the_narrators_one(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _user(path, "ˈwɹɛːn")
            with patch.object(guide, "pronounce_source", side_effect=AssertionError("a dictionary was asked")):
                _swap(path)
            value = _entity(path)["pronunciation"]
            self.assertEqual(("wɹɛn", "CMU dictionary", "medium"), (value["ipa"], value["source"], value["confidence"]))
            self.assertTrue(value["chosen"])
            self.assertEqual({"ipa": "ˈwɹɛːn", "source": "user", "confidence": "narrator"}, value["alternate"])
            _swap(path)
            self.assertEqual("ˈwɹɛːn", _entity(path)["pronunciation"]["ipa"])
            self.assertEqual("wɹɛn", _entity(path)["pronunciation"]["alternate"]["ipa"])

    def test_replacing_the_narrators_one_keeps_the_dictionary_alternate(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _user(path, "one")
            _user(path, "two")
            value = _entity(path)["pronunciation"]
            self.assertEqual("two", value["ipa"])
            self.assertEqual("wɹɛn", value["alternate"]["ipa"])

    def test_a_dictionary_replace_keeps_the_narrators_one_as_the_alternate(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), canonical_name="hello")
            _user(path, "mine")
            guide.pronounce(argparse.Namespace(guide=str(path), entity_id="entity-1", alias_index=None, source="cmu", espeak_library=""))
            value = _entity(path)["pronunciation"]
            self.assertEqual("CMU dictionary", value["source"])
            self.assertEqual({"ipa": "mine", "source": "user", "confidence": "narrator"}, value["alternate"])

    def test_an_empty_pronunciation_leaves_no_alternate(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), pronunciation={})
            _user(path, "mine")
            self.assertNotIn("alternate", _entity(path)["pronunciation"])

    def test_it_applies_to_an_alias_by_index(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _user(path, "ðə ˈspæɹoʊ", alias_index=0)
            entity = _entity(path)
            self.assertEqual("user", entity["aliases"][0]["pronunciation"]["source"])
            self.assertEqual(DICTIONARY, entity["pronunciation"])

    def test_blank_multi_line_or_overlong_text_is_refused_and_the_file_is_unchanged(self):
        for bad in ("   ", "one\ntwo", "x" * (guide.MAX_USER_PRONUNCIATION + 1)):
            with self.subTest(bad=bad[:8]), tempfile.TemporaryDirectory() as temporary:
                path = _guide_file(Path(temporary))
                before = path.read_text(encoding="utf-8")
                with self.assertRaises(ValueError):
                    _user(path, bad)
                self.assertEqual(before, path.read_text(encoding="utf-8"))

    def test_a_locked_entity_refuses(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary), locked=True)
            with self.assertRaisesRegex(ValueError, "locked"):
                _user(path, "mine")
            with self.assertRaisesRegex(ValueError, "locked"):
                _status(path, "query_sent")

    def test_there_is_nothing_to_switch_to_without_an_alternate(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            with self.assertRaisesRegex(ValueError, "no other pronunciation"):
                _swap(path)

    def test_the_command_line_takes_a_value_that_starts_with_a_dash(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            argv = ["manuscript_guide.py", "pronounce-user", "--guide", str(path), "--entity-id", "entity-1", "--ipa=-wɹɛn"]
            with patch("sys.argv", argv), patch("sys.stdout"):
                guide.main()
            self.assertEqual("-wɹɛn", _entity(path)["pronunciation"]["ipa"])

    def test_user_is_not_a_dictionary_the_pronounce_command_offers(self):
        self.assertNotIn(guide.USER_SOURCE, guide.PRONUNCIATION_SOURCES)


class PronunciationStatusTests(unittest.TestCase):
    def test_sets_the_status_and_note(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _status(path, "query_sent", "Asked in the 3 May email.")
            value = _entity(path)["pronunciation"]
            self.assertEqual(("query_sent", "Asked in the 3 May email."), (value["status"], value["note"]))
            self.assertEqual("wɹɛn", value["ipa"])

    def test_no_note_leaves_the_note_alone_and_an_empty_one_clears_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _status(path, "query_sent", "kept")
            _status(path, "author_confirmed")
            self.assertEqual("kept", _entity(path)["pronunciation"]["note"])
            _status(path, "author_confirmed", "  ")
            self.assertNotIn("note", _entity(path)["pronunciation"])

    def test_an_unknown_status_or_overlong_note_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            with self.assertRaisesRegex(ValueError, "status"):
                _status(path, "guessed")
            with self.assertRaisesRegex(ValueError, "note"):
                _status(path, "researched", "x" * (guide.MAX_PRONUNCIATION_NOTE + 1))

    def test_it_applies_to_an_alias(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _status(path, "author_confirmed", alias_index=0)
            entity = _entity(path)
            self.assertEqual("author_confirmed", entity["aliases"][0]["pronunciation"]["status"])
            self.assertNotIn("status", entity["pronunciation"])

    def test_changing_the_pronunciation_in_use_withdraws_an_author_confirmation(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _status(path, "author_confirmed", "Confirmed by phone.")
            _user(path, "ˈwɹɛːn")
            value = _entity(path)["pronunciation"]
            self.assertEqual("researched", value["status"])
            self.assertEqual("Confirmed by phone.", value["note"])

    def test_a_query_sent_status_survives_a_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = _guide_file(Path(temporary))
            _status(path, "query_sent")
            _user(path, "ˈwɹɛːn")
            _swap(path)
            self.assertEqual("query_sent", _entity(path)["pronunciation"]["status"])

    def test_the_status_of_an_entry_written_before_it_existed_reads_as_researched(self):
        self.assertEqual("researched", guide.pronunciation_status_of({"ipa": "x"}))
        self.assertEqual("researched", guide.pronunciation_status_of({}))
        self.assertEqual("researched", guide.pronunciation_status_of({"status": "nonsense"}))
        self.assertEqual("query_sent", guide.pronunciation_status_of({"status": "query_sent"}))


class RebuildKeepsTheNarratorsPronunciationWorkTests(unittest.TestCase):
    def _generated(self, aliases=None) -> dict:
        return {
            "id": guide.entity_id("Wren"),
            "canonical_name": "Wren",
            "aliases": aliases or [],
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

    def test_an_unchosen_pronunciations_status_and_note_survive_a_rebuild(self):
        prior = {
            **self._generated(),
            "pronunciation": {"ipa": "fresh", "source": "CMU dictionary", "confidence": "medium", "status": "query_sent", "note": "Asked."},
        }
        merged = guide.merge_locked([self._generated()], {"entities": [prior]})
        self.assertEqual(("query_sent", "Asked."), (merged[0]["pronunciation"]["status"], merged[0]["pronunciation"]["note"]))

    def test_an_author_confirmation_is_withdrawn_when_the_rebuild_changes_the_pronunciation(self):
        prior = {**self._generated(), "pronunciation": {"ipa": "stale", "source": "CMU dictionary", "confidence": "medium", "status": "author_confirmed"}}
        merged = guide.merge_locked([self._generated()], {"entities": [prior]})
        self.assertEqual("fresh", merged[0]["pronunciation"]["ipa"])
        self.assertEqual("researched", merged[0]["pronunciation"]["status"])

    def test_a_user_pronunciation_and_its_alternate_survive_a_rebuild(self):
        user = {
            "ipa": "mine",
            "source": "user",
            "confidence": "narrator",
            "chosen": True,
            "alternate": {"ipa": "old", "source": "CMU dictionary", "confidence": "medium"},
        }
        prior = {**self._generated(), "pronunciation": user}
        merged = guide.merge_locked([self._generated()], {"entities": [prior]})
        self.assertEqual(user, merged[0]["pronunciation"])

    def test_a_chosen_alias_pronunciation_survives_and_an_unchosen_ones_status_is_carried(self):
        fresh_aliases = [
            {"text": "the Sparrow", "pronunciation": {"ipa": "fresh", "source": "CMU dictionary", "confidence": "medium"}, "occurrences": []},
            {"text": "Wrennie", "pronunciation": {"ipa": "fresh2", "source": "CMU dictionary", "confidence": "medium"}, "occurrences": []},
        ]
        prior_aliases = [
            {"text": "The Sparrow", "pronunciation": {"ipa": "mine", "source": "user", "confidence": "narrator", "chosen": True}, "occurrences": []},
            {
                "text": "Wrennie",
                "pronunciation": {"ipa": "fresh2", "source": "CMU dictionary", "confidence": "medium", "status": "author_confirmed"},
                "occurrences": [],
            },
        ]
        merged = guide.merge_locked([self._generated(fresh_aliases)], {"entities": [{**self._generated(), "aliases": prior_aliases}]})
        aliases = {alias["text"]: alias for alias in merged[0]["aliases"]}
        self.assertEqual(prior_aliases[0]["pronunciation"], aliases["the Sparrow"]["pronunciation"])
        self.assertEqual("author_confirmed", aliases["Wrennie"]["pronunciation"]["status"])

    def test_an_entry_with_no_status_rebuilds_exactly_as_before(self):
        prior = self._generated()
        prior["pronunciation"] = {"ipa": "stale", "source": "CMU dictionary", "confidence": "medium"}
        fresh = self._generated()
        merged = guide.merge_locked([fresh], {"entities": [prior]})
        self.assertEqual({"ipa": "fresh", "source": "CMU dictionary", "confidence": "medium"}, merged[0]["pronunciation"])


if __name__ == "__main__":
    unittest.main()
