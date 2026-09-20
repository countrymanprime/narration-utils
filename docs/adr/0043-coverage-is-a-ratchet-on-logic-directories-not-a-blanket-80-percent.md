# 0043. Coverage is a ratchet on logic directories, not a blanket 80%

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**

## Context

The owner's global testing rule asks for 80% coverage everywhere. Measured on 2026-09-20 (verification and code health tooling PRD, phase 3), that rule cannot be applied as written and would reward the wrong work:

- Go package coverage ranges from 100% (`findings`) to 0% (`cmd/manuscript-import`). Glue and launch packages sit far below 80: the root host package 56%, `transcript` 40%, `tts` 62%, `whisper` 67%, `process` 66%.
- `apps/ui` had no coverage tooling; its components are 57% to 100% and are already covered by the Playwright visual suite and the component atlas, which coverage does not see.
- The Python sidecars had no coverage tooling: `script_tracker.py` is 99% while `compare.py` is 14% and `live_asr.py` (engines that need a microphone and models) is 62%.

A blanket 80% would fail today, and the cheapest way to pass it is padding tests on glue code. The owner decided (implementation plan D18, PRD question 1, option c) on a ratchet over logic directories instead.

## Decision

Coverage is gated as a **ratchet on logic directories**, and this is a deliberate, recorded deviation from the global 80% rule.

- The gated directories and files, and their floors, are listed in `scripts/ci/coverage-floors.json`. Each floor is the rounded-down coverage measured when the entry was added. A directory below its floor fails the run, and so does one with no coverage data (a renamed or deleted directory must be edited out of the file on purpose).
- `scripts/ci/coverage-gate.mjs` is the only reader of that file. The `test` target of each project with entries runs it: Go statement coverage for `apps/desktop`, Vitest v8 line coverage for `apps/ui`, and pytest-cov line coverage for `libs/python` and the sidecars. It prints a note when coverage has risen two points or more above a floor, and `--update` raises floors to the rounded-down measurement and never lowers one.
- **Floors only go up.** Lowering one is a visible edit to the floors file in a pull request and needs the reviewer's agreement; the failure message says not to.
- **80% is the floor for any new logic directory.** An entry below 80 must carry a written `reason` (validated by `scripts/ci/coverage-gate.test.mjs`); the entries that do today are baselines of code that had little coverage when the gate landed, and each names the change expected to raise it.
- **Exempt on purpose:** UI components and the Wails client, host glue, and sidecar-launch code (Go packages `root`, `cmd`, `assets`, `guide`, `process`, `settings`, `transcript`, `tts`, `whisper`; the teleprompter `live_asr` engines; release scripts). Their behavior is verified by the visual suite, the atlas, hand checks in REAPER or the first-use flows, and by tests that assert behavior rather than lines. Adding one of them to the ratchet is allowed and starts at 80.

## Consequences

- Coverage of the code where a regression is silent (parsers, offset and alignment math, state, findings, analyzers) cannot fall without a red gate, and rises as tests are added.
- Glue code is not pushed towards padding tests. The cost is that "the project has 80% coverage" is no longer a true sentence, and that someone must decide which directories are logic; the list in the floors file is that decision, and a reviewer of a new logic directory checks it is added.
- Go coverage differs by a tenth of a point between runs on the root host package, which is not gated. Gated floors are rounded down so ordinary reruns cannot flake.
- A change that drops a gated directory below its floor (for example by moving tested code to an ungated directory) is caught only if the old path has an entry: the "no coverage data" failure covers renames and deletions.
- To change the policy (blanket 80%, or a different ratchet), write a new ADR that supersedes this one.
