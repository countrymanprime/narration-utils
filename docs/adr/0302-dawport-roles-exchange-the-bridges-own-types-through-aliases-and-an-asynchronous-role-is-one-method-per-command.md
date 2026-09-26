# 0302. DAW port roles exchange the bridge's own types through aliases, and an asynchronous role is one method per command

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:** none. It fills in the shapes [ADR 0300](0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md) left open. The [DAW port PRD](../prds/daw-port-and-capabilities.prd.md) asks Phase 1 to check its capability table against the code before freezing it.

## Context

ADR 0300 names the role interfaces but not what goes through them. Phase 1 (`apps/desktop/internal/dawport`) had to settle four things.

- **The types a role exchanges.** Today's callers pass `bridge.Target`, `bridge.TrackState`, `tracks.Project` and so on. Neutral copies of those types would mean converting in every adapter and in every consumer that moves onto a role. The P5 migrations are meant to change constructors only.
- **The shape of the services' roles.** Pickups, line identity, render config, cleanup tools, retake lanes, project state and take creation don't call typed methods. They call `client.Send("<command>", fields)` and then read the answer from events. A role that exposed `Send` would leak REAPER's command names into every engine.
- **Three rows the PRD left open.** Its table folds retake lanes and project state into other rows "or their own rows if P1 finds they differ", and it has no row for cleanup tools.
- **Which capabilities need a running engine.** The heartbeat is what reports whether the engine is answering, so it can't require one. `.rpp` parsing works with REAPER closed.

## Decision

**Value types are aliases.** `dawport` declares `Target = bridge.Target`, `Project = tracks.Project` and the rest, and callers name them through `dawport`. The REAPER adapter hands today's types through unchanged. When a second engine needs a neutral shape, the alias becomes a real type in `dawport` and no caller changes.

**Synchronous roles keep the concrete method sets.** `Navigator`, `MarkerWriter`, `Heartbeat`, `TrackStateReader`, `Recorder`, `Puncher`, `RegionWriter`, `TakeSelector`, `FXManager`, `SilenceTrimmer` and `GainAdjuster` have exactly the methods of `bridge.Navigator`, `daw.Reachability`, `bridge.Actions`, `bridge.CleanupClient` and `bridge.LevelMatchClient`. `roles_test.go` asserts this at compile time.

**An asynchronous role is one method per command, plus `Events`.** Each role follows ADR 0143's `Review` pattern: `ImportPickups(runID, payloadPath)`, `StampLines(runID, payloadPath, overwrite)`, `CreateTake(runID, payloadPath)` and so on. A method only asks, and the answer comes back as today's event tags. A P5 migration therefore also swaps each `Send("<command>", …)` line for the role's method, one line per command.

**Three rows of their own.** `cleanup_tools` (`CleanupLauncher`), `retake_lanes` (`RetakeLanePicker`) and `project_state` (`ProjectStateReader`) each send a different command and listen for a different answer, so none folds into another row. The catalog has 20 capabilities, and each role serves exactly one.

**A capability's runtime need is in the catalog.** `Needs` is one of three values:
- `NeedsRunning`: almost every capability.
- `NeedsBridge`: only `heartbeat`, which must stay usable while the engine is quiet.
- `NeedsNothing`: only `project_read`, which works offline.

**The resolver refuses in a fixed order:**
1. the declaration (`unsupported`, `not_yet`);
2. the settings (`turned_off`, `experimental_off`), as `bridge.Actions.allowed` does today;
3. the runtime (`standalone`, `not_running`).

**Refusal wording.** An adapter may implement `Explainer` to word its own refusals, for example Audacity's ADR 0144 sentence or REAPER's "open this app from the Narration Utils action". Otherwise the resolver's own sentence is used. An `experimental_off` refusal also matches `bridge.ErrExperimentalOff` under `errors.Is`, so today's reason mapping keeps working.

**The shared vocabulary lives in `dawport` for now.** `Level`, `Reason`, `Support` and `NotSupportedError` are declared in `dawport` until `internal/port` exists. That package belongs to other lane-K work. Moving the vocabulary there is a type alias in `dawport/vocabulary.go`.

## Consequences

**Easier:**
- The REAPER adapter (P2) is mostly a table of the existing types.
- The P5 migrations keep their types and tests.
- A refusal always carries a sentence.

**Harder:**
- `dawport` imports `bridge` for the aliases, so the port isn't engine-neutral at the type level yet. The boundary test (P6) forbids holding `*bridge.Client` or `*bridge.Actions`. It doesn't forbid naming a bridge value type through an alias.
- Each async role's methods must be kept in step with the Lua command's fields.

**Overriding this:** a new ADR is needed to replace the aliases with neutral types across the port, or to give a role a transport-level `Send`. Adding a capability row does not need one.
