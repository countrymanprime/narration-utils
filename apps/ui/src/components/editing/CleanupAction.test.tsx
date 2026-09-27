// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CleanupAction } from './CleanupAction';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { editingCandidateFor } from '../../api/mockFixtures';

afterEach(cleanup);

const chapterId = 'chapter-1';

type Initial = Parameters<typeof createMockApi>[1];

function renderAction(initial: Initial = {}) {
  const api = createMockApi({}, initial);
  const notify = vi.fn();
  render(
    <ApiProvider api={api}>
      <CleanupAction chapterId={chapterId} notify={notify} />
    </ApiProvider>,
  );
  return { api, notify };
}

describe('CleanupAction', () => {
  it('is disabled with the experimental-off message before the narrator turns the setting on', async () => {
    renderAction();
    const trim = await screen.findByRole('button', { name: 'Trim silence…' });
    const match = screen.getByRole('button', { name: 'Match levels…' });
    await waitFor(() => expect(trim.getAttribute('aria-disabled')).toBe('true'));
    expect(match.getAttribute('aria-disabled')).toBe('true');
  });

  it('previews then trims silence candidates, in one undo step per the confirm text', async () => {
    const user = userEvent.setup();
    const candidate = editingCandidateFor(chapterId, 'Chapter One', 0);
    const { notify } = renderAction({ daw: { experimentalOn: true }, findings: [candidate] });
    const trim = await screen.findByRole('button', { name: 'Trim silence…' });
    await waitFor(() => expect(trim.getAttribute('aria-disabled')).toBeNull());
    await user.click(trim);

    const dialog = await screen.findByRole('alertdialog', { name: 'Trim silence' });
    expect(dialog.textContent).toMatch(/1 silence candidate in this chapter/);

    await user.click(screen.getByRole('button', { name: 'Trim' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Trimmed 1 candidate of 1\./), 'info'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('reports the refusal instead of opening a dialog when there is nothing to trim', async () => {
    const user = userEvent.setup();
    const { notify } = renderAction({ daw: { experimentalOn: true }, findings: [] });
    const trim = await screen.findByRole('button', { name: 'Trim silence…' });
    await waitFor(() => expect(trim.getAttribute('aria-disabled')).toBeNull());
    await user.click(trim);
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/no silence-trim candidates/), 'error'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('previews then matches the linked track’s item levels', async () => {
    const user = userEvent.setup();
    const { notify } = renderAction({ daw: { experimentalOn: true } });
    const match = await screen.findByRole('button', { name: 'Match levels…' });
    await waitFor(() => expect(match.getAttribute('aria-disabled')).toBeNull());
    await user.click(match);

    const dialog = await screen.findByRole('alertdialog', { name: 'Match levels' });
    expect(dialog.textContent).toMatch(/1 item on this chapter's linked track/);

    await user.click(screen.getByRole('button', { name: 'Match' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Matched levels on 1 item\./), 'info'));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // A second preview finds nothing left to match: cleanupActionMock resolves its fixture on Apply.
    await user.click(screen.getByRole('button', { name: 'Match levels…' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/no item on this chapter's linked track/), 'error'));
  });
});
