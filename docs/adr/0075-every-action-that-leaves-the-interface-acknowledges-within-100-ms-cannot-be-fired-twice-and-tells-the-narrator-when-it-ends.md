# 0075. Every action that leaves the interface acknowledges within 100 ms, cannot be fired twice, and tells the narrator when it ends

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

A narrator clicks something that talks to the Go host or a Python sidecar and cannot tell whether anything happened, whether it is still running, or when it finished if they looked away. The interaction feedback audit (a PRD, now steady state) enumerated every place the UI calls the host: 108 call sites in 14 files. When the catalog was first written 25 of them broke one of these rules (no acknowledgment, no guard against a second press, a failure that is unhandled, a completion that lives on one page), and 9 more belonged to the install flows.

The latency baseline ([interaction latency baseline](../research/interaction-latency-baseline.md)) measured the operations. Every Story Bible mutation takes 280 ms or more (each is a Python process), one Save is four processes (1.2 to 1.8 s), a build is 1 to 6 s, and every Go call is under 10 ms. So the standard cannot be "loading states for slow things" only: the cheapest Python-backed action is already three times the threshold at which a person stops feeling in control.

Owner decision D22 adopts the PRD's recommendations for its open questions: the tiers below (question 1), a toast queue with sticky errors (question 2), acknowledgment first and latency work driven by data (question 4), a generic pending hook and a `pending` state on the buttons (question 9), and a guard against silent catches folded into the catalog ratchet (question 10).

## Decision drivers

- A narrator cannot tell whether anything happened, whether it is still running, or when it finished if they looked away.
- When the catalog was first written, 25 of the 108 call sites to the host broke one of these rules, and 9 more belonged to the install flows.
- The latency baseline: every Story Bible mutation takes 280 ms or more and a build 1 to 6 s, so the cheapest Python-backed action is already three times the threshold at which a person stops feeling in control.
- The owner's decision D22 adopts the PRD's recommendations for its open questions (tiers, a toast queue with sticky errors, acknowledgment first, a generic pending hook, a guard against silent catches in the catalog ratchet).

## Considered options

1. Five rules for every action that calls the host, with duration tiers, a queued toast and a catalog ratchet
2. Loading states for slow things only
3. Keep the status quo: each call site handles feedback its own way

## Decision outcome

**Chosen option: five rules for every action that calls the host, with duration tiers, a queued toast and a catalog ratchet**, because the cheapest Python-backed action is already three times the threshold at which a person stops feeling in control, so loading states for slow things alone cannot be the standard.

**Five rules, for every action a narrator starts (a click, a key, a changed value) that calls the host:**

1. **Acknowledge.** Any action that is not instant shows that it was heard, at once: the control that started it is marked busy (`aria-busy`, dimmed, a spinner that respects reduced motion) within 100 ms. Whether a spinner or progress is warranted on top is decided by the tier; the acknowledgment is not optional.
2. **No double fire.** While an action runs, the control that started it ignores a second press, and so does any other control that would start the same action. The guard is in the code path (`usePending`), not only in the styling, so a second Enter key does nothing either.
3. **Completion does not depend on where the narrator is.** A job the host runs in the background (a Story Bible build, a manuscript import, a comparison, a download, an update) ends with one `job:ended` event, and the app, not the page that started it, tells the narrator. A page may still show progress while it is open.
4. **Progress is honest.** Real progress where the host measures it, an indeterminate indicator where it does not, never a padded or invented percentage or a minimum display time (ADR 0015).
5. **No swallowed errors.** A failure of an action the narrator started is shown, in the place they are looking (a toast, an inline message, the dialog they are in). A bare `.catch(() => {})` or an empty `catch` is allowed only on a reviewed list with the reason beside it.

**Tiers** (by measured or expected duration of the whole action; the measurement decides the treatment on top of rule 1):

| Tier | Duration | Treatment |
| --- | --- | --- |
| 1 | Under 100 ms | Nothing needed |
| 2 | 100 ms to 1 s | Rule 1 and rule 2 (a busy control that ignores a second press) |
| 3 | 1 to 10 s | Rules 1 and 2, an indeterminate indicator, and a completion signal (rule 3) |
| 4 | Over 10 s | Real progress, cancel or dismiss, and eligibility for an operating system notification (the briefs PRD) |

**Toasts.** The toast is a small own primitive (`components/primitives/Toast.tsx`, stories beside it), not a Base UI wrapper. Messages queue instead of replacing each other (up to four are visible; an identical message that is already showing restarts its timer instead of stacking). A success or information message dismisses itself after 5 seconds; **an error stays until it is dismissed**, and is announced assertively (`role="alert"`), while the rest are polite.

**The catalog and its ratchet.** `apps/ui/src/interactionFeedback.catalog.ts` has one row per call site of a `NarrationApi` method outside `src/api/`, with what it costs, how it acknowledges, guards, completes and fails, and a verdict (`ok`, `gap`, `owned`, `exempt`). `apps/ui/src/interactionFeedback.test.ts` enumerates the sites from the contracts and the source and fails on a site with no row, a row whose site is gone, a `gap` without a filed issue, an `exempt` or `owned` row with no reason, and on any bare catch that is not on the reviewed list. Adding a call to the host means adding its row, which is the review-visible moment to ask which tier it is in.

**Backlog home.** The catalog is the in-repo record; a site the audit did not fix is a GitHub issue (`area:ui`, and `bug` or `accessibility`), and its row names the issue number.

### Consequences

- **Neutral:** Every new host call has to say where it stands against the standard, in the same pull request, or the test fails. The cost is one row.
- **Neutral:** `Button` and `IconButton` gain a `pending` prop (a primitive change, with stories and the atlas). A pending control stays focusable and `aria-disabled`, so a keyboard user does not lose their place when it turns busy.
- **Neutral:** Errors no longer vanish after 2.4 seconds. A narrator who triggers many failures sees up to four stacked until they dismiss them; that is the intended trade.
- **Neutral:** The install flows (voice and Whisper downloads) are release-readiness Phase 1's: their rows are `owned` and the rules apply to them when that work lands. The audit did not rebuild them.
- **Neutral:** The tiers are measured on one machine with Defender off and synthetic manuscripts ([baseline](../research/interaction-latency-baseline.md)); a slower machine moves an operation up a tier, which only ever adds treatment, never removes it.
- **Neutral:** To change a rule or a threshold, write a new ADR that supersedes this one.

### Confirmation

`apps/ui/src/interactionFeedback.test.ts` enumerates the call sites from the contracts and the source, and fails on a site with no row in `interactionFeedback.catalog.ts`, a row whose site is gone, a `gap` without a filed issue, an `exempt` or `owned` row with no reason, and any bare catch that is not on the reviewed list.

## Pros and cons of the options

### Loading states for slow things only

- Bad, because the cheapest Python-backed action is already three times the threshold at which a person stops feeling in control.

### Keep the status quo

- Bad, because 25 of the 108 call sites broke a rule (no acknowledgment, no guard against a second press, an unhandled failure, a completion that lives on one page).
