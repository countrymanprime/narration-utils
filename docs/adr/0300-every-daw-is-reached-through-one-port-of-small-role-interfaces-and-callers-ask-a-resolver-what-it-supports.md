# 0300. Every DAW is reached through one port of small role interfaces, and callers ask a resolver what it supports

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:** none. It extends [ADR 0143](0143-the-review-workflow-calls-a-daw-through-dawadapter-and-the-event-vocabulary-is-part-of-the-contract.md), whose `Review` interface becomes one role of the port.

## Context

ADR 0143 put the review workflow behind `dawadapter.Review`. Every other DAW action still goes through a concrete `*bridge.Client` or `*bridge.Actions`:

- pickups, line identity, render config, cleanup tools, retake lanes, project state, navigation, chapter regions, take creation, reachability;
- the twelve experimental transport commands.

Nothing tells a caller which of these a given DAW can do. The UI works it out from `dawFileLinked`/`dawReachable` and from hard-coded disabled buttons. One setting, `DAW.experimental_reaper_actions`, gates all twelve experimental commands at once.

The [audiobook studio benchmark](../research/audiobook-studio-benchmark.md) recommends two things. First, switch on the built REAPER commands one at a time as each is verified. Second, keep the audio engine behind a seam, so REAPER, Audacity and a later built-in recorder serve the same screens. The owner asked for a DAW interface that any DAW can implement, with configuration and toggles that tell callers what the chosen DAW supports ([DAW port PRD](../prds/daw-port-and-capabilities.prd.md)).

## Decision

**The port:**
- `apps/desktop/internal/dawport` is the only way the host reaches an audio engine.
- An adapter (`dawport/reaper`, `dawport/audacity`, later the built-in engine) declares a `port.Level` per `Capability`: `Unsupported`, `NotYetAvailable`, `Experimental` or `Supported`.
- For each capability it has, the adapter implements one small role interface: `Navigator`, `MarkerWriter`, `Recorder`, `Puncher`, `RegionWriter`, `ReviewSession` and so on.

**The resolver:**
- `dawport.Resolver` alone decides what is available now. It combines three inputs:
  - the declaration;
  - runtime state (standalone launch, heartbeat);
  - per-capability settings `DAW.capability.<name>` = `auto | on | off`.
- `dawport.Role[T]` returns the role, or a `*port.NotSupportedError` carrying the level, a reason from the wire enum, and a sentence for the narrator.

**Callers:**
- Services take roles in their constructors, and the composition root resolves them.
- No package outside `internal/bridge` and `dawport/reaper` holds a bridge client, and no code outside `dawport` and the launch path branches on the DAW's kind or label. A boundary test enforces both.

**Adapters stay interchangeable:**
- Every adapter must pass `dawporttest.Run`.
- The shared types live in `internal/port`, and the provider ports reuse them.

**The UI** reads the resolver's full answer from the `DawCapabilities` binding and the `daw_capabilities_changed` event.

**The old switch:** `DAW.experimental_reaper_actions` keeps working until the port's last phase. It means "every Experimental capability left on `auto` is on".

## Consequences

**Easier:**
- A new DAW is an adapter package and a registry row.
- Promoting a verified REAPER command is a one-line declaration change, from `Experimental` to `Supported`.
- The UI explains every disabled DAW control from one payload.

**Harder:**
- Every DAW action gains a role interface and a conformance case.
- The constructor of each migrated service changes, touching `configureLocked`'s wiring once per service group.

**Given up:** consumers can no longer reach bridge features that are not declared as a capability. A new REAPER command has to be declared before any service can use it.

**Overriding this** needs a new ADR that supersedes this one. Adding a capability or a level does not; that is a normal change under this decision.
