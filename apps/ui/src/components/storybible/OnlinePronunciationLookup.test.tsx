// @vitest-environment jsdom
// Look up online (prep-depth P9, D72): the narrator's own press sends the name alone; a repeat is answered from this computer's
// copy; an answer only fills the narrator's field; without a key nothing is sent and the narrator is told where to add one.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { OnlinePronunciationLookup } from './OnlinePronunciationLookup';

afterEach(cleanup);

async function setup(name: string, { key = true } = {}) {
  const api = createMockApi();
  if (key) await api.pronunciationOnlineKeySet('0b5c1a3e-7d2f-4e6a-9c8b-2f1e0d9c8b7a');
  const lookup = vi.spyOn(api, 'pronunciationOnlineLookup');
  const onUse = vi.fn();
  render(
    <ApiProvider api={api}>
      <OnlinePronunciationLookup name={name} disabled={false} onUse={onUse} />
    </ApiProvider>,
  );
  return { lookup, onUse };
}

describe('OnlinePronunciationLookup', () => {
  it('sends the name alone, only when pressed, and offers each answer for the narrator’s own field', async () => {
    const { lookup, onUse } = await setup('Hatter');
    expect(lookup).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Look up Hatter online in Merriam-Webster' }));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('Hatter');
    expect(await screen.findByText('\\ˈha-tər\\')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use ˈha-tər as your pronunciation of Hatter' }));
    expect(onUse).toHaveBeenCalledWith('ˈha-tər');
  });

  it('says when an answer came from this computer’s copy', async () => {
    await setup('Alice');
    const button = screen.getByRole('button', { name: 'Look up Alice online in Merriam-Webster' });
    await userEvent.click(button);
    expect(await screen.findByText('Merriam-Webster respelling:')).toBeTruthy();
    await userEvent.click(button);
    expect(await screen.findByText(/from this computer’s copy/)).toBeTruthy();
  });

  it('shows the dictionary’s suggestions for a word it does not have', async () => {
    await setup('quorlen');
    await userEvent.click(screen.getByRole('button', { name: 'Look up quorlen online in Merriam-Webster' }));
    expect(await screen.findByText('Merriam-Webster does not have “quorlen”. It suggests: quorum, sorrel.')).toBeTruthy();
  });

  it('tells the narrator to add their own key first', async () => {
    await setup('Alice', { key: false });
    await userEvent.click(screen.getByRole('button', { name: 'Look up Alice online in Merriam-Webster' }));
    expect(await screen.findByText('Add your own free Merriam-Webster key in Settings > Story Bible first.')).toBeTruthy();
  });
});
