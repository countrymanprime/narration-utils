// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import type { MockAssetSeed } from '../../api/assetInstallMock';
import { createMockApi } from '../../api/mockApi';
import { Guide } from './Guide';

afterEach(cleanup);

// The Story Bible reads a manuscript with a language model, and the model is an asset: nothing downloads until the narrator chooses, and
// declining is a choice for one build, not a silent fallback (the first-use rules).

function renderGuide(seed?: MockAssetSeed) {
  const api = createMockApi({}, seed ? { assets: seed } : {});
  const guideBuild = vi.spyOn(api, 'guideBuild');
  const assetsInstall = vi.spyOn(api, 'assetsInstall');
  const notify = vi.fn();
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <Guide notify={notify} goToManuscript={vi.fn()} />
      </ApiProvider>
    </MemoryRouter>,
  );
  return { api, guideBuild, assetsInstall, notify };
}

const pressBuild = async () => fireEvent.click(await screen.findByRole('button', { name: 'Build / refresh Story Bible' }));

describe('the Story Bible build and its language model', () => {
  it('builds at once when the language model is installed', async () => {
    const { guideBuild, assetsInstall } = renderGuide();
    await pressBuild();
    await waitFor(() => expect(guideBuild).toHaveBeenCalledWith({ rulesOnly: false }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(assetsInstall).not.toHaveBeenCalled();
  });

  it('asks first when it is not: what it is, its sizes and where it goes, with three ways forward and nothing downloaded', async () => {
    const { assetsInstall } = renderGuide('missing');
    await pressBuild();
    const dialog = await screen.findByRole('alertdialog', { name: 'Download local language model?' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('English, small (fast)')).toBeTruthy();
    expect(screen.getByText('12 MB · Explosion')).toBeTruthy();
    expect(screen.getByText('15 MB')).toBeTruthy();
    expect(screen.getByText(/spacy\/en_core_web_sm/)).toBeTruthy();
    for (const name of ['Download model', 'Build with rules-only', 'Cancel']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(assetsInstall).not.toHaveBeenCalled();
  });

  it('Cancel leaves the Story Bible as it was: no build and no download', async () => {
    const { guideBuild, assetsInstall } = renderGuide('missing');
    await pressBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(guideBuild).toHaveBeenCalledTimes(1);
    expect(assetsInstall).not.toHaveBeenCalled();
  });

  it('Build with rules-only builds once without the model and does not download it', async () => {
    const { guideBuild, assetsInstall } = renderGuide('missing');
    await pressBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build with rules-only' }));
    await waitFor(() => expect(guideBuild).toHaveBeenLastCalledWith({ rulesOnly: true }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(assetsInstall).not.toHaveBeenCalled();
  });

  it('Download model shows the real progress, then builds with the model the narrator chose', async () => {
    const { guideBuild, assetsInstall } = renderGuide('missing');
    await pressBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Download model' }));
    expect(await screen.findByRole('dialog', { name: 'Downloading language model' })).toBeTruthy();
    expect(assetsInstall).toHaveBeenCalledWith('spacy', 'en_core_web_sm');
    // The mock steps through the bytes and the check; when it succeeds the build starts again, and this time the model is there.
    await waitFor(() => expect(guideBuild).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(guideBuild).toHaveBeenLastCalledWith({ rulesOnly: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says why a download failed and leaves the narrator able to choose again', async () => {
    renderGuide('download-fails');
    await pressBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Download model' }));
    expect((await screen.findByRole('alert', {}, { timeout: 5000 })).textContent).toMatch(/did not match the approved/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await pressBuild();
    expect(await screen.findByRole('alertdialog', { name: 'Download local language model?' })).toBeTruthy();
  });
});
