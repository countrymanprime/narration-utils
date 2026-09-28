"""The Story Bible preview speaks a chosen pronunciation (story bible and import UX briefs PRD, phase 10, ADR 0681).

`render_audio` used to always speak the spelled name: Piper's own espeak-based grapheme-to-phoneme step ran on
`canonical_name`/alias text every time, so an edited pronunciation had no audible effect (the gap ADR 0091 recorded).
Every pronunciation source now stores IPA (`providers.py`'s `arpabet_to_ipa` normalizes the CMU dictionary's ARPABET
before it is ever saved), so a `chosen` pronunciation can be handed to Piper directly through its own inline raw-phoneme
escape (`"[[ ... ]]"`, `piper.voice.PiperVoice.phonemize`), skipping its text-to-phoneme guess entirely. An unrecognized
phoneme symbol degrades instead of failing: `piper.phoneme_ids.phonemes_to_ids` silently skips one it doesn't know.
"""

import argparse
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

MODULE_PATH = Path(__file__).parents[1] / "core" / "manuscript_guide.py"
SPEC = importlib.util.spec_from_file_location("manuscript_guide", MODULE_PATH)
guide = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guide)


def _speaking_voice() -> MagicMock:
    def synthesize(_spoken, wav_file):
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        wav_file.writeframes(b"\0\0" * 100)

    voice = MagicMock()
    voice.synthesize_wav.side_effect = synthesize
    return voice


class SpokenFormTests(unittest.TestCase):
    """`spoken_form` in isolation: what render_audio should hand to Piper for one entity or alias."""

    def test_no_pronunciation_speaks_the_name(self):
        self.assertEqual("Dawnspire", guide.spoken_form({}, "Dawnspire"))
        self.assertEqual("Dawnspire", guide.spoken_form(None, "Dawnspire"))

    def test_an_unchosen_pronunciation_still_speaks_the_name(self):
        # A pronunciation the build generated but the narrator never picked (pronounce()/pronounce_user()
        # mark "chosen") must not silently change what the preview says.
        holder = {"pronunciation": {"ipa": "dˈɔːnspaɪɚ", "source": "eSpeak NG", "confidence": "low"}}
        self.assertEqual("Dawnspire", guide.spoken_form(holder, "Dawnspire"))

    def test_a_chosen_pronunciation_is_wrapped_as_a_piper_phoneme_block(self):
        holder = {"pronunciation": {"ipa": "dˈɔːnspaɪɚ", "source": "user", "confidence": "narrator", "chosen": True}}
        self.assertEqual("[[dˈɔːnspaɪɚ]]", guide.spoken_form(holder, "Dawnspire"))

    def test_a_chosen_pronunciation_with_no_ipa_falls_back_to_the_name(self):
        holder = {"pronunciation": {"ipa": "", "source": "user", "confidence": "narrator", "chosen": True}}
        self.assertEqual("Dawnspire", guide.spoken_form(holder, "Dawnspire"))

    def test_an_ipa_string_containing_the_blocks_own_closing_marker_falls_back_to_the_name(self):
        # "]]" would end the raw-phoneme block early; refuse to build a corrupt one rather than mis-speak it.
        holder = {"pronunciation": {"ipa": "a]]evil", "source": "user", "confidence": "narrator", "chosen": True}}
        self.assertEqual("Dawnspire", guide.spoken_form(holder, "Dawnspire"))


class RenderAudioSpeaksThePronunciationTests(unittest.TestCase):
    def _render(self, root: Path, entity: dict, voice, alias_index: int | None = None) -> MagicMock:
        guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
        guide.write_json(str(guide_file), {"entities": [entity]})
        args = argparse.Namespace(
            guide=str(guide_file),
            entity_id=entity["id"],
            audio_dir=str(root / "ManuscriptGuide" / "audio"),
            piper_model=str(root / "voice.onnx"),
            alias_index=alias_index,
            output_name="preview.wav",
        )
        with patch.object(guide, "load_voice", return_value=voice):
            guide.render_audio(args)
        return voice

    def test_an_entity_with_a_chosen_pronunciation_is_spoken_as_phonemes(self):
        entity = {
            "id": "entity-1",
            "canonical_name": "Dawnspire",
            "aliases": [],
            "pronunciation": {"ipa": "dˈɔːnspaɪɚ", "source": "user", "confidence": "narrator", "chosen": True},
        }
        with tempfile.TemporaryDirectory() as temporary:
            voice = self._render(Path(temporary), entity, _speaking_voice())
        voice.synthesize_wav.assert_called_once()
        self.assertEqual("[[dˈɔːnspaɪɚ]]", voice.synthesize_wav.call_args[0][0])

    def test_an_entity_with_no_chosen_pronunciation_is_still_spoken_by_name(self):
        entity = {"id": "entity-1", "canonical_name": "Dawnspire", "aliases": []}
        with tempfile.TemporaryDirectory() as temporary:
            voice = self._render(Path(temporary), entity, _speaking_voice())
        self.assertEqual("Dawnspire", voice.synthesize_wav.call_args[0][0])

    def test_an_alias_with_a_chosen_pronunciation_is_spoken_as_phonemes(self):
        entity = {
            "id": "entity-1",
            "canonical_name": "Dawnspire",
            "aliases": [
                {
                    "text": "the Spire",
                    "occurrences": [],
                    "pronunciation": {"ipa": "ðə spaɪɚ", "source": "CMU dictionary", "confidence": "medium", "chosen": True},
                }
            ],
        }
        with tempfile.TemporaryDirectory() as temporary:
            voice = self._render(Path(temporary), entity, _speaking_voice(), alias_index=0)
        self.assertEqual("[[ðə spaɪɚ]]", voice.synthesize_wav.call_args[0][0])

    def test_an_alias_with_no_chosen_pronunciation_is_still_spoken_by_text(self):
        entity = {
            "id": "entity-1",
            "canonical_name": "Dawnspire",
            "aliases": [{"text": "the Spire", "occurrences": [], "pronunciation": {}}],
        }
        with tempfile.TemporaryDirectory() as temporary:
            voice = self._render(Path(temporary), entity, _speaking_voice(), alias_index=0)
        self.assertEqual("the Spire", voice.synthesize_wav.call_args[0][0])


class ChosenPronunciationRoundTripTests(unittest.TestCase):
    """pronounce() -> a rebuild's merge_locked -> render_audio: the PRD's phase 10 success signal."""

    def test_a_pronunciation_chosen_then_rebuilt_is_still_spoken_by_render_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            guide_file = root / "ManuscriptGuide" / "manuscript_guide.json"
            entity = {"id": "entity-1", "canonical_name": "Dawnspire", "aliases": [], "pronunciation": {}}
            guide.write_json(str(guide_file), {"entities": [entity]})

            with patch.object(guide, "pronounce_source", return_value={"ipa": "dˈɔːnspaɪɚ", "source": "eSpeak NG", "confidence": "low"}):
                guide.pronounce(argparse.Namespace(guide=str(guide_file), entity_id="entity-1", alias_index=None, source="espeak", espeak_library=""))

            chosen = json.loads(guide_file.read_text(encoding="utf-8"))["entities"][0]
            self.assertTrue(chosen["pronunciation"]["chosen"])

            # A rebuild re-extracts the entity fresh (a new pronunciation guess, not yet chosen) and merge_locked
            # must keep the narrator's chosen one instead (already covered by test_pronounce.py; exercised again
            # here so the round trip through render_audio is proven end to end).
            fresh = {
                "id": "entity-1",
                "canonical_name": "Dawnspire",
                "aliases": [],
                "pronunciation": {"ipa": "wrong", "source": "CMU dictionary", "confidence": "medium"},
            }
            rebuilt = guide.merge_locked([fresh], {"entities": [chosen]})
            guide.write_json(str(guide_file), {"entities": rebuilt})

            args = argparse.Namespace(
                guide=str(guide_file),
                entity_id="entity-1",
                audio_dir=str(root / "ManuscriptGuide" / "audio"),
                piper_model=str(root / "voice.onnx"),
                alias_index=None,
                output_name="preview.wav",
            )
            voice = _speaking_voice()
            with patch.object(guide, "load_voice", return_value=voice):
                guide.render_audio(args)
            self.assertEqual("[[dˈɔːnspaɪɚ]]", voice.synthesize_wav.call_args[0][0])


if __name__ == "__main__":
    unittest.main()
