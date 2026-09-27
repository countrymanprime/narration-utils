// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { ExportJob, NarrationApi, PackageJob } from '../../types';
import { MasterQcPanel } from './MasterQcPanel';

afterEach(cleanup);

function renderPanel(overrides: Partial<NarrationApi> = {}) {
  const api = createMockApi(overrides);
  render(
    <ApiProvider api={api}>
      <MasterQcPanel />
    </ApiProvider>,
  );
  return api;
}

const EXPORTED: ExportJob = {
  id: 'export-1',
  kind: 'render_export',
  phase: 'success',
  message: 'Prepared 1 file.',
  percent: 100,
  master: false,
  format: 'mp3',
  logs: [],
  elapsed: 3,
  files: [{ kind: 'chapter', title: 'Chapter One', path: 'C:/render/ch1.wav', status: 'done', encodedPath: 'C:/encoded/01.mp3' }],
};

describe('MasterQcPanel', () => {
  it('picks files, masters and encodes them, and shows the per-file result', async () => {
    const api = renderPanel({
      exportPickFiles: async () => ({ paths: ['C:/render/ch1.wav'] }),
      exportState: vi.fn<NarrationApi['exportState']>().mockResolvedValue({ ...EXPORTED, phase: 'idle', files: [] }),
      exportStart: vi.fn<NarrationApi['exportStart']>().mockResolvedValue(EXPORTED),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Choose files…' }));
    await screen.findByText('ch1.wav');
    await userEvent.click(screen.getByRole('button', { name: /Master & encode/ }));
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy());
    expect(api.exportStart).toHaveBeenCalledWith({ items: [{ kind: 'chapter', title: 'ch1', path: 'C:/render/ch1.wav' }], master: false, format: 'mp3' });
  });

  it('shows an export refusal without starting a job', async () => {
    renderPanel({
      exportPickFiles: async () => ({ paths: ['C:/render/ch1.wav'] }),
      exportStart: async () => {
        throw new Error('an export is already running');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Choose files…' }));
    await screen.findByText('ch1.wav');
    await userEvent.click(screen.getByRole('button', { name: /Master & encode/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('an export is already running');
  });

  it('builds a package once files are exported, and shows its checklist', async () => {
    const built: PackageJob = {
      id: 'package-1',
      kind: 'render_package',
      phase: 'success',
      message: 'Built the acx package with 1 file.',
      profile: 'acx',
      outputDir: 'C:\\Users\\Narrator\\Desktop\\Wonderland ACX',
      files: [{ kind: 'chapter', name: '01 - Chapter One.mp3', destPath: 'C:\\...\\01 - Chapter One.mp3', tagged: false }],
      checklist: [{ ruleId: 'acx.retail_sample', label: 'Retail sample', status: 'missing', detail: 'Needs a retail sample file.' }],
      elapsed: 1,
    };
    const api = renderPanel({
      exportPickFiles: async () => ({ paths: [] }),
      exportState: async () => EXPORTED,
      packageState: async () => ({ ...built, phase: 'idle', files: [], checklist: [] }),
      packageStart: vi.fn<NarrationApi['packageStart']>().mockResolvedValue(built),
    });
    await screen.findByText('Delivery package');
    await userEvent.click(await screen.findByRole('button', { name: 'Build package' }));
    await screen.findByText('Built the acx package with 1 file.');
    expect(screen.getByText('Missing')).toBeTruthy();
    expect(api.packageStart).toHaveBeenCalledWith({
      profileId: 'acx',
      profileVersion: expect.any(String),
      items: [{ kind: 'chapter', title: 'Chapter One', path: 'C:/encoded/01.mp3' }],
    });
  });
});
