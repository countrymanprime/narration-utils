# 0304. bridge.Actions asks a per-command gate, and the DAW port's resolver answers it from the per-capability settings

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:** none. It amends how [ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md) is enforced (the experimental commands are still refused by the host before anything is written) and fills in the per-capability toggles of [ADR 0300](0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md), built in Phase 3 of the [DAW port PRD](../prds/daw-port-and-capabilities.prd.md).

## Context

`bridge.Actions` checked `DAW.experimental_reaper_actions` itself before sending any of its twelve experimental commands. ADR 0300 moves that decision to the DAW port's `Resolver`, which combines the adapter's declaration, the runtime and the narrator's per-capability toggles (`DAW.capability.<name>`: `auto`, `on` or `off`). If `Actions` kept its own check, there would be two answers to "may this be sent", and turning punch on alone would still be refused by `Actions`.

Three constraints shape how `Actions` asks:

- `internal/bridge` cannot import `internal/dawport`, which imports it.
- `Actions` knows commands; the resolver knows capabilities. Something has to map one to the other.
- The REAPER adapter builds its `Actions` before the composition root builds the resolver over that adapter.

The resolver's `Support` also checks the runtime (no bridge, REAPER not answering). `Actions` never did: a permitted command went out and failed on its own terms (`ErrUnavailable`, `ErrNoAnswer`). Gating on the full `Support` would change that.

## Decision

- `bridge.Actions` takes a `bridge.Gate`, `func(command string) error`, and asks it about each command before writing anything. A nil gate refuses everything with `ErrExperimentalOff`. A refusal matching `ErrExperimentalOff` reaches the caller as that value, so every consumer's reason mapping is unchanged; any other refusal is passed on. `Actions` no longer reads a setting.
- `Resolver.Allowed(c)` is the declaration and settings half of `Support`: nil, or the same `*NotSupportedError` that `Support` would give. It ignores the runtime, so a permitted command still behaves as before when REAPER is closed.
- The command-to-capability map lives in the REAPER adapter (`dawport/reaper.Gate`). Every command `Actions` sends has a row, whether it is still Experimental or not, so promoting a command stays a one-line declaration change ([ADR 0400](0400-promoting-a-reaper-command-from-experimental-to-supported-is-a-one-line-daw-port-declaration-change.md)). An unknown command is refused as a bug.
- `dawport.Env.Experimental` becomes `Env.Allowed`, the launch's `Resolver.Allowed`. The composition root passes a closure over the resolver it builds from the adapter the factory returns.
- The settings are read through `dawport.SettingsToggles` and `dawport.SettingsExperimental` over `settings.Store.Effective`, on every call. An unknown or missing toggle value is `auto`. The old switch still means "every Experimental capability on `auto` is on", until Phase 8 retires it.
- Until Phase 5a moves the host's own `bridge.Actions` onto the adapter's roles, `app.go` gates it with a resolver over `reaper.Declaration()`: REAPER's declaration with no roles and no session. It is never registered and does not pass the conformance suite.

## Consequences

- There is one answer to "may this command be sent", the resolver's, and the `Settings` page (Phase 4) and the gate cannot disagree.
- Turning one capability on in Settings lets exactly its commands out (`TestTurningPunchOnAloneSendsPunchAndNothingElse`); `off` refuses a capability even while the old switch is on.
- A narrator on default settings sees no change: every row defaults to `auto`, and the old switch defaults off.
- A `turned_off` refusal reaches today's consumers as a plain error with the message "Turned off in Settings.". They show it as a failure until Phase 4 and the Phase 5 migrations map the new reasons. No narrator can hit this before Phase 4, because nothing in the UI writes the rows yet.
- `bridge`'s `experimentalCommands` map no longer refuses anything at run time. It stays as the list the `dawport/reaper` guard test holds the declaration to, so ADR 0400's two edits still land together, but the declaration is what the narrator sees.
- Harder: until Phase 5a there are two REAPER views in the host, the adapter and `reaper.Declaration()`. Phase 5a must remove the second one.
- Overriding this, for example to gate on the full `Support`, needs a new ADR that supersedes this one.
