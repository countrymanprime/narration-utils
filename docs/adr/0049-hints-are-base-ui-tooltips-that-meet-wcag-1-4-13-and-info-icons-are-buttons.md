# 0049. Hints are Base UI tooltips that meet WCAG 1.4.13, and info icons are buttons that open a popover

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**

## Context

`TooltipTarget` and the info icon `Tooltip` were hand-written: every target pointed `aria-describedby` at one id (`tooltip-layer`) that existed only while a tooltip showed, so the reference was usually dangling and never on the focusable child; the info icon was a `span` with an `aria-label`, unreachable by keyboard; the tooltip could not be dismissed with Escape and had `pointer-events-none`, so it could not be hovered; and a code path wrote a `key: Date.now()` that nothing read. Base UI documents its Tooltip as a hint for sighted mouse and keyboard users, not an accessible description, and recommends a Popover for an info icon. The owner decided (implementation plan D6, foundation PRD question 4a) that tooltips meet WCAG 1.4.13 formally (hoverable, persistent, dismissible with Escape), that info icons become real buttons opening a popover on hover, focus and press, that hint tooltips stay tooltips whose trigger carries its own label, and that the 1000 ms hover delay stays.

What the phase found (Base UI 1.8.0, Chromium, jsdom 30.1):

- The library's hover intent already meets 1.4.13: `disableHoverablePopup` defaults to `false`, so the pointer can travel from the target onto the popup, it stays while hovered or focused, and Escape closes it. A real pointer (Playwright mouse with intermediate moves) showed a hint about 1.3 s after it stopped, kept it open while the pointer crossed onto it, closed it on leaving and on Escape, and did not show one after a click. A scripted pointer that teleports onto the popup closes it, so that path is proved in a real browser and not in a story.
- `:focus-visible` is unreliable under jsdom (it answered `false` for a Tab-focused button after an earlier test had focused another element), so the info icon tracks the last input itself.
- The popup of a tooltip opened inside a dialog is portalled into the dialog's own portal, so it is not hidden with the page behind, but Escape reaches both.
- `[aria-live]` regions stay reachable while a dialog hides the rest of the page ([ADR 0048](0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)); a tooltip needs no such exemption.

## Decision

- **`TooltipTarget`** (`apps/ui/src/components/primitives/Tooltip.tsx`) is a Base UI Tooltip around its child. The trigger is the same `inline-flex` wrapper span as before. A hint shows after the pointer has rested for 1000 ms and at once on keyboard focus; focus that follows a mouse click does not show it. It is hoverable and persistent, Escape dismisses it without moving focus or the pointer, and a click on the target closes it. Popups have `role="tooltip"`, sit 5 px clear of the target above it and 13 px below it (within a pixel of the previous placement), stay 8 px inside the window, and take pointer events. `TooltipProvider` remains as the one place to mount, but adds no library provider: Base UI's provider opens a neighbouring tooltip at once while another is showing, and every hint here waits its own second (each trigger carries the delay).
- **The child names itself.** A tooltip is a visual hint, so the control it wraps carries its own accessible name; the hint adds to it. Every `TooltipTarget` use was read: each wrapped control is a button with an `aria-label` or visible text, a `select` inside a labelled setting, or (the disabled ones) is covered by the next point. Three things stay hover-only hints because they are not controls that name themselves: the "Already marked" badge in the proofing results (its visible text is its label), the `MeterBar` segments (the bar's own accessible name carries every segment's text, see the next phase) and the suggested-term chips in Proofing, whose hint ("Suggested — click to accept") only explains what the button does.
- **A disabled child** cannot take focus or hover, so its wrapper is the tab stop (`tabIndex={0}`, as before) and now has `role="group"` and the reason as its `aria-label`.
- **The info icon** (`Tooltip`) is a real `<button aria-label="More information">` whose text is also its `aria-description`, so a screen reader hears it without the popup being open. A Base UI Popover opens on hover (after 1000 ms), on keyboard focus and on a press, Escape closes it, and focus never moves into the popup. A press on an icon that keyboard focus has just opened keeps it open (the next press closes it), and focus moving onto the popup itself is not leaving. The popup is `role="tooltip"` and looks like a hint. The hand-built icon in `GuideDetail.tsx` became this primitive.
- **A hint inside a dialog takes Escape first.** Every hint popup carries `data-hint-popup` (`primitives/hintLayer.ts`); `Dialog` ignores an Escape while one is showing, so the first press closes the hint and the second the dialog.
- **Input modality** is tracked directly (`primitives/inputModality.ts`, the last of keydown or pointerdown) instead of `:focus-visible`.
- **Tests.** RTL tests for both components (delays, Escape, blur and where focus lands, Enter after focus, a click closing a hint, unmount, disabled child, no dangling `aria-describedby`, `aria-labelledby` or `aria-controls` through `primitives/ariaReferences.ts`, a hint inside a dialog) and stories that run in the atlas. The pointer path onto a popup is the one thing not asserted in a story (see above). The visual drivers for `home/info-tooltip`, `global/tooltip`, `global/nav-rail-tooltip` and `proofing/disabled-button` are unchanged.

## Consequences

- Every info icon is one more tab stop (Settings has one per field), the price of keyboard access, and they all share the name "More information": what tells them apart is the description, which older WebKit ignores. The old dangling references are gone.
- `Manuscript.tsx` closes its sheet on Escape with a `window` listener that does not know about hints, so there a hint and the sheet close together; only `Dialog` gives the hint the first Escape.
- `aria-description` is read by Chromium-based WebView2, the Windows target; older WebKit builds ignore it, so on the optional macOS and Linux builds a screen reader announces the button and its expanded state and the text is reachable by pressing it. A screen-reader pass in WebView2 (NVDA) is still owed and is an owner step.
- A tooltip no longer appears after a mouse click on a button (only for keyboard focus), and a click closes an open one.
- An inline (flowing text) tooltip for the teleprompter's flagged words is not built here: nothing uses it yet, and the teleprompter PRD adds it when it does, through the same primitive.
- While a popover that a press opened is showing, Base UI's invisible focus guards (`aria-hidden` spans with `tabindex="0"`) trip axe's `aria-hidden-focus` rule. The atlas runs axe after `play()`, so the story that opens one closes it again before it ends; no `A11Y_DEBT` entry was added.
- To change any of this (a different delay, a non-hoverable hint, a description text on hint targets), write a new ADR that supersedes this one.
