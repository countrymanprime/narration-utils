// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../api/ApiContext';
import { createMockApi } from '../../../api/mockApi';
import type { AssetCatalog, AssetItem } from '../../../types';
import { BoothPanel } from './BoothPanel';
import { SettingsFormsProvider } from './settingsForms';

afterEach(cleanup);

const model = (kind: string, installState: AssetItem['installState']): AssetItem => ({
  kind,
  kindLabel: 'Live model',
  id: 'tiny',
  displayName: `${kind} tiny`,
  version: '1',
  publisher: 'p',
  license: 'MIT',
  licenseUrl: 'https://example.test/l',
  modelCardUrl: 'https://example.test/m',
  provenanceUrl: 'https://example.test/p',
  attribution: 'a',
  downloadSize: 78_000_000,
  diskSize: 80_000_000,
  installState,
  path: 'C:/models',
  installedAt: '',
  verifiedAt: '',
  activeJobId: '',
});

function mount(assets: AssetItem[]) {
  const catalog: AssetCatalog = { cacheRoot: 'C:/cache', totalInstalledBytes: 0, assets };
  const api = createMockApi({ assetsList: async () => structuredClone(catalog) } as never);
  render(
    <ApiProvider api={api}>
      <SettingsFormsProvider notify={vi.fn()} onDirtyChange={vi.fn()} registerActions={vi.fn()}>
        <BoothPanel notify={vi.fn()} />
      </SettingsFormsProvider>
    </ApiProvider>,
  );
}

const engineControl = async () => {
  const field = await screen.findByLabelText('Live engine');
  return field as HTMLSelectElement;
};

describe('BoothPanel: choosing an engine whose model is missing', () => {
  it('asks for the download as soon as the engine is chosen, and puts the engine back on Cancel', async () => {
    mount([model('whisper', 'installed'), model('moonshine', 'not_installed')]);
    const select = await engineControl();
    expect(select.value).toBe('whisper');

    fireEvent.change(select, { target: { value: 'moonshine' } });

    expect(await screen.findByText('Download local Moonshine model?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Download local Moonshine model?')).toBeNull());
    expect((await engineControl()).value).toBe('whisper');
  });

  it('asks nothing when the chosen engine already has its model', async () => {
    mount([model('whisper', 'installed'), model('moonshine', 'installed')]);
    const select = await engineControl();
    fireEvent.change(select, { target: { value: 'moonshine' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Download local Moonshine model?')).toBeNull();
    expect(select.value).toBe('moonshine');
  });
});
