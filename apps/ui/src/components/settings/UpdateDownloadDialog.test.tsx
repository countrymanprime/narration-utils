// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi, type MockUpdateSeed } from '../../api/mockApi';
import type { NarrationApi, UpdateAvailable, UpdateJob } from '../../types';
import { UpdateDownloadDialog } from './UpdateDownloadDialog';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const AVAILABLE: UpdateAvailable = {
  version: '0.2.7',
  tag: 'v0.2.7-rc',
  candidate: true,
  notesUrl: 'https://github.com/countrymanprime/narration-utils/releases/tag/v0.2.7-rc',
  size: 419_895_808,
  publishedAt: '2026-09-20T10:00:00Z',
  replaces: true,
};

function renderDialog(seed: MockUpdateSeed, overrides: Partial<NarrationApi> = {}, strict = false) {
  const api = createMockApi(overrides, { update: seed });
  const close = vi.fn();
  const tree = (
    <ApiProvider api={api}>
      <UpdateDownloadDialog available={AVAILABLE} close={close} />
    </ApiProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { api, close };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('UpdateDownloadDialog', () => {
  it('starts the download once, shows the real bytes so far and a Cancel, and no Close yet', async () => {
    const { api } = renderDialog('downloading');
    const started = vi.spyOn(api, 'updateDownload');
    await advance(1000);
    expect(screen.getByRole('dialog', { name: 'Download Narration Utils 0.2.7' })).toBeTruthy();
    expect(screen.getByText(/Downloading Narration Utils 0\.2\.7… 160 of 400 MB/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(started).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
  });

  it('asks the host to start the download only once, even when React runs the effect twice', async () => {
    const download = vi.fn(async () => (await createMockApi({}, { update: 'downloading' }).updateDownload()) as UpdateJob);
    renderDialog('downloading', { updateDownload: download }, true);
    await advance(1000);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('goes through the checks to ready, says the checks cannot be cancelled, and then offers Close', async () => {
    const { close } = renderDialog('available');
    await advance(1300); // downloading, part way
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await advance(400); // the download has ended and the checks begin
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByText(/This step cannot be cancelled/)).toBeTruthy();
    await advance(2000);
    expect(screen.getAllByText('Version 0.2.7 is downloaded and checked.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledWith('ready');
  });

  it('cancels the download, then shows it as cancelled and offers Close', async () => {
    const { api, close } = renderDialog('available');
    const spy = vi.spyOn(api, 'updateJobCancel');
    await advance(700);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await advance(1000);
    expect(spy).toHaveBeenCalledWith('mock-update');
    expect(screen.getAllByText('The update download was cancelled.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledWith('cancelled');
  });

  it('shows why the update was not used when the download fails', async () => {
    const { close } = renderDialog('download-fails');
    await advance(3000);
    expect(screen.getByRole('alert').textContent).toContain('disagree, so the update was not used');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledWith('error');
  });

  it('shows the error when the host refuses to start', async () => {
    const { close } = renderDialog('available', {
      updateDownload: async () => {
        throw new Error('an update download is already running');
      },
    });
    await advance(100);
    expect(screen.getByRole('alert').textContent).toContain('already running');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledWith('error');
  });

  it('shows the error when polling the host fails', async () => {
    renderDialog('available', {
      updateJobState: async () => {
        throw new Error('the host stopped answering');
      },
    });
    await advance(1000);
    expect(screen.getByRole('alert').textContent).toContain('the host stopped answering');
  });

  it('stops polling when the dialog goes away', async () => {
    const state = vi.fn(async (id: string) => createMockApi({}, { update: 'downloading' }).updateJobState(id));
    renderDialog('available', { updateJobState: state });
    await advance(500);
    const calls = state.mock.calls.length;
    cleanup();
    await advance(3000);
    expect(state.mock.calls.length).toBe(calls);
  });
});
