# 0044. Property and fuzz tests are deterministic in the gate

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

The verification tooling PRD added property tests (Hypothesis for Python, fast-check for the UI) and Go fuzz targets over the text, offset and alignment logic. Randomized tests find more, but a gate that is red on one draw and green on the next teaches people to rerun it, which [ADR 0023](0023-visual-suite-capture-contract-and-storybook.md) rejects: no retries, red must mean real. The first runs also showed that random exploration is still worth having: it found nothing beyond the fixed examples in 3000-example runs, but the properties themselves found six real defects (a `TypeError` and two escaped exceptions in `narration_common.manuscript`, two offset bugs in the reader's compositor and note anchors, and a panic in the Markdown underline tag). The owner adopted the PRD's recommendations (implementation plan D22, questions 3 and 5).

## Decision drivers

- A gate that is red on one draw and green on the next teaches people to rerun it; ADR 0023 rejects retries: red must mean real.
- Random exploration is still worth having: the properties found six real defects.

## Considered options

1. Deterministic property and fuzz tests in the gate, with exploration as a separate, manual act
2. Random seeds in the gate, and `-fuzztime` in CI

## Decision outcome

**Chosen option: deterministic property and fuzz tests in the gate, with exploration as a separate, manual act**, because a randomized gate can be red on one draw and green on the next, and ADR 0023 requires that red means real.

Property and fuzz tests run deterministically in `pnpm check` and CI, and exploration is a separate, manual act.

- **Hypothesis** uses the `gate` profile in `libs/python/hypothesis_profiles.py`: `derandomize=True`, no example database, no deadline and `too_slow` suppressed, 100 examples. A `conftest.py` in each tests folder that uses Hypothesis loads it. `HYPOTHESIS_PROFILE=explore` runs random seeds with 3000 examples by hand.
- **fast-check** uses a fixed global seed and 200 runs, set in `apps/ui/src/test-setup.ts`. `VITE_FAST_CHECK_EXPLORE=1` runs random seeds with 5000 runs by hand.
- **Go** fuzz targets in `apps/desktop/internal/importer` run only their seed corpus and any checked-in `testdata/fuzz` entries under plain `go test`. Fuzzing is manual (`go test -run='^$' -fuzz=<Target> -fuzztime=60s`). The PDF target compiles only with the `pdf_candidate` tag, like the PDF importer.
- A failing exploratory run becomes a plain example (`@example`, a named test, or a `testdata/fuzz` file) in the same change that fixes the bug, so the gate keeps it forever.
- A generator that stops reaching its interesting cases makes a property vacuous, so reach is checked: `hypothesis.event` statistics when the strategy is written, and a reach test where the generator is easy to break (`resolveNoteAnchor`).

### Consequences

- **Good:** A red property is a bug in the code or the property, never a bad draw, and a run costs a fixed one to three seconds per project.
- **Bad:** The gate does not search: bugs outside the fixed examples appear only when someone runs the explore profile. Nothing schedules that run; if targets start finding things it should become a scheduled job.
- **Bad:** The fixed seeds mean a new property can pass on 100 examples and still be wrong; the review habit that caught vacuous generators in phases 4 and 5 (measure reach, mutate the code and see the property fail) stays necessary.
- **Neutral:** To change this (random seeds in the gate, `-fuzztime` in CI), write a new ADR that supersedes this one.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Random seeds in the gate

- Good, because the gate would search beyond the fixed examples on every run.
- Bad, because a gate that is red on one draw and green on the next teaches people to rerun it.
