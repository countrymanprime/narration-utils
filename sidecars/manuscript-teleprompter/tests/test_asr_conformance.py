"""asr_adapters.py (provider-ports P5): WhisperEngine and MoonshineEngine each pass the ASR port's conformance suite, and
each refuses the argument combination its engine cannot take, in the exact words live_asr.py always used."""

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from narration_common.ports import asr_conformance
from narration_common.ports.asr import LiveRequest

CORE = Path(__file__).resolve().parents[1] / "core"


@pytest.fixture(scope="module", autouse=True)
def _asr_adapters_module():
    """Imports `asr_adapters`/`moonshine_engine` as this module's own globals, on first use here rather than at
    collection time: doing it in a fixture defers `core`'s one-time addition to `sys.path` until every test file's
    own module-level code (collected before any fixture runs) has already executed - `replay.py`'s identical
    `sys.path` self-insertion guard included, whose own coverage this would otherwise steal by beating it there
    first. A plain `import`, not the spec-loaded fresh copy other sidecar tests use: asr_adapters.py registers its
    rows into the shared ENGINES singleton as a side effect of being imported, and that must happen at most once per
    process (a second registration of the same name raises), so this needs Python's own module cache to dedupe it.
    """
    if str(CORE) not in sys.path:
        sys.path.insert(0, str(CORE))
    global asr_adapters, moonshine_engine
    import asr_adapters as _asr_adapters
    import moonshine_engine as _moonshine_engine

    asr_adapters = _asr_adapters
    moonshine_engine = _moonshine_engine


HALF_SECOND = 8000  # live_asr.SAMPLE_RATE // 2


def _chunks(count, size=HALF_SECOND):
    for _ in range(count):
        yield np.zeros(size, dtype=np.float32)


# --- WhisperEngine: a fake faster_whisper, so the suite needs no model file -------------------------------------


class _FakeWord:
    def __init__(self, word, start, end):
        self.word, self.start, self.end = word, start, end


class _FakeSegment:
    def __init__(self, words):
        self.words = words


class _FakeWhisperModel:
    def __init__(self, model_or_dir, device, compute_type, local_files_only):
        pass

    def transcribe(self, audio, language, word_timestamps, vad_filter, hotwords):
        return [_FakeSegment([_FakeWord("hello", 0.0, 0.4)])], SimpleNamespace(language="en", language_probability=0.9)


@pytest.fixture
def fake_whisper(monkeypatch):
    import faster_whisper
    import faster_whisper.vad

    monkeypatch.setattr(faster_whisper, "WhisperModel", _FakeWhisperModel)
    # Speech that never closes on its own: the suite's chunks end the stream, and whisper_hypotheses always flushes
    # whatever is still open as one final hypothesis once the input ends.
    monkeypatch.setattr(faster_whisper.vad, "get_speech_timestamps", lambda buffer, vad_options, sampling_rate: [{"start": 0, "end": len(buffer)}])


def test_the_whisper_adapter_passes_the_ports_conformance_suite(fake_whisper):
    asr_conformance.run(asr_adapters.WhisperEngine(), live_request=LiveRequest(model="tiny"), chunks=_chunks(2))


def test_whisper_refuses_context_which_only_moonshine_takes():
    ap = SimpleNamespace(error=lambda message: (_ for _ in ()).throw(SystemExit(message)))
    args = SimpleNamespace(context="script.txt")

    with pytest.raises(SystemExit) as refused:
        asr_adapters.WhisperEngine().check(ap, args)

    assert str(refused.value) == "--context is only supported with --engine moonshine"


def test_whisper_takes_no_context_without_complaint():
    asr_adapters.WhisperEngine().check(SimpleNamespace(error=pytest.fail), SimpleNamespace(context=None))  # must not raise


# --- MoonshineEngine: a fake moonshine_voice (as test_moonshine_engine.py's own fixture does) --------------------


class LineCompleted:
    def __init__(self, line):
        self.line = line


def _line(line_id, text, timings):
    words = [SimpleNamespace(word=word, start=start, end=end) for word, start, end in timings]
    return SimpleNamespace(line_id=line_id, text=text, start_time=0.0, duration=1.0, words=words)


class FakeTranscriber:
    """Stands in for moonshine_voice.Transcriber: one LineCompleted fires as soon as the first chunk arrives, so the
    suite sees one final hypothesis without needing a real model."""

    def __init__(self, model_path, arch, update_interval=None, options=None):
        self.model_path, self.arch = model_path, arch
        self.listener = None
        self.closed = 0

    def add_listener(self, listener):
        self.listener = listener

    def start(self):
        pass

    def add_audio(self, samples, sample_rate):
        if self.listener:
            self.listener(LineCompleted(_line(1, "hello", [("hello", 0.0, 0.4)])))
            self.listener = None  # once is enough; a second chunk must not reopen the closed segment

    def stop(self):
        pass

    def close(self):
        self.closed += 1


@pytest.fixture
def fake_moonshine(monkeypatch, tmp_path):
    monkeypatch.setitem(
        sys.modules,
        "moonshine_voice",
        SimpleNamespace(ModelArch=SimpleNamespace(TINY_STREAMING=1, SMALL_STREAMING=2, MEDIUM_STREAMING=3), Transcriber=FakeTranscriber),
    )
    directory = tmp_path / "moonshine"
    directory.mkdir()
    for name in moonshine_engine.MODEL_FILES:
        (directory / name).write_bytes(b"x")
    return directory


def test_the_moonshine_adapter_passes_the_ports_conformance_suite(fake_moonshine):
    asr_conformance.run(asr_adapters.MoonshineEngine(), live_request=LiveRequest(model="tiny", model_dir=str(fake_moonshine)), chunks=_chunks(2))


def test_moonshine_refuses_a_model_size_whisper_would_take():
    ap = SimpleNamespace(error=lambda message: (_ for _ in ()).throw(SystemExit(message)))
    args = SimpleNamespace(model="large-v3", language=None)

    with pytest.raises(SystemExit) as refused:
        asr_adapters.MoonshineEngine().check(ap, args)

    assert str(refused.value) == "--engine moonshine supports --model tiny/small/medium, not 'large-v3'"


def test_moonshine_refuses_a_language_other_than_english():
    ap = SimpleNamespace(error=lambda message: (_ for _ in ()).throw(SystemExit(message)))
    args = SimpleNamespace(model="tiny", language="fr")

    with pytest.raises(SystemExit) as refused:
        asr_adapters.MoonshineEngine().check(ap, args)

    assert str(refused.value) == "--engine moonshine is English only for now"


def test_moonshine_takes_english_or_unset_without_complaint():
    for language in (None, "en"):
        asr_adapters.MoonshineEngine().check(SimpleNamespace(error=pytest.fail), SimpleNamespace(model="tiny", language=language))  # must not raise
