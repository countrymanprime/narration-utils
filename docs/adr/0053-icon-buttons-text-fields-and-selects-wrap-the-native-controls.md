# 0053. Icon buttons, text fields and selects wrap the native controls, and pages may not write them

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

The UI had 14 primitives and none was a form control besides the labelled `Field`, so every page wrote its own controls from native elements. The evidence, counted at the base of this stack: one 32 px icon-button class string pasted 28 times in 10 files (14 in `GuideDetail.tsx`) and again inside `Dialog`, `SlideOver` and `NavDrawer`; 11 `<input>`, 6 `<select>` and 1 `<textarea>` outside the primitives, each with its own copy of the input class string; and global rules in `components.css` (`input[type='text']`, `select`, `textarea`, `.input`) that styled bare elements. A pasted class string has no owner: the disabled state was missing from every copy, so a disabled icon button (the "Add alias" plus with nothing typed, "Remove relationship" on a locked entry, "Jump to manuscript" on a row with no source) looked as live as an enabled one, against the convention in `docs/design/design-system.md` that a disabled control shows no hover and looks disabled.

The owner decided (implementation plan D1, D22, and the answers to the primitives PRD's L3 and L10): Base UI wrapped in our own Tailwind primitives, a native-wrapped `Select`, and "icon buttons and form controls only" for the scope of wrapping, because text buttons already have `Button`.

## Decision drivers

- A pasted class string has no owner: the disabled state was missing from every copy.
- Text buttons already have `Button`, so wrapping covers icon buttons and form controls only.
- For a select, the platform picker, keyboard search and form behaviour are the accessibility.

## Considered options

1. Wrap icon buttons and form controls in primitives (`IconButton`, `TextField`, `Select`, `SearchField`) that pages must use, enforced by a Vitest scan
2. Keep the status quo: pages write native controls with pasted class strings
3. An ESLint rule instead of the Vitest scan
4. Ban every bare `<button>` outside the primitives, rather than a ratchet

## Decision outcome

**Chosen option: wrap icon buttons and form controls in primitives (`IconButton`, `TextField`, `Select`, `SearchField`) that pages must use, enforced by a Vitest scan**, because a pasted class string has no owner, so the disabled state was missing from every copy.

Pages build a control from a primitive, never from the native element, and a Vitest scan enforces it.

- **`IconButton`** (`IconButton.tsx`) is the square 32 px button that holds one icon. `label` is required and becomes the accessible name; `variant` is `default`, `primary` (the filled Save) or `danger`; every other button attribute and the ref pass through, so a Base UI part can render as it (`CollapsibleTrigger` does). A disabled one is dimmed and takes no hover, like `Button`. A hint is composed around it, `<TooltipTarget text="..."><IconButton .../></TooltipTarget>`, not a prop of it, because the hint often says more than the label and its wrapper sometimes needs a layout class. `Dialog`, `SlideOver` and `NavDrawer` close buttons and the `Collapsible` trigger use it, and the pasted copies are gone. `display` is written with no specificity (`[:where(&)]:inline-flex`, the trick `Button` uses for its text size), so a caller can hide it below a breakpoint (`hidden max-md:inline-flex`, the navigation button).
- **`TextField`** is a bare text input on Base UI's `Input`: full width of its container, controlled (`onChange` reports the text, not the event), and every standard input attribute and the ref pass through, so the alias combobox in `GuideDetail.tsx`, which stays bespoke (ADR 0052), builds its `role="combobox"` input on it. It is named by `label` (an aria-label) or by an `id` that a visible `<label htmlFor>` points at, and the type asks for one of the two (`controlNaming.ts`). `type` is `text` or `color` (the settings colour picker) and no other native input type can be asked for. A control with a visible label, a hint or an error is a `Field`, and a textarea is `Field` with `textarea`, which gained `placeholder` and `autoFocus` (the add-note dialog opens on it).
- **`Select`** is the browser's own `<select>` drawn with the tokens, on purpose (L3): the platform picker, keyboard search and form behaviour are the accessibility, `fireEvent.change` and Playwright's `selectOption` keep working, and no option needs rich content. It is controlled, `onChange` reports the value, and `options` are `{ value, label }`.
- **`SearchField`** is a `TextField` with a clear button inside it once there is text; clearing reports an empty value and returns focus to the field. The manuscript reader's search box and the Story Bible list's use it, so the reader's box gained the clear button.
- **The global form CSS is gone.** `components.css` no longer styles bare `input[type='text']`, `select`, `textarea`, `.input` and `input[readonly]` (nothing used the last two), or their focus outline; the primitives own the look, and `button:focus-visible` stays.
- **The rule is a test.** `apps/ui/src/rawNatives.test.ts` reads every `.tsx` outside `components/primitives/` (not tests or stories) with the TypeScript parser and counts the native `button`, `select`, `input`, `textarea` and `table` elements per file against a ceiling, and fails on any file that pastes the icon-button look (`size-8` with `rounded-md`). A ceiling may only go down: one higher than the real count fails, so the entry is lowered in the same change. Buttons are a ratchet and not a ban (L10): the bare ones left (a toast's dismiss, a card that is a button, a list row) stay until a primitive covers them. A bad fixture per form proves the scan fires. It is a Vitest scan and not an ESLint rule for the reason in [ADR 0047](0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md): ADR 0046 already puts mechanical import and syntax rules in the test runners, and a scan proves itself on bad fixtures, which a lint pattern does not.

### Consequences

- **Good:** One place owns the icon button's look, and a disabled icon button now reads as disabled. This is a visible change on 37 of the 282 captures: 32 px boxes that were drawn at full strength while disabled are now at 40% opacity (the Story Bible "Add alias" plus, the "Remove relationship" cross where they are disabled, the Proofing row buttons for a row with no source or audio, and the same Story Bible page behind its delete confirm). Every enabled icon button is pixel-identical to before.
- **Neutral:** Wrapping the form controls changed one capture: the add-note dialog's text area is now a `Field` (its label sits 2 px closer and the area is 5 rem tall, not three rows), 3 of 282 PNGs. The other 279 are unchanged.
- **Neutral:** One inconsistency is left as it was: `Field`'s control is `font-medium` and `TextField`'s is normal weight. Each matches the controls it replaced, so no capture moved; unifying them is a visible change for a later, deliberate pass.
- **Good:** The controls now have names they lacked: the Settings text and select controls, the relationship label and entry, and the alias box are named by their labels (the alias box's old name came from its placeholder).
- **Neutral:** `IconButton` needs a label, so a caller that had an icon button with only a `title` has to name it. None was found: every one of the 28 already had an `aria-label`.
- **Neutral:** The wrapper for a Base UI part that renders a button (`CollapsibleTrigger` today) is composed with `render={<IconButton .../>}`, as ADR 0047 says for `Button`.
- **Neutral:** The scan does not police `<button>` fully: a page can still add a text button of its own (up to its ceiling). That is deliberate, and the ceilings show what is left.
- **Neutral:** To change any of this (allow a page to write a native control, or let a ceiling grow), write a new ADR that supersedes this one.

### Confirmation

`apps/ui/src/rawNatives.test.ts` counts the native `button`, `select`, `input`, `textarea` and `table` elements per file outside `components/primitives/` against a ceiling that may only go down, and fails on any file that pastes the icon-button look; a bad fixture per form proves the scan fires.

## Pros and cons of the options

### An ESLint rule instead of the Vitest scan

- Bad, because a lint pattern does not prove itself on bad fixtures, as a scan does.
