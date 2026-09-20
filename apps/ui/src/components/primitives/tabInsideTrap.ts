import { waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

type User = ReturnType<typeof userEvent.setup>;

// Press Tab (or Shift+Tab) in a modal and wait until focus has come to rest on a real control inside its portal.
//
// A modal brackets its content with invisible focus guards. Tabbing past the last control lands on a guard, and Base UI
// moves focus from there to the opposite end of the modal a frame later (requestAnimationFrame, about 16 ms in jsdom).
// `user.tab()` returns long before that, so sampling `document.activeElement` straight away sees the guard, and the next
// press starts from it and walks out to the page behind. A person cannot press Tab inside a frame, so waiting for the
// frame is the same as the real keyboard. A guard counts as "inside the portal", so the wait must rule it out too.
export async function tabInsideTrap(user: User, options?: { shift?: boolean }): Promise<Element> {
  await user.tab(options);
  return waitFor(() => {
    const active = document.activeElement;
    if (!active?.closest('[data-base-ui-portal]') || active.hasAttribute('data-base-ui-focus-guard')) {
      throw new Error(`focus rests on ${active?.outerHTML.slice(0, 120) ?? 'nothing'}, not on a control inside the modal`);
    }
    return active;
  });
}
