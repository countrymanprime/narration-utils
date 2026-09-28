// The card look Panel draws (mock-fidelity-primitives-and-components.prd.md Phase 4, ADR 0640), measured on benchmark mock
// 05: a 1 px `--border` frame at the card radius with `--shadow` on `--surface`; a header row 50 px tall with its divider
// (55 px when it holds a 32 px button, 11 px above and below it), its content 16 px in from the frame; and a 16 px body.
// A surface that is not a `section` (a TabPanel drawn as a card) takes these from here rather than copying them.

export const PANEL_FRAME_CLASS = 'rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]';

export const PANEL_HEADER_CLASS =
  'flex min-h-[3.125rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-[0.6875rem]';

// The body's padding, as a custom property too, so a `Table flush` inside it can span exactly that much.
export const PANEL_BODY_CLASS = 'p-[var(--panel-pad)] [--panel-pad:1rem]';

// The card title: Barlow Condensed at the card-title size (19 px), semibold, `--text`.
export const PANEL_TITLE_CLASS =
  "min-w-0 font-['Barlow_Condensed',sans-serif] text-[length:var(--font-size-card-title)] leading-[1.2] font-semibold text-[var(--text)] [overflow-wrap:anywhere]";

// The caps title the dark Settings mocks draw over a category (delivery-platform-profiles 05 and 09, input-commands 01):
// Barlow Condensed 17 px, semibold, uppercase, tracked 0.08 em.
export const PANEL_CAPS_TITLE_CLASS =
  "min-w-0 font-['Barlow_Condensed',sans-serif] text-[1.0625rem] leading-[1.2] font-semibold tracking-[0.08em] text-[var(--text)] uppercase [overflow-wrap:anywhere]";

// The subtitle sits on the title's line, 10 px after it: Plex Sans 13 px, muted. It keeps to that line and wraps inside
// its own box while it has 10 rem, and only then drops under the title.
export const PANEL_SUBTITLE_CLASS = 'min-w-0 flex-[1_1_10rem] text-[0.8125rem] text-[var(--text-muted)] [overflow-wrap:anywhere]';
