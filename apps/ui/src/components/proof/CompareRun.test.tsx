// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompareRun } from './CompareRun';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TRANSCRIPT } from '../../api/mockFixtures';
import { WIRE_DISCREPANCIES } from '../../api/mockFixtures';

afterEach(cleanup);

describe('CompareRun actions that answer late or fail (ADR 0075)', () => {
  it('Cancel says it was heard, ignores a second press, and reports a cancel the host refuses', async () => {
    const hang = vi.fn(() => new Promise<void>(() => {}));
    const notify = vi.fn();
    const { unmount } = render(
      <ApiProvider api={createMockApi({ transcriptCancel: hang })}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={{ ...WIRE_TRANSCRIPT, phase: 'running' }}
          notify={notify}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={0}
        />
      </ApiProvider>,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    await waitFor(() => expect(cancel.getAttribute('aria-busy')).toBe('true'));
    expect(hang).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <ApiProvider api={createMockApi({ transcriptCancel: () => Promise.reject(new Error('the comparison already ended')) })}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={{ ...WIRE_TRANSCRIPT, phase: 'running' }}
          notify={notify}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={0}
        />
      </ApiProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('the comparison already ended'), 'error'));
  });
});

describe('CompareRun DAW-link gating (PRD project-workspace-and-daw-link.prd.md, W16)', () => {
  it('gates Start comparison without a linked DAW file, and lets it run once linked', async () => {
    const transcriptStart = vi.fn().mockResolvedValue({ status: 'started' });
    const props = {
      chapterTitle: 'Chapter 1',
      state: WIRE_TRANSCRIPT,
      notify: vi.fn(),
      reviewingLast: false,
      onReviewLast: vi.fn(),
      onCloseLast: vi.fn(),
      foundHere: 0,
    };
    const { rerender } = render(
      <ApiProvider api={createMockApi({ transcriptStart })}>
        <CompareRun {...props} dawFileLinked={false} />
      </ApiProvider>,
    );
    const gated = screen.getByRole('button', { name: /Start comparison/ });
    expect(gated.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Link a REAPER project (.rpp) file to start a comparison.')).toBeTruthy();
    fireEvent.click(gated);
    expect(transcriptStart).not.toHaveBeenCalled();

    rerender(
      <ApiProvider api={createMockApi({ transcriptStart })}>
        <CompareRun {...props} dawFileLinked />
      </ApiProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Start comparison/ }));
    // The chapter view names its own chapter, so the host never guesses it from the track name.
    await waitFor(() => expect(transcriptStart).toHaveBeenCalledWith(expect.objectContaining({ chapterTitle: 'Chapter 1' })));
  });

  // DAW port PRD Phase 7 (ADR 0360), moved from the retired Proofing nav item (stage-navigation Phase 5): once a file is linked,
  // whether a comparison can start comes from the `review` capability, so a REAPER that is not connected says so.
  it('gates Start comparison on the review capability when REAPER is not connected', async () => {
    render(
      <ApiProvider api={createMockApi({}, { daw: { connected: false } })}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={WIRE_TRANSCRIPT}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={0}
        />
      </ApiProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Start comparison/ }).getAttribute('aria-disabled')).toBe('true'));
    expect(screen.getByText(/REAPER is not connected to this app/)).toBeTruthy();
  });

  it('disables marker export without a linked DAW file, and for the last comparison under review', () => {
    const results = {
      ...WIRE_TRANSCRIPT,
      phase: 'success' as const,
      rows: WIRE_DISCREPANCIES,
      markerExport: { phase: 'idle' as const, message: '', added: 0, skipped: 0 },
    };
    const { rerender } = render(
      <ApiProvider api={createMockApi()}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={results}
          notify={vi.fn()}
          dawFileLinked={false}
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={2}
        />
      </ApiProvider>,
    );
    expect((screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <ApiProvider api={createMockApi()}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={WIRE_TRANSCRIPT}
          lastCompleted={results}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={2}
        />
      </ApiProvider>,
    );
    expect((screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CompareRun chapter choice', () => {
  it('asks which chapter the track belongs to in a named region inside the run', () => {
    render(
      <ApiProvider api={createMockApi()}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={{ ...WIRE_TRANSCRIPT, phase: 'need_chapter', chapters: ['Chapter 1', 'Chapter 2'] }}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={0}
        />
      </ApiProvider>,
    );
    expect(screen.getByRole('region', { name: 'Compare the recording with the script' })).toBeTruthy();
    const region = screen.getByRole('region', { name: 'Choose manuscript chapter' });
    expect(within(region).getByRole('heading', { level: 2 })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Chapter 2' })).toBeTruthy();
  });
});

describe('CompareRun vocabulary suggestions', () => {
  it('does not show candidates until requested, then accepts manifest candidates once', async () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={WIRE_TRANSCRIPT}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={0}
        />
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

  it('says how many discrepancies this chapter has and exports only pending markers on explicit request', async () => {
    const exportMarkers = vi.fn().mockResolvedValue(undefined);
    const api = createMockApi({ transcriptExportMarkers: exportMarkers });
    render(
      <ApiProvider api={api}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={{ ...WIRE_TRANSCRIPT, phase: 'success', rows: WIRE_DISCREPANCIES, markerExport: { phase: 'idle', message: '', added: 0, skipped: 0 } }}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={2}
        />
      </ApiProvider>,
    );

    expect(screen.getByText(/2 discrepancies in Chapter 1, each one a flag in the Flags panel \(1 more in other chapters\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 marker' }));
    await waitFor(() => expect(exportMarkers).toHaveBeenCalledOnce());
  });

  it('New comparison resets a live run, and only closes the last comparison under review', async () => {
    const transcriptReset = vi.fn().mockResolvedValue(undefined);
    const onCloseLast = vi.fn();
    const results = { ...WIRE_TRANSCRIPT, phase: 'success' as const, rows: WIRE_DISCREPANCIES };
    const { rerender } = render(
      <ApiProvider api={createMockApi({ transcriptReset })}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={results}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={onCloseLast}
          foundHere={2}
        />
      </ApiProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New comparison' }));
    await waitFor(() => expect(transcriptReset).toHaveBeenCalledOnce());

    rerender(
      <ApiProvider api={createMockApi({ transcriptReset })}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={WIRE_TRANSCRIPT}
          lastCompleted={results}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast
          onReviewLast={vi.fn()}
          onCloseLast={onCloseLast}
          foundHere={2}
        />
      </ApiProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New comparison' }));
    expect(onCloseLast).toHaveBeenCalledOnce();
    expect(transcriptReset).toHaveBeenCalledOnce();
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
    const whisperInstall = vi.fn().mockResolvedValue({
      id: 'w-1',
      modelId: 'small',
      phase: 'success',
      message: 'Whisper model installed and verified.',
      percent: 100,
      bytesDone: 10,
      bytesTotal: 10,
      error: '',
    });
    const api = createMockApi({ transcriptStart, whisperInstall });
    render(
      <ApiProvider api={api}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={WIRE_TRANSCRIPT}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={0}
        />
      </ApiProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Start comparison/ }));
    await screen.findByText('Download local Whisper model?');
    fireEvent.click(screen.getByRole('button', { name: 'Download model' }));

    await waitFor(() => expect(whisperInstall).toHaveBeenCalledWith('small'));
    await waitFor(() => expect(transcriptStart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Download local Whisper model?')).toBeNull());
  });
});

describe('CompareRun "may have changed since comparison" (reaper-automation-follow-through PRD Phase 13)', () => {
  const resultsProps = (overrides: Partial<Parameters<typeof CompareRun>[0]> = {}) => ({
    chapterTitle: 'Chapter 1',
    state: { ...WIRE_TRANSCRIPT, phase: 'success' as const, rows: WIRE_DISCREPANCIES, projectChangeCount: 41 },
    notify: vi.fn(),
    dawFileLinked: true,
    reviewingLast: false,
    onReviewLast: vi.fn(),
    onCloseLast: vi.fn(),
    foundHere: 2,
    ...overrides,
  });

  it('shows the label once a background check finds REAPER’s count has moved past the comparison’s baseline', async () => {
    render(
      <ApiProvider api={createMockApi()}>
        <CompareRun {...resultsProps()} />
      </ApiProvider>,
    );
    await waitFor(() => expect(screen.getByText('The REAPER project may have changed since this comparison.')).toBeTruthy());
  });

  it('says nothing when the checked count still matches the comparison’s baseline', async () => {
    render(
      <ApiProvider api={createMockApi({}, { projectState: 'unchanged' })}>
        <CompareRun {...resultsProps()} />
      </ApiProvider>,
    );
    await screen.findByText(/2 discrepancies/);
    expect(screen.queryByText(/may have changed/)).toBeNull();
  });

  it('never checks, and never shows the label, when the comparison carries no baseline count', async () => {
    const projectStateCheck = vi.fn().mockResolvedValue({ status: 'started' as const });
    render(
      <ApiProvider api={createMockApi({ projectStateCheck })}>
        <CompareRun {...resultsProps({ state: { ...WIRE_TRANSCRIPT, phase: 'success', rows: WIRE_DISCREPANCIES, projectChangeCount: undefined } })} />
      </ApiProvider>,
    );
    await screen.findByText(/2 discrepancies/);
    expect(projectStateCheck).not.toHaveBeenCalled();
    expect(screen.queryByText(/may have changed/)).toBeNull();
  });

  it('says nothing outside the results view, even with a baseline on the run', () => {
    render(
      <ApiProvider api={createMockApi()}>
        <CompareRun {...resultsProps({ state: { ...WIRE_TRANSCRIPT, phase: 'idle', projectChangeCount: 41 } })} />
      </ApiProvider>,
    );
    expect(screen.queryByText(/may have changed/)).toBeNull();
  });

  it('checks the last completed comparison’s baseline while reviewing it, not the idle live state', async () => {
    const results = { ...WIRE_TRANSCRIPT, phase: 'success' as const, rows: WIRE_DISCREPANCIES, projectChangeCount: 41 };
    render(
      <ApiProvider api={createMockApi()}>
        <CompareRun {...resultsProps({ state: WIRE_TRANSCRIPT, lastCompleted: results, reviewingLast: true })} />
      </ApiProvider>,
    );
    await waitFor(() => expect(screen.getByText('The REAPER project may have changed since this comparison.')).toBeTruthy());
  });

  it('a failed check is quiet: no label, no crash', async () => {
    render(
      <ApiProvider api={createMockApi({}, { projectState: 'error' })}>
        <CompareRun {...resultsProps()} />
      </ApiProvider>,
    );
    await screen.findByText(/2 discrepancies/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/may have changed/)).toBeNull();
  });
});

describe('CompareRun vocabulary hints feedback', () => {
  function renderHints(overrides: Parameters<typeof createMockApi>[0] = {}) {
    const notify = vi.fn();
    const api = createMockApi(overrides);
    render(
      <ApiProvider api={api}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={WIRE_TRANSCRIPT}
          notify={notify}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={0}
        />
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

    await waitFor(() => expect(notify).toHaveBeenCalledWith('build the Story Bible before requesting vocabulary suggestions', 'error'));
  });

  it('says when the saved hints could not be loaded instead of showing an empty box', async () => {
    const notify = renderHints({ transcriptHints: () => Promise.reject('the saved vocabulary hints file is not a valid list') });

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        'The saved vocabulary hints could not be loaded: the saved vocabulary hints file is not a valid list. Hints you add now will replace them.',
        'error',
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

describe('the running phase progress bar (mock-fidelity-primitives-and-components.prd.md Phase 9)', () => {
  it('is the real ProgressBar primitive, named and announcing its value, not a hand-drawn div', () => {
    render(
      <ApiProvider api={createMockApi()}>
        <CompareRun
          chapterTitle="Chapter 1"
          state={{ ...WIRE_TRANSCRIPT, phase: 'running', percent: 63 }}
          notify={vi.fn()}
          dawFileLinked
          reviewingLast={false}
          onReviewLast={vi.fn()}
          onCloseLast={vi.fn()}
          foundHere={0}
        />
      </ApiProvider>,
    );
    const bar = screen.getByRole('progressbar', { name: 'Comparison progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('63');
  });
});
