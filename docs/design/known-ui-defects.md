# Known UI defects

Defects found by the visual suite and the component atlas (ADR 0021) that are deliberately **not fixed yet**. Each has
a severity, where it shows, how to reproduce it, a suggested fix, and whether a suite would catch a regression. Fixed
defects are in the ADR, not here. Update this file when one is fixed (delete the entry) or a new one is found.

Severity: **high** blocks a user or fails an accessibility standard outright, **medium** degrades an experience,
**low** is polish or hygiene.

## Accessibility

### 1. Palette tokens miss WCAG AA contrast (medium, design decision)

- **Where:** `--text-faint` (2.2-3.2:1 on the light surfaces, 2.6-3.7:1 in dark), `--text-muted` on `--surface-2` (4.32:1)
  and `--surface-3` (3.85:1), the active `NavButton` (accent text on a 10% accent tint, 4.03:1 in light), and `Highlight`
  (each category colour as text on a 20% tint of itself, 3.2-3.8:1). All in `shared/ui/src/styles.css` tokens and the
  components that use them.
- **Reproduce:** run `pnpm --dir shared/ui atlas` with the entries in `tests/atlas/a11y-debt.ts` removed; axe reports
  `color-contrast` for `Primitives/WorkDialog`, `MeterBar`, `NavButton` and `Highlight`.
- **Suggested fix:** darkening the tokens to reach 4.5:1 collapses the faint/muted hierarchy (faint would have to be darker
  than today's muted), so it needs a palette decision: for example keep three text levels but move all three darker, and
  give tinted backgrounds their own text tokens. Then delete the four debt entries.
- **Caught by:** yes, the atlas fails on any new violation; the debt list cannot grow (`src/atlasCoverage.test.ts`).

### 2. Modal dialogs are not modal for keyboards or screen readers (high)

- **Where:** `Dialog`, `ConfirmDialog`, `WorkDialog` (`src/components/primitives/`).
- **What:** `aria-modal="true"` is set, but there is no Escape handling, no backdrop click, no focus trap, no initial focus and
  the page behind is not `inert`. Keyboard focus can leave the dialog; a screen reader can read the page behind it.
- **Reproduce:** open any confirm dialog (Story Bible delete), press Tab repeatedly, or press Escape.
- **Suggested fix:** one shared `Dialog` implementation: focus the first control on open and restore focus on close, trap Tab,
  close on Escape (when an `onClose` exists), set `inert` on siblings. All three dialogs inherit it.
- **Caught by:** partially. The atlas asserts roles and names but the stories cannot prove a focus trap; add a `play()` that
  tabs past the last control when fixing.

### 3. `WorkDialog` details (medium)

- The progress bar is a plain `div.progressbar` with no `role="progressbar"` or `aria-valuenow`.
- A running job with no `cancel` prop (the Story Bible rebuild) renders an empty action row: the user cannot dismiss it.
- The indeterminate bar uses an infinite CSS animation (`work-progress-slide`) that ignores `prefers-reduced-motion`.
- **Fix:** add the progressbar semantics, always offer Close or Cancel, gate the animation on `motion-safe:`.
- **Caught by:** the `RunningWithoutCancel` story shows the empty action row; nothing asserts semantics.

### 4. `ConfirmDialog` (low)

- `danger` renders its button only when set but takes its label from the separate optional `dangerLabel`: `danger` without
  `dangerLabel` gives an unnamed button. Destructive confirms ("Clear project data") use the primary style because the
  confirm button has no danger variant. `body` accepts only a string; rich content must go through `children`.
- **Fix:** make `dangerLabel` required with `danger`, add a `confirmVariant`, widen `body` to `ReactNode`.

### 5. `MeterBar` has no accessible representation (medium)

- No `role="meter"`, `aria-label` or value text, so the bar means nothing to a screen reader. Each segment's tooltip is an
  `aria-describedby="tooltip-layer"` pointing at an id that does not exist until the tooltip shows, and segments are not
  focusable. The width transition does not honour `prefers-reduced-motion` (already noted in
  `docs/design/motion-and-animation.md`).
- **Fix:** expose the total as `role="meter"` with a text alternative; make segments focusable or list the breakdown as text.

### 6. `Tooltip` reachability (medium)

- The info icon (`i`) is a plain `span` without `tabIndex`, so only mouse hover shows it. `TooltipTarget` sets
  `aria-describedby="tooltip-layer"` whenever a provider exists, pointing at an id that does not exist while nothing is
  shown, and every target uses the same id. For a disabled child the focusable wrapper span has no accessible name or role.
  `ActiveTooltip.key` (`Date.now()`) is never read.
- **Fix:** make the icon a focusable button with `aria-label`, give each tooltip a unique id and only reference it while
  shown, drop the unused `key`.

### 7. `Field`, `Heading`, `Panel` gaps (low)

- `Field` renders no `aria-invalid` or `aria-describedby` and has no hint or error slot. `Heading` is always an `<h1>`
  (no level prop; a long unbroken subtitle would overflow at 390px). `Panel` is a bare `<section>` with no accessible name
  and no header or actions slot.

## Layout

### 8. Settings controls collapse on mobile (medium)

- **Where:** Settings page, every category with `<select>` or colour inputs, at 390px (`ScopedSetting.tsx`, `Settings.tsx`).
- **What:** the model and chunk-length selects render as blank slivers, the colour swatch and hex input are squeezed to a
  few pixels.
- **Reproduce:** `pnpm --dir shared/ui screenshots` then open
  `shared/ui/screenshots/app/settings/global-proofing/mobile.png`, or resize any Settings category to 390px.
- **Suggested fix:** stack label above control below the `md` breakpoint and give controls `min-w-0 w-full`.
- **Caught by:** the suite would flag horizontal overflow but not this; only a reviewer looking at the PNG sees it. The
  state `settings/global-proofing` at mobile is the regression check.

## Tooling limits worth knowing (not product defects)

- **Axe does not run on app states, only on stories.** Page-level contrast and labels are checked only by looking at the
  PNGs. It also cannot judge gradients or low-contrast text over semi-transparent overlays.
- **Pixel baselines are not adopted.** Sub-pixel anti-aliasing still differs between runs on a Windows machine, so a
  baseline diff would be noise; it needs a pinned Linux container. The gate is "no errors, no overflow, no blank, no
  duplicate", not "looks identical".
- **CI flake from `main`:** `TestShutdownStopsARunningTeleprompterWithoutDeadlocking` (`shell/`, Go) failed once on both Go
  jobs with no Go changes and passed on the next run; it looks timing-sensitive and is unrelated to the UI.
