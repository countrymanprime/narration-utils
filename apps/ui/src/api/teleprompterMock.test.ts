import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTeleprompterMock } from './teleprompterMock';
import { tokenize } from '../components/teleprompter/readerModel';
import type { ManuscriptChapter, ManuscriptParagraph, TeleprompterEvent, TeleprompterState } from '../types';

const DEVICES = [{ name: 'Microphone Array (Realtek(R) Audio)' }, { name: 'Headset Microphone (USB Audio Device)' }];

const chapters: ManuscriptChapter[] = [
  { id: 'chapter-1', title: 'CHAPTER I', subtitle: 'Down the Rabbit-Hole', index: 0, wordCount: 120, status: 'recording' },
];
const sentence = 'Alice was beginning to get very tired of sitting by her sister on the bank';
const paragraphs: ManuscriptParagraph[] = [
  { id: 'p-1', chapterId: 'chapter-1', chapter: 'CHAPTER I', index: 0, text: sentence, entityIds: [] },
  { id: 'p-2', chapterId: 'chapter-1', chapter: 'CHAPTER I', index: 1, text: sentence, entityIds: [] },
];
const options = { chapter: 'chapter-1', device: 'Microphone (USB)' };

function build(overrides: Partial<Parameters<typeof createTeleprompterMock>[0]> = {}) {
  return createTeleprompterMock({
    ready: Promise.resolve(),
    chapters: () => chapters,
    paragraphs: () => paragraphs,
    assetRequired: () => undefined,
    devices: DEVICES,
    ...overrides,
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('teleprompter mock', () => {
  it('describes the chapter first, then replays the recorded read-through to the end', async () => {
    const mock = build();
    const events: TeleprompterEvent[] = [];
    const states: TeleprompterState[] = [];
    mock.subscribeTeleprompterEvent((event) => events.push(event));
    mock.subscribeTeleprompterState((state) => states.push(state));

    await expect(mock.teleprompterStart(options)).resolves.toEqual({ status: 'started' });
    await vi.runAllTimersAsync();

    const script = events[0];
    if (script.type !== 'script') throw new Error('the script event must come first');
    const words =
      tokenize(`${chapters[0].title} ${chapters[0].subtitle}`).length + paragraphs.reduce((total, paragraph) => total + tokenize(paragraph.text).length, 0);
    expect(script.tokens).toBe(words);
    expect(script.spans.map((span) => [span.kind, span.start, span.count])).toEqual([
      ['title', 0, 5],
      ['paragraph', 5, 15],
      ['paragraph', 20, 15],
    ]);
    const positions = events.flatMap((event) => (event.type === 'position' ? [event] : []));
    expect(positions.at(-1)).toMatchObject({ read: words, status: 'done' });
    expect(positions.some((position) => position.status === 'waiting')).toBe(true);
    expect(states.map((state) => state.phase)).toEqual(['starting', 'running']);
  });

  it('shows what was just heard while it reads', async () => {
    const mock = build();
    const events: TeleprompterEvent[] = [];
    mock.subscribeTeleprompterEvent((event) => events.push(event));

    await mock.teleprompterStart(options);
    await vi.runAllTimersAsync();

    const heard = events.flatMap((event) => (event.type === 'partial' ? [event.words.map((word) => word.word).join(' ')] : []));
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.every((text) => text.length > 0)).toBe(true);
  });

  it('stops replaying when asked to stop', async () => {
    const mock = build();
    const events: TeleprompterEvent[] = [];
    const states: TeleprompterState[] = [];
    mock.subscribeTeleprompterEvent((event) => events.push(event));
    mock.subscribeTeleprompterState((state) => states.push(state));
    await mock.teleprompterStart(options);
    await vi.advanceTimersByTimeAsync(1500);
    const seen = events.length;

    await mock.teleprompterStop();
    await vi.runAllTimersAsync();

    expect(events).toHaveLength(seen);
    expect(states.at(-1)?.phase).toBe('stopped');
    expect((await mock.teleprompterState()).phase).toBe('stopped');
  });

  it('asks for the model first when it is not installed', async () => {
    const needed = {
      status: 'asset_required' as const,
      model: { id: 'tiny' } as never,
      installState: 'not_installed' as const,
      downloadSize: 1,
      diskSize: 1,
      installPath: 'C:/assets/whisper',
    };
    const mock = build({ assetRequired: () => needed });

    await expect(mock.teleprompterStart(options)).resolves.toBe(needed);
    expect((await mock.teleprompterState()).phase).toBe('idle');
  });

  it('refuses an unknown chapter', async () => {
    await expect(build().teleprompterStart({ ...options, chapter: 'chapter-99' })).rejects.toThrow(/chapter/i);
  });

  it('refuses to start without a microphone', async () => {
    await expect(build().teleprompterStart({ ...options, device: ' ' })).rejects.toThrow(/microphone/i);
  });

  it('gives every concurrent first caller the seeded session', async () => {
    const mock = build({ seed: 'listening' });

    const [first, second] = await Promise.all([mock.teleprompterState(), mock.teleprompterState()]);

    expect([first.phase, second.phase]).toEqual(['running', 'running']);
  });

  it('reports the configured device list, and an empty one for the no-devices fallback', async () => {
    await expect(build().teleprompterDevices()).resolves.toEqual({ devices: DEVICES, error: null });
    await expect(build({ devices: [] }).teleprompterDevices()).resolves.toEqual({ devices: [], error: null });
  });

  it.each(['listening', 'waiting', 'done'] as const)('can boot mid-session in the %s state', async (seed) => {
    const mock = build({ seed });

    const state = await mock.teleprompterState();

    expect(state.phase).toBe('running');
    expect(state.script?.chapter.id).toBe('chapter-1');
    expect(state.position?.status).toBe(seed);
    if (seed === 'done') expect(state.position?.read).toBe(state.script?.tokens);
    else expect(state.position?.read).toBeGreaterThan(0);
  });
});
