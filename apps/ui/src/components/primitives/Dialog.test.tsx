// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { tabInsideTrap } from './tabInsideTrap';

afterEach(cleanup);

// The app renders a dialog conditionally, as `{open && <Dialog ... />}`, so this harness does the same: it is the shape
// every consumer has, with no trigger element inside the dialog.
function Harness({ dismissible = true, withAutofocus = false, keepOpener = true }: { dismissible?: boolean; withAutofocus?: boolean; keepOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <main tabIndex={-1}>
        {(keepOpener || !open) && <button onClick={() => setOpen(true)}>Open dialog</button>}
        <button>Behind the dialog</button>
      </main>
      {open && (
        <Dialog
          title="Add note"
          onClose={dismissible ? () => setOpen(false) : undefined}
          actions={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary">Save</Button>
            </>
          }
        >
          <p>Body text</p>
          {withAutofocus && <textarea aria-label="Note text" autoFocus />}
        </Dialog>
      )}
    </div>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Open dialog' }));
  return { user, dialog: await screen.findByRole('dialog', { name: 'Add note' }) };
}

describe('Dialog is a real modal', () => {
  it('is named by its visible title and renders outside the page it covers', async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Add note' })).toBeTruthy();
    expect(document.querySelector('main')?.contains(dialog)).toBe(false);
  });

  it('puts focus on the body region so a screen reader reads the message first', async () => {
    const { dialog } = await openDialog();
    const body = within(dialog).getByText('Body text').parentElement;
    // Base UI applies the initial focus a frame after the dialog mounts.
    await waitFor(() => expect(document.activeElement).toBe(body));
  });

  it('lets an autoFocus child win over the body region', async () => {
    const user = userEvent.setup();
    render(<Harness withAutofocus />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog', { name: 'Add note' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Note text' })));
  });

  it('hides the page behind it from assistive technology while open', async () => {
    await openDialog();
    expect(screen.queryByRole('button', { name: 'Behind the dialog' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Behind the dialog', hidden: true }).closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    await openDialog();
    const user = userEvent.setup();
    const page = screen.getByRole('button', { name: 'Behind the dialog', hidden: true });
    // Tab may stop for a moment on one of the invisible focus guards that bracket the dialog, and it wraps from there;
    // `tabInsideTrap` waits for it to settle. What must never happen is focus reaching the page behind it.
    for (let press = 0; press < 14; press += 1) {
      const focused = await tabInsideTrap(user, { shift: press % 3 === 2 });
      expect(focused, `press ${press}`).not.toBe(page);
    }
  });

  it('closes on Escape when there is an onClose and returns focus to the opener', async () => {
    const { user } = await openDialog();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open dialog' })));
  });

  it('returns focus to the opener when a button closes it', async () => {
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open dialog' })));
  });

  it('falls back into the main landmark when the opener is gone', async () => {
    const user = userEvent.setup();
    render(<Harness keepOpener={false} />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog', { name: 'Add note' });
    await user.keyboard('{Escape}');
    // The opener was removed while the dialog was open, so focus goes to the landmark (or its first control), not <body>.
    await waitFor(() => expect(document.querySelector('main')?.contains(document.activeElement)).toBe(true));
  });

  it('ignores Escape when the dialog has no way to be dismissed', async () => {
    const user = userEvent.setup();
    render(<Harness dismissible={false} />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog', { name: 'Add note' });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Add note' })).toBeTruthy();
  });

  it('does not close when the backdrop is pressed', async () => {
    const { user } = await openDialog();
    const backdrop = document.querySelector('[data-dialog-backdrop]') as HTMLElement;
    expect(backdrop).not.toBeNull();
    await user.click(backdrop);
    expect(screen.getByRole('dialog', { name: 'Add note' })).toBeTruthy();
  });

  it('reports the header Close button exactly once', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog title="Add note" onClose={onClose} actions={<Button variant="primary">Save</Button>}>
        <p>Body</p>
      </Dialog>,
    );
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers a separate Escape handler for a dialog that has no header Close button', async () => {
    const onEscape = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog title="Import manuscript" onEscape={onEscape} actions={<Button variant="primary">Done</Button>}>
        <p>Body</p>
      </Dialog>,
    );
    await screen.findByRole('dialog', { name: 'Import manuscript' });
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('ignores Escape when escapeCloses is false, but the header Close button still works', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog title="Downloading" onClose={onClose} escapeCloses={false} actions={<Button variant="primary">Cancel</Button>}>
        <p>Body</p>
      </Dialog>,
    );
    await screen.findByRole('dialog', { name: 'Downloading' });
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps a live region reachable while a dialog hides the rest of the page', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button onClick={() => undefined}>Behind</button>
        <div role="status" aria-live="polite">
          Saved
        </div>
        <Dialog title="Add note" onClose={() => undefined} actions={<Button variant="primary">Save</Button>}>
          <p>Body</p>
        </Dialog>
      </div>,
    );
    await screen.findByRole('dialog', { name: 'Add note' });
    await user.tab();
    expect(screen.queryByRole('button', { name: 'Behind' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('is an alertdialog described by its text when it is the alert variant', async () => {
    render(
      <Dialog title="Delete entry" variant="alert" description="This cannot be undone." actions={<Button variant="primary">Delete</Button>}>
        <p>Extra</p>
      </Dialog>,
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete entry' });
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
    expect(within(dialog).getByText('This cannot be undone.').id).toBe(dialog.getAttribute('aria-describedby'));
  });

  it('draws no action row when it has no actions, and keeps the body as the one focus target', async () => {
    render(
      <Dialog title="Rebuild" actions={null}>
        <p>Working</p>
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Rebuild' });
    expect(dialog.querySelector('[data-dialog-actions]')).toBeNull();
    expect(within(dialog).queryAllByRole('button')).toHaveLength(0);
    await waitFor(() => expect(dialog.querySelector('[tabindex="0"]')).toBe(document.activeElement));
  });
});
