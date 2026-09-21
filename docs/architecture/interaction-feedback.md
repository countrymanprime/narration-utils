# Interaction feedback: what an action owes the narrator

**Status: implemented.** Every place the UI calls the Go host has a row in a catalog with a verdict against a written standard, a test keeps that inventory honest, the Story Bible actions acknowledge and cannot overlap, and a host job that ends tells the narrator wherever they are. The decisions are [ADR 0075](../adr/0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md) (the standard, the tiers, the catalog) and [ADR 0076](../adr/0076-a-host-job-ends-with-one-job-ended-event-the-app-announces-it-and-the-story-bible-rebuild-may-continue-in-the-background.md) (job-end events, the toast queue, the rebuild in the background; Proposed). The work was specified in the interaction feedback audit PRD (`git log --diff-filter=D -- docs/prds/interaction-feedback-audit.prd.md` finds it); the measurements are in the [latency baseline](../research/interaction-latency-baseline.md).

## The standard

An action is anything a narrator starts (a click, a key, a changed value) that calls the Go host.

1. **Acknowledge** within 100 ms: the control that started it is marked busy.
2. **No double fire**: while it runs, the control and every other control that would start it ignore a press.
3. **Completion does not depend on the page**: a background job ends with a `job:ended` event and the app, not the page that started it, tells the narrator.
4. **Honest progress**: real numbers where the host measures, indeterminate where it does not, never padded or invented ([ADR 0015](../adr/0015-real-progress-only.md)).
5. **No swallowed errors**: a failure is shown where the narrator is looking.

| Tier | Duration | Treatment |
| --- | --- | --- |
| 1 | Under 100 ms | Nothing needed |
| 2 | 100 ms to 1 s | Rules 1 and 2 |
| 3 | 1 to 10 s | Rules 1 and 2, an indeterminate indicator, a completion signal |
| 4 | Over 10 s | Real progress, cancel or dismiss, eligible for an operating system notification |

Where things fall (measured on one machine, see the baseline for its caveats): every Go call is tier 1 (under 10 ms, a settings save about 3 ms); every Story Bible mutation is tier 2 (about 120 to 240 ms in the dev venv, 220 to 380 ms in the frozen sidecar), a Save included since it became one process; a build is tier 3 to 4 (1 to 8 s, more with a spaCy model).

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| `usePendingAction` | `apps/ui/src/hooks/usePendingAction.ts` | One action at a time for a group of controls: `run(key, action)` marks the key pending, refuses every other `run` until it settles, and releases the key even if the action throws. The guard is a ref, so a second Enter in the same tick does nothing. Generalizes `ProjectPicker.runAction`. `isPending(key)`, `isBlockedFor(key)` and `isBusy` drive the controls. |
| `pending` on `Button`, `IconButton`, `ConfirmDialog` | `components/primitives/` | `aria-busy`, a spinner (`motion-safe:animate-spin`), dimmed, the press ignored and no native form submit, and **not `disabled`**, so a keyboard user keeps their place. A pending `ConfirmDialog` also turns Cancel, Escape and the header button off. |
| Toast queue | `components/primitives/Toast.tsx`, `hooks/useToasts.ts` | `ToastRegion` is an own primitive (not Base UI): two always-mounted, non-atomic live regions (errors `role="alert"`, the rest `role="status"`), up to four messages, an identical one restarts its time, information goes after 5 s, **an error stays until it is dismissed**. `notify(text, tone?)` takes `'info'` (the default) or `'error'`; every failure site passes `'error'`. |
| `job:ended` | `apps/desktop/jobs.go`, `apps/ui/src/jobEnded.ts`, `App.tsx` | See the next section. |
| Rebuild in the background | `WorkDialog` `background`, `Guide.tsx` | The Story Bible rebuild's dialog offers Continue in background (and Escape), shows again when the narrator returns while it runs, and the page reloads its rows on the event. |

## Job-end events

The host emits one `job:ended` per finished job, `{ id, kind, outcome, message, durationMs }`, from the goroutine that ran it, after the job is settled and with no lock held (`publishJobEnded`; tests replace it with the `h.jobEvents` sink because the Wails runtime rejects a context it did not make). `outcome` is `success`, `error` or `cancelled`; `message` is a sentence for the narrator.

| Kind | Emitted when | Announced by |
| --- | --- | --- |
| `story_bible` | the build ends | the App-level toast |
| `transcript_compare` | the transcript state leaves an active phase for `success`, `error` or `cancelled` (a reset is not an end) | the App-level toast |
| `manuscript_import` | a commit ends (a ready preview is not an end) | its modal dialog |
| `tts_install`, `whisper_install` | the install ends | its modal dialog |
| `app_update` | the download ends | its modal dialog |

One owner per kind: `toastForJobEnd` returns nothing for a cancelled job and for the kinds whose modal dialog is on screen while they run, so nothing is announced twice. The event reaches every listener, which is what a notification feature reads: `kind` and `durationMs` to decide whether the narrator was waiting, `document.hasFocus()` in the webview to decide whether they were looking (Wails v2 has no window-focus query).

The payload is a wire contract ([wire contracts](wire-contracts.md)): `jobEndedSchema`, the golden files `job-ended-success.json` and `job-ended-error.json`, a row in `wireContracts.test.ts`, and the mock (which ends only the Story Bible rebuild this way: its comparison run is stepped by timers the visual suite drives). An additive event needs no `hostAPIVersion` bump.

## The catalog and its ratchet

- **`apps/ui/src/interactionFeedback.catalog.ts`** has one row for every call of a `NarrationApi` method outside `src/api/`. A site is `<file>::<method>#<n>` (the n-th call of that method in that file, in source order). A row says what triggers the call, what the host does (`instant`, `file-io`, `python`, `job`, `download`, `os-dialog`), how it acknowledges, guards and completes, where a failure goes, whether the outcome survives leaving the page, and a verdict.
- **Verdicts.** `ok` meets the standard. `gap` does not, and its `plan` is a GitHub issue (`#123`). `owned` belongs to other work named in `plan`. `exempt` is on purpose and the note says why (a mount-time load with a page error state, a diagnostic that must never throw).
- **`apps/ui/src/interactionFeedback.test.ts`** fails on a call with no row, a row whose call is gone, a `gap` with no issue, an `ok` row that fails silently or leaves a Python call unacknowledged or unguarded, and any bare catch (`catch {}`, `.catch(() => {})`, `.catch(() => undefined)`) that is not in `SILENT_CATCHES` with its reason. It reads the contracts and the source with the TypeScript parser, so a comment that mentions `api.guideEdit(` is not a call. `SILENT_CATCHES` may only shrink, and a narrator's action never belongs on it.
- **State today:** 110 call sites; no `gap`; 9 `owned` (the voice and Whisper install flows, [#209](https://github.com/countrymanprime/narration-utils/issues/209)); the rest `ok` or `exempt`.

## Adding a call to the host, or a job

1. Write the call. Run `pnpm --dir apps/ui exec vitest run src/interactionFeedback.test.ts`: it names the missing key. Add the row: ask which tier the operation is in (measure it if it spawns Python) and give it the acknowledgment and guard that tier requires. An action that changes the Story Bible goes through `usePendingAction`; a control that starts something slow takes `pending`; a failure is `notify(describeApiError(error), 'error')`.
2. A new kind of background job: emit `job:ended` from the goroutine that ends it (`endedJob` builds the event from values read under the job's lock; publish after releasing it), add its kind to `jobs.go`, decide who announces it in `jobEnded.ts`, and add a Go test with the `jobEvents` sink.
3. A control that is not a `Button` or `IconButton` and needs a busy state gets the same three things: `aria-busy`, a press that does nothing, and focusability. The category `Menu` does not yet ([#211](https://github.com/countrymanprime/narration-utils/issues/211)).

## Measuring

`apps/desktop/internal/latency` is a build-tagged Go test (not in the gate) that drives the real Story Bible service through the real supervisor and the Go calls, for the dev venv or a frozen sidecar (`LATENCY_PYTHON`, `LATENCY_BACKEND`; `LATENCY_GO_ONLY=1` for the Go calls alone). How to run it, the numbers before and after the latency work, and what could not be measured are in the [latency baseline](../research/interaction-latency-baseline.md).

## What is not done

- **The install flows** (voice and Whisper downloads): real byte progress, a guard against a second install job and one shared poll hook are release-readiness Phase 1's ([#209](https://github.com/countrymanprime/narration-utils/issues/209)).
- **Operating system notifications** are the Story Bible and import briefs PRD's (owner decision D8: on by default); they subscribe to `job:ended`.
- **Owner steps** ([#210](https://github.com/countrymanprime/narration-utils/issues/210)): a screen-reader pass on the live regions and busy buttons, a real desktop run of the job-end toast, and the measurements that need a spaCy model, a Piper voice or antivirus.
