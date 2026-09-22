# Host binding concurrency

How the desktop host keeps a project switch from racing the Wails bindings. Implemented in `apps/desktop/services.go`, enforced by `apps/desktop/hostguard_test.go` and `apps/desktop/hostrace_test.go`; the decision is [ADR 0041](../adr/0041-host-bindings-read-project-services-through-one-snapshot-accessor.md).

## The problem it solves

`Host` owns five project-scoped services: the manuscript, Story Bible (`guide`), settings, transcript and teleprompter services. (The asset managers are not among them: the voice and Whisper managers live in a registry that is built once, [ADR 0079](../adr/0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md).) Attaching a project (the picker, "open recent", a REAPER second launch) rebuilds all of them in `configureLocked` and reassigns the fields under `h.mu.Lock()`. Wails runs each binding on its own goroutine, and the UI polls several of them (`GuideBuildState`, `TtsInstallState`, `TranscriptLastCompleted`) while the user switches projects, so a binding that reads `h.guide` without the lock races with the switch: a data race under the Go memory model, which can hand a call the previous project's service or a half-published one. `h.recents` and `h.sidecars` are set once in `NewHost` and never reassigned, so they are read directly.

## The rule

A binding, or any helper a binding calls, reads the swappable services through one snapshot:

```go
func (h *Host) GuideRescan(id string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, service.Rescan(id))
}
```

- `h.services()` returns a `hostServices` value: the five service pointers and the launch `config`, copied under one `RLock` and released before it returns. A service can legitimately be nil, so the nil checks stay.
- Take **one** snapshot per call and use it throughout. A call that needs several services (`GuidePreview` uses guide and settings, and reads the voice manager from `h.registry()`; `TranscriptSuggestHints` uses guide and transcript) then sees one project even when a switch lands mid-call. Do not mix `svc.guide` with a second `h.services().transcript`. `svc.config` carries the launch config, so the project folder and the settings store of one call belong to the same project.
- Pass the snapshot, or the one service, to goroutines that outlive the call: the TTS and Whisper install goroutines, the Story Bible build, the post-commit character seeding. Never re-read the field inside them.
- **Never hold `h.mu` across a service call, and never call `services()` while holding it.** The `emit*` callbacks (`emitTranscript`, `emitTeleprompterEvent`, `emitTeleprompterState`) take `h.mu.RLock()`, and a service reports progress through them from inside its own calls; a held read lock plus a queued writer (a project switch) plus that re-entrant read lock is a deadlock. `Shutdown` stops the teleprompter before it takes `h.mu` for the same reason ([ADR 0022](../adr/0022-live-sidecar-events-over-wails-and-stop-file.md)). Under the write lock (`configureLocked`, `attachProjectLocked`, `ProjectSwitch` and `onSecondInstance` between `Lock` and `Unlock`) `services()` would deadlock on itself, so use `h.config` there or take the snapshot before locking.
- New bindings, and every PRD that adds one, build on `h.services()`. There is no other accessor.

## What enforces it

- **`hostguard_test.go`** parses the non-test sources of package `main` with `go/parser` and fails `go test` when a function selects `guide`, `manuscript`, `settings`, `teleprompter`, `transcript`, `tts` or `whisper` on a `Host`: through its receiver, a `*Host` parameter (closure parameters and package-level closures too), `(*h).x`, or a local alias (`x := h`, `x := NewHost()`, `x := &Host{}`). It runs in plain `go test`, so it bites on a developer machine that cannot run the race detector. The only exceptions are `permanentDirectReaders`: `configureLocked` (the writer; its caller holds `h.mu`), `canAttachLocked` (its caller holds the lock) and `services` itself. Fixtures inside the test prove the guard fires, a second test fails on a `services()` call from an unexported `...Locked` function, and a third keeps `configureLocked`, the `Host` struct, `swappableHostFields` and the `hostServices` struct in agreement (a new field that `configureLocked` reassigns must be added to all of them, or the test fails).
- **`hostrace_test.go`** flips `ProjectSwitch` between two temp projects while goroutines loop over the read bindings, one transcript-loop tick and the emit callbacks (`stressReaders`), against empty per-user directories. CI's `go` job runs it under `go test -race` (Windows); on a machine without cgo it is a smoke test. Each row loops until the switching run ends, and a watchdog turns a deadlock into a failure. Add a row for every new binding that reads a service, with arguments that fail fast (an unknown id, an uninstalled model) so it does no real work. Measured on the unconverted code in CI (every direct-read binding in `stressReaders`, `go test -race`), 20 of 20 separate test processes reported the race, naming `TranscriptCancel`, `TtsCatalog`, `GuidePreview`, `SystemSettingsForScope`, `Bootstrap` and others. Measure with separate processes: the detector reports each racing pair once per process, so `-count=20` in one process shows only about half the runs failing.
- **`services_test.go`** covers the accessor: it returns what the host is using, a snapshot survives a later switch unchanged, and the lock is released before it returns.

The guard was introduced as a ratchet: every function that still read a field directly was listed in an allowlist, with its read count, that could only shrink while the bindings were converted in domain-by-domain pull requests; the last one deleted it.

## Adding a binding

1. Start the body with `svc := h.services()` (or `service := h.services().guide` when one service is enough) and use it, and `svc.config`, only.
2. Add a row to `stressReaders` in `hostrace_test.go` if it reads a service.
3. Never call a service while holding `h.mu`; never re-read a field in a goroutine.
4. Run `go -C apps/desktop test ./...`. A direct `h.guide` read fails `TestHostReadsSwappableServicesOnlyThroughTheAccessor` with the file, line and function.

## Related rules in the host

- `ProjectCreate` checks that a switch would be accepted (`canAttach`, a read-locked pre-check) before it creates the folder, and requires an absolute path. `ProjectSwitch` asks again under the write lock, so a lost race at worst leaves an empty folder. A refused create reports the same `switched: false` result and `system:attached` event as a refused switch.

## Known limits

- **A switch is not refused while a `Guide*` edit, the post-commit character seeding or a just-started teleprompter session is in flight.** `canAttachLocked` covers import drafts, Story Bible, TTS and Whisper jobs, the transcript and the teleprompter (its `Busy()`) only. The snapshot means such a call finishes against the project it started on, but the switch is still allowed; tracked in issue #60.
- **`SystemSaveSettings` takes two snapshots** (`saveSettings`, then `Bootstrap` for the reply); a switch between them saves to one project and answers with the next.
- **The guard is syntactic.** It does not follow a `Host` reached through another type (a struct field, an embedded `Host`) or returned from a function other than `NewHost`; the snapshot discipline covers those. Nothing fails a function that calls `services()` twice.
- **The asset managers are not rebuilt on an attach.** They were hoisted out of `configureLocked` ([ADR 0079](../adr/0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md)): `Host.assets` is set once in `Startup` and read with `registry()`, and `tts` and `whisper` left `hostServices` and `swappableHostFields`.
- **No local `-race`.** `pnpm check` runs `go test ./...` without `-race`, on purpose: the local gate stays portable and the guard covers the common regression. CI's `go` job runs the detector.
- An `atomic.Pointer` to an immutable services struct would give the same safety with less locking, at the price of rewriting every test that assigns the fields directly; it was not needed.
