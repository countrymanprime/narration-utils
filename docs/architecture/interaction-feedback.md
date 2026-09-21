# Interaction feedback: what an action owes the narrator

**Status: the standard and its catalog are implemented; the fixes are landing phase by phase** (the audit's phases 3 to 6 are in the [PRD](../prds/interaction-feedback-audit.prd.md) until the last one deletes it and rewrites this page as steady state). The decision is [ADR 0075](../adr/0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md); the measurements it stands on are in the [latency baseline](../research/interaction-latency-baseline.md).

## The standard

An action is anything a narrator starts (a click, a key, a changed value) that calls the Go host.

1. **Acknowledge** within 100 ms: the control that started it is marked busy.
2. **No double fire**: while it runs, the control and every other control that would start it ignore a press.
3. **Completion does not depend on the page**: a background job ends with a `job:ended` event and the app, not the page, tells the narrator.
4. **Honest progress**: real numbers where the host measures, indeterminate where it does not, never padded or invented.
5. **No swallowed errors**: a failure is shown where the narrator is looking.

| Tier | Duration | Treatment |
| --- | --- | --- |
| 1 | Under 100 ms | Nothing needed |
| 2 | 100 ms to 1 s | Rules 1 and 2 |
| 3 | 1 to 10 s | Rules 1 and 2, an indeterminate indicator, a completion signal |
| 4 | Over 10 s | Real progress, cancel or dismiss, eligible for an operating system notification |

Where things fall today: every Go call is tier 1 (under 10 ms); every Story Bible mutation is tier 2 or 3 (each is a Python process, 280 ms and up); a build is tier 3 to 4.

## The catalog and its ratchet

- **`apps/ui/src/interactionFeedback.catalog.ts`** has one row for every call of a `NarrationApi` method outside `src/api/`. A site is `<file>::<method>#<n>` (the n-th call of that method in that file, in source order). Each row says what triggers the call, what the host does (`instant`, `file-io`, `python`, `job`, `download`, `os-dialog`), how it acknowledges, guards and completes, where a failure goes, whether the outcome survives leaving the page, and a verdict.
- **Verdicts.** `ok` meets the standard. `gap` does not, and `plan` says who fixes it: a phase of the audit while it runs, a GitHub issue (`#123`) once filed. `owned` belongs to other work named in `plan` (the voice and Whisper install flows: release-readiness Phase 1). `exempt` is on purpose and the note says why (a mount-time load with a page error state, a diagnostic that must never throw).
- **`apps/ui/src/interactionFeedback.test.ts`** fails on a call with no row, a row whose call is gone, a `gap` with no plan, and an `ok` row that fails silently or leaves a Python call unacknowledged or unguarded. It reads the contracts and the source with the TypeScript parser, so a comment that mentions `api.guideEdit(` is not a call.
- **Silent catches.** The same test fails on a bare `catch {}` (a comment inside does not count), `.catch(() => {})` or `.catch(() => undefined)` that is not in `SILENT_CATCHES` in the catalog file, each with the reason it is safe. The list may only shrink, and a narrator's action never belongs on it.

## Adding a call to the host

1. Write the call. 2. Run `pnpm --dir apps/ui exec vitest run src/interactionFeedback.test.ts`: it names the missing key. 3. Add the row: ask which tier the operation is in (measure it if it spawns Python; `apps/desktop/internal/latency` is the harness), and give it the acknowledgment and guard that tier requires. A row that says `gap` needs a plan and, before it merges, a filed issue.

## Measuring

`apps/desktop/internal/latency` is a build-tagged Go test (not in the gate). It drives the real Story Bible service and the Go calls and prints p50, p95 and max. How to run it, and the results of the 2026-09-21 run, are in the [latency baseline](../research/interaction-latency-baseline.md).
