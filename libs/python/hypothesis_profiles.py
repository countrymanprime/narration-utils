"""Hypothesis settings for the property tests (test infrastructure; no product code imports this).

Two profiles, chosen with the HYPOTHESIS_PROFILE environment variable:

``gate`` (the default, what ``pnpm check`` and CI run)
    Derandomized: the examples are derived from each test function, so a run is repeatable and a
    red result is a real bug, never a lucky draw (ADR 0023 stance: red must mean real). No example
    database, so nothing carries over between runs. Deadlines and the too_slow health check are off because CI runners vary in speed and
    a slow runner must not turn a repeatable run red; the example count keeps the suite short.

``explore`` (manual, or a scheduled job)
    Random seeds and many more examples, to look for bugs the fixed examples do not reach. A
    failure prints the falsifying example and a ``@reproduce_failure`` blob; copy the example into
    a plain example-based test in the same file, then fix the code.

    HYPOTHESIS_PROFILE=explore .venv/Scripts/python.exe -m pytest -q -k properties sidecars libs/python/tests

A tests folder that uses Hypothesis has a conftest.py that calls ``load()`` (libs/python/tests,
sidecars/manuscript-teleprompter/tests, sidecars/transcript-compare/tests); add one when a new folder starts using it.
"""

import os

from hypothesis import HealthCheck, settings

GATE = "gate"
EXPLORE = "explore"


def load() -> None:
    settings.register_profile(
        GATE, derandomize=True, database=None, deadline=None, max_examples=100, print_blob=True, suppress_health_check=[HealthCheck.too_slow]
    )
    settings.register_profile(EXPLORE, derandomize=False, database=None, deadline=None, max_examples=3000, print_blob=True)
    settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", GATE))
