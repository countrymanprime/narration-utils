# 0015. Progress bars and activity logs show real work only

- **Status:** Accepted
- **Date:** 2026-09-18

## Context and problem

The import and Story Bible rebuild dialogs looked broken: the preview step's progress bar and log window did nothing, and after choosing Import the bar moved part way, stalled, then jumped to the end while the log said only "Waiting for activity…". The cause was that the numbers were placeholders, not measurements:

- The host never appended import log lines and set the preview to 100% the instant it finished.
- `Commit` blocked, and the UI faked a 12% step, appended its own log line, and padded the result with a 450 ms minimum delay (`MIN_IMPORT_ACTIVITY_MS`) so the dialog would not flash by.
- The slow part — seeding each checked character suggestion by launching a Python process — ran after the job had already been reported, in the binding.
- The Story Bible build passed progress and log file paths to the Python sidecar, which wrote real stages, but the host only read the log after the build finished and never read the progress file at all.

## Decision drivers

- The import and Story Bible rebuild dialogs looked broken because their numbers were placeholders, not measurements.
- A stage that looks stalled should really be stalled.

## Considered options

1. Progress and log lines come from the code doing the work, and the UI only displays them
2. Keep the status quo: placeholder progress, UI-faked steps and log lines, and a minimum-duration delay

## Decision outcome

**Chosen option: progress and log lines come from the code doing the work, and the UI only displays them**, because placeholder numbers made the dialogs look broken, while measured progress is honest rather than paced.

Progress and log lines are produced by the code doing the work, and the UI only displays them.

- **Import** (`shell/internal/manuscript/service.go`): `StartPreview` and `StartCommit` run as background jobs and return immediately. `report(job, percent, message)` moves the bar and appends the log line together, and progress never moves backwards. The importer reports real stages through `importer.Progress` (`BuildDraftProgress`): opening, reading structure, paragraph and heading counts, repairs (glued headings), classification, section counts. Commit reports copy and checksum, canonicalization, the write, and — through the `PostCommit` hook — one line per character suggestion added. Success is reported only after all of it.
- **Story Bible build** (`shell/app.go` `pollWorkJob`): while the sidecar runs, the host tails its `stage|pct|message` progress file and its append-only log every 250 ms, then flushes once more when it exits.
- **UI** (`Home.tsx`, `WorkDialog`): polls the job while it is `preparing` or `committing`, refreshes application state once on `success`, and never sets a percent or log line of its own. The artificial minimum delay is removed. "Waiting for activity…" appears only before the first real line.
- `Elapsed` is measured from job start.

### Consequences

- **Neutral:** Fast stages finish quickly and their log lines appear in one burst; the bar is honest rather than paced.
- **Neutral:** A new long-running stage must report itself (a `report` call, or a line in the sidecar's log) or it will look stalled — which is the correct signal.
- **Good:** Tests pin the behavior: `TestImportJobReportsRealProgressAndLogs` (logs populated, progress monotonic, hook lines included) and `TestPollWorkJobTailsSidecarProgressAndLogOnce`.
- **Neutral:** Reintroducing client-side placeholder progress or a minimum-duration delay would supersede this ADR.

### Confirmation

`TestImportJobReportsRealProgressAndLogs` (logs populated, progress monotonic, hook lines included) and `TestPollWorkJobTailsSidecarProgressAndLogOnce` pin the behavior.

## Pros and cons of the options

### Placeholder progress with a minimum-duration delay

- Good, because the minimum delay kept the dialog from flashing by.
- Bad, because the bar moved part way, stalled, then jumped to the end while the log said only "Waiting for activity…", so the dialogs looked broken.
