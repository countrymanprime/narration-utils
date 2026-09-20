# 0052. Toggle, Menu, Checkbox, Collapsible and Switch replace the hand-rolled widgets

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**

## Context

Four widgets were hand-written in pages or in a primitive with none of the behaviour a screen reader or a keyboard expects: the `Pill` chip had no `aria-pressed`; the category menu in the Story Bible entry header was a `role="menu"` div of buttons with no arrow keys, no Escape and no focus return; the import preview's character suggestions were raw native checkboxes; and the audiobook estimate's per-chapter disclosure was a button with `aria-expanded` and a conditional block. Settings will also need on/off controls (implementation plan D8), and a `Switch` is the right semantics for a setting that takes effect at once. The owner decided (foundation PRD question 7a, D1, and the addition of `Switch`) to convert these four call sites and add `Switch`; the alias combobox in `GuideDetail.tsx` stays bespoke (its matching and active-index logic is domain code and the riskiest to regress), and the six native `<select>`s stay native (question 5a).

## Decision

Five primitives on Base UI, each with a story and tests, closed APIs, Tailwind and tokens only ([ADR 0047](0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md)):

- **`Pill`** is a Base UI `Toggle`: `aria-pressed` reports the selected chip, and the props (`label`, `active`, `disabled`, `title`, `onClick`) are unchanged. The `active` class and the mutually exclusive class sets stay ([ADR 0017](0017-no-legacy-css-shadowing-tailwind.md)); pressing a chip, even the selected one, reports one `onClick`, so single-choice groups behave as before. The disabled chip inside a tooltip keeps its wrapper.
- **`Menu`** (new, `Menu.tsx`) is a Base UI Menu: a trigger button (`aria-haspopup`, `aria-expanded`) and a popup of `menuitem`s with arrow keys, Home and End, typeahead, Enter, Escape, and focus back on the button. Items are `{ key, label, leading?, onSelect }`; the trigger keeps the caller's class and style. The popup sits at `z-55`, between the slide-over and the dialogs. `GuideDetail.tsx`'s category badge uses it and lost its open-state field.
- **`Checkbox`** (new) is a labelled row on Base UI Checkbox: a `role="checkbox"` named by the row's text, toggled by pressing the box, the label or Space, drawn with the app's tokens instead of the browser's control. Home's character suggestions use it. This is a visible change (the native box becomes a token-styled one).
- **`Collapsible`** (new, in three parts, `Collapsible`, `CollapsibleTrigger`, `CollapsiblePanel`, because the button and its panel sit in different parts of one section) is a Base UI Collapsible: `aria-expanded` and `aria-controls` come from the library and the panel is not in the page while collapsed. `AudiobookEstimatePanel.tsx`'s per-chapter breakdown uses it; the section is now the Collapsible root.
- **`Switch`** (new) is a labelled row on Base UI Switch: a `role="switch"` ("on"/"off"), toggled by the switch, its label or Space. It has no caller yet; the Settings boolean kind is a later change.
- **Not converted:** the alias combobox, the native selects, `Button`, `NavButton`, `Heading`, `Panel`, `Highlight` and `ErrorBoundary`.

## Consequences

- The four converted widgets announce their state and work from the keyboard the way the platform documents, and nothing outside `primitives/` imports the library. What is not converted (the alias combobox, `NavButton`, the lock button, the native selects) is unchanged.
- `Pill` reports `aria-pressed` on the groups that use it as a single choice (theme, text size, log verbosity), where radio semantics would be more accurate; group semantics are deferred (foundation PRD question 7). The `Menu` popup is not modal, so the page behind stays scrollable and clickable as it was.
- The visible changes are the token-styled checkbox and the category menu's popup being portalled (same look, positioned by the library). The visual-suite states that show a chip, the disclosure or the entry header were compared pixel by pixel with the state before this work and are identical (the disclosure's top border colour needed an explicit token: Tailwind 4's default is `currentcolor`).
- `Checkbox` and `Switch` label presses are proved in RTL tests; the Storybook jsdom runner cannot press a label (Base UI builds a `PointerEvent` that its window rejects), so their stories press the control itself.
- `Switch` is unused code until Settings adopts it; Knip sees it through its story and test.
- To change any of this, write a new ADR that supersedes this one.
