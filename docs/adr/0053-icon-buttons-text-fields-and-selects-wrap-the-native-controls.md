# 0053. Icon buttons, text fields and selects wrap the native controls, and pages may not write them

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**

## Context

The UI had 14 primitives and none was a form control besides the labelled `Field`, so every page wrote its own controls from native elements. The evidence, counted at the base of this stack: one 32 px icon-button class string pasted 28 times in 10 files (14 in `GuideDetail.tsx`) and again inside `Dialog`, `SlideOver` and `NavDrawer`; 11 `<input>`, 6 `<select>` and 1 `<textarea>` outside the primitives, each with its own copy of the input class string; and global rules in `components.css` (`input[type='text']`, `select`, `textarea`, `.input`) that styled bare elements. A pasted class string has no owner: the disabled state was missing from every copy, so a disabled icon button (the "Add alias" plus with nothing typed, "Remove relationship" on a locked entry, "Jump to manuscript" on a row with no source) looked as live as an enabled one, against the convention in `docs/design/design-system.md` that a disabled control shows no hover and looks disabled.

The owner decided (implementation plan D1, D22, and the answers to the primitives PRD's L3 and L10): Base UI wrapped in our own Tailwind primitives, a native-wrapped `Select`, and "icon buttons and form controls only" for the scope of wrapping, because text buttons already have `Button`.

## Decision

Pages build a control from a primitive, never from the native element, and a Vitest scan enforces it.

- **`IconButton`** (`IconButton.tsx`) is the square 32 px button that holds one icon. `label` is required and becomes the accessible name; `variant` is `default`, `primary` (the filled Save) or `danger`; every other button attribute and the ref pass through, so a Base UI part can render as it (`CollapsibleTrigger` does). A disabled one is dimmed and takes no hover, like `Button`. A hint is composed around it, `<TooltipTarget text="..."><IconButton .../></TooltipTarget>`, not a prop of it, because the hint often says more than the label and its wrapper sometimes needs a layout class. `Dialog`, `SlideOver` and `NavDrawer` close buttons and the `Collapsible` trigger use it, and the pasted copies are gone. `display` is written with no specificity (`[:where(&)]:inline-flex`, the trick `Button` uses for its text size), so a caller can hide it below a breakpoint (`hidden max-md:inline-flex`, the navigation button).
- **Text fields, selects and the search box** follow in the next change of this stack with the same rule (`TextField`, `SearchField`, `Select`; a textarea is `Field` with `textarea`). The alias combobox in `GuideDetail.tsx` stays bespoke (ADR 0052), and only its input becomes a `TextField`.
- **The rule is a test.** `apps/ui/src/rawNatives.test.ts` reads every `.tsx` outside `components/primitives/` (not tests or stories) with the TypeScript parser and counts the native `button`, `select`, `input`, `textarea` and `table` elements per file against a ceiling, and fails on any file that pastes the icon-button look (`size-8` with `rounded-md`). A ceiling may only go down: one higher than the real count fails, so the entry is lowered in the same change. Buttons are a ratchet and not a ban (L10): the bare ones left (a toast's dismiss, a card that is a button, a list row) stay until a primitive covers them. A bad fixture per form proves the scan fires. It is a Vitest scan and not an ESLint rule for the reason in [ADR 0047](0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md): ADR 0046 already puts mechanical import and syntax rules in the test runners, and a scan proves itself on bad fixtures, which a lint pattern does not.

## Consequences

- One place owns the icon button's look, and a disabled icon button now reads as disabled. This is a visible change on 37 of the 282 captures: 32 px boxes that were drawn at full strength while disabled are now at 40% opacity (the Story Bible "Add alias" plus, the "Remove relationship" cross where they are disabled, the Proofing row buttons for a row with no source or audio, and the same Story Bible page behind its delete confirm). Every enabled icon button is pixel-identical to before.
- `IconButton` needs a label, so a caller that had an icon button with only a `title` has to name it. None was found: every one of the 28 already had an `aria-label`.
- The wrapper for a Base UI part that renders a button (`CollapsibleTrigger` today) is composed with `render={<IconButton .../>}`, as ADR 0047 says for `Button`.
- The scan does not police `<button>` fully: a page can still add a text button of its own (up to its ceiling). That is deliberate, and the ceilings show what is left.
- To change any of this (allow a page to write a native control, or let a ceiling grow), write a new ADR that supersedes this one.
