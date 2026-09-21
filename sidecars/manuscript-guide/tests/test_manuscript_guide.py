import argparse
import importlib.util
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

MODULE_PATH = Path(__file__).parents[1] / "core" / "manuscript_guide.py"
SPEC = importlib.util.spec_from_file_location("manuscript_guide", MODULE_PATH)
guide = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guide)


def _write_manuscript(root: Path, chapter_title: str, paragraph_texts: list[str]) -> Path:
    """Writes a minimal canonical manuscript.json directly at the path
    manuscript_guide.py reads via canonical_manuscript.load_file.

    Import (turning a .docx/.md source into this file) is Go-host-only now -
    see apps/desktop/cmd/manuscript-import and apps/desktop/internal/manuscript.
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

    def test_the_rules_only_choice_builds_without_spacy_and_says_it_was_chosen(self):
        paragraphs = [{"chapter": "Chapter 1", "text": "Captain Arelian arrives."}]
        messages: list[str] = []
        # spaCy cannot even be imported: the choice must not try, and must not report a model that "could not be loaded".
        with patch.dict(sys.modules, {"spacy": None}), patch.object(guide, "log", side_effect=messages.append):
            self.assertIsNone(guide.spacy_candidates(paragraphs, guide.RULES_ONLY))
        self.assertEqual(1, len(messages))
        self.assertIn("rules-only", messages[0])
        self.assertIn("chosen", messages[0])
        self.assertNotIn("unavailable", messages[0])

    def test_a_model_that_cannot_be_loaded_is_still_reported_as_unavailable(self):
        messages: list[str] = []
        with patch.dict(sys.modules, {"spacy": None}), patch.object(guide, "log", side_effect=messages.append):
            self.assertIsNone(guide.spacy_candidates([{"chapter": "C", "text": "Ada arrives."}], "en_core_web_sm"))
        self.assertIn("unavailable", messages[0])

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

    def _guide_with_entity(self, root: Path, **fields) -> Path:
        guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
        entity = {"id": "entity-1", "canonical_name": "Alice", "category": "Character", "description": {"text": "Old."}, "aliases": [], **fields}
        guide.write_json(str(guide_file), {"entities": [entity]})
        return guide_file

    @staticmethod
    def _edit_args(guide_file: Path, pairs: list[tuple[str, str]]) -> argparse.Namespace:
        return argparse.Namespace(
            guide=str(guide_file),
            entity_id="entity-1",
            field=[field for field, _ in pairs],
            value=[value for _, value in pairs],
            manuscript=None,
            espeak_library="",
        )

    def test_edit_applies_several_fields_in_one_run_and_writes_the_file_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = self._guide_with_entity(Path(temporary))
            pairs = [("canonical_name", "Alice Liddell"), ("description", "A curious child."), ("personality", "Curious."), ("context", "Oxford.")]
            with patch.object(guide, "write_json", wraps=guide.write_json) as write:
                guide.edit(self._edit_args(guide_file, pairs))
            self.assertEqual(1, write.call_count)
            entity = json.loads(guide_file.read_text(encoding="utf-8"))["entities"][0]
            self.assertEqual("Alice Liddell", entity["canonical_name"])
            self.assertEqual("A curious child.", entity["description"]["text"])
            self.assertEqual("Curious.", entity["personality_notes"][0]["text"])
            self.assertEqual("Oxford.", entity["context"])
            self.assertEqual("reviewed", entity["review_state"])

    def test_an_alias_edit_beside_other_fields_reads_the_manuscript_once_and_finds_where_it_occurs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manuscript = _write_manuscript(root, "Chapter 1", ["Ally walked in. Then Ally left."])
            guide_file = self._guide_with_entity(root)
            args = self._edit_args(guide_file, [("aliases", "Ally"), ("description", "A child.")])
            args.manuscript = str(manuscript)
            with patch.object(guide, "load_manuscript", wraps=guide.load_manuscript) as load:
                guide.edit(args)
            self.assertEqual(1, load.call_count)
            entity = json.loads(guide_file.read_text(encoding="utf-8"))["entities"][0]
            self.assertEqual("A child.", entity["description"]["text"])
            self.assertEqual(["Ally"], [alias["text"] for alias in entity["aliases"]])
            self.assertEqual(2, len(entity["aliases"][0]["occurrences"]))

    def test_the_command_line_takes_a_value_that_starts_with_a_dash(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = self._guide_with_entity(Path(temporary))
            argv = ["manuscript_guide.py", "edit", "--guide", str(guide_file), "--entity-id", "entity-1", "--field", "personality", "--value=-brave"]
            with patch.object(sys, "argv", argv), patch.object(sys, "stdout", io.StringIO()):
                guide.main()
            entity = json.loads(guide_file.read_text(encoding="utf-8"))["entities"][0]
            self.assertEqual("-brave", entity["personality_notes"][0]["text"])

    def test_edit_with_one_bad_field_changes_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = self._guide_with_entity(Path(temporary))
            before = guide_file.read_text(encoding="utf-8")
            pairs = [("description", "Changed."), ("category", "Not A Category")]
            with self.assertRaises(ValueError):
                guide.edit(self._edit_args(guide_file, pairs))
            self.assertEqual(before, guide_file.read_text(encoding="utf-8"))

    def test_edit_refuses_a_locked_entity_for_every_field_at_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = self._guide_with_entity(Path(temporary), locked=True)
            before = guide_file.read_text(encoding="utf-8")
            with self.assertRaises(ValueError):
                guide.edit(self._edit_args(guide_file, [("description", "A"), ("context", "B")]))
            self.assertEqual(before, guide_file.read_text(encoding="utf-8"))

    def test_edit_needs_a_value_for_every_field(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = self._guide_with_entity(Path(temporary))
            args = self._edit_args(guide_file, [("description", "A")])
            args.field = ["description", "context"]
            with self.assertRaises(ValueError):
                guide.edit(args)

    def test_the_command_line_takes_repeated_field_and_value_pairs(self):
        with tempfile.TemporaryDirectory() as temporary:
            guide_file = self._guide_with_entity(Path(temporary))
            argv = ["manuscript_guide.py", "edit", "--guide", str(guide_file), "--entity-id", "entity-1"]
            argv += ["--field", "description", "--value", "One.", "--field", "context", "--value", "Two."]
            with patch.object(sys, "argv", argv), patch.object(sys, "stdout", io.StringIO()):
                guide.main()
            entity = json.loads(guide_file.read_text(encoding="utf-8"))["entities"][0]
            self.assertEqual(("One.", "Two."), (entity["description"]["text"], entity["context"]))

    def test_create_sets_the_description_in_the_same_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manuscript = _write_manuscript(root, "Chapter 1", ["Juno walked in."])
            guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
            common = {"guide": str(guide_file), "manuscript": str(manuscript), "category": "Character", "aliases": "", "espeak_library": ""}
            guide.create(argparse.Namespace(name="Juno", description="The narrator's friend.", **common))
            guide.create(argparse.Namespace(name="Zeph", description="", **common))
            entities = {entity["canonical_name"]: entity for entity in json.loads(guide_file.read_text(encoding="utf-8"))["entities"]}
            self.assertEqual("The narrator's friend.", entities["Juno"]["description"]["text"])
            self.assertEqual("", entities["Zeph"]["description"]["text"])

    def test_importing_the_module_does_not_import_piper(self):
        # Piper costs about a quarter of a second to import and only render-audio uses it, so every other command must not pay for it.
        code = (
            "import importlib.util, sys;"
            f"spec = importlib.util.spec_from_file_location('manuscript_guide', r'{MODULE_PATH}');"
            "module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module);"
            "print(any(name == 'piper' or name.startswith('piper.') for name in sys.modules))"
        )
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
        self.assertEqual("False", result.stdout.strip(), result.stderr)

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
        # Story Bible has ever been Built - see apps/desktop/bindings.go's
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
            with patch.object(guide, "load_voice", return_value=voice) as load:
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

    def _render(self, root: Path, voice, name: str = "Dawnspire", output_name: str = "preview.wav") -> Path:
        """Runs render_audio with a fake Piper voice against a one-entity guide and
        returns the audio directory so a test can inspect what was left behind."""
        guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
        guide.write_json(str(guide_file), {"entities": [{"id": "entity-1", "canonical_name": name, "aliases": []}]})
        audio_dir = root / "ManuscriptGuide" / "audio"
        args = argparse.Namespace(
            guide=str(guide_file),
            entity_id="entity-1",
            audio_dir=str(audio_dir),
            piper_model=str(root / "voice.onnx"),
            alias_index=None,
            output_name=output_name,
        )
        with patch.object(guide, "load_voice", return_value=voice):
            guide.render_audio(args)
        return audio_dir

    @staticmethod
    def _speaking_voice(frames: int = 100) -> MagicMock:
        def synthesize(_spoken, wav_file):
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(22050)
            wav_file.writeframes(b"\0\0" * frames)

        voice = MagicMock()
        voice.synthesize_wav.side_effect = synthesize
        return voice

    def test_a_synthesis_error_is_reported_not_masked_by_the_wave_writer(self):
        # Piper initialises espeak lazily inside synthesize_wav, before it has set the
        # WAV format. Closing that writer raises "# channels not specified", which used
        # to replace the real error (reproduced against the real voice on a dev build).
        voice = MagicMock()
        voice.synthesize_wav.side_effect = RuntimeError("espeak-ng data directory not found")
        with tempfile.TemporaryDirectory() as temporary, self.assertRaises(ValueError) as caught:
            self._render(Path(temporary), voice)
        self.assertIn("could not be spoken", str(caught.exception))
        self.assertIn("espeak-ng data directory not found", str(caught.exception))
        self.assertNotIn("channels", str(caught.exception))

    def test_a_name_that_produces_no_audio_says_so(self):
        # "..." phonemizes to nothing, so synthesize_wav never sets a format or writes a frame.
        voice = MagicMock()
        voice.synthesize_wav.side_effect = lambda _spoken, _wav: None
        with tempfile.TemporaryDirectory() as temporary, self.assertRaises(ValueError) as caught:
            self._render(Path(temporary), voice, name="...")
        self.assertIn("could not be spoken", str(caught.exception))
        self.assertIn("no audio", str(caught.exception))

    def test_a_failed_render_leaves_no_file_behind(self):
        # A zero-byte WAV at the cache path was trusted by every later preview.
        failing = MagicMock()
        failing.synthesize_wav.side_effect = RuntimeError("boom")
        silent = MagicMock()
        silent.synthesize_wav.side_effect = lambda _spoken, _wav: None
        for label, voice in (("raises", failing), ("silent", silent)):
            with self.subTest(label), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                with self.assertRaises(ValueError):
                    self._render(root, voice)
                audio_dir = root / "ManuscriptGuide" / "audio"
                self.assertEqual([], sorted(path.name for path in audio_dir.iterdir()))

    def test_a_render_appears_at_the_target_only_once_it_is_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target_dir = root / "ManuscriptGuide" / "audio"
            during_synthesis: list[bool] = []
            inner = self._speaking_voice()

            def synthesize(spoken, wav_file):
                during_synthesis.append((target_dir / "preview.wav").exists())
                inner.synthesize_wav(spoken, wav_file)

            voice = MagicMock()
            voice.synthesize_wav.side_effect = synthesize
            audio_dir = self._render(root, voice)
            self.assertEqual([False], during_synthesis)
            self.assertEqual(["preview.wav"], sorted(path.name for path in audio_dir.iterdir()))
            self.assertGreater((audio_dir / "preview.wav").stat().st_size, 44)

    def test_an_error_with_no_message_still_names_itself(self):
        voice = MagicMock()
        voice.synthesize_wav.side_effect = RuntimeError()
        with tempfile.TemporaryDirectory() as temporary, self.assertRaises(ValueError) as caught:
            self._render(Path(temporary), voice)
        self.assertTrue(str(caught.exception).endswith("could not be spoken: RuntimeError"), str(caught.exception))

    def test_a_render_that_cannot_be_moved_into_place_leaves_nothing_and_says_so(self):
        # On Windows os.replace fails while another program (antivirus, a player) holds the target open.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real_replace = guide.os.replace

            def replace(source, target):
                if str(target).endswith("preview.wav"):
                    raise PermissionError(5, "Access is denied")
                real_replace(source, target)  # the guide file itself is also written with os.replace

            with patch.object(guide.os, "replace", side_effect=replace), self.assertRaises(ValueError) as caught:
                self._render(root, self._speaking_voice())
            self.assertIn("could not be saved", str(caught.exception))
            self.assertIn("Access is denied", str(caught.exception))
            self.assertEqual([], sorted(path.name for path in (root / "ManuscriptGuide" / "audio").iterdir()))

    def test_partial_files_left_by_a_killed_run_are_swept_up_by_the_next_render(self):
        # The host kills a render at its timeout, so no cleanup runs and the pid in the name means nothing overwrites it.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio_dir = root / "ManuscriptGuide" / "audio"
            audio_dir.mkdir(parents=True)
            (audio_dir / "preview.wav.4242.part").write_bytes(b"partial")
            (audio_dir / "other.wav.4242.part").write_bytes(b"another output's file")
            self._render(root, self._speaking_voice())
            self.assertEqual(["other.wav.4242.part", "preview.wav"], sorted(path.name for path in audio_dir.iterdir()))

    def test_a_voice_that_cannot_be_loaded_is_reported_as_the_voice(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            guide_file = root / "guide.json"
            guide.write_json(str(guide_file), {"entities": [{"id": "entity-1", "canonical_name": "Dawnspire", "aliases": []}]})
            args = argparse.Namespace(
                guide=str(guide_file),
                entity_id="entity-1",
                audio_dir=str(root / "audio"),
                piper_model=str(root / "missing.onnx"),
                alias_index=None,
                output_name="preview.wav",
            )
            missing = FileNotFoundError(2, "No such file or directory", "missing.onnx.json")
            with patch.object(guide, "load_voice", side_effect=missing), self.assertRaises(ValueError) as caught:
                guide.render_audio(args)
        self.assertIn("preview voice could not be loaded", str(caught.exception))
        self.assertIn("missing.onnx.json", str(caught.exception))

    def test_main_writes_utf8_to_a_legacy_codepage_pipe(self):
        # A project path with characters outside cp1252 made the sidecar exit 1 after it
        # had written the WAV (reproduced on Windows, where a pipe defaults to cp1252).
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "项目"
            guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
            guide.write_json(str(guide_file), {"entities": [{"id": "entity-1", "canonical_name": "Dawnspire", "aliases": []}]})
            out_pipe, err_pipe = io.BytesIO(), io.BytesIO()
            legacy_out = io.TextIOWrapper(out_pipe, encoding="cp1252", write_through=True)
            legacy_err = io.TextIOWrapper(err_pipe, encoding="cp1252", write_through=True)
            argv = [
                "manuscript_guide.py",
                "render-audio",
                "--guide",
                str(guide_file),
                "--entity-id",
                "entity-1",
                "--audio-dir",
                str(root / "audio"),
                "--piper-model",
                "v.onnx",
            ]
            with (
                patch.object(guide, "load_voice", return_value=self._speaking_voice(10)),
                patch.object(sys, "argv", argv),
                patch.object(sys, "stdout", legacy_out),
                patch.object(sys, "stderr", legacy_err),
            ):
                guide.main()
            printed = out_pipe.getvalue().decode("utf-8")
            self.assertTrue(printed.startswith("AUDIO|"), printed)
            self.assertIn("项目", printed)


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


class SelfCheckTests(unittest.TestCase):
    """`self-check` is what the packaged-app smoke test runs against the frozen sidecar: it proves the data the freeze must carry
    (the CMU dictionary and Piper's espeak-ng data) is really there, without needing the 114 MB voice."""

    def test_passes_when_the_dictionary_and_the_espeak_data_load(self):
        results = guide.run_self_check()
        self.assertEqual([entry["name"] for entry in results], ["cmudict", "espeak"])
        self.assertTrue(all(entry["ok"] for entry in results), results)
        self.assertIn("HH", results[0]["detail"])  # "hello" from the CMU dictionary, in ARPAbet
        self.assertTrue(results[1]["detail"])  # the phonemes espeak-ng made of "hello"

    def test_a_dictionary_that_cannot_load_fails_that_check_and_says_why(self):
        # The frozen guide logged exactly this in the phase 4 spike: the freeze carried no cmudict metadata.
        with patch("pronouncing.phones_for_word", side_effect=RuntimeError("No package metadata was found for cmudict")):
            results = guide.run_self_check()
        cmudict = results[0]
        self.assertFalse(cmudict["ok"])
        self.assertIn("No package metadata was found for cmudict", cmudict["detail"])
        self.assertTrue(results[1]["ok"], "one failing check must not hide the other")

    def test_a_missing_espeak_data_directory_fails_that_check_and_names_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            missing = Path(temporary) / "espeak-ng-data"
            results = guide.run_self_check(espeak_data_dir=missing)
        espeak = results[1]
        self.assertFalse(espeak["ok"])
        self.assertIn(str(missing), espeak["detail"])

    def test_a_dictionary_with_no_entry_for_a_common_word_fails(self):
        with patch("pronouncing.phones_for_word", return_value=[]):
            results = guide.run_self_check()
        self.assertFalse(results[0]["ok"])

    def test_with_a_voice_it_also_speaks_one_word(self):
        voice = ManuscriptGuideTests._speaking_voice(frames=200)
        with tempfile.TemporaryDirectory() as temporary, patch.object(guide, "load_voice", return_value=voice) as load:
            results = guide.run_self_check(piper_model=str(Path(temporary) / "voice.onnx"))
            self.assertEqual(load.call_count, 1)
        self.assertEqual([entry["name"] for entry in results], ["cmudict", "espeak", "synthesis"])
        self.assertTrue(results[2]["ok"], results[2])
        self.assertIn("200", results[2]["detail"])  # frames written

    def test_a_voice_that_cannot_speak_fails_the_synthesis_check_with_the_real_reason(self):
        voice = MagicMock()
        voice.synthesize_wav.side_effect = RuntimeError("espeak-ng data directory not found")
        with tempfile.TemporaryDirectory() as temporary, patch.object(guide, "load_voice", return_value=voice):
            results = guide.run_self_check(piper_model=str(Path(temporary) / "voice.onnx"))
        self.assertFalse(results[2]["ok"])
        self.assertIn("espeak-ng data directory not found", results[2]["detail"])

    def test_the_command_prints_one_json_report_and_exits_zero_when_every_check_passes(self):
        out = io.StringIO()
        with patch.object(sys, "argv", ["manuscript_guide.py", "self-check"]), patch("sys.stdout", out):
            guide.main()  # returns: exit code 0
        report = json.loads(out.getvalue())
        self.assertTrue(report["ok"])
        self.assertEqual([entry["name"] for entry in report["checks"]], ["cmudict", "espeak"])

    def test_the_command_exits_one_and_still_prints_the_report_when_a_check_fails(self):
        out = io.StringIO()
        with (
            patch.object(sys, "argv", ["manuscript_guide.py", "self-check"]),
            patch("sys.stdout", out),
            patch("pronouncing.phones_for_word", side_effect=RuntimeError("broken")),
            self.assertRaises(SystemExit) as caught,
        ):
            guide.main()
        self.assertEqual(caught.exception.code, 1)
        report = json.loads(out.getvalue())
        self.assertFalse(report["ok"])
        self.assertIn("broken", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
