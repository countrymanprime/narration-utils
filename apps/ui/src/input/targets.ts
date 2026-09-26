/**
 * Elements that already own a keystroke before any command sees it (ADR 0361 decision 4, moved here from
 * `useFollowCursor.ts`, ADR 0119): a field, a widget Space activates, or an ARIA role whose arrow keys move a
 * selection or a value rather than the page. `useFollowCursor.ts` re-exports these three so `isScrollKey` and its
 * tests keep working unchanged.
 */
export const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
export const SPACE_ACTIVATES = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"]';
export const KEY_WIDGET_ROLES = new Set([
  'combobox',
  'grid',
  'listbox',
  'menu',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'slider',
  'spinbutton',
  'tab',
  'tablist',
  'textbox',
  'tree',
  'treeitem',
]);

/**
 * Whether a gesture's target already owns the key: a field, a widget Space activates, or a `KEY_WIDGET_ROLES` role.
 * The router (`router.tsx`) applies this only to a gesture with no modifier held (Solution Detail, "Router"); a
 * modified gesture like Alt+ArrowLeft reaches its command regardless of target, matching `App.tsx`'s nav shortcuts
 * today. This is the same check `ReadingControlBar`'s old `isWidgetTarget` and `useFollowCursor`'s `isScrollKey`
 * made by hand.
 */
export function isGuardedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(EDITABLE) || target.closest(SPACE_ACTIVATES)) return true;
  const role = target.getAttribute('role');
  return Boolean(role && KEY_WIDGET_ROLES.has(role));
}
