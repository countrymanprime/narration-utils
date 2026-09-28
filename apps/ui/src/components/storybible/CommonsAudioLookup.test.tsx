// @vitest-environment jsdom
// Listen on Commons (prep-depth P10, D72, Q12): the narrator's own press opens the Commons recording Wiktextract's own
// offline data names for the word; a word the fixture index has no audio for shows a clear reason inline.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { CommonsAudioLookup } from './CommonsAudioLookup';

afterEach(cleanup);

function setup(name: string) {
  const api = createMockApi();
  const open = vi.spyOn(api, 'pronunciationCommonsAudioOpen');
  render(
    <ApiProvider api={api}>
      <CommonsAudioLookup name={name} disabled={false} />
    </ApiProvider>,
  );
  return { open };
}

describe('CommonsAudioLookup', () => {
  it('opens the word alone, only when pressed', async () => {
    const { open } = setup('Happy');
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Listen to Happy on Wikimedia Commons' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('Happy');
  });

  it('shows a clear reason inline for a word with no recorded audio', async () => {
    setup('gloomy');
    await userEvent.click(screen.getByRole('button', { name: 'Listen to gloomy on Wikimedia Commons' }));
    expect(await screen.findByText('No Wikimedia Commons audio file is recorded for "gloomy".')).toBeTruthy();
  });

  it('is disabled when the parent says so', () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <CommonsAudioLookup name="Happy" disabled />
      </ApiProvider>,
    );
    expect((screen.getByRole('button', { name: 'Listen to Happy on Wikimedia Commons' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
