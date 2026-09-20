# 0048. Every dialog is one modal shell, confirms are alert dialogs, and Escape, the backdrop and focus follow one policy

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**

## Context

`Dialog`, `ConfirmDialog`, `WorkDialog` and `AddNoteDialog` (built on `Dialog`) declared `aria-modal="true"` and were not modal: Escape did nothing, focus was neither moved in nor trapped nor restored, and the page behind stayed focusable and readable. It was the only high-severity entry in the retired UI defects register. The owner moved the mechanism to Base UI ([ADR 0047](0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md)), gave the foundation PRD ownership of dialog modality (implementation plan D4) and chose `AlertDialog` for every confirm and red confirm buttons for the six destructive ones (D12). The dialog PRD's recommendations for Escape, the backdrop and initial focus (its questions 3, 5 and 6) were adopted (D22).

What building it showed, beyond the spike in ADR 0047:

- Base UI mounts a dialog's portal one commit after the component renders. A story `play()` that starts with a `getBy` query finds nothing in Chromium (it did in jsdom, where `render` flushes everything), so every dialog `play()` starts with a `findBy` and looks in `document.body`, not the story canvas.
- When the opener is removed while the dialog is open, Base UI returns focus to the first tabbable control of the `finalFocus` element it is given, so giving it `<main>` lands on the first control in the page rather than `<body>`.
- Home's import dialogs used to sit in an overlay that stopped 16 px short of the bottom of the window in the captured states. Portalled to `<body>` the scrim covers the window and the dialog centres in it (8 px lower at the desktop viewport).

## Decision

There is one modal shell, `apps/ui/src/components/primitives/Dialog.tsx`, on Base UI's Dialog and AlertDialog, and every dialog goes through it. The layout of [ADR 0001](0001-import-dialog-max-width-and-overflow.md) and [ADR 0002](0002-dialog-action-button-placement.md) is unchanged.

- **Modal contract (from the library).** The page behind is hidden from assistive technology and not reachable by Tab, Tab and Shift+Tab loop inside, page scroll is locked, and focus returns to the element that opened the dialog when it closes. The dialog is named by its visible title (`aria-labelledby`).
- **Escape** closes a dialog that has somewhere to go: `onClose` (which also shows the header Close button) or `onEscape` (for a dialog with no header button). With neither it is ignored, so a job that is still running is never dismissed by a stray key. `WorkDialog` passes `onEscape` only once the job has finished, so Escape does nothing while it runs (Cancel is the deliberate action) and works as Close afterwards.
- **The backdrop never closes a dialog** (`disablePointerDismissal`): an accidental click on the scrim must not discard a confirm.
- **Initial focus** lands on the scrolling body region, so a screen reader reads the message before any control, unless a child took focus with `autoFocus` (`AddNoteDialog`'s textarea), which wins. **Final focus** is the element that had focus when the dialog mounted, or, when that element is gone, the page's `<main>` (`tabIndex={-1}` in `AppShell`): Base UI sends focus to the first control inside it, or to `<main>` itself when it has none.
- **`escapeCloses={false}`** keeps Escape from dismissing a dialog whose close would abort work in flight. `ConfirmDialog` exposes it as `escapeCancels` and the three confirms that turn into a running download (the Whisper model in Proofing and in the Teleprompter, the local preview voice in the Story Bible) pass `false` while it runs; the header Close button and Cancel remain the deliberate ways out.
- **`ConfirmDialog` is always an `alertdialog`** (`variant="alert"`), described by its body (`aria-describedby`), and Escape declines exactly like Cancel. `body` is a `ReactNode`. A third action needs both `danger` and `dangerLabel` (the types refuse one without the other). `confirmVariant="danger"` draws the confirm button red; it is set on the six destructive confirms: Clear derived project data, Remove local preview voice, Remove local Whisper model, Delete entry, Merge and delete source, and Replace and reset (only when the import requires a reset).
- **`WorkDialog`** carries its semantics on Base UI `Progress`: `role="progressbar"` named "<title> progress", `aria-valuenow` unless the job is indeterminate (running and still at 0%; a failed or cancelled job at 0% reports 0), and its message in a live region (`status`, `alert` for an error). The `progressbar` marker class stays on the track ([ADR 0009](0009-complete-tailwind-migration.md)); the fill keeps its current look.
- **Announcements still work.** The toast that reports a failure raised from inside a dialog has an explicit `aria-live="polite"`: Base UI hides the rest of the page from assistive technology while a dialog is open but keeps `[aria-live]` regions reachable, and `role="status"` alone does not carry the attribute. `Dialog` also refuses `variant="alert"` without a `description` at the type level, and an empty description renders no `aria-describedby`.
- **Tests.** Each behaviour is a story `play()` in the Chromium atlas (Escape, Tab loop, focus start, focus return, backdrop, alertdialog description, progress value) that also runs in jsdom, plus RTL tests in `Dialog.test.tsx` and `ConfirmDialog.test.tsx` and one consumer flow (Story Bible delete returns focus to the Delete entity button). Stories look for popups through `primitives/portalScreen.ts`.

## Consequences

- All four consumers inherit the same keyboard behaviour, and a new dialog is one `Dialog` with a story. The visible changes are the red confirm on the six destructive confirms, a focus ring on the message when a dialog opens from the keyboard or on load, the scrim covering the whole window on Home, and the guide text describing the keyboard behaviour.
- Reduced motion for the indeterminate bar and a status line for jobs with no Cancel (the dialog PRD's phase 3) are not part of this decision; a job that cannot be cancelled has nothing focusable except the body and log regions, so focus is never lost, but the bar still slides under `prefers-reduced-motion`.
- Two dialogs that replace one another (the import flow: preparing, preview confirm, committing) each return focus to whatever held it when they mounted, which for the second is inside the first, so the last one falls back into `<main>` rather than the Import button.
- `AddNoteDialog` is opened from the selection popup, which unmounts as the dialog mounts, so there is no opener to return to and focus goes into `<main>` (its first control) rather than back to the reader text. Returning it there needs the reader to be a focus target and is a follow-up.
- A hover tooltip inside a dialog would close with Escape together with the dialog; no tooltip is inside a dialog today, and the tooltip phase handles it.
- To change any of this (Escape or backdrop dismissal, a non-alert confirm), write a new ADR that supersedes this one.
