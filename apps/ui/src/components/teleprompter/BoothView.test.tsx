// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { CommandRouter, CommandScope } from '../../input/router';
import { boothIsActive } from './boothActive';
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

function renderBooth(overrides: Partial<Parameters<typeof BoothView>[0]> = {}) {
  const api = createMockApi();
  return render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <CommandRouter>
          <CommandScope kind="booth">
            <BoothView session={baseSession()} follow={followCursor()} recording={fakeRecording()} rail={<div>Reading panel</div>} {...overrides} />
          </CommandScope>
        </CommandRouter>
      </ApiProvider>
    </MemoryRouter>,
  );
}

describe('BoothView (booth-mode-and-companion-panel.prd.md Phase 1, Phase 2)', () => {
  it('lays out a named status region, the given rail as a complementary landmark, the script with no main landmark of its own, and a named Booth commands toolbar', () => {
    renderBooth({ chapterTitle: 'Chapter 3' });
    expect(screen.getByRole('region', { name: 'Status' })).toBeTruthy();
    const rail = screen.getByRole('complementary', { name: 'Rail' });
    expect(within(rail).getByText('Reading panel')).toBeTruthy();
    // Always mounted inside ReadAloudDialog's Dialog, whose page behind it keeps its own <main> in the accessibility
    // tree (a live region there stays announced): FocusShell's `asMain={false}` here avoids a second one.
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Booth commands' })).toBeTruthy();
  });

  it('shows Ready while idle, Reading while listening, and REC · P&R while this app is recording', () => {
    const { rerender } = renderBooth({ session: baseSession({ active: false }) });
    expect(screen.getByText('Ready')).toBeTruthy();

    rerender(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <CommandScope kind="booth">
              <BoothView session={baseSession({ active: true, paused: false })} follow={followCursor()} recording={fakeRecording()} rail={<div />} />
            </CommandScope>
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Reading')).toBeTruthy();

    rerender(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <CommandScope kind="booth">
              <BoothView
                session={baseSession({ active: true, paused: false })}
                follow={followCursor()}
                recording={fakeRecording({ recording: true })}
                rail={<div />}
              />
            </CommandScope>
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('REC · P&R')).toBeTruthy();
  });

  it('shows a decorative room level meter in the status region, fed by the same mic-level channel as the microphone popover (Phase 4)', () => {
    renderBooth({ chapterTitle: 'Chapter 3' });
    const status = screen.getByRole('region', { name: 'Status' });
    const meters = within(status).queryAllByRole('meter');
    // Decorative: no accessible `meter` role of its own, unlike the microphone popover's own labelled meter (which is
    // not mounted here since the popover starts closed).
    expect(meters).toHaveLength(0);
    expect(within(status).getByText('Room')).toBeTruthy();
  });

  it('shows the chapter title and word progress in the status region', () => {
    renderBooth({
      chapterTitle: 'Chapter 3',
      session: baseSession({
        session: { ...initialSession, script: { type: 'script', chapter: { id: 'c1', title: 'Chapter 3' }, tokens: 120, spans: [] }, cursor: 40 },
      }),
    });
    expect(screen.getByText('Chapter 3')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Status' }).textContent).toContain('40 of 120 words');
  });

  it('the Toolbar Play/Pause button is Kbd-labelled Space and calls the same handler reading.toggle would', async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const beforeStart = vi.fn(async () => true);
    renderBooth({ session: baseSession({ canStart: true, start }), recording: fakeRecording({ beforeStart }) });
    const toolbar = screen.getByRole('toolbar', { name: 'Booth commands' });
    const play = within(toolbar).getByRole('button', { name: 'Play' });
    expect(within(play).getByRole('img', { name: 'Space' })).toBeTruthy();
    await user.click(play);
    expect(beforeStart).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('Stop reading is disabled while idle and calls stop and afterStop once active', async () => {
    const user = userEvent.setup();
    const stop = vi.fn();
    const afterStop = vi.fn();
    const { rerender } = renderBooth({ session: baseSession({ active: false }) });
    expect(screen.getByRole('button', { name: 'Stop reading' }).hasAttribute('disabled')).toBe(true);

    rerender(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <CommandScope kind="booth">
              <BoothView session={baseSession({ active: true, stop })} follow={followCursor()} recording={fakeRecording({ afterStop })} rail={<div />} />
            </CommandScope>
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(stop).toHaveBeenCalled();
    expect(afterStop).toHaveBeenCalled();
  });

  it('shows Follow only during a session, disabled while following', () => {
    const { rerender } = renderBooth({ session: baseSession({ active: false }) });
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();

    rerender(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <CommandScope kind="booth">
              <BoothView session={baseSession({ active: true })} follow={followCursor({ following: true })} recording={fakeRecording()} rail={<div />} />
            </CommandScope>
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Follow' }).hasAttribute('disabled')).toBe(true);
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

describe('BoothView marks itself active for useBoothRecording (booth-mode-and-companion-panel.prd.md Phase 5)', () => {
  it('is active only while mounted', () => {
    expect(boothIsActive()).toBe(false);
    const { unmount } = renderBooth();
    expect(boothIsActive()).toBe(true);
    unmount();
    expect(boothIsActive()).toBe(false);
  });
});
