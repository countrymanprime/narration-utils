# Runtime Schema Validation at the Data Boundaries

**Source:** New work (nothing to supersede). The owner approved "runtime schema validation at the boundaries" as worth doing on 2026-09-20; the library and approach were left open and are Open Questions 1 to 3.
**Type:** Feature (hardening)

Citations are `file:line` on branch `claude/tech-stack-evaluation-7a3bd8` (main at dc9d01a) for anything read in code; "per docs" marks a claim taken from a doc and not re-checked; "TBD - needs research" marks anything unverified. Library facts were checked on 2026-09-20 against vendor pages and the npm registry (Research Summary). This PRD changes no product behavior when payloads are valid; it changes what happens when they are not.

## Problem Statement

Data crosses four boundaries in this app, and at none of them is a payload checked at runtime against a schema. TypeScript types are hand-written, the host returns hand-built `map[string]any` values, and the readers of persisted files fall back to "empty" without saying so. When a payload drifts from its type, the failure shows up far from the cause (a blank chart, a `NaN`, a page that never leaves "loading") or does not show up at all, and the mock client and fixtures that drive the visual suite can silently diverge from what the real host sends. The cost of leaving it: every new binding, sidecar event and persisted file (several concurrent PRDs add all three) widens the surface where a wrong shape is trusted, and nothing tells the narrator or the maintainer that a payload was dropped.

## Evidence

Verified in code. The four boundaries, what types them today, and what validates them:

- **1. JS UI to Go host (Wails bindings): compile-time types only, and the generated types do not cover the payload.** Of 67 generated exports in `apps/ui/wailsjs/go/main/Host.d.ts`, 65 return `Promise<string>` and only `Bootstrap` and `Ready` return `Promise<Record<string, any>>`. Every binding funnels through `encodeBinding` (`apps/desktop/bindings.go:19`), which `json.Marshal`s a value into a string, so Wails has no struct to generate a model from and `apps/ui/wailsjs/go/` holds no `models.ts`. The UI then does `JSON.parse(value) as T` in `decode` (`wailsClient.ts:61-64`), `as HostReady` (`:70`), `as Bootstrap` (`:71`, `:86`) and `as { attached: boolean; reason?: string }` (`:123`). So the premise "Wails-generated TS types already cover the bindings" does not hold here; a regenerated `Host.d.ts` proves signatures, not shapes. Go builds many payloads by mutating maps (`catalog["provider"] = map[string]any{...}`, `apps/desktop/bindings.go:48`) and `Bootstrap` is a single long `map[string]any` literal (`apps/desktop/app.go:588`).
- **2. Go host to Python sidecars: four unrelated mechanisms, three untyped.** (a) Process args plus files: the Guide and Compare sidecars take CLI flags (`--manuscript`, `--out`, `--progress`, `--log`; `sidecars/manuscript-guide/core/manuscript_guide.py:1078-1111`, `sidecars/transcript-compare/core/compare.py:1571-1603`). (b) Progress as a text file, `STAGE|pct|message`, written by `libs/python/narration_common/progress.py` and split with `SplitN(..., "|", 3)` in Go (`apps/desktop/app.go:912`, `apps/desktop/internal/transcript/service.go:431`); a bad percent becomes 0 (`strconv` error ignored). (c) A result document: the Guide writes `guide.json` with `schema_version` 2 (`manuscript_guide.py:32,751,869`) and the Go reader never checks it (`apps/desktop/internal/guide/service.go:33-96` reads `map[string]any` and patches nulls in `normalizeEntity`). (d) Live NDJSON on stdout for the teleprompter (ADR 0021, 0022): `onLine` drops non-JSON lines and relays every JSON line verbatim, reading only `type` (`apps/desktop/internal/teleprompter/service.go:209-227`); the shape of `partial`, `word`, `position`, `script` events is a hand-written TS union (`apps/ui/src/api/contracts/teleprompter.ts:9-34`) and a Python docstring (`live_asr.py:35`).
- **3. Go host to REAPER Lua: a positional, pipe-delimited line protocol, not JSON.** ADR 0031 fixes it. Host to Lua commands lead with `ProtocolVersion` 1 and Lua rejects other versions (`apps/desktop/internal/bridge/bridge.go:14`, `integrations/reaper/narration_ui_bridge.lua:524`). Lua to host events (`events.log`) carry a tag and percent-encoded fields with no version (`narration_ui_bridge.lua:33-42`), and the Go handler picks fields by index: `COMPARE_MARKER` needs at least 9 fields and reads up to index 15 (`apps/desktop/internal/transcript/service.go:314-320`) through `intAt`/`floatAt` helpers that swallow parse errors and return 0 (`:558-565`). A Lua comment already records fields "not yet forwarded" (`narration_ui_bridge.lua:208`), so the field list is a moving target with `integrations/reaper` having no automated tests (`CLAUDE.md`). Unlike the bundled UI and sidecars, the Lua script is imported into REAPER by the user (ADR 0031, Consequences), so it can genuinely be older than the host: this is the one boundary with real version skew at runtime.
- **4. Persisted JSON on disk: mixed, and mostly silent on failure.** `manuscript.json` is version-checked by both Go (`apps/desktop/internal/manuscript/service.go:302-320`) and Python (`libs/python/narration_common/manuscript.py:32-54`), the best case. Others: settings `readDocument` returns an empty map on any parse error and `readTool` drops non-string values (`apps/desktop/internal/settings/store.go:150-171`); recents returns an empty list on corruption by design (`apps/desktop/internal/recents/store.go:100-120`, documented as self-healing); notes fall back to empty (`apps/desktop/internal/manuscript/reader.go:240-255`); `.narration-last-comparison.json` is returned as a raw map with no check (`transcript/service.go:133-142`, written at `:531`); findings have a versioned struct and `Validate` (`apps/desktop/internal/findings/findings.go:18-19,113-133`) but no reader from disk yet. Users upgrade the app over existing files, so this is the second boundary with real version skew.

Drift already shows up in the code as patches and comments:

- `normalizeGuideEntity` exists because sidecars emitted `null` for array fields (`apps/ui/src/api/contracts/storyBible.ts:25-41`), `normalizeTranscriptState` supplies a missing `markerExport` (`wailsClient.ts:45-47`), `normalizeTeleprompterState` accepts a `Partial` (`:49-53`), and `teleprompterEvent` accepts a string or an object "so a transport change cannot silently drop the whole stream" (`:55-59`). Each is a hand-made, one-field validator.
- `TranscriptState` declares `runId?: string` and `trackName?: string` (`contracts/transcript.ts:27-30`), but Go's idle state sets `runId`, `trackName`, `audioItemCount` and `completedAt` to `nil` (`transcript/service.go:40-46`), which serializes as `null`, not absent. The type says the value can be a string or `undefined`; the wire says string or `null`. The comment "Present on completed snapshots from current desktop hosts" (`contracts/transcript.ts:29`) admits older persisted snapshots differ.
- The retired HTTP transport is still in the tree with `JSON.parse(text) as T` (`apps/ui/src/api/client/http.ts:20`); a grep found no importer, so it is dead code carrying the same pattern.
- Live event handlers cast without a check: `payload as TranscriptState` (`wailsClient.ts:138`) and `payload as Partial<TeleprompterState>` (`:152`).

Mock and fixture divergence risk:

- `createMockApi` builds its answers with `as` casts (`as HostReady` `mockApi.ts:287`, `as Bootstrap` `:309`, `as TtsCatalog` `:519`, `as TtsInstallJob` `:523`, `as WhisperCatalog` `:542`); the `WIRE_*` fixtures are typed by annotation only (`mockFixtures.ts:211-466`); the teleprompter mock replays `teleprompterRecording.json` through `as unknown as RecordedStream` (`teleprompterMock.ts:20`). TypeScript proves the mock matches the hand-written type; nothing proves the type matches what Go and Python emit. `wailsClient.test.ts` feeds hand-written strings such as `{ selected: true, jobId: 'import-1' }` (`:16`). No test anywhere loads a payload produced by the real Go or Python code.
- Two mocks do carry provenance: the teleprompter recording came from the real `ScriptTracker` (`teleprompterMock.ts:1-3`); the rest is hand-written.

Version handling today: `hostAPIVersion` is 5 in three places (`apps/desktop/app.go:33`, `apps/desktop/app_test.go:40-41`, `apps/ui/src/hostApi.ts:2`) and the UI checks it once, in `App.tsx:61`, throwing "incompatible with this UI" into the startup error path (`:70-75`). It covers binding signatures only; nothing versions payload shapes, events or the sidecar streams.

Failure handling today (what a policy has to build on):

- `ErrorBoundary` (`apps/ui/src/components/primitives/ErrorBoundary.tsx:6-15`, mounted per route at `App.tsx:191`) catches render errors only, so a rejected decode in an effect or a bad event in a subscription never reaches it.
- The host-side sink for client problems does not exist: `SystemReportDiagnostic` discards its arguments and returns nothing (`apps/desktop/bindings.go:36-39`), so `bootstrap_failed`, `window_error` and `unhandled_rejection` (`App.tsx:71,78-79`) are reported to a no-op. The Go app has no logger beyond `log` in `apps/desktop/main.go`. "Log details host-side" therefore needs a small sink built first (Phase 1).
- Per-page handling of a rejected API call was not audited (TBD - needs a grep sweep in Phase 4).

## Proposed Solution

Add a small `parseWire(schema, payload, context)` helper in `apps/ui/src/api/` that validates every value crossing into the UI, with one schema per payload kept next to the existing contracts, and route `wailsClient` `decode`, the four event subscriptions and the mock client through it. Recommend Zod 4 behind a Standard Schema-typed helper so the library stays swappable. Make invalid data loud and specific: a typed `WireError` naming the boundary, payload and failing paths (never values), logged host-side through a real `SystemReportDiagnostic`, and shown by class (blocking for Ready and Bootstrap, an inline error with retry for page data, a degraded-updates notice for live events). Validate the Go-owned inputs in Go (persisted files, sidecar output, REAPER events) with small hand-written checks and a version policy, because Go cannot run the TS schemas. Make the fixtures the contract: Go and Python tests write real payloads to committed golden files, and the TS contract tests validate both those files and every mock output against the same schemas, so a drifting mock or a drifting host fails CI.

## Key Hypothesis

We believe validating payloads against a schema at each boundary, with one loud failure policy, will catch shape drift where it happens and stop the mock, the types and the real host from diverging for the maintainer and the narrator. We'll know we're right when a deliberately broken sample of each boundary fails a named test and shows a specific message, no boundary payload is consumed through a bare `as` cast, and the mock's outputs are validated by the same schemas as real captures.

## What We're NOT Building

- Changing the `Promise<string>` binding signatures to typed Go structs so Wails generates models: about 65 signatures change, `hostAPIVersion` bumps, and it collides with every PRD that edits `apps/desktop/bindings.go` (Cross-PRD notes). It would also give compile-time types only, which is the gap this PRD exists to close.
- Rewriting Go payloads from `map[string]any` to structs, or generating JSON Schema from Go struct tags: most payloads have no struct (Evidence 1). Revisit for findings, which already has one.
- Pydantic in the sidecars: not a direct dependency (`pyproject.toml` lists `fastapi==0.141.1`, no Pydantic; whether frozen sidecars would grow is TBD) and the sidecars emit hand-built dicts.
- Lua changes in the MVP: `integrations/reaper` has no tests (`CLAUDE.md`) and the recorded call is Lua-only-for-now (ADR 0031); Go validates the events it receives.
- Validating audio, media bytes or the `/media` route; only structured payloads.
- Any telemetry or upload of failures: ADR 0032 keeps analysis and data local; logs stay on the machine.
- A new event transport or a change to the ADR 0021/0022 event contract.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Boundary payloads consumed through a bare `as` or unchecked `JSON.parse` | About 17 sites today (`wailsClient.ts`, `http.ts`, mock casts; counted by reading), 0 in `api/` non-test code | ESLint `no-restricted-syntax` rule plus a grep in the phase 7 gate |
| Broken sample per boundary fails a named test with a specific message | 4 of 4 boundaries | Contract tests with one deliberately bad fixture each |
| Mock outputs validated by the real schemas | Every `NarrationApi` method's mock result | One table-driven vitest over `createMockApi` |
| Real payload captured and validated | Go and Python golden files for every schema | Golden files regenerated in Go/Python tests; diff must be empty in CI |
| Silent fallbacks in persisted readers | 6 silent today (settings, recents, notes, last comparison, hints, guide schema) | 0 silent: each logs, or preserves the file and tells the narrator |
| Live-event cost | TBD - measure at the recorded event rate in Phase 2 | vitest bench over `teleprompterRecording.json` |
| Host API version | Unchanged by this PRD unless a phase makes a payload-breaking change | `hostAPIVersion` diff in each PR |

## Open Questions

- [ ] **1. Library or approach (owner decision).** Options: (a) Zod 4 (full API), behind a `parseWire` helper typed on Standard Schema; (b) Zod Mini or Valibot for the smallest bundle; (c) hand-written type-guard parsers for the 5 to 10 core payloads (Ready, Bootstrap, TranscriptState, TeleprompterEvent union, RecentProject, GuideEntity, TracksProject, WorkJob); (d) generate schemas from one source (Go struct tags to JSON Schema, Pydantic, or Wails models) then generate TS; (e) do nothing. Recommendation: (a). Size is a footnote for a desktop app (Research Summary), the repo's near-zero runtime dependency stance is relaxed where a dependency buys real behavior (the owner has accepted Base UI on that basis; it is not in `apps/ui/package.json` in this worktree, TBD - confirm the merged state) and here it buys the schema, inference and readable error paths the hand-written route would reinvent; Zod also has first-party `z.toJSONSchema()` for a later Go/Python check and matches the owner's global TypeScript rule ("Use Zod for schema-based validation"). (c) is the fallback if the owner keeps the zero-dependency line: it is workable for the 8 payloads above but grows into a private schema library at 65 bindings. (d) does not fit: the payloads have no Go structs (Evidence 1). Even so, isolating schemas behind `parseWire` keeps (a) to (b) or Valibot a mechanical swap.
- [ ] **2. Unknown fields: strict or lenient.** Options: (a) lenient on inbound reads (unknown keys ignored or kept) and strict only in contract tests; (b) strict everywhere; (c) lenient everywhere. Recommendation: (a). A newer sidecar or a file written by a future version must still load (forward compatibility), while a test that fails on an undeclared key in a fixture or a mock catches drift in both directions. Mechanism for the strict test mode is TBD - needs a spike (not verified in either library).
- [ ] **3. Where the schemas live.** Options: (a) TypeScript in `apps/ui/src/api/schemas/` beside `contracts/`, with committed golden payloads under a shared folder (name TBD, for example `tests/fixtures/contracts/`) written by Go and Python tests; (b) JSON Schema files as the source, generated into TS, Go and Python validators; (c) Go-owned (struct tags). Recommendation: (a). It matches where the failure is felt, needs no new toolchain, and the golden files give Go and Python a contract without code generation. Export JSON Schema later (Could) if a second consumer needs it. Migration of types: keep `contracts/*.ts` types and assert `schema satisfies z.ZodType<T>` so parallel PRDs are not blocked, then move a domain to `z.infer` once it is quiet.
- [ ] **4. Failure UX by payload class.** Options: (a) any invalid payload sends the whole app to the startup error screen; (b) per class: Ready or Bootstrap invalid blocks with the existing startup error (`App.tsx:70-75`) and "copy details"; page data invalid shows an inline error state with retry and leaves navigation working; a live event invalid is dropped, counted, and after a threshold shows a "live updates degraded" notice; (c) throw everything to `ErrorBoundary`. Recommendation: (b). (a) is a wall for a bug in an optional page, and (c) does not work because most failures are in effects and subscriptions, which the boundary cannot catch. Message text is user-friendly ("The app received data it could not read"); paths and types go to the host log only.
- [ ] **5. Host log sink.** Options: (a) implement `SystemReportDiagnostic` to append to a size-capped local log file (location TBD - needs research on the app-data directory the recents store already uses); (b) write to the Wails runtime logger only; (c) leave to a separate diagnostics PRD (TBD - none found that owns host logs). Recommendation: (a), scoped to a few dozen lines in Phase 1, log only boundary, payload name, failing paths and types, never values (manuscript text can be sensitive).
- [ ] **6. Corrupt or unreadable persisted files.** Options: (a) keep self-healing but log; (b) rename to `<name>.corrupt-<timestamp>`, start fresh, and tell the narrator; (c) refuse to proceed with an error. Recommendation: per class: disposable state (recents) (a); narrator-authored data (notes, reader state, Story Bible edits and locks, settings) (b); the canonical manuscript (c), as it already is (`manuscript/service.go:314-318`). This reverses nothing recorded; the recents "self-healing" comment stays true.
- [ ] **7. Live-event validation cost.** ADR 0022 records that event cost through Wails is unmeasured. Options: (a) validate every event fully; (b) full validation for `script`, `position`, state events and an envelope check (`type` plus numeric fields) for `partial` and `word`; (c) sample. Recommendation: start with (a), measure in Phase 2 against `teleprompterRecording.json`, and fall back to (b) only if it shows a cost.
- [ ] **8. Versioning payloads and events.** Options: (a) additive changes need no bump, and removing, renaming, retyping or newly requiring a field bumps `hostAPIVersion`; (b) a separate `payloadVersion`; (c) add a version field to Lua events (needs a manual REAPER checklist per ADR 0031). Recommendation: (a) now, (c) as a follow-up inside the REAPER automation PRD; (b) only if (a) proves too coarse.
- [ ] **9. ADR.** Library choice, failure policy and the additive-change rule are decisions. Recommendation: one ADR after Phase 1 lands (next free number at merge time; 0037 at dc9d01a), not before.

## Users & Context

**Primary User**
- **Who**: the maintainer and any session adding a binding, event or persisted file; secondarily the narrator, who today sees blank or stuck screens when a payload is wrong.
- **Current behavior**: adds a field in Go, adds it to a TS type by hand, adds it to `mockApi` by hand, and finds a mismatch only when a screen misbehaves; drops or zeroes bad sidecar and REAPER fields without a trace.
- **Trigger**: a new PRD adds bindings or events (several do); an upgrade meets an old file; a sidecar or REAPER script is older or newer than the host.
- **Success state**: a wrong shape fails a test in CI, or in the app shows a specific, recoverable message and a host log line naming the boundary and paths.

**Job to Be Done**: When data crosses into the UI or is read from disk, I want a wrong shape to fail loudly at that line, so I never debug a blank screen that started in another process.

**Non-Users**: narrators do not interact with schemas; they see only the error states and the "copy details" text.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | `parseWire` helper, `WireError`, schema per payload, one library decision recorded in an ADR |
| Must | Real `SystemReportDiagnostic` host log; failure policy by payload class wired into startup, pages and subscriptions |
| Must | Validation of the live event streams and `system:attached` (`transcript:state`, `teleprompter:event`, `teleprompter:state`) |
| Must | Contract tests: mock outputs and Go/Python golden payloads validated by the same schemas |
| Should | Bindings' request/response schemas for all 65 string bindings, by domain |
| Should | Go-side readers: version policy and logged fallbacks for persisted files; table-driven parsing of `events.log` fields; envelope check in teleprompter `onLine` |
| Could | Replace `normalizeGuideEntity`, `normalizeTranscriptState`, `normalizeTeleprompterState` with schema defaults; export JSON Schema; event version field in Lua |
| Won't | Typed Wails structs, Go struct-tag generation, Pydantic, Lua changes in the MVP, telemetry |

### MVP Scope

Phases 1 to 3: helper, failure policy and host log, live streams, and the contract tests with golden payloads. Phases 4 to 7 follow.

### User Flow

Developer: change a Go payload, run the Go test that rewrites the golden file, see the TS contract test fail on the schema, update the schema and mock together. Narrator: a payload that fails validation shows "The app received data it could not read" with Retry and Copy details, the rest of the app keeps working, and the host log names the payload and failing paths.

## Technical Approach

**Feasibility**: HIGH for the UI and mock work (a helper plus per-payload schemas). MEDIUM for Go-side persisted readers (behavior choices per file, Open Question 6) and the REAPER event table (no automated Lua tests to prove field order).

**Architecture Notes**
- **Helper.** `parseWire<T>(schema, payload, ctx)` where `ctx` is `{ boundary, payload }`; on failure it throws `WireError` with a redacted issue list (path and expected type, no values) and a stable user message. `decode` in `wailsClient.ts` becomes `decode(schema, request)`; `subscribe*` callbacks parse before calling the listener and route a failure to the degraded-updates notice instead of throwing inside the event callback.
- **Order of checks.** Validate `Ready` with a minimal schema (just `apiVersion`, `diagnosticId`) before anything else, so a stale host reports "incompatible version" and not "invalid payload" (`App.tsx:61`). Only then validate `Bootstrap` and the rest.
- **Nullable and optional fields.** Model what the wire really sends (`null`), with schema defaults doing the work of the current `normalize*` helpers; do not change Go's `nil` values, which would be a payload change.
- **Golden files.** Go tests marshal real snapshots (transcript idle and success, catalog, Bootstrap, guide entities) and Python tests run a sidecar on a tiny fixture (teleprompter NDJSON from `--wav` replay, guide `--out`) into the committed folder; the tests compare with the committed copy and fail on a difference, the same way an empty `Host.*` diff is the check elsewhere. The existing `teleprompterRecording.json` is the first golden file.
- **Go side.** Small `validate` functions per persisted document (no library, Go's `encoding/json` decode into a typed struct is enough for most), a shared "fallback happened" logger, and a table in `apps/desktop/internal/bridge` mapping each event tag to its minimum field count and per-field types, replacing `intAt`/`floatAt` silent zeros with a logged, surfaced error.
- **Files this touches**: `apps/ui/src/api/*`, `apps/ui/src/App.tsx` (startup and notice), `apps/desktop/bindings.go` (`SystemReportDiagnostic`, unchanged signature), `apps/desktop/internal/{guide,settings,recents,manuscript,transcript,teleprompter,bridge}`, new Go and Python tests, `apps/ui/package.json` (one dependency), an ADR.
- **CLAUDE.md gates.** `change-impact-scan` before touching `apps/ui/src/api` and `apps/desktop/bindings.go`; `full-verification-gate` with `pnpm check`; the Playwright suite and atlas when a phase adds a visible error state (`apps/ui` changed), including screenshot review across all four viewports and `visual-catalog-sync` for the new states; `design-spec-guard` if an error state edits primitives; no `integrations/reaper` change, so no manual REAPER step unless Open Question 8(c) is later taken.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Schemas reject payloads that work today (fields the UI never reads) and break a screen | Medium | Lenient reads (Open Question 2), contract tests built from real captures first, land per domain |
| Merge conflicts with PRDs adding bindings, events and Lua commands | High | Additive helper first; per-domain schema files; see compatibility table |
| Live-event validation adds visible latency | Low | Measure in Phase 2 (Open Question 7) with the envelope fallback |
| Host log leaks manuscript text | Low | Log paths and types only; test that redaction holds |
| Golden files go stale or are hand-edited | Medium | Generated by tests and diffed in CI; header comment says so |
| Two definitions (type and schema) drift during migration | Medium | `satisfies z.ZodType<T>` assertion per schema until types are inferred |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Foundation: helper, failure policy, host log | Add the library, `parseWire`, `WireError`, real `SystemReportDiagnostic` log, startup and notice UI, schemas for `Ready` and `Bootstrap`, ADR | pending | - | - | - |
| 2 | Live streams | Schemas and validation for `teleprompter:event`, `teleprompter:state`, `transcript:state`, `system:attached`; Go envelope check; cost measurement | pending | 3 | 1 | - |
| 3 | Contract tests and golden payloads | Golden files from Go and Python, table-driven validation of `createMockApi` and `WIRE_*`, lint rule against bare casts | pending | 2 | 1 | - |
| 4 | Binding results, part 1 | `decode(schema, ...)` for Manuscript, Story Bible and Project bindings; replace `normalizeGuideEntity`; audit page error handling | pending | 5, 6 | 1, 3 | - |
| 5 | Binding results, part 2 | Same for Transcript, Tts, Whisper, Tracks, Settings, Teleprompter start | pending | 4, 6 | 1, 3 | - |
| 6 | Persisted files and sidecar outputs (Go) | Version policy, logged fallbacks and corrupt-file handling; `guide.json` `schema_version` check; progress line parsing | pending | 4, 5 | 1 | - |
| 7 | REAPER events and cleanup | Table-driven `events.log` parsing in Go; remove dead `api/client/http.ts` and superseded `normalize*`; final cast sweep; `feature-cleanup` | pending | - | 2, 4, 5, 6 | - |

### Phase Details

**Phase 1 - Foundation: helper, failure policy, host log**
- **Goal**: one way to validate and one way to fail, proven on the two payloads every session uses.
- **Scope**: dependency and `parseWire` in `apps/ui/src/api/`; `SystemReportDiagnostic` appends redacted lines to a capped local file; startup screen shows the version mismatch or the invalid-payload message with "copy details"; `Ready` and `Bootstrap` schemas; ADR (library, failure policy, additive-change rule).
- **Success signal**: a bad `Bootstrap` in a test shows the specific startup error and a log line; the version-mismatch test (`App.test.tsx:56`) still passes; `pnpm check` green.

**Phase 2 - Live streams**
- **Goal**: the highest-risk boundary (unversioned, high volume, currently cast) fails loudly.
- **Scope**: schemas for the five teleprompter event types and both state events; parse in the four subscriptions; degraded-updates notice; Go `onLine` checks that `type` is a string and logs a dropped line count; benchmark on the recorded stream.
- **Success signal**: an unknown or malformed event does not throw inside `EventsOn`, is counted and logged, and the page keeps working; measured cost recorded.

**Phase 3 - Contract tests and golden payloads**
- **Goal**: the mock, the types and the host cannot drift apart unnoticed.
- **Scope**: golden files written by Go and Python tests; a vitest that validates each golden file and every `createMockApi` result and `WIRE_*` fixture; ESLint restriction on `as` after `JSON.parse` in `api/`; one bad fixture per boundary.
- **Success signal**: editing a mock field to the wrong type fails a test; regenerating the golden files on a clean tree produces no diff.

**Phases 4 and 5 - Binding results**
- **Goal**: every binding result is validated. **Scope**: per-domain schema files, `decode(schema, ...)` for the 65 string bindings split in two, inline error states with retry. **Success signal**: no `decode<T>` without a schema; visual suite and atlas green, all four viewports reviewed for new error states.

**Phase 6 - Persisted files and sidecar outputs (Go)**
- **Goal**: no silent fallback. **Scope**: per Open Question 6, log or preserve-and-notify for settings, recents, notes, last comparison, hints, guide; check `guide.json` `schema_version` 2; typed parse of `STAGE|pct|message`. **Success signal**: table-driven Go tests with corrupt and future-version files; `go -C apps/desktop test ./...` green.

**Phase 7 - REAPER events and cleanup**
- **Goal**: the pipe protocol fails loudly without touching Lua. **Scope**: event table in `apps/desktop/internal/bridge` with minimum field counts and types, logged and surfaced errors, tests using recorded `events.log` lines; delete `api/client/http.ts` if still unreferenced; remove superseded normalizers; docs and ADR bookkeeping. **Success signal**: a truncated `COMPARE_MARKER` line produces a visible, logged error, not a zero-filled row.

### Parallelism Notes

Phase 1 lands first. Phases 2 and 3 are independent (streams versus fixtures). Phases 4, 5 and 6 touch different files (UI domain schemas, UI domain schemas, Go readers) and can run together once 1 and 3 exist; keep one schema file per domain to make rebases trivial. Phase 7 last.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/ui/package.json` and lockfile, `apps/ui/src/api/wailsClient.ts`, `App.tsx`, `apps/desktop/bindings.go` (`SystemReportDiagnostic` body only), new `apps/ui/src/api/schemas/` | Medium: `App.tsx` and `wailsClient.ts` are edited by most feature PRDs; `apps/desktop/bindings.go` body edit sits beside the host binding data race PRD's rewrite (see Cross-PRD notes) |
| 2 | `wailsClient.ts` subscriptions, `contracts/teleprompter.ts`, `apps/desktop/internal/teleprompter/service.go` | High: `teleprompter-manuscript-integration` and `teleprompter-engines-and-input-devices` PRDs add events and state fields |
| 3 | `apps/ui/src/api/mockApi.ts`, `mockFixtures.ts`, new Go and Python tests, ESLint config | Medium: every PRD that adds a binding also edits the mock |
| 4, 5 | `wailsClient.ts` (each domain's lines), `contracts/*.ts` | High: same file as every new binding; land one domain per PR |
| 6 | `apps/desktop/internal/{settings,recents,manuscript,transcript,guide}`, `analysis-evidence-ledger` new stores | Medium: that PRD adds persisted files with its own version rule |
| 7 | `apps/desktop/internal/bridge`, `transcript/service.go` | Medium to high: REAPER automation and review dashboard PRDs add events the table must include |

Cross-cutting: `hostAPIVersion` is not bumped by this PRD; a phase that tightens a payload incompatibly (removing a field the UI reads) follows the README rule, bumps in all three places, and rebases against the other PRDs that bump. New bindings from other PRDs should add a schema in the same PR once Phase 1 lands, or list it in a follow-up. Check `docs/adr/` numbering at merge time. Add this PRD to the README index (Type: Feature (hardening)) and to its Cross-PRD sequencing list when it lands.

### Cross-PRD notes

- **Host binding data race** (`host-binding-data-race.prd.md`): rewrites nearly every binding body to use `h.services()`, changes no signatures and does not bump. This PRD's Go-side edits to `bindings.go` are limited to `SystemReportDiagnostic`; do not start Phase 6 or 7 edits in the same regions before its Phases 2 and 3 merge. Choosing typed Wails structs (Not Building) would conflict directly.
- **Analysis evidence ledger**: proposes schema versions with "unknown version is treated as absent, never an error" (`analysis-evidence-ledger.prd.md:154`). Compatible with Open Question 6 if "absent" also logs; align both PRDs on the same persisted-file version policy.
- **Base UI primitive foundation** (`base-ui-primitive-foundation.prd.md`, untracked when this was written): its Phase 1 also edits `apps/ui/package.json`, the lockfile, `eslint.config.js` and takes an ADR number. Land the two dependency changes one at a time (lockfile and ESLint flat-config conflicts) and re-check the next free ADR number at merge time; it sets the precedent this PRD relies on for accepting a runtime dependency where it buys behavior.
- **REAPER automation follow-through**: keeps the file protocol, one dispatcher, single event cursor, and plans a stub-`reaper` harness. Phase 7's event table is the Go half of that; new events (`LINES_*`, `REGIONS_CREATED`) must be added to it.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Runtime validation at the boundaries is worth doing (owner, 2026-09-20) | Adopt | Do nothing | Owner approval; library left open |
| The REAPER bridge is a Lua file protocol, verified by hand (prior decision, ADR 0031) | Keep; Go validates events, no Lua change in the MVP | Add version to events now | Lua has no tests |
| Live events pass through Wails as JSON, unvalidated by the relay (prior decision, ADR 0022) | Keep the relay verbatim; validate in Go's `onLine` envelope and in the UI | Reshape events in Go | Preserves ADR 0021 contract |
| Analysis is local, nothing is uploaded (prior decision, ADR 0032) | Logs stay local, values redacted | Remote error reporting | Product boundary |
| Library | Zod 4 behind Standard Schema-typed `parseWire` (proposed) | Valibot, Zod Mini, hand-written, generated, none | Ergonomics, first-party JSON Schema, swappable; size irrelevant on desktop |
| Unknown fields | Lenient reads, strict contract tests (proposed) | Strict everywhere | Forward compatibility with drift detection |
| Schema location | TypeScript schemas plus Go/Python golden files (proposed) | JSON Schema source, Go tags | No new toolchain; payloads lack Go structs |
| Failure UX | By payload class (proposed) | Whole-app error, ErrorBoundary only | ErrorBoundary misses async failures |
| Persisted corrupt files | Per class: log, preserve and notify, or refuse (proposed) | One rule | Data value differs |
| Version rule | Additive: no bump; breaking: bump `hostAPIVersion` (proposed) | Separate payload version | One existing mechanism |

## Research Summary

**Market Context**
- Vendor claims, checked 2026-09-20 (not independently benchmarked): Zod 4 core is 5.36 kb gzip and Zod Mini 1.88 kb (zod.dev/v4); Valibot's comparison page reports a login-form bundle of 1.37 kB against 17.7 kB for Zod (esbuild) and 6.88 kB for Zod Mini, and similar runtime speed to Zod 4 (valibot.dev/guides/comparison). The two measure different things (library core versus one form's tree-shaken output), so treat both as footnotes: this is a desktop app and bundle size is not a decision factor.
- Both libraries offer strict, loose and default-strip object modes and discriminated unions (Zod: `strictObject`, `looseObject`, `discriminatedUnion`; Valibot: `strictObject`, `looseObject`, `variant`); Zod 4 ships `z.toJSONSchema()` and Valibot a separate `@valibot/to-json-schema` package. npm registry versions on 2026-09-20: `zod` 4.6.5, `valibot` 1.5.0, `@valibot/to-json-schema` 1.8.0, `json-schema-to-typescript` 16.0.0.
- Wails v2 generates TypeScript models only for structs used as bound-method parameters or results (wails.io docs); this app binds strings and maps, so none exist. `invopop/jsonschema` generates JSON Schema from Go types (Draft 2020-12); Pydantic's `model_json_schema` does the same for models. Both need typed models this repo lacks at the payload level.

**Technical Context**
- Verified in code: the four boundaries and their mechanisms, the `Promise<string>` binding surface and absent `models.ts`, the cast sites, the `null` versus `?:` mismatch, the silent persisted-file fallbacks, the no-op diagnostic sink, and the single `hostAPIVersion` check.
- Not verified: behavior of Zod or Valibot inside the Wails WebView2 host and the visual suite (TBD - Phase 1 spike); Zod 4 latency at the teleprompter event rate (TBD - measure); whether frozen sidecars carry Pydantic (TBD); the merged state of the Base UI dependency; per-page handling of rejected API calls (TBD - audit in Phase 4); which PRDs will add events during this work (per docs, several).

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
