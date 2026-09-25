# 0057. A running job that cannot be cancelled keeps its dialog blocking and says so, and the progress bar respects reduced motion

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner
- **Related:** Its "stays blocking" rule is superseded for the Story Bible rebuild by [ADR-0076](0076-a-host-job-ends-with-one-job-ended-event-the-app-announces-it-and-the-story-bible-rebuild-may-continue-in-the-background.md), which lets that rebuild continue in the background; the rest stands

## Context and problem

[ADR 0048](0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md) gave `WorkDialog` the semantics of a progress dialog (`role="progressbar"`, a live message, Escape only once the job has finished) and left two things open: the indeterminate bar still slid under `prefers-reduced-motion`, and a job that has no Cancel showed an empty action row and said nothing about why nothing could be pressed.

Two callers pass no `cancel`: the Story Bible rebuild (`Guide.tsx`; the host has no cancel binding for it: `apps/desktop/bindings.go` has cancel for the manuscript import, the transcript compare and the two downloads, not for the Story Bible build) and the manuscript import once it is past `preparing` (`Home.tsx` passes `cancel` only while `phase === 'preparing'`, and the import is writing to the project by then). The dialog PRD's question 4 offered three ways to treat such a job: (a) keep the dialog blocking with an explicit non-cancellable status line and focus on the body, (b) offer Close and let the job continue in the background (which needs the polling loop to survive an unmounted dialog and a completion signal that does not depend on the dialog), or (c) add a real cancel binding in Go and Python. It recommended (a).

The owner decided (implementation plan D8) that "Build Story Bible after import" is on by default. That makes the choice load-bearing: with it on, every import is followed by a rebuild that a narrator sits in front of, so the dialog is on screen far more often than when the rebuild was a deliberate press. The owner's answer to the dialog PRD's questions is to adopt its recommendations (D22), so (a) stands; the interaction feedback audit's host-side completion events (its phase 5) are what would make (b) safe later.

Two things about testing came up. The Storybook preview switches every animation and transition off (`.storybook/preview-head.html`, for deterministic screenshots), so no story or atlas run can show that a bar does not slide under reduced motion; the guard has to be a unit test on the classes, as it is for `MeterBar` ([ADR 0050](0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md)). And a screen-reader pass on WebView2 (NVDA) has not been done for the dialogs; it is an owner step.

## Decision drivers

- A job with no Cancel showed an empty action row and said nothing about why nothing could be pressed.
- The indeterminate bar still slid under `prefers-reduced-motion`.
- With "Build Story Bible after import" on by default, the dialog is on screen after every import.
- Closing and continuing in the background needs the polling loop to survive an unmounted dialog and a completion signal that does not depend on the dialog.

## Considered options

1. (a) Keep the dialog blocking, with an explicit non-cancellable status line and focus on the body
2. (b) Offer Close and let the job continue in the background
3. (c) Add a real cancel binding in Go and Python

## Decision outcome

**Chosen option: (a) keep the dialog blocking, with an explicit non-cancellable status line and focus on the body**, because the dialog PRD recommended (a), the owner adopted its recommendations, and (b) waits on host-side completion events.

- **A running job with no Cancel stays blocking.** `WorkDialog` (`apps/ui/src/components/primitives/WorkDialog.tsx`) shows "This step cannot be cancelled. Close appears when it finishes." as the dialog's description (visible at the top of the body, and the target of `aria-describedby`, so a screen reader hears it when the dialog opens). Nothing is pressable, focus rests on the body region (which is already the initial focus, [ADR 0048](0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)), so focus is never lost, and Escape is ignored until the job has finished; then Close appears and Escape works as Close. A job that can be cancelled shows Cancel and no notice.
- **No empty action row.** `Dialog` draws its action row only when it has actions (`actions={null}` draws none), and `WorkDialog` passes `null` when it has neither Cancel nor Close, so the padded blank strip under the log is gone. Every phase of `WorkDialog` now has either a control to press or a description that says why there is none (`WorkDialog.test.tsx` checks all six phases with and without a cancel handler).
- **Reduced motion.** The bar's fill eases its width and slides while indeterminate only under `motion-safe:` (`motion-safe:transition-[width]`, `motion-safe:animate-[work-progress-slide_...]`), so under `prefers-reduced-motion: reduce` it neither eases nor slides. Review found that a legacy rule, `.progressbar > div { transition: width 0.4s ease }` in `components.css`, beat the utility (that file is imported into the same layer as Tailwind's utilities and its selector is more specific), so the easing still ran; the rule is removed (the other three progress bars, in Home, Proofing and the Story Bible, carry their own `transition-[width]` utilities on the fill, so they look the same) and `legacyCss.test.ts` now fails on any `transition` or `animation` declared in `components.css`. That test and the unit test on the classes are the guards.
- **What is not decided here.** Option (c), a cancel binding for the Story Bible rebuild, is separate Go and Python work and is not planned. Option (b) is not built: a later stack may relax the blocking dialog. The natural place is the interaction feedback audit's phase 5 (host-side completion events, so a build that continues after its dialog closed still ends in a notification), and that stack writes the ADR that supersedes this one when it does.

### Consequences

- **Good:** A narrator who starts a rebuild, or whose import is writing, is told why the dialog will not close and what will change, and never faces a dialog with nothing focusable and nothing said.
- **Bad:** With build-after-import on by default the blocking dialog appears after every import for as long as the build runs. That is the cost of choosing (a) now; the relief is (b) with completion events, in a later stack, and it needs a new ADR that supersedes this one.
- **Neutral:** A future caller that has no cancel and no close (a dialog that never finishes) would be a dead end that Escape does not leave; `WorkDialog` requires `close` in practice, and every caller passes it.
- **Neutral:** The bar still animates for everyone else and its look is unchanged. Nothing proves the reduced-motion behaviour in a browser: the atlas cannot (animation is off in Storybook), so a change that drops the `motion-safe:` classes, or adds motion back in `components.css`, fails a unit test, not a visual check.
- **Neutral:** The notice is the dialog's description, so it is read when the dialog opens. A dialog that already showed Cancel and then loses it (a job that stops being cancellable inside one dialog) changes its description in place, which a screen reader does not re-announce; the visible notice appears and the live message region keeps announcing progress. If Cancel had focus when it left, focus falls back to the page behind the modal's guards rather than to the body region; nothing tests that path, and today the import replaces one dialog with another between those phases, so the new dialog opens with focus on its body.
- **Neutral:** A screen-reader pass (NVDA on WebView2) over the rebuild and the import, listening for the notice on open, is still owed and is recorded as an owner step in the implementation plan.
- **Neutral:** To change any of this (Close-and-continue, a cancel binding, a non-blocking progress indicator), write a new ADR that supersedes this one.

### Confirmation

`WorkDialog.test.tsx` checks all six phases with and without a cancel handler; a unit test on the `motion-safe:` classes and `legacyCss.test.ts`, which fails on any `transition` or `animation` declared in `components.css`, guard reduced motion.

## Pros and cons of the options

### (b) Offer Close and let the job continue in the background

- Good, because it is the relief from a blocking dialog after every import.
- Bad, because it needs the polling loop to survive an unmounted dialog and a completion signal that does not depend on the dialog.

### (c) Add a real cancel binding in Go and Python

- Bad, because it is separate Go and Python work, and is not planned.
