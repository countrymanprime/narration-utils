import { describe, expect, it } from 'vitest';
import { parseWire } from '../wire/parseWire';
import { WireError } from '../wire/WireError';
import { bootstrapSchema, readySchema } from './system';
import { voidResult } from './base';

const ctx = { boundary: 'host.binding', payload: 'Bootstrap' };

const idleTranscript = {
  runId: null,
  phase: 'idle',
  percent: 0,
  message: 'Select a track in REAPER, then start a comparison.',
  logs: [],
  chapters: [],
  rows: [],
  diff: '',
  summary: '',
  trackName: null,
  audioItemCount: null,
  completedAt: null,
  markerExport: { phase: 'idle', message: '', added: 0, skipped: 0 },
  elapsed: 0,
};

const bootstrap = {
  apiVersion: 6,
  diagnosticId: 'go-1',
  version: '0.2.7',
  projectFolder: 'C:/Projects/Alice',
  projectName: 'Alice',
  daw: 'reaper',
  manuscript: { id: 'm1', format: 'docx', sourceName: 'alice.docx', importedAt: '2026-09-01T00:00:00Z', narratableWordCount: 10, narratableChapterCount: 1 },
  manuscriptCandidate: null,
  runtime: { Reaper: { launcherPath: '' } },
  transcript: idleTranscript,
};

describe('readySchema', () => {
  it('needs only an apiVersion, so a host from another release reports a version problem and not an invalid payload', () => {
    expect(parseWire(readySchema, { apiVersion: 99 }, { boundary: 'host.binding', payload: 'Ready' })).toEqual({ apiVersion: 99, diagnosticId: '' });
  });

  it('rejects a Ready with no apiVersion', () => {
    expect(() => parseWire(readySchema, { diagnosticId: 'x' }, { boundary: 'host.binding', payload: 'Ready' })).toThrow(WireError);
  });
});

describe('bootstrapSchema', () => {
  it('accepts the payload the Go host builds, including nulls for unset transcript fields', () => {
    const parsed = parseWire(bootstrapSchema, bootstrap, ctx);
    expect(parsed.transcript.runId).toBeUndefined();
    expect(parsed.transcript.trackName).toBeUndefined();
    expect(parsed.manuscriptCandidate).toBeNull();
    expect(parsed.manuscript?.narratableWordCount).toBe(10);
    expect(parsed.version).toBe('0.2.7');
  });

  it('needs the application version, which every host of this API version sends', () => {
    const withoutVersion = Object.fromEntries(Object.entries(bootstrap).filter(([key]) => key !== 'version'));
    expect(() => parseWire(bootstrapSchema, withoutVersion, ctx)).toThrow(WireError);
    expect(() => parseWire(bootstrapSchema, { ...bootstrap, version: 7 }, ctx)).toThrow(WireError);
  });

  it('fills the marker export a snapshot saved by an older host lacks', () => {
    const older = Object.fromEntries(Object.entries(idleTranscript).filter(([key]) => key !== 'markerExport'));
    expect(parseWire(bootstrapSchema, { ...bootstrap, transcript: older }, ctx).transcript.markerExport).toEqual({
      phase: 'idle',
      message: '',
      added: 0,
      skipped: 0,
    });
  });

  it('keeps a completed run with its rows', () => {
    const row = {
      id: 'r1',
      kind: 'MISREAD',
      name: 'Ch1',
      docText: 'said',
      audioText: 'sad',
      projectTime: 1.5,
      itemIndex: 0,
      srcpos: 0.5,
      chapter: 'Chapter 1',
      paragraph: 3,
      scriptContext: 'a',
      audioContext: 'b',
      markerState: 'pending',
      existingMarkerName: '',
    };
    const parsed = parseWire(bootstrapSchema, { ...bootstrap, transcript: { ...idleTranscript, runId: 'run-1', phase: 'success', rows: [row] } }, ctx);
    expect(parsed.transcript.runId).toBe('run-1');
    expect(parsed.transcript.rows[0]?.markerState).toBe('pending');
  });

  it.each([
    ['a projectName that is a number', { ...bootstrap, projectName: 42 }, 'projectName'],
    ['a manuscript missing a field', { ...bootstrap, manuscript: { id: 'm1' } }, 'manuscript.format'],
    ['a transcript phase the UI does not know', { ...bootstrap, transcript: { ...idleTranscript, phase: 'paused' } }, 'transcript.phase'],
    ['a row with a bad marker state', { ...bootstrap, transcript: { ...idleTranscript, rows: [{ id: 'r' }] } }, 'transcript.rows[0].kind'],
    ['runtime that is not a two-level map', { ...bootstrap, runtime: { Reaper: 'x' } }, 'runtime.Reaper'],
  ])('rejects %s and names the path', (_name, payload, path) => {
    try {
      parseWire(bootstrapSchema, payload, ctx);
      expect.unreachable();
    } catch (error) {
      expect((error as WireError).issues.map((issue) => issue.path)).toContain(path);
    }
  });
});

describe('voidResult', () => {
  it('accepts the null the host sends for a binding that returns nothing, and nothing else', () => {
    expect(parseWire(voidResult, null, { boundary: 'host.binding', payload: 'TranscriptCancel' })).toBeUndefined();
    expect(() => parseWire(voidResult, { ok: true }, { boundary: 'host.binding', payload: 'TranscriptCancel' })).toThrow(WireError);
  });
});
