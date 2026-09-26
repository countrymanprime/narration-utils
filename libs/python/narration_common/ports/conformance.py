"""The checks every port's conformance suite shares (ADR 0301, Liskov).

A port's suite (``asr_conformance.run`` and the like) is a function of one implementation built from these checks and its own. The
registry's test runs it over every row with ``run_over_registry``, so a new row cannot skip it. A failed check raises
``ConformanceError`` naming the implementation; anything else escaping a suite is a bug in the suite and is not caught.
"""

import math
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from .registry import Descriptor, NotSupportedError, Registry


class ConformanceError(AssertionError):
    """An implementation broke its port's contract."""


def _name(port: Any) -> str:
    descriptor = getattr(port, "descriptor", None)
    return descriptor.name if isinstance(descriptor, Descriptor) else repr(port)


def check_descriptor(port: Any) -> Descriptor:
    """The port carries a ``Descriptor`` (which validated its own fields when it was built)."""
    descriptor = getattr(port, "descriptor", None)
    if not isinstance(descriptor, Descriptor):
        raise ConformanceError(f"{port!r} has no descriptor, or it is not a Descriptor")
    return descriptor


def check_roles(port: Any, roles: Mapping[str, Callable[[Any], Any]]) -> None:
    """Every declared mode's role returns an object; every undeclared one refuses with a ``NotSupportedError`` for this port.

    ``roles`` maps each mode the port knows to a call that asks ``port`` for that role (``lambda engine: engine.live(request)``).
    """
    descriptor = check_descriptor(port)
    for mode in descriptor.modes:
        if mode not in roles:
            raise ConformanceError(f'"{descriptor.name}" declares mode "{mode}", which this port has no role for ({", ".join(roles)})')
    for mode, ask in roles.items():
        if descriptor.supports(mode):
            try:
                role = ask(port)
            except Exception as exc:
                raise ConformanceError(f'"{descriptor.name}" declares {mode}, but it raised {type(exc).__name__}: {exc}') from exc
            if role is None:
                raise ConformanceError(f'"{descriptor.name}" declares {mode}, but its role returned None')
            continue
        try:
            ask(port)
        except NotSupportedError as refusal:
            if refusal.name != descriptor.name:
                raise ConformanceError(f'"{descriptor.name}" refused {mode}, but its refusal names "{refusal.name}"') from refusal
            if refusal.level.usable:
                raise ConformanceError(f'"{descriptor.name}" refused {mode} at the usable level {refusal.level.name}') from refusal
        except Exception as exc:
            raise ConformanceError(f'"{descriptor.name}" does not declare {mode}, and raised {type(exc).__name__} instead of NotSupportedError') from exc
        else:
            raise ConformanceError(f'"{descriptor.name}" does not declare {mode}, but it did not raise NotSupportedError')


def check_close_twice(resource: Any) -> None:
    """``close()`` may be called twice: a caller's ``finally`` often closes what an error path already closed."""
    resource.close()
    try:
        resource.close()
    except Exception as exc:
        raise ConformanceError(f"{_name(resource)}: a second close() raised {type(exc).__name__}: {exc}") from exc


def check_timings(spans: Iterable[tuple[float, float]]) -> None:
    """Output timings, as ``(start, end)`` seconds in output order, are numbers, non-negative, each ordered and none going back."""
    previous_start = 0.0
    for index, (start, end) in enumerate(spans):
        if math.isnan(start) or math.isnan(end):
            raise ConformanceError(f"span {index} ({start}, {end}) is not a number")
        if start < 0 or end < 0:
            raise ConformanceError(f"span {index} ({start}, {end}) is negative")
        if end < start:
            raise ConformanceError(f"span {index} ({start}, {end}) ends before it starts")
        if start < previous_start:
            raise ConformanceError(f"span {index} ({start}, {end}) starts before the span ahead of it ({previous_start})")
        previous_start = start


def run_over_registry(registry: Registry[Any], suite: Callable[[Any], None]) -> None:
    """Runs ``suite`` over every row and fails once, listing every row that broke the contract."""
    rows = list(registry)
    if not rows:
        raise ConformanceError(f"the {registry.kind} registry has no rows to check")
    failures = []
    for port in rows:
        try:
            suite(port)
        except ConformanceError as failure:
            failures.append(f"- {_name(port)}: {failure}")
    if failures:
        raise ConformanceError(f"{len(failures)} of {len(rows)} {registry.kind}s broke the port's contract:\n" + "\n".join(failures))
