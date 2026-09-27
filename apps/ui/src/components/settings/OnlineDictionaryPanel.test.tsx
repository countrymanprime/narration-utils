// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { OnlineDictionaryPanel } from './OnlineDictionaryPanel';

const KEY = '0b5c1a3e-7d2f-4e6a-9c8b-2f1e0d9c8b7a';

afterEach(cleanup);

function setup() {
  const api = createMockApi();
  const notify = vi.fn();
  const signUp = vi.spyOn(api, 'pronunciationOnlineSignUpOpen');
  const setKey = vi.spyOn(api, 'pronunciationOnlineKeySet');
  render(
    <ApiProvider api={api}>
      <OnlineDictionaryPanel notify={notify} />
    </ApiProvider>,
  );
  return { api, notify, signUp, setKey };
}

describe('OnlineDictionaryPanel', () => {
  it('opens the sign-up page, and says what a lookup sends', async () => {
    const { signUp } = setup();
    expect(await screen.findByText('No key')).toBeTruthy();
    expect(screen.getByText(/Only the one word you look up is sent/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Get a free key' }));
    expect(signUp).toHaveBeenCalledWith();
  });

  it('saves a pasted key masked, clears the field, and never shows the key again', async () => {
    const { setKey, notify } = setup();
    const field = await screen.findByLabelText('Your key');
    expect(field.getAttribute('type')).toBe('password');
    await userEvent.type(field, KEY);
    await userEvent.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(screen.getByText('Key saved')).toBeTruthy());
    expect(setKey).toHaveBeenCalledWith(KEY);
    expect(notify).toHaveBeenCalledWith('Merriam-Webster key saved.');
    expect((screen.getByLabelText('Replace your key') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain(KEY);
  });

  it('shows why a pasted value was refused, without echoing it', async () => {
    setup();
    await userEvent.type(await screen.findByLabelText('Your key'), 'not a key');
    await userEvent.click(screen.getByRole('button', { name: 'Save key' }));
    expect(await screen.findByText(/does not look like a Merriam-Webster key/)).toBeTruthy();
  });

  it('removes a saved key', async () => {
    const { api } = setup();
    await api.pronunciationOnlineKeySet(KEY);
    cleanup();
    render(
      <ApiProvider api={api}>
        <OnlineDictionaryPanel notify={vi.fn()} />
      </ApiProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Remove key' }));
    await waitFor(() => expect(screen.getByText('No key')).toBeTruthy());
  });
});
