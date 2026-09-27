# 0403. The `--capabilities` flag reports what registered, not what loads, by default

**Status:** Proposed
**Date:** 2026-09-27

## Context

`ProviderCapabilities()` (`apps/desktop/bindings_providers.go`) answers what the Go-side static registries declare; it never asks a sidecar process what it actually has. The only existing sidecar-reported health check, `--check-moonshine` (`sidecars/manuscript-teleprompter/core/live_asr.py:761-765`, `moonshine_engine.py`'s `self_check()`), answers one specific, heavier question for one hardcoded engine: does Moonshine's native library (`moonshine.dll`/`onnxruntime.dll`) actually load, which a frozen (PyInstaller) build can silently lose.

[Sidecar Capabilities Flag](../prds/sidecar-capabilities-flag.prd.md) generalizes this into one `--capabilities` report per sidecar, covering every registered provider-port row, not just Moonshine. Two shapes were possible: report only what imported and registered (fast, side-effect-free, but weaker — it would not catch a library that imports but fails at actual load/inference time, the exact failure class `--check-moonshine` exists to catch today), or attempt to fully load/verify every row by default (matches `--check-moonshine`'s guarantee, but slower, has side effects for engines needing a model file, and does not fit every row equally — some rows have nothing further to "load" beyond import).

## Decision

`--capabilities` reports registration only by default: for each row a sidecar's process has actually registered (as opposed to what the Go-side static registry declares should exist), it reports the row's descriptor fields (label, platforms, modes, asset kind) and that it registered successfully. It does not attempt to load, initialize, or run inference on any engine by default.

A verify mode (`--capabilities --verify`, or an equivalent second flag — exact wiring is implementation detail, decided when [Sidecar Capabilities Flag](../prds/sidecar-capabilities-flag.prd.md) Phase 3 is scoped) is the explicit, opt-in extension point for the heavier "does it actually load" question, and is the only path by which `--check-moonshine`'s exact current guarantee may be folded into the generic flag and the bespoke flag retired. Until a verify mode exists and is proven equivalent for the `moonshine` row specifically, `--check-moonshine` keeps running unchanged alongside the new generic flag; it is not deleted merely because a superficially similar generic flag exists.

`apps/desktop/smoke.go`'s comparison logic (`checkCapabilities`, generalizing `checkFrozenMoonshine`) checks that every row the Go-side static registry declares for the current platform appears in the sidecar's own report — a presence check, not a load-verification check, until a verify mode is wired in.

## Consequences

- `--capabilities` is safe to run against every row, including ones that need a large model file, without requiring that file to be present or downloaded — it answers "did the code register" not "does the model exist and run."
- The smoke test's coverage does not silently regress: `checkFrozenMoonshine`'s exact guarantee for Moonshine stays in force (the bespoke flag keeps running) until a verify-mode extension is built and proven to cover the same failure class, per [Sidecar Capabilities Flag](../prds/sidecar-capabilities-flag.prd.md) Q3's phase gating.
- A future PR that wants "does engine X actually load" coverage for a *new* engine (the next Moonshine-shaped problem) has two paths under this decision: write another bespoke flag (as `--check-moonshine` did, the pattern this ADR was written to stop repeating) or build out the verify-mode extension this ADR anticipates but does not itself implement. If a second bespoke flag appears after this ADR is accepted, that is a signal the verify-mode extension should be prioritized, not that this decision was wrong — registration-only coverage is deliberately the smaller, safer default, not the ceiling.
