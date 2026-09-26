# 0303. A DAW adapter factory is given the launch's environment and opens the engine's transport itself

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:** none. It fills in the registry that [ADR 0300](0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md) names (`dawport.Register(kind, factory)`) and the [DAW port PRD](../prds/daw-port-and-capabilities.prd.md) builds in Phase 2.

## Context

ADR 0300 has each adapter package register a factory, and has the composition root pick one by the launch's `Kind`. It does not say what a factory is given. There were two candidates:

- **The transport.** `app.go` makes the one `*bridge.Client` today and could hand it to the factory. But then `dawport`'s factory type names `*bridge.Client`. `dawport` would hold the client in its API, and the Phase 6 boundary test forbids any package outside `internal/bridge` and `dawport/reaper` from holding one. A future engine's transport (Audacity's pipe, the built-in recorder) is also not a `*bridge.Client`.
- **What the transport is made from.** The session directory, the old experimental switch and the host's log. The factory opens the connection itself, and the adapter owns it.

Two clients on one session directory would break the bridge: each starts its command counter at zero, so the second overwrites the first's command files. So there can only be one client per session, whoever makes it.

## Decision

- `dawport.Factory` is `func(dawport.Env) (dawport.Adapter, error)`. `dawport.Env` holds `SessionDir`, `Experimental` (the old `DAW.experimental_reaper_actions` switch, until Phase 3 moves the gating into the resolver) and `Log`. It holds no transport.
- `dawport.Register`, `Lookup` and `Registered` work on one package-level `dawport.Registry`. Each adapter package registers from `init`. Registering `KindNone`, a nil factory or a kind twice panics, because each is a programming error. Tests build their own registry with `NewRegistry`.
- The REAPER factory (`dawport/reaper.Factory`) opens `Env.SessionDir`'s bridge and wraps it. With no session directory it returns `reaper.ErrNoSession`, and the composition root runs with no adapter, which the resolver already reports as `standalone`.
- The Audacity factory (`dawport/audacity.Factory`) opens nothing, even when a session directory is passed. This matches today's rule that an Audacity launch never writes REAPER bridge commands.
- While the Phase 5 migrations run, `app.go` still makes the client for the consumers not yet moved. During that time it builds the adapter with `reaper.New(client, experimental)` over that same client, not through the registry. Phase 6 switches the composition root to `dawport.Lookup(kind)` once `app.go` no longer holds a client.
- One adapter per client. `reaper.New` subscribes each wrapped consumer (`bridge.Navigator`, `bridge.Actions`, `bridge.CleanupClient`, `bridge.LevelMatchClient`, `daw.Reachability`) once.

## Consequences

- `dawport` never names a transport in its API, so the boundary test can forbid `*bridge.Client` everywhere but `bridge` and `dawport/reaper`. A new engine's factory reads what it needs from `Env`, and a field is added there when an engine needs one.
- The adapter owns its connection, so there is exactly one bridge client per session once Phase 6 lands.
- Harder: until Phase 6 there are two ways to build the REAPER adapter, `reaper.New(client)` and `reaper.Factory(env)`. Using both on one session would give it two clients. The P5 wiring must use `reaper.New` over `app.go`'s client, and Phase 6 must remove it from the composition root.
- A factory that returns an error is not a crash. The launch runs standalone, as it does today when the session directory cannot be opened.
- Overriding this, for example to hand factories a live transport, needs a new ADR that supersedes this one.
