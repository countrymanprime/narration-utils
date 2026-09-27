"""Piper, CMU and eSpeak as provider-ports adapters (ADR 0301, provider-ports P8): each row passes its port's conformance
suite, exercised with the same fakes test_pronounce.py and test_manuscript_guide.py already patch phonemizer and Piper with.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# providers.py registers CMU, eSpeak and Piper into narration_common's shared registries as a side effect of import, so
# (unlike the other core/*.py modules the sidecar tests spec-load) it must go through the real, cached import machinery:
# manuscript_guide.py's own tests already import it this way, and a second, independent exec via spec_from_file_location
# would register every row twice into the same singletons and raise "already registered".
_CORE_DIR = Path(__file__).parents[1] / "core"
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

import providers
from narration_common.ports import pronunciation_conformance, tts_conformance
from narration_common.ports.pronunciation import SOURCES
from narration_common.ports.tts import ENGINES


def test_importing_the_module_registers_piper_cmu_and_espeak_once_each():
    assert [descriptor.name for descriptor in ENGINES.descriptors()] == ["piper"]
    assert [descriptor.name for descriptor in SOURCES.descriptors()] == ["cmu", "espeak"]


def test_cmu_stays_the_default_the_build_time_fallback_tries_first():
    assert SOURCES.fallback_order() == ["cmu", "espeak"]


# --- CmuSource --------------------------------------------------------------------------------------------------------------------


def test_cmu_source_passes_its_conformance_suite():
    pronunciation_conformance.run(providers.CmuSource(), known="hello", unknown="Zzyzxqq")


def test_cmu_source_refuses_an_entry_the_dictionary_does_not_have():
    with pytest.raises(ValueError, match="CMU dictionary has no entry"):
        providers.CmuSource().pronounce("Zzyzxqq")


# --- EspeakSource -----------------------------------------------------------------------------------------------------------------


def _fake_phonemize(known: str, ipa: str):
    def phonemize(text, **_kwargs):
        return ipa if text == known else ""

    return phonemize


def test_espeak_source_passes_its_conformance_suite():
    with patch("phonemizer.phonemize", side_effect=_fake_phonemize("Name", "n eɪ m")):
        pronunciation_conformance.run(providers.EspeakSource(), known="Name", unknown="Zzyzxqq")


def test_espeak_source_raises_when_phonemizer_produces_nothing():
    with patch("phonemizer.phonemize", return_value=""), pytest.raises(ValueError, match="eSpeak"):
        providers.EspeakSource().pronounce("Name")


def test_espeak_source_sets_the_library_pronounce_source_gave_it():
    source = providers.EspeakSource()
    source.espeak_library = "/path/to/espeak"
    with (
        patch("phonemizer.phonemize", return_value="n eɪ m"),
        patch("phonemizer.backend.espeak.wrapper.EspeakWrapper.set_library") as set_library,
    ):
        source.pronounce("Name")
    set_library.assert_called_once_with("/path/to/espeak")


def test_espeak_source_does_not_set_a_library_when_none_was_given():
    source = providers.EspeakSource()
    with (
        patch("phonemizer.phonemize", return_value="n eɪ m"),
        patch("phonemizer.backend.espeak.wrapper.EspeakWrapper.set_library") as set_library,
    ):
        source.pronounce("Name")
    set_library.assert_not_called()


# --- PiperEngine ------------------------------------------------------------------------------------------------------------------


def _speaking_voice(frames: int = 100) -> MagicMock:
    """Stands in for a Piper voice: silence for non-blank text, no audio at all for blank text, matching what real Piper
    does and what the conformance suite's blank-text check expects."""

    def synthesize(spoken, wav_file):
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        if spoken.strip():
            wav_file.writeframes(b"\x00\x00" * frames)

    voice = MagicMock()
    voice.synthesize_wav.side_effect = synthesize
    return voice


def test_piper_engine_passes_its_conformance_suite(tmp_path):
    voice_path = tmp_path / "voice.onnx"
    voice_path.write_bytes(b"model")
    workdir = tmp_path / "work"
    workdir.mkdir()

    with patch("piper.voice.PiperVoice.load", return_value=_speaking_voice()):
        tts_conformance.run(providers.PiperEngine(), voice_path=str(voice_path), workdir=workdir, check_missing_voice=False)


def test_load_voice_goes_through_the_tts_registry():
    with patch("piper.voice.PiperVoice.load", return_value="a-raw-voice") as load:
        assert providers.load_voice("v.onnx") == "a-raw-voice"
    load.assert_called_once_with("v.onnx")


def test_piper_voice_adapter_speaks_through_the_free_synthesize_to_file(tmp_path):
    adapter = providers.PiperVoiceAdapter(_speaking_voice())

    adapter.synthesize_to_file("hello", tmp_path / "out.wav")

    assert (tmp_path / "out.wav").is_file()
