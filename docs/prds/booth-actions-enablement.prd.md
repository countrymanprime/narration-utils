# Booth Actions Enablement: Promoting Punch, Record, Regions and Cleanup from Experimental to Declared

**Source:** [Audiobook studio benchmark](../research/audiobook-studio-benchmark.md) recommendation 1 ("switch on what is already built... this is the cheapest large gain, because the harness tests already exist") and the benchmark train plan ([agent train](../operations/agent-train.md), wave 0). **Depends on:** [DAW Port and Capabilities](daw-port-and-capabilities.prd.md) (ADR 0300, Proposed) for the declaration and resolver mechanism this PRD promotes commands through, and [Studio UI Primitives](studio-ui-primitives.prd.md) (ADR 0360, Proposed) for `CapabilityGate` and `useCapability`. **Reconciles:** [Read Aloud Control Bar](read-aloud-control-bar.prd.md) Phase 7 (Record in REAPER), [Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) Phase 12 (Punch and roll), and [REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) Phase 11 (per-chapter render regions) into one promotion path. **Decision record:** ADR 0400 (Proposed, this PRD).

## Problem Statement

Twelve REAPER bridge commands are already built, harness-tested, and switched off behind one blanket setting, `DAW.experimental_reaper_actions` (`apps/desktop/internal/bridge/actions.go:44-56`). Two more capabilities are built with no gate and no caller at all. Three different PRDs each own a slice of the UI that would let a narrator use them, and each slice is stalled on the same owner step:

- **Record with reading** ([Read Aloud Control Bar](read-aloud-control-bar.prd.md) Phase 7): `arm_only`, `record_start`, `record_stop` exist in `integrations/reaper/narration_transport.lua` and `bridge.Actions`, but that PRD's own phase table calls Phase 7 "pending — no lane has queued the Lua/Go half yet", written before the commands existed. Today the gap is the opposite: the bridge half is built and harness-tested, but the toggle, the first-time confirm (Q7-Q9) and the Play/Stop orchestration are not.
- **Punch from here** ([Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) Phase 12): `punch_to` and `play_position` are built (`ADR 0246`, Proposed), with a Go client (`bridge.Actions.PlayPosition`/`PunchTo`) and 8 harness tests, but the phase is "partial": "host anchors, setting and UI remain". `ReaderFlagsPanel.tsx:20,109-113` hard-codes `PUNCH_PENDING` and renders "Punch from here" always disabled.
- **Chapter regions** ([REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) Phase 11, and `create_regions` itself in the experimental list): the Lua and Go bindings exist, but "the 'Create chapter regions…' dialog that calls these bindings and its visual states" is not delivered (`reaper-automation-follow-through.prd.md:274`), so no narrator can reach the command.
- **Silence trim and level normalize**: `bridge.CleanupClient` and `bridge.LevelMatchClient` (`apps/desktop/internal/bridge/{cleanup.go,levelnormalize.go}`) have zero non-test callers anywhere in `apps/desktop` — no binding, no gate, no UI. This is a REAPER-item gain-match path, distinct from the WAV-file level normalize the diagnostics PRD delivered under ADR 0252 (which never touches a REAPER project). The benchmark's scorecard lists this row "Partial: built in the bridge, with no binding or UI".
- **Chapter track state**: `chapter_track_state` shipped a binding and UI (`ReadAloudReaperState`, ADR 0249) but stays on the experimental list pending the same owner verification pass as the others.

Each of these four command groups is promoted the same way, defined in `docs/operations/reaper-verification-pass.md`'s "Switching a command on" section: run the row, record it, take the command off `experimentalCommands`, mark the phase complete. That mechanism predates the DAW port PRD and promotes by editing a Go map and updating prose in up to three PRDs by hand. The DAW port PRD replaces the map with a resolver that reads a per-capability `Level` from an adapter's `Declares()`, and says explicitly that "promoting any experimental command to supported... is the booth actions enablement PRD's work... after the owner's verification pass. This PRD makes promotion a one-line declaration change." Nothing yet does that reconciling: the map and the port would otherwise disagree about which commands are on.

## Evidence

Verified in code (main at `48a882d`):

- `apps/desktop/internal/bridge/actions.go:44-56`: `experimentalCommands` lists exactly `chapter_track_state`, `arm_only`, `record_start`, `record_stop`, `set_active_take`, `list_fx_chains`, `apply_fx_chain`, `list_fx`, `add_take_fx`, `create_regions`, `play_position`, `punch_to`. `Experimental(command string) bool` and `ErrExperimentalOff` are the two exported surfaces other packages read.
- `integrations/reaper/narration_transport.lua`, `narration_punch.lua`, `narration_regions.lua` implement the write side; `narration_line_identity.lua` and `narration_take_review.lua` implement `set_active_take` and the FX commands. All are registered per [ADR 0067](../adr/0067-bridge-commands-are-registered-by-name-and-each-feature-lives-in-its-own-lua-file.md) and covered by the harness ([ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)).
- `apps/desktop/internal/bridge/{cleanup.go,levelnormalize.go}`: `CleanupClient` and `LevelMatchClient` exist, subscribe to their events, and have complete unit tests, but a repository-wide search finds no non-test caller in `apps/desktop`. No binding, no host wiring, no setting.
- No UI reference anywhere in `apps/ui/src` to `create_regions`, `CreateRegions`, silence trim or level normalize: a repository search for those terms in `apps/ui/src` returns nothing.
- `docs/operations/reaper-verification-pass.md`: "Status: planned; not run yet." Its Parts A and B enumerate exactly the rows needed to verify every command in `experimentalCommands` (A1-A10, B1-B8), and its "Switching a command on" section is the promotion procedure this PRD reconciles onto the DAW port's declarations.
- `docs/operations/github-workflow.md` owner queue [#510](https://github.com/countrymanprime/narration-utils/issues/510) item 2: "Run `docs/operations/reaper-verification-pass.md`... Confirm each command and switch it on" and "Approve and make the one test recording on a copy (D28)" are still unchecked.
- [DAW Port and Capabilities](daw-port-and-capabilities.prd.md)'s capability table (`daw-port-and-capabilities.prd.md:115-134`) already assigns each of these commands a capability name (`record`, `punch`, `regions`, `silence_trim`, `item_gain`, `track_state`) and today's level (all `Experimental` except `track_state`, `record`, `punch`, `regions` also `Experimental`); its P2 says the REAPER adapter's declarations "copy `experimentalCommands` exactly", so the map and the port agree on day one.
- The benchmark: "Finish verifying and switch on what is already built... This is the cheapest large gain, because the harness tests already exist" (recommendation 1); scorecard rows for record, punch, regions, silence trim and item gain all say "Partial" with no UI as the reason.

## Proposed Solution

This PRD adds no new Lua command and changes no REAPER-facing protocol. It does four things, once per command group, gated behind the DAW port's `CapabilityGate` so the control is visible from day one and switches from "Experimental" to live with no code change once its capability is promoted:

1. **Ship the missing UI** for each group: the Record-in-REAPER toggle and confirm ([Read Aloud Control Bar](read-aloud-control-bar.prd.md) Phase 7's Q7-Q9), "Punch from here" wired to `dawport.Puncher` in the teleprompter rail and pickups ([Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) Phase 12's UI half), a "Create chapter regions…" dialog ([REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) Phase 11's UI half), and a silence-trim/level-match action surfaced from the cleanup workflow (new UI; `internal/cleanuptools` already exists as a service seam per the DAW port PRD's evidence).
2. **Give each group a `Capability`** in the DAW port's vocabulary (`record`, `punch`, `regions`, `silence_trim`, `item_gain`, plus `track_state` already declared) and wrap every control that sends one of these commands in `CapabilityGate`, reading `useCapability(cap)`. Before verification, the gate shows the control disabled with the host's "Experimental" message (studio-ui-primitives Q4); nothing here changes what happens when the toggle is off, because the resolver already treats the old `experimental_reaper_actions` key as "every Experimental capability on `auto` is on" (DAW port D3).
3. **Run the verification pass.** Part A of `docs/operations/reaper-verification-pass.md` is scriptable and unattended; this PRD's phases run it on the owner's machine and record the report. Part B needs the owner present for one approved test recording (D28); it stays pending on [#510](https://github.com/countrymanprime/narration-utils/issues/510) until then.
4. **Promote by declaration.** For each command whose verification rows pass, the "Switching a command on" procedure becomes: flip that capability's entry in `dawport/reaper`'s `Declares()` map from `Experimental` to `Supported` (one line), remove the command from `experimentalCommands` (so the legacy gate has nothing left to check for it), and update this PRD's phase table and the threat-model rows that say "pending". No caller changes, because every caller already reads the capability through the resolver.

## Key Hypothesis

If every not-yet-usable command is already wrapped in `CapabilityGate` before its verification pass runs, then promoting it is exactly the one-line declaration change the DAW port PRD promises, with no UI PR to follow it. We will know it holds when: the owner runs Part A unattended and a single-line diff in `dawport/reaper/reaper.go` (plus removing the map entry) is the only change needed to turn "Punch from here" live, with no edit to `ReaderFlagsPanel.tsx` or any other caller.

## What We're NOT Building

| Item | Why |
| --- | --- |
| New Lua commands, or any change to `narration_transport.lua`, `narration_punch.lua`, `narration_regions.lua` | They exist and are harness-tested. This PRD wires callers and promotes declarations, not the bridge |
| The booth mode layout, the compact companion panel, keyboard/pedal input for these controls | The booth mode and companion panel PRD (benchmark recommendation 2, next in this wave) and [Input Commands and Pedals](input-commands-and-pedals.prd.md). This PRD's controls are ordinary buttons in today's screens (the read-aloud bar, the teleprompter rail, a new dialog); they become booth-mode commands later |
| Promoting `set_active_take`, `list_fx_chains`, `apply_fx_chain`, `list_fx`, `add_take_fx` | These are [Edit and Proof Workspace](edit-and-proof-workspace.prd.md)'s capabilities (`takes`, `fx_chains`); that PRD owns their UI and promotion, reusing this PRD's declaration mechanism once it lands |
| The DAW port's resolver, `Role[T]`, `Adapter`, or the `dawport/reaper` package itself | [DAW Port and Capabilities](daw-port-and-capabilities.prd.md) builds them; this PRD is a consumer and, for promotion, an editor of one map inside that package |
| `CapabilityGate`, `useCapability`, `StatusBadge`'s "Experimental" tone | [Studio UI Primitives](studio-ui-primitives.prd.md); this PRD consumes them |
| Removing the `DAW.experimental_reaper_actions` setting | The DAW port PRD's P8 does this once every capability the map gates has moved to a per-capability toggle (D4 of that PRD: "no behaviour change for a narrator on default settings until booth actions enablement promotes a declaration" is the trigger, not the removal itself) |
| The WAV-file level normalize workflow (ADR 0252) | Already delivered by the diagnostics PRD; unrelated to `LevelMatchClient`'s REAPER-item gain match |
| A new mockup screen | Nothing here is a new page; each control lands inside an existing, already-mocked surface (the read-aloud bar, the teleprompter rail, a small new dialog styled like existing ones). No concept mock from the benchmark's §3 depicts these controls as their own screen |

## Success Metrics

| Metric | Target | How measured |
| --- | --- | --- |
| Commands with a caller and a `CapabilityGate` | `record`, `punch`, `regions`, `silence_trim`, `item_gain`: 5 of 5 | Manual check per phase; a guard test that a capability with an implemented role has at least one `useCapability` call site (extends `dawAvailability` scan) |
| Verification pass, Part A | All of A1-A10 run and recorded | `docs/operations/reaper-verification-pass.md` "Verification record" section filled in |
| Verification pass, Part B | Scheduled and run with the owner | The owner's approval and the recording, tracked on [#510](https://github.com/countrymanprime/narration-utils/issues/510) |
| Commands promoted (moved off `experimentalCommands`, `Supported` in `dawport/reaper`) | Every command whose rows passed | `grep experimentalCommands apps/desktop/internal/bridge/actions.go`; `dawport/reaper`'s `Declares()` |
| Promotion cost | One line in `dawport/reaper`'s `Declares()` map plus removing the command from `experimentalCommands` | Diff size of the promotion commit, per command |
| No behaviour change for a narrator with the setting untouched | 0 | Existing Go, Lua harness and Vitest suites pass unmodified in every phase before P6 |
| Gate | `pnpm check`; the Lua harness for every touched command; the visual states of every screen a control was added to, every viewport | `full-verification-gate` |

## Open Questions

Every question is answered with a recommendation, adopted if the owner does not say otherwise (D22 of the [implementation plan](implementation-plan.md)).

1. **Does `silence_trim`/`item_gain` need a whole new screen, or a button on an existing one?** *Recommendation:* a button on the chapter's Editing view (where cleanup and take review already live), opening a `ConfirmDialog` that previews the candidates through `CleanupClient.Preview`/`LevelMatchClient`'s equivalent before `Apply`. No new page.
2. **Does the Record-in-REAPER first-time confirm block this PRD on [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md)?** *Recommendation:* no. The confirm text and the toggle are independent of the resume card; if that PRD's phases have not landed, the confirm simply does not mention resume state.
3. **Order of promotion.** *Recommendation:* `track_state` first (lowest risk, read-only, and blocking [Read Aloud Control Bar](read-aloud-control-bar.prd.md) Phase 6's remaining pending note), then `regions` (no live audio device needed for Part A), then `record` and `punch` together (Part B needs the owner once for both), then `silence_trim`/`item_gain` last (lowest narrator-facing urgency per the benchmark).
4. **Does this PRD also fix the two stale phase-table notes** in Read Aloud Control Bar (Phase 7) and Teleprompter Manuscript Integration (Phase 12) that say the Lua/Go half doesn't exist? *Recommendation:* yes, each phase here that ships a sibling PRD's missing half also updates that PRD's phase-table `Status` cell and links back here, per the PRD lifecycle rule that a phase's own PR sets its `Status`.
5. **Should the legacy `experimental_reaper_actions` Settings row stay visible while promotion is partial?** *Recommendation:* yes, unchanged, until DAW port P8's per-capability Settings rows (P3/P4) fully replace it; a narrator who already turned it on sees no change (DAW port D4), and one who has not can still reach the newly gated controls once DAW port P3 lands, through the "auto" default.

## Users & Context

- **Narrators who already know these workflows from other tools** (punch-and-roll, arm-and-record, chapter regions for delivery) hit a wall today: the control exists in the UI as permanently disabled, or does not exist at all.
- **The owner**, running the verification pass once per command group, on a copy of a real project with an isolated `-cfgfile` (D3), present only for Part B's recording (D28).
- **Parallel agent workers**: each command group is one phase, file-disjoint from the others (different dialogs, different services), so they run at once once DAW port P4 has landed.

## Solution Detail

### Core capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Record-in-REAPER toggle, confirm and Play/Stop orchestration in the read-aloud control bar, behind `CapabilityGate('record')` |
| Must | "Punch from here" wired to `dawport.Puncher` in the teleprompter rail (`ReaderFlagsPanel.tsx`) and the pickups dialog, behind `CapabilityGate('punch')`; `PUNCH_PENDING` removed |
| Must | A "Create chapter regions…" dialog calling `RegionWriter`, behind `CapabilityGate('regions')` |
| Must | Part A of the verification pass run and recorded for every command this PRD touches |
| Should | Silence trim and item gain action in the Editing view, behind `CapabilityGate('silence_trim')`/`CapabilityGate('item_gain')` |
| Should | Part B run with the owner, and every command whose rows pass promoted to `Supported` |
| Could | A combined "Booth actions" summary row in Settings > DAW showing every capability this PRD touches and its level, ahead of the full per-capability Settings screen (DAW port P4) |
| Won't | New Lua, the resolver itself, `takes`/`fx_chains` promotion, the booth screen, keyboard/pedal input |

### MVP scope

Phases 1 to 4 (the UI for record, punch and regions, gated). Phases 5 and 6 (silence trim/item gain, and the verification-and-promotion pass) can land after, since they are lower priority in the benchmark's own ordering and depend on owner time.

### User flow

1. A narrator on Chapter 3, DAW port P3 landed but `experimental_reaper_actions` still off: they see "Punch from here" in the reader rail, focusable, describing why it is off ("Experimental: switched off in Settings"). They turn the setting on; the control becomes live with no page reload.
2. The owner runs Part A of the verification pass on their machine (scripted). It passes for `regions` and `punch`. A PR flips `regions` and `punch` to `Supported` in `dawport/reaper`. The narrator with the setting off now sees these two controls enabled by default; `record` still reads "Experimental" until Part B runs.
3. The owner sits for Part B, approves the one test recording, and it passes. Another PR promotes `record`. The Record-in-REAPER toggle is now enabled by default for every narrator.

## Technical Approach

**Feasibility: high.** Every command has a working Lua implementation, a Go client and harness tests already. The work here is UI plus one map edit per promotion.

**Architecture:**

- **`dawport/reaper`'s `Declares()`** starts by mirroring `experimentalCommands` (DAW port P2's promise). This PRD's promotion phases each change one entry: `port.Experimental` → `port.Supported`. `bridge.Actions` keeps its own `experimentalCommands` map as the last-mile refusal at the transport layer (it still refuses to *send* a command marked experimental there) until the command is also removed from that map in the same PR — the two must move together, so a promotion PR always touches exactly `dawport/reaper`'s declaration and `actions.go`'s map, plus `reaper-verification-pass.md`'s record.
- **New callers** (Record-in-REAPER toggle, "Punch from here", the regions dialog, the cleanup action) each take their role — `dawport.Recorder`, `dawport.Puncher`, `dawport.RegionWriter`, `dawport.SilenceTrimmer`/`dawport.GainAdjuster` — through `dawport.Role[T](resolver, capability)`, never a concrete `bridge.Actions` method, so no caller changes when a capability is promoted.
- **UI** wraps each control's trigger element (a `Button` or the toggle) in `CapabilityGate`, fed by `useCapability(cap)`; before DAW port P4 lands (the wire binding), these phases stub the capability payload behind the same `?mockCapabilities=` pattern the visual suite already uses for other mocked payloads, so UI work is not blocked on the host binding landing first — but the phase that wires the real binding call must land before the phase is marked complete.
- **Record-in-REAPER (Phase 2)** follows [Read Aloud Control Bar](read-aloud-control-bar.prd.md) Phase 7's spec exactly (Q7-Q9): exactly-one-armed-linked-track rule, disarm-and-restore, a per-project setting, a first-time confirm. It uses the already-built `arm_only`/`record_start`/`record_stop` through `dawport.Recorder`, so no Lua work remains.
- **Punch (Phase 3)** follows [Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) Phase 12's remaining scope: host anchors from the live-polled `play_position`, the `Teleprompter.punch_preroll_seconds` setting (reading REAPER's own pre-roll preference first, per that PRD's decision), and "Punch from here" wired through `dawport.Puncher`.
- **Regions (Phase 4)** is new UI only: a dialog listing the chapters to be turned into regions (reusing the chapter list component already used elsewhere), calling `RegionWriter` via the resolver, with the visual states [REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) Phase 7 never built.
- **Cleanup (Phase 5)** adds the first non-test caller of `CleanupClient`/`LevelMatchClient`: a binding pair (`CleanupPreview`/`CleanupApply`, `LevelMatchPreview`/`LevelMatchApply`) behind `dawport.SilenceTrimmer`/`dawport.GainAdjuster`, a `hostAPIVersion` bump, wire contract rows, and a button in the Editing view.
- **Verification and promotion (Phase 6)** is scripting plus documentation: a script that drives Part A's rows against a scratch project (mirroring `navigation_check.lua`'s pattern) and writes the report; the promotion PRs that follow are small, mechanical, and one per command group per the recommended order (Open Question 3).

**Risks:**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A control's UI lands before DAW port P4's real binding, and the mock payload disagrees with the eventual real one | Medium | The mock payload's shape is copied verbatim from the DAW port PRD's P4 schema before it lands; the phase that wires the real binding is a small follow-up, not a rewrite |
| Part A's scripted run finds a REAPER behaviour that differs from the harness's fake | Medium | Per `reaper-verification-pass.md`'s own rule: the fake is corrected in the same PR that records the finding, and the affected command's promotion waits for that fix to be re-verified |
| A promotion PR's two edits (`dawport/reaper` and `actions.go`) land in separate PRs and disagree for a window | Low | Enforced by review: the phase detail requires both edits in one PR; a guard test can compare the two maps' keys until `actions.go`'s map is retired |
| `ReaderFlagsPanel.tsx` and `narration_transport.lua`/`narration_punch.lua` are hot files other PRDs also touch (input-commands-and-pedals Phase 4, read-aloud-resume) | Medium | Phases here touch only the gate wrapper and the click handler, not the shortcut or resume logic those PRDs own; sequence per the Parallel-session table below |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | Ports used | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Declaration mirror | `dawport/reaper`'s `Declares()` for `record`, `punch`, `regions`, `silence_trim`, `item_gain` matching `experimentalCommands`; a guard test that the two maps agree | pending | with 2-5 | DAW port P2 | DAW port: `dawport.Adapter.Declares` | - |
| 2 | Record in REAPER | The toggle, first-time confirm, per-project setting, Play/Stop orchestration ([Read Aloud Control Bar](read-aloud-control-bar.prd.md) Phase 7's Q7-Q9), `dawport.Recorder` role, `CapabilityGate('record')` | pending | with 3, 4, 5 | 1, DAW port P4, studio-ui-primitives P11-P12 | DAW port: `record` role (`Recorder`); UI: `CapabilityGate`, `useCapability` | - |
| 3 | Punch from here | Host anchors, pre-roll setting, `ReaderFlagsPanel.tsx` and the pickups dialog wired to `dawport.Puncher`, `PUNCH_PENDING` removed, `CapabilityGate('punch')` ([Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) Phase 12's remaining scope) | pending | with 2, 4, 5 | 1, DAW port P4, studio-ui-primitives P11-P12 | DAW port: `punch` role (`Puncher`); UI: `CapabilityGate`, `useCapability` | - |
| 4 | Create chapter regions dialog | New dialog and visual states calling `RegionWriter` ([REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) Phase 7's remaining UI), `CapabilityGate('regions')` | pending | with 2, 3, 5 | 1, DAW port P4, studio-ui-primitives P11-P12 | DAW port: `regions` role (`RegionWriter`); UI: `CapabilityGate`, `useCapability` | - |
| 5 | Silence trim and item gain | `CleanupPreview`/`CleanupApply`, `LevelMatchPreview`/`LevelMatchApply` bindings; an Editing-view action; `CapabilityGate('silence_trim')`/`CapabilityGate('item_gain')` | pending | with 2, 3, 4 | 1, DAW port P4, studio-ui-primitives P11-P12 | DAW port: `silence_trim` role (`SilenceTrimmer`), `item_gain` role (`GainAdjuster`); UI: `CapabilityGate`, `useCapability` | - |
| 6 | Verification pass, Part A | Scripted, unattended run of `reaper-verification-pass.md` Part A for every command in scope; the report recorded; the harness's fake corrected where it disagrees | pending | no | 2-5 | none (REAPER-side only) | - |
| 7 | Verification pass, Part B, and promotion | Owner-present recording (D28); for each command whose rows pass, one PR flipping its `dawport/reaper` declaration to `Supported` and removing it from `experimentalCommands`, in the recommended order (Open Question 3); sibling PRDs' phase-table `Status` cells updated | pending | no | 6, owner present | none | - |
| 8 | Steady state | Update `docs/architecture/daw-integration.md`, the threat-model rows for each promoted command, `SECURITY.md` if wording changes, `docs/operations/reaper-verification-pass.md`'s "Switching a command on" section rewritten to describe the declaration mechanism; ADR 0400 to Accepted; delete this PRD | pending | no | 7 | none | - |

### Phase details

- **P1 (lane B, Sonnet).** A new `dawport/reaper/declare_test.go` (or extending the existing conformance test) asserts `Declares()`'s levels for the five capabilities equal `bridge.Experimental(command)` for each command name, so the two maps cannot silently drift before promotion starts. No behaviour change.
- **P2, P3, P4, P5 (lane C, Sonnet, file-disjoint).** Each ships one control, gated, using the mock capability payload pattern until DAW port P4's real binding lands, then a small follow-up PR (within the same phase) swaps the mock for the real `useCapability` call. Each phase's PR runs the visual states of the screen it touches at every viewport and, where a dialog's role tree changes, an aria snapshot.
- **P6 (lane B or D, whichever has REAPER access at the time).** The scripted portion of `reaper-verification-pass.md` Part A; no code change beyond the report and any fake corrections the harness needs.
- **P7 (owner-gated, tracked on [#510](https://github.com/countrymanprime/narration-utils/issues/510)).** Small, one-commit-per-capability PRs. Each also updates the `Status` cell of the sibling PRD phase it completes (Read Aloud Control Bar Phase 7, Teleprompter Manuscript Integration Phase 12, REAPER Automation Follow-Through Phase 11) to `complete`.
- **P8 (lane D, Haiku or Sonnet).** Documentation and ADR bookkeeping once every capability in scope has been promoted or the owner has decided some stay experimental indefinitely.

### Parallelism notes

- P1 runs first; P2-P5 depend on it (and on DAW port P2/P4 and studio-ui-primitives P11/P12) but not on each other, and touch disjoint files (different dialogs and services), so up to four workers run at once.
- P6 waits for P2-P5 so the report covers the UI's expectations, not just the raw bridge behaviour.
- P7 is owner-gated and serialized: one promotion PR at a time, in the recommended order, because each edits the same two files (`dawport/reaper`'s declarations, `actions.go`'s map).
- P8 is last.

### Parallel-session compatibility

| Phase | Files it touches | Collides with |
| --- | --- | --- |
| 1 | `apps/desktop/internal/dawport/reaper/**` | DAW port P2 (waits for it) |
| 2 | `apps/ui/src/components/teleprompter/{ReadAloudDialog.tsx,ReadingControlBar.tsx}`, a new confirm dialog, project-scope settings, `apps/desktop/bindings*.go` (new), `internal/bridge/actions.go` (read-only) | [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md) (same dialog; coordinate on `ReadAloudDialog.tsx`); [Input Commands and Pedals](input-commands-and-pedals.prd.md) Phase 4 (`ReadingControlBar.tsx`'s Space shortcut; this phase edits the toggle only, not the shortcut) |
| 3 | `apps/ui/src/components/teleprompter/ReaderFlagsPanel.tsx`, `components/manuscript/PickupsDialog.tsx`, `internal/teleprompter/**` | [Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md)'s own remaining work on the same files (this phase *is* that PRD's Phase 12 UI half, delivered here by agreement, Open Question 4) |
| 4 | A new `components/reaper/CreateRegionsDialog.tsx`, `apps/desktop/bindings_regions.go` (new) | None |
| 5 | A new `components/editing/CleanupAction.tsx`, `apps/desktop/bindings_cleanup.go` (new) | [Diagnostics, Delivery Reports and Cleanup Tools](diagnostics-delivery-and-cleanup-tools.prd.md) (shares the Editing view; append its own row, do not restructure the view) |
| 6 | `docs/operations/reaper-verification-pass.md`, `integrations/reaper/tests/**` (fake corrections only) | Any other stream running the verification pass at the same time (serialize on REAPER access) |
| 7 | `apps/desktop/internal/dawport/reaper/**`, `internal/bridge/actions.go`, `docs/operations/reaper-verification-pass.md`, sibling PRDs' `Status` cells | Any other promotion PR (serialize, one command group at a time) |
| 8 | `docs/architecture/daw-integration.md`, `docs/architecture/threat-model.md`, `SECURITY.md`, `docs/adr/0400-*`, this PRD (deleted) | None |

## Decisions Log

| # | Decision | Date |
| --- | --- | --- |
| D1 | Promotion is a one-line declaration change in `dawport/reaper`, paired with removing the command from `bridge.Actions`' `experimentalCommands` map in the same PR, never a caller rewrite | 2026-09-26 |
| D2 | This PRD ships the UI Read Aloud Control Bar Phase 7 and Teleprompter Manuscript Integration Phase 12 left pending, by agreement recorded here (Open Question 4), rather than duplicating the work across PRDs | 2026-09-26 |
| D3 | Recommended promotion order: `track_state`, then `regions`, then `record` and `punch` together, then `silence_trim`/`item_gain` (Open Question 3) | 2026-09-26 |
| D4 | `takes` and `fx_chains` promotion stays with [Edit and Proof Workspace](edit-and-proof-workspace.prd.md); this PRD does not touch `set_active_take`, `list_fx_chains`, `apply_fx_chain`, `list_fx`, `add_take_fx` | 2026-09-26 |

## Research Summary

- **In the code (2026-09-26, `48a882d`):** `experimentalCommands` has exactly 12 entries; `CleanupClient` and `LevelMatchClient` have zero non-test callers; no UI reference to regions, silence trim or level match; `reaper-verification-pass.md` is written but not run.
- **In the sibling PRDs:** Read Aloud Control Bar's Phase 7 note and Teleprompter Manuscript Integration's Phase 12 note are both stale relative to the code (the benchmark's own warning: "The code, not a PRD's phase table, decides the status"). This PRD is where their remaining UI work actually lands, by the wave-0 queue's design (booth actions enablement is listed as reconciling both).
- **In the benchmark:** recommendation 1 names exactly these commands as "the cheapest large gain, because the harness tests already exist", and ranks it first, ahead of booth mode and the proofing loop.
