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

describe('UpdatesPanel, downloading', () => {
  it('asks before it downloads anything, and does not download when the narrator says no', async () => {
    const download = vi.fn();
    renderPanel('available', { updateDownload: download });
    fireEvent.click(await screen.findByRole('button', { name: 'Download update' }));
    expect(await screen.findByText(/Nothing is installed yet/)).toBeTruthy();
    expect(screen.getByText(/downloads Narration Utils 0\.2\.7 \(400 MB\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('downloads after the narrator confirms and then offers to install it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPanel('available');
      fireEvent.click(await screen.findByRole('button', { name: 'Download update' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
      expect(await screen.findByRole('dialog', { name: 'Download Narration Utils 0.2.7' })).toBeTruthy();
      await act(async () => void (await vi.advanceTimersByTimeAsync(4000)));
      fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
      expect((await screen.findAllByText('Version 0.2.7 is downloaded and checked.')).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Download update' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Install and restart' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers no download on a platform that cannot replace itself', async () => {
    const found = await createMockApi({}, { update: 'available' }).updateStatus();
    const available = found.available;
    if (!available) throw new Error('the mock has an update');
    renderPanel('available', { updateStatus: async () => ({ ...found, available: { ...available, replaces: false } }) });
    await screen.findByText(/does not update itself/);
    expect(screen.queryByRole('button', { name: 'Download update' })).toBeNull();
  });
});

describe('UpdatesPanel, installing', () => {
  it('shows a download that finished earlier as ready to install, and asks before it restarts the app', async () => {
    const install = vi.fn(async (jobId: string) => createMockApi({}, { update: 'ready' }).updateInstall(jobId));
    renderPanel('ready', { updateInstall: install });
    fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
    expect(await screen.findByText(/closes and starts again on version 0\.2\.7/)).toBeTruthy();
    expect(screen.getByText(/If the new version does not start, the previous one comes back by itself/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(install).not.toHaveBeenCalled();
  });

  it('installs when the narrator confirms, and shows a blocking dialog that says it cannot be cancelled', async () => {
    const install = vi.fn(async (jobId: string) => createMockApi({}, { update: 'ready' }).updateInstall(jobId));
    renderPanel('ready', { updateInstall: install });
    fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
    // The panel behind the confirm is hidden from assistive technology, so the only reachable button of this name is the dialog's.
    fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
    expect(await screen.findByRole('dialog', { name: 'Installing Narration Utils 0.2.7' })).toBeTruthy();
    expect(screen.getByText(/This step cannot be cancelled/)).toBeTruthy();
    expect(install).toHaveBeenCalledWith('mock-update');
  });

  it('shows why an install was refused and leaves the update ready to try again', async () => {
    renderPanel('install-refused');
    fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Narration Utils is busy');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Install and restart' })).toBeTruthy();
  });

  it('where the app may not replace itself, says why and shows the downloaded file instead of installing', async () => {
    const show = vi.fn(async () => undefined);
    const found = await createMockApi({}, { update: 'install-blocked' }).updateStatus();
    renderPanel('ready', {
      updateShowDownload: show,
      updateStatus: async () => ({
        ...found,
        canInstall: false,
        installBlockedReason: 'Narration Utils is installed where it is not allowed to replace itself.',
        downloaded: { jobId: 'mock-update', version: '0.2.7' },
      }),
    });
    expect(await screen.findByText(/not allowed to replace itself/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install and restart' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the downloaded file' }));
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('offers to download where the app may not replace itself, so the narrator can replace it by hand', async () => {
    renderPanel('install-blocked');
    expect(await screen.findByRole('button', { name: 'Download update' })).toBeTruthy();
  });

  it('shows an error when the downloaded file cannot be shown', async () => {
    const found = await createMockApi({}, { update: 'ready' }).updateStatus();
    renderPanel('ready', {
      updateStatus: async () => ({ ...found, canInstall: false, installBlockedReason: 'x', downloaded: { jobId: 'mock-update', version: '0.2.7' } }),
      updateShowDownload: async () => {
        throw new Error('explorer is not available');
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Show the downloaded file' }));
    expect((await screen.findByRole('alert')).textContent).toContain('explorer is not available');
  });
});
