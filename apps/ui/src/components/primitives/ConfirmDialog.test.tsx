// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('offers cancel, save, and discard actions in the guard dialog', () => {
    const cancel = vi.fn();
    const save = vi.fn();
    const discard = vi.fn();
    render(
      <ConfirmDialog
        title="Unsaved settings"
        body="Save or discard changes before leaving Settings?"
        confirmLabel="Save & continue"
        confirm={save}
        dangerLabel="Discard & continue"
        danger={discard}
        cancel={cancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard & continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('while the confirmed action runs, the confirm button is busy and ignores a press, and nothing else can leave the dialog', () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    const danger = vi.fn();
    render(
      <ConfirmDialog
        title="Delete entry"
        body="Delete it?"
        confirmLabel="Delete entry"
        confirm={confirm}
        dangerLabel="Discard"
        danger={danger}
        cancel={cancel}
        pending
      />,
    );
    const button = screen.getByRole('button', { name: 'Delete entry' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(danger).not.toHaveBeenCalled();
  });

  it('omits the danger action entirely when no dangerLabel/danger is given', () => {
    render(<ConfirmDialog title="Confirm" body="Continue?" confirmLabel="OK" confirm={() => {}} cancel={() => {}} />);
    expect(screen.queryByRole('button', { name: /discard/i })).toBeNull();
  });

  it('keeps a long dialog body separate from the persistent action row', () => {
    render(
      <ConfirmDialog title="Import manuscript" body="Review the imported structure." confirmLabel="Import" confirm={() => {}} cancel={() => {}}>
        <div>
          {Array.from({ length: 100 }, (_, index) => (
            <p key={index}>Suggested character {index}</p>
          ))}
        </div>
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Import manuscript' });
    expect(within(dialog).getByText('Suggested character 0')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('is an alertdialog described by its body', () => {
    render(
      <ConfirmDialog title="Delete entry" body="Delete “Alice”? This cannot be undone." confirmLabel="Delete entry" confirm={() => {}} cancel={() => {}} />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete entry' });
    expect(screen.getByText(/This cannot be undone/).id).toBe(dialog.getAttribute('aria-describedby'));
  });

  it('accepts rich content as its body', () => {
    render(
      <ConfirmDialog
        title="Replace"
        body={
          <span>
            Replace <b>everything</b>?
          </span>
        }
        confirmLabel="Replace"
        confirm={() => {}}
        cancel={() => {}}
      />,
    );
    expect(within(screen.getByRole('alertdialog')).getByText('everything').tagName).toBe('B');
  });

  it('draws the confirm button red only for a destructive confirm', () => {
    const { rerender } = render(<ConfirmDialog title="Delete entry" body="Sure?" confirmLabel="Delete entry" confirm={() => {}} cancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Delete entry' }).className).toContain('bg-[var(--accent)]');
    rerender(<ConfirmDialog title="Delete entry" body="Sure?" confirmLabel="Delete entry" confirmVariant="danger" confirm={() => {}} cancel={() => {}} />);
    const confirm = screen.getByRole('button', { name: 'Delete entry' });
    expect(confirm.className).toContain('text-[var(--danger-text)]');
    expect(confirm.className).not.toContain('bg-[var(--accent)]');
  });

  it('declines on Escape but not on a press of the backdrop', async () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog title="Delete entry" body="Sure?" confirmLabel="Delete entry" confirm={confirm} cancel={cancel} />);
    await user.click(document.querySelector('[data-dialog-backdrop]') as HTMLElement);
    expect(cancel).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('ignores Escape while it is a running download (escapeCancels false), but Cancel still declines', async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog title="Downloading" body="Halfway" confirmLabel="Downloading…" escapeCancels={false} confirm={() => {}} cancel={cancel} />);
    await screen.findByRole('alertdialog', { name: 'Downloading' });
    await user.keyboard('{Escape}');
    expect(cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('describes itself by nothing rather than an empty node while its body is empty', () => {
    render(<ConfirmDialog title="Downloading" body="" confirmLabel="Downloading…" confirm={() => {}} cancel={() => {}} />);
    expect(screen.getByRole('alertdialog', { name: 'Downloading' }).getAttribute('aria-describedby')).toBeNull();
  });

  it('refuses a danger action without its label at the type level', () => {
    // A third action needs both its handler and its label.
    // @ts-expect-error dangerLabel is required with danger
    const missingLabel = <ConfirmDialog title="Unsaved" body="x" confirmLabel="Save" confirm={() => {}} danger={() => {}} cancel={() => {}} />;
    // @ts-expect-error danger is required with dangerLabel
    const missingHandler = <ConfirmDialog title="Unsaved" body="x" confirmLabel="Save" confirm={() => {}} dangerLabel="Discard" cancel={() => {}} />;
    expect([missingLabel, missingHandler]).toHaveLength(2);
  });
});
