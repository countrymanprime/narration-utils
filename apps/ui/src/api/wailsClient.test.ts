// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { wailsClient } from './wailsClient';
import { WireError } from './wire/WireError';

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

  it('accepts the idle Bootstrap the host sends, with nulls for unset transcript fields and no marker export', async () => {
    const idle = {
      runId: null,
      phase: 'idle',
      percent: 0,
      message: '',
      logs: [],
      chapters: [],
      rows: [],
      diff: '',
      summary: '',
      trackName: null,
      audioItemCount: null,
      completedAt: null,
      elapsed: 0,
    };
    const bootstrap = {
      apiVersion: 6,
      diagnosticId: 'go-1',
      version: '0.2.7',
      projectFolder: 'C:/P',
      projectName: 'P',
      daw: 'reaper',
      manuscript: null,
      manuscriptCandidate: null,
      runtime: { Reaper: { launcherPath: '' } },
      transcript: idle,
    };
    window.go = { main: { Host: { Bootstrap: () => Promise.resolve(bootstrap) } } };

    const parsed = await wailsClient.bootstrap();

    expect(parsed.transcript.runId).toBeUndefined();
    expect(parsed.transcript.markerExport).toEqual({ phase: 'idle', message: '', added: 0, skipped: 0 });
  });

  it('rejects a Bootstrap with the wrong shape as a WireError and writes it to the host log without values', async () => {
    const report = vi.fn().mockResolvedValue('null');
    window.go = {
      main: {
        Host: {
          Bootstrap: () => Promise.resolve({ apiVersion: 6, version: '0.2.7', projectName: 'A SECRET TITLE', transcript: 'nope' }),
          SystemReportDiagnostic: report,
        },
      },
    };

    await expect(wailsClient.bootstrap()).rejects.toBeInstanceOf(WireError);

    expect(report).toHaveBeenCalledTimes(1);
    const [kind, message] = report.mock.calls[0] as [string, string];
    expect(kind).toBe('wire_invalid');
    expect(message).toContain('host.binding Bootstrap');
    expect(message).toContain('transcript');
    expect(message).not.toContain('SECRET');
  });

  it('still throws the WireError when there is no host to report to', async () => {
    window.go = { main: { Host: { Ready: () => Promise.resolve({ diagnosticId: 'x' }) } } };
    await expect(wailsClient.ready()).rejects.toBeInstanceOf(WireError);
  });

  it('rejects a host binding that answers with text that is not JSON', async () => {
    window.go = { main: { Host: { SystemReportDiagnostic: () => Promise.resolve('<html>') } } };
    await expect(wailsClient.reportClientDiagnostic('k', 'm')).rejects.toBeInstanceOf(WireError);
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

  it('reads the update status through its schema and reports a payload that does not match', async () => {
    const status = {
      version: '0.2.6',
      development: false,
      platform: 'windows-x64',
      channel: 'candidates',
      canInstall: true,
      installBlockedReason: '',
      downloaded: null,
      lastChecked: '',
      failure: '',
      available: null,
    };
    const report = vi.fn().mockResolvedValue('null');
    window.go = {
      main: {
        Host: {
          UpdateStatus: () => Promise.resolve(JSON.stringify(status)),
          UpdateCheck: () => Promise.resolve('{"version":3}'),
          SystemReportDiagnostic: report,
        },
      },
    };

    await expect(wailsClient.updateStatus()).resolves.toEqual(status);
    await expect(wailsClient.updateCheck()).rejects.toBeInstanceOf(WireError);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('opens the release notes through a binding that takes no address', async () => {
    const open = vi.fn().mockResolvedValue('null');
    window.go = { main: { Host: { UpdateOpenNotes: open } } };
    await expect(wailsClient.updateOpenNotes()).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith();
  });

  it('starts, polls and cancels an update download through the job schema', async () => {
    const job = { id: 'update-1', version: '0.2.7', phase: 'downloading', message: 'Downloading', percent: 40, bytesDone: 4, bytesTotal: 10, error: '' };
    const cancel = vi.fn().mockResolvedValue(JSON.stringify({ ...job, phase: 'cancelled' }));
    window.go = {
      main: {
        Host: {
          UpdateDownload: () => Promise.resolve(JSON.stringify(job)),
          UpdateJobState: () => Promise.resolve(JSON.stringify({ ...job, phase: 'verifying', percent: 100 })),
          UpdateJobCancel: cancel,
        },
      },
    };

    await expect(wailsClient.updateDownload()).resolves.toEqual(job);
    await expect(wailsClient.updateJobState('update-1')).resolves.toMatchObject({ phase: 'verifying' });
    await expect(wailsClient.updateJobCancel('update-1')).resolves.toMatchObject({ phase: 'cancelled' });
    expect(cancel).toHaveBeenCalledWith('update-1');
  });

  it('subscribes to the update event and passes a status that matches its schema', () => {
    let callback: ((payload: unknown) => void) | undefined;
    const eventsOn = vi.fn((_event: string, listener: (payload: unknown) => void) => {
      callback = listener;
      return () => {};
    });
    (window as unknown as { runtime: { EventsOnMultiple: typeof eventsOn } }).runtime = { EventsOnMultiple: eventsOn };
    const seen = vi.fn();

    wailsClient.subscribeUpdate(seen);
    callback?.({
      version: '0.2.6',
      development: false,
      platform: 'windows-x64',
      channel: 'stable',
      canInstall: false,
      installBlockedReason: 'x',
      downloaded: null,
      lastChecked: 'x',
      failure: '',
      available: null,
    });

    expect(eventsOn).toHaveBeenCalledWith('update:status', expect.any(Function), -1);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ channel: 'stable' }));
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

    expect(commit).toHaveBeenCalledWith('import-1', false, { 's-1': 'narration' }, ['candidate-1', 'candidate-2'], {});
  });

  it('forwards the subtitles the narrator turned off when committing a manuscript import', async () => {
    const commit = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ id: 'import-1', kind: 'manuscript_import', phase: 'success', message: '', percent: 100, logs: [], elapsed: 0 }));
    window.go = { main: { Host: { ManuscriptImportCommit: commit } } };

    await wailsClient.manuscriptImportCommit('import-1', { confirmedReset: true, selection: { subtitleDefault: false, subtitleOverrides: { 's-1': false } } });

    // The review's default is resolved into the overrides before the commit: the host never receives it.
    expect(commit).toHaveBeenCalledWith('import-1', true, {}, [], { 's-1': false });
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

  it('creates a new project under a parent directory and a name, through ProjectCreateIn', async () => {
    const createProject = vi.fn().mockResolvedValue(JSON.stringify({ switched: true }));
    window.go = { main: { Host: { ProjectCreateIn: createProject } } };

    await expect(wailsClient.createProject('C:/Projects', 'New Project')).resolves.toEqual({ switched: true });
    expect(createProject).toHaveBeenCalledWith('C:/Projects', 'New Project');
  });

  it('creates a new project with an empty parent, letting the backend default to the projects directory', async () => {
    const createProject = vi.fn().mockResolvedValue(JSON.stringify({ switched: true }));
    window.go = { main: { Host: { ProjectCreateIn: createProject } } };

    await expect(wailsClient.createProject('', 'New Project')).resolves.toEqual({ switched: true });
    expect(createProject).toHaveBeenCalledWith('', 'New Project');
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

  it('decodes the ChapterTrackMap list, confirm, and clear bindings', async () => {
    const empty = { documentId: 'doc-1', mappings: [] };
    const confirmed = { trackGuid: 'track-guid-a', chapterId: 'c-0001', chapterTitle: 'Chapter One', confirmedAt: '2026-09-22T00:00:00Z' };
    const withOne = { documentId: 'doc-1', mappings: [confirmed] };
    const confirm = vi.fn().mockResolvedValue(JSON.stringify(confirmed));
    const clear = vi.fn().mockResolvedValue(JSON.stringify(empty));
    window.go = {
      main: {
        Host: {
          ChapterTrackMapList: vi.fn().mockResolvedValueOnce(JSON.stringify(empty)).mockResolvedValueOnce(JSON.stringify(withOne)),
          ChapterTrackMapConfirm: confirm,
          ChapterTrackMapClear: clear,
        },
      },
    };

    await expect(wailsClient.chapterTrackMapList()).resolves.toEqual(empty);
    await expect(wailsClient.chapterTrackMapConfirm('track-guid-a', 'c-0001')).resolves.toEqual(confirmed);
    expect(confirm).toHaveBeenCalledWith('track-guid-a', 'c-0001');
    await expect(wailsClient.chapterTrackMapList()).resolves.toEqual(withOne);
    await expect(wailsClient.chapterTrackMapClear('track-guid-a')).resolves.toEqual(empty);
    expect(clear).toHaveBeenCalledWith('track-guid-a');
  });

  it('sends the review query and decision to the host and decodes the findings it answers', async () => {
    const finding = {
      schema_version: 1,
      id: 'f1',
      analyzer: 'transcript-compare',
      project: { path: 'C:/P' },
      source: {},
      category: 'transcript_discrepancy',
      severity: 'warning',
      confidence: null,
      confidence_reason: 'no timing signal',
      evidence_version: 'v1',
      review: { status: 'dismissed', note: 'noise', timestamp: '2026-09-23T10:00:00Z' },
    };
    const summary = { total: 1, unreviewed: 0, accepted: 0, dismissed: 1, deferred: 0, notInLatestRun: 0, analyzers: null, categories: null, chapters: null };
    const list = vi.fn().mockResolvedValue(JSON.stringify({ findings: null, total: 0 }));
    const get = vi.fn().mockResolvedValue(JSON.stringify(finding));
    const review = vi.fn().mockResolvedValue(JSON.stringify(finding));
    window.go = {
      main: { Host: { FindingsList: list, FindingsGet: get, FindingsReview: review, FindingsSummary: vi.fn().mockResolvedValue(JSON.stringify(summary)) } },
    };

    await expect(wailsClient.findingsList({ sort: 'confidence', limit: 50 })).resolves.toEqual({ findings: [], total: 0 });
    expect(list).toHaveBeenCalledWith({ sort: 'confidence', limit: 50 });
    await expect(wailsClient.findingsGet('f1')).resolves.toMatchObject({ id: 'f1', confidence: null });
    expect(get).toHaveBeenCalledWith('f1');
    await expect(wailsClient.findingsReview({ id: 'f1', evidenceVersion: 'v1', status: 'dismissed', note: 'noise' })).resolves.toMatchObject({
      review: { status: 'dismissed' },
    });
    expect(review).toHaveBeenCalledWith('f1', 'v1', 'dismissed', 'noise');
    await expect(wailsClient.findingsSummary()).resolves.toMatchObject({ dismissed: 1, analyzers: [], chapters: [] });
  });

  it('rejects a finding whose review status the host never sends', async () => {
    const bad = {
      schema_version: 1,
      id: 'f1',
      analyzer: 'a',
      project: {},
      source: {},
      category: 'c',
      severity: 'warning',
      confidence: 0.5,
      confidence_reason: 'r',
      review: { status: 'approved' },
    };
    window.go = { main: { Host: { FindingsGet: vi.fn().mockResolvedValue(JSON.stringify(bad)) } } };
    await expect(wailsClient.findingsGet('f1')).rejects.toBeInstanceOf(WireError);
  });

  it('starts, stops and reads the teleprompter through the native bindings', async () => {
    const start = vi.fn().mockResolvedValue(JSON.stringify({ status: 'started' }));
    const stop = vi.fn().mockResolvedValue('null');
    const state = vi.fn().mockResolvedValue(JSON.stringify({ phase: 'idle', script: null, position: null }));
    window.go = { main: { Host: { TeleprompterStart: start, TeleprompterStop: stop, TeleprompterState: state } } };
    const options = { chapter: 'chapter-1', device: 'Microphone (USB)', model: 'tiny' };

    await expect(wailsClient.teleprompterStart(options)).resolves.toEqual({ status: 'started' });
    expect(start).toHaveBeenCalledWith(options);
    await wailsClient.teleprompterStop();
    expect(stop).toHaveBeenCalledWith();
    await expect(wailsClient.teleprompterState()).resolves.toEqual({ phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null });
  });

  it('sends the credits kind, not a chapter, to TeleprompterStart for the credits (credits PRD Phase 4)', async () => {
    const start = vi.fn().mockResolvedValue(JSON.stringify({ status: 'started' }));
    window.go = { main: { Host: { TeleprompterStart: start } } };

    await wailsClient.teleprompterStart({ credits: 'closing', device: 'Microphone (USB)', model: 'tiny' });

    expect(start).toHaveBeenCalledWith({ credits: 'closing', device: 'Microphone (USB)', model: 'tiny' });
  });

  it('relays the teleprompter event and state subscriptions from the native runtime', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const eventsOn = vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener);
      return () => {};
    });
    (window as unknown as { runtime: { EventsOnMultiple: typeof eventsOn } }).runtime = { EventsOnMultiple: eventsOn };
    const onEvent = vi.fn();
    const onState = vi.fn();

    wailsClient.subscribeTeleprompterEvent(onEvent);
    wailsClient.subscribeTeleprompterState(onState);
    listeners.get('teleprompter:event')?.({ type: 'position', read: 3, committed: 2, status: 'listening', jump: null, skipped: null });
    listeners.get('teleprompter:event')?.('{"type":"segment_end","segment":1}');
    listeners.get('teleprompter:state')?.({ phase: 'running', message: 'Listening…' });

    expect(onEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'position', read: 3 }));
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: 'segment_end', segment: 1 });
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ phase: 'running', script: null, position: null }));
  });

  it('builds a /media playback URL with the source path percent-encoded', () => {
    expect(wailsClient.mediaUrl('C:\\My Book\\media\\take 1.wav')).toBe('/media?path=C%3A%5CMy%20Book%5Cmedia%5Ctake%201.wav');
  });
});

describe('live events (ADR 0069: dropped and counted, never thrown inside the callback)', () => {
  type Listener = (payload: unknown) => void;

  // A fresh module per test: the live-event counter is the client's own, and one test's drops must not degrade the next.
  async function subscribeTo(event: string) {
    vi.resetModules();
    const { wailsClient: client } = await import('./wailsClient');
    let listener: Listener | undefined;
    const eventsOn = vi.fn((name: string, callback: Listener) => {
      if (name === event) listener = callback;
      return () => {};
    });
    (window as unknown as { runtime: { EventsOnMultiple: typeof eventsOn } }).runtime = { EventsOnMultiple: eventsOn };
    const report = vi.fn().mockResolvedValue('null');
    window.go = { main: { Host: { SystemReportDiagnostic: report } } };
    return { client, emit: (payload: unknown) => listener?.(payload), report };
  }

  const transcript = { phase: 'running', percent: 10, message: 'Working', logs: [], chapters: [], rows: [], diff: '', summary: '', elapsed: 1 };
  const position = { type: 'position', read: 4, committed: 3, status: 'listening', jump: null, skipped: null };

  it('passes a valid transcript state on and keeps the marker export default', async () => {
    const { client, emit } = await subscribeTo('transcript:state');
    const update = vi.fn();
    client.subscribeTranscript(update);
    emit(transcript);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ phase: 'running', markerExport: { phase: 'idle', message: '', added: 0, skipped: 0 } }));
  });

  it('drops a malformed transcript state without throwing, and writes it to the host log', async () => {
    const { client, emit, report } = await subscribeTo('transcript:state');
    const update = vi.fn();
    client.subscribeTranscript(update);
    expect(() => emit({ ...transcript, percent: 'ten' })).not.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    const [kind, message] = report.mock.calls[0] as [string, string];
    expect(kind).toBe('wire_invalid');
    expect(message).toContain('host.event transcript:state');
    expect(message).toContain('percent');
  });

  it('tells the app once that live updates are degraded after a run of dropped events', async () => {
    const { client, emit } = await subscribeTo('teleprompter:event');
    const degraded = vi.fn();
    client.subscribeLiveUpdateHealth(degraded);
    client.subscribeTeleprompterEvent(vi.fn());
    for (let i = 0; i < 8; i += 1) emit({ ...position, read: 'x' });
    expect(degraded).toHaveBeenCalledTimes(1);
  });

  it('reads a teleprompter event sent as JSON text, as the transport may', async () => {
    const { client, emit } = await subscribeTo('teleprompter:event');
    const onEvent = vi.fn();
    client.subscribeTeleprompterEvent(onEvent);
    emit(JSON.stringify(position));
    expect(onEvent).toHaveBeenCalledWith(position);
  });

  it('ignores an event type it does not know without counting it as a failure', async () => {
    const { client, emit, report } = await subscribeTo('teleprompter:event');
    const onEvent = vi.fn();
    const degraded = vi.fn();
    client.subscribeLiveUpdateHealth(degraded);
    client.subscribeTeleprompterEvent(onEvent);
    for (let i = 0; i < 10; i += 1) emit({ type: 'latency', ms: 12 });
    expect(onEvent).not.toHaveBeenCalled();
    expect(degraded).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toBe('wire_unknown_event');
    expect(report.mock.calls[0]?.[1]).toContain('latency');
  });

  it('drops a value that is not an event at all', async () => {
    const { client, emit, report } = await subscribeTo('teleprompter:event');
    const onEvent = vi.fn();
    client.subscribeTeleprompterEvent(onEvent);
    emit(42);
    emit(null);
    emit('not json');
    expect(onEvent).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalled();
  });

  it('fills a partial teleprompter state and drops one with an unknown phase', async () => {
    const { client, emit } = await subscribeTo('teleprompter:state');
    const onState = vi.fn();
    client.subscribeTeleprompterState(onState);
    emit({ phase: 'running' });
    emit({ phase: 'paused' });
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledWith({ phase: 'running', message: '', engine: null, chapter: null, script: null, position: null });
  });

  it('drops a project-attach event with the wrong shape', async () => {
    const { client, emit } = await subscribeTo('system:attached');
    const update = vi.fn();
    client.subscribeProjectAttach(update);
    emit({ attached: 'yes' });
    emit({ attached: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ attached: true });
  });

  it('passes on a notice from the host and drops one with no text', async () => {
    const { client, emit } = await subscribeTo('system:notice');
    const onNotice = vi.fn();
    client.subscribeNotices(onNotice);
    emit({ text: 'Your settings file could not be read.' });
    emit({ message: 'wrong key' });
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith('Your settings file could not be read.');
  });

  it('reads the teleprompter state binding through the same schema', async () => {
    vi.resetModules();
    const { wailsClient: client } = await import('./wailsClient');
    window.go = {
      main: {
        Host: {
          TeleprompterState: () =>
            Promise.resolve(JSON.stringify({ phase: 'idle', message: 'Choose', engine: null, chapter: null, script: null, position: null })),
        },
      },
    };
    await expect(client.teleprompterState()).resolves.toMatchObject({ phase: 'idle', engine: null });
  });
});
