# 0143. The review workflow calls a DAW through `dawadapter.Review`, and the event vocabulary is part of the contract

**Status:** Proposed
**Date:** 2026-09-23

## Context

The [Audacity integration PRD](../prds/audacity-integration.prd.md) (Phase 3, and its Decisions Log row "Extract a `DAWAdapter` boundary before adding a second DAW") asks for a behaviour-preserving Go seam before any Audacity code lands, so that a second DAW is a second implementation rather than `if daw == "REAPER"` branches in the host and UI. Owner decision Q2 (2026-09-23) puts the Audacity pipe client in a new Go package behind that interface.

Before this change `apps/desktop/internal/transcript.Service` (the review workflow: prepare, inspect, navigate, export) wrote REAPER bridge commands by name (`prepare_compare`, `inspect_compare_results`, `jump_to_compare_marker`, `export_compare_markers`) on a `*bridge.Client`, and read results as `COMPARE_*` and `ERROR` events from that client's fan-out ([ADR 0068](0068-bridge-events-fan-out-to-subscribers-by-tag-and-run-and-every-error-names-its-run.md)). Six other consumers hold the same client for REAPER-only work: pickups, line identity, project state, render config, take creation and reachability.

Two shapes were weighed. A fully DAW-neutral interface with its own result types (a `PreparedAudio`, a `FindingState` per row) would move the `COMPARE_*` field parsing out of the service and into each adapter, which is a rewrite of the service's state machine, not an extraction, and would collide with the parallel lanes also editing `internal/bridge` and the transcript service. Wrapping only the commands, and keeping the events as the bridge already defines them, changes no behaviour and no line on the bridge.

## Decision

`apps/desktop/internal/dawadapter` defines `Review`: `PrepareReview`, `InspectFindings`, `NavigateToFinding`, `ExportFindings` (with `MarkerColors` the host resolves from settings), plus `Subscribe` and `Dispatch`. `dawadapter.Event` and `dawadapter.Subscription` are type aliases of the bridge's, and the event tags and fields the review workflow reads (`COMPARE_PREPARED`, `COMPARE_MARKER`, `COMPARE_INSPECTED`, `COMPARE_EXPORT_MARKER`, `COMPARE_EXPORTED`, `ERROR`, as tabled in `internal/bridge/wire.go`) are part of the interface's contract: another DAW's adapter reports its results as those same events. `dawadapter.Reaper` is the first implementation, one bridge command per method; `dawadapter.ReviewFor(nil)` is a nil `Review`, never a non-nil interface wrapping a nil client.

`transcript.Service` holds a `dawadapter.Review`. `transcript.New(…, *bridge.Client, …)` keeps its signature and wraps the client; `transcript.NewWithReview` takes any adapter. Only the review workflow goes through the interface: take management and the other REAPER-only services keep `*bridge.Client`, because they have no Audacity equivalent (`docs/architecture/daw-integration.md`, "Audacity boundary").

## Consequences

- The REAPER path is unchanged on the wire (`internal/dawadapter/reaper_test.go` pins each command line byte for byte) and every existing bridge, transcript and harness test passes unmodified.
- The Audacity client (PRD Phase 4 onward) implements four request methods and translates its pipe replies into the `COMPARE_*` events, instead of the transcript service growing a second code path. That translation is the cost: an adapter must produce REAPER-shaped events, including fields such as `projectTime` and `itemIndex` that Audacity will fill from its own model.
- "Mark reviewed" and "export the reviewed set" (PRD Phases 7 and 8) have no REAPER command today; `InspectFindings` (a finding already carried as a marker) is the only reviewed-state signal. Those phases add methods to `Review` with a REAPER implementation, or a narrower interface, when they land.
- A future change that makes the events DAW-neutral types, or that moves another service behind an adapter, supersedes this ADR.
