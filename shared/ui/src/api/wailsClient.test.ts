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

  it('lists recent projects from the native binding', async () => {
    const recents = [{ path: 'C:/Projects/Alice', name: 'Alice', lastOpened: '2026-09-10T12:00:00Z' }];
    const projectRecents = vi.fn().mockResolvedValue(JSON.stringify(recents));
    window.go = { main: { Host: { ProjectRecents: projectRecents } } };

    await expect(wailsClient.projectRecents()).resolves.toEqual(recents);
    expect(projectRecents).toHaveBeenCalledWith();
  });

  it('opens the native folder-browse dialog for selecting a project folder', async () => {
    const selectProjectFolder = vi.fn().mockResolvedValue(JSON.stringify({ selected: true, path: 'C:/Projects/New-Project' }));
    window.go = { main: { Host: { ProjectSelectFolder: selectProjectFolder } } };

    await expect(wailsClient.selectProjectFolder()).resolves.toEqual({ selected: true, path: 'C:/Projects/New-Project' });
    expect(selectProjectFolder).toHaveBeenCalledWith();
  });

  it('switches the active project, defaulting an omitted name to an empty string for the backend to fill in', async () => {
    const switchProject = vi.fn().mockResolvedValue(JSON.stringify({ switched: true }));
    window.go = { main: { Host: { ProjectSwitch: switchProject } } };

    await expect(wailsClient.switchProject('C:/Projects/Alice')).resolves.toEqual({ switched: true });
    expect(switchProject).toHaveBeenCalledWith('C:/Projects/Alice', '');

    await wailsClient.switchProject('C:/Projects/Alice', 'Alice');
    expect(switchProject).toHaveBeenCalledWith('C:/Projects/Alice', 'Alice');
  });

  it('surfaces a refusal reason when switching project fails', async () => {
    const switchProject = vi.fn().mockResolvedValue(JSON.stringify({ switched: false, reason: 'Narration Utils is busy.' }));
    window.go = { main: { Host: { ProjectSwitch: switchProject } } };

    await expect(wailsClient.switchProject('C:/Projects/Alice')).resolves.toEqual({ switched: false, reason: 'Narration Utils is busy.' });
  });

  it('creates a new project, defaulting an omitted name to an empty string for the backend to fill in', async () => {
    const createProject = vi.fn().mockResolvedValue(JSON.stringify({ switched: true }));
    window.go = { main: { Host: { ProjectCreate: createProject } } };

    await expect(wailsClient.createProject('C:/Projects/New-Project')).resolves.toEqual({ switched: true });
    expect(createProject).toHaveBeenCalledWith('C:/Projects/New-Project', '');
  });

  it('removes a recent project via the native binding and resolves with the updated list', async () => {
    const remaining = [{ path: 'C:/Projects/Alice', name: 'Alice', lastOpened: '2026-09-10T12:00:00Z' }];
    const removeRecentProject = vi.fn().mockResolvedValue(JSON.stringify(remaining));
    window.go = { main: { Host: { ProjectRemoveRecent: removeRecentProject } } };

    await expect(wailsClient.removeRecentProject('C:/Projects/Voltage-and-the-Undercroft')).resolves.toEqual(remaining);
    expect(removeRecentProject).toHaveBeenCalledWith('C:/Projects/Voltage-and-the-Undercroft');
  });

  it('decodes the Tracks discover, select, and list bindings', async () => {
    const discovery = { candidates: ['C:/Projects/Alice/Alice.rpp'], selected: 'C:/Projects/Alice/Alice.rpp' };
    const project = { path: 'C:/Projects/Alice/Alice.rpp', tracks: [] };
    const select = vi.fn().mockResolvedValue(JSON.stringify(discovery));
    window.go = {
      main: {
        Host: {
          TracksDiscover: vi.fn().mockResolvedValue(JSON.stringify(discovery)),
          TracksSelect: select,
          TracksList: vi.fn().mockResolvedValue(JSON.stringify(project)),
        },
      },
    };

    await expect(wailsClient.tracksDiscover()).resolves.toEqual(discovery);
    await expect(wailsClient.tracksSelect('C:/Projects/Alice/Alice.rpp')).resolves.toEqual(discovery);
    expect(select).toHaveBeenCalledWith('C:/Projects/Alice/Alice.rpp');
    await expect(wailsClient.tracksList()).resolves.toEqual(project);
  });

  it('builds a /media playback URL with the source path percent-encoded', () => {
    expect(wailsClient.mediaUrl('C:\\My Book\\media\\take 1.wav')).toBe('/media?path=C%3A%5CMy%20Book%5Cmedia%5Ctake%201.wav');
  });
});
