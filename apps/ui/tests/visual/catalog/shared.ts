// The row metadata (extra viewports, reloadPerViewport reasons) the page files under catalog/ share.
import { REFLOW_VIEWPORT } from '../viewports';

// The Settings row stacks below `md`, so every Settings state is also captured at the reflow width (ADR 0061) and the
// collapsed-control check runs there.
export const REFLOW = { extraViewports: [REFLOW_VIEWPORT] };

// `reloadPerViewport` (lib/types.ts), with the reason as the constant's name: these rows' pictures at a smaller width
// differ from a fresh load at that width when the suite drives the page once at desktop width and resizes (found by
// comparing every PNG when the suite moved to one load per state, ADR 0106). A tooltip closes when the window resizes; a
// scroll offset the driver set (a dialog body, a table, a tab strip) stays where the desktop layout put it; a popup keeps
// the place it opened at; live progress keeps running while the other viewports are captured. A driver that freezes the
// page clock cannot share a load at all (lib/capture.ts says why, and fails the row without this).
export const TOOLTIP_CLOSES_ON_RESIZE = { reloadPerViewport: true } as const;
export const KEEPS_DESKTOP_SCROLL = { reloadPerViewport: true } as const;
export const POPUP_ANCHORED_AT_FIRST_WIDTH = { reloadPerViewport: true } as const;
export const LIVE_PROGRESS_MOVES_ON = { reloadPerViewport: true } as const;
export const TOAST_FADES_OUT = { reloadPerViewport: true } as const;
export const FREEZES_THE_CLOCK = { reloadPerViewport: true } as const;
