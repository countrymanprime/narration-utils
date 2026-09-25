# 0046. Mechanically checkable ADR rules are lint and test rules that name their ADR

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

ADRs record boundaries (analysis is local, analyzers report and do not write, the script tracker is engine-independent), and until now only review enforced them: `design-spec-guard` is an LLM's judgement and a boundary can erode one import at a time. Three of them are simple enough to check by reading imports, and the tree already satisfied all three. The owner adopted the PRD's recommendations (implementation plan D22, question 8): use the existing lint and test runners, not new tools.

## Decision drivers

- Only review enforced ADR boundaries; `design-spec-guard` is an LLM's judgement and a boundary can erode one import at a time.
- The owner's choice: use the existing lint and test runners, not new tools.
- The sidecar `core/` folders are loose modules, not packages.

## Considered options

1. Import rules in the existing Go lint (depguard) and pytest runs, with failure messages that name the ADR
2. Keep the status quo: review only
3. import-linter for the Python rule

## Decision outcome

**Chosen option: import rules in the existing Go lint (depguard) and pytest runs, with failure messages that name the ADR**, because a boundary enforced only by review can erode one import at a time, and the owner chose the existing lint and test runners over new tools.

Where an ADR's rule is about what may import what, it is enforced by a rule in the existing Go lint or pytest run, and its failure message names the rule and the ADR.

- **Go, `apps/desktop/.golangci.yml` (depguard):** `net` (with `net/http`, `net/url` and the rest), `crypto/tls` and `golang.org/x/net` are imported only in `internal/assets` (the first-use download) and the root `media.go` (the track media route), and tests may use them ([ADR 0032](0032-analyzers-report-findings-and-never-change-audio-or-manuscript-on-their-own.md) point 4, [ADR 0012](0012-media-route-for-track-playback.md)); `internal/measure` and `internal/findings` may not import `internal/manuscript`, `guide`, `settings`, `recents`, `bridge`, `process` or `transcript` (ADR 0032 point 1, extended to what would let an analyzer act; direct imports only).
- **Python, `sidecars/manuscript-teleprompter/tests/test_script_tracker_imports.py`:** `script_tracker.py` imports the standard library only (including no `__import__` or `importlib.import_module` call), checked with `ast` so it holds without the engine packages installed ([ADR 0021](0021-live-speech-engines-behind-one-event-contract.md) point 3). A pytest was chosen over import-linter because the sidecar `core/` folders are loose modules, not packages.
- Each rule is shown to fail on a deliberate violation when it is added. `design-spec-guard` stays for judgement calls (which tokens, which look).
- The UI rules the PRD also plans (primitives layering, one `Highlight` for ADR 0016, the Base UI import guard) wait for the Base UI stack and get their own ADR then.

### Consequences

- **Good:** A boundary that an ADR states cannot be crossed without a red check that links back to the reason.
- **Bad:** The rules are scoped to imports. A sidecar's own network use (the ephemeral `uv` environment of ADR 0021 point 5 downloads packages), `os/exec` running `curl`, a third-party client under another name, and a module name built at run time are not seen, so the network rule is a fence on the Go host, not proof that analysis is local.
- **Neutral:** ADR 0032 is still Proposed, so the analyzer and `net/http` rules enforce a proposed decision; if the owner changes it, the rules change with it.
- **Neutral:** Renaming a Go package or moving `media.go` means editing the globs and module paths in the config, which is visible in the same diff.
- **Neutral:** To drop or reshape a rule, write a new ADR that supersedes this one.

### Confirmation

Each rule is shown to fail on a deliberate violation when it is added; the Go rules run in `apps/desktop/.golangci.yml` (depguard) and the Python rule in `sidecars/manuscript-teleprompter/tests/test_script_tracker_imports.py`.

## Pros and cons of the options

### Review only

- Bad, because `design-spec-guard` is an LLM's judgement and a boundary can erode one import at a time.

### import-linter

- Bad, because the sidecar `core/` folders are loose modules, not packages.
