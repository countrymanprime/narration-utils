import type { AxeDebt } from './lib/validators';

// Accessibility rules an app state is KNOWN to violate under axe (the visual suite runs axe on every captured state, see
// docs/adr/0064). Each entry says which rule, why it is not fixed now and where the fix is tracked. This is an escape hatch,
// not a default: an entry hides a real failure, so the list may only shrink (`MAX_AXE_DEBT_RULES` in src/visualSuite.test.ts
// caps it), and an entry fails the run when its rule stops being reported, so it cannot outlive its violation. The baseline
// it started from (report-only, UI_AXE=1, 235 captures): 533 elements over 50 captures before two fixes made on the way (the
// unnamed chapter bookmark toggle and the project picker with no main landmark or heading), 122 elements over 44 captures after,
// all of it in the five rules below and none of it colour contrast.
//
// Kept apart from the capture machinery under lib/, and reached by the capture through `axeDebt` in app.drivers.ts.

// Overlapping highlights render as nested role=button marks (#155).
const NESTED_HIGHLIGHT_STATES = [
  'chapter-bookmarked',
  'formatted-text-and-line-breaks',
  'go-to-line-highlight',
  'overlapping-highlights',
  'reader-dark',
  'reader-text-large',
  'reader-text-medium',
  'reader-text-small',
  'sticky-header-scrolled',
];

const NESTED_MARKS = 'Overlapping highlights are nested role=button marks, and the fix is a design decision about which mark is the control (#155)';
const PORTALLED_POPUP = 'The popup is portalled to <body>, outside the landmarks, so axe cannot place it (#157)';
const FOCUS_GUARDS = "Base UI's own focus guards are focusable inside an aria-hidden wrapper, and the fix is upstream or a portal container (#157)";
const ALIAS_COMBOBOX = 'The alias typeahead is the one bespoke combobox and has no expanded state, controls or option children (#156)';

export const AXE_DEBT: AxeDebt[] = [
  ...NESTED_HIGHLIGHT_STATES.map((state) => ({ page: 'script', state, rules: ['nested-interactive'], reason: NESTED_MARKS })),
  // shell/history-enabled's driver lands on (and captures) the Script page (drivers/shell.ts) with its default
  // content, which already carries #155's nested marks; history-forward returns to Home before capturing, so it
  // never hits this rule and needs no entry.
  { page: 'shell', state: 'history-enabled', rules: ['nested-interactive'], reason: NESTED_MARKS },
  { page: 'script', state: 'selection-popup', rules: ['nested-interactive', 'region'], reason: `${NESTED_MARKS}; and ${PORTALLED_POPUP}` },
  { page: 'global', state: 'tooltip', rules: ['aria-hidden-focus', 'region'], reason: `${FOCUS_GUARDS}; and ${PORTALLED_POPUP}` },
  { page: 'home', state: 'info-tooltip', rules: ['aria-hidden-focus', 'region'], reason: `${FOCUS_GUARDS}; and ${PORTALLED_POPUP}` },
  // The rail shows labels at the desktop width, so the hint only exists (and is only reported) below it.
  { page: 'global', state: 'nav-rail-tooltip', rules: ['region'], reason: PORTALLED_POPUP, viewports: ['small-desktop', 'tablet'] },
  { page: 'storybible', state: 'alias-typeahead', rules: ['aria-required-attr', 'aria-required-children'], reason: ALIAS_COMBOBOX },
  // home/editing-check-running|partial|complete-candidates also hit landmark-unique (#682: ReaperControls.tsx's
  // aria-label="In REAPER" is hard-coded, so every row with audio repeats it) - NOT declared here: MAX_AXE_DEBT_RULES
  // is already at its cap (19) and raising it needs a maintainer's decision, not a worker's (see the comment above
  // this list). The real fix is #682's own PR parameterizing that label; see PR #829's comment for detail.
];
