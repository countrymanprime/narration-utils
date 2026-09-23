# Audacity Integration

**Source:** owner instruction of 2026-09-21 (D23 in [implementation-plan.md](implementation-plan.md)): draft the first Audacity adapter PRD and run it as a parallel stack instead of waiting for the REAPER automation workflow (stack S22) to finish, reversing the "Audacity adapters after the shared contract and REAPER workflow are proven" line of `docs/roadmap.md`.

**Reconciliation with the owner decisions:** [implementation-plan.md](implementation-plan.md) D23 overrides `docs/roadmap.md`'s prior deferral and `reaper-automation-follow-through.prd.md`'s "Won't Be Building" exclusion of Audacity; both are corrected in this PRD's Phase 0. Every other owner decision in section 1 (D2 Lua-only rules do not apply here since this PRD adds no Lua; D18 coverage ratchet; D19 the `Challenges_001` corpus is REAPER-only and gives this PRD no audio corpus of its own; D22 unanswered questions take the stated recommendation) applies as written.

## Problem Statement

The suite's review workflow (findings, the layered settings store, the DAW-neutral finding schema) was designed to be DAW-agnostic from the start, but only a REAPER adapter exists. A narrator who records in Audacity instead of REAPER gets none of it: no marker/label import for findings, no navigate-and-review loop, no settings persistence. The only trace of Audacity support today is three placeholder READMEs (`integrations/audacity/README.md`, `integrations/audacity/manuscript-guide/README.md`, `integrations/audacity/transcript-compare/README.md`) that say "not implemented yet" and note that Audacity's scripting model (`mod-script-pipe`) and data model (label tracks, no ExtState, no take markers) are different enough from REAPER's that a driver "will need its own design, not a port of `integrations/reaper/`." Nobody has verified that assumption against a running Audacity, so a first slice risks planning against an unverified scripting surface the same way the REAPER PRD did before its spikes.

## Evidence

Verified in code and docs (worktree `pr-101-merge-conflicts-a58355`, based on `main`):

- **Only placeholders exist.** `integrations/audacity/README.md:1-11`, `integrations/audacity/manuscript-guide/README.md:1-10` and `integrations/audacity/transcript-compare/README.md:1-13` are all "Not implemented yet" notes. No Go, Python or scripting code targets Audacity anywhere in the tree (a repo-wide search for "Audacity" outside docs and these three files finds nothing).
- **The settings store was already built DAW-agnostic on purpose.** `libs/python/narration_common/config.py:1-19`'s module docstring: "Config storage and resolution live here, in Python, rather than in each DAW's own scripting language, so a future non-REAPER adapter (Audacity has no ExtState equivalent) gets this for free instead of needing its own port." The three-tier layering (`config/defaults.json`, `%APPDATA%/narration-utils/global-settings.json`, `<project>/narration-utils/settings.json`) has no REAPER-specific logic.
- **The finding schema is already DAW-neutral.** `docs/architecture/findings-contract.md:13`: `source` is "DAW-neutral audio source identity and optional REAPER track, item, and take GUIDs" (optional, not required) and time ranges are project-time seconds, not REAPER-specific units.
- **The host already carries a free-form `daw` field, unused beyond a label.** `apps/desktop/app.go:525` parses `--daw` into `config.daw`; `apps/desktop/app.go:658` and `apps/desktop/bindings.go:243` only ever set it to `"reaper"`/`"REAPER"` or `"Standalone"` (confirmed by `apps/desktop/app_test.go:173,215`, `apps/desktop/contract_test.go:27,66`). `apps/ui/src/App.tsx:241` and `apps/ui/src/components/settings/Settings.tsx:221` just render it as a display string. Nothing branches on its value today, so introducing `"Audacity"` changes no existing behavior.
- **The REAPER bridge (`session-dir`-gated) has no Audacity equivalent and should not be reused as-is.** `apps/desktop/app.go:169-171` (per `reaper-automation-follow-through.prd.md:26`) creates the file-protocol bridge client only when a session directory is supplied by the REAPER launcher; Audacity has no comparable launcher today, and `mod-script-pipe` is a different transport (named pipes, not polled `.cmd`/`events.log` files) — the daw-integration doc explicitly separates it: "Use its optional `mod-script-pipe` only from a local desktop process and only after the user has enabled it" (`docs/architecture/daw-integration.md:39`).
- **The documented boundary already commits to a first scope.** `docs/architecture/daw-integration.md:36-46`: "Audacity is a future adapter, not a Lua port. Its closest finding representation is a UTF-8 label track... First adapter scope: import findings as labels, navigate/export reviewed labels, and preserve the DAW-neutral finding data. Take management has no direct Audacity equivalent," and the acceptance criterion "Audacity planning never requires REAPER ExtState or take-marker semantics."
- **Prior art exists but its export format is unverified.** `docs/research/reaper-automation-surface.md:240`: Pozotron "exports pickup markers for Audition, Reaper, Audacity with `@narrator` tags. Format not retrievable." No public Audacity label-import tooling for this workflow was found in that research pass.
- **Take-management and pickup ownership already exclude Audacity by design, not oversight.** `docs/prds/reaper-automation-follow-through.prd.md:68`: "Audacity, macOS, Linux, languages beyond US English - Windows-first, deferred," and `docs/prds/reaper-automation-follow-through.prd.md:112-115` (Non-Users): "Narrators who do not use REAPER (Audacity and other DAWs are deferred)." Nothing in that PRD's pickup/take-marker convention (`PICKUP:` markers, `SetTakeMarker`) has an Audacity analog; this PRD does not attempt one.
- **The host API version is currently 13** (`apps/desktop/app.go:36`), not 5 as the implementation plan's cross-PRD sequencing note assumed when written; any binding this PRD adds re-checks the live value at merge time.
- **Codebase-map already reserves the folder.** `docs/architecture/codebase-map.md:20`: `integrations/audacity/ placeholder notes for a future Audacity driver`.

Per docs (not verified against a running Audacity by this repository):

- `mod-script-pipe` protocol shape: newline-terminated text commands over named pipes (`ToSrvPipe`/`FromSrvPipe` on Windows), documented at `https://manual.audacityteam.org/man/scripting.html`. Never exercised from this codebase.
- Label-track mutation commands (`SetLabel`, `GetInfo: type=labels`, `Export2`) exist per the Audacity scripting reference; exact reply framing, timeouts, and behavior when Audacity is not running or scripting is disabled are unverified.
- Whether Audacity ships a project-open/macro mechanism comparable to a REAPER Action-list launcher script is unverified; the closest documented option is an Audacity macro or a Nyquist plug-in invoked manually.

Assumptions - need validation through a spike before Phase 2 commits to an architecture:

- Whether the named-pipe transport is reliable enough (latency, partial reads, pipe-not-found when scripting is disabled) for the same "narrator-triggered, undoable, never silent" rule the REAPER bridge follows. Method: spike S-A1.
- Whether label tracks round-trip stable identity (a label added by the adapter must be found again after Audacity moves/splits it) well enough to support "mark reviewed" without re-adding duplicates. Method: spike S-A2.
- How a narrator gets from "opened Audacity" to "the app's workspace is open," with no REAPER-style launcher script mechanism. Method: spike S-A3.

## Proposed Solution

Verify the unverified scripting surface first, in the same spike-then-build order the REAPER PRD used, before committing any adapter code. Extract the REAPER-specific parts of today's single adapter into a narrow `DAWAdapter` boundary the review workflow calls through, so Audacity becomes a second implementation rather than a parallel special case sprinkled through the UI and host. Then build only the scope `docs/architecture/daw-integration.md` already committed to: import findings as labels, navigate to a label, mark it reviewed, export the reviewed set - nothing that needs take markers, ExtState or per-line identity, all of which stay REAPER-only. Pickup lists, per-chapter render, and any transport work stay entirely out of scope; this PRD does not touch `integrations/reaper/` or its Lua.

## Key Hypothesis

We believe a verified, narrow Audacity adapter (findings in, reviewed labels out) removes the same marker-hunting friction the REAPER adapter removes, for narrators who record in Audacity, without requiring REAPER's take-marker or ExtState machinery. We'll know we're right when, against a real Audacity 3.x install with scripting enabled: (a) a finding round-trips to a label and back without losing its identity, (b) the narrator can navigate to and mark a label reviewed without touching Audacity's own label-editing UI, (c) exporting reviewed labels produces a file the narrator can hand off, and (d) no adapter command ever mutates a label it did not itself create or a project the narrator did not open.

## What We're NOT Building

- **Take management, pickup markers, or per-chapter render** - no Audacity equivalent exists; owned (for REAPER) by `reaper-automation-follow-through.prd.md` and `take-review-pickups-duplicates-take-intelligence.prd.md`, which stay REAPER-only.
- **ExtState-equivalent settings storage** - the layered JSON settings store already covers this; Audacity gets it with zero new code (Evidence).
- **A port of `integrations/reaper/`'s Lua** - `mod-script-pipe` is a different transport with a different data model; per `integrations/audacity/README.md:11`, "a real driver here will need its own design."
- **macOS or Linux Audacity support** - first adapter is Windows-only, matching D7 (first stable release is Windows-only) and the existing REAPER adapter's scope.
- **Manuscript Guide or Transcript Compare's full Audacity drivers** - the two placeholder READMEs under `integrations/audacity/` describe that work; this PRD only builds the shared label/finding adapter both would eventually call into (Phase 6), not the sidecars' own audio-selection plumbing.
- **A web interface, OSC, or any transport other than `mod-script-pipe`** - Audacity's own scripting surface is the only integration point; no server hosted by this app (same recorded rule as `daw-integration.md`'s REAPER section).
- **Auto-executing an export, or touching audio** - no analyzer or adapter silently changes audio; the narrator approves every label mutation, same product boundary as REAPER.
- **Distributor-specific pickup formats (Pozotron, ACX, etc.)** - generic label import/export only, same reasoning as the REAPER PRD's Open Question 5.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Scripting spike | A written result: pipe reachable, command/reply round trip measured, failure modes when scripting is off or Audacity is closed | One dated entry in `docs/research/` (spike S-A1) |
| Label identity spike | A written result: whether a label added by the adapter is re-identifiable after a move/split, or what workaround is needed | One dated entry in `docs/research/` (spike S-A2) |
| Finding-to-label round trip | Importing N findings creates N labels; re-running the import twice adds 0 the second time | Adapter test against a scripted Audacity session (or a recorded pipe transcript if live scripting cannot run in CI) |
| Navigate/mark-reviewed | Selecting a finding in the dashboard moves Audacity's cursor/selection to the matching label; marking it reviewed updates the label without duplicating it | Manual scripted run against a real Audacity |
| Export | The exported reviewed-label file's rows match the reviewed findings exactly | Adapter test on a fixture project |
| No unreviewed mutation | 0 label writes to any project the narrator did not explicitly open in the app | Code review plus the spike's failure-mode notes |
| `DAWAdapter` boundary | The REAPER adapter is behaviorally unchanged after the extraction (Phase 2) | Existing REAPER bridge and harness tests pass unchanged |
| Coverage of new Go/Python code | At least 80% (D18 ratchet on any new logic directory) | `go test -cover`, `pytest --cov` |

## Open Questions

- [x] **1. Is `mod-script-pipe` reachable and stable enough from Go on Windows for narrator-triggered, undoable mutations?** Options: (a) spike first (named pipe open/write/read round trip, timing, behavior when scripting is disabled or Audacity is closed), commit to the architecture only after. (b) Assume the documented protocol and build directly. Recommendation: (a) - mirrors D2's "verify before building" for the REAPER Lua harness, and this transport has zero verification today. **Settled:** (a), per the Decisions Log row "Verify `mod-script-pipe` before building on it", confirmed by the owner 2026-09-23: spikes S-A1 and S-A2 come first. This settles the process only; whether the pipe is actually reachable from Go is still to be proven by S-A1 (owner present, Audacity installed), so the answer to the question itself is pending the spike.
- [x] **2. Where does the pipe client live?** Options: (a) a new Go package (e.g. `apps/desktop/internal/audacitybridge`) mirroring the shape of `apps/desktop/internal/bridge` but with its own transport, so both DAWs' review code shares one `DAWAdapter` interface. (b) A small Python helper process, since `mod-script-pipe` examples are mostly Python. (c) Reuse the sidecar-launch machinery (`internal/process`) to run a thin pipe-client script. Recommendation: (a), for the same reason the REAPER bridge is Go: business logic in Go, per `daw-integration.md:7`. **Settled:** (a), confirmed by the owner 2026-09-23: a new Go package (`apps/desktop/internal/audacitybridge`) behind the `DAWAdapter` interface. Reopens only if S-A1 shows Go cannot drive the pipes.
- [x] **3. How does the narrator get from "recording in Audacity" to "the app's workspace is open"?** Audacity has no REAPER-style Action-list launcher. Options: (a) an Audacity macro (a saved `.txt` macro script) that shells out to the app's executable, analogous to `NarrationUtils_Launcher.lua`. (b) The narrator launches the app directly from the Start menu or its own shortcut and picks the project manually (today's "Standalone" launch path already exists). (c) A Nyquist plug-in. Recommendation: (b) first - it needs no new Audacity-side artifact and the standalone launch path is already shipped; revisit (a) only if narrators report it as friction. **Answered 2026-09-23:** (a), overriding the recommendation: ship an Audacity macro launcher, a saved macro that launches the app, analogous to `NarrationUtils_Launcher.lua`. Phase 10 is committed scope, no longer conditional on narrator feedback; the standalone launch (b) keeps working alongside it.
- [x] **4. Label identity and drift.** A label has no GUID; Audacity identifies it by track/time/text. Options: (a) encode the finding ID in the label text itself (e.g. a short prefix or suffix) and treat position drift as expected after edits, re-matching by ID on re-scan. (b) Track labels only by position and accept that edits desync silently. (c) Maintain a sidecar mapping file keyed by finding ID, matched against a scan of current labels by nearest text match. Recommendation: (a) - mirrors the REAPER PRD's own answer to line-identity drift (store identity in the artifact itself, detect drift, never silently re-stamp). **Answered 2026-09-23:** (a), to be confirmed by S-A2: the finding ID is encoded in the label text and labels are re-matched by ID on re-scan, pending S-A2's evidence on what survives a move or split.
- [x] **5. Which findings categories are in scope for the first label import?** The shared schema has twelve categories (`findings-contract.md:31`); not all make sense as a flat label track. Options: (a) any finding with a `time_range` and no REAPER-specific `suggested_action`, regardless of category. (b) Only `transcript_discrepancy` and `pronunciation` (Transcript Compare's own outputs), since those are what the placeholder READMEs describe first. Recommendation: (b) for the first slice - narrows Phase 6/7 scope to what's already documented as the first adapter's job. **Answered 2026-09-23:** (b): the first import covers `transcript_discrepancy` and `pronunciation` only.
- [x] **6. CI verification strategy.** Audacity cannot run headless in CI (no known equivalent to the REAPER Lua harness's fake `reaper` table for a full GUI app). Options: (a) record real pipe transcripts from a manual spike session and replay them as fixtures for the Go client's unit tests (protocol-level fake, not a full Audacity fake). (b) Skip automated coverage of the pipe layer entirely; manual-only, like "REAPER API semantics" checks. (c) Find or build a minimal scriptable-pipe stub that speaks the same reply framing without launching Audacity. Recommendation: (a) - closest to how the REAPER harness fakes `reaper` rather than launching REAPER, and gives the Go client real regression coverage. **Settled:** (a), confirmed by the owner 2026-09-23: replay recorded pipe transcripts as fixtures, as Phases 4 and 6 already assume; the transcripts come from S-A1.
- [x] **7. Packaging.** Does a released build need to ship an Audacity-side artifact (a macro file, a Nyquist plug-in) the way `scripts/release/verify-installable.mjs` lists REAPER's Lua files by name? Depends on the answer to Question 3. Recommendation: revisit once Question 3 is answered; if (b) is chosen, no new release artifact is needed for the first slice. **Answered 2026-09-23:** yes, no longer moot because Question 3 is (a): the release ships the macro file, and Phase 10 lists it in the release check (`scripts/release/verify-installable.mjs`, which reads REAPER's file list from `scripts/release/reaper-files.mjs`) the way REAPER's Lua files are listed.

## Users & Context

**Primary User**

- **Who:** a solo author-narrator recording in Audacity on Windows, who receives proofer feedback or self-reviews for discrepancies and pronunciation issues.
- **Current behavior:** manually re-listens to flagged sections, adds Audacity labels by hand if at all, and has no automated way to bring the suite's Transcript Compare findings into their editing session.
- **Trigger:** Transcript Compare (or another future analyzer) has produced findings for a chapter recorded in Audacity.
- **Success state:** imports the findings as labels in one action, steps through them with the app driving navigation, marks each reviewed, and exports the reviewed set.

**Job to Be Done**
When I finish comparing a chapter, I want the flagged issues to show up where I already work in Audacity, so I don't have to cross-reference a separate report by ear.

**Non-Users**

- Narrators who record in REAPER (already served).
- Anyone expecting take management, pickup lists, or per-chapter render from this adapter - REAPER-only, by design (Evidence).
- macOS/Linux Audacity users (deferred with the rest of non-Windows support, D7).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Verify the `mod-script-pipe` transport is usable for narrator-triggered, undoable mutations (spike) | 1 |
| Must | Verify label identity/drift behavior on move, split, and re-open (spike) | 2 |
| Must | Extract a `DAWAdapter` boundary the review workflow calls through, with the REAPER adapter as its first implementation (behavior-preserving) | 3 |
| Must | Go pipe client: connect, send a command, read a reply, explicit timeout and "Audacity not reachable" reporting | 4 |
| Must | `--daw Audacity` config plumbing and a settings-store smoke test (already DAW-agnostic; prove it, don't rebuild it) | 5 |
| Must | Import findings as labels (Question 5 scope), idempotent re-import | 6 |
| Must | Navigate to a label and mark it reviewed without duplicating it | 7 |
| Should | Export reviewed labels to a hand-off file | 8 |
| Should | Dashboard: findings from an Audacity-sourced project show the Audacity-appropriate actions only (no take-management controls) | 9 |
| Must | An Audacity macro launcher, shipped in the release and checked by `verify-installable.mjs` (Questions 3 and 7) | 10 |
| Won't (this cycle) | Take management, pickup lists, per-chapter render, non-Windows support | - |

### MVP Scope

Phases 1 through 7 (spikes, the adapter boundary extraction, the pipe client, config plumbing, import and mark-reviewed). Export (Phase 8), dashboard integration (Phase 9) and the macro launcher (Phase 10, committed by Question 3) follow immediately after; nothing here needs a new transport, new take-marker semantics, or REAPER's bridge.

### User Flow

1. The narrator runs Transcript Compare against an Audacity-recorded chapter (already possible; the sidecar itself is DAW-neutral). Findings are produced in the shared schema.
2. The narrator runs the Narration Utils macro in Audacity (Question 3, Phase 10), or opens the app standalone, with the Audacity project's folder, and enables Audacity scripting if not already on (a one-time, documented step).
3. The narrator chooses "Import findings as labels." The app shows which findings will become labels and any that already have a matching label (idempotent); nothing is written until approved.
4. The narrator works through labels from the dashboard; "Next" moves Audacity's selection/cursor to the matching label. Marking one reviewed updates its label in place.
5. "Export reviewed" writes the reviewed set to a hand-off file.

## Technical Approach

**Feasibility:** LOW-MEDIUM for Phases 1, 2 (unverified transport and label identity - spikes only). MEDIUM for Phases 3, 4, 6, 7 (new Go package, new protocol client, label mutation logic) once the spikes de-risk them. HIGH for Phase 5 (the settings store needs no new code, per Evidence). MEDIUM for Phases 8, 9.

**Architecture Notes**

- **Transport.** A new Go package speaks `mod-script-pipe` directly (named pipes on Windows: `\\.\pipe\ToSrvPipe` and `\\.\pipe\FromSrvPipe`, per docs), framed as newline-terminated commands with a documented reply sentinel. This is a different shape from the REAPER bridge's polled `.cmd`/`events.log` files (`reaper-bridge.md`) and is not built on top of it.
- **`DAWAdapter` boundary (Phase 3).** Extract the review-workflow-facing operations the REAPER bridge already implements (navigate to a source location, add a reviewable marker/label, mark reviewed, export) into a Go interface; the existing REAPER bridge client becomes its first implementation with no behavior change (covered by its existing tests). This is the same kind of behavior-preserving refactor D2 asked for on the Lua side, applied to the Go-side seam instead. Only after this lands does the Audacity client implement the same interface, so neither the review dashboard nor the host binding layer special-cases DAW type beyond the existing `config.daw` display string.
- **Label mutation (Phases 6, 7).** `SetLabel`/`GetInfo: type=labels`/`Export2` per the scripting reference (unverified - Phase 2 spike proves or corrects this); finding identity is encoded in the label text per Open Question 4's answer (to be confirmed by S-A2), never inferred from position alone.
- **Settings (Phase 5).** No new code: point the existing `--daw` argument at `"Audacity"` and prove the layered settings store resolves correctly with no REAPER-specific assumption tripped (a smoke test, not new logic).
- **Host.** Any new binding follows the existing `h.services()` accessor pattern (`host-binding-concurrency.md`) and bumps `hostAPIVersion` in the three files, same as every other stack; re-check the live value (13 at the time this PRD was written) at merge time.
- **Spikes.** Each spike PR contains a written result (protocol observations, failure modes, timing), any recorded pipe transcript kept as a fixture, and the decision it unblocks. No spike code ships in the product, matching the REAPER PRD's own spike discipline.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| `mod-script-pipe` is unreliable, slow, or has undocumented failure modes | Medium | Spike S-A1 before any adapter code commits to the transport |
| Labels have no stable identity and drift silently after edits | Medium-High | Spike S-A2; encode finding ID in label text (Question 4); detect and report drift, never silently re-add |
| Scripting is disabled by default and narrators don't enable it | Medium | Spike S-A1 documents the exact enable steps; the app reports "Audacity not reachable" with the fix, never fails silently |
| `DAWAdapter` extraction regresses the REAPER bridge | Medium | Behavior-preserving refactor covered by the existing bridge/harness tests before any Audacity code lands (Phase 3 gates Phase 4+) |
| No CI-headless Audacity means the pipe layer is undertested | Medium | Recorded pipe transcripts as fixtures (Question 6); manual scripted runs for anything the fixtures can't prove |
| Scope creep toward take-management parity that doesn't exist in Audacity | Low | "What We're NOT Building" is explicit; any request for parity is a new PRD, not a phase added here |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Reconcile this PRD and the roadmap | Tick this table's phases as they land; correct `docs/roadmap.md` and `config/roadmap.json` (already done by D23 in the same PR that adds this PRD) | complete | - | - | - |
| 1 | Spike S-A1: `mod-script-pipe` reachability | Scripted, isolated run: enable scripting, open both pipes from a small Go program, send a known command, read the reply, measure latency, and record what happens when scripting is off or Audacity is closed | pending | 2 | owner has Audacity installed | - |
| 2 | Spike S-A2: label identity and drift | Add a label, move/split the underlying clip, re-scan labels, record whether the added label is still identifiable and by what signal | pending | 1 | 1 (same session) | - |
| 3 | `DAWAdapter` boundary extraction | Behavior-preserving Go refactor: define the interface from the REAPER bridge's existing operations; REAPER bridge becomes its first implementation; no consumer-visible change | pending | - | - | - |
| 4 | Go pipe client | Connect, send, receive, timeout and explicit "Audacity not reachable" error path; tests against recorded pipe transcripts (Question 6) | pending | 5 | 1, 3 | - |
| 5 | `--daw Audacity` config plumbing | Config parsing accepts `"Audacity"`; settings-store smoke test proves no REAPER-specific assumption is tripped | pending | 4 | - | - |
| 6 | Import findings as labels | Idempotent label creation from findings (Question 5 scope), preview and approval before any write, one narrator-triggered action | pending | 7 | 2, 4 | - |
| 7 | Navigate and mark reviewed | Selecting a finding moves Audacity's selection to its label; marking reviewed updates the label in place, never duplicates | pending | 6 | 6 | - |
| 8 | Export reviewed labels | Writes the reviewed set to a hand-off file matching the reviewed findings exactly | pending | 9 | 7 | - |
| 9 | Dashboard integration | Findings sourced from an Audacity project show only Audacity-appropriate actions (no take-management controls); visual states and docs | pending | 8 | 7, `DAWAdapter` (3) | - |
| 10 | Audacity macro launcher | A saved Audacity macro that launches the app, analogous to `NarrationUtils_Launcher.lua` (Question 3); shipped in the release and listed in `scripts/release/verify-installable.mjs` like REAPER's Lua files (Question 7) | pending | 8, 9 | 5 | - |

### Phase Details

**Phase 0 - Reconcile this PRD and the roadmap**
- **Goal:** the roadmap and the REAPER PRD's stale exclusions stop contradicting an approved parallel workstream.
- **Scope:** `docs/roadmap.md` deferred-work bullet, `config/roadmap.json` `deferred` array, this PRD's own header note; no code.
- **Success signal:** neither doc says Audacity is blocked on the REAPER workflow finishing.

**Phase 1 - Spike S-A1: `mod-script-pipe` reachability**
- **Goal:** learn whether the pipe transport is usable at all before any adapter code depends on it.
- **Scope:** a throwaway Go program (not shipped) that opens the named pipes, sends one documented command, reads the reply, and records latency and error behavior with scripting off and with Audacity closed.
- **Success signal:** a written result in `docs/research/` naming exact latency, framing, and every observed failure mode.

**Phase 2 - Spike S-A2: label identity and drift**
- **Goal:** learn what signal (if any) survives a move or split so a re-added label isn't a duplicate.
- **Scope:** add a labeled point via the pipe, move and split the underlying clip in Audacity's own UI, re-scan labels via `GetInfo: type=labels`, compare.
- **Success signal:** a written result answering Open Question 4 with evidence, not assumption.

**Phase 3 - `DAWAdapter` boundary extraction**
- **Goal:** the review workflow calls one interface regardless of DAW, with zero behavior change for REAPER.
- **Scope:** define the interface from the REAPER bridge's existing public operations; move the bridge client behind it; no new commands, no Lua change.
- **Success signal:** existing REAPER bridge and harness tests pass unchanged; the review workflow's REAPER-specific imports go through the interface, not the concrete client, everywhere it is used.

**Phase 4 - Go pipe client**
- **Goal:** a tested, explicit client for the verified transport.
- **Scope:** connect/send/receive/timeout, a clear "Audacity not reachable" state (mirroring the REAPER bridge's nil-client state per `app.go:169-171`), tests against transcripts recorded in Phase 1.
- **Success signal:** unit tests pass against recorded transcripts; a manual run against a live Audacity confirms the same behavior.

**Phase 5 - `--daw Audacity` config plumbing**
- **Goal:** prove the DAW-agnostic settings store actually works for a second DAW, not just in theory.
- **Scope:** accept `"Audacity"` in `config.daw`; a settings-store integration test that resolves all three tiers with `daw=Audacity`.
- **Success signal:** the smoke test passes with no code change to `narration_common/config.py` beyond what any new tool section would already need.

**Phase 6 - Import findings as labels**
- **Goal:** findings become labels, safely and idempotently.
- **Scope:** preview of what will be created, approval before any write, one pipe transaction per import batch, finding ID encoded per Open Question 4.
- **Success signal:** importing the same batch twice adds 0 labels the second time (harness-style test against recorded transcripts, confirmed manually).

**Phase 7 - Navigate and mark reviewed**
- **Goal:** the narrator drives Audacity from the dashboard without hand-editing labels.
- **Scope:** a "next finding" action that selects/scrolls to the matching label; "mark reviewed" updates the label's text/status in place.
- **Success signal:** marking reviewed never creates a second label for the same finding; manual round trip confirmed in a real Audacity.

**Phase 8 - Export reviewed labels**
- **Goal:** a hand-off artifact leaves the app.
- **Scope:** write the reviewed set to a file (format TBD at planning time - a label-track-compatible export is one option, per docs).
- **Success signal:** the exported rows match the reviewed findings exactly.

**Phase 9 - Dashboard integration**
- **Goal:** the shared review dashboard treats an Audacity-sourced project correctly without new REAPER-shaped assumptions leaking in.
- **Scope:** hide/disable take-management-only controls for Audacity-sourced findings; visual states, screenshots at the standard viewports, docs.
- **Success signal:** PNGs reviewed at desktop, small-desktop, tablet and mobile; no REAPER-only action is reachable from an Audacity project.

**Phase 10 - Audacity macro launcher**
- **Goal:** the narrator reaches the app's workspace from inside Audacity, as REAPER narrators do from the Action list (Question 3, owner decision 2026-09-23; committed scope, not conditional on narrator feedback).
- **Scope:** a saved Audacity macro that launches the app's executable with `--daw Audacity` and the project folder, analogous to `NarrationUtils_Launcher.lua`; shipped in the release and added to the release check (`scripts/release/verify-installable.mjs`, alongside the REAPER list in `scripts/release/reaper-files.mjs`) so a build missing it fails (Question 7); the one-time import step documented in the Audacity guide. Launching an executable from a macro is unverified; check it in the same owner-present session as the spikes or a later one.
- **Success signal:** the release check fails when the macro file is missing; a manual run in a real Audacity opens the workspace on the project.

### Parallelism Notes

Phases 1 and 2 run in one approved spike session (Phase 2 depends on Phase 1's pipe client existing, but both need the owner present with Audacity installed and scripting enabled). Phase 3 (the `DAWAdapter` extraction) has no dependency on the spikes and can start immediately - it is a pure Go refactor of the existing REAPER code path. Phases 4 and 5 can run in parallel once Phase 3 lands. Phases 6 and 7 are sequential (import before mark-reviewed can target anything). Phase 9 needs both the adapter boundary (3) and the finished review loop (7).

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 0 | `docs/roadmap.md`, `config/roadmap.json`, this file | Any other PRD reconciling the roadmap in the same window (D9's unscheduled PRDs do not touch these files, so low risk) |
| 1, 2 | `docs/research/` (new spike results), throwaway scratch code (not committed) | None expected |
| 3 | New `apps/desktop/internal/dawadapter` (or similar) package, `apps/desktop/internal/bridge` (adapting, not rewriting) | Any REAPER PRD phase touching `internal/bridge`'s public surface (stack S22 and later REAPER phases) - land this extraction before or clearly after such a phase, not concurrently |
| 4, 5 | New `apps/desktop/internal/audacitybridge` (or similar) package, `apps/desktop/app.go` config parsing | Low; new files and an additive config branch |
| 6, 7, 8 | New Go files, new bindings, `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/*}`, `Host.{js,d.ts}` | Every session adding a binding: host API version, `app.go` `Host` struct - re-check `hostAPIVersion` at merge time |
| 9 | Review dashboard components (`review-dashboard-and-findings-adoption.prd.md`'s pages once delivered), `tests/visual/*`, `docs/images/ui/*` | The review dashboard PRD itself (stack S22); sequence after its findings store lands, per the existing cross-PRD note "findings store then Review page then take review, continuity and analysis panels" |
| 10 | The macro file, `scripts/release/verify-installable.mjs` (and a file list beside `reaper-files.mjs`), release packaging | Same file every Lua-and-launcher-adjacent PRD touches; add independently and rebase |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Run Audacity work as a parallel stack, not gated on REAPER automation finishing (D23) | Parallel stack, spike-gated on its own unverified transport | Wait for stack S22 to complete first (prior roadmap text) | Owner decision D23, 2026-09-21; the two workstreams share almost no files (Lua vs. a new Go package) |
| Verify `mod-script-pipe` before building on it | Two spikes (S-A1, S-A2) before any adapter code | Build directly from the documented protocol | Same "verify before building" discipline D2 applied to the REAPER Lua harness; this transport has zero verification in this repo |
| Extract a `DAWAdapter` boundary before adding a second DAW | Behavior-preserving Go interface extraction (Phase 3) first | Special-case Audacity alongside REAPER in the review workflow | Avoids `if daw == "REAPER"` branching accumulating in UI/host code, mirrors the REAPER PRD's own registry-over-`elseif` lesson (D2) |
| First adapter scope is import/navigate/mark-reviewed/export only | No take management, no ExtState-equivalent, no pickup lists | Build toward REAPER parity | `docs/architecture/daw-integration.md:40` already committed to this scope; take management has no Audacity analog |
| Settings store needs no new code for a second DAW | Prove it with a smoke test | Build an Audacity-specific settings layer | It was already designed DAW-agnostic (`narration_common/config.py` docstring) |
| Windows-only, first-adapter scope | Matches D7 and the existing REAPER adapter | Cross-platform from day one | No macOS/Linux support anywhere else in the app yet |
| Pipe client location (Question 2) | New Go package `apps/desktop/internal/audacitybridge` behind `DAWAdapter` | Python helper process; sidecar-launched script | Owner decision 2026-09-23; business logic in Go (`daw-integration.md:7`); reopens only if S-A1 shows Go cannot drive the pipes |
| Launcher (Question 3) | Ship an Audacity macro launcher (Phase 10, committed) | Standalone launch only; Nyquist plug-in | Owner decision 2026-09-23, overriding the standalone-first recommendation; parity with `NarrationUtils_Launcher.lua` |
| Label identity (Question 4) | Finding ID encoded in the label text; re-match by ID on re-scan | Position only; sidecar mapping file | Owner decision 2026-09-23, to be confirmed by S-A2's evidence |
| First import scope (Question 5) | `transcript_discrepancy` and `pronunciation` only | Any finding with a `time_range` | Owner decision 2026-09-23; Transcript Compare's own outputs, the first adapter's documented job |
| Pipe-layer tests (Question 6) | Replay recorded S-A1 pipe transcripts as fixtures | Manual only; a hand-built pipe stub | Owner decision 2026-09-23; mirrors the REAPER harness faking `reaper` rather than launching it |
| Packaging (Question 7) | The release ships the macro file and `verify-installable.mjs` checks it | No Audacity-side artifact | Owner decision 2026-09-23; follows from Question 3's macro launcher |

## Research Summary

**Market Context**

- Pozotron already exports pickup marker formats for Audacity among other tools (`reaper-automation-surface.md:240`), evidence that proofer-to-DAW handoff for Audacity is a real workflow, though the export format itself is not retrievable and out of scope here (pickup lists stay REAPER-only per "What We're NOT Building").
- No public tooling was found (in the prior research pass) for importing structured findings into Audacity label tracks from an external review tool; this would be new ground rather than porting an existing script.

**Technical Context**

- Reused, verified: the layered settings store (`narration_common/config.py`), the DAW-neutral finding schema (`findings-contract.md`), the existing `config.daw` free-form field, the standalone launch path (no REAPER dependency needed to open the app).
- Unverified and gated on spikes: the `mod-script-pipe` transport's reliability and framing (S-A1), label identity survival across edits (S-A2).
- Explicitly out of scope by prior decision, not by this PRD's own choice: take management, ExtState-equivalent state, non-Windows platforms (`reaper-automation-follow-through.prd.md:68,112-115`).

---

*Generated: 2026-09-21*
*Status: DRAFT - open questions unanswered; phase 0 (roadmap reconciliation) lands with this PRD; phases 1 and 2 (spikes) need the owner present with Audacity installed and scripting enabled before anything else starts*
