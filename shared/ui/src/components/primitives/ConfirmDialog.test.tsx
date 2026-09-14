// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
