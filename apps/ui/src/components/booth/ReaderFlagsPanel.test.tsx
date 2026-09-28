// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderFlagsPanel } from './ReaderFlagsPanel';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi, TeleprompterFlag } from '../../types';

afterEach(cleanup);

const FLAG: TeleprompterFlag = { type: 'flag', id: 1, kind: 'misread', start: 4, end: 5, heard: 'teh' };

function renderPanel(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <ReaderFlagsPanel
        flags={[FLAG]}
        visibility={{ skipped: true, restart: true, misread: true, extra: true }}
        onVisibility={() => {}}
        dismissed={new Set()}
        onDismiss={() => {}}
        selected={FLAG}
        onSelect={() => {}}
        textOf={() => 'a teh'}
        save={{ status: 'idle' }}
      />
    </ApiProvider>,
  );
  return { api };
}

describe('ReaderFlagsPanel "Punch from here"', () => {
  it('previews the resolved time before moving anything, and confirming punches', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel({}, { daw: { toggles: { punch: 'on' } } });
    const previewSpy = vi.spyOn(api, 'teleprompterPunchPreview');
    const punchSpy = vi.spyOn(api, 'teleprompterPunch');

    await user.click(screen.getByRole('button', { name: 'Punch from here' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Punch from here' });
    expect(previewSpy).toHaveBeenCalledWith(FLAG.start);
    expect(punchSpy).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('Nothing else changes.');

    await user.click(screen.getByRole('button', { name: 'Punch' }));
    await waitFor(() => expect(punchSpy).toHaveBeenCalledWith(FLAG.start));
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Punch from here' })).toBeNull());
  });

  it('cancelling the confirm dialog moves nothing', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel({}, { daw: { toggles: { punch: 'on' } } });
    const punchSpy = vi.spyOn(api, 'teleprompterPunch');

    await user.click(screen.getByRole('button', { name: 'Punch from here' }));
    await screen.findByRole('alertdialog', { name: 'Punch from here' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog', { name: 'Punch from here' })).toBeNull();
    expect(punchSpy).not.toHaveBeenCalled();
  });

  it('does nothing when the punch capability is off (the default, before verification promotes it)', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();
    const previewSpy = vi.spyOn(api, 'teleprompterPunchPreview');

    await user.click(screen.getByRole('button', { name: 'Punch from here' }));

    expect(previewSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
