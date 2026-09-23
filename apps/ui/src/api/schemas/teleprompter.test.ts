import { describe, expect, it } from 'vitest';
import recording from '../teleprompterRecording.json';
import { parseWire } from '../wire/parseWire';
import { WireError } from '../wire/WireError';
import { TELEPROMPTER_EVENT_TYPES, teleprompterEventSchema, teleprompterStateSchema } from './teleprompter';

const ctx = { boundary: 'host.event', payload: 'teleprompter:event' };

const script = {
  type: 'script',
  chapter: { id: 'c1', title: 'One' },
  tokens: 6,
  spans: [
    { kind: 'title', id: 'c1', index: null, start: 0, count: 1 },
    { kind: 'paragraph', id: 'p1', index: 0, start: 1, count: 5 },
  ],
};
const position = { type: 'position', read: 12, committed: 10, status: 'listening', jump: null, skipped: null };

describe('teleprompterEventSchema', () => {
  it.each([
    ['script', script],
    ['position', position],
    ['a position that skipped', { ...position, jump: 'skip', skipped: [3, 9] }],
    ['partial', { type: 'partial', segment: 0, words: [{ word: 'hello', start: 1.24, end: 1.51 }] }],
    ['word', { type: 'word', segment: 0, word: 'hello', start: 1.24, end: 1.51 }],
    ['segment_end', { type: 'segment_end', segment: 0 }],
    ['misread flag', { type: 'flag', id: 1, kind: 'misread', start: 7, end: 8, heard: 'chairs' }],
    ['zero-width extra flag', { type: 'flag', id: 2, kind: 'extra', start: 4, end: 4, heard: 'slowly' }],
    ['skipped flag', { type: 'flag', id: 3, kind: 'skipped', start: 10, end: 22, heard: '' }],
    ['restart flag', { type: 'flag', id: 4, kind: 'restart', start: 24, end: 29, heard: 'at sea a small boat' }],
  ])('accepts a %s event', (_name, event) => {
    expect(parseWire(teleprompterEventSchema, event, ctx)).toEqual(event);
  });

  it('accepts every event of the stream recorded from the real ScriptTracker', () => {
    expect(recording.events.length).toBeGreaterThan(100);
    for (const { event } of recording.events) expect(() => parseWire(teleprompterEventSchema, event, ctx)).not.toThrow();
  });

  it('validates the recorded stream at a cost that is nothing next to the event rate (ADR 0069, rule 10)', () => {
    // Measured 2026-09-21 in Node: about 0.05 microseconds per recorded event and about 1.4 for a 30-word partial. The budget here is
    // four orders of magnitude looser, so it only fails if validation becomes a real cost, never on a slow runner.
    const events = recording.events.map((entry) => entry.event);
    const passes = 20;
    const started = performance.now();
    for (let pass = 0; pass < passes; pass += 1) for (const event of events) parseWire(teleprompterEventSchema, event, ctx);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it.each([
    ['a position with a string read index', { ...position, read: '12' }, 'read'],
    ['a position with an unknown status', { ...position, status: 'paused' }, 'status'],
    ['a word with no timing', { type: 'word', segment: 0, word: 'hello' }, 'start'],
    ['a partial whose words are not a list', { type: 'partial', segment: 0, words: 'hello' }, 'words'],
    ['a script span with a bad kind', { ...script, spans: [{ kind: 'heading', id: 'x', index: 0, start: 0, count: 1 }] }, 'spans[0].kind'],
    ['a flag of a kind the UI does not know', { type: 'flag', id: 1, kind: 'mumbled', start: 1, end: 2, heard: 'x' }, 'kind'],
    ['a flag that ends before it starts', { type: 'flag', id: 1, kind: 'misread', start: 5, end: 4, heard: 'x' }, 'end'],
    ['a flag with no heard text', { type: 'flag', id: 1, kind: 'skipped', start: 1, end: 2 }, 'heard'],
  ])('rejects %s and names the path', (_name, event, path) => {
    try {
      parseWire(teleprompterEventSchema, event, ctx);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WireError);
      expect((error as WireError).issues.map((issue) => issue.path)).toContain(path);
    }
  });

  it('lists the event types the UI understands, so an unknown one can be told from a malformed one', () => {
    expect([...TELEPROMPTER_EVENT_TYPES].sort()).toEqual(['flag', 'partial', 'position', 'script', 'segment_end', 'word']);
  });
});

describe('teleprompterStateSchema', () => {
  it('fills what a partial snapshot leaves out with the idle state', () => {
    expect(parseWire(teleprompterStateSchema, { phase: 'running' }, { boundary: 'host.event', payload: 'teleprompter:state' })).toEqual({
      phase: 'running',
      message: '',
      engine: null,
      chapter: null,
      script: null,
      position: null,
    });
  });

  it('accepts the snapshot the host builds mid-session, with the script and position events inside', () => {
    const snapshot = { phase: 'running', message: 'Listening…', engine: 'whisper', chapter: 'c1', script, position };
    expect(parseWire(teleprompterStateSchema, snapshot, { boundary: 'host.event', payload: 'teleprompter:state' })).toEqual(snapshot);
  });

  it('rejects a phase the UI does not know', () => {
    expect(() => parseWire(teleprompterStateSchema, { phase: 'paused' }, { boundary: 'host.event', payload: 'teleprompter:state' })).toThrow(WireError);
  });
});
