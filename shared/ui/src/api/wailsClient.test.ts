// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { wailsClient } from './wailsClient';

const originalGo = window.go;
const originalRuntime = (window as unknown as { runtime?: unknown }).runtime;

afterEach(() => {
  window.go = originalGo;
  (window as unknown as { runtime?: unknown }).runtime = originalRuntime;
});

describe('wailsClient', () => {
  it('uses generated Wails methods rather than an operation-string transport', async () => {
    const select = vi.fn().mockResolvedValue(JSON.stringify({ selected: true, jobId: 'import-1' }));
    window.go = { main: { Host: { Ready: () => Promise.resolve({ apiVersion: 1, diagnosticId: 'native' }), ManuscriptSelectFile: select } } };

    await expect(wailsClient.ready()).resolves.toEqual({ apiVersion: 1, diagnosticId: 'native' });
    await expect(wailsClient.selectManuscript()).resolves.toEqual({ selected: true, jobId: 'import-1' });
    expect(select).toHaveBeenCalledWith();
  });

  it('subscribes once to the transcript state event and normalizes marker export state', () => {
    let callback: ((payload: unknown) => void) | undefined;
    const eventsOn = vi.fn((_event: string, listener: (payload: unknown) => void) => {
      callback = listener;
      return () => {};
    });
    (window as unknown as { runtime: { EventsOnMultiple: typeof eventsOn } }).runtime = { EventsOnMultiple: eventsOn };
    const update = vi.fn();

    wailsClient.subscribeTranscript(update);
    callback?.({ phase: 'running', percent: 10, message: 'Working', logs: [], chapters: [], rows: [], diff: '', summary: '', elapsed: 1 });

    expect(eventsOn).toHaveBeenCalledWith('transcript:state', expect.any(Function), -1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ markerExport: { phase: 'idle', message: '', added: 0, skipped: 0 } }));
  });

  it('forwards checked character candidates when committing a manuscript import', async () => {
    const commit = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ id: 'import-1', kind: 'manuscript_import', phase: 'success', message: '', percent: 100, logs: [], elapsed: 0 }));
    window.go = { main: { Host: { ManuscriptImportCommit: commit } } };

    await wailsClient.manuscriptImportCommit('import-1', {
      confirmedReset: false,
      selection: { sectionKinds: { 's-1': 'narration' }, characterCandidateIds: ['candidate-1', 'candidate-2'] },
    });

    expect(commit).toHaveBeenCalledWith('import-1', false, { 's-1': 'narration' }, ['candidate-1', 'candidate-2']);
  });

  it('uses the native project-attach event for safe single-instance handoff', () => {
    let callback: ((payload: unknown) => void) | undefined;
    const eventsOn = vi.fn((_event: string, listener: (payload: unknown) => void) => {
      callback = listener;
      return () => {};
    });
    (window as unknown as { runtime: { EventsOnMultiple: typeof eventsOn } }).runtime = { EventsOnMultiple: eventsOn };
    const update = vi.fn();

    wailsClient.subscribeProjectAttach(update);
    callback?.({ attached: false, reason: 'Busy' });

    expect(eventsOn).toHaveBeenCalledWith('system:attached', expect.any(Function), -1);
    expect(update).toHaveBeenCalledWith({ attached: false, reason: 'Busy' });
  });
});
