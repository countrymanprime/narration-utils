"""The text to speech port (provider-ports P7): its descriptor, its roles and its conformance suite."""

import ast
import wave
from pathlib import Path

import pytest
from narration_common.ports import Descriptor, Registry, conformance, tts, tts_conformance
from narration_common.ports.tts import ENGINES, TtsDescriptor

# --- the fakes ------------------------------------------------------------------------------------------------------------------


def _write_wav(path: Path, frames: int) -> None:
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        wav_file.writeframes(b"\x00\x00" * frames)


class FakeVoice:
    """Speaks any non-blank text as silence, the way ``synthesize_to_file`` in the guide sidecar keeps its promise: it writes a
    partial file beside the destination and moves it into place only once it is complete."""

    def __init__(self):
        self.spoken: list[str] = []

    def synthesize_to_file(self, text: str, destination: Path) -> None:
        partial = destination.with_name(destination.name + ".part")
        try:
            if not text.strip():
                raise ValueError(f'"{text}" could not be spoken: the voice produced no audio for it.')
            _write_wav(partial, 100 * len(text))
            partial.replace(destination)
            self.spoken.append(text)
        finally:
            partial.unlink(missing_ok=True)


FAKE = TtsDescriptor("fake", "Fake voices", asset_kind="tts")


class FakeEngine:
    """A test-only engine that implements the port by shape alone: no base class, as a real adapter will."""

    def __init__(self, descriptor: TtsDescriptor = FAKE, voice=None):
        self.descriptor = descriptor
        self.voice = voice or FakeVoice()
        self.loaded: list[str] = []

    def load(self, voice_path: str):
        if not Path(voice_path).is_file():
            raise ValueError(f"There is no voice at {voice_path}.")
        self.loaded.append(voice_path)
        return self.voice


@pytest.fixture
def voice_path(tmp_path: Path) -> str:
    path = tmp_path / "voice.onnx"
    path.write_bytes(b"model")
    return str(path)


def _run(engine, voice_path: str, tmp_path: Path, **cases) -> None:
    workdir = tmp_path / "work"
    workdir.mkdir(exist_ok=True)
    tts_conformance.run(engine, voice_path=voice_path, workdir=workdir, **cases)


# --- the port itself ------------------------------------------------------------------------------------------------------------


def test_the_port_imports_no_engine_and_no_numpy():
    sources = (Path(tts.__file__).read_text(encoding="utf-8"), Path(tts_conformance.__file__).read_text(encoding="utf-8"))
    modules = {
        (node.module or "") if isinstance(node, ast.ImportFrom) else alias.name
        for text in sources
        for node in ast.walk(ast.parse(text))
        if isinstance(node, ast.Import | ast.ImportFrom)
        for alias in node.names
    }

    assert not {m for m in modules if m.split(".")[0] in {"numpy", "piper", "onnxruntime", "phonemizer"}}


def test_the_engines_registry_speaks_of_voice_engines_and_starts_empty():
    """The Piper adapter (P8) fills it at import; the port itself registers nothing."""
    assert isinstance(ENGINES, Registry) and ENGINES.kind == "voice engine" and len(ENGINES) == 0


def test_tts_descriptor_is_a_descriptor_with_an_asset_kind_and_no_modes():
    descriptor = TtsDescriptor("piper", "Piper", asset_kind="tts")

    assert isinstance(descriptor, Descriptor)
    assert (descriptor.asset_kind, descriptor.modes, descriptor.platforms) == ("tts", (), ())


@pytest.mark.parametrize(
    ("kwargs", "complaint"),
    [
        ({"asset_kind": "Has Space"}, "asset kind"),
        ({"modes": ("live",)}, "no modes"),
    ],
)
def test_tts_descriptor_refuses_a_malformed_row(kwargs, complaint):
    with pytest.raises(ValueError, match=complaint):
        TtsDescriptor("x", "X", **kwargs)


# --- the conformance suite: engines that pass -----------------------------------------------------------------------------------


def test_a_fake_engine_passes_and_is_asked_to_load_the_voice_it_was_given(voice_path, tmp_path):
    engine = FakeEngine()

    _run(engine, voice_path, tmp_path)

    assert engine.loaded == [voice_path]
    assert engine.voice.spoken == [tts_conformance.DEFAULT_TEXT]


def test_the_suite_leaves_its_workdir_as_it_found_it(voice_path, tmp_path):
    _run(FakeEngine(), voice_path, tmp_path)

    assert list((tmp_path / "work").iterdir()) == []


def test_the_suite_speaks_the_text_it_is_given(voice_path, tmp_path):
    engine = FakeEngine()

    _run(engine, voice_path, tmp_path, text="Tobias")

    assert engine.voice.spoken == ["Tobias"]


def test_the_suite_runs_over_a_registry_of_fakes_without_editing_a_call_site(voice_path, tmp_path):
    engines: Registry[FakeEngine] = Registry("voice engine")
    engines.register(FakeEngine())
    engines.register(FakeEngine(TtsDescriptor("other", "Other voices", platforms=("windows",))))

    conformance.run_over_registry(engines, lambda engine: _run(engine, voice_path, tmp_path))


def test_the_missing_voice_check_can_be_turned_off_for_an_adapter_whose_loader_is_faked(voice_path, tmp_path):
    class Forgiving(FakeEngine):
        def load(self, voice_path):
            return self.voice

    _run(Forgiving(), voice_path, tmp_path, check_missing_voice=False)


# --- the conformance suite: engines that fail -----------------------------------------------------------------------------------


def _fails(engine, voice_path, tmp_path, complaint: str, **cases) -> None:
    with pytest.raises(conformance.ConformanceError, match=complaint):
        _run(engine, voice_path, tmp_path, **cases)


def test_a_plain_descriptor_is_not_enough(voice_path, tmp_path):
    _fails(FakeEngine(Descriptor("plain", "Plain")), voice_path, tmp_path, "TtsDescriptor")  # type: ignore[arg-type]


def test_an_engine_whose_load_raises_fails(voice_path, tmp_path):
    class Broken(FakeEngine):
        def load(self, voice_path):
            raise RuntimeError("onnx missing")

    _fails(Broken(), voice_path, tmp_path, '"fake" could not load a voice: RuntimeError: onnx missing')


def test_an_engine_whose_load_returns_nothing_fails(voice_path, tmp_path):
    class Empty(FakeEngine):
        def load(self, voice_path):
            return None

    _fails(Empty(), voice_path, tmp_path, "load\\(\\) returned None")


def test_an_engine_that_loads_a_voice_that_is_not_there_fails(voice_path, tmp_path):
    class Forgiving(FakeEngine):
        def load(self, voice_path):
            return self.voice

    _fails(Forgiving(), voice_path, tmp_path, "loaded a voice from a path with no voice")


def test_a_voice_that_writes_nothing_fails(voice_path, tmp_path):
    class Silent(FakeVoice):
        def synthesize_to_file(self, text, destination):
            pass

    _fails(FakeEngine(voice=Silent()), voice_path, tmp_path, "left no file")


def test_a_voice_that_writes_something_other_than_a_wav_fails(voice_path, tmp_path):
    class Garbled(FakeVoice):
        def synthesize_to_file(self, text, destination):
            destination.write_bytes(b"not a wav")

    _fails(FakeEngine(voice=Garbled()), voice_path, tmp_path, "not a WAV")


def test_a_voice_that_writes_an_empty_wav_fails(voice_path, tmp_path):
    class Empty(FakeVoice):
        def synthesize_to_file(self, text, destination):
            _write_wav(destination, 0)

    _fails(FakeEngine(voice=Empty()), voice_path, tmp_path, "no audio")


def test_a_voice_that_raises_speaking_ordinary_text_fails(voice_path, tmp_path):
    class Mute(FakeVoice):
        def synthesize_to_file(self, text, destination):
            raise ValueError("espeak missing")

    _fails(FakeEngine(voice=Mute()), voice_path, tmp_path, 'could not speak "hello": ValueError: espeak missing')


def test_a_voice_that_speaks_blank_text_fails(voice_path, tmp_path):
    class Eager(FakeVoice):
        def synthesize_to_file(self, text, destination):
            _write_wav(destination, 10)

    _fails(FakeEngine(voice=Eager()), voice_path, tmp_path, "blank text")


def test_a_voice_that_leaves_a_file_at_the_destination_when_it_fails_fails(voice_path, tmp_path):
    """The host trusts any file at the destination as a cached preview, so a failed run must leave nothing there."""

    class Careless(FakeVoice):
        def synthesize_to_file(self, text, destination):
            if not text.strip():
                destination.write_bytes(b"half a wav")
                raise ValueError("nothing to say")
            super().synthesize_to_file(text, destination)

    _fails(FakeEngine(voice=Careless()), voice_path, tmp_path, "left a file at the destination")


def test_a_voice_that_leaves_a_partial_file_beside_the_destination_when_it_fails_fails(voice_path, tmp_path):
    class Messy(FakeVoice):
        def synthesize_to_file(self, text, destination):
            if not text.strip():
                destination.with_name(destination.name + ".part").write_bytes(b"half")
                raise ValueError("nothing to say")
            super().synthesize_to_file(text, destination)

    _fails(FakeEngine(voice=Messy()), voice_path, tmp_path, "left .*\\.part")


def test_a_voice_whose_failure_is_not_a_value_error_fails(voice_path, tmp_path):
    """The guide sidecar reports a ``ValueError``'s message to the narrator; anything else reaches them as a crash."""

    class Crashing(FakeVoice):
        def synthesize_to_file(self, text, destination):
            if not text.strip():
                raise RuntimeError("boom")
            super().synthesize_to_file(text, destination)

    _fails(FakeEngine(voice=Crashing()), voice_path, tmp_path, "raised RuntimeError, not a ValueError")


def test_a_voice_whose_failure_has_no_message_fails(voice_path, tmp_path):
    class Terse(FakeVoice):
        def synthesize_to_file(self, text, destination):
            if not text.strip():
                raise ValueError("")
            super().synthesize_to_file(text, destination)

    _fails(FakeEngine(voice=Terse()), voice_path, tmp_path, "no message")


def test_the_suite_refuses_a_workdir_that_is_not_empty(voice_path, tmp_path):
    workdir = tmp_path / "work"
    workdir.mkdir()
    (workdir / "old.wav").write_bytes(b"")

    with pytest.raises(ValueError, match="empty"):
        tts_conformance.run(FakeEngine(), voice_path=voice_path, workdir=workdir)
