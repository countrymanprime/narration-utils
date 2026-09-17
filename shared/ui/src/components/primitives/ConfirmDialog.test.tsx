// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    const dialog = screen.getByRole('dialog', { name: 'Import manuscript' });
    expect(within(dialog).getByText('Suggested character 0')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeTruthy();
  });
});
