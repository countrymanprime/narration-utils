# REAPER Automation Follow-Through

The unbuilt, high-value items from `docs/research/reaper-automation-surface.md` section 9 that the teleprompter integration does not own. Owned elsewhere: timeline-anchored live flags, punch-and-roll and resume from tail audio (`teleprompter-manuscript-integration.prd.md`); an ACX-style check per chapter (item 6, `diagnostics-delivery-and-cleanup-tools.prd.md`); pickup and duplicate detection (`take-review-pickups-duplicates-take-intelligence.prd.md`). Citations are `file:line` on worktree HEAD `b9d348d` for anything checked in code; "per docs" marks a claim taken from a document and not verified. `origin/main` is now at `d5cc994`. Since `b9d348d` it gained documentation (the teleprompter integration plan, the split guide `docs/guides/using-the-app/*.md` with its index and `apps/ui/src/docsGuide.test.ts` guard, `docs/operations/github-workflow.md`), GitHub metadata and CI files (a `github-scripts` job in `_quality.yml`, so the `lua` job cited below moved to `:115-123`), and two dependency bumps. No other source file cited here changed, so its line cites still hold. The next free ADR number is whatever is free at merge time (0027 at `d5cc994`). `docs/architecture/manuscript-line-identity.md` is kept as the shipped spec and manual checklist; this PRD is the plan for its "Later phases".

## Reconciliation with the owner decisions

[`implementation-plan.md`](implementation-plan.md) section 1 (2026-09-20) overrides the parts of this PRD it contradicts. The PRD is delivered in two stacks: **part 1, phases 1 to 5 (stack S09)** and the rest (stack S22). Where the text below disagrees with this section, this section wins.

- **D2:** the Lua harness (phase 3) and a behavior-preserving command registry (phase 4) are unconditional and go first. Open Question 1 is answered (b). "Manual checklist for now" and the Decisions Log row that says so are superseded: the manual REAPER sign-off remains only for REAPER API semantics a fake cannot prove ([ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)).
- **Delivered (stack S09, 2026-09-21):** phases 2, 3, 4 and 5 are `complete`, and phase 1 is `partial` (see its row). Part 1 also fixed a bug the harness could not have found: a scripted run in a real REAPER showed that `EnumerateFiles` caches the commands folder listing, which the bridge now clears ([ADR 0068](../adr/0068-bridge-events-fan-out-to-subscribers-by-tag-and-run-and-every-error-names-its-run.md), [S0 result](../research/reaper-spike-s0-item-extension-data.md)). Phases 6 onward stay queued for stack S22; the spike scripts in `integrations/reaper/spikes/` and the fixture pack are the starting point for its spikes.
- **Order inside part 1:** 3 (harness), 4 (registry), then phase 2 (the Go event fan-out; its Lua part, the run ID on `ERROR` events, comes after the registry), then 5 (spike S0 and the fixture pack), then 1 (the checklist results). The Go fan-out does not depend on Lua.
- **D3:** all six REAPER spikes are approved on copies of `Challenges_001.rpp` in a temp directory with an isolated `-cfgfile`; nothing in the owner's REAPER folder is modified. S0, S5 and S7 run unattended; S1, S3 and S4 need audio hardware and the owner and stay `pending`. "Requires user approval to launch REAPER" below is answered by D3.
- **D18:** new Go logic directories hold the 80% floor and existing ones ratchet ([ADR 0043](../adr/0043-coverage-is-a-ratchet-on-logic-directories-not-a-blanket-80-percent.md)); Lua is held by the harness and its mutation checks. **D17:** any new dependency is checked for AGPL compatibility (`lupa` and Lua are MIT). **D19:** the first real audio corpus is the `Challenges_001` media. **D22:** every open question not answered above takes the recommendation stated with it.

## Problem Statement

A solo narrator recording in REAPER repeats manual chores around the app: marking and working through proofer pickups, naming and rendering per-chapter files, and re-checking work after editing. The repo has the first Lua building blocks for tying manuscript lines to REAPER items, but they are unverified, unused, and blocked by an event-handling limitation in the Go bridge. Without an ordered, spike-gated plan, follow-on work risks building on assumptions nobody has tested (how item extension data is stored in a saved project, how render settings behave) and piling untested Lua into one file.

## Evidence

Verified in code (HEAD `b9d348d`):

- **The three line-identity commands exist and nothing calls them.** `stamp_item_lines` (`integrations/reaper/narration_ui_bridge.lua:380`), `read_line_ids` (`:408`) and `create_chapter_regions` (`:476`) are dispatched at `:544-549`. `bridge.Client.Send` is called only by the transcript service (`apps/desktop/internal/transcript/service.go:100,236,274,519`); a grep for the command names in Go finds nothing.
- **The manual verification checklist has never been run** (`docs/architecture/manuscript-line-identity.md` status line; project memory). The `.rpp` serialisation of item `P_EXT` is unverified (same doc, ADR 0026 context).
- **The Go bridge has one event cursor.** `Client.ReadEvents` advances a single `eventOffset` over `events.log` (`apps/desktop/internal/bridge/bridge.go:82-105`). The host's `transcriptLoop` drains that client every 150 ms (`apps/desktop/app.go:349-364`), and the transcript service handles every event, ignoring any whose run ID is not its own (`transcript/service.go:282-312`). So `LINES_*` and `REGIONS_CREATED` events emitted today would be consumed and ignored within 150 ms, and a second consumer (line identity, teleprompter live state) reading the same client would lose events or steal the transcript service's.
- **The bridge exists only when launched from REAPER.** The client is created only when a session directory is supplied (`apps/desktop/app.go:169-171`); a standalone launch has none. Anything that needs the bridge is REAPER-launched only; the static `.rpp` reader (`apps/desktop/internal/tracks`) works standalone.
- **Lua has no automated tests and no local interpreter.** CI's `lua` job is `stylua --check` (`.github/workflows/_quality.yml:115-123`); `pnpm exec stylua --check` doubles as a syntax check because no Lua interpreter is installed on the development machine (project memory). Every Lua change needs manual REAPER verification (CLAUDE.md). *Superseded by D2: phase 3 adds the harness, see the reconciliation above.*
- **One 563-line file holds all bridge behavior**, dispatched by one `if/elseif` chain (`narration_ui_bridge.lua:523-552`). Four PRDs (this one, the teleprompter integration, take review, diagnostics) plan new commands there.
- **Line IDs do not exist yet.** The doc example uses `line-000001`, but the manuscript's paragraph IDs are positional, `p-%06d` (`apps/desktop/internal/manuscript/service.go:425`), chapter IDs `c-%04d` (`:403`), and `documentId` changes on every import (`:431`). A re-import of an edited manuscript renumbers paragraphs, so stamps would drift silently unless the stored `line_text` (already written, `narration_ui_bridge.lua:395`) is used to detect it.
- **The `.rpp` reader cannot see line identity or item GUIDs.** `parseItem` reads position, length, name and source only (`apps/desktop/internal/tracks/parse.go:68-97`) though the fixture has `GUID` (`testdata/basic.rpp:14`); it also skips `SOFFS` and `PLAYRATE`.
- **Pickup-style markers have a convention to reuse.** Compare markers use a `PREFIX:` name with a 0.15 s duplicate tolerance (`narration_ui_bridge.lua:174-186`; `daw-integration.md`).
- **`create_chapter_regions` uses the index-based API** (`AddProjectMarker2`, `:503`) and dedupes by title and bounds within 0.01 s (`:456-458`), not by a stable region ID. Research (per docs) marks the index API discouraged in favor of `AddRegionOrMarker` (7.72) with a GUID.
- **Packaging.** `scripts/release/prepare-resources.py` copies the whole `integrations/reaper` folder, but `scripts/release/verify-installable.mjs:23` lists four required Lua files by name; any new Lua file must be added there and loaded by `dofile` relative to the script path.
- **Recorded rule:** "There is no loopback server, REST endpoint, browser tab, or port override" (`docs/architecture/daw-integration.md`); a web-interface or OSC client needs an ADR (research doc section 4).
- **Host API version** is in three places, all `5`: `apps/desktop/app.go:33`, `apps/desktop/app_test.go:40`, `apps/ui/src/hostApi.ts:2`. The next free ADR number is whatever is free at merge time (0027 at `d5cc994`).

Per docs (not verified in code; nothing in the research was run against a live REAPER):

- Research v7.80 findings on regions, markers, render keys, fixed lanes, transport interfaces and the six open spikes (`reaper-automation-surface.md` sections 2 to 6, 9, 10). "(U)" items there are unverified by the research itself.
- REAPER 7.66 can import CSV and RPP markers natively (research section 6 changelog list), so an in-app pickup import must add value beyond that.
- Pozotron's marker export format was not retrievable (research section 7).
- `teleprompter-manuscript-integration.prd.md` refers to "spike 1", "spike 2" and "spike 4" without an in-document definition; its spike 1 appears to be the play-position anchor (research spike 4) and its spike 2 the input-device-name read, which is not among the research's six. The crosswalk must be confirmed at planning time.

Assumptions - need validation through the user and sample projects:

- How narrators' projects are structured. Line identity only helps if items map to manuscript lines; many narrators record a chapter as one long item and split at pickups. Method: inspect the user's real projects and ask.
- Time lost to per-chapter render naming and pickup tracking. No baseline exists. Method: stopwatch one book's handoff.

## Proposed Solution

Verify before building, then build the thinnest useful slices in value/risk order. First run the never-run manual checklist, fix the Go bridge's single-consumer event cursor, and (decision D2) add a stub-`reaper` Lua harness and a command registry first, so new Lua stops accumulating untested. Then close the line-identity loop: a Go client and UI trigger (chapter-granularity first), chapter regions from the manuscript, and a pickup list (import, export, jump-to-next, remaining count) that reuses the `PREFIX:` marker convention. Per-chapter render is configure-only until its spike proves the render keys. Transport replacement (web/OSC), fixed-lane retakes, session stats and cleanup launchers are deferred behind explicit decision gates and spikes. The six research spikes become explicit phases; D3 approves them on copies in a temp directory with an isolated `-cfgfile`, and the three that need audio hardware and the owner stay pending.

## Key Hypothesis

We believe a verified, tested line-identity and pickup-list loop between the app and REAPER will remove the marker-hunting and manual bookkeeping that follows recording, for solo narrators who work with proofer lists and per-chapter renders. We'll know we're right when, on the user's real project, (a) stamped identity survives save and reload and item splits (proved by spike S0), (b) a proofer list of N pickups round-trips through import and export with identical markers, (c) the narrator can jump through remaining pickups without touching the marker list, and (d) no bridge command ever writes to an item other than the one named by GUID.

## What We're NOT Building

- **Timeline-anchored live flags, punch-and-roll, resume from tail audio** - owned by `teleprompter-manuscript-integration.prd.md`.
- **Pickup and duplicate detection, take comparison** - owned by the take-review PRD; this PRD keeps only import, export, jump-to-next and the remaining count (boundary is Open Question 6).
- **The ACX-style per-chapter check** (research item 6) - owned by the diagnostics PRD; no distributor profile without independent validation (prior decision).
- **A native REAPER extension, ReaStream mic tap, or any non-Lua REAPER-side code** - prior decision: Lua-only for now. ReaStream appears only as a spike.
- **Web-interface or OSC transport in the MVP** - needs an ADR and has no current consumer (the teleprompter integration keeps the file bridge); gated by Open Question 8.
- **Writing manuscript text into item notes or take names** - ADR 0026: separate opt-in decision; notes and names belong to the narrator.
- **Auto-executing a render, or touching audio** - prior decision: no analyzer or action silently changes audio; render is at most configured, the narrator presses Render.
- **A loopback server, REST endpoint or port in the app** - recorded rule.
- **REAPER launched by an agent outside the D3 approval** - the spikes launch REAPER on the owner's machine; D3 approves them only on copies in a temp directory with an isolated `-cfgfile`, never the owner's project, resource directory or settings.
- **Audacity, macOS, Linux, languages beyond US English** - Windows-first, deferred.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Manual checklist | 10 of 10 steps recorded pass or fail with REAPER version and date | User runs `manuscript-line-identity.md` checklist; results committed to that doc |
| Event fan-out | 0 lost or mis-routed events with two concurrent consumers | Go test with two subscribers and interleaved run IDs |
| Save/reload persistence | Stamp, save, close, reopen: identical IDs and text (spike S0 result recorded) | Spike S0 plus a REAPER-saved fixture `.rpp` |
| Stale-GUID safety | 0 writes to any item other than the named GUID | Checklist step 5 and harness test |
| Lua behavioral coverage | Every bridge command has at least a happy path and a stale or error path in the harness | CI job (`quality / lua`) |
| Pickup round trip | Export then import reproduces the same markers (names, times within 1 ms) and is idempotent (second import adds 0) | Harness test plus manual run |
| Pickup import in REAPER | 500 markers in one undo step; wall time TBD (baseline needs measurement) | Manual run, timed |
| No unreviewed edits | Only narrator-triggered, undo-wrapped REAPER mutations; 0 writes to notes or take names | Code review of Lua plus checklist |
| Every spike closes | Each ends with a written result, the decision it unblocks, and the fixture or script kept | One entry per spike in `docs/research/` |
| Coverage of new Go code | At least 80% | `go test -cover` |
| UI verification | Every new state reviewed as PNG at desktop, small-desktop, tablet and mobile | `apps/ui/screenshots/app/<page>/<state>/<viewport>.png` |

## Open Questions

- [x] **1. Pull the Lua stub-`reaper` harness and a command registry forward?** The user's recorded call was "manual checklist for now; harness is a planned later item". Four PRDs will add commands to one untested file. Options: (a) keep manual-only and land each Lua PR behind its own manual checklist. (b) Build the harness (Lua 5.4 in CI on Linux, a fake `reaper` table driven through the file protocol; TBD - needs research on interpreter provisioning and license) and a behavior-preserving registry before new commands. (c) Harness only, no registry. Recommendation: (b). It is a suggestion to reorder, not a reversal: phases 3 and 4 are conditional on this answer, and phases 8 onward run either way. **Answered (b) by D2**: the harness and the registry are unconditional and go first (phases 3 and 4).
- [x] **2. Which REAPER spikes may be launched, and how?** Every spike launches REAPER on the user's machine. Options: (a) approve S0 only, in an isolated resource directory (`-cfgfile` to a temp folder), a scratch project in a temp folder, and no user project touched. (b) Approve S0 and S5 (both scripted, no audio hardware). (c) Approve all six (S1, S3, S4 also need audio input and loopback hardware and the user present). (d) None; write instructions the user runs. Recommendation: (a) first, then decide per spike. The spike phases below stay "requires user approval to launch REAPER" until answered. **Answered by D3**: all six spikes are approved on copies in a temp directory with an isolated `-cfgfile`. S0, S5 and S7 run unattended; S1, S3 and S4 need audio hardware and the owner and stay pending.
- [x] **3. Line granularity.** Options: (a) chapter-level: one identity per chapter item, from the chapter-to-track matcher. (b) Paragraph-level, from Transcript Compare's alignment (whether saved compare results map takes to paragraphs is TBD - needs research). (c) Sentence-level. Recommendation: (a) first. It needs no per-line items and works with a one-item-per-chapter workflow; revisit (b) once sample projects show whether narrators split per line. **Answered (a) by D22**: chapter-level first.
- [x] **4. Line ID scheme and drift.** IDs today would be positional `p-%06d`. Options: (a) stamp the paragraph ID plus the manuscript's source SHA-256 and rely on the stored line text to detect drift. (b) A content hash of the line text. (c) Stable IDs assigned at import (changes the importer and needs its own ADR). Recommendation: (a) now; raise (c) only if re-import drift proves painful. The stored text already makes drift detectable. **Answered (a) by D22**: stamp the paragraph ID plus the manuscript's source SHA-256 and rely on the stored text to detect drift.
- [x] **5. Pickup list formats.** Pozotron's export format is unknown. Options: (a) generic CSV (start time, note, optional tag) first, matching REAPER's own marker CSV columns. (b) Also Pozotron once the user supplies a real export. (c) Also Audition/Audacity labels. Recommendation: (a), and ask the user for a real proofer export before Phase 9 planning. Value beyond REAPER's native 7.66 CSV import is the prefix convention, idempotent re-import, the remaining count and jump-to-next. **Answered (a) by D22**: generic CSV first; a real proofer export is an owner input (plan section 2) before phase 9.
- [x] **6. Ownership boundary with the take-review PRD.** Options: (a) this PRD owns the pickup marker naming and status convention (`PICKUP:` and a done marker) and the import, export and jump commands; take review only consumes markers and produces findings. (b) Take review owns everything pickup-related. Recommendation: (a), so one convention exists. Whichever answer, the two PRDs must agree before either writes Lua for pickup markers. **Answered (a) by D22**: this PRD owns the `PICKUP:` convention; the take-review PRD only consumes markers.
- [x] **7. Per-chapter render scope.** Options: (a) configure only: set bounds to all regions, pattern to the region name and the output folder; the narrator clicks Render. (b) Configure and add to the render queue. (c) Configure, render and embed chapter tags. Recommendation: (a) for the first slice. Render creates files and can be long, so it stays a narrator click. Embedding chapter tags (Go ID3 CHAP after render; library TBD - needs research) is a separate, later phase because it edits a deliverable file. **Answered (a) by D22**: configure only; chapter tag embedding stays a later phase.
- [x] **8. Transport decision gate (web/OSC replacing file polling).** The teleprompter PRD keeps the file bridge and lists web/OSC as out of scope, so nothing consumes a faster transport today. Options: (a) defer until a consumer's measured file-bridge round trip misses its budget, then run spikes S2 and S6 and write the ADR. (b) Run S2 and S6 now. (c) Never. Recommendation: (a). Setting up REAPER's web interface (with a password) and an OSC device is a required user-side step and a restart is needed for OSC action bindings (per docs), a real cost to weigh against evidence. **Answered (a) by D22**: defer web/OSC until a measured budget miss; S2 and S6 wait on it.
- [x] **9. Static `.rpp` read of line IDs.** Options: (a) build it only if S0 shows a stable, parseable serialisation and a standalone consumer needs it. (b) Never; always read through `read_line_ids`. Recommendation: (a). The saved-file read would help standalone launches, but a saved `.rpp` lags an open project (stale until save). **Answered (a) by D22**: build the static read only if S0 shows a stable, parseable serialisation and a standalone consumer needs it.
- [x] **10. Retakes as fixed lanes.** Options: (a) defer until take review decides how a "good take per line" is chosen, and add a lane-API spike (S7) first. (b) Build now from the research notes. Recommendation: (a). Lane semantics (`I_FREEMODE`, `C_LANEPLAYS`) are unverified and depend on decisions the take-review PRD owns. **Answered (a) by D22**: defer, and run the lane-API spike S7 first.
- [x] **11. Session stats definition.** Options: (a) progress only: per-chapter recorded seconds from the `.rpp` (already delivered by the diagnostics PRD Phase 8). (b) Add time tracking (hours per finished hour) from a timer. REAPER has no documented per-project active-time source (TBD - needs research). Recommendation: (a), and drop time tracking until a data source is defined. **Answered (a) by D22**: progress only.
- [x] **12. Who builds the shared bridge dispatcher.** Both this PRD (line identity) and `teleprompter-manuscript-integration.prd.md` Phase 11 need a Go bridge client with per-consumer event routing. Options: (a) this PRD's Phase 2 lands first and the teleprompter phase adopts it. (b) The teleprompter phase builds it. Recommendation: (a): it is small, Go-only, needs no REAPER, and unblocks both. **Answered (a) by D22**: phase 2 lands first and the teleprompter phase adopts it.

## Users & Context

**Primary User**
- **Who**: a solo author-narrator recording in REAPER on Windows, who renders per-chapter files and, often, receives pickup lists from a proofer.
- **Current behavior**: copies pickup timecodes into REAPER by hand or via REAPER's marker import, works through them from a list, names and renders each chapter file individually, and re-runs checks after edits.
- **Trigger**: a proofer list arrives, or a chapter is edited and ready to render.
- **Success state**: imports the list into markers, presses "next pickup" until none remain, then renders every chapter by name in one action they trigger themselves.

**Job to Be Done**
When I get corrections or finish editing, I want the app and REAPER to carry the bookkeeping, so I only make the editorial decisions.

**Non-Users**
- Narrators who do not use REAPER (Audacity and other DAWs are deferred).
- Studios with automated render farms (headless render is only a spike).
- Anyone expecting the app to record, punch or edit audio for them.

## Solution Detail

### Value and risk ranking (owned items)

| Item (research #) | Value | Risk | Decision |
| --- | --- | --- | --- |
| Verify line identity + fix event routing (3, prerequisite) | Enabler for 3, 4, 5 and the teleprompter PRD | Low | MVP |
| Line identity: Go client, UI trigger, chapter regions (3) | High: unlocks per-chapter render and pickup context | Medium (unverified `.rpp` behavior; ID drift) | MVP |
| Pickup list import/export/jump (4) | High for proofer workflows | Low to medium (format unknown) | MVP |
| Per-chapter render configuration (5) | High: the biggest manual chore | Medium to high (render keys unverified, S5) | Later, spike-gated |
| Change-driven re-compare (11) | Medium | Low to medium (change count is coarse) | Later |
| Static `.rpp` read of line IDs (3 follow-on) | Medium, standalone only | Medium (S0) | Later, conditional |
| Web/OSC transport (7) | Low today (no consumer) | High (user setup, ADR, network dependency) | Defer, decision gate |
| Retakes as fixed lanes (8) | Medium | High (unverified lane API, depends on take review) | Defer |
| Session stats (9) | Low to medium | Low | Defer (progress overlaps diagnostics Phase 8) |
| Cleanup launchers (10) | Low | Low (action IDs unverified) | Could |

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Run and record the manual REAPER checklist for line identity | 1 |
| Must | Route bridge events to the right consumer without loss | 2 |
| Must | Learn how item extension data is stored in a saved project (spike) | 5 |
| Must | Go client for `stamp_item_lines` / `read_line_ids` with stale and conflict reporting; drift detection | 6 |
| Must | UI trigger for chapter-level stamping and chapter regions from the manuscript | 7 |
| Must | Pickup list: import CSV, export, jump to next, remaining count, idempotent | 8, 9 |
| Should | Stub-`reaper` Lua harness in CI and a behavior-preserving command registry | 3, 4 |
| Should | Per-chapter render configuration (configure-only) | 10, 11 |
| Should | "Project changed since compare" indicator | 13 |
| Could | Chapter tag embedding after render | 12 |
| Could | Static `.rpp` read of line IDs | 14 |
| Could | Session progress stats; cleanup launchers | 22, 23 |
| Won't (this cycle) | Web/OSC transport client, retakes as fixed lanes, live-audio anchoring (owned by teleprompter PRDs) | 15-21, 24-25 as spikes or gated |

### MVP Scope

Phases 1, 2, 5, 6, 7, 8 and 9 (3 and 4 first, by D2). This delivers a verified, tested line-identity loop and a pickup list with no new transport, no audio access and no render. Everything else is spike-gated or deferred.

### User Flow

1. After recording, the narrator opens the app from REAPER, lets it read the project, and chooses "Link chapters to REAPER". The app shows which items it will stamp (by GUID) and any conflicts or stale GUIDs; nothing is written until the narrator approves; the stamp is one undo step.
2. The narrator chooses "Create chapter regions": one region per chapter, bounds derived from the matched track's items, idempotent on re-run.
3. A proofer's list arrives. The narrator imports it: each row becomes a `PICKUP:` marker (one undo step, duplicates skipped), and the app shows "N pickups remaining".
4. The narrator presses "Next pickup"; the edit cursor and view move there. After re-recording, they mark it done; the count drops. "Export pickups" writes the remaining list to CSV.
5. Later: with regions in place, "Prepare chapter render" sets bounds, naming pattern and output folder and stops; the narrator presses Render in REAPER.

## Technical Approach

**Feasibility**: HIGH for Phases 1, 2, 6, 9 (Go and known protocol). MEDIUM for 3, 4, 7, 8, 11 (new Lua, chapter-to-time derivation, unverified marker and render APIs). LOW-MEDIUM for 10, 12 to 21, 24, 25 (spikes, unverified REAPER behavior, user-side setup). Nothing here was run against a live REAPER.

**Architecture Notes**

- **Protocol.** Keep the recorded file protocol: `1|<command>|<args>` in `commands/NNNNNNNN.cmd`, events in `events.log`, payloads as files because the line carries at most eight fields (`manuscript-line-identity.md`). New commands follow the same shape; every write is one undo block; nothing is written and no undo point is created when there is nothing to change (`narration_ui_bridge.lua:380-402`).
- **Event fan-out (Phase 2).** Replace the single-cursor `ReadEvents` consumer model with one reader that dispatches each event by tag or run ID to subscribed handlers; the transcript service becomes one subscriber. Behavior-preserving for Transcript Compare, with its existing tests plus fan-out tests. Also give `ERROR` events a run ID (today `event(session_dir, 'ERROR', msg)` carries none, so they cannot be attributed).
- **Lua organisation (Phases 3, 4).** With the harness (fake `reaper` table, `defer` stub that queues the tick, `.cmd` files written to a temp session directory, assertions on `events.log` and on the fake project state), convert the `elseif` chain into a registry table and load new commands from separate files (`narration_pickups.lua`, `narration_render.lua`) via `dofile`. Add each new file to `verify-installable.mjs:23`. This shrinks merge conflicts among the four PRDs that add commands.
- **Line identity (Phases 6, 7).** Line source is chapter-level first (Open Question 3): the chapter-to-track matcher (`teleprompter-manuscript-integration.prd.md` Phase 8) yields track and items; identity value is the chapter ID (`c-%04d`) plus paragraph ID when available, with source SHA-256 recorded. Stamp payload `item_guid|line_id|line_text`; on read, compare stored text to current manuscript text and report drift, never re-stamp silently. Region bounds come from item extents per chapter track (`tracks`), payload `start|end|title`.
- **Pickups (Phases 8, 9).** Project markers named `PICKUP: <note>` (reusing `marker_kind`, `narration_ui_bridge.lua:174`), duplicate tolerance like the compare export (0.15 s), commands `import_pickups`, `export_pickups`, `next_pickup`, `resolve_pickup`, `count_pickups`. Prefer `AddRegionOrMarker` where present, fall back to `AddProjectMarker2` (research, per docs). Go side parses and validates CSV (never trusts external data; reject non-finite or negative times) and writes payload files; UI in a new pickups view or an existing page, decided in Phase 9 planning.
- **Render (Phases 10 to 12).** Configure through `GetSetProjectInfo` and `GetSetProjectInfo_String` keys (`RENDER_BOUNDSFLAG`, `RENDER_PATTERN`, `RENDER_FILE`, per docs). `RENDER_FORMAT` is an opaque base64 sink config, so the first slice never writes it; the narrator's last-used format stands. Whether `$region` naming, `RENDER_STATS`, marker-to-chapter mapping and action IDs behave as documented is the S5 spike.
- **Change detection (Phase 13).** Lua `project_state` returns `GetProjectStateChangeCount(0)`; the app stores the value when a compare run is prepared and shows "project changed since this comparison" when it differs. It is coarse (any change increments it) so it only labels results stale; it never re-runs ASR automatically.
- **Host.** New bindings bump the host API version in three places and regenerate `Host.{js,d.ts}` (whichever PR lands second increments again; check `hostAPIVersion` at merge time); services snapshot pointers under `h.mu.RLock` (the `h.services()` pattern of `docs/architecture/host-binding-concurrency.md`). Bridge-dependent bindings return a clear "open the app from REAPER" state when the client is nil (`app.go:169-171`).
- **Spikes.** Each spike PR contains a written result, the script or steps used, any REAPER-saved fixture, and the decision it unblocks. No spike code ships in the product.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Item `P_EXT` is not preserved on split, copy or save as assumed | Medium | Run the checklist (Phase 1) and spike S0 before any consumer depends on it; identity stays readable through the API either way (ADR 0026) |
| Positional paragraph IDs drift after a manuscript re-import | High | Store text and source hash; detect and report drift; never re-stamp silently (Open Question 4) |
| Untested Lua regresses Transcript Compare or another PRD's commands | High | The harness (phase 3, [ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)) pins every command; a scripted REAPER run covers what a fake cannot |
| Event single-consumer bug loses events | High until Phase 2 | Phase 2 first; fan-out tests |
| Merge conflicts in `narration_ui_bridge.lua` across four PRDs | High | Registry plus per-feature Lua files; land Phase 4 early; sequence Lua PRs |
| Proofer list format unknown or messy (time formats, encodings) | Medium | Generic CSV first; sample from the user; strict validation and a per-row error report |
| Import creates duplicate or wrong-time markers | Medium | Idempotent import (name plus time tolerance), one undo step, dry-run count before writing |
| Spike launches REAPER and disturbs the user's session or settings | Medium | D3 approval, isolated resource directory (`-cfgfile`) and a copy in a temp directory, never the user's project; the exact command is recorded with the result |
| Render keys behave differently than documented | Medium | Configure-only first slice; S5 before Phase 11 |
| Web/OSC needs user-side setup and a network dependency | Medium | Deferred behind a decision gate and an ADR; only a Go client of REAPER's own interfaces (`daw-integration.md` rule is about the app hosting a server) |
| Standalone launch has no bridge | Certain | Clear state in UI; static read only where S0 proves it |
| Licensing (thenarratorUK has no license; mavriq-lua-sockets GPL-3.0) | Low | Learn from, do not copy or bundle (per docs) |

## Implementation Phases

Every spike phase below launches REAPER. D3 approves that on copies of `Challenges_001.rpp` in a temp directory with an isolated `-cfgfile`; S1, S3 and S4 also need audio hardware and the owner present and stay `pending` until then.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Run the manual checklist | The checklist is run in REAPER and the results and REAPER version recorded in `manuscript-line-identity.md`; status line updated. No code. Scripted in an isolated REAPER 7.80 for every step that does not need the owner; the owner runs the rest | partial | 2, 3 | - | [verification record](../architecture/manuscript-line-identity.md#verification-record) |
| 2 | Bridge event fan-out | Go: one event reader, per-consumer routing; transcript service migrated; tests. Then, after phase 4, run IDs on `ERROR` events in Lua | complete | 1, 3, 5 | Go part: none; Lua part: 4 | [ADR 0068](../adr/0068-bridge-events-fan-out-to-subscribers-by-tag-and-run-and-every-error-names-its-run.md), [reaper-bridge](../architecture/reaper-bridge.md) |
| 3 | Lua stub-`reaper` harness (D2) | Lua 5.4 in CI (Linux and Windows), fake `reaper`, file-protocol driver, characterization tests for every existing command and mutation checks; no bridge source change | complete | 1, 2, 5 | - | [ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md), [reaper-bridge](../architecture/reaper-bridge.md) |
| 4 | Lua command registry (D2) | Behavior-preserving refactor of the dispatch chain; new-command file convention; `verify-installable.mjs` list | complete | 5 | 3 | [ADR 0067](../adr/0067-bridge-commands-are-registered-by-name-and-each-feature-lives-in-its-own-lua-file.md), [reaper-bridge](../architecture/reaper-bridge.md) |
| 5 | Spike S0: item `P_EXT` in a saved project (approved, D3) | Scripted, isolated REAPER run: stamp, split, copy, save, inspect the `.rpp`; keep a REAPER-saved fixture; record result | complete | 1, 2, 3 | D3 | [S0 result](../research/reaper-spike-s0-item-extension-data.md), [fixtures](../../apps/desktop/internal/tracks/testdata/reaper/README.md) |
| 6 | Line-identity Go client | Payload writers, `read_line_ids` parser, stale/conflict/drift reporting, binding, host API bump, tests mirroring `transcript/service_test.go` | complete | 8 | 1, 2 | - |
| 7 | Line-identity UI and chapter regions | "Link chapters" flow with preview and approval, chapter regions from matched tracks, visual states, docs | partial | 8, 9 | 6, chapter matcher from the teleprompter PRD Phase 8 | - |
| 8 | Pickup list: Lua commands | `import_pickups`, `export_pickups`, `next_pickup`, `resolve_pickup`, `count_pickups`; harness tests or manual checklist | complete | 6, 7 | 1, 2, 4 | - |
| 9 | Pickup list: Go client and UI | CSV parse and validation, payload files, view with remaining count and next; export; visual states | complete | 7 | 8 | - |
| 10 | Spike S5: render details (approved, D3) | Verify `RENDER_STATS` key format, marker-to-chapter mapping, `$region` naming, current action IDs, dry-run behavior | complete | 6, 7, 8, 9 | D3 | [S5 result](../research/reaper-spike-s5-render-details.md) |
| 11 | Per-chapter render configuration | Lua `configure_chapter_render`, Go and UI; configure-only; manual checklist | pending | 13 | 7, 10 | - |
| 12 | Chapter tag embedding | Go ID3 CHAP on rendered MP3 (library TBD - needs research) as a new file; explicit action | pending | 13, 14 | 11 | - |
| 13 | Change-driven re-compare indicator | Lua `project_state`, baseline stored at prepare time, "changed since comparison" label; no auto-run | pending | 11, 12 | 2 | - |
| 14 | Static `.rpp` read of line IDs (conditional) | `tracks` parse of item ext data and GUID, standalone consumers only | pending | 12, 13 | 5 | - |
| 15 | Spike S4: play-position anchor (approved, D3; needs audio hardware and the owner present: pending) | `GetPlayPosition` vs `GetPlayPosition2` against a known click; feeds the teleprompter PRD | pending | 16, 17 | D3, owner present | - |
| 16 | Spike S3: audio accessors during recording (approved, D3; needs audio input and the owner present: pending) | Can a track or take accessor see a recording in progress; are take FX included | pending | 15, 17 | D3, owner present | - |
| 17 | Spike S1: ReaStream to localhost (approved, D3) | UDP 58710 packet format, unicast target, MTU, measured latency; feeds the engines PRD | pending | 15, 16 | D3, owner present | - |
| 18 | Spike S2: OSC feedback rate and marker banking (approved, D3) | Measure feedback latency and banking; gate for the transport decision | pending | 19 | D3; Open Question 8 | - |
| 19 | Spike S6: web interface defaults (approved, D3) | Port, auth and CORS defaults; payload and escaping limits for `SET/EXTSTATE` | pending | 18 | D3; Open Question 8 | - |
| 20 | Transport ADR | Decide web/OSC client vs staying on the file bridge; amend `daw-integration.md` language via a new ADR | pending | 22, 23 | 18, 19 | - |
| 21 | Go transport client (web/OSC) | Trimmed OSC listener and web command client behind a setting; only if Phase 20 says yes | pending | - | 20 | - |
| 22 | Session progress stats | Per-chapter progress from the `.rpp`; time tracking only if a data source is found | pending | 23 | diagnostics PRD Phase 8 | - |
| 23 | Cleanup launchers | Lua allow-listed named-action launcher (Repair Pops/Clicks; Magnolius only if installed) | pending | 22 | 4 | - |
| 24 | Spike S7: fixed-lane API behavior (approved, D3) | Added by this PRD: `I_FREEMODE`, `C_LANEPLAYS`, `I_FIXEDLANE` behavior and undo | pending | - | D3; take-review PRD decisions | - |
| 25 | Retakes as fixed lanes | Choose the good lane per line; only after S7 and take-review decisions | pending | - | 24 | - |

### Phase Details

**Phase 1 - Run the manual checklist**
- **Goal**: replace "implemented, unverified" with a recorded result.
- **Scope**: the user runs steps 1 to 10 in `manuscript-line-identity.md` in their REAPER (a normal session, not a headless spike); PR updates the doc's status, records REAPER version, pass or fail per step and what split and copy did to the stamp.
- **Success signal**: a written pass or a filed list of defects; the doc status line no longer says "not yet verified". *Evidence: `integrations/reaper/spikes/checklist.lua` ran the checklist against the real bridge in REAPER 7.80 (37 checks, 0 failures; it found and led to the fix of a cached `EnumerateFiles` listing) and the doc has a verification record. Still for the owner: a real paste of a stamped item (steps 6) and Transcript Compare through the app with the launcher (step 10). The phase stays `partial` until the owner records those two.*

**Phase 2 - Bridge event fan-out**
- **Goal**: two consumers can use one bridge without losing events.
- **Scope**: `apps/desktop/internal/bridge` (reader plus subscription), `apps/desktop/internal/transcript/service.go` migration, `ERROR` events with a run ID in `narration_ui_bridge.lua` (small Lua change, manual check), tests.
- **Success signal**: transcript service tests unchanged and green; fan-out test with two subscribers and unrelated run IDs; Transcript Compare still runs end to end in REAPER (checklist step 10). *Evidence: the existing transcript tests pass unchanged; the fan-out is tested with two consumers and interleaved run IDs, partial lines, malformed lines and concurrent `Dispatch` calls (`internal/bridge`, 94% coverage, floor raised from 85); the run ID on `ERROR` is pinned in the Lua harness. Also found: the transcript service used to drop every `ERROR` (see ADR 0068). The end-to-end check in the app (step 10) needs the owner and is tracked under phase 1.*

**Phase 3 - Lua stub-`reaper` harness (D2)**
- **Goal**: Lua behavior is tested in CI without REAPER.
- **Scope**: a Lua 5.4 job in `_quality.yml`, a `integrations/reaper/tests/` (or similar) folder with the fake `reaper`, a driver that writes `.cmd` files, ticks the stubbed `defer`, reads `events.log`; tests for compare, jump and the three line commands (idempotent, conflict, stale, malformed payload). No change to bridge source.
- **Success signal**: CI runs it; the harness fails when a command's stale-GUID guard is removed (mutation check).

**Phase 4 - Lua command registry (D2)**
- **Goal**: new commands land without editing one giant chain.
- **Scope**: behavior-preserving refactor covered by the Phase 3 tests; convention for per-feature Lua files; `verify-installable.mjs` updated; docs note.
- **Success signal**: all harness tests unchanged and green; manual checklist step 10 (Transcript Compare still starts) passes. *Evidence: the 76 harness tests written before the split pass unchanged on the new layout; loading in a real REAPER is checked in the phase 5 scripted run; the in-app Transcript Compare check (step 10) needs the owner and is tracked under phase 1.*

**Phase 5 - Spike S0: item `P_EXT` in a saved project (approved, D3)**
- **Goal**: learn the `.rpp` representation and how split and copy treat item extension data.
- **Scope**: only after the user approves: an isolated REAPER instance (candidate flags per research section 4.5, to be verified: `-cfgfile`, `-nosplash`, `-newinst`, project plus script on the command line), a scratch project in a temp folder, a script that stamps, splits, copies, saves and exits; save the resulting `.rpp` as a fixture under `apps/desktop/internal/tracks/testdata/`; document the exact command run and REAPER version. The user's own projects and resource directory are not touched.
- **Success signal**: a written result answering serialisation, split, copy and save-reload; a real REAPER-saved fixture the `tracks` parser tests can use. *Evidence: [the S0 result](../research/reaper-spike-s0-item-extension-data.md) (`<EXTI`/`<EXT` blocks, four value forms, survives save, reload, split, duplicate and chunk copy; a real paste needs the owner) and the fixture pack under `apps/desktop/internal/tracks/testdata/reaper/` (multi-take, muted, SECTION, play rate and stretch markers, FX chains, a no-op re-save pair, `PICKUP:` markers, regions with GUIDs, stamped items), all written by REAPER 7.80 in an isolated, scripted run. Open Question 9 is answered yes: a static read is feasible.*

**Phase 6 - Line-identity Go client**
- **Goal**: the host can stamp and read line identity and explain every outcome.
- **Scope**: payload writers (file with `item_guid|line_id|line_text`), `read_line_ids` output parser, subscriber for `LINES_*` events, drift detection against the current manuscript, binding plus host API bump (3 places, Wails bindings regenerated), contract and mock.
- **Success signal**: Go tests mirror `transcript/service_test.go` (stamped, unchanged, stale, conflict, malformed, drift); Lua unchanged; manual round trip in REAPER. *Evidence: `apps/desktop/internal/lineidentity` (new package, mirroring `transcript.Service`'s pattern exactly: `Subscribe`/`Owns`/`Handle`/`Invalid` on the same bridge client, so it is the fan-out's second real consumer): `Stamp` writes `item_guid|line_id|line_text` rows (the line ID is `ComposeLineID(entityID, sourceSHA256)`, Open Question 4's answered (a)) and sends `stamp_item_lines`; `Read` sends `read_line_ids` and, on `LINES_READ`, parses the report and classifies every row against the current manuscript (`manuscript.Service.Load`) as `ok`, `drift` (stored text no longer matches), `stale-source` (the source SHA-256 no longer matches — a re-import happened), `removed` (the entity ID is gone), `unrecognized` (an older, uncomposed line ID) or `unknown` (no manuscript loaded to compare against); `LINES_STALE`/`LINES_CONFLICT` GUIDs and the `LINES_STAMPED` counts are aggregated. 24 tests (`service_test.go`, mirroring `transcript/service_test.go`'s pattern: exact bridge command/payload contracts, the fan-out sharing test, three `ERROR`-attribution tests, `ComposeLineID`/`ParseLineID` round trip and rejection), 86.9% coverage (floor added to `scripts/ci/coverage-floors.json` at 86). No Lua change: `stamp_item_lines`/`read_line_ids` and every `LINES_*` event already existed (phases 3-4); the harness (98 tests, 19 mutation checks) passes unchanged. `hostAPIVersion` 20 to 21 (`LineIdentityStamp`, `LineIdentityRead`, `LineIdentityState`; Wails bindings regenerated with `wails generate module`). Deliberately not wired into `apps/ui`: no schema, mock or `wireContracts.test.ts` row, and no live event emitted, since nothing in the frontend calls these bindings yet — Phase 7 owns the UI trigger and the chapter-to-track matcher that supplies real rows, and will add the wire-contract checks (`docs/architecture/wire-contracts.md`) when it wires real consumption. Manual round trip in REAPER stays for phase 7 alongside the UI trigger, since there is no way to drive `stamp_item_lines`/`read_line_ids` from the app until then.*

**Phase 7 - Line-identity UI and chapter regions**
- **Goal**: a narrator links chapters and creates regions with preview and approval.
- **Scope**: UI flow (which page: decided at planning; the Tracks page is a candidate), preview of items and conflicts, chapter regions with bounds from `tracks` extents, `state-catalog.ts` rows and drivers, doc screenshots, a guide page under `docs/guides/using-the-app/` (listed in its `README.md` index; breadcrumb and Previous / Index / Next footer enforced by `apps/ui/src/docsGuide.test.ts`), `design-spec-guard`.
- **Success signal**: PNGs at four viewports reviewed; second run adds 0 regions and 0 stamps; conflicts and stale GUIDs shown, nothing written until approved.
- **Status: partial.** Delivered: the "Link chapters" stamp/read half of this phase, on the Tracks page (`apps/ui/src/components/tracks/LinkChaptersDialog.tsx`). It wires Phase 6's three bindings into the TS layer, the gap that phase deliberately left open (Zod schema `apps/ui/src/api/schemas/lineidentity.ts`, contracts `apps/ui/src/api/contracts/lineidentity.ts`, `wailsClient.ts`, `mockApi.ts`, a `wireContracts.test.ts` row, and golden payloads `tests/fixtures/contracts/line-identity-idle.json` / `line-identity-read-success.json` from a new Go contract test, `apps/desktop/internal/lineidentity/contract_test.go`). `h.emitLineIdentity` (`apps/desktop/app.go`) now relays every state change as the `lineidentity:state` live event, the way `h.emitTranscript` does. `Item.GUID` joined the `tracks` wire contract (`json:"guid"`, additive, no `hostAPIVersion` bump) so the preview can name items by GUID. The narrator maps each chapter to a REAPER track by hand (a `Select` per chapter row): the chapter-to-track matcher this phase's `Depends` column names (teleprompter PRD Phase 8) does not exist yet, and `apps/desktop/internal/evidence` has no confirmed chapter-track mapping store either (only `SourceIdentity`, evidence-ledger Phase 1) — this is a deliberate simplification, not the planned automatic match, and stays until that matcher lands. Every item on the mapped track is stamped with the chapter's identity; nothing is written until "Stamp N items" is pressed. Stale/conflict (from a Stamp) and ok/drift/stale-source/removed/unrecognized (from a Read) are all shown, using `Dialog`/`Table`/`Select`/`Checkbox`. Four new visual states (`tracks/link-chapters-preview`, `-success`, `-conflict`, `-error`) reviewed at desktop, small-desktop and tablet (no phone viewport, ADR 0037).
- **Not delivered in this pass**: chapter regions from matched tracks (no Go client for `create_chapter_regions`, no UI), and the guide page under `docs/guides/using-the-app/`. These remain open under this phase's row until a follow-up lands them; `docs/architecture/manuscript-line-identity.md`'s "Later phases" item 2 (chapter regions) is unchanged.

**Phase 8 - Pickup list: Lua commands**
- **Goal**: import, export, jump, resolve and count pickups inside REAPER.
- **Scope**: commands in a new Lua file (or the registry if Phase 4 landed), `PICKUP:` and done conventions agreed with the take-review PRD, idempotence, one undo block per write, unit tests in the harness if it exists otherwise the manual checklist.
- **Success signal**: import of a fixture list twice adds N then 0; export equals import within 1 ms; jump lands on the next marker after the cursor. *Evidence: `integrations/reaper/narration_pickups.lua` registers `import_pickups`, `export_pickups`, `next_pickup`, `resolve_pickup` and `count_pickups` through the Phase 4 registry, loaded via `FEATURE_FILES` and required by `scripts/release/reaper-files.mjs`. Pickups are project markers named `PICKUP: <body>` (open) and `PICKUP_DONE: <body>` (resolved) - the convention already recorded in the fixture pack (`apps/desktop/internal/tracks/testdata/reaper/README.md`) and reused from the compare export's `PREFIX:` convention; this PRD owns it per Open Question 6, the take-review PRD only consumes it. `<body>` folds an optional tag as `[tag] note` (Open Question 5: generic CSV first; a real proofer export is still an owner input, plan section 2). 32 new harness tests in `integrations/reaper/tests/pickups_test.lua` (130 total, 0 failed) cover every command's happy path, missing-API and missing-payload errors, idempotent re-import (open and already-resolved), the duplicate tolerance, malformed and CRLF rows, cursor-relative jump-and-wrap, the closest-match and idempotence of resolve, and the export/import round trip; 10 new mutation entries in `mutations.json` (29 of 29 project-wide caught, 0 survivors) pin every new guard. `stylua --check` and the release file-list tests (`reaper-files.test.mjs`, `verify-installable.test.mjs`) pass. Manual REAPER verification (the actual marker-rename and CSV-shaped payload behaviour) is still pending the owner, tracked under Phase 1's checklist scope, since this phase's scope is Lua and its harness only.*

**Phase 9 - Pickup list: Go client and UI**
- **Goal**: the narrator drives the list from the app.
- **Scope**: CSV parsing and validation, payload writers, view with count, next and export, error report per row, states and screenshots, docs.
- **Success signal**: malformed rows reported, not silently dropped; visual states reviewed at every viewport (desktop, small-desktop and tablet; no phone viewport, ADR 0037). *Evidence: `apps/desktop/internal/pickups` (new package, mirroring `lineidentity.Service`'s pattern: `Subscribe`/`Handle`/`Drain` on the same bridge client, so it is the fan-out's third real consumer) wraps the five Phase 8 Lua commands; `Import`/`Export`/`Next`/`Resolve`/`Count` each start one run and report through the same phase machine, with `remaining`/`total` surviving across runs so the count does not flash back to zero while a different action is in flight. `internal/pickups/csv.go`'s `ParseCSV` (start,note,tag; an optional header row; never trusts the file) rejects a non-finite or negative start, an empty note, and a tag containing the payload's own `|` separator, reporting every bad row by line number instead of dropping it silently; `PickupsImport` (the new host binding) parses and validates entirely in Go before anything is sent to REAPER, and throws only when every row is unusable. `PICKUPS_IMPORTED`, `PICKUPS_EXPORTED`, `PICKUPS_COUNTED`, `PICKUP_NEXT` and `PICKUP_RESOLVED` joined the wire-contract table (`internal/bridge/wire.go`), which Phase 8 had not added (found on the way, fixed here). Go tests: 26 in `internal/pickups` (payload/bridge-contract pins for every command, the counts-survive-a-new-run behavior, fan-out sharing with another consumer, and error attribution) plus 13 in `csv_test.go`; two contract fixtures (`pickups-idle.json`, `pickups-import-success.json`). `hostAPIVersion` 21 to 22 (`PickupsImport`, `PickupsExport`, `PickupsNext`, `PickupsResolve`, `PickupsCount`, `PickupsState`; Wails bindings regenerated with `wails generate module`). UI: `apps/ui/src/components/tracks/PickupsDialog.tsx`, reachable from the Tracks page next to "Link chapters…" (no new nav item), with the full wire-contract chain (schema, contracts, `wailsClient.ts`, `mockApi.ts`, a `wireContracts.test.ts` row, golden fixtures). "Export CSV" downloads the remaining list as a browser file save (`text/csv` Blob), matching the CSV format `ParseCSV` reads, so export then import round-trips. Five new visual states (`tracks/pickups-empty`, `-imported`, `-import-errors`, `-next`, `-error`) reviewed at desktop, small-desktop and tablet (15 captures, axe gate 0 violations); also found and fixed on the way: an auto-refresh-the-count-on-open effect raced with the dialog's initial state hydrate and could flash a completed run back to a stale phase, fixed by sequencing them. `narration_pickups.lua` was also missing from the Go smoke test's `smokeReaperFiles` list (a Phase 8 gap; `scripts/release/reaper-files.mjs` already had it) - fixed. Manual REAPER verification of the round trip stays pending the owner, tracked under Phase 1's checklist scope, since this phase's own scope is the Go client and UI.*

**Phase 10 - Spike S5: render details (approved, D3)**
- **Goal**: verify what render configuration can safely be automated.
- **Scope**: scratch project with regions; check `RENDER_BOUNDSFLAG`, `RENDER_PATTERN`, `$region`, `RENDER_TARGETS`, `RENDER_STATS` key format, marker-to-CHAP behavior and the current IDs of the actions listed in research section 2 (per docs, verify each). Optionally `-renderproject` in an isolated run.
- **Success signal**: a written result listing each key as confirmed or wrong; Phase 11 scope adjusted accordingly. *Evidence: [the S5 result](../research/reaper-spike-s5-render-details.md), a scripted, isolated REAPER 7.80 run against a scratch project (never `Challenges_001.rpp`) using the existing `integrations/reaper/spikes/run-reaper.ps1` driver and a new `spike_s5_render.lua`. Confirmed: `$region` in `RENDER_PATTERN` with `RENDER_BOUNDSFLAG=3` ("all regions") produces one correctly named file per region, matching `RENDER_TARGETS` read beforehand exactly; all 15 action IDs research section 2 and 6 cited are still valid and correctly named in 7.80 (`kbd_getTextFromCmd`); `Render_Execute` and `Render_EnumerateOutputMode` (named in this phase's own dispatch) are not real ReaScript API functions (`APIExists` false for both) - render is only ever driven through actions and `RENDER_*` keys. Open: `RENDER_STATS`/`RENDER_STATS_SUMMARY`'s key format is still unconfirmed - a true dry-run action (42437) returned an empty string with no items selected, and, more importantly, calling the same getter with a real render action's ID (42230) did not just read stats, it re-invoked rendering and produced a "Files already exist" dialog; Phase 11 must never call that getter with a file-writing render action's ID. Dry-run behavior is therefore only partly proven: a true dry-run action writes no files (confirmed), but no fully headless, dialog-free stats read was proven, so no "preview" feature ships in Phase 11 on this evidence alone.*

**Phase 11 - Per-chapter render configuration**
- **Goal**: one action prepares per-chapter file naming and bounds; the narrator renders.
- **Scope**: Lua `configure_chapter_render` (bounds, pattern, output folder; never format), Go and UI with a confirmation showing the resulting file names, manual checklist.
- **Success signal**: rendering in REAPER produces one correctly named file per chapter region; nothing else in the project changes besides render settings, undoable where REAPER allows.

**Phase 12 - Chapter tag embedding**
- **Goal**: chapter metadata in rendered MP3s.
- **Scope**: Go ID3 CHAP/CTOC writer producing a new file beside the render (library and license TBD - needs research), explicit action, tests on fixtures.
- **Success signal**: a third-party player shows the chapters; the source render is untouched.

**Phase 13 - Change-driven re-compare indicator**
- **Goal**: results say when the project changed since they were made.
- **Scope**: Lua `project_state`, baseline captured at `prepare_compare`, low-frequency poll only while results are shown, label only.
- **Success signal**: editing an item after a comparison shows the label; no ASR starts automatically.

**Phase 14 - Static `.rpp` read of line IDs (conditional)**
- **Goal**: read identity without a running REAPER, if S0 allows.
- **Scope**: `tracks` parse of item GUID and extension data using the S0 fixture; standalone consumers only; documents "as of last save".
- **Success signal**: parser tests on the REAPER-saved fixture; matches `read_line_ids` output on the same project.

**Phases 15 to 19 - Spikes S4, S3, S1, S2, S6 (each approved, D3)**
- **Goal**: close the research's open questions so dependent PRDs plan on evidence.
- **Scope**: each spike records its method, measurements and decision. S4, S3 and S1 need audio hardware and the user present and feed `teleprompter-manuscript-integration.prd.md` and `teleprompter-engines-and-input-devices.prd.md`; run once and share results. S2 and S6 feed the transport decision (Open Question 8).
- **Success signal**: one dated entry per spike in `docs/research/`, each naming the decision it unblocks.

**Phase 20 - Transport ADR**
- **Goal**: an explicit decision on web/OSC versus the file bridge.
- **Scope**: new ADR (re-check numbering) recording the client-of-REAPER's-own-interfaces boundary, required user setup, security posture (web interface password) and the measured evidence; updates `daw-integration.md` language through the ADR, not by editing it away.
- **Success signal**: the ADR is Accepted, or the file bridge is explicitly kept with the measured reason.

**Phase 21 - Go transport client**
- **Goal**: only if Phase 20 says yes.
- **Scope**: trimmed OSC feedback listener and web command client behind a setting, reconciliation on every transport poll (UDP is lossy, per docs), the Lua launcher reduced to a stateless handler.
- **Success signal**: latency measured better than the file bridge on the same commands; fallback to the file bridge works.

**Phase 22 - Session progress stats**
- **Goal**: per-chapter progress without new REAPER code.
- **Scope**: reuse the diagnostics PRD's measured recorded duration; a small view; time tracking only with a defined source (Open Question 11).
- **Success signal**: progress equals matched item lengths; no timer added by default.

**Phase 23 - Cleanup launchers**
- **Goal**: one-click launch of REAPER's own repair dialog on selected items.
- **Scope**: allow-listed named-action command; action IDs verified in the Action list; third-party tools only if installed and never bundled (Magnolius is GPL-3.0, per docs).
- **Success signal**: the dialog opens; the app changes nothing itself.

**Phase 24 - Spike S7: fixed-lane API behavior (approved, D3)**
- **Goal**: learn how lanes behave through the API before designing on them.
- **Scope**: `I_FREEMODE=2` and `UpdateTimeline()`, `I_NUMFIXEDLANES`, `C_LANEPLAYS`, `I_FIXEDLANE`, undo behavior, effect on saved `.rpp`.
- **Success signal**: a written result and a decision on whether Phase 25 is feasible.

**Phase 25 - Retakes as fixed lanes**
- **Goal**: choose the good lane per line.
- **Scope**: only after S7 and take-review decisions; narrator-approved, undoable, never automatic.
- **Success signal**: TBD - needs research after S7.

### Standing gates for every phase

CLAUDE.md workflow: plan (find or open the tracking issue first with `gh issue list`, and put `Closes #<n>` in the PR; see `docs/operations/github-workflow.md`), `change-impact-scan` (a Lua consumer with no harness test is zero-coverage), TDD (the harness for Lua; the D18 ratchet for Go), `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard` when primitives or `styles.css` change, `feature-cleanup`. A Lua change needs harness tests written first; REAPER API semantics a fake cannot prove are checked in a scripted run on a copy of a project (recorded in `docs/research/`), and anything needing the owner is recorded as pending. `apps/ui` changes run `visual-catalog-sync`, the Playwright visual suite with PNGs opened at desktop, small-desktop, tablet and mobile, `doc-screenshot-sync`, and the atlas when a primitive or `styles.css` changes. Binding changes bump the host API version in `apps/desktop/app.go`, `apps/desktop/app_test.go`, `apps/ui/src/hostApi.ts` and regenerate Wails bindings. Re-check `docs/adr/` numbering immediately before writing an ADR. Update `docs/roadmap.md` and `config/roadmap.json` together when a milestone changes (the GitHub milestones are generated from `roadmap.json` by `scripts/github/sync-milestones.mjs`, so never edit them by hand). Update `docs/architecture/manuscript-line-identity.md` "Later phases" as each lands.

### Parallelism Notes

Phases 1, 2 and 3 have no dependencies and touch different areas (a doc plus the user's REAPER, Go bridge, CI plus a new Lua test folder). Phase 5 can run alongside them once approved. Phases 6 and 8 can run in parallel after 1 and 2 (Go client versus Lua commands), but both touch the bridge conventions, so agree the command shapes first. Phases 15 to 19 are independent of each other and should run as one approved REAPER session where the hardware allows. Phases 20 to 25 are deferred; do not start them before their gates.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `docs/architecture/manuscript-line-identity.md` | Any doc edit to that file |
| 2 | `apps/desktop/internal/bridge/*`, `apps/desktop/internal/transcript/service.go` (+tests), `integrations/reaper/narration_ui_bridge.lua` (error events) | Transcript work; `teleprompter-manuscript-integration.prd.md` Phase 11 (bridge client): agree who lands first (Open Question 12) |
| 3 | `.github/workflows/_quality.yml`, new Lua test folder | Release-readiness PRD adding CI jobs to `_quality.yml` (`release-readiness-provisioning-and-docs-site.prd.md`) |
| 4 | `narration_ui_bridge.lua` (whole dispatch chain), `scripts/release/verify-installable.mjs` | Every Lua-touching PRD (take review, teleprompter Phases 11 and 12, diagnostics Phase 10); do this alone and early. `verify-installable.mjs` is also edited by `release-readiness-provisioning-and-docs-site.prd.md` Phase 8 (packaged-app smoke check) and `teleprompter-engines-and-input-devices.prd.md` Phase 6 (Moonshine sidecar check): each adds independent checks to the same file, so rebase and keep them separate |
| 5 | `apps/desktop/internal/tracks/testdata/` (new fixture), `docs/research/` | Teleprompter Phase 8 also adds `tracks` testdata |
| 6 | new Go files, `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/*}`, `Host.{js,d.ts}` | Every session adding a binding: host API version, `app.go` `Host` struct |
| 7 | `components/tracks/*` or new component folder, `AppShell.tsx` NAV (if a new page), `tests/visual/*`, `docs/images/ui/*`, `docs/guides/using-the-app/*` | Any PRD adding a nav item or page: a nav change regenerates every doc screenshot, so land nav changes serially |
| 8 | Lua (new file), `verify-installable.mjs` | `take-review-pickups-duplicates-take-intelligence.prd.md` pickup markers (agree convention first, Open Question 6) |
| 9 | new Go files, pickups UI, bindings and version | Phase 6 and 7 bindings |
| 10, 11 | Lua (new file), Go, UI, `docs/research/` | Diagnostics PRD if it also names files after chapters |
| 12 to 14 | new Go files; `tracks` parser | Teleprompter Phase 8 (same parser) |
| 15 to 25 | `docs/research/`, ADR, later Go/Lua | ADR number (the next free number at merge time; 0027 at `d5cc994`) |

Cross-cutting: `docs/roadmap.md` and `config/roadmap.json` change together; ADR numbers and the host API version are merge-time serialization points (the later PR takes the next number and rebases; whichever PR lands second increments again; check `hostAPIVersion` at merge time); `docs/README.md` and `docs/architecture/codebase-map.md` are edited by most feature PRDs.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| REAPER work is Lua-only for now (prior decision) | Lua commands over the existing file bridge | Native extension; web/OSC client | Recorded scope call |
| Do not start the headless REAPER spike without asking (prior decision, answered by D3) | Approved on copies with an isolated `-cfgfile` | Agent launches REAPER unrestricted | It launches REAPER on the user's machine |
| ~~Manual REAPER checklist instead of a harness for now~~ (superseded by D2) | Harness and registry first (phases 3, 4); manual REAPER checks only for API semantics | Checklist only | Owner decision D2, 2026-09-20 |
| Lua interpreter for the harness (D2, ADR 0066) | Lua 5.4 from the `lupa` wheel, pinned in `uv.lock`, run on Linux and Windows | A distro package; building lua.org source; LuaBinaries; Lua in WebAssembly | Same 5.4 everywhere, hashed by the lockfile, no compiler needed, MIT |
| Every spike approved on copies (D3) | Isolated `-cfgfile`, copy in a temp directory; S1, S3, S4 pending the owner and hardware | Ask before each spike | Owner decision D3 |
| Phase order in part 1 (D2) | 3 harness, 4 registry, 2 (Go fan-out, then the Lua `ERROR` run ID), 5 spike, 1 checklist | 2 first | The Lua part of phase 2 must not touch the unregistered dispatcher |
| Line identity in item extension data, read through the API (prior decision, ADR 0026) | `P_EXT` keys, `read_line_ids` | Sidecar file; notes or take names | Survives moves and splits; narrator owns notes and names |
| Stale GUIDs are reported, never resolved to a neighbour (prior decision, ADR 0026) | Report and skip | Nearest item | Safety |
| Never auto-edit audio; mutations narrator-triggered, undo-wrapped (prior decision) | Preview then approve | Automatic | Product boundary |
| No loopback server, REST or port in the app (prior decision, `daw-integration.md`) | File bridge; web/OSC only via an ADR as a client | App-hosted server | Recorded boundary |
| No distributor profile before independent validation (prior decision) | Not in this PRD | ACX check now | Recorded decision |
| Local-first, Windows-first, US-English-first (prior decision) | As stated | Cloud, cross-platform | Product boundary |
| Optional downloads only on explicit first use (prior decision) | Not applicable to REAPER items; any new library adds no model download | - | Recorded rule |
| Findings and markers use a `PREFIX:` name convention (existing) | `PICKUP:` reuses `marker_kind` | New marker types | Consistency with compare markers |
| Chapter-level identity first (proposed) | Chapter item, then paragraph | Paragraph first | Works with one-item-per-chapter projects |
| Render is configure-only first (proposed) | Narrator clicks Render | Auto-render | Long, file-creating action stays a narrator click |
| Bridge events fan out to subscribers (proposed) | One reader, per-consumer routing | One client per feature | Single event cursor loses events |
| Lua organisation (proposed) | Registry plus per-feature Lua files | One growing file | Four PRDs add commands |
| Workflow (prior decision, CLAUDE.md) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup | Fast check only | History of silent regressions |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |

## Research Summary

**Market Context**
- Existing REAPER narration tooling (per `reaper-automation-surface.md` section 7, secondary sources): thenarratorUK scripts (Chapter/Line Region Maker, Pozotron pickup import, Character Take Report; no license declared: learn, do not copy), Steven Jay Cohen's setup (Punch and Roll, "Export Chapters" versus "Render Mastered Chapters"), acendan (import item names from a text file), DialogueWorkflow (CSV to regions plus a browser teleprompter through the web interface, the closest architectural precedent), Pozotron (commercial proofing; exports pickup markers with `@narrator` tags, format not retrievable). Gaps found by absence in search results: no public ACX-check ReaScript, no ReaPack punch-and-roll, no "mark bad take" script. Narrator pain points from blogs: the pickup loop (proofer flags timecodes, narrator re-records, editor integrates) is manual.
- No surveyed REAPER bridge pushes events; the mature ones keep the bridge a thin executor and report "uncertain outcome" on timeout rather than guessing (research section 4.6), a design lesson applied here.

**Technical Context**
- Reused, verified: the file bridge and its command protocol (`apps/desktop/internal/bridge`, `narration_ui_bridge.lua`), the three line-identity commands, the `PREFIX:` marker convention, the `tracks` parser, the layered settings, the job and binding patterns, the visual suite and atlas.
- Unverified and gated on spikes (each launches REAPER, needs the user's go-ahead): `.rpp` serialisation of item `P_EXT` (S0); render keys, `RENDER_STATS`, chapter mapping and action IDs (S5); play-position anchor, accessors during recording, ReaStream, OSC and web-interface behavior (S4, S3, S1, S2, S6); fixed-lane behavior (S7, added here).
- Doc and code discrepancies found while writing this PRD are listed in the hand-off message.

---

*Generated: 2026-09-19*
*Status: IN DELIVERY - part 1 (phases 1 to 5) is delivered by stack S09, with the two owner-only checklist steps pending; stack S22 (phases 6 to 25) is in progress: phases 6, 8 and 9 are complete, phase 7 is partial (see its row), phases 10 to 25 are queued*
