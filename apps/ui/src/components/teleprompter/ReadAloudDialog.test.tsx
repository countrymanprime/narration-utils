// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadAloudDialog } from './ReadAloudDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TELEPROMPTER_DEVICES } from '../../api/mockFixtures';
import type { NarrationApi, TeleprompterEvent, TeleprompterState } from '../../types';

const DEVICE_NAME = WIRE_TELEPROMPTER_DEVICES[0].name;
const CHAPTER = { id: 'chapter-1', title: 'Chapter 1', subtitle: 'Down the Rabbit-Hole' };

afterEach(() => {
  cleanup();
});

function renderDialog(overrides: Partial<NarrationApi> = {}, onClose = vi.fn()) {
  const eventListeners = new Set<(event: TeleprompterEvent) => void>();
  const stateListeners = new Set<(state: TeleprompterState) => void>();
  const api = createMockApi({
    subscribeTeleprompterEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    subscribeTeleprompterState: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    ...overrides,
  });
  render(
    <ApiProvider api={api}>
      <ReadAloudDialog chapter={CHAPTER} onClose={onClose} />
    </ApiProvider>,
  );
  return {
    api,
    onClose,
    setState: (state: Partial<TeleprompterState>) =>
      act(() =>
        stateListeners.forEach((listener) => listener({ phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null, ...state })),
      ),
  };
}

describe('ReadAloudDialog', () => {
  it('opens as a full-size dialog titled with the chapter, with no chapter picker (the chapter is fixed)', async () => {
    renderDialog();

    const dialog = await screen.findByRole('dialog', { name: /Read aloud.*Chapter 1/ });
    expect(dialog).toBeTruthy();
    expect(screen.queryByLabelText('Chapter')).toBeNull();
    expect(await screen.findByLabelText('Microphone')).toBeTruthy();
  });

  it('starts a session for the fixed chapter once a microphone is chosen', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderDialog({ teleprompterStart });

    const field = await screen.findByRole('combobox', { name: 'Microphone' });
    await user.selectOptions(field, DEVICE_NAME);
    await user.click(screen.getByRole('button', { name: 'Start reading' }));

    expect(teleprompterStart).toHaveBeenCalledWith({ chapter: 'chapter-1', device: DEVICE_NAME, model: 'tiny' });
  });

  it('closes without a confirm when no session is running', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await screen.findByRole('combobox', { name: 'Microphone' });
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks for confirmation before closing a live session, and stops it on confirm', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Close' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Stop and close' }));

    expect(teleprompterStop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // The PRD's Open Questions, "Closing the modal during a live session": Escape must not silently stop a live
  // session. `Dialog` routes Escape through the same `onClose` the header Close button uses (`dismiss = escapeCloses ?
  // (onClose ?? onEscape) : undefined`, primitives/Dialog.tsx), and `ReadAloudDialog` passes `requestClose` (which
  // confirms first when active) as that `onClose` - so Escape and the Close button are one code path, not two.
  it('Escape asks for confirmation before closing a live session too, the same as the Close button', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy());

    await user.keyboard('{Escape}');

    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Stop and close' }));

    expect(teleprompterStop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes without a confirm when no session is running', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await screen.findByRole('combobox', { name: 'Microphone' });
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('cancelling the close confirm leaves the session running and the dialog open', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Close' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    expect(teleprompterStop).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
});
