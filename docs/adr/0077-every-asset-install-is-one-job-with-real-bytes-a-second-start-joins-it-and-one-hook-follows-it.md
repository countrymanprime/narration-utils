# 0077. Every asset install is one job with real bytes, a second start joins it, and one hook follows it

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

The voice and Whisper downloads had three copies of the same poll loop (one each in `GuideDetail.tsx`, `Transcript.tsx` and `TeleprompterPage.tsx`), two job shapes with two phase vocabularies (a voice said `downloading` with a percent, a model said `running` with none), no bytes at all (`assets.Install` streamed with `io.Copy` and reported nothing, so the percent was 0 until the job ended, which [ADR 0015](0015-real-progress-only.md) allows only when it is not padded), and nothing to stop a second press starting a second download of the same 114 MB. The interaction feedback audit ([ADR 0075](0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md)) left the nine call sites as `owned` for this work (owner decision D4: release-readiness Phase 1 owns the shared install-poll hook, and the teleprompter engines PRD adopts it).

The in-app update ([ADR 0072](0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)) had already shown the shape that works: real bytes from `assets.Options.OnProgress`, a `verifying` phase, a sentence for the narrator and the cause in the host log.

## Decision drivers

- The voice and Whisper downloads had three copies of the same poll loop and two job shapes with two phase vocabularies.
- No bytes were reported, so the percent was 0 until the job ended.
- Nothing stopped a second press starting a second download of the same 114 MB.
- The interaction feedback audit (ADR-0075) left the nine call sites `owned` for this work (owner decision D4: release-readiness Phase 1 owns the shared install-poll hook).
- The in-app update (ADR-0072) had already shown the shape that works.

## Considered options

1. One install job in Go with real bytes, joined by a second start, followed by one `useAssetInstall` hook in the UI
2. Keep the status quo: a poll loop per page and a job shape per asset kind
3. Let an install "Continue in background" (issue #209)

## Decision outcome

**Chosen option: one install job in Go with real bytes, joined by a second start, followed by one `useAssetInstall` hook in the UI**, because the three copies of the poll loop reported no bytes and could start a second download of the same asset, and the in-app update had already shown the shape that works.

- **One install job in Go** (`apps/desktop/installjobs.go`, `installJob`), for every asset kind. `startInstall` takes the asset's files and a function that runs the install; a voice (`TtsInstall`) and a model (`WhisperInstall`) each start one, and the bindings keep their names. The phases are `downloading`, `verifying`, `success`, `cancelled` and `error`. `bytesDone` is the sum of the bytes received across every file and never decreases, `bytesTotal` is the sum of the catalog sizes, and `percent` is their ratio, capped at 99 until the install has succeeded (a full bar means installed, not merely received). `verifying` is reported through the new `assets.Options.OnVerify`, which fires after each file's last byte and before its check.
- **A second start joins the running job.** `startInstall` returns the snapshot of the job already running for the same kind and asset, so a second press, a second window or a retry that races the first starts no second download. A finished install is not joined: a later start is a new job.
- **The narrator reads a sentence, the log keeps the cause.** A failed install says what to do ("The downloaded voice did not match the approved file, so it was not installed…" for `assets.ErrChecksumMismatch` and `ErrSizeMismatch`, "…could not be downloaded. Check your internet connection and try again." otherwise). The raw error (an address, a socket error) goes to the host log as `install_failed`.
- **One hook and one prompt in the UI.** `useAssetInstall` (`apps/ui/src/hooks/useAssetInstall.ts`) starts the install, follows the job every 400 ms and exposes the job, a failure sentence, the seconds and the distinct messages. It refuses a second `begin` in the code path, stops polling when the page goes and never calls `onSuccess` after that (a teleprompter session must not start on a page the narrator has left). `AssetInstallPrompt` (`components/assets/`) is the first-use question (a confirm that carries the caller's facts about the asset) and then the shared `WorkDialog` with the real bytes, a Cancel while bytes arrive and none while the files are being checked ([ADR 0057](0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)). The three pages use them; the mock's scripted job (`createInstallMock`) emits the same steps so unit tests and the visual suite see `downloading`, `verifying` and `success`.
- **The install dialogs stay blocking, and the download outlives them.** The dialog is modal while the install runs and reports its own end ([ADR 0076](0076-a-host-job-ends-with-one-job-ended-event-the-app-announces-it-and-the-story-bible-rebuild-may-continue-in-the-background.md) lists `tts_install` and `whisper_install` among the kinds whose dialog says so). Leaving the page stops the polling, not the download, and the host still ends the job with `job:ended`. An install does not get "Continue in background" (issue #209 asked): it is asked for in order to run one operation, and that operation resumes only from the dialog that asked.
- **The wire contract is `AssetInstallJob`** (`contracts/assets.ts`, `schemas/assets.ts`): `id`, `phase`, `message`, `percent`, `bytesDone`, `bytesTotal`, `error`, plus `voiceId` or `modelId` on the two bindings. Golden files are written by a Go test and validated with the UI schemas ([ADR 0069](0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md)). The Whisper phase word changed (`running` became `downloading`), so `hostAPIVersion` is 10.

### Consequences

- **Good:** The nine `owned` catalog rows are `ok` and the install flows meet the standard of ADR 0075: acknowledged at once, guarded in the host and the hook, a completion and a failure in the dialog.
- **Good:** Every later provider (spaCy, Moonshine, dictionaries) starts its install with `startInstall` and follows it with `useAssetInstall`, so a new asset costs a spec and a prompt, not a loop.
- **Neutral:** The `Tts*` and `Whisper*` install bindings stay until the aggregated catalog API (release-readiness Phase 3) replaces them with generic ones; the job type does not change then.
- **Bad:** A job in the map is never removed. It is a few fields and there are a handful per session, but a long-lived host that installs many assets would keep them all.
- **Neutral:** To let an install continue in the background, write a new ADR that supersedes this one and amends the list of blocking kinds in ADR 0076.

### Confirmation

Golden files for `AssetInstallJob` are written by a Go test and validated with the UI schemas (ADR-0069), and the mock's scripted job (`createInstallMock`) emits the same steps so unit tests and the visual suite see `downloading`, `verifying` and `success`.

## Pros and cons of the options

### Keep the status quo

- Bad, because `assets.Install` reported no bytes, so the percent was 0 until the job ended.
- Bad, because nothing stopped a second press starting a second download of the same 114 MB.

### Let an install "Continue in background"

- Bad, because an install is asked for in order to run one operation, and that operation resumes only from the dialog that asked.
