# Wire contracts: how data is checked where it crosses a boundary

**Status: implemented.** Every value that crosses into the UI, and every file the host reads back, is checked at that line, and a wrong shape fails loudly with a specific message. The decision is [ADR 0069](../adr/0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md) (Zod 4 behind `parseWire`, owner decision D16); the work was specified in the runtime schema validation PRD (deleted when it was done: `git show <commit>:docs/prds/boundary-schema-validation.prd.md`, see the [PRD index](../prds/README.md)).

## The boundaries and what checks each

| Boundary | Checked by | Where |
| --- | --- | --- |
| **Host binding result** (Wails string bindings, `Ready`, `Bootstrap`) | `parseWire` with a schema, in `wailsClient.decode` | `apps/ui/src/api/wailsClient.ts`, `schemas/` |
| **Live events** (`transcript:state`, `coverage:state`, `teleprompter:event`, `teleprompter:state`, `system:attached`, `system:notice`, `update:status`, `job:ended`) | `parseWire` per event; a bad one is dropped and counted | `wailsClient.ts`, `wire/liveHealth.ts` |
| **Sidecar to host** (the teleprompter's NDJSON, progress files, `guide.json`) | An envelope check in Go (`type` is a string), `process.ParseProgress`, `persist.CheckVersion`; the UI validates the rest of each event | `internal/teleprompter`, `internal/process`, `internal/guide` |
| **REAPER to host** (`events.log`) | A table of events and their numeric fields, checked before any consumer sees a line | `internal/bridge/wire.go` |
| **The GitHub release list** (the in-app update, [ADR 0072](../adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)) | `update.ParseReleases` in Go, before anything uses it: a capped body, a fixed shape per release, a tag and asset-name allowlist, sizes and digests checked, and every URL built from the compiled-in repository, never read from the list; a release that fails is dropped with a logged reason. The UI validates only the status the host derives from it | `apps/desktop/internal/update/manifest.go`, `schemas/update.ts` |
| **The asset list and the install job** (`AssetsList`, `AssetsInstall*`, `AssetsVerify`, [ADR 0077](../adr/0077-every-asset-install-is-one-job-with-real-bytes-a-second-start-joins-it-and-one-hook-follows-it.md), [ADR 0079](../adr/0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md)) | `assetCatalogSchema`, `assetInstallJobSchema` and `assetVerifyResultSchema` behind `parseWire`; golden files written by a Go test; the Story Bible build answer (`guideBuildResultSchema`, [ADR 0080](../adr/0080-the-story-bible-language-model-is-a-catalog-asset-unpacked-at-install-and-the-build-asks-before-it-downloads.md)) and the dictionary lookup answer (`dictionaryLookupResultSchema`, `system-lookup-*.json`, [ADR 0097](../adr/0097-the-manuscript-reader-word-lookup-uses-the-open-english-wordnet-as-a-downloadable-asset.md)) | `apps/desktop/bindings_assets.go`, `apps/desktop/dictionarylookup.go`, `apps/ui/src/api/schemas/assets.ts`, `schemas/dictionary.ts` |
| **Persisted files** (settings, notes, recents, the last comparison, the Story Bible file) | `persist.Reporter.ReadJSON` by class of data | `internal/persist` |
| **The mock client and fixtures** | The same schemas, in the contract tests | `apps/ui/src/api/wireContracts.test.ts` |

## The UI side

- **`parseWire(schema, payload, { boundary, payload })`** (`apps/ui/src/api/wire/parseWire.ts`) validates a value and throws a `WireError`; `parseWireJson` does the same for the text a string binding returns. It is typed on **Standard Schema** (`wire/standardSchema.ts`), not on Zod, so no caller depends on the library, and a remote JSON payload would use it unchanged. (The in-app update's release list is checked in Go instead, so nothing the network says reaches the UI unchecked.) Only files under `apps/ui/src/api/` import `zod` (the `zod-only-in-api` rule of `.dependency-cruiser.mjs`).
- **A `WireError`** names the boundary, the payload and up to ten failing paths with the rule each broke (`transcript.rows[3].kind: Invalid input: expected string, received number`). It never carries a value: manuscript text can be in a payload. `userMessage` is what a narrator reads ("The app received data it could not read."); `details()` is for "Copy details" and the host log.
- **Schemas** live one file per domain in `apps/ui/src/api/schemas/` and each asserts `satisfies z.ZodType<Contract>` against the hand-written type in `api/contracts/`, so the two cannot drift silently. A schema models what the host **really sends**: where Go sends `null` for a field the contract declares `?:`, `optionalFromNull` maps it to `undefined`; `listFromNull` turns a nil Go slice into an empty list; a missing pronunciation object or marker export takes its default. This replaced every hand-written `normalize*` helper.
- **Lenient inbound, strict in tests.** A schema ignores keys it does not declare (a newer host or sidecar must still load). `schemas/strictness.ts` walks a schema and reports any key in a payload it does not declare; the contract tests use it, so drift is caught in both directions.

## The rule for a new binding, event or persisted file

A pull request that adds one adds, in the same pull request:

1. **A schema** in `apps/ui/src/api/schemas/` for a binding result or a live event, and a `decode(schema, 'Name', host.Name(...))` in `wailsClient.ts` (or `subscribeChecked`). A `decode` without a schema does not exist any more.
2. **A golden payload** where a Go or Python test can produce the real thing: `contractfile.Check(t, "name", value)` in Go (`apps/desktop/internal/contractfile`, with `Stabilize` and `PortablePaths` for random ids, times and machine paths) or `contract_files.check("name", value)` in Python (`libs/python/narration_common/contract_files.py`). The file lands in `tests/fixtures/contracts/`. **These files are generated: run the owning test with `UPDATE_CONTRACTS=1`, review the diff, and update the schema and the mock together.** `.gitattributes` forces LF so CI on Windows compares bytes.
3. **A row in `wireContracts.test.ts`**: the golden file's schema, and a check of the mock's answer. The last test of that file lists every method of `NarrationApi` as checked, void or not a request, so a new binding fails until it has a row.
4. **The mock** must pass the schema. It is built from the same fixtures the visual suite uses, so a mock that drifts from the host fails a test here and not a screenshot later.
5. **`hostAPIVersion`**: an additive change (a new field, a new event) needs no bump; removing, renaming, retyping or newly requiring a field bumps it in the three places (`apps/desktop/app.go`, `app_test.go`, `apps/ui/src/hostApi.ts`).
6. **A visible failure state** only if the payload is page data (below).

`wireCasts.test.ts` fails on any `as` cast (other than `as const`) or `JSON.parse` under `apps/ui/src/api` except the one in `parseWire` and the reasoned test-tooling entries. It is a test and not an ESLint `no-restricted-syntax` rule because the tooling's config-protection hook refuses edits to `eslint.config.js`; add the rule by hand if you want it as well (it would flag a `JSON.parse(...) as T` and a cast of an identifier named `payload`, `value`, `result` or `response`).

## What the narrator sees, by class of payload

| Class | When it is invalid | Where |
| --- | --- | --- |
| **`Ready`, `Bootstrap`** | The startup error screen: "The app received data it could not read.", the technical details and **Copy details**. `Ready` is checked first with a minimal schema, so a host from another release reports "incompatible version" and never "invalid payload". | `StartupScreen.tsx`, `App.tsx` |
| **Page data** (the Manuscript and Story Bible first load) | The page keeps its title and the navigation and shows "This page could not be loaded" with **Retry**. A later reload that fails is a toast, as before. | `components/layout/LoadError.tsx` |
| **A live event** | Dropped and counted, never thrown inside the Wails callback. The host log hears about the first three and then one in fifty (`wire_invalid`). After five, one toast says live updates could not be read. An event of a **type the UI does not know** is a newer sidecar: ignored, named once (`wire_unknown_event`), and not counted. | `wailsClient.ts`, `wire/liveHealth.ts` |
| **An action's failure** (a toast) | `describeApiError` shows the plain message for a `WireError` and keeps every other error's text. | `api/errorMessage.ts` |

The visual suite has states for each: `startup / invalid-payload`, `home / live-updates-degraded`, `manuscript / invalid-payload` and `storybible / invalid-payload`; the mock seams are `?mockInvalidPayload=bootstrap|manuscript|storybible` and `?mockLiveDegraded=1`.

## The host log

`SystemReportDiagnostic` writes to `%APPDATA%\narration-utils\logs\host.log` (`apps/desktop/internal/hostlog`): one line per entry (time, a slug kind, a message of at most 2,000 characters with control characters removed), 1 MiB with one backup. The client reports each `WireError` as kind `wire_invalid`; the host reports persisted-file problems (`persisted_corrupt`, `persisted_unreadable`, `settings_value_ignored`), REAPER events it could not read (`reaper_event_invalid`), progress lines it ignored (`progress_line_ignored`) and teleprompter lines that were not events (`sidecar_line_dropped`). It records where, never what. Nothing is uploaded ([ADR 0032](../adr/0032-analyzers-report-findings-and-never-change-audio-or-manuscript-on-their-own.md)).

## Persisted files (`apps/desktop/internal/persist`)

`Reporter.ReadJSON(path, what, class, decode)` handles a file that cannot be decoded by what it holds:

| Class | Files | What happens |
| --- | --- | --- |
| **Disposable** | Recent projects, the last comparison, the repository's defaults | Logged (`persisted_corrupt`); the reader starts empty and the next save replaces the file. The narrator is not told. |
| **Narrator data** | Notes, reader state and chapter statuses, settings (global and project), the Story Bible file | Kept as `<name>.corrupt-<timestamp>` beside the original, a fresh one is started, the log records it, and the narrator gets a `system:notice` toast naming where the old file is. |
| **Canonical** | `manuscript.json` | Refused with an error, as it already was (it is version-checked by Go and Python). |

Rules that go with it: a file that exists but **cannot be read at all** (a sharing violation, a permission problem) is never replaced: `persist.CanOverwrite` makes a save refuse ("nothing was saved"); readers of one file are serialised, so two concurrent readers keep it once; a Story Bible file with a `schema_version` newer than this host reads (2) is refused with a message and left alone; a setting stored as a real JSON boolean or number is read as its text, and an object or list is ignored and named by key. The services get their reporter through `SetPersist`, and the host builds it in `NewHost` and hands it to each new service in `configureLocked` (a service built without one still keeps a corrupt file).

## REAPER events (`apps/desktop/internal/bridge/wire.go`)

The Lua script is imported into REAPER by the narrator, so it can be older or newer than the app. `CheckEvent` validates each line of `events.log` against a table (the fields after the tag, which are required, which are numbers) before any consumer sees it. An unknown tag passes (additive). The optional tail of `COMPARE_MARKER` (chapter, paragraph, contexts, marker state, existing name, source position, and the item, take and track GUIDs) may be absent or empty, as an older script omits it. An event that fails is counted (`Client.Invalid`), logged and given to the consumers that handle its tag and own its run through `Subscription.Invalid`; it is never delivered as data. Transcript Compare ends its run with a message that names the event and the field ("...`COMPARE_MARKER field 7 (projectTime) is not a number`... Import the script from this app's REAPER folder again") instead of adding a zero-filled row. The table is pinned by `wire_test.go` with the exact lines the Lua harness pins, so the two halves cannot disagree. Adding an event to the bridge means adding it to the table (see [the REAPER bridge](reaper-bridge.md)). A version field on every event line is deferred to the REAPER automation stack (#176).

## Measurements and findings

- **Cost.** Validating every live event fully (owner decision Q7) costs about 0.05 microseconds per event of the recorded teleprompter stream and about 1.4 microseconds for a 30-word `partial`, measured in Node on 2026-09-21; the envelope-only fallback the PRD kept in reserve was not needed. `schemas/teleprompter.test.ts` keeps a budget four orders of magnitude looser, so it fails only if validation ever becomes a real cost.
- **Drift the schemas found the first time they met real payloads** (all fixed): the empty pronunciation object the host fills in, which the hand-written normalizer never handled; `null` for optional fields and empty lists throughout; the voice install job reporting `running` with no `percent` or `error` where the UI polls for `downloading` (so the Story Bible download prompt never showed progress, and the project-attach guard would have needed the same rename, [fixed together](../adr/0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md)); the mock's install prompts carrying keys the host does not send; `runId` and three other transcript fields as `null` where the contract said `undefined`.

## Where things are

| What | Where |
| --- | --- |
| `parseWire`, `WireError`, Standard Schema types, live-event health | `apps/ui/src/api/wire/` |
| Schemas by domain | `apps/ui/src/api/schemas/` (`base.ts` has the null helpers) |
| Contract tests, cast scan | `apps/ui/src/api/wireContracts.test.ts`, `wireCasts.test.ts` |
| Golden payloads and their README | `tests/fixtures/contracts/` |
| Go golden helper, id and path stabilizers | `apps/desktop/internal/contractfile/` |
| Python golden helper | `libs/python/narration_common/contract_files.py` |
| Host log, persisted-file reader, progress parsing, event table | `internal/hostlog`, `internal/persist`, `internal/process/progress.go`, `internal/bridge/wire.go` |
