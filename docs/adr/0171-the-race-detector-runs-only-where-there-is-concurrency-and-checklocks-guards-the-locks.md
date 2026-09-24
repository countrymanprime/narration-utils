# 0171. The race detector runs only where there is concurrency, and checklocks guards the locks

**Status:** Proposed
**Date:** 2026-09-24

## Context

CI's `go` job ran every Go package's tests under `go test -race`. After the EBU loudness test set (#443) and the windowed diagnostics analyzers (#444) landed, `internal/measure` took 454 s under the detector (4 s without it) and the job went from about 5 minutes to 12. Those tests are single-threaded arithmetic over seconds of synthesized audio: the detector instruments every sample access and has nothing to find. `-race` cannot run on a developer machine here (it needs cgo), so it only ever runs in CI ([host-binding-concurrency.md](../architecture/host-binding-concurrency.md)).

Dropping `-race` from CI was considered; nothing else would then check goroutine handoffs, and the host's shutdown and project-switch tests exist to be run under it. A static race detector was looked for as a replacement: Chronos is unmaintained (last change 2022, Go 1.15) and does not model channels, WaitGroups or atomics, which this code uses. gVisor's checklocks is maintained and fast, but it only checks lock discipline on fields it is told about, not goroutine handoffs.

## Decision

- The `ci` configuration of `narration-utils-shell:test` still passes `-race`, and `scripts/ci/coverage-gate.mjs` applies it only to the packages the detector can find something in: `splitRacePackages` picks every package whose source imports `sync` or `sync/atomic`, starts a goroutine or uses a channel, or whose tests start goroutines or synchronise. The rest run in a second `go test` without `-race`. Both runs are measured by the coverage ratchet, and the second runs even if the first fails. There is no list to keep: a package that gains a goroutine is raced from then on.
- `t.Parallel` alone does not make a package raced: parallel subtests racing on their own fixtures are not a product bug.
- gVisor's checklocks runs in `narration-utils-shell:lint` (`scripts/quality.mjs go-lint`), on product code only (`-test=false`). Every field that is only touched under a lock carries `// +checklocks:<mu>`, a helper whose caller holds the lock carries `// +checklocks:<recv>.mu` or `// +checklocksread:<recv>.mu`, and a field that checklocks infers is always used under a lock must be annotated or given `// +checklocksignore` with a reason. It is pinned in `scripts/toolchain.json` and installed by `pnpm bootstrap` and `setup-toolchain` like golangci-lint.
- A struct with checklocks annotations declares one field per line. checklocks matches annotations to fields by position in the field list, so `a, b string` shifts every annotation after it onto the wrong field.

## Consequences

- The `go` job is back to about its old length, and pure numeric packages can grow tests without slowing it.
- A missed lock on an annotated field fails lint in seconds, locally as well as in CI, on paths the tests never run. A new field used under a lock is reported until it is annotated.
- A race in a package with no concurrency markers is not detected. Such a package cannot race on its own; if it is called from concurrent code, the caller's package is raced and the detector sees the access there.
- checklocks does not see tests, goroutine handoffs through channels, or fields nobody annotated; the race detector is still what covers those, where it runs.
- Going back to racing every package, or dropping the detector from CI, needs an ADR that supersedes this one.
