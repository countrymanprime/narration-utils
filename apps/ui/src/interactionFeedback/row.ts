// The shape of a row of the interaction feedback catalog (interactionFeedback.catalog.ts) and the helpers that write one.
/** What made the call: a click or key, a value the narrator changed, a page or component mounting, an effect reacting, a host event. */
type Trigger = 'click' | 'input' | 'mount' | 'effect' | 'timer' | 'event';
/** What the host does to answer. `instant` is a Go call that never leaves memory, `file-io` reads or writes a project file. */
type Cost = 'instant' | 'file-io' | 'python' | 'job' | 'download' | 'os-dialog' | 'subscription';
/** How the narrator learns the call was heard before the answer arrives. `na` is a mount-time load that has no control to acknowledge. */
type Acknowledgment = 'na' | 'none' | 'disabled' | 'pending' | 'dialog' | 'inline';
/** What stops a second call while the first is running. `host` means the host refuses a second start and says so. */
type Guard = 'na' | 'none' | 'disabled' | 'pending' | 'dialog' | 'host';
/** How the narrator is told it finished. */
type Completion = 'na' | 'ui' | 'toast' | 'dialog' | 'poll' | 'event';
/** Where a failure shows up. `silent` and `unhandled` are the ones the standard forbids for a narrator's action. */
type FailurePath = 'na' | 'toast' | 'inline' | 'dialog' | 'silent' | 'unhandled';
/** Whether the outcome is still visible after the narrator leaves the page the action started on. */
type SurvivesNavigation = 'yes' | 'no' | 'na';
/**
 * `ok` meets the standard. `gap` does not, and its `plan` says who fixes it (an issue, `#123`).
 * `owned` belongs to another piece of work named in `plan`. `exempt` is on purpose and `note` says why (a mount-time load with a page error state, a diagnostic
 * that must never throw).
 */
type Verdict = 'ok' | 'gap' | 'owned' | 'exempt';

export type FeedbackRow = {
  trigger: Trigger;
  cost: Cost;
  acknowledgment: Acknowledgment;
  guard: Guard;
  completion: Completion;
  failure: FailurePath;
  survivesNavigation: SurvivesNavigation;
  verdict: Verdict;
  plan?: string;
  note: string;
};

export const row = (
  trigger: Trigger,
  cost: Cost,
  acknowledgment: Acknowledgment,
  guard: Guard,
  completion: Completion,
  failure: FailurePath,
  survivesNavigation: SurvivesNavigation,
  verdict: Verdict,
  note: string,
  plan?: string,
): FeedbackRow => ({ trigger, cost, acknowledgment, guard, completion, failure, survivesNavigation, verdict, plan, note });

// Shorthands for the rows that repeat.
export const startup = (note: string) => row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', note);
export const subscription = (note: string) => row('mount', 'subscription', 'na', 'na', 'event', 'na', 'na', 'exempt', note);
