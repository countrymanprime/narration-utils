# 0076. A host job ends with one `job:ended` event, the app announces it, and the Story Bible rebuild may continue in the background

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner
- **Related:** Supersedes the "stays blocking" rule of [ADR-0057](0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md) for the Story Bible rebuild (the rest of ADR 0057 stands)

## Context and problem

[ADR 0075](0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md) says a completion must not depend on the page the narrator is on. Before this decision it did: the Story Bible build was polled by an effect in `Guide.tsx` that stopped when the page unmounted (leaving mid-build lost the dialog and the success toast), the import was polled by `Home.tsx`, and the comparison's end only showed on Proofing. The only channel was one toast that lasted 2.4 seconds, the same for a success and for an error.

Owner decision D8 turns OS notifications on by default (unfocused, jobs of about 10 seconds or more) and turns "Build Story Bible after import" on by default. The notification work (the briefs PRD) needs one host-side trigger that says which job ended, how, and how long it took; and a build that follows every import means a blocking, non-cancellable dialog appears after every import for as long as the build runs. [ADR 0057](0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md) kept that dialog blocking under option (a) of the retired dialog PRD and named this stack's completion events as what would make its option (b), "Close and let the job continue in the background", safe.

The owner asked for a new ADR that supersedes or amends ADR 0057 if the audit relaxes it. It relaxes it for one job, so this was written as **Proposed**: it reverses a decision the owner accepted, on the path the audit recommends. The owner accepted it on 2026-09-23.

## Decision drivers

- ADR-0075: a completion must not depend on the page the narrator is on.
- The owner's decision D8 turns OS notifications on by default and turns "Build Story Bible after import" on by default.
- The notification work needs one host-side trigger that says which job ended, how, and how long it took.
- With a build after every import, a blocking, non-cancellable dialog would appear after every import for as long as the build runs.
- ADR-0057 named this stack's completion events as what would make its option (b), "Close and let the job continue in the background", safe.

## Considered options

1. One `job:ended` event per job, announced by the app, with the Story Bible rebuild allowed to continue in the background
2. Keep the status quo: each page polls its own job, and the rebuild dialog stays blocking (ADR-0057 option (a))

## Decision outcome

**Chosen option: one `job:ended` event per job, announced by the app, with the Story Bible rebuild allowed to continue in the background**, because ADR-0075 requires a completion that does not depend on the page, and with build-after-import on by default a blocking rebuild dialog would appear after every import.

- **One event per job, `job:ended`** (`apps/desktop/jobs.go`), emitted from the goroutine that ran the job, after the job is settled and with no lock held. The payload is `{ id, kind, outcome, message, durationMs }`: `outcome` is `success`, `error` or `cancelled`; `message` is a sentence for the narrator (the failure text for an error); `durationMs` is how long the job ran. The kinds are `story_bible`, `manuscript_import` (a commit; a preview that is ready is not an end), `tts_install`, `whisper_install`, `app_update` (the download) and `transcript_compare` (the host turns the transcript service's states into one end per run, on the state leaving an active phase for `success`, `error` or `cancelled`; a reset is not an end).
- **The payload is a wire contract** ([ADR 0069](0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md)): `jobEndedSchema`, golden files `job-ended-success.json` and `job-ended-error.json` written by a Go test, a row in the contract test, and `subscribeJobEnded` on `NarrationApi`. A new event needs no `hostAPIVersion` bump (it stays 9). `kind` is a string so a kind a newer host adds is still delivered.
- **The app announces it** (`App.tsx`, `apps/ui/src/jobEnded.ts`): the App-level subscriber shows a toast for the jobs that can end while the narrator is somewhere else (`story_bible`, `transcript_compare`). It shows nothing for a cancelled job and nothing for the kinds whose own modal dialog is on screen while they run and says so itself (`manuscript_import`, `tts_install`, `whisper_install`, `app_update`): one owner per job kind, so nothing is announced twice. The event still reaches every listener, which is what the notification work reads.
- **Toasts queue, and an error stays.** `Toast` is a small own primitive (not Base UI). Up to four messages are visible, an identical one that is showing restarts its time, information messages go after 5 seconds, **an error stays until it is dismissed** and is announced assertively. `notify(text, tone?)` takes the tone; the error sites pass `'error'`.
- **The Story Bible rebuild may continue in the background.** `WorkDialog` takes an optional `background` handler: while the job runs it shows "Continue in background" (and Escape does the same), and its notice reads "This step cannot be cancelled. You can close this window: it keeps running, and a message appears when it finishes." Only `Guide.tsx` passes it. A rebuild that is still running when the narrator comes back to the Story Bible shows its dialog again (`GuideBuildState` is read on mount), and a rebuild that ends while the dialog is dismissed refreshes the entries from the same event. The page no longer toasts the success itself.
- **What stays blocking.** The manuscript import (past `preparing` it is writing to the project and the pages that need a manuscript depend on it), the downloads and the update keep their modal dialogs as [ADR 0057](0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md) decided, and the rest of that ADR (the notice for a job with no Cancel, no empty action row, reduced motion) stands.

### Consequences

- **Good:** A narrator can leave the Story Bible, or dismiss the rebuild dialog, and still be told when it finished or failed, wherever they are. A failure stays on screen until they dismiss it.
- **Good:** With build-after-import on by default (briefs PRD) the rebuild after an import no longer traps the narrator in a dialog; the briefs PRD's notifier subscribes to `job:ended` and decides whether to raise an OS notification from `kind`, `durationMs` and `document.hasFocus()` in the webview.
- **Neutral:** The mock ends only the Story Bible rebuild through this event: its comparison run is stepped by timers the visual suite drives, and a toast at the end of one would land in every screenshot of the results. The real host emits both.
- **Neutral:** Pressing Build again while a backgrounded rebuild runs is refused by the host with the toast "a Story Bible rebuild is already running"; the dialog reopens when the narrator leaves and returns, not from the button.
- **Neutral:** The toast's two live regions are always mounted, so a message that arrives later is announced. Base UI leaves live regions exposed behind a modal, so the aria snapshots of the dialogs, the slide-over and the drawer ([ADR 0065](0065-aria-snapshots-pin-the-role-trees-of-the-dialogs-the-slide-over-and-the-navigation.md)) now list them (`main` holding an empty `alert` and an empty `status`) next to the dialog; the rest of the page is still hidden.
- **Neutral:** The install flows still poll from their own pages (release-readiness Phase 1 owns them); their events exist so that work, and the notifier, have the one trigger.
- **Neutral:** To change any of this (for example to let the import continue in the background, or to toast an install), write a new ADR that supersedes this one.

### Confirmation

The payload is a wire contract (ADR-0069): `jobEndedSchema`, golden files `job-ended-success.json` and `job-ended-error.json` written by a Go test, and a row in the contract test. The aria snapshots of ADR-0065 list the toast's live regions next to each dialog.

## Pros and cons of the options

### Keep the status quo

- Bad, because the Story Bible build was polled by an effect in `Guide.tsx` that stopped when the page unmounted, so leaving mid-build lost the dialog and the success toast.
- Bad, because the only channel was one toast that lasted 2.4 seconds, the same for a success and for an error.
- Bad, because with build-after-import on by default a blocking, non-cancellable dialog appears after every import for as long as the build runs.
