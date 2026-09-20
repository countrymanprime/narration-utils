// Every hint popup (a tooltip, or the popup behind an info icon) carries this attribute, so a dialog can tell that Escape
// is meant for the hint that is showing and not for the dialog it sits in.
export const HINT_POPUP_ATTRIBUTE = 'data-hint-popup';
export const HINT_POPUP_SELECTOR = `[${HINT_POPUP_ATTRIBUTE}]`;

// Everything a hint looks like: one place, so a tooltip and an info-icon popup cannot drift apart.
export const HINT_POPUP_CLASSES =
  'w-max max-w-60 animate-[tooltip-in_0.12s_ease] rounded-[0.4rem] bg-[var(--text)] px-[0.65rem] py-2 text-[0.78rem] leading-[1.35] text-[var(--bg)] shadow-[var(--shadow-lg)]';
