import { within } from 'storybook/test';

// A dialog, popover or tooltip is portalled to <body>, outside the story canvas, and Base UI mounts the portal one
// commit after the story renders. A `play()` therefore queries the whole document, and starts with a `findBy` (which waits)
// for the popup before it asserts anything with a `getBy`.
export const screen = within(document.body);

// Tab may rest for a moment on one of the invisible focus guards that bracket a modal before it wraps; those live in the
// dialog's portal, so "inside the dialog" means inside its portal.
export const insidePortal = (element: Element | null): boolean => element?.closest('[data-base-ui-portal]') != null;
