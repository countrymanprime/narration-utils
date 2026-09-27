"""The speech recognition port (provider-ports P3): its types, its descriptor and its conformance suite."""

import ast
from collections.abc import Iterable, Iterator
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest
from narration_common.ports import Descriptor, Level, NotSupportedError, Registry, asr, asr_conformance, conformance
from narration_common.ports.asr import (
    BATCH,
    ENGINES,
    LIVE,
    AsrDescriptor,
    BatchRequest,
    BatchResult,
    Hypothesis,
    LiveRequest,
)

# --- the fakes ------------------------------------------------------------------------------------------------------------------

SPEECH = [
    Hypothesis(0, (("hello", 0.1, 0.4),), final=False),
    Hypothesis(0, (("hello", 0.1, 0.4), ("there", 0.5, 0.9)), final=True),
    Hypothesis(1, (("again", 1.5, 1.8),), final=True),
]


class FakeLive:
    def __init__(self, script: Iterable[Hypothesis] = SPEECH):
        self.script = list(script)
        self.closed = 0

    def hypotheses(self, chunks: Iterable[object]) -> Iterator[Hypothesis]:
        for _ in chunks:
            pass
        yield from self.script

    def close(self) -> None:
        self.closed += 1


class FakeBatch:
    def __init__(self, words=(("hello", 0.1, 0.4), ("there", 0.5, 0.9))):
        self.words = tuple(words)
        self.closed = 0

    def transcribe(self, audio: object, request: BatchRequest) -> BatchResult:
        return BatchResult(self.words, language=request.language or "en", language_probability=0.99)

    def close(self) -> None:
        self.closed += 1


class FakeEngine:
    """A test-only engine that implements the port by shape alone: no base class, as a real adapter will."""

    def __init__(self, descriptor: AsrDescriptor, live: FakeLive | None = None, batch: FakeBatch | None = None):
        self.descriptor = descriptor
        self._live = live or FakeLive()
        self._batch = batch or FakeBatch()

    def live(self, request: LiveRequest) -> FakeLive:
        if not self.descriptor.supports(LIVE):
            raise self.descriptor.refuse(LIVE)
        return self._live

    def batch(self, request: BatchRequest) -> FakeBatch:
        if not self.descriptor.supports(BATCH):
            raise self.descriptor.refuse(BATCH)
        return self._batch


BOTH = AsrDescriptor("fake", "Fake engine", modes=(LIVE, BATCH), asset_kind="whisper")
LIVE_ONLY = AsrDescriptor("fake-live", "Fake live engine", platforms=("windows",), modes=(LIVE,), languages=("en",))


def _run(engine, **cases) -> None:
    asr_conformance.run(engine, chunks=[b"chunk"] * 3, audio=b"audio", **cases)


# --- Word and Hypothesis --------------------------------------------------------------------------------------------------------


def test_hypothesis_is_a_frozen_engine_neutral_reading_of_one_segment():
    hypothesis = Hypothesis(segment=2, words=(("hi", 0.0, 0.2),), final=True)

    assert (hypothesis.segment, hypothesis.words, hypothesis.final) == (2, (("hi", 0.0, 0.2),), True)
    assert hypothesis == Hypothesis(2, (("hi", 0.0, 0.2),), True)
    with pytest.raises(FrozenInstanceError):
        hypothesis.final = False  # type: ignore[misc]


def test_the_teleprompter_keeps_importing_word_and_hypothesis_from_live_asr():
    """Q3: the types moved here, and ``live_asr.py`` re-exports them, so ``live_asr.Hypothesis`` is this very class. Checked by
    reading the source, since importing ``live_asr`` needs numpy and the sidecar's folder on the path."""
    live_asr = Path(__file__).resolve().parents[3] / "sidecars" / "manuscript-teleprompter" / "core" / "live_asr.py"
    tree = ast.parse(live_asr.read_text(encoding="utf-8"))

    imported = {
        alias.name for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module == "narration_common.ports.asr" for alias in node.names
    }
    defined = {node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)}
    assigned = {target.id for node in ast.walk(tree) if isinstance(node, ast.Assign) for target in node.targets if isinstance(target, ast.Name)}

    assert {"Hypothesis", "Word"} <= imported
    assert "Hypothesis" not in defined and "Word" not in assigned


def test_the_port_imports_no_engine_and_no_numpy():
    source = (Path(asr.__file__).read_text(encoding="utf-8"), Path(asr_conformance.__file__).read_text(encoding="utf-8"))
    modules = {
        (node.module or "") if isinstance(node, ast.ImportFrom) else alias.name
        for text in source
        for node in ast.walk(ast.parse(text))
        if isinstance(node, ast.Import | ast.ImportFrom)
        for alias in node.names
    }

    assert not {m for m in modules if m.split(".")[0] in {"numpy", "faster_whisper", "moonshine_voice", "av", "ctranslate2"}}


# --- requests and results -------------------------------------------------------------------------------------------------------


def test_requests_carry_what_every_engine_is_loaded_with_and_default_to_the_cpu():
    live = LiveRequest(model="small", model_dir="/models/small", language="en", hotwords="Tobias")
    batch = BatchRequest(model="large-v3-turbo")

    assert (live.model, live.model_dir, live.language, live.hotwords, live.device) == ("small", "/models/small", "en", "Tobias", "cpu")
    assert (batch.model, batch.model_dir, batch.language, batch.device, batch.progress) == ("large-v3-turbo", None, None, "cpu", None)
    assert live.options == {} and batch.options == {}


@pytest.mark.parametrize("request_type", [LiveRequest, BatchRequest])
def test_a_request_needs_a_model(request_type):
    with pytest.raises(ValueError, match="model"):
        request_type(model=" ")


def test_a_request_options_mapping_is_copied_and_read_only():
    options = {"decode_interval": 0.5}
    request = LiveRequest(model="small", options=options)
    options["decode_interval"] = 9.0

    assert request.options["decode_interval"] == 0.5
    with pytest.raises(TypeError):
        request.options["decode_interval"] = 1.0  # type: ignore[index]


def test_batch_result_holds_the_words_as_a_tuple():
    result = BatchResult([("a", 0.0, 0.1)], language="en", language_probability=0.9)

    assert result.words == (("a", 0.0, 0.1),)


# --- the descriptor -------------------------------------------------------------------------------------------------------------


def test_asr_descriptor_is_a_descriptor_with_languages_and_an_asset_kind():
    assert isinstance(LIVE_ONLY, Descriptor)
    assert LIVE_ONLY.languages == ("en",) and BOTH.languages == () and BOTH.asset_kind == "whisper"


def test_an_engine_with_no_languages_speaks_every_language():
    assert BOTH.speaks("de") and BOTH.speaks(None)
    assert LIVE_ONLY.speaks("en") and LIVE_ONLY.speaks(None) and not LIVE_ONLY.speaks("de")


@pytest.mark.parametrize(
    ("kwargs", "complaint"),
    [
        ({"modes": ()}, "at least one"),
        ({"modes": ("stream",)}, "stream"),
        ({"modes": (LIVE,), "languages": ("EN",)}, "EN"),
        ({"modes": (LIVE,), "languages": ("en", "en")}, "twice"),
        ({"modes": (LIVE,), "asset_kind": "Has Space"}, "asset kind"),
    ],
)
def test_asr_descriptor_refuses_a_malformed_row(kwargs, complaint):
    with pytest.raises(ValueError, match=complaint):
        AsrDescriptor("x", "X", **kwargs)


def test_refuse_names_the_engine_and_the_role_in_a_sentence():
    refusal = LIVE_ONLY.refuse(BATCH)

    assert isinstance(refusal, NotSupportedError)
    assert (refusal.name, refusal.level) == ("fake-live", Level.Unsupported)
    assert str(refusal) == "Fake live engine cannot transcribe a recording."
    assert str(BOTH.refuse(LIVE)) == "Fake engine cannot transcribe live."


def test_the_engines_registry_speaks_of_speech_engines_and_starts_empty():
    """The adapters (P5 and P6) fill it at import; the port itself registers nothing."""
    assert isinstance(ENGINES, Registry) and ENGINES.kind == "speech engine" and len(ENGINES) == 0


# --- the conformance suite: engines that pass -----------------------------------------------------------------------------------


def test_an_engine_declaring_both_roles_passes_and_both_roles_are_closed_twice():
    engine = FakeEngine(BOTH)

    _run(engine)

    assert engine._live.closed == 2 and engine._batch.closed == 2


def test_a_live_only_engine_passes_by_refusing_batch():
    _run(FakeEngine(LIVE_ONLY))


def test_an_engine_whose_live_role_hears_nothing_passes():
    _run(FakeEngine(LIVE_ONLY, live=FakeLive(script=[])))


def test_the_suite_runs_over_a_registry_of_fakes_without_editing_a_call_site():
    engines: Registry[FakeEngine] = Registry("speech engine")
    engines.register(FakeEngine(BOTH))
    engines.register(FakeEngine(LIVE_ONLY))

    conformance.run_over_registry(engines, _run)


# --- the conformance suite: engines that fail -----------------------------------------------------------------------------------


def test_a_fake_that_declares_live_but_raises_from_live_fails():
    class Broken(FakeEngine):
        def live(self, request):
            raise RuntimeError("model missing")

    with pytest.raises(conformance.ConformanceError, match='"fake-live" declares live, but it raised RuntimeError: model missing'):
        _run(Broken(LIVE_ONLY))


def test_a_plain_descriptor_is_not_enough():
    with pytest.raises(conformance.ConformanceError, match="AsrDescriptor"):
        _run(FakeEngine(Descriptor("plain", "Plain", modes=(LIVE,))))  # type: ignore[arg-type]


def test_an_engine_that_does_batch_without_declaring_it_fails():
    class Eager(FakeEngine):
        def batch(self, request):
            return self._batch

    with pytest.raises(conformance.ConformanceError, match="does not declare batch, but it did not raise NotSupportedError"):
        _run(Eager(LIVE_ONLY))


def _live_failure(script: list, complaint: str) -> None:
    with pytest.raises(conformance.ConformanceError, match=complaint):
        _run(FakeEngine(LIVE_ONLY, live=FakeLive(script=script)))


def test_live_output_must_be_hypotheses():
    _live_failure([("hello", 0.0, 0.1)], "hypothesis 0 is a tuple, not a Hypothesis")


def test_live_segments_never_go_back():
    _live_failure([Hypothesis(1, (), False), Hypothesis(0, (), False)], "hypothesis 1 is for segment 0, after segment 1")


def test_a_closed_segment_gets_no_more_hypotheses():
    _live_failure([Hypothesis(0, (), True), Hypothesis(0, (), False)], "hypothesis 1 is for segment 0, which a final hypothesis already closed")


def test_a_segment_number_is_a_non_negative_int():
    _live_failure([Hypothesis(-1, (), False)], "segment -1")
    _live_failure([Hypothesis(True, (), False)], "segment True")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("word", "complaint"),
    [
        (("hello", 0.0), "not a \\(text, start, end\\) triple"),
        ((1, 0.0, 0.1), "not a \\(text, start, end\\) triple"),
        (("hello", "0", 0.1), "not a \\(text, start, end\\) triple"),
        (("  ", 0.0, 0.1), "blank"),
    ],
)
def test_live_words_are_non_blank_timed_triples(word, complaint):
    _live_failure([Hypothesis(0, (word,), False)], complaint)


def test_live_word_timings_are_checked_within_each_hypothesis():
    _live_failure([Hypothesis(0, (("a", 0.5, 0.6), ("b", 0.2, 0.3)), False)], "hypothesis 0: span 1 .* starts before")
    _live_failure([Hypothesis(0, (("a", 0.5, 0.4),), True)], "hypothesis 0: span 0 .* ends before it starts")


def test_live_words_may_be_reread_across_hypotheses():
    """A later hypothesis re-reads the open segment from its start, so timings restart per hypothesis, not per stream."""
    _run(FakeEngine(LIVE_ONLY, live=FakeLive(script=[Hypothesis(0, (("a", 0.5, 0.6),), False), Hypothesis(0, (("a", 0.4, 0.6),), True)])))


def test_a_live_role_whose_second_close_raises_fails():
    class Fragile(FakeLive):
        def close(self):
            super().close()
            if self.closed > 1:
                raise RuntimeError("already closed")

    with pytest.raises(conformance.ConformanceError, match="second close"):
        _run(FakeEngine(LIVE_ONLY, live=Fragile()))


def test_batch_output_must_be_a_batch_result_with_monotonic_words():
    class Wrong(FakeBatch):
        def transcribe(self, audio, request):
            return list(self.words)

    with pytest.raises(conformance.ConformanceError, match="returned a list, not a BatchResult"):
        _run(FakeEngine(BOTH, batch=Wrong()))
    with pytest.raises(conformance.ConformanceError, match="span 1 .* starts before"):
        _run(FakeEngine(BOTH, batch=FakeBatch(words=[("a", 1.0, 1.1), ("b", 0.5, 0.6)])))
    with pytest.raises(conformance.ConformanceError, match="blank"):
        _run(FakeEngine(BOTH, batch=FakeBatch(words=[("", 1.0, 1.1)])))


def test_a_batch_role_whose_second_close_raises_fails():
    class Fragile(FakeBatch):
        def close(self):
            super().close()
            if self.closed > 1:
                raise RuntimeError("already closed")

    with pytest.raises(conformance.ConformanceError, match="second close"):
        _run(FakeEngine(BOTH, batch=Fragile()))


def test_the_suite_closes_a_live_role_even_when_its_output_fails():
    live = FakeLive(script=[("not", 0.0, 0.1)])
    with pytest.raises(conformance.ConformanceError):
        _run(FakeEngine(LIVE_ONLY, live=live))

    assert live.closed >= 1


def test_the_suite_passes_its_requests_to_the_roles():
    seen = []

    class Recording(FakeEngine):
        def live(self, request):
            seen.append(request)
            return super().live(request)

        def batch(self, request):
            seen.append(request)
            return super().batch(request)

    live_request, batch_request = LiveRequest(model="tiny", language="en"), BatchRequest(model="base")
    _run(Recording(BOTH), live_request=live_request, batch_request=batch_request)

    assert seen == [live_request, batch_request]
