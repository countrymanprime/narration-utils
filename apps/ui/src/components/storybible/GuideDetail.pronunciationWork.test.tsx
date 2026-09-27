// @vitest-environment jsdom
// The narrator's pronunciation work (prep-depth P1, ADR 0346): the status and note in the read view, their own pronunciation typed
// beside the dictionary's, a switch to the kept alternate, and a status saved with its note. The controls live in edit mode only.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import type { GuideEntity } from '../../types';
import { GuideDetail } from './GuideDetail';

afterEach(() => cleanup());

const base = WIRE_ENTITIES.find((row) => Boolean(row.pronunciation.ipa) && !row.locked);
if (!base) throw new Error('the fixture entry is missing');

function renderDetail(entity: GuideEntity) {
  const api = createMockApi();
  const spies = {
    user: vi.spyOn(api, 'guidePronounceUser'),
    alternate: vi.spyOn(api, 'guidePronunciationUseAlternate'),
    status: vi.spyOn(api, 'guidePronunciationSetStatus'),
  };
  render(
    <ApiProvider api={api}>
      <GuideDetail entity={entity} entities={[entity]} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
  return spies;
}

describe('the read view', () => {
  it('reads an entry written before status existed as Researched, with no controls', () => {
    renderDetail({ ...base, pronunciation: { ipa: '/x/', source: 'CMU dictionary', confidence: 'medium' } });
    expect(screen.getByText('Researched')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Your pronunciation' })).toBeNull();
  });

  it('shows the status, the note, the narrator’s source as Yours and the kept alternate', () => {
    renderDetail({
      ...base,
      pronunciation: {
        ipa: 'wɹɛn',
        source: 'user',
        confidence: 'narrator',
        status: 'query_sent',
        note: 'Asked by email.',
        alternate: { ipa: 'ɹɛn', source: 'CMU dictionary', confidence: 'medium' },
      },
    });
    expect(screen.getByText('Query sent')).toBeTruthy();
    expect(screen.getByText('Asked by email.')).toBeTruthy();
    expect(screen.getByText(/Source: Yours/)).toBeTruthy();
    expect(screen.getByText('ɹɛn')).toBeTruthy();
  });
});

describe('edit mode', () => {
  it('saves the narrator’s own pronunciation, trimmed', async () => {
    const user = userEvent.setup();
    const spies = renderDetail(base);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pronunciation details' }));
    const mine = screen.getByRole('button', { name: 'Use mine' });
    expect(mine.hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Your pronunciation' }), '  wɹɛn ');
    await user.click(mine);
    await waitFor(() => expect(spies.user).toHaveBeenCalledWith(base.id, 'wɹɛn'));
  });

  it('refuses an overlong pronunciation before calling the host', async () => {
    const spies = renderDetail(base);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pronunciation details' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your pronunciation' }), { target: { value: 'x'.repeat(201) } });
    expect(screen.getByText('At most 200 characters.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use mine' }).hasAttribute('disabled')).toBe(true);
    expect(spies.user).not.toHaveBeenCalled();
  });

  it('switches to the kept alternate', async () => {
    const user = userEvent.setup();
    const spies = renderDetail({
      ...base,
      pronunciation: { ipa: 'wɹɛn', source: 'user', confidence: 'narrator', alternate: { ipa: 'ɹɛn', source: 'CMU dictionary', confidence: 'medium' } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pronunciation details' }));
    await user.click(screen.getByRole('button', { name: `Use ɹɛn for ${base.canonical_name}` }));
    await waitFor(() => expect(spies.alternate).toHaveBeenCalledWith(base.id));
  });

  it('offers no switch without an alternate', () => {
    renderDetail(base);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pronunciation details' }));
    expect(screen.queryByRole('button', { name: /instead/ })).toBeNull();
  });

  it('saves a status with its note, and only once something changed', async () => {
    const user = userEvent.setup();
    const spies = renderDetail(base);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pronunciation details' }));
    const save = screen.getByRole('button', { name: 'Save status' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: `Pronunciation status for ${base.canonical_name}` }), 'query_sent');
    await user.type(screen.getByRole('textbox', { name: 'Pronunciation note' }), 'Asked on the call.');
    await user.click(save);
    await waitFor(() => expect(spies.status).toHaveBeenCalledWith(base.id, 'query_sent', 'Asked on the call.'));
  });

  it('keeps the controls closed until Pronunciation details is pressed', () => {
    renderDetail(base);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    const details = screen.getByRole('button', { name: 'Pronunciation details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Your pronunciation' })).toBeNull();
  });

  it('is not reachable on a locked entry', () => {
    renderDetail({ ...base, locked: true });
    expect(screen.queryByRole('button', { name: 'Edit this entry' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Your pronunciation' })).toBeNull();
  });
});
