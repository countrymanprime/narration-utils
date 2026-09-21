// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import type { MockAssetSeed } from '../../api/assetInstallMock';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi } from '../../types';
import { LocalAssets } from './LocalAssets';

afterEach(cleanup);

// The mock polls every 400 ms and a download takes three polls, so a state that arrives by polling is waited for, not faked.
const SLOW = { timeout: 4000 };

function renderAssets(seed?: MockAssetSeed, overrides: Partial<NarrationApi> = {}) {
  const api = createMockApi(overrides, seed ? { assets: seed } : {});
  const notify = vi.fn();
  render(
    <ApiProvider api={api}>
      <LocalAssets notify={notify} />
    </ApiProvider>,
  );
  return { api, notify };
}

const rowOf = async (name: string) => (await screen.findByRole('heading', { level: 3, name })).closest('li') as HTMLElement;

describe('LocalAssets', () => {
  it('lists every asset with what it is, its sizes, links and state, and the folder and total on disk', async () => {
    renderAssets();
    const voice = await rowOf('LJ Speech (U.S. English)');
    expect(within(voice).getByText(/Preview voice/)).toBeTruthy();
    expect(within(voice).getByText('Not installed')).toBeTruthy();
    expect(within(voice).getByText('rhasspy')).toBeTruthy();
    expect(within(voice).getAllByText(/109 MB/).length).toBeGreaterThan(0);
    expect(
      within(voice)
        .getByRole('link', { name: /Public domain training data/ })
        .getAttribute('href'),
    ).toBe('https://keithito.com/LJ-Speech-Dataset/');
    expect(within(voice).getByRole('link', { name: 'Model card' })).toBeTruthy();
    expect(within(voice).getByRole('link', { name: 'Provenance' })).toBeTruthy();
    const whisper = await rowOf('Small');
    expect(within(whisper).getByText('Installed')).toBeTruthy();
    expect(within(whisper).getByText(/Whisper model/)).toBeTruthy();
    const language = await rowOf('English, small (fast)');
    expect(within(language).getByText(/Story Bible language model/)).toBeTruthy();
    // The two installed assets add up: 471 MB of Whisper model and 15 MB of unpacked language model.
    expect(screen.getByText(/Installed assets use 4\d\d MB of disk/)).toBeTruthy();
    expect(screen.getByText(/narration-utils.*\/assets|assets/i, { selector: 'code' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('says so when nothing is installed', async () => {
    renderAssets('missing');
    expect(await screen.findByText('No assets are installed')).toBeTruthy();
  });

  it('downloads an asset that is not installed, with the real bytes and a Cancel, and ends installed with Verify and Remove', async () => {
    renderAssets();
    const voice = await rowOf('LJ Speech (U.S. English)');
    fireEvent.click(within(voice).getByRole('button', { name: 'Download Preview voice LJ Speech (U.S. English)' }));
    expect(await within(voice).findByRole('progressbar', { name: 'Download progress for Preview voice LJ Speech (U.S. English)' })).toBeTruthy();
    await waitFor(() => expect(within(voice).getByRole('progressbar').getAttribute('aria-valuetext')).toMatch(/of 109 MB/), SLOW);
    expect(within(voice).getByRole('button', { name: 'Cancel the download of Preview voice LJ Speech (U.S. English)' })).toBeTruthy();
    await waitFor(() => expect(within(voice).getByText('Installed')).toBeTruthy(), SLOW);
    expect(within(voice).getByRole('button', { name: 'Verify Preview voice LJ Speech (U.S. English)' })).toBeTruthy();
    expect(within(voice).getByRole('button', { name: 'Remove Preview voice LJ Speech (U.S. English)' })).toBeTruthy();
    expect(within(voice).queryByRole('progressbar')).toBeNull();
  });

  it('keeps keyboard focus on the same button as it turns from Download into Cancel, then into the busy check, then into Verify', async () => {
    renderAssets();
    const voice = await rowOf('LJ Speech (U.S. English)');
    const button = within(voice).getByRole('button', { name: 'Download Preview voice LJ Speech (U.S. English)' });
    button.focus();
    fireEvent.click(button);
    await within(voice).findByRole('button', { name: 'Cancel the download of Preview voice LJ Speech (U.S. English)' }, SLOW);
    expect(document.activeElement).toBe(button);
    await within(voice).findByRole('button', { name: 'Verifying Preview voice LJ Speech (U.S. English)' }, SLOW);
    expect(document.activeElement).toBe(button);
    await within(voice).findByRole('button', { name: 'Verify Preview voice LJ Speech (U.S. English)' }, SLOW);
    expect(document.activeElement).toBe(button);
  });

  it('follows a download that was already running when the page opened, and Cancel stops it', async () => {
    const { api } = renderAssets('installing');
    const voice = await rowOf('LJ Speech (U.S. English)');
    const bar = await within(voice).findByRole('progressbar');
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('39'), SLOW);
    expect(within(voice).getByText('Downloading')).toBeTruthy();
    expect(within(voice).getByText(/44 of 109 MB/)).toBeTruthy();
    // Following it started no second install: the list still says one job runs.
    expect((await api.assetsList()).assets.find((asset) => asset.kind === 'tts')?.activeJobId).toBeTruthy();
    fireEvent.click(within(voice).getByRole('button', { name: 'Cancel the download of Preview voice LJ Speech (U.S. English)' }));
    expect(await within(voice).findByText('Voice download cancelled.')).toBeTruthy();
    expect(within(voice).getByText('Not installed')).toBeTruthy();
    expect(within(voice).getByRole('button', { name: 'Download Preview voice LJ Speech (U.S. English)' })).toBeTruthy();
  });

  it('does not follow again a download the row started itself, so a later Download starts a new one', async () => {
    renderAssets();
    const voice = await rowOf('LJ Speech (U.S. English)');
    fireEvent.click(within(voice).getByRole('button', { name: 'Download Preview voice LJ Speech (U.S. English)' }));
    await within(voice).findByRole('progressbar');
    // Another row reloads the list while the voice downloads: the list now reports the voice job as the one running.
    const whisper = await rowOf('Small');
    fireEvent.click(within(whisper).getByRole('button', { name: 'Verify Whisper model Small' }));
    expect(await within(whisper).findByText(/Verified: every file matches/)).toBeTruthy();
    fireEvent.click(await within(voice).findByRole('button', { name: 'Cancel the download of Preview voice LJ Speech (U.S. English)' }));
    expect(await within(voice).findByText('Voice download cancelled.')).toBeTruthy();
    fireEvent.click(within(voice).getByRole('button', { name: 'Download Preview voice LJ Speech (U.S. English)' }));
    // A new job runs: the cancelled sentence is gone and the row is downloading again.
    await waitFor(() => expect(within(voice).getByText('Downloading')).toBeTruthy());
    expect(within(voice).queryByText('Voice download cancelled.')).toBeNull();
  });

  it('keeps the confirm open and busy until the list is reloaded, then closes it', async () => {
    let finish: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const real = createMockApi();
    let removed = false;
    renderAssets(undefined, {
      assetsRemove: async () => {
        removed = true;
      },
      assetsList: async () => {
        const list = await real.assetsList();
        if (removed) await held;
        return list;
      },
    });
    const whisper = await rowOf('Small');
    fireEvent.click(within(whisper).getByRole('button', { name: 'Remove Whisper model Small' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Remove' }).getAttribute('aria-busy')).toBe('true'));
    finish();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('shows the check as a pending button that cannot be pressed or cancelled, in the same place the Cancel was', async () => {
    renderAssets('checking');
    const voice = await rowOf('LJ Speech (U.S. English)');
    const button = await within(voice).findByRole('button', { name: 'Verifying Preview voice LJ Speech (U.S. English)' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(within(voice).getAllByText('Verifying')).toHaveLength(2);
    expect(within(voice).queryByRole('button', { name: /Cancel/ })).toBeNull();
    expect(within(voice).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('99');
  });

  it('marks a damaged asset Needs repair, and Repair downloads it again and checks it', async () => {
    renderAssets('damaged');
    const whisper = await rowOf('Small');
    expect(within(whisper).getByText('Needs repair')).toBeTruthy();
    expect(within(whisper).getByText(/no longer match the approved ones/)).toBeTruthy();
    expect(within(whisper).getByRole('button', { name: 'Remove Whisper model Small' })).toBeTruthy();
    expect(within(whisper).queryByRole('button', { name: 'Verify Whisper model Small' })).toBeNull();
    fireEvent.click(within(whisper).getByRole('button', { name: 'Repair Whisper model Small' }));
    await waitFor(() => expect(within(whisper).getByText('Installed')).toBeTruthy(), SLOW);
    expect(within(whisper).getByRole('button', { name: 'Verify Whisper model Small' })).toBeTruthy();
  });

  it('writes a failed download in the row, and offers to try again', async () => {
    renderAssets('download-fails');
    const voice = await rowOf('LJ Speech (U.S. English)');
    fireEvent.click(within(voice).getByRole('button', { name: 'Download Preview voice LJ Speech (U.S. English)' }));
    const alert = await within(voice).findByRole('alert', {}, SLOW);
    expect(alert.textContent).toMatch(/did not match the approved one/);
    expect(within(voice).getByText('Not installed')).toBeTruthy();
    expect(within(voice).getByRole('button', { name: 'Download Preview voice LJ Speech (U.S. English)' })).toBeTruthy();
  });

  it('verifies an installed asset with a button that is busy while the files are read, then says what it found', async () => {
    let finish: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (finish = resolve));
    renderAssets(undefined, {
      assetsVerify: async (kind, id) => {
        await held;
        return { kind, id, installState: 'installed' };
      },
    });
    const whisper = await rowOf('Small');
    const verify = within(whisper).getByRole('button', { name: 'Verify Whisper model Small' });
    fireEvent.click(verify);
    await waitFor(() => expect(verify.getAttribute('aria-busy')).toBe('true'));
    // A second press while it runs does nothing, and the button keeps focus's place: it is not disabled.
    expect(verify.hasAttribute('disabled')).toBe(false);
    finish();
    expect(await within(whisper).findByText('Verified: every file matches the approved checksum.')).toBeTruthy();
    expect(verify.getAttribute('aria-busy')).toBeNull();
  });

  it('writes a failed verification in the row', async () => {
    renderAssets(undefined, {
      assetsVerify: async () => {
        throw new Error('the cache folder is not readable');
      },
    });
    const whisper = await rowOf('Small');
    fireEvent.click(within(whisper).getByRole('button', { name: 'Verify Whisper model Small' }));
    expect((await within(whisper).findByRole('alert')).textContent).toMatch(/Could not verify Whisper model Small: .*not readable/);
  });

  it('asks before removing, in a danger confirm that says what it frees, and removes nothing on Cancel', async () => {
    const remove = vi.fn(async () => undefined);
    renderAssets(undefined, { assetsRemove: remove });
    const whisper = await rowOf('Small');
    fireEvent.click(within(whisper).getByRole('button', { name: 'Remove Whisper model Small' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Whisper model Small?' });
    expect(dialog.textContent).toMatch(/frees 4\d\d MB/);
    expect(dialog.textContent).toMatch(/ask to download it again/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes the asset after the confirm, tells the narrator, and the row is Not installed again', async () => {
    const { notify } = renderAssets();
    const whisper = await rowOf('Small');
    fireEvent.click(within(whisper).getByRole('button', { name: 'Remove Whisper model Small' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Whisper model Small?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(whisper).getByText('Not installed')).toBeTruthy());
    expect(within(whisper).getByRole('button', { name: 'Download Whisper model Small' })).toBeTruthy();
    expect(notify).toHaveBeenCalledWith('Whisper model Small removed from this computer.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('writes a refused removal in the row and closes the confirm', async () => {
    renderAssets(undefined, {
      assetsRemove: async () => {
        throw new Error('it is downloading');
      },
    });
    const whisper = await rowOf('Small');
    fireEvent.click(within(whisper).getByRole('button', { name: 'Remove Whisper model Small' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect((await within(whisper).findByRole('alert')).textContent).toMatch(/Could not remove Whisper model Small: .*it is downloading/);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(whisper).getByText('Installed')).toBeTruthy();
  });

  it('says the list could not be read, and reads it again on request', async () => {
    let calls = 0;
    const real = createMockApi();
    renderAssets(undefined, {
      assetsList: async () => {
        if (++calls === 1) throw new Error('the host is busy');
        return real.assetsList();
      },
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be listed: .*host is busy/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowOf('Small')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
