"""Character Continuity Review, Phase 2 (docs/prds/character-continuity-review.prd.md):

- stable entity ids across a rebuild, even when the canonical spelling choice shifts (CC-2)
- alias split (the inverse of the existing `merge`)
- chapter and scene appearance maps
- rules-based dialogue cue extraction with an `unknown` speaker and evidence
- narrator corrections to a cue's speaker that a rebuild never overwrites (mirrors ADR 0007's lock guard)

Precision over recall applies throughout (ADR 0020): an ambiguous cue is `unknown`, never a guess.
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


def _paragraphs(*rows: tuple[str, str, str]) -> list[dict[str, str]]:
    """Each row is (chapterId, paragraphId, text); chapter title mirrors chapterId for readability."""
    return [
        {"chapter": chapter_id, "chapterId": chapter_id, "paragraph": str(i), "paragraphId": paragraph_id, "text": text}
        for i, (chapter_id, paragraph_id, text) in enumerate(rows)
    ]


class StableIdReconciliationTests(unittest.TestCase):
    """CC-2: 'Whether an unlocked, generated character keeps its id across a rebuild' - the PRD's own open TBD."""

    def test_an_unlocked_entity_keeps_its_id_when_a_title_prefixed_mention_first_appears(self):
        # Build 1: only the short form is in the text, so the id is hashed from "Arelian". The mentions are
        # mid-sentence (not sentence-initial) so the rules-only extractor accepts the single-word name at all.
        build1 = _paragraphs(("c1", "p1", "Ada saw Arelian arrive. Then Arelian sat down, and Arelian said nothing."))
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities1 = guide.build_entities(build1, "unused", None)
        (arelian,) = [e for e in entities1 if e["canonical_name"] == "Arelian"]
        old_id = arelian["id"]
        previous_guide = {"entities": entities1}

        # Build 2: a new chapter's title-prefixed mention joins the group, so the canonical name (and a
        # freshly-hashed id) would otherwise become "Captain Arelian" - orphaning any review the narrator did.
        build2 = [*build1, *_paragraphs(("c2", "p2", "Captain Arelian gave the order."))]
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities2 = guide.build_entities(build2, "unused", None)
        merged = guide.merge_locked(entities2, previous_guide)
        (reconciled,) = [e for e in merged if "Arelian" in e["canonical_name"]]
        self.assertEqual("Captain Arelian", reconciled["canonical_name"])
        self.assertEqual(old_id, reconciled["id"], "the id must survive even though the canonical spelling changed")

    def test_reviewed_fields_survive_the_canonical_name_shift_too(self):
        build1 = _paragraphs(("c1", "p1", "Ada saw Arelian arrive. Then Arelian sat down, and Arelian said nothing."))
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities1 = guide.build_entities(build1, "unused", None)
        previous = {"entities": entities1}
        previous["entities"][0]["context"] = "A veteran navigator."
        previous["entities"][0]["review_state"] = "reviewed"

        build2 = [*build1, *_paragraphs(("c2", "p4", "Captain Arelian gave the order."))]
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities2 = guide.build_entities(build2, "unused", None)
        merged = guide.merge_locked(entities2, previous)
        (reconciled,) = [e for e in merged if "Arelian" in e["canonical_name"]]
        self.assertEqual("A veteran navigator.", reconciled["context"])

    def test_two_previously_distinct_entities_are_never_silently_collapsed(self):
        # A guard against the reconciliation itself becoming a false merge: two previous entities
        # that happen to share no real name overlap must never be folded into one just because a
        # rebuild's id-hashing coincidentally lines up with the wrong entry.
        previous = {
            "entities": [
                {
                    "id": "entity-aaa",
                    "canonical_name": "Ada",
                    "aliases": [],
                    "category": "Character",
                    "occurrences": [],
                    "occurrence_count": 1,
                    "locked": False,
                    "manual": False,
                },
                {
                    "id": "entity-bbb",
                    "canonical_name": "Zeph",
                    "aliases": [],
                    "category": "Character",
                    "occurrences": [],
                    "occurrence_count": 1,
                    "locked": False,
                    "manual": False,
                },
            ]
        }
        build2 = _paragraphs(
            ("c1", "p1", "They saw Ada arrive. Then Ada waved, and Ada smiled."), ("c1", "p2", "They saw Zeph arrive. Then Zeph waved, and Zeph smiled.")
        )
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities2 = guide.build_entities(build2, "unused", None)
        merged = guide.merge_locked(entities2, previous)
        ids = {e["canonical_name"]: e["id"] for e in merged}
        self.assertEqual("entity-aaa", ids["Ada"])
        self.assertEqual("entity-bbb", ids["Zeph"])


class AliasSplitTests(unittest.TestCase):
    """The inverse of `merge`: an alias that was wrongly folded in gets its own identity back."""

    def test_split_creates_a_standalone_entity_from_an_alias(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = Path(temporary) / "guide.json"
            guide.write_json(
                str(guide_file),
                {
                    "entities": [
                        {
                            "id": "entity-parent",
                            "canonical_name": "Captain Arelian",
                            "aliases": [
                                {
                                    "text": "Robert",
                                    "pronunciation": {},
                                    "occurrences": [{"chapter": "C1", "chapterId": "c1", "paragraph": 0, "paragraphId": "p1", "excerpt": "Robert spoke."}],
                                }
                            ],
                            "category": "Character",
                            "occurrences": [],
                            "occurrence_count": 1,
                            "locked": False,
                            "manual": False,
                        }
                    ],
                    "absorbed_names": {"robert": "entity-parent"},
                },
            )
            guide.split(argparse.Namespace(guide=str(guide_file), entity_id="entity-parent", alias_text="Robert"))
            data = json.loads(guide_file.read_text(encoding="utf-8"))
            by_name = {e["canonical_name"]: e for e in data["entities"]}
            self.assertEqual([], by_name["Captain Arelian"]["aliases"])
            self.assertIn("Robert", by_name)
            self.assertEqual(1, len(by_name["Robert"]["occurrences"]))
            # The absorbed-names redirect must be cleared, or the very next rebuild would fold Robert straight back in.
            self.assertNotIn("robert", data["absorbed_names"])

    def test_split_refuses_an_alias_that_does_not_exist(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = Path(temporary) / "guide.json"
            guide.write_json(
                str(guide_file),
                {
                    "entities": [
                        {
                            "id": "entity-parent",
                            "canonical_name": "Captain Arelian",
                            "aliases": [],
                            "category": "Character",
                            "occurrences": [],
                            "occurrence_count": 0,
                            "locked": False,
                        }
                    ]
                },
            )
            with self.assertRaises(ValueError):
                guide.split(argparse.Namespace(guide=str(guide_file), entity_id="entity-parent", alias_text="Nobody"))

    def test_split_refuses_a_locked_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = Path(temporary) / "guide.json"
            guide.write_json(
                str(guide_file),
                {
                    "entities": [
                        {
                            "id": "entity-parent",
                            "canonical_name": "Captain Arelian",
                            "aliases": [{"text": "Robert", "pronunciation": {}, "occurrences": []}],
                            "category": "Character",
                            "occurrences": [],
                            "occurrence_count": 0,
                            "locked": True,
                        }
                    ]
                },
            )
            with self.assertRaises(ValueError):
                guide.split(argparse.Namespace(guide=str(guide_file), entity_id="entity-parent", alias_text="Robert"))

    def test_a_split_entity_does_not_come_back_on_the_next_rebuild(self):
        # End-to-end: an absorbed-names entry (as `merge` would have left behind) is cleared by split,
        # so merge_locked's redirect step - which only fires when a name is listed there - leaves the
        # freshly generated "Robert" entity standing alone instead of folding it back into the parent.
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = Path(temporary) / "guide.json"
            parent_id = guide.entity_id("Captain Arelian")
            previous = {
                "entities": [
                    {
                        "id": parent_id,
                        "canonical_name": "Captain Arelian",
                        "aliases": [{"text": "Robert", "pronunciation": {}, "occurrences": []}],
                        "category": "Character",
                        "occurrences": [],
                        "occurrence_count": 0,
                        "locked": False,
                        "manual": False,
                    }
                ],
                "absorbed_names": {"robert": parent_id},
            }
            guide.write_json(str(guide_file), previous)
            guide.split(argparse.Namespace(guide=str(guide_file), entity_id=parent_id, alias_text="Robert"))

            rebuild_paragraphs = _paragraphs(("c1", "p0", "They heard Robert speak. Then Robert paused, and Robert spoke again."))
            with patch.object(guide, "spacy_candidates", return_value=None):
                generated = guide.build_entities(rebuild_paragraphs, "unused", None)
            saved = json.loads(guide_file.read_text(encoding="utf-8"))
            merged = guide.merge_locked(generated, saved)
            names = {e["canonical_name"] for e in merged}
            self.assertIn("Robert", names)
            robert = next(e for e in merged if e["canonical_name"] == "Robert")
            self.assertEqual([], robert.get("aliases", []))


class SceneAppearanceTests(unittest.TestCase):
    def test_a_scene_break_paragraph_starts_a_new_scene_and_is_itself_unassigned(self):
        paragraphs = _paragraphs(("c1", "p1", "Ada arrived."), ("c1", "p2", "* * *"), ("c1", "p3", "Ada left."))
        scenes = guide.assign_scene_indices(paragraphs)
        self.assertEqual([0, None, 1], scenes)

    def test_entities_record_which_chapter_and_scene_they_appear_in(self):
        paragraphs = _paragraphs(
            ("c1", "p1", "Ada Voss arrived. Ada Voss looked around."),
            ("c1", "p2", "***"),
            ("c1", "p3", "Ada Voss left. Ada Voss was gone."),
            ("c2", "p4", "Ada Voss returned. Ada Voss smiled."),
        )
        with patch.object(guide, "spacy_candidates", return_value=None):
            entities = guide.build_entities(paragraphs, "unused", None)
        (ada,) = [e for e in entities if e["canonical_name"] == "Ada Voss"]
        self.assertEqual(
            [
                {"chapterId": "c1", "chapter": "c1", "sceneIndex": 0},
                {"chapterId": "c1", "chapter": "c1", "sceneIndex": 1},
                {"chapterId": "c2", "chapter": "c2", "sceneIndex": 0},
            ],
            ada["appearances"],
        )


class DialogueCueTests(unittest.TestCase):
    """Q4, option A: quote spans, adjacent 'said Name'/alias patterns, per-scene continuation, `unknown` on ambiguity."""

    def _character_index(self, *names: str) -> dict[str, str]:
        return {guide.normalize_name(name): guide.entity_id(name) for name in names}

    def test_a_tag_after_the_quote_attributes_the_cue(self):
        text = '"I will not go," Ada said.'
        cues = guide.extract_cues_from_text(text, self._character_index("Ada"))
        self.assertEqual(1, len(cues))
        self.assertEqual(guide.entity_id("Ada"), cues[0]["speaker_entity_id"])
        self.assertEqual("tag", cues[0]["speaker_source"])
        self.assertEqual("I will not go,", cues[0]["quote_text"])

    def test_a_tag_before_the_quote_attributes_the_cue(self):
        text = 'Ada said, "I will not go."'
        cues = guide.extract_cues_from_text(text, self._character_index("Ada"))
        self.assertEqual(1, len(cues))
        self.assertEqual(guide.entity_id("Ada"), cues[0]["speaker_entity_id"])

    def test_an_alias_in_the_tag_resolves_to_the_same_entity(self):
        index = {
            guide.normalize_name("Captain Arelian"): guide.entity_id("Captain Arelian"),
            guide.normalize_name("Arelian"): guide.entity_id("Captain Arelian"),
        }
        text = '"Hold the line," Arelian shouted.'
        cues = guide.extract_cues_from_text(text, index)
        self.assertEqual(guide.entity_id("Captain Arelian"), cues[0]["speaker_entity_id"])

    def test_a_quote_with_no_tag_is_unknown(self):
        text = '"Where did everyone go?"'
        cues = guide.extract_cues_from_text(text, self._character_index("Ada"))
        self.assertEqual(1, len(cues))
        self.assertIsNone(cues[0]["speaker_entity_id"])
        self.assertEqual("unknown", cues[0]["speaker_source"])

    def test_a_tag_naming_someone_not_in_the_character_index_is_unknown(self):
        # Precision over recall (ADR 0020): a name that never became a real entity is not guessed at.
        text = '"Wait," Someone said.'
        cues = guide.extract_cues_from_text(text, self._character_index("Ada"))
        self.assertIsNone(cues[0]["speaker_entity_id"])

    def test_every_cue_carries_evidence(self):
        text = '"I will not go," Ada said.'
        cues = guide.extract_cues_from_text(text, self._character_index("Ada"))
        self.assertTrue(cues[0]["evidence"])

    def test_overlapping_speakers_in_one_paragraph_are_each_attributed_by_their_own_tag(self):
        text = '"I will not go," Ada said. "Nor will I," Ben replied.'
        cues = guide.extract_cues_from_text(text, self._character_index("Ada", "Ben"))
        self.assertEqual(2, len(cues))
        self.assertEqual(guide.entity_id("Ada"), cues[0]["speaker_entity_id"])
        self.assertEqual(guide.entity_id("Ben"), cues[1]["speaker_entity_id"])

    def test_two_person_scene_continuation_alternates_an_untagged_quote(self):
        paragraphs = _paragraphs(
            ("c1", "p1", '"I will not go," Ada said.'),
            ("c1", "p2", '"Then stay," Ben replied.'),
            ("c1", "p3", '"Fine."'),
        )
        index = self._character_index("Ada", "Ben")
        cues = guide.extract_dialogue_cues(paragraphs, index)
        self.assertEqual(3, len(cues))
        self.assertEqual(guide.entity_id("Ada"), cues[0]["speaker_entity_id"])
        self.assertEqual(guide.entity_id("Ben"), cues[1]["speaker_entity_id"])
        self.assertEqual(guide.entity_id("Ada"), cues[2]["speaker_entity_id"])
        self.assertEqual("continuation", cues[2]["speaker_source"])

    def test_continuation_does_not_apply_across_a_scene_break(self):
        paragraphs = _paragraphs(
            ("c1", "p1", '"I will not go," Ada said.'),
            ("c1", "p2", '"Then stay," Ben replied.'),
            ("c1", "p3", "***"),
            ("c1", "p4", '"Fine."'),
        )
        index = self._character_index("Ada", "Ben")
        cues = guide.extract_dialogue_cues(paragraphs, index)
        last = cues[-1]
        self.assertIsNone(last["speaker_entity_id"])
        self.assertEqual("unknown", last["speaker_source"])

    def test_continuation_does_not_apply_with_three_or_more_active_speakers(self):
        paragraphs = _paragraphs(
            ("c1", "p1", '"One," Ada said.'),
            ("c1", "p2", '"Two," Ben replied.'),
            ("c1", "p3", '"Three," Cora added.'),
            ("c1", "p4", '"Four."'),
        )
        index = self._character_index("Ada", "Ben", "Cora")
        cues = guide.extract_dialogue_cues(paragraphs, index)
        self.assertIsNone(cues[-1]["speaker_entity_id"])

    def test_cue_ids_are_stable_across_a_rebuild_of_unchanged_text(self):
        paragraphs = _paragraphs(("c1", "p1", '"I will not go," Ada said.'))
        index = self._character_index("Ada")
        first = guide.extract_dialogue_cues(paragraphs, index)
        second = guide.extract_dialogue_cues(paragraphs, index)
        self.assertEqual(first[0]["id"], second[0]["id"])

    def test_two_identical_quotes_in_one_paragraph_get_different_ids(self):
        text = '"No," Ada said. "No," Ben said.'
        cues = guide.extract_cues_from_text(text, self._character_index("Ada", "Ben"))
        self.assertNotEqual(cues[0]["id"], cues[1]["id"])


class MissingAndAmbiguousCueFixtureTests(unittest.TestCase):
    """Named fixtures for the PRD's three required scenarios: ambiguous cues, overlapping speakers, missing cues."""

    def _character_index(self, *names: str) -> dict[str, str]:
        return {guide.normalize_name(name): guide.entity_id(name) for name in names}

    def test_ambiguous_cue_without_any_recognizable_tag_stays_unknown(self):
        text = '"Perhaps," came the reply from across the room.'
        cues = guide.extract_cues_from_text(text, self._character_index("Ada"))
        self.assertEqual("unknown", cues[0]["speaker_source"])

    def test_overlapping_speakers_each_keep_their_own_attribution_in_one_scene(self):
        paragraphs = _paragraphs(("c1", "p1", '"Yours?" Ada asked. "No, yours," Ben answered. "Neither," Ada said.'))
        cues = guide.extract_dialogue_cues(paragraphs, self._character_index("Ada", "Ben"))
        self.assertEqual([guide.entity_id("Ada"), guide.entity_id("Ben"), guide.entity_id("Ada")], [c["speaker_entity_id"] for c in cues])

    def test_missing_cue_no_quotes_at_all_produces_no_cues(self):
        paragraphs = _paragraphs(("c1", "p1", "Ada walked across the room and said nothing."))
        cues = guide.extract_dialogue_cues(paragraphs, self._character_index("Ada"))
        self.assertEqual([], cues)


class CorrectionSurvivesRebuildTests(unittest.TestCase):
    """Corrections mirror the locked-entity guard (ADR 0007): a rebuild must never overwrite one."""

    def test_correct_cue_marks_it_corrected(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = Path(temporary) / "guide.json"
            guide.write_json(
                str(guide_file),
                {
                    "entities": [],
                    "dialogue_cues": [
                        {
                            "id": "cue-1",
                            "speaker_entity_id": None,
                            "speaker_source": "unknown",
                            "chapterId": "c1",
                            "paragraphId": "p1",
                            "quote_text": "Hi.",
                            "evidence": {},
                        }
                    ],
                },
            )
            guide.correct_cue(argparse.Namespace(guide=str(guide_file), cue_id="cue-1", speaker_entity_id="entity-ada"))
            data = json.loads(guide_file.read_text(encoding="utf-8"))
            (cue,) = data["dialogue_cues"]
            self.assertEqual("entity-ada", cue["speaker_entity_id"])
            self.assertTrue(cue["corrected"])
            self.assertEqual("correction", cue["speaker_source"])

    def test_correct_cue_to_unknown_is_also_a_correction(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = Path(temporary) / "guide.json"
            guide.write_json(
                str(guide_file),
                {
                    "entities": [],
                    "dialogue_cues": [
                        {
                            "id": "cue-1",
                            "speaker_entity_id": "entity-ada",
                            "speaker_source": "tag",
                            "chapterId": "c1",
                            "paragraphId": "p1",
                            "quote_text": "Hi.",
                            "evidence": {},
                        }
                    ],
                },
            )
            guide.correct_cue(argparse.Namespace(guide=str(guide_file), cue_id="cue-1", speaker_entity_id="unknown"))
            data = json.loads(guide_file.read_text(encoding="utf-8"))
            (cue,) = data["dialogue_cues"]
            self.assertIsNone(cue["speaker_entity_id"])
            self.assertTrue(cue["corrected"])

    def test_correct_cue_refuses_an_unknown_cue_id(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = Path(temporary) / "guide.json"
            guide.write_json(str(guide_file), {"entities": [], "dialogue_cues": []})
            with self.assertRaises(ValueError):
                guide.correct_cue(argparse.Namespace(guide=str(guide_file), cue_id="cue-missing", speaker_entity_id="entity-ada"))

    def test_a_rebuild_keeps_a_corrected_cue_even_though_fresh_extraction_disagrees(self):
        paragraphs = _paragraphs(("c1", "p1", '"Wait," Someone said.'))
        index = self._character_index = {guide.normalize_name("Ada"): guide.entity_id("Ada")}
        fresh = guide.extract_dialogue_cues(paragraphs, index)
        self.assertIsNone(fresh[0]["speaker_entity_id"])  # "Someone" is not a known character: fresh extraction says unknown
        previous_cues = [{**fresh[0], "speaker_entity_id": guide.entity_id("Ada"), "speaker_source": "correction", "corrected": True}]
        merged = guide.merge_dialogue_cues(fresh, previous_cues)
        self.assertEqual(guide.entity_id("Ada"), merged[0]["speaker_entity_id"])
        self.assertTrue(merged[0]["corrected"])

    def test_a_rebuild_does_not_carry_a_correction_onto_a_different_paragraph_or_quote(self):
        # The correction key is (paragraphId, quote text, start): if the paragraph's own text changes, the
        # old cue simply disappears rather than dragging a stale correction onto unrelated new content.
        paragraphs = _paragraphs(("c1", "p1", '"Totally different line," Someone said.'))
        index = {guide.normalize_name("Ada"): guide.entity_id("Ada")}
        fresh = guide.extract_dialogue_cues(paragraphs, index)
        previous_cues = [
            {
                "id": "cue-stale",
                "chapterId": "c1",
                "paragraphId": "p1",
                "quote_text": "A quote that no longer exists.",
                "speaker_entity_id": guide.entity_id("Ada"),
                "speaker_source": "correction",
                "corrected": True,
                "evidence": {},
            }
        ]
        merged = guide.merge_dialogue_cues(fresh, previous_cues)
        self.assertEqual(fresh[0]["speaker_entity_id"], merged[0]["speaker_entity_id"])  # unaffected by the unrelated stale correction


if __name__ == "__main__":
    unittest.main()
