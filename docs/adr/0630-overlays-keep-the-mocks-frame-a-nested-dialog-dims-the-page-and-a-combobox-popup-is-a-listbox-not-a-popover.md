# 0630. Overlays keep the mocks' frame, a nested dialog dims the page, and a combobox popup is a Listbox, not a Popover

**Status:** Proposed (Phase 7 of the [mock fidelity PRD](../prds/mock-fidelity-primitives-and-components.prd.md), stream F-P7 on [#509](https://github.com/countrymanprime/narration-utils/issues/509); its Q4 recommendation and the action-order recommendation were taken per D22 and are for the owner to confirm on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-28
**Supersedes:** nothing. [ADR 0001](0001-import-dialog-max-width-and-overflow.md) (70vw), [ADR 0002](0002-dialog-action-button-placement.md) (action placement), [ADR 0048](0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md) (one modal shell) and [ADR 0051](0051-the-slide-over-and-the-navigation-drawer-are-modal-base-ui-drawers.md) (modal slide-overs) stand.

## Context

The owner found that the merged pages don't match the approved mocks (D91). Phase 7 of the PRD covers the overlays: Dialog and its families (ConfirmDialog, WorkDialog), SlideOver, Toast and Popover. The dark-set mocks were measured again for this phase at their own size, with the app captured beside them by `pnpm --dir apps/ui mock-match`:

- **Dialog** (chapter-track-link-control/06, daw-chapter-track-auto-sync/01, credits-token-setup/01): the frame, the 59 px header with its 1 px divider, the title, the 32 px Close button 18 px from the edge and the body inset already matched the app to the pixel. The action row did not: the mocks draw it 66 px under its divider (12 px, a 38 px button, 16 px), and the app drew 60 px, because Button is 32 px now ([ADR 0595](0595-button-has-two-measured-sizes-a-surface-filled-secondary-and-a-link-and-owns-its-look.md)).
- **The remove-from-recording confirm** (chapter-track-link-control/06) is opened from the chapter's track SlideOver. Base UI leaves out the backdrop of a dialog nested in another dialog or a Drawer, so the page behind it was not dimmed at all, where the mock dims it like every other dialog.
- **SlideOver** (chapter-track-link-control/02, 03, 05): 320 px, the left border and shadow, the 59 px header, and a transparent backdrop. The PRD's Q4 asked for a transparent backdrop, and ADR 0051 already drew one: the PRD's "app today" column was out of date. Only the header's height was not held when a panel has a two-line title.
- **Toast** (daw-chapter-track-auto-sync/03): 45 px tall, inverted, radius 6, led by the track glyph. The app's toast was already inverted ([ADR 0590](0590-the-mock-fidelity-token-batch-fills-badges-with-opaque-soft-tokens-and-names-the-mocks-sizes-and-type.md)'s colours, drawn from `--text`/`--bg` directly), 41 px tall, and had no way to carry a glyph.
- **Popover** (read-aloud-control-bar/03 and 04): 336 to 352 px wide, 16 px padding, radius 8, right-aligned to its trigger and about 12 px from it. The app drew 12 px padding, 8 px away, left-aligned and as narrow as its content.
- **The hand-drawn listbox** in `storybible/GuideDetail.tsx` (the alias box's matching entries) is the popup of a combobox: the text box keeps focus and moves the active row with the arrow keys. It also put its Add alias and Rescan buttons inside `role="listbox"`, whose children may only be options.

## Decision

- **Dialog** holds the header at 59 px plus its divider whether or not it has a Close button, and the action row at 66 px under its divider, with the buttons centred in the mocks' 38 px band. Its radius is `--radius-card`. The body copy stays as it was: the description is `--text-muted` and the children are `--text`. Muting the whole body would mute every form label in 19 dialogs, and the mocks draw those in `--text` (chapter-track-link-control/06's "What is it?").
- **A dialog always draws its backdrop** (`forceRender`), including one opened from a SlideOver or from another dialog. A dialog over a dialog dims the first one too.
- **Action order stays [ADR 0002](0002-dialog-action-button-placement.md)'s rule** (`between` by default, `end` for one action). The mocks follow it except daw-chapter-track-auto-sync/01 and credits-token-setup/01, which group the secondary with the primary at the right. Which convention wins goes to the owner on #510, and this ADR recommends ADR 0002's.
- **SlideOver** holds its header at 59 px plus its divider, the same as Dialog's. The backdrop stays transparent and the panel stays modal (ADR 0051, Q4).
- **Toast** is at least 45 px tall with radius `--radius-button`, and draws `--toast-bg`/`--toast-text`. `Notify` takes an optional fourth argument, a Font Awesome icon that leads an information message. An error always leads with its warning glyph. The chapter-sync toast passes the track glyph.
- **Popover** defaults to `align="end"`, sits 12 px from its trigger, pads 16 px, uses `--radius-card`, and is at least 21rem (336 px) wide, never wider than the viewport.
- **A new `Listbox` primitive** is the popup of a combobox. It has the popover's frame, rows with a divider, the active row on `--surface-2`, and a chosen value marked with an `--accent` check (read-aloud-control-bar/03). Its options leave the Tab order and carry ids for `aria-activedescendant`, and a footer sits inside the frame but outside the listbox role. It is not a Popover, because a Popover moves focus into itself and a combobox must not. The Story Bible alias box uses it, and its text box now names the active option.

## Consequences

- Every dialog, confirm and work dialog has the mocks' header and action row, and a confirm opened from a panel dims the page like any other dialog. A dialog opened over a dialog dims twice, which is darker than before.
- The measured scores moved by at most a point per state, because the frames already matched. The rest of each difference is content and page layout, which other phases own. For example, the Booth behind the popovers is Phase 13's, and the slide-over's fact rows are Phase 3's.
- The Booth's microphone picker still uses a native select inside the popover. The mock draws it as a checked list, and `Listbox` is the primitive for it when Phase 13 rebuilds the Booth's control bar.
- The toast's glyph is opt-in, so no existing toast changes until its caller passes one.
- Changing any of these measurements again is a change to the primitive and its story, and a new ADR that supersedes this one.
