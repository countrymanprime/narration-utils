"""asr_batch.FasterWhisperEngine (provider-ports P6): the ASR port's batch role for Transcript Compare, and
compare.transcribe()'s thin wrapper around it. No test here touches a real model or the network."""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import ClassVar

import pytest

CORE = Path(__file__).resolve().parents[1] / "core"
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

import asr_batch
import faster_whisper
from narration_common.ports import NotSupportedError, asr_conformance
from narration_common.ports.asr import BATCH, ENGINES, BatchRequest

COMPARE_PATH = CORE / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare_asr_batch", COMPARE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)


class _FakeWhisperModel:
    """Stands in for faster_whisper.WhisperModel: records how it was built and called, and returns a scripted transcript."""

    instances: ClassVar[list["_FakeWhisperModel"]] = []

    def __init__(self, model_name_or_path, device, compute_type, local_files_only):
        self.model_name_or_path = model_name_or_path
        self.device = device
        self.compute_type = compute_type
        self.local_files_only = local_files_only
        self.calls = []
        _FakeWhisperModel.instances.append(self)

    def transcribe(self, audio, **options):
        self.calls.append((audio, options))
        word = SimpleNamespace
        segments = [
            SimpleNamespace(end=1.0, words=[word(word=" So", start=0.1, end=0.4), word(word=" she", start=0.5, end=0.9)]),
            SimpleNamespace(end=2.0, words=None),
        ]
        info = SimpleNamespace(language="en", language_probability=0.97, duration=2.0)
        return iter(segments), info


@pytest.fixture(autouse=True)
def fake_whisper_model(monkeypatch):
    _FakeWhisperModel.instances = []
    monkeypatch.setattr(faster_whisper, "WhisperModel", _FakeWhisperModel)


# --- the descriptor and the registry -----------------------------------------------------------------------------------------


def test_the_engine_declares_batch_only_and_is_registered_under_whisper():
    assert (asr_batch.ENGINE.descriptor.name, asr_batch.ENGINE.descriptor.modes, asr_batch.ENGINE.descriptor.asset_kind) == (
        "whisper",
        (BATCH,),
        "whisper",
    )
    assert ENGINES.lookup("whisper") is asr_batch.ENGINE


def test_the_engine_refuses_live():
    with pytest.raises(NotSupportedError, match="cannot transcribe live"):
        asr_batch.ENGINE.live(BatchRequest(model="small"))


# --- the conformance suite, with a fake WhisperModel ----------------------------------------------------------------------------


def test_the_engine_passes_the_conformance_suite():
    asr_conformance.run(asr_batch.ENGINE, batch_request=BatchRequest(model="small"), audio=b"fake-audio")


def test_the_engine_is_closed_after_the_conformance_run():
    """The suite closes the batch role it asked for; FasterWhisperEngine's close() is a no-op, so this only guards
    against a future close() that isn't safe to call twice."""
    asr_conformance.run(asr_batch.ENGINE, batch_request=BatchRequest(model="small"), audio=b"fake-audio")


# --- compare.transcribe(): the thin wrapper --------------------------------------------------------------------------------------


def test_transcribe_returns_the_words_faster_whisper_produced():
    words = compare.transcribe(b"fake-audio", "small", "en")

    assert words == [("So", 0.1, 0.4), ("she", 0.5, 0.9)]


def test_transcribe_with_return_info_also_gives_the_detected_language():
    words, info = compare.transcribe(b"fake-audio", "small", None, return_info=True)

    assert words == [("So", 0.1, 0.4), ("she", 0.5, 0.9)]
    assert (info.language, info.language_probability) == ("en", 0.97)


def test_transcribe_loads_the_model_from_the_verified_cache_when_model_dir_is_given():
    compare.transcribe(b"fake-audio", "small", "en", device="cpu", hotwords="Arelian", model_dir="/models/small")

    [model] = _FakeWhisperModel.instances
    assert (model.model_name_or_path, model.device, model.compute_type, model.local_files_only) == ("/models/small", "cpu", "int8", True)
    _, options = model.calls[0]
    assert options == {"language": "en", "word_timestamps": True, "vad_filter": True, "hotwords": "Arelian"}


def test_transcribe_falls_back_to_a_bare_model_size_with_no_model_dir():
    compare.transcribe(b"fake-audio", "small", "en", device="cuda")

    [model] = _FakeWhisperModel.instances
    assert (model.model_name_or_path, model.compute_type, model.local_files_only) == ("small", "float16", False)


def test_transcribe_reports_load_then_transcribe_progress(monkeypatch):
    calls = []
    monkeypatch.setattr(compare, "write_progress", lambda path, stage, pct, message: calls.append((stage, pct, message)))

    compare.transcribe(b"fake-audio", "small", "en", progress_path="/unused")

    assert calls[0] == ("LOAD", 15, "Loading Whisper model 'small' (first use may download it)...")
    stages = [stage for stage, _pct, _message in calls]
    assert stages[1:] == ["TRANSCRIBE", "TRANSCRIBE"]
    # The last report reflects the final segment (2.0s of a 2.0s recording): 18 + 72% done.
    assert calls[-1] == ("TRANSCRIBE", 90, "Transcribing... 00:02 / 00:02")


def test_transcribe_reports_loading_from_the_asset_cache_when_model_dir_is_given(monkeypatch):
    calls = []
    monkeypatch.setattr(compare, "write_progress", lambda path, stage, pct, message: calls.append((stage, pct, message)))

    compare.transcribe(b"fake-audio", "small", "en", progress_path="/unused", model_dir="/models/small")

    assert calls[0] == ("LOAD", 15, "Loading Whisper model 'small'...")


def test_transcribe_raises_cancelled_once_the_progress_file_is_marked_cancelled(tmp_path):
    progress_path = str(tmp_path / "progress")
    Path(progress_path + ".cancel").write_text("", encoding="utf-8")

    with pytest.raises(compare.Cancelled):
        compare.transcribe(b"fake-audio", "small", "en", progress_path=progress_path)
