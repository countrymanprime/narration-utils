# DAW Port and Capabilities

**Source:** [Audiobook studio benchmark](../research/audiobook-studio-benchmark.md) §1 ("puts the audio engine behind a seam … the project model must not care which one it is talking to"), recommendations 1, 7 and 9, and the benchmark train ([agent train](../operations/agent-train.md)). **Extends:** [ADR 0143](../adr/0143-the-review-workflow-calls-a-daw-through-dawadapter-and-the-event-vocabulary-is-part-of-the-contract.md) (the `dawadapter.Review` seam) into one port for every DAW action. **Decision record:** [ADR 0300](../adr/0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md) (Proposed).

## Problem Statement

The app reaches a DAW through two routes. The review workflow uses a small interface, `dawadapter.Review` (ADR 0143). Everything else holds a concrete `*bridge.Client` or `*bridge.Actions`. That covers pickups, line identity, render config, cleanup tools, retake lanes, project state, navigation, chapter regions, take creation, reachability and the experimental transport commands, and these packages take the REAPER file bridge as a constructor argument. So:

- **A second DAW means editing every consumer.** Audacity (planned; [Audacity integration](audacity-integration.prd.md)) and a future built-in recorder ([native recording suite](native-recording-suite.prd.md)) cannot be added without touching a dozen services. They would also add `if daw == REAPER` branches, which the ADR 0143 seam was built to avoid (for example `app.go` checks `Classify(...) != KindREAPER`, and `dawfacts.go` compares against `"REAPER"`).
- **Callers cannot ask what the DAW supports.** There is no capability model. The UI works it out:
  - "Punch from here" is hard-coded disabled (`ReaderFlagsPanel.tsx`) and "Record in REAPER" is always disabled (`ReadingControlBar.tsx`).
  - Page gating reads two booleans, `dawFileLinked` and `dawReachable` (`apps/ui/src/dawAvailability.ts`).
  - The host signals "experimental and switched off" per call as a reason enum (`experimental_off`).
  - Audacity answers every request with one "not available yet" sentence (`dawadapter.ErrAudacityNotAvailable`).
- **One switch gates a dozen commands.** `DAW.experimental_reaper_actions` gates all twelve experimental commands together (`internal/bridge/actions.go` `experimentalCommands`). A narrator cannot turn on punch without also turning on FX chains. The benchmark's first recommendation ("switch on what is already built") has to promote commands one at a time, as each passes the owner's verification.

## Evidence

- `apps/desktop/internal/dawadapter/dawadapter.go`: the `Review` interface. Its comment says take management "is deliberately not here: it has no Audacity equivalent, so those services stay on the REAPER bridge client". That is a capability question answered by leaving things out of the interface.
- `apps/desktop/internal/dawadapter/daw.go`: `Kind`, `Classify`, `NotAvailableError`, and the `unavailable` stub.
- Consumers holding `*bridge.Client` directly, each with `New(config, client *bridge.Client, …)`:
  - `internal/{lineidentity,pickups,renderconfig,cleanuptools,retakelanes,projectstate}/service.go`
  - `internal/daw/reachability.go` `NewReachability`
- Host-level holders:
  - `bindings_navigation.go` (`bridge.NewNavigator`)
  - `app.go` (`bridge.NewActions`)
  - `readaloudreaper.go`, `teleprompterinput.go`, `chapterregions.go`, `internal/takereview/createtake.go`
- Narrow consumer-side interfaces already exist as test seams. These are the role interfaces this PRD promotes:
  - `reaperNavigator` (`bindings_navigation.go`)
  - `trackStateReader` (`readaloudreaper.go`)
  - `regionCreator` (`chapterregions.go`)
  - `bridgeClient` (`internal/takereview/createtake.go`)
- Gating: `bridge.Actions.allowed` returns `ErrExperimentalOff` before `ErrUnavailable`. The consumers map that to the reason `experimental_off` (`readaloudreaper.go`, `teleprompterinput.go`, `bindings.go`).
- Built, but with no binding and no gate: `CleanupClient` (`bridge/cleanup.go`) and `LevelMatchClient` (`bridge/levelnormalize.go`). The benchmark scorecard lists "Silence trim and level normalisation" as Partial.
- The benchmark: "A product that serves both modes keeps one project model … and puts the audio engine behind a seam. The engine is either the DAW, through a bridge, or a built-in recorder and renderer."

## Proposed Solution

One Go package, `apps/desktop/internal/dawport`, is the only way the host reaches an audio engine.

- **An adapter per engine** (REAPER now; Audacity and the built-in engine later) declares which capabilities it has and at what level. For each capability it has, it implements one small role interface.
- **A `Resolver`** combines three inputs into what is available now:
  - the adapter's declaration;
  - runtime state (reachability, standalone launch);
  - the narrator's per-capability toggles.
- **Callers get a role through the resolver.** `dawport.Role[T](resolver, capability)` returns the role, or a `*NotSupportedError` carrying the level and a sentence for the narrator.
- **The UI gets the same picture** from one binding, `DawCapabilities`, and one live event.

Adding a DAW is then a new adapter package plus one registry row, with no caller changes. A conformance suite that every adapter must pass keeps the adapters interchangeable.

## Key Hypothesis

If every DAW action goes through a role interface chosen by a resolver, then:

- adding the Audacity adapter and promoting each verified REAPER command becomes a change to one adapter or one declaration, not to a dozen services;
- the UI can enable, explain or hide every DAW control from one capability payload.

We will know it holds when:

- Audacity's adapter lands without editing any consumer package;
- turning on punch alone in Settings enables "Punch from here" and nothing else.

## What We're NOT Building

- The Audacity pipe client (Audacity PRD Phase 4, gated on the owner's spike). The Audacity adapter here only declares its capabilities, as `NotYetAvailable`.
- The built-in recorder or renderer (native recording suite and render-encode-master PRDs). They will be adapters on this port later.
- New REAPER commands or Lua changes. The bridge and its harness are untouched, and the adapter wraps what exists.
- Promoting any experimental command to supported. That is the booth actions enablement PRD's work (queued as wave 0b in the [agent train](../operations/agent-train.md)) after the owner's verification pass. This PRD makes promotion a one-line declaration change.
- Other providers (ASR, TTS, pronunciation, capture, encoders): see [provider ports](provider-ports.prd.md), which shares this PRD's `internal/port` vocabulary.
- UI primitives. `CapabilityGate` and `useCapability` are in [studio UI primitives](studio-ui-primitives.prd.md). This PRD provides the binding and moves the existing gating callers onto it.

## Success Metrics

| Metric | Target | How measured |
| --- | --- | --- |
| Packages holding `*bridge.Client` or `*bridge.Actions` outside `internal/bridge` and `internal/dawport/reaper` | 0 | A new architecture test (`dawport_boundary_test.go`) that parses imports |
| Adapters passing `dawporttest.Run` | REAPER, Audacity (declaration-only), the fake | `go test ./internal/dawport/...` |
| `if`/`switch` on `dawadapter.Kind` or the `"REAPER"` label outside `dawport` and the launch code | 0 new; the existing ones removed by P8 | grep in the boundary test |
| Behaviour change for a narrator with default settings | none | Existing Go, Vitest and harness suites pass unchanged in every phase |
| UI controls that decide DAW availability without the capability payload | 0 after P7 | `rg` on `dawAvailability` / hard-coded `disabled` in the gated components |

## Open Questions

Each question has a recommendation, which is adopted if the owner does not answer (D22 of the [implementation plan](implementation-plan.md)).

1. **Toggle values:** is it `auto | on | off` per capability, with `auto` meaning "on when Supported, off when Experimental"? *Recommendation: yes.* The old `DAW.experimental_reaper_actions = true` keeps working and means "every Experimental capability on `auto` is on".
2. **Should `off` on a Supported capability hide its controls, or disable them with a reason?** *Recommendation: disable with the reason "Turned off in Settings".* Hiding would move layouts around, and the visual suite pins them.
3. **Are capability changes pushed or polled?** *Recommendation: pushed.* One `daw_capabilities_changed` event whenever the resolver's answer changes (heartbeat reachability, a settings save, a project switch). The UI also reads the current value on mount.

## Users & Context

- **Narrators** see DAW controls that are enabled, disabled with a reason, or marked experimental, and they choose per action what to switch on.
- **Contributors adding a DAW** implement roles and a declaration, and pass the conformance suite.
- **Parallel agent workers** (the [agent train](../operations/agent-train.md)): after P4 lands, the consumer migrations (P5a–P5d) are file-disjoint and run at the same time.

## Solution Detail

### Core capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | The shared vocabulary in `internal/port`: `Level` (`Unsupported`, `NotYetAvailable`, `Experimental`, `Supported`), `Support{Level, Reason}`, and `NotSupportedError`, with a message for the narrator and `Is` support. Provider ports P2 adds the generic `Registry[P]` beside them |
| Must | `dawport.Adapter` (`Kind()`, `Declares() map[Capability]port.Level`), the role interfaces below, `Resolver`, and `Role[T]` |
| Must | The conformance suite `dawporttest.Run(t, factory)` and a fake adapter in `dawporttest` |
| Must | The REAPER adapter wrapping today's bridge types, with declarations matching today's behaviour exactly |
| Must | Per-capability toggles, migrated from `experimental_reaper_actions` |
| Must | The `DawCapabilities` binding and `daw_capabilities_changed` event, with a Zod schema, a golden, a `wireContracts` row and a mock |
| Must | Every consumer moved from `*bridge.Client` to the role it uses |
| Should | The Audacity adapter as a declaration: everything `NotYetAvailable`, with ADR 0144's sentence as the reason |
| Should | The UI gating callers (nav `requiresDaw`, "Punch from here", "Record in REAPER", Settings' REAPER wording) read capabilities |
| Could | The offline `ProjectReader` role, so `.rpp` parsing (`internal/tracks`) sits behind the port and an Audacity `.aup3` reader can follow |

**Capabilities and roles.** P1 checks each row against the code before freezing it.

| Capability | Role interface | Today's implementation | REAPER level today |
| --- | --- | --- | --- |
| `review` | `ReviewSession` (today's `dawadapter.Review`) | `dawadapter.Reaper` | Supported |
| `navigate` | `Navigator` (go to, loop) | `bridge.Navigator` | Supported |
| `markers` | `MarkerWriter` | `Navigator.AddMarker`, `pickups` | Supported |
| `pickups` | `PickupList` | `internal/pickups` over the bridge | Supported |
| `line_identity` | `LineStamper` | `internal/lineidentity` | Supported |
| `render_config` | `RenderConfigurer` | `internal/renderconfig` | Supported |
| `take_create` | `TakeCreator` | `takereview/createtake.go` | Supported |
| `heartbeat` | `Heartbeat` (reachable, project match, change count) | `daw.Reachability` | Supported |
| `project_read` | `ProjectReader` (offline) | `tracks.Parse` | Supported |
| `track_state` | `TrackStateReader` | `Actions.ChapterTrackState` | Experimental |
| `record` | `Recorder` (arm, start, stop, on-ended) | `Actions.ArmOnly/RecordStart/RecordStop` | Experimental |
| `punch` | `Puncher` (punch to, play position) | `Actions.PunchTo/PlayPosition` | Experimental |
| `regions` | `RegionWriter` | `Actions.CreateRegions` | Experimental |
| `takes` | `TakeSelector` | `Actions.SetActiveTake` | Experimental |
| `fx_chains` | `FXManager` | `Actions.ListFXChains/ApplyFXChain/ListFX/AddTakeFX` | Experimental |
| `silence_trim` | `SilenceTrimmer` | `bridge.CleanupClient` | Experimental (built, not gated today) |
| `item_gain` | `GainAdjuster` | `bridge.LevelMatchClient` | Experimental (built, not gated today) |
| `retake_lanes`, `project_state` | folded into `take_create` / `heartbeat`, or their own rows if P1 finds they differ | `internal/retakelanes`, `internal/projectstate` | Supported |

### MVP scope

P1 to P6, plus P8. The DAW is then fully behind the port, and the UI can read capabilities. P7 moves the UI callers over once the `CapabilityGate` primitive exists.

### User flow

1. The narrator opens Settings, then DAW. Each capability is listed with its level, for example "Punch and roll: Experimental, Off". They switch punch to On.
2. The host saves `DAW.capability.punch = on`. The resolver recomputes and the host emits `daw_capabilities_changed`.
3. The teleprompter's "Punch from here" becomes enabled. "Apply FX chain" stays disabled with "Experimental: switched off in Settings".
4. When REAPER is closed, the heartbeat drops and every capability reports "REAPER is not running". The controls explain why, with no new copy per control.

## Technical Approach

**Feasibility: high.** Every role wraps code that exists and is tested. The narrow consumer interfaces show the shape is right.

**Architecture:**

```go
package port // apps/desktop/internal/port: shared by dawport and the provider ports
type Level int
const (Unsupported Level = iota; NotYetAvailable; Experimental; Supported)
type Support struct { Level Level; Available bool; Reason Reason; Message string }
type NotSupportedError struct { Capability string; Support Support } // Error() == Support.Message

package dawport
type Capability string
type Adapter interface {
    Kind() Kind                          // replaces dawadapter.Kind
    Declares() map[Capability]port.Level // static: the most this engine can do
    Role(Capability) any                 // the implementation, or nil
}
type Resolver struct{ /* adapter, runtime func() Runtime, toggles func(Capability) Toggle */ }
func (r *Resolver) Support(c Capability) port.Support
func (r *Resolver) All() map[Capability]port.Support
func Role[T any](r *Resolver, c Capability) (T, error) // *port.NotSupportedError when unavailable
```

- **SRP:**
  - an adapter only declares and implements;
  - the `Resolver` only combines declaration, runtime and toggles;
  - the settings store only stores.
- **OCP:** `dawport.Register(kind, factory)` from each adapter package, and the composition root picks the factory by `Kind`. `dawcatalog` keeps the download-page catalog. Its `Entry.ID` matches the adapter's `Kind` string, so the two lists agree.
- **LSP:** `dawporttest.Run(t, factory)` checks four things:
  - every capability declared `Experimental` or higher returns a non-nil role of the documented type;
  - every other capability returns `*NotSupportedError` with a non-empty narrator message;
  - no role call panics against a closed transport;
  - refusals map onto the existing reason enum.
- **ISP:** one role per capability, most with one to three methods. Consumers take the role, never the adapter.
- **DIP:** services take role interfaces in their constructors. The composition root (`configureLocked`) resolves them and passes them in. The `h.services()` snapshot holds the resolver, and `hostguard_test.go` gains its row.
- **Runtime reasons** reuse today's wire enum and extend it:
  - `standalone`, `not_running`, `experimental_off`, `failed` (existing);
  - `turned_off`, `not_yet`, `unsupported` (new).
  The payload carries both the reason and the message, so the UI never words a refusal itself.
- **Event contract:** requests go in and events come back, unchanged from ADR 0143. Roles that answer asynchronously keep today's run-ID and answer-set mechanics (`bridge.Actions.request`).
- **Wire:**
  - The payload shape: `DawCapabilities() → {daw: "REAPER"|"Audacity"|"none", reachable, capabilities: {<cap>: {level, available, reason?, message?}}}`.
  - The event `daw_capabilities_changed` carries the same payload.
  - Schema `apps/ui/src/api/schemas/daw.ts`, contract `api/contracts/daw.ts`, golden `tests/fixtures/contracts/daw-capabilities*.json`, a row in `wireContracts.test.ts`, and a mock in `api/dawMock.ts` (a per-domain mock module, not `mockApi.ts`'s body).
  - `hostAPIVersion` bump.

**Risks:**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A migration changes behaviour silently | Medium | Each P5 PR changes constructors only. The package's existing tests must pass unmodified, plus one test that its role comes from the resolver |
| `Role[T]`'s `any` loses type safety | Low | The conformance suite checks the concrete type per capability. `Role` is the only type assertion, and it is tested |
| Resolver recomputed on every heartbeat is noisy | Low | The event is emitted only when the computed map changes (a deep-equal on the snapshot) |
| Toggle migration surprises a narrator who had the old switch on | Low | The old key maps to "all Experimental on" and is read until P8 removes it, recorded in ADR 0300 |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Port vocabulary and contracts | `internal/port`; `internal/dawport` types, role interfaces, `Resolver`, `Role[T]`; `dawporttest` fake and conformance suite. No callers | complete: `internal/dawport` (#621), the `dawporttest` conformance suite (#624), and the shared vocabulary in `internal/port` with `dawport`'s names aliased onto it (`feat/dawport-p1-internal-port`) | Runs alongside provider-ports P1 (Python only); provider-ports P2 waits for this phase's `internal/port` | none | |
| 2 | REAPER and Audacity adapters | `dawport/reaper` wraps the bridge types; `dawport/audacity` declares all `NotYetAvailable`; registry; both pass `dawporttest.Run` | pending | no | 1 | |
| 3 | Per-capability toggles | `DAW.capability.<name>` rows (append-only in `config/defaults.json`, `settings/store.go`), the resolver reads them, `experimental_reaper_actions` mapped; `bridge.Actions` gating delegates to the resolver | pending | no | 2 | |
| 4 | Capabilities on the wire | `DawCapabilities` binding and `daw_capabilities_changed` event; schema, golden, `wireContracts` row, mock; `hostAPIVersion` + 1; Settings lists capabilities with their toggles | pending | no | 3 | |
| 5a | Migrate navigation and transport consumers | `bindings_navigation.go`, `readaloudreaper.go`, `teleprompterinput.go`, `chapterregions.go` take roles | pending | with 5b, 5c, 5d | 4 | |
| 5b | Migrate marker and pickup services | `internal/pickups`, `internal/lineidentity`, `internal/renderconfig`, `internal/cleanuptools` (plus wiring `SilenceTrimmer`/`GainAdjuster`) take roles | pending | with 5a, 5c, 5d | 4 | |
| 5c | Migrate take and state services | `internal/retakelanes`, `internal/projectstate`, `internal/takereview`, `internal/daw` reachability behind `Heartbeat` | pending | with 5a, 5b, 5d | 4 | |
| 5d | Review and offline reading | `internal/transcript` onto `ReviewSession`; `ProjectReader` over `internal/tracks` for its callers (`tracks.go`, `chapterlinks.go`, `recordedlengths.go`, `internal/{editing,coverage,character}`) | pending | with 5a, 5b, 5c | 4 | |
| 6 | Boundary test | `dawport_boundary_test.go`: no `*bridge.Client` / `*bridge.Actions` outside `bridge` and `dawport/reaper`; no `Kind` or `"REAPER"` branching outside `dawport` and launch code; remove `app.go`'s `KindREAPER` check and `dawfacts.go`'s label compare | pending | no | 5a–5d | |
| 7 | UI callers on capabilities | Nav `requiresDaw`, "Punch from here", "Record in REAPER" and Settings' REAPER wording read `useCapability`; `dawAvailability.ts` reduced to a capability adapter | pending | no | 4, studio-ui-primitives CapabilityGate phase | |
| 8 | Steady state | Update `docs/architecture/daw-integration.md` (the seam table becomes the capability table), the threat model row for `--daw` and the new toggles, `SECURITY.md` if needed; retire `internal/dawadapter`; accept ADR 0300; delete this PRD | pending | no | 6, 7 | |
| 9 | Live transport state (Should) | The `Heartbeat` role also reports play and record state; the resolver emits `daw_transport_changed` (`{playing, recording, position?}`) with schema, golden, `wireContracts` row and mock, so the UI can keep the booth silent while recording ([input commands and pedals](input-commands-and-pedals.prd.md) P10) without a click-refreshed read (`ReadAloudReaperState.recording`, ADR 0249) | pending | with 5a–5d | 4 | |

### Phase details

- **P1 (lane K, Opus).**
  - Types only, plus the resolver and the conformance suite, all test-first:
    - table tests for the resolver: declaration × runtime × toggle gives an expected `Support`;
    - the suite run against the fake.
  - `internal/port` is created here and is the only shared file with [provider ports](provider-ports.prd.md).
  - Validate: `go test ./internal/port/... ./internal/dawport/...`, `go vet`, checklocks.
- **P2 (lane K, Opus).**
  - Adapters wrap; they don't rewrite. Declarations copy `experimentalCommands` exactly.
  - `CleanupClient` and `LevelMatchClient` are declared `Experimental`. They were never gated because they were never wired.
  - Validate: the conformance suite on both adapters, and the existing `internal/bridge` tests unchanged.
- **P3 (lane K with lane A's settings files, Opus).**
  - Settings rows are append-only.
  - `bridge.Actions.allowed` keeps `ErrExperimentalOff` as the error value, so every consumer's reason mapping is untouched.
  - Validate: settings store tests; Actions tests with the resolver injected.
- **P4 (lane K, Opus).**
  - This follows the wire contract rules in CLAUDE.md in full.
  - The Settings rows render through the existing host-provided field mechanism (`api.settingsForScope`), so no new UI component is needed.
  - Validate: `UPDATE_CONTRACTS=1` goldens, `wireContracts.test.ts`, the Settings visual states for DAW.
- **P5a–P5d (lane B, Sonnet, with an Opus review).**
  - Constructor changes and wiring in `configureLocked` only.
  - Each P5 PR also edits `app.go`'s wiring lines for its services. Those edits are on different lines, and the coordinator merges them in order.
  - Validate: the package's existing tests unchanged, plus `go test` of the host package.
- **P6 (lane K).** Deleting the two label branches is the only behaviour-visible code removal, and it is covered by the existing standalone and Audacity launch tests.
- **P7 (lane C, Sonnet).**
  - It uses the primitive from [studio UI primitives](studio-ui-primitives.prd.md).
  - Visual suite states for the gated pages at every viewport; aria snapshots if the navigation's role tree changes.
- **P8 (lane D, Haiku or Sonnet).** Documentation and bookkeeping.

### Parallelism notes

- P1 to P4 are the critical path, and they run one at a time in lane K.
- P5a, P5b, P5c and P5d are file-disjoint apart from their wiring lines in `app.go`, so they run as four workers at once.
- P7 waits for the primitives PRD's `CapabilityGate` phase, which can run in parallel with P5.

### Parallel-session compatibility

| Phase | Files it touches | Collides with |
| --- | --- | --- |
| 1 | `apps/desktop/internal/port/**`, `internal/dawport/**` (new) | provider-ports P2 (on `internal/port`, so provider-ports P2 waits) |
| 2 | `internal/dawport/reaper/**`, `internal/dawport/audacity/**` (new) | none |
| 3 | `config/defaults.json`, `internal/settings/store.go`, `internal/bridge/actions.go`, `internal/dawport/resolver.go` | any phase adding a settings row (append-only; the coordinator merges) |
| 4 | a new `apps/desktop/bindings_daw.go`, `app.go` (`hostAPIVersion`), `app_test.go`, `apps/ui/src/hostApi.ts`, `api/contracts/daw.ts`, `api/schemas/daw.ts`, `api/dawMock.ts`, `wireContracts.test.ts`, `tests/fixtures/contracts/daw-capabilities*.json`, regenerated `Host.*` | any phase that bumps `hostAPIVersion` |
| 5a | `bindings_navigation.go`, `readaloudreaper.go`, `teleprompterinput.go`, `chapterregions.go`, `app.go` wiring lines | 5b–5d on `app.go` only |
| 5b | `internal/{pickups,lineidentity,renderconfig,cleanuptools}/**`, `app.go` wiring lines | 5a, 5c, 5d on `app.go` only |
| 5c | `internal/{retakelanes,projectstate,takereview,daw}/**`, `app.go` wiring lines | 5a, 5b, 5d on `app.go` only |
| 5d | `internal/transcript/**`, `internal/tracks/**` callers, `app.go` wiring lines | 5a–5c on `app.go` only |
| 6 | `internal/dawport/boundary_test.go`, `app.go`, `dawfacts.go` | none after 5 |
| 7 | `apps/ui/src/dawAvailability.ts`, `components/layout/AppShell.tsx` (`NAV`, one at a time train-wide), `components/teleprompter/ReaderFlagsPanel.tsx`, `ReadingControlBar.tsx`, `components/settings/Settings.tsx`, `tests/visual/**` rows | any other `AppShell.tsx` change |
| 9 | `internal/dawport/**`, a new binding file for the event, `api/contracts/daw.ts`, `api/schemas/daw.ts`, `api/dawMock.ts`, `wireContracts.test.ts`, goldens | 4 on the same schema files (so 9 waits for 4) |
| 8 | `docs/architecture/daw-integration.md`, `docs/architecture/threat-model.md`, `SECURITY.md`, `docs/adr/0300-*`, `internal/dawadapter/**` (deleted) | none |

## Decisions Log

| # | Decision | Date |
| --- | --- | --- |
| D1 | One port, `internal/dawport`, for every DAW action; `dawadapter.Review` becomes its `ReviewSession` role (ADR 0300, extending ADR 0143) | 2026-09-26 |
| D2 | Capabilities have four levels (`Unsupported`, `NotYetAvailable`, `Experimental`, `Supported`). What is available now is computed by one `Resolver`, and adapters never decide it | 2026-09-26 |
| D3 | The shared vocabulary lives in `internal/port`, so the provider ports use the same levels and error | 2026-09-26 |
| D4 | No behaviour change for a narrator on default settings until booth actions enablement promotes a declaration | 2026-09-26 |

## Research Summary

- **In the code (2026-09-26):** 12+ consumers hold the concrete bridge client. Four narrow consumer-side interfaces already exist as test seams. `experimentalCommands` has 12 entries. `CleanupClient` and `LevelMatchClient` have no non-test callers. The one existing seam is ADR 0143's `Review`.
- **In the benchmark:** competitors either export a marker file once (Pozotron), hand over a finished project (Narrafix) or replace the DAW (Punch Track). The live two-way link is this app's strongest position. It depends on DAW actions being first-class and explainable, which is what capabilities make possible.
