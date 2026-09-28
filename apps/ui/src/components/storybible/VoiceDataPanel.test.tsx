// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { VoiceDataPanel } from './VoiceDataPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Voice data panel (character-continuity-review P6: Narration reference, "Remove voice data")', () => {
  it('lets the narrator approve a reference for plain narration', async () => {
    const api = createMockApi();
    const user = userEvent.setup();
    render(
      <ApiProvider api={api}>
        <VoiceDataPanel open onClose={vi.fn()} notify={vi.fn()} />
      </ApiProvider>,
    );
    const regionSelect = await screen.findByRole('combobox', { name: 'Approve a region for Narration' });
    await user.selectOptions(regionSelect, 'March Hare ref A');
    await user.click(screen.getByRole('button', { name: 'Approve as reference' }));
    await waitFor(async () => expect((await api.characterReferences()).some((row) => row.characterId === 'narration')).toBe(true));
  });

  it('Remove voice data revokes every reference in the project, after confirming', async () => {
    const api = createMockApi();
    const user = userEvent.setup();
    expect((await api.characterReferences()).length).toBeGreaterThan(0);
    render(
      <ApiProvider api={api}>
        <VoiceDataPanel open onClose={vi.fn()} notify={vi.fn()} />
      </ApiProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove voice data…' }));
    await user.click(screen.getByRole('button', { name: 'Remove voice data' }));
    await waitFor(async () => expect(await api.characterReferences()).toHaveLength(0));
  });
});
