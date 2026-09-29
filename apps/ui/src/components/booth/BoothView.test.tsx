// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { CommandRouter, CommandScope } from '../../input/router';
import { BoothView } from './BoothView';
import { initialSession } from './readerModel';
import type { GuideEntity } from '../../types';
import type { FollowCursor } from './useFollowCursor';
import type { RecordInReaperState } from './useRecordInReaper';
import type { TeleprompterSession } from './useTeleprompterSession';

afterEach(cleanup);

function baseSession(overrides: Partial<TeleprompterSession> = {}): TeleprompterSession {
  return {
    host: { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null },
    paused: false,
    pause: vi.fn(),
    session: initialSession,
    device: '',
    devices: [],
    devicesError: null,
    devicesLoading: false,
    loadDevices: vi.fn(),
    model: 'tiny',
    changeModel: vi.fn(),
    engine: 'whisper',
    engines: [{ value: 'whisper', label: 'Whisper', title: 'OpenAI Whisper, run on this computer - the default' }],
    changeEngine: vi.fn(),
    paragraphs: undefined,
    rows: [],
    cursor: 0,
    active: false,
    status: '',
    error: '',
    prompt: undefined,
    modelInstall: {} as TeleprompterSession['modelInstall'],
    start: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    changeDevice: vi.fn(),
    closeModelPrompt: vi.fn(),
    startWord: null,
    setStartWord: vi.fn(),
    reset: vi.fn(),
    canStart: false,
    startReason: 'Choose a microphone first.',
    ...overrides,
  };
}

function followCursor(overrides: Partial<FollowCursor> = {}): FollowCursor {
  return { following: true, resume: vi.fn(), readerRef: { current: null }, ...overrides };
}

function fakeRecording(overrides: Partial<RecordInReaperState> = {}): RecordInReaperState {
  return {
    loaded: true,
    enabled: false,
    recording: false,
    armPending: false,
    confirmPending: false,
    toggle: vi.fn(),
    confirm: vi.fn(),
    cancelConfirm: vi.fn(),
    armOnly: vi.fn(async () => {}),
    beforeStart: vi.fn(async () => true),
    afterStop: vi.fn(),
    ...overrides,
  };
}

function boothElement(overrides: Partial<Parameters<typeof BoothView>[0]> = {}) {
  return (
    <MemoryRouter>
      <ApiProvider api={createMockApi()}>
        <CommandRouter>
          <CommandScope kind="booth">
            <BoothView
              session={baseSession()}
              follow={followCursor()}
              recording={fakeRecording()}
              rail={<div>Reading panel</div>}
              onExit={vi.fn()}
              {...overrides}
            />
          </CommandScope>
        </CommandRouter>
      </ApiProvider>
    </MemoryRouter>
  );
}

function renderBooth(overrides: Partial<Parameters<typeof BoothView>[0]> = {}) {
  return render(boothElement(overrides));
}

describe('BoothView (booth-mode-and-companion-panel.prd.md Phases 1-2; stage-navigation-and-page-replacement.prd.md Phase 4)', () => {
  it('lays out a named status region, the given rail as a complementary landmark, the script with no main landmark of its own, and a Booth commands region holding the reading controls', () => {
    renderBooth({ chapterTitle: 'Chapter 3' });
    expect(screen.getByRole('region', { name: 'Status' })).toBeTruthy();
    const rail = screen.getByRole('complementary', { name: 'Rail' });
    expect(within(rail).getByText('Reading panel')).toBeTruthy();
    // A route inside AppShell, whose own <main> holds the page: FocusShell's `asMain={false}` avoids a second one.
    expect(screen.queryByRole('main')).toBeNull();
    const commands = screen.getByRole('region', { name: 'Booth commands' });
    // The same command bar the read-aloud dialog had, so nothing it offered is lost: Play, Stop, the microphone and Settings.
    const bar = within(commands).getByRole('toolbar', { name: 'Reading controls' });
    for (const name of ['Play', 'Stop reading', 'Microphone: not chosen', 'Settings']) expect(within(bar).getByRole('button', { name })).toBeTruthy();
  });

  it('shows Ready while idle, Reading while listening, and REC · P&R while this app is recording', () => {
    const { rerender } = renderBooth({ session: baseSession({ active: false }) });
    const status = () => within(screen.getByRole('region', { name: 'Status' }));
    expect(status().getByText('Ready')).toBeTruthy();
    rerender(boothElement({ session: baseSession({ active: true, paused: false }) }));
    expect(status().getByText('Reading')).toBeTruthy();
    rerender(boothElement({ session: baseSession({ active: true, paused: false }), recording: fakeRecording({ recording: true }) }));
    expect(status().getByText('REC · P&R')).toBeTruthy();
  });

  it("shows a decorative input level meter in the status region, fed by the session's own level events", () => {
    renderBooth({ chapterTitle: 'Chapter 3' });
    const status = screen.getByRole('region', { name: 'Status' });
    // Decorative: no accessible `meter` role of its own, unlike the microphone popover's labelled meter.
    expect(within(status).queryAllByRole('meter')).toHaveLength(0);
    expect(within(status).getByText('Input')).toBeTruthy();
  });

  describe('the Room, Mic and DAW chips (mock 03, audit BO6/BO7)', () => {
    const chips = () => within(screen.getByRole('group', { name: 'Room, microphone and recorder' }));

    it('say only what the app knows: no room reading, no microphone chosen, REAPER not recording', () => {
      renderBooth();
      expect(chips().getByText('Room · not measured')).toBeTruthy();
      expect(chips().getByText('Mic · none chosen')).toBeTruthy();
      expect(chips().getByText('REAPER · not recording')).toBeTruthy();
    });

    it('name the chosen microphone and what Play does with REAPER', () => {
      const { rerender } = renderBooth({ session: baseSession({ device: 'USB mic' }), recording: fakeRecording({ enabled: true }) });
      expect(chips().getByText('Mic · USB mic')).toBeTruthy();
      expect(chips().getByText('REAPER · records with Play')).toBeTruthy();
      rerender(boothElement({ session: baseSession({ device: 'USB mic' }), recording: fakeRecording({ enabled: true, recording: true }) }));
      expect(chips().getByText('REAPER · recording')).toBeTruthy();
    });

    it("show the built-in recorder in REAPER's place", () => {
      const recorder = { builtin: true, recording: false } as unknown as Parameters<typeof BoothView>[0]['recorder'];
      renderBooth({ recorder });
      expect(chips().getByText('Built-in recorder')).toBeTruthy();
    });

    it('read the room from the input level while nothing is being read, and keep it once reading starts', () => {
      const handlers = new Set<(event: { type: 'level'; peak: number; rms: number }) => void>();
      const push = (event: { type: 'level'; peak: number; rms: number }) => handlers.forEach((handler) => handler(event));
      const api = {
        ...createMockApi(),
        subscribeTeleprompterEvent: (handler: Parameters<typeof handlers.add>[0]) => {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      } as unknown as ReturnType<typeof createMockApi>;
      const view = (active: boolean) => (
        <MemoryRouter>
          <ApiProvider api={api}>
            <CommandRouter>
              <CommandScope kind="booth">
                <BoothView
                  session={baseSession({ active })}
                  follow={followCursor()}
                  recording={fakeRecording()}
                  rail={<div>Reading panel</div>}
                  onExit={vi.fn()}
                />
              </CommandScope>
            </CommandRouter>
          </ApiProvider>
        </MemoryRouter>
      );
      const { rerender } = render(view(false));
      act(() => push({ type: 'level', peak: -50, rms: -64.1 }));
      expect(chips().getByText('Room -64.1 dB')).toBeTruthy();
      rerender(view(true));
      act(() => push({ type: 'level', peak: -6, rms: -18 }));
      expect(chips().getByText('Room -64.1 dB')).toBeTruthy();
    });
  });

  it('draws the text full-bleed, with no bordered card (audit BO3), and a speaker tag in the gutter of each attributed paragraph (BO4)', () => {
    const row = (key: string, text: string) => ({ key, kind: 'paragraph' as const, start: 0, words: null, gaps: null, text });
    const { container } = renderBooth({
      session: baseSession({ rows: [row('p1', 'Said the Mouse.'), row('p2', "'I beg your pardon,' said Alice.")] }),
      speakerLabels: new Map([['p2', 'Alice']]),
    });
    const text = screen.getByRole('region', { name: 'Chapter text' });
    expect(text.closest('section')).toBeNull();
    const tags = container.querySelectorAll('[data-speaker-tag]');
    expect([...tags].map((tag) => tag.textContent)).toEqual(['Alice']);
    expect(tags[0].parentElement?.nextElementSibling?.textContent).toContain('I beg your pardon');
  });

  it('lists what is coming up in the rail: each name, how to say it and its status, opening its Story Bible entry (audit BO8)', async () => {
    const onOpenSpeaker = vi.fn();
    const hatter = { id: 'hatter', canonical_name: 'Hatter', aliases: [], category: 'Character' } as unknown as GuideEntity;
    renderBooth({
      speakers: [],
      onOpenSpeaker,
      comingUp: [
        { key: 'hatter', text: 'Hatter', entity: hatter, pronunciation: { ipa: '/ˈhætər/', source: 'cmu', confidence: '', status: 'author_confirmed' } },
      ],
    });
    const section = screen.getByRole('region', { name: 'Coming up' });
    expect(section.textContent).toContain('/ˈhætər/ · Author confirmed');
    fireEvent.click(within(section).getByRole('button', { name: 'Hatter: open in the Story bible' }));
    expect(onOpenSpeaker).toHaveBeenCalledWith(hatter);
  });

  it('draws no Coming up section when no name ahead has a pronunciation', () => {
    renderBooth({ speakers: [], comingUp: [] });
    expect(screen.queryByRole('region', { name: 'Coming up' })).toBeNull();
  });

  it("shows the chapter title and mock 03's progress in the status region: paragraph, share and finished time left", () => {
    const row = (key: string, start: number) => ({ key, kind: 'paragraph' as const, start, words: null, gaps: null, text: '' });
    renderBooth({
      chapterTitle: 'Chapter 3',
      session: baseSession({
        rows: [{ key: 'title', kind: 'title', start: 0, words: null, gaps: null, text: 'Chapter 3' }, row('p1', 2), row('p2', 30), row('p3', 60)],
        session: { ...initialSession, script: { type: 'script', chapter: { id: 'c1', title: 'Chapter 3' }, tokens: 1240, spans: [] }, cursor: 40 },
      }),
    });
    const status = screen.getByRole('region', { name: 'Status' });
    expect(within(status).getByText('Chapter 3')).toBeTruthy();
    // 1,200 words left at 9,300 finished words an hour is 7 min 44.5 s.
    expect(status.textContent).toContain('¶ 2 of 3 · 3% · ~7:45 finished left');
  });

  it('offers Companion and Exit booth (Esc) in the header', async () => {
    const user = userEvent.setup();
    const onCompanion = vi.fn();
    const onExit = vi.fn();
    renderBooth({ onCompanion, onExit });
    const status = screen.getByRole('region', { name: 'Status' });
    await user.click(within(status).getByRole('button', { name: 'Companion' }));
    expect(onCompanion).toHaveBeenCalledTimes(1);
    const exit = within(status).getByRole('button', { name: /Exit booth/ });
    expect(within(exit).getByRole('img', { name: 'Esc' })).toBeTruthy();
    await user.click(exit);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows the pre-session setup above the text only while no session runs', () => {
    const { rerender } = renderBooth({ setup: <p>Choose a chapter</p> });
    expect(screen.getByText('Choose a chapter')).toBeTruthy();
    rerender(boothElement({ setup: <p>Choose a chapter</p>, session: baseSession({ active: true }) }));
    expect(screen.queryByText('Choose a chapter')).toBeNull();
  });

  it("the command bar's Play arms REAPER first, then starts, and Stop stops both", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const beforeStart = vi.fn(async () => true);
    const { rerender } = renderBooth({ session: baseSession({ canStart: true, start }), recording: fakeRecording({ beforeStart }) });
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(beforeStart).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();

    const stop = vi.fn();
    const afterStop = vi.fn();
    rerender(boothElement({ session: baseSession({ active: true, stop }), recording: fakeRecording({ afterStop }) }));
    await user.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(stop).toHaveBeenCalled();
    expect(afterStop).toHaveBeenCalled();
  });
});

function speaker(id: string, canonical_name: string, category = 'Character'): GuideEntity {
  return {
    id,
    canonical_name,
    aliases: [],
    category,
    occurrences: [],
    occurrence_count: 1,
    pronunciation: { ipa: '', source: 'manual', confidence: 'high' },
    description: { text: '', evidence: {} },
    personality_notes: [],
    relationships: [],
    properties: [],
    locked: false,
    review_state: 'approved',
  };
}

describe('BoothView speaker rail (booth-mode-and-companion-panel.prd.md Phase 3)', () => {
  it('lists the characters in this chapter as Highlight speaker tags, above the reading panel, skipping other categories', () => {
    renderBooth({ chapterId: 'chapter-1', speakers: [speaker('e1', 'Alice'), speaker('e2', 'Wonderland', 'Place'), speaker('e3', 'The Caterpillar')] });
    const rail = screen.getByRole('complementary', { name: 'Rail' });
    const section = within(rail).getByRole('region', { name: 'Voices in scene' });
    const tags = within(section)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(tags).toEqual(['Alice', 'The Caterpillar']);
    // The existing Story Bible character colour, not a new one.
    expect(section.querySelectorAll('[data-highlight="Character"]')).toHaveLength(2);
    expect(section.querySelector('[data-highlight="Place"]')).toBeNull();
    // Above the reading panel, so it reads first in the rail.
    expect(section.compareDocumentPosition(within(rail).getByText('Reading panel')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens a speaker in the Story bible when its tag is activated', async () => {
    const user = userEvent.setup();
    const onOpenSpeaker = vi.fn();
    const alice = speaker('e1', 'Alice');
    renderBooth({ chapterId: 'chapter-1', speakers: [alice], onOpenSpeaker });
    await user.click(screen.getByRole('button', { name: 'Alice: open in the Story bible' }));
    expect(onOpenSpeaker).toHaveBeenCalledWith(alice);
  });

  it('shows an honest "Reference clips coming soon" placeholder rather than a clip player', () => {
    renderBooth({ chapterId: 'chapter-1', speakers: [speaker('e1', 'Alice')] });
    const section = screen.getByRole('region', { name: 'Voices in scene' });
    expect(within(section).getByText('Reference clips coming soon')).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /play/i })).toBeNull();
  });

  it('says so when no character is tagged in this chapter', () => {
    renderBooth({ chapterId: 'chapter-1', speakers: [speaker('e2', 'Wonderland', 'Place')] });
    const section = screen.getByRole('region', { name: 'Voices in scene' });
    expect(within(section).getByText('No Story Bible characters are mentioned in this chapter.')).toBeTruthy();
    expect(within(section).queryByRole('list')).toBeNull();
  });

  it('has no speaker section in credits mode (no chapter, so no Story Bible marks)', () => {
    renderBooth({ speakers: undefined });
    expect(screen.queryByRole('region', { name: 'Voices in scene' })).toBeNull();
  });
});
