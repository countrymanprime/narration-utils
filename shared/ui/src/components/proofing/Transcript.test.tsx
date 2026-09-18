// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transcript } from './Transcript';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TRANSCRIPT } from '../../api/mockFixtures';
import { WIRE_DISCREPANCIES } from '../../api/mockFixtures';

afterEach(cleanup);

describe('Transcript vocabulary suggestions', () => {
  it('does not show candidates until requested, then accepts manifest candidates once', async () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <Transcript state={WIRE_TRANSCRIPT} notify={vi.fn()} goHome={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    await screen.findByText('Vocabulary hints');
    expect(screen.queryByRole('button', { name: /\+ Alice/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Suggest from manuscript/ }));
    const alice = await screen.findByRole('button', { name: /\+ Alice/ });
    fireEvent.click(alice);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Suggest from manuscript/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /\+ Alice/ })).toBeNull());
  });

  it('shows duplicate marker status and exports only pending markers on explicit request', async () => {
    const exportMarkers = vi.fn().mockResolvedValue(undefined);
    const api = createMockApi({ transcriptExportMarkers: exportMarkers });
    render(
      <ApiProvider api={api}>
        <Transcript
          state={{
            ...WIRE_TRANSCRIPT,
            phase: 'success',
            rows: WIRE_DISCREPANCIES,
            markerExport: { phase: 'idle', message: '', added: 0, skipped: 0 },
          }}
          notify={vi.fn()}
          goHome={vi.fn()}
          goToManuscript={vi.fn()}
        />
      </ApiProvider>,
    );

    expect(screen.getByText('Ready to export')).toBeTruthy();
    expect(screen.getByText('Already marked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 marker' }));
    await waitFor(() => expect(exportMarkers).toHaveBeenCalledOnce());
  });

  it('gates on the approved Whisper model, installs it, then starts the comparison', async () => {
    const transcriptStart = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'asset_required',
        model: {
          id: 'small',
          provider: 'faster-whisper',
          displayName: 'Small',
          version: '1',
          publisher: 'Systran',
          license: 'MIT',
          licenseUrl: 'https://example.invalid',
          modelCardUrl: '',
          provenanceUrl: '',
          attribution: '',
        },
        installState: 'not_installed',
        downloadSize: 483546902,
      })
      .mockResolvedValueOnce({ status: 'started' });
    const whisperInstall = vi.fn().mockResolvedValue({ id: null, modelId: 'small', phase: 'success', message: 'Whisper model installed and verified.' });
    const api = createMockApi({ transcriptStart, whisperInstall });
    render(
      <ApiProvider api={api}>
        <Transcript state={WIRE_TRANSCRIPT} notify={vi.fn()} goHome={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Start comparison/ }));
    await screen.findByText('Download local Whisper model?');
    fireEvent.click(screen.getByRole('button', { name: 'Download model' }));

    await waitFor(() => expect(whisperInstall).toHaveBeenCalledWith('small'));
    await waitFor(() => expect(transcriptStart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Download local Whisper model?')).toBeNull());
  });

  it('extends an expanded discrepancy background across every results column', () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <Transcript
          state={{ ...WIRE_TRANSCRIPT, phase: 'success', rows: WIRE_DISCREPANCIES, markerExport: { phase: 'idle', message: '', added: 0, skipped: 0 } }}
          notify={vi.fn()}
          goHome={vi.fn()}
          goToManuscript={vi.fn()}
        />
      </ApiProvider>,
    );

    fireEvent.click(screen.getByText('White Rabbit'));
    expect(document.querySelector('td[colspan="6"]')).toBeTruthy();
  });
});
