// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi, type MockUpdateSeed } from '../../api/mockApi';
import type { NarrationApi, UpdateStatus } from '../../types';
import { UpdatesPanel } from './UpdatesPanel';

afterEach(cleanup);

function renderPanel(seed: MockUpdateSeed | undefined, overrides: Partial<NarrationApi> = {}) {
  const api = createMockApi(overrides, seed ? { update: seed } : {});
  render(
    <ApiProvider api={api}>
      <UpdatesPanel />
    </ApiProvider>,
  );
  return api;
}

describe('UpdatesPanel', () => {
  it('says nothing has been checked yet and offers Check now', async () => {
    renderPanel(undefined);
    expect(await screen.findByText('Not checked yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeTruthy();
  });

  it('checks on request and then says the app is up to date, with the day it looked', async () => {
    renderPanel(undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/You have the latest version/)).toBeTruthy();
    expect(screen.getByText(/Last checked 2026-09-21/)).toBeTruthy();
  });

  it('shows a newer release with its version, size and channel, and opens its release notes', async () => {
    const openNotes = vi.fn(async () => undefined);
    renderPanel('available', { updateOpenNotes: openNotes });
    expect(await screen.findByText('Version 0.2.7 is available')).toBeTruthy();
    expect(screen.getByText(/release candidate/i)).toBeTruthy();
    expect(screen.getByText(/400 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Release notes/ }));
    await waitFor(() => expect(openNotes).toHaveBeenCalledTimes(1));
  });

  it('says why a check failed and keeps the button to try again', async () => {
    renderPanel('failed');
    // The failure of an earlier check is remembered state, read out politely, not an alert raised each time the page opens.
    expect((await screen.findByText('Could not reach GitHub to check for updates.')).closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeTruthy();
  });

  it('explains that a development build has nothing to update to and does not offer a check', async () => {
    renderPanel('development');
    expect(await screen.findByText(/development build/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('disables Check now while a check runs', async () => {
    let finish: (status: UpdateStatus) => void = () => undefined;
    const pending = new Promise<UpdateStatus>((resolve) => (finish = resolve));
    const api = renderPanel(undefined, { updateCheck: () => pending });
    const button = await screen.findByRole('button', { name: 'Check now' });
    fireEvent.click(button);
    expect((await screen.findByRole('button', { name: 'Checking…' })).hasAttribute('disabled')).toBe(true);
    await act(async () => finish(await api.updateStatus()));
    expect(await screen.findByRole('button', { name: 'Check now' })).toBeTruthy();
  });

  it('updates when a background check reports a release', async () => {
    let publish: (status: UpdateStatus) => void = () => undefined;
    renderPanel(undefined, {
      subscribeUpdate: (onStatus) => {
        publish = onStatus;
        return () => undefined;
      },
    });
    expect(await screen.findByText('Not checked yet.')).toBeTruthy();
    const found = await createMockApi({}, { update: 'available' }).updateStatus();
    act(() => publish(found));
    expect(await screen.findByText('Version 0.2.7 is available')).toBeTruthy();
  });

  it('a platform that cannot replace itself is pointed at the release page instead', async () => {
    const found = await createMockApi({}, { update: 'available' }).updateStatus();
    const available = found.available;
    if (!available) throw new Error('the mock has an update');
    renderPanel('available', { updateStatus: async () => ({ ...found, available: { ...available, replaces: false } }) });
    expect(await screen.findByText(/open the release notes to download it/i)).toBeTruthy();
  });

  it('shows an error from the host instead of nothing when the status cannot be read', async () => {
    renderPanel(undefined, {
      updateStatus: async () => {
        throw new Error('the host did not answer');
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('the host did not answer');
  });
});

describe('UpdatesPanel, more', () => {
  it('shows an error from a check that failed to run and lets the narrator try again', async () => {
    renderPanel(undefined, {
      updateCheck: async () => {
        throw new Error('the host stopped answering');
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect((await screen.findByRole('alert')).textContent).toContain('the host stopped answering');
    expect((screen.getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an error when the release notes cannot be opened', async () => {
    renderPanel('available', {
      updateOpenNotes: async () => {
        throw new Error('no browser');
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Release notes/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('no browser');
  });

  it('says so, and offers no check, on a computer that has no release', async () => {
    const found = await createMockApi().updateStatus();
    renderPanel(undefined, { updateStatus: async () => ({ ...found, platform: '' }) });
    expect(await screen.findByText(/no release for this kind of computer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('waits for unsaved settings to be saved, because a check uses the saved ones', async () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <UpdatesPanel formDirty />
      </ApiProvider>,
    );
    const button = (await screen.findByRole('button', { name: 'Check now' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Save your changes first/)).toBeTruthy();
  });

  it('puts keyboard focus back on the button when a check ends and announces the result in a status region', async () => {
    renderPanel(undefined);
    const button = await screen.findByRole('button', { name: 'Check now' });
    button.focus();
    fireEvent.click(button);
    await screen.findByText(/You have the latest version/);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Check now' })));
    expect(screen.getByText(/You have the latest version/).closest('[role="status"]')).toBeTruthy();
  });

  it('stops listening for updates when it goes away', async () => {
    const unsubscribe = vi.fn();
    renderPanel(undefined, { subscribeUpdate: () => unsubscribe });
    await screen.findByText('Not checked yet.');
    cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('an event that arrives before the first answer is not overwritten by it', async () => {
    let answer: (status: UpdateStatus) => void = () => undefined;
    const late = new Promise<UpdateStatus>((resolve) => (answer = resolve));
    let publish: (status: UpdateStatus) => void = () => undefined;
    const seed = createMockApi();
    renderPanel(undefined, {
      updateStatus: () => late,
      subscribeUpdate: (onStatus) => {
        publish = onStatus;
        return () => undefined;
      },
    });
    const found = await createMockApi({}, { update: 'available' }).updateStatus();
    act(() => publish(found));
    await act(async () => answer(await seed.updateStatus()));
    expect(await screen.findByText('Version 0.2.7 is available')).toBeTruthy();
  });

  it('does not say the app is up to date next to a failed check', async () => {
    renderPanel('failed', {
      updateStatus: async () => ({
        ...(await createMockApi({}, { update: 'current' }).updateStatus()),
        failure: 'GitHub answered the update check with status 502.',
      }),
    });
    expect(await screen.findByText(/status 502/)).toBeTruthy();
    expect(screen.queryByText(/You have the latest version/)).toBeNull();
  });
});
