// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transcript } from './Transcript';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TRANSCRIPT } from '../../api/mockFixtures';
import { WIRE_DISCREPANCIES } from '../../api/mockFixtures';

afterEach(cleanup);

describe('Transcript chapter choice', () => {
  it('asks which chapter the track belongs to in a named region under the page heading', () => {
    render(
      <ApiProvider api={createMockApi()}>
        <Transcript
          state={{ ...WIRE_TRANSCRIPT, phase: 'need_chapter', chapters: ['Chapter 1', 'Chapter 2'] }}
          notify={vi.fn()}
          goHome={vi.fn()}
          goToManuscript={vi.fn()}
        />
      </ApiProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Proofing' })).toBeTruthy();
    const region = screen.getByRole('region', { name: 'Choose manuscript chapter' });
    expect(within(region).getByRole('heading', { level: 2 })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Chapter 2' })).toBeTruthy();
  });
});

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

describe('Transcript vocabulary hints feedback', () => {
  function renderHints(overrides: Parameters<typeof createMockApi>[0] = {}) {
    const notify = vi.fn();
    const api = createMockApi(overrides);
    render(
      <ApiProvider api={api}>
        <Transcript state={WIRE_TRANSCRIPT} notify={notify} goHome={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    return notify;
  }
  const suggest = () => fireEvent.click(screen.getByRole('button', { name: /Suggest from manuscript/ }));

  it('says nothing was found when the Story Bible offers no names', async () => {
    const notify = renderHints({ transcriptSuggestHints: async () => ({ terms: [], found: 0 }) });
    await screen.findByText('Vocabulary hints');

    suggest();

    await waitFor(() => expect(notify).toHaveBeenCalledWith('No names found in the Story Bible yet. Build it or add entries, then try again.'));
  });

  it('says everything found is already accepted, and how many that is', async () => {
    const notify = renderHints({ transcriptSuggestHints: async () => ({ terms: [], found: 3 }) });
    await screen.findByText('Vocabulary hints');

    suggest();

    await waitFor(() => expect(notify).toHaveBeenCalledWith('No new suggestions: all 3 names found are already accepted.'));
  });

  it('counts the new suggestions, and says so when a second click finds only ones already shown', async () => {
    const notify = renderHints({ transcriptSuggestHints: async () => ({ terms: ['Alice', 'Zeph'], found: 2 }) });
    await screen.findByText('Vocabulary hints');

    suggest();
    await waitFor(() => expect(notify).toHaveBeenLastCalledWith('Found 2 new suggestions.'));
    suggest();

    await waitFor(() => expect(notify).toHaveBeenLastCalledWith('The 2 suggestions found are already shown. Click one to accept it.'));
    expect(screen.getAllByRole('button', { name: /^\+ / })).toHaveLength(2);
  });

  it('matches suggestions against accepted hints regardless of case', async () => {
    const notify = renderHints({ transcriptHints: async () => ['alice'], transcriptSuggestHints: async () => ({ terms: ['Alice', 'Zeph'], found: 2 }) });
    await screen.findByText('alice');

    suggest();

    await waitFor(() => expect(notify).toHaveBeenLastCalledWith('Found 1 new suggestion.'));
    expect(screen.queryByRole('button', { name: '+ Alice' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Zeph' })).toBeTruthy();
  });

  it('reports the host reason when Suggest fails', async () => {
    const notify = renderHints({ transcriptSuggestHints: () => Promise.reject('build the Story Bible before requesting vocabulary suggestions') });
    await screen.findByText('Vocabulary hints');

    suggest();

    await waitFor(() => expect(notify).toHaveBeenCalledWith('build the Story Bible before requesting vocabulary suggestions'));
  });

  it('says when the saved hints could not be loaded instead of showing an empty box', async () => {
    const notify = renderHints({ transcriptHints: () => Promise.reject('the saved vocabulary hints file is not a valid list') });

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        'The saved vocabulary hints could not be loaded: the saved vocabulary hints file is not a valid list. Hints you add now will replace them.',
      ),
    );
    expect(screen.getByText('Vocabulary hints')).toBeTruthy();
  });

  it('adds a typed term once, whatever its case', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHints({ transcriptHints: async () => ['Alice'], transcriptSaveHints: save });
    await screen.findByText('Alice');

    const input = screen.getByPlaceholderText('Add a term…');
    fireEvent.change(input, { target: { value: 'alice' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'Zeph' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(['Alice', 'Zeph']);
  });

  it('does not offer a name accepted while the suggestion request was still in flight', async () => {
    let resolveSuggest: (value: { terms: string[]; found: number }) => void = () => {};
    const save = vi.fn().mockResolvedValue(undefined);
    const notify = renderHints({
      transcriptSaveHints: save,
      transcriptSuggestHints: () => new Promise((resolve) => (resolveSuggest = resolve)),
    });
    await screen.findByText('Vocabulary hints');

    suggest();
    const input = screen.getByPlaceholderText('Add a term…');
    fireEvent.change(input, { target: { value: 'Alice' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(save).toHaveBeenCalledWith(['Alice']));
    await act(async () => resolveSuggest({ terms: ['Alice', 'Zeph'], found: 2 }));

    expect(screen.queryByRole('button', { name: '+ Alice' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Zeph' })).toBeTruthy();
    expect(notify).toHaveBeenLastCalledWith('Found 1 new suggestion.');
  });

  it('loads the saved hints once and reports a load failure once', async () => {
    const hints = vi.fn().mockRejectedValue('the saved vocabulary hints file is not a valid list');
    const notify = renderHints({ transcriptHints: hints });

    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(hints).toHaveBeenCalledTimes(1);
  });

  it('splits a typed or pasted list on commas so no term can hold one', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHints({ transcriptSaveHints: save });
    await screen.findByText('Vocabulary hints');

    const input = screen.getByPlaceholderText('Add a term…');
    fireEvent.change(input, { target: { value: ' Juno,  Zeph , ,juno ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(save).toHaveBeenCalledWith(['Juno', 'Zeph']));
  });
});
