"""The speech engine port's conformance suite (ADR 0301, Liskov): what every ``AsrEngine`` must do, checked the same way for each.

``run(engine, ...)`` asks the engine for each role. A declared role must load and return an object; an undeclared one must refuse
with a ``NotSupportedError`` naming the engine. A live role's hypotheses must be ``Hypothesis`` objects whose segments never go
back and never reopen after their final reading, each holding non-blank words whose timings are non-negative and in order. A
batch role must return a ``BatchResult`` whose words are the same. Both roles must survive ``close()`` twice. Real engines run it
with a fake model, so CI needs no model files; ``conformance.run_over_registry(ENGINES, run)`` runs it over every row.
"""

import contextlib
import math
from collections.abc import Iterable
from typing import Any

from . import conformance
from .asr import BATCH, LIVE, AsrDescriptor, BatchRequest, BatchResult, Hypothesis, LiveRequest
from .conformance import ConformanceError

# Requests for a model no engine has, used when a test gives none: a role must load from its request, and a fake ignores it.
DEFAULT_LIVE_REQUEST = LiveRequest(model="conformance")
DEFAULT_BATCH_REQUEST = BatchRequest(model="conformance")


def _is_time(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def check_words(words: Any, where: str) -> None:
    """``words`` is a sequence of non-blank ``(text, start, end)`` triples in time order."""
    words = tuple(words)
    for index, word in enumerate(words):
        if not (isinstance(word, tuple) and len(word) == 3 and isinstance(word[0], str) and _is_time(word[1]) and _is_time(word[2])):
            raise ConformanceError(f"{where}: word {index} {word!r} is not a (text, start, end) triple")
        if not word[0].strip():
            raise ConformanceError(f"{where}: word {index} is blank")
    try:
        conformance.check_timings((start, end) for _, start, end in words)
    except ConformanceError as failure:
        raise ConformanceError(f"{where}: {failure}") from failure


def check_hypotheses(hypotheses: Iterable[Any]) -> None:
    """A live role's output, in order: one open segment at a time, as ``live_asr.confirmed_events`` needs."""
    current = -1
    closed: set[int] = set()
    for index, hypothesis in enumerate(hypotheses):
        if not isinstance(hypothesis, Hypothesis):
            raise ConformanceError(f"hypothesis {index} is a {type(hypothesis).__name__}, not a Hypothesis")
        segment = hypothesis.segment
        if not isinstance(segment, int) or isinstance(segment, bool) or segment < 0:
            raise ConformanceError(f"hypothesis {index} has segment {segment!r}, not a non-negative int")
        if segment < current:
            raise ConformanceError(f"hypothesis {index} is for segment {segment}, after segment {current}")
        if segment in closed:
            raise ConformanceError(f"hypothesis {index} is for segment {segment}, which a final hypothesis already closed")
        check_words(hypothesis.words, f"hypothesis {index}")
        current = segment
        if hypothesis.final:
            closed.add(segment)


def check_batch_result(result: Any) -> None:
    if not isinstance(result, BatchResult):
        raise ConformanceError(f"transcribe() returned a {type(result).__name__}, not a BatchResult")
    check_words(result.words, "transcribe()")
    probability = result.language_probability
    if probability is not None and (not _is_time(probability) or math.isnan(probability) or not 0 <= probability <= 1):
        raise ConformanceError(f"transcribe() gave a language probability of {probability!r}, not one between 0 and 1")


def _named(descriptor: AsrDescriptor, what: str, check, *args) -> None:
    try:
        check(*args)
    except ConformanceError as failure:
        raise ConformanceError(f'"{descriptor.name}" {what}: {failure}') from failure


def _checked_then_closed(descriptor: AsrDescriptor, mode: str, role: Any, check) -> None:
    """Runs ``check`` on a role, then closes it twice; a role whose output failed is still closed, once, quietly."""
    try:
        _named(descriptor, mode, check)
    except BaseException:
        with contextlib.suppress(Exception):
            role.close()
        raise
    _named(descriptor, mode, conformance.check_close_twice, role)


def run(
    engine: Any,
    *,
    live_request: LiveRequest = DEFAULT_LIVE_REQUEST,
    batch_request: BatchRequest = DEFAULT_BATCH_REQUEST,
    chunks: Iterable[Any] = (),
    audio: Any = None,
) -> None:
    """Checks one engine. ``chunks`` feed the live role and ``audio`` the batch role, in whatever form the engine takes."""
    descriptor = conformance.check_descriptor(engine)
    if not isinstance(descriptor, AsrDescriptor):
        raise ConformanceError(f'"{descriptor.name}" has a {type(descriptor).__name__}, not an AsrDescriptor')

    roles: dict[str, Any] = {}

    def ask(mode: str, call):
        role = call()
        roles[mode] = role
        return role

    conformance.check_roles(
        engine,
        {
            LIVE: lambda port: ask(LIVE, lambda: port.live(live_request)),
            BATCH: lambda port: ask(BATCH, lambda: port.batch(batch_request)),
        },
    )

    if LIVE in roles:
        live = roles[LIVE]
        _checked_then_closed(descriptor, "live", live, lambda: check_hypotheses(live.hypotheses(chunks)))
    if BATCH in roles:
        batch = roles[BATCH]
        _checked_then_closed(descriptor, "batch", batch, lambda: check_batch_result(batch.transcribe(audio, batch_request)))
