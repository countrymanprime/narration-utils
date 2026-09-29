"""Piper, CMU, Wiktextract and eSpeak as provider-ports adapters (ADR 0301, provider-ports P8; the wiktextract row is
prep-depth Phase 8, ADR 0405): each row passes its port's conformance suite, exercised with the same fakes
test_pronounce.py and test_manuscript_guide.py already patch phonemizer and Piper with, and (for Wiktextract) a tiny
hand-built index file standing in for the Go asset manager's derived one (docs/research/wiktextract-pronunciation-source.md).
"""

import json
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


def test_importing_the_module_registers_piper_cmu_wiktextract_and_espeak_once_each():
    assert [descriptor.name for descriptor in ENGINES.descriptors()] == ["piper"]
    assert [descriptor.name for descriptor in SOURCES.descriptors()] == ["cmu", "wiktextract", "espeak"]


def test_the_build_time_fallback_tries_cmu_then_wiktextract_then_espeak(monkeypatch):
    # D72/Q7: a better dictionary (wiktextract) is tried before the letter-to-sound guess (espeak), CMU staying the default.
    assert SOURCES.fallback_order() == ["cmu", "wiktextract", "espeak"]


def test_the_build_time_fallback_logs_each_failed_source_in_its_own_words(monkeypatch):
    # The texts were a name-keyed dict in manuscript_guide.py until the provider guard (provider-ports P15) moved them here.
    import manuscript_guide

    messages: list[str] = []
    monkeypatch.setattr(manuscript_guide, "log", messages.append)
    monkeypatch.setattr(manuscript_guide, "pronounce_source", lambda name, library, source: (_ for _ in ()).throw(ValueError("no entry")))

    assert manuscript_guide.pronunciation("Zzyzxqq", None) == {"ipa": "", "source": "not generated", "confidence": "unknown"}
    assert messages == [
        "CMU pronunciation unavailable (no entry).",
        "Wiktionary pronunciation unavailable (no entry).",
        "eSpeak phonetic fallback unavailable (no entry).",
    ]


def test_a_narrators_default_source_is_tried_first(monkeypatch):
    # story-bible-and-import-ux-briefs PRD phase 11 (the settings default): the narrator's preferred source moves to
    # the front of the fallback chain; the rest of the chain, in its usual order, is still there if it fails.
    import manuscript_guide

    tried: list[str] = []

    def fake_pronounce_source(name: str, library: str | None, source: str) -> dict[str, str]:
        tried.append(source)
        raise ValueError("no entry")

    monkeypatch.setattr(manuscript_guide, "pronounce_source", fake_pronounce_source)
    monkeypatch.setattr(manuscript_guide, "log", lambda message: None)

    manuscript_guide.pronunciation("Zzyzxqq", None, default_source="espeak")
    assert tried == ["espeak", "cmu", "wiktextract"]


def test_a_narrators_default_source_is_used_once_and_not_retried(monkeypatch):
    import manuscript_guide

    tried: list[str] = []

    def fake_pronounce_source(name: str, library: str | None, source: str) -> dict[str, str]:
        tried.append(source)
        return {"ipa": "/x/", "source": source, "confidence": "medium"}

    monkeypatch.setattr(manuscript_guide, "pronounce_source", fake_pronounce_source)

    assert manuscript_guide.pronunciation("Name", None, default_source="wiktextract") == {"ipa": "/x/", "source": "wiktextract", "confidence": "medium"}
    assert tried == ["wiktextract"]


def test_an_unregistered_default_source_is_ignored_and_the_usual_order_is_used(monkeypatch):
    import manuscript_guide

    tried: list[str] = []

    def fake_pronounce_source(name: str, library: str | None, source: str) -> dict[str, str]:
        tried.append(source)
        return {"ipa": "/x/", "source": source, "confidence": "medium"}

    monkeypatch.setattr(manuscript_guide, "pronounce_source", fake_pronounce_source)

    manuscript_guide.pronunciation("Name", None, default_source="not-a-real-source")
    assert tried == ["cmu"]


def test_no_default_source_keeps_the_usual_order(monkeypatch):
    import manuscript_guide

    tried: list[str] = []

    def fake_pronounce_source(name: str, library: str | None, source: str) -> dict[str, str]:
        tried.append(source)
        raise ValueError("no entry")

    monkeypatch.setattr(manuscript_guide, "pronounce_source", fake_pronounce_source)
    monkeypatch.setattr(manuscript_guide, "log", lambda message: None)

    manuscript_guide.pronunciation("Name", None)
    assert tried == ["cmu", "wiktextract", "espeak"]


# --- CmuSource --------------------------------------------------------------------------------------------------------------------


def test_cmu_source_passes_its_conformance_suite():
    pronunciation_conformance.run(providers.CmuSource(), known="hello", unknown="Zzyzxqq")


def test_cmu_source_refuses_an_entry_the_dictionary_does_not_have():
    with pytest.raises(ValueError, match="CMU dictionary has no entry"):
        providers.CmuSource().pronounce("Zzyzxqq")


# --- WiktextractSource -------------------------------------------------------------------------------------------------------------


def _write_index(tmp_path, words: dict, name: str = "wiktextract-index.json") -> str:
    path = tmp_path / name
    path.write_text(json.dumps({"catalogFormat": 1, "words": words}), encoding="utf-8")
    return str(path)


def test_wiktextract_source_passes_its_conformance_suite(tmp_path):
    source = providers.WiktextractSource()
    source.index_path = _write_index(tmp_path, {"hello": {"ipa": "həˈloʊ", "audio": ""}})
    pronunciation_conformance.run(source, known="hello", unknown="Zzyzxqq")


def test_wiktextract_source_refuses_an_entry_the_index_does_not_have(tmp_path):
    source = providers.WiktextractSource()
    source.index_path = _write_index(tmp_path, {"hello": {"ipa": "həˈloʊ", "audio": ""}})
    with pytest.raises(ValueError, match='Wiktionary has no entry for "Zzyzxqq"'):
        source.pronounce("Zzyzxqq")


def test_wiktextract_source_raises_a_clear_error_when_not_installed_yet():
    with pytest.raises(ValueError, match="not installed yet"):
        providers.WiktextractSource().pronounce("hello")


def test_wiktextract_source_looks_words_up_case_insensitively(tmp_path):
    source = providers.WiktextractSource()
    source.index_path = _write_index(tmp_path, {"hello": {"ipa": "həˈloʊ", "audio": ""}})
    assert source.pronounce("Hello") == {"ipa": "həˈloʊ", "source": "Wiktionary (CC BY-SA)", "confidence": "medium"}


def test_wiktextract_source_carries_its_cc_by_sa_attribution_on_every_answer(tmp_path):
    source = providers.WiktextractSource()
    source.index_path = _write_index(tmp_path, {"hello": {"ipa": "həˈloʊ", "audio": ""}})
    assert source.pronounce("hello")["source"] == "Wiktionary (CC BY-SA)"


def test_wiktextract_source_re_reads_the_index_only_when_the_path_changes(tmp_path):
    source = providers.WiktextractSource()
    source.index_path = _write_index(tmp_path, {"hello": {"ipa": "həˈloʊ", "audio": ""}})
    first = source._index()
    second = source._index()
    assert first is second  # cached, not re-read, while the path is unchanged

    source.index_path = _write_index(tmp_path, {"hello": {"ipa": "different", "audio": ""}}, name="wiktextract-index-2.json")
    assert source._index() is not first


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
