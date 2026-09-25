# 0041. Host bindings read the project-scoped services through one snapshot accessor

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

Attaching a project rebuilds seven service pointers on `Host` (`guide`, `manuscript`, `settings`, `teleprompter`, `transcript`, `tts`, `whisper`) under `h.mu.Lock()`. Before this decision 49 of the 65 Wails bindings plus `Bootstrap` read those pointers with no lock, so a project switch from the picker overlapping the UI's polling calls was a data race under the Go memory model. No user-visible failure was recorded (severity medium, latent), but nothing stopped the next binding, and several PRDs add bindings, from copying the pattern. The local gate could not catch it either: `go test -race` needs cgo, which the Windows developer machine does not have. The analysis and the per-binding count are in `docs/prds/host-binding-data-race.prd.md` (recover it with `git log --diff-filter=D -- docs/prds/host-binding-data-race.prd.md`; the PRD was deleted when the work was built, per [ADR 0028](0028-planned-work-is-specified-as-prds-and-deleted-when-built.md)). The owner adopted the PRD's recommendations for every open question (decision D22 of the implementation plan).

## Decision drivers

- A project switch overlapping the UI's polling calls was a data race under the Go memory model.
- Nothing stopped the next binding, and several PRDs add bindings, from copying the pattern.
- The local gate could not catch it: `go test -race` needs cgo, which the Windows developer machine does not have.
- The lock must never be held across a service call, because the `emit*` callbacks re-enter `h.mu.RLock()` and a recursive read lock behind a queued writer deadlocks.

## Considered options

1. One snapshot accessor, `h.services()`, copied under one `RLock` and used for the whole call
2. Keep the status quo: bindings read the service pointers with no lock
3. An `atomic.Pointer` to an immutable services struct

## Decision outcome

**Chosen option: one snapshot accessor, `h.services()`, copied under one `RLock` and used for the whole call**, because it removes the data race on a project switch without holding the lock across a service call, which can deadlock.

Every binding and helper reads the swappable services from one snapshot: `svc := h.services()` (`apps/desktop/services.go`). The accessor copies the seven pointers and the launch `config` into a `hostServices` value under one `RLock` and releases the lock before returning; the caller uses that one snapshot for the whole call and hands it to any goroutine that outlives the call. The lock is never held across a service call, because the `emit*` callbacks re-enter `h.mu.RLock()` and a recursive read lock behind a queued writer deadlocks (this is also why `Shutdown` stops the teleprompter before taking `h.mu`, [ADR 0022](0022-live-sidecar-events-over-wails-and-stop-file.md)).

The rule is enforced two ways. `apps/desktop/hostguard_test.go` parses the package with `go/parser` and fails plain `go test` (no cgo) when any function outside `configureLocked`, `canAttachLocked` and `services` selects one of the seven fields on a `Host`. `apps/desktop/hostrace_test.go` flips projects while goroutines call the read bindings and runs under `-race` in CI (the `go` job, on Windows). The guard was rolled out as a ratchet in four stacked pull requests (an allowlist with per-function read counts that could only shrink) and the allowlist was then deleted. [docs/architecture/host-binding-concurrency.md](../architecture/host-binding-concurrency.md) is the working description. The same change made `ProjectCreate` check that a switch would be accepted before it creates the folder, and require an absolute path.

Out of scope, on purpose: making `canAttachLocked` refuse a switch during a `Guide*` edit, import seeding or a just-started teleprompter session (issue #60), hoisting the TTS and Whisper managers out of `configureLocked` (owned by the release-readiness provisioning work), and adding `-race` to the local `pnpm check`. The host API and `hostAPIVersion` did not change.

### Consequences

- **Good:** A binding cannot read a swappable service unlocked and pass `go test`; a new binding written the obvious way (`h.guide`) fails locally with the file, line and function name.
- **Good:** One call sees one project. A switch that lands mid-call no longer mixes an old Story Bible with a new transcript service.
- **Bad:** Cost: an extra `RLock` and a small struct copy per call, negligible next to any service call.
- **Bad:** The guard matches on a receiver or parameter of type `Host` and a field name. A `Host` reached through another type (a struct field, an embedded `Host`) or returned from a function other than `NewHost` is not tracked, and nothing fails a call that takes two snapshots; the snapshot discipline covers those.
- **Neutral:** If `tts` and `whisper` leave the swappable set (manager hoisting), `hostServices` and `swappableHostFields` shrink together.
- **Neutral:** To change the approach (for example an `atomic.Pointer` to an immutable services struct, which would give the same safety without the lock but churns every test that assigns the fields), write a new ADR that supersedes this one.

### Confirmation

`apps/desktop/hostguard_test.go` fails plain `go test` (no cgo) when any function outside `configureLocked`, `canAttachLocked` and `services` selects one of the seven fields on a `Host`; `apps/desktop/hostrace_test.go` flips projects while goroutines call the read bindings and runs under `-race` in CI (the `go` job, on Windows).

## Pros and cons of the options

### An `atomic.Pointer` to an immutable services struct

- Good, because it would give the same safety without the lock.
- Bad, because it churns every test that assigns the fields.
