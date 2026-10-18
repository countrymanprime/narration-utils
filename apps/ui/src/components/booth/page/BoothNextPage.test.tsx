// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

const host = vi.hoisted(() => ({ toggleFullscreen: vi.fn(async () => true), exitFullscreen: vi.fn(async () => {}) }));
vi.mock('../../../api/hostWindow', () => host);

import type { Bookmark } from '../../../api/contracts/bookmarks';
import type { DawCapabilities, DawResult } from '../../../api/contracts/daw';
import type { ManuscriptChapter } from '../../../api/contracts/manuscript';
import type { Mark, Marks } from '../../../api/contracts/marks';
import type { PickupItem, PickupList } from '../../../api/contracts/pickups';
import { DAW_SETUPS, type DawSetupId } from '../../../fixtures/daw';
import { createOverlayService } from '../../../overlay/overlayService';
import { createMockDawClient, type DawClient } from '../../../ports/daw';
import type { MeasurementsPort } from '../../../ports/measurements';
import { createMockMeasurements } from '../../../ports/measurements';
import { PortOverrides } from '../../../ports/usePort';
import type { GuideDialogueCue } from '../../../api/contracts/storyBible';
import type { TeleprompterEvent } from '../../../api/contracts/teleprompter';
import type { NarrationApi, TeleprompterState } from '../../../types';
import { TEXT_PREFS_STORAGE_KEY } from '../../script/page/tools/text/readerText';
import { BoothNextPage } from './BoothNextPage';
import { BOOTH_SIZE_STORAGE_KEY } from './useTextChoices';
import { BoothHost, dawFor, LOCATED, newJournal, pageApi } from './testPage';
import { forgetAppTake } from '../record/useRecordControl';

// A take one test leaves running is not the next test's.
beforeEach(() => forgetAppTake());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  window.localStorage.clear();
});

type Options = {
  setup?: DawSetupId;
  daw?: DawClient;
  search?: string;
  api?: Partial<NarrationApi>;
  hasManuscript?: boolean;
  measurements?: MeasurementsPort;
};

/** A DAW that records but whose roll replaces audio: it asks first (the mock's Audacity without backups). */
const destructive = (): DawClient => {
  const base = DAW_SETUPS.reaper;
  const setup: DawCapabilities = {
    ...base,
    daw: 'Audacity',
    capabilities: { ...base.capabilities, punch: { level: 'experimental' as const, available: true, destructive: true } },
  };
  return createMockDawClient(setup, { chapterIds: ['c1'], candidateIds: [], findingIds: [] });
};

function spied(daw: DawClient) {
  return {
    ...daw,
    recordStart: vi.fn(daw.recordStart),
    recordStop: vi.fn(daw.recordStop),
    roll: vi.fn(daw.roll),
  };
}

function renderPage({ setup = 'reaper', daw: given, search, api: over = {}, hasManuscript = true, measurements }: Options = {}) {
  const passageMapRecordRun = vi.fn(async () => {});
  const teleprompterStop = vi.fn(async () => {});
  const api = pageApi({ passageMapRecordRun, teleprompterStop, ...over } as Partial<NarrationApi>);
  const daw = spied(given ?? dawFor(setup));
  const journal = newJournal();
  const overlay = createOverlayService();
  const navigate = vi.fn();
  const view = render(
    <BoothHost api={api} daw={daw} journal={journal} overlay={overlay} search={search}>
      <PortOverrides clients={measurements ? { daw, measurements } : { daw }}>
        <BoothNextPage hasManuscript={hasManuscript} navigate={navigate} />
      </PortOverrides>
      <Driver />
    </BoothHost>,
  );
  const dialog = () =>
    overlay.getSnapshot().dialogs[0] as { spec: { title: string; body: string; confirmLabel: string }; answer: (yes: boolean) => void } | undefined;
  return { view, daw, journal, overlay, navigate, dialog, passageMapRecordRun, teleprompterStop };
}

/** The router, from inside it: what the address is and a way to change it, as a link elsewhere in the app would. */
const driver = { go: (_to: string): void => undefined, search: (): string => '' };
function Driver() {
  const navigateTo = useNavigate();
  const location = useLocation();
  driver.go = (to) => void navigateTo(to);
  driver.search = () => location.search;
  return null;
}

const press = (key: string, code = key, init: KeyboardEventInit = {}, target: Element = document.body) =>
  act(() => {
    fireEvent.keyDown(target, { key, code, ...init });
  });
const space = () => press(' ', 'Space');
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const ready = async () => {
  await screen.findByText('Nobody', { exact: false });
  await waitFor(() => expect((screen.getByRole('button', { name: /^Record$/ }) as HTMLButtonElement).disabled).toBe(false));
};
const record = async (page: ReturnType<typeof renderPage>) => {
  await ready();
  await space();
  await waitFor(() => expect(screen.getByRole('button', { name: /^Stop$/ })).toBeTruthy());
  expect(page.daw.recordStart).toHaveBeenCalledTimes(1);
};
const current = () => document.querySelector<HTMLElement>('[data-state="cur"]')?.dataset.unit;

describe('the-page-asks-for-a-manuscript-first', () => {
  it('asks for a manuscript when there is none', () => {
    renderPage({ hasManuscript: false });
    expect(screen.getByText('This project has no manuscript yet. Import one to begin.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Record$/ })).toBeNull();
  });
});

describe('record-waits-for-the-live-model', () => {
  it('asks for the missing model first and records nothing while it is asked', async () => {
    const assetsList = vi.fn(async () => ({
      cacheRoot: 'C:/cache',
      totalInstalledBytes: 0,
      assets: [
        {
          kind: 'whisper',
          kindLabel: 'Whisper model',
          id: 'tiny',
          displayName: 'Whisper tiny',
          version: '1',
          publisher: 'p',
          license: 'MIT',
          licenseUrl: 'https://example.test/l',
          modelCardUrl: 'https://example.test/m',
          provenanceUrl: 'https://example.test/p',
          attribution: 'a',
          downloadSize: 78_000_000,
          diskSize: 80_000_000,
          installState: 'not_installed' as const,
          path: 'C:/models',
          installedAt: '',
          verifiedAt: '',
          activeJobId: '',
        },
      ],
    }));
    const page = renderPage({ api: { assetsList } as Partial<NarrationApi> });
    await ready();
    await space();
    await settle();
    await waitFor(() => expect(assetsList).toHaveBeenCalled());
    await settle();
    expect(page.daw.recordStart).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Stop$/ })).toBeNull();
  });
});

describe('space-records-and-stops-and-nothing-else-records', () => {
  it('Space records and stops through the Record control', async () => {
    const page = renderPage();
    await record(page);
    expect(page.daw.recordStart).toHaveBeenCalledWith('c1');
    expect(screen.getByText('REC')).toBeTruthy();
    await space();
    await waitFor(() => expect(page.daw.recordStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(page.passageMapRecordRun).toHaveBeenCalledTimes(1));
    expect(page.passageMapRecordRun.mock.calls[0]).toMatchObject(['c1', [{ kind: 'start', pid: 'p1' }, { kind: 'stop' }]]);
  });

  it('a pedal only starts and stops: no other key records, rolls or flags', async () => {
    const page = renderPage();
    await ready();
    for (const [key, code] of [
      ['r', 'KeyR'],
      ['f', 'KeyF'],
      ['p', 'KeyP'],
      ['Enter', 'Enter'],
      ['ArrowDown', 'ArrowDown'],
      ['n', 'KeyN'],
    ])
      await press(key, code);
    await settle();
    expect(page.daw.recordStart).not.toHaveBeenCalled();
    expect(page.daw.roll).not.toHaveBeenCalled();
    // A USB pedal set to Space is a keyboard Space: the one recording key.
    await space();
    await waitFor(() => expect(page.daw.recordStart).toHaveBeenCalledTimes(1));
  });

  it('a refused precondition says why and starts nothing', async () => {
    const page = renderPage({ setup: 'reaper-off' });
    await screen.findByText('Nobody', { exact: false });
    const button = await screen.findByRole('button', { name: /^Record$/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(button.getAttribute('aria-describedby')).toBe('brec-why');
    await space();
    expect(page.daw.recordStart).not.toHaveBeenCalled();
  });
});

describe('every-way-out-asks-while-recording', () => {
  it('Escape asks "Stop recording?"; Escape again with the question open answers it, Keep recording, and the take goes on', async () => {
    const page = renderPage();
    await record(page);
    await press('Escape');
    expect(page.overlay.getSnapshot().dialogs).toHaveLength(1);
    await press('Escape');
    await settle();
    expect(page.overlay.getSnapshot().dialogs).toHaveLength(0);
    expect(page.daw.recordStop).not.toHaveBeenCalled();
    expect(screen.getByText('REC')).toBeTruthy();
  });

  it('Escape asks "Stop recording?" once; Keep recording changes nothing', async () => {
    const page = renderPage();
    await record(page);
    await press('Escape');
    expect(page.overlay.getSnapshot().dialogs).toHaveLength(1);
    expect(page.dialog()?.spec.title).toBe('Stop recording?');
    expect(page.dialog()?.spec.body).toBe('REAPER is recording. Leaving the Booth stops it.');
    // The question holds the take while it is open.
    expect(screen.getByText('REC · reading paused')).toBeTruthy();
    await act(async () => page.dialog()!.answer(false));
    await settle();
    expect(page.daw.recordStop).not.toHaveBeenCalled();
    expect(page.navigate).not.toHaveBeenCalled();
    expect(screen.getByText('REC')).toBeTruthy();
  });

  it('Stop and leave stops the recording the app started, writes the passage map and then leaves', async () => {
    const page = renderPage();
    await record(page);
    await press('Escape');
    await act(async () => page.dialog()!.answer(true));
    await waitFor(() => expect(page.navigate).toHaveBeenCalledWith('/script'));
    expect(page.daw.recordStop).toHaveBeenCalledTimes(1);
    expect(page.passageMapRecordRun).toHaveBeenCalledTimes(1);
  });

  it('the setup chip asks too', async () => {
    const page = renderPage();
    await record(page);
    await userEvent.click(screen.getByRole('button', { name: 'Recording setup: REAPER' }));
    expect(page.dialog()?.spec.title).toBe('Stop recording?');
    await act(async () => page.dialog()!.answer(true));
    await waitFor(() => expect(page.navigate).toHaveBeenCalledWith('/settings#recording'));
  });

  it('the shell asks before the nav, Back, Forward, Alt+Arrow or a chapter opened in Script; its Yes stops the take as the page goes', async () => {
    const page = renderPage();
    expect(page.journal.checkLeave('/proof')).toBe('allow');
    await record(page);
    for (const path of ['/proof', '/script']) expect(page.journal.checkLeave(path)).toEqual({ ask: expect.objectContaining({ title: 'Stop recording?' }) });
    // The shell asked and the narrator said yes: the shell moves and the page goes.
    page.view.unmount();
    await waitFor(() => expect(page.daw.recordStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(page.passageMapRecordRun).toHaveBeenCalledTimes(1));
  });

  it('a chapter asked for in the address during a take asks first; Keep recording stays, Stop and leave changes chapter', async () => {
    const page = renderPage();
    await record(page);
    await act(async () => driver.go('/booth?chapter=c2'));
    await waitFor(() => expect(page.dialog()?.spec.title).toBe('Stop recording?'));
    await act(async () => page.dialog()!.answer(false));
    await settle();
    expect(page.daw.recordStop).not.toHaveBeenCalled();
    expect(driver.search()).toBe('?chapter=c1');
    expect(screen.getByText('Nobody', { exact: false })).toBeTruthy();
    await act(async () => driver.go('/booth?chapter=c2'));
    await waitFor(() => expect(page.dialog()).toBeTruthy());
    await act(async () => page.dialog()!.answer(true));
    await screen.findByText('court.', { exact: false });
    expect(page.daw.recordStop).toHaveBeenCalledTimes(1);
    expect(page.passageMapRecordRun).toHaveBeenCalledTimes(1);
  });

  it('with nothing recording, leaving needs no question', async () => {
    const page = renderPage();
    await ready();
    await press('Escape');
    expect(page.overlay.getSnapshot().dialogs).toHaveLength(0);
    expect(page.navigate).toHaveBeenCalledWith('/script');
  });
});

describe('a-built-in-take-is-guarded-too', () => {
  // The built-in recorder records through the DAW port like any engine (the host answers recordStart with the recorder behind it), so the
  // page asks the port once and needs no track; what the recorder does with a microphone is the host's tests'.
  it('records with the built-in recorder; leaving asks, and unmounting without the answer does not stop the take', async () => {
    const page = renderPage({ setup: 'builtin' });
    await ready();
    await space();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Stop$/ })).toBeTruthy());
    expect(page.daw.recordStart).toHaveBeenCalledTimes(1);
    expect(page.daw.recordStart).toHaveBeenCalledWith('c1');
    await press('Escape');
    expect(page.dialog()?.spec.body).toBe('The built-in recorder is recording. Leaving the Booth stops it.');
    await act(async () => page.dialog()!.answer(false));
    page.view.unmount();
    await settle();
    expect(page.daw.recordStop).not.toHaveBeenCalled();
  });

  it('"Stop and leave" stops the take through the port before the Booth goes', async () => {
    const page = renderPage({ setup: 'builtin' });
    await ready();
    await space();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Stop$/ })).toBeTruthy());
    await press('Escape');
    await act(async () => page.dialog()!.answer(true));
    await waitFor(() => expect(page.daw.recordStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(page.navigate).toHaveBeenCalled());
  });
});

describe('a-reading-only-session-keeps-adr-0388', () => {
  const running: TeleprompterState = { phase: 'running', message: '', engine: 'whisper', chapter: 'c1', script: null, position: null };

  it('the nav leaves a listening session running; Exit asks "Stop reading?" and stops it', async () => {
    const page = renderPage({ api: { teleprompterState: async () => running } });
    await screen.findByText('Nobody', { exact: false });
    await settle();
    expect(page.journal.checkLeave('/proof')).toBe('allow');
    await press('Escape');
    expect(page.dialog()?.spec.title).toBe('Stop reading?');
    await act(async () => page.dialog()!.answer(true));
    await waitFor(() => expect(page.navigate).toHaveBeenCalledWith('/script'));
    expect(page.teleprompterStop).toHaveBeenCalled();
    expect(page.daw.recordStop).not.toHaveBeenCalled();
  });
});

describe('keys-register-through-the-catalogue', () => {
  it('down and up step a phrase, left and right a word', async () => {
    renderPage();
    await ready();
    expect(current()).toBe('0');
    await press('ArrowDown');
    expect(current()).toBe('1');
    await press('ArrowUp');
    expect(current()).toBe('0');
    await press('ArrowRight');
    expect(document.querySelector('[data-current]')?.textContent).toBe('Garden');
    await press('ArrowLeft');
    expect(document.querySelector('[data-current]')?.textContent).toBe('The');
  });

  it('ignores keys while typing and with Ctrl held', async () => {
    const page = renderPage();
    await ready();
    const field = document.createElement('input');
    document.body.append(field);
    await press('ArrowDown', 'ArrowDown', {}, field);
    await press(' ', 'Space', {}, field);
    await press(' ', 'Space', { ctrlKey: true });
    await settle();
    expect(current()).toBe('0');
    expect(page.daw.recordStart).not.toHaveBeenCalled();
    field.remove();
  });

  it('+ and - change the text size within 24 to 72', async () => {
    renderPage();
    await ready();
    const text = () => document.querySelector<HTMLElement>('[data-booth-text] > div')!.style.fontSize;
    expect(text()).toBe('40px');
    await press('=', 'Equal');
    expect(text()).toBe('44px');
    for (let i = 0; i < 20; i++) await press('-', 'Minus');
    expect(text()).toBe('24px');
  });
});

describe('escape-closes-the-drawer-then-a-popover-then-exits', () => {
  it('at 1280 and below Escape closes the open drawer before it exits', async () => {
    // The medium layout: the side panel is a drawer and starts closed.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('1280'), addEventListener: () => {}, removeEventListener: () => {} }));
    const page = renderPage();
    await ready();
    const panel = document.getElementById('booth-side')!;
    expect(panel.hidden).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /side panel/i }));
    expect(panel.hidden).toBe(false);
    await press('Escape');
    expect(panel.hidden).toBe(true);
    expect(page.navigate).not.toHaveBeenCalled();
    await press('Escape');
    expect(page.navigate).toHaveBeenCalledWith('/script');
    vi.unstubAllGlobals();
  });

  it('a popover takes Escape first; then Escape exits', async () => {
    const page = renderPage();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: /levels/i }));
    const popover = await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(popover.isConnected).toBe(false));
    expect(page.navigate).not.toHaveBeenCalled();
    await press('Escape');
    expect(page.navigate).toHaveBeenCalledWith('/script');
  });
});

describe('the-take-timer-follows-the-clock', () => {
  const timer = () => document.getElementById('btimer')?.textContent;
  const jump = (seconds: number) => {
    vi.setSystemTime(Date.now() + seconds * 1000);
    act(() => void window.dispatchEvent(new Event('focus')));
  };

  it('keeps counting while the Stop recording question holds the reading, and says only the reading is paused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const page = renderPage();
    await record(page);
    expect(timer()).toBe('00:00');
    jump(65);
    expect(timer()).toBe('01:05');
    await press('Escape');
    expect(page.dialog()?.spec.title).toBe('Stop recording?');
    expect(screen.getByText('REC · reading paused')).toBeTruthy();
    jump(10);
    // REAPER records on while the question is open: the clock does not stop with the reading.
    expect(timer()).toBe('01:15');
    await act(async () => page.dialog()!.answer(false));
    await settle();
    expect(screen.getByText('REC')).toBeTruthy();
    expect(timer()).toBe('01:15');
  });

  it('shows the true time after the window slept for an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const page = renderPage();
    await record(page);
    jump(3725);
    expect(timer()).toBe('1:02:05');
  });

  it('the next take starts from 00:00', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const page = renderPage();
    await record(page);
    jump(30);
    await space();
    await waitFor(() => expect(page.daw.recordStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Record$/ })).toBeTruthy());
    await space();
    await waitFor(() => expect(page.daw.recordStart).toHaveBeenCalledTimes(2));
    expect(timer()).toBe('00:00');
  });
});

describe('the-take-is-held-while-a-menu-or-the-confirm-is-open', () => {
  const openMenu = async () => {
    const word = document.querySelector('[data-unit="1"] [data-word]')!;
    await act(async () => {
      fireEvent.contextMenu(word, { button: 2, clientX: 10, clientY: 10 });
    });
    return screen.findByRole('menu');
  };

  it('opening a menu while recording holds the take; Escape lets go', async () => {
    const page = renderPage();
    await record(page);
    const menu = await openMenu();
    await waitFor(() => expect(screen.getByText('REC · reading paused')).toBeTruthy());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(menu.isConnected).toBe(false));
    await waitFor(() => expect(screen.getByText('REC')).toBeTruthy());
  });

  it('a click outside closes the menu and lets go', async () => {
    const page = renderPage();
    await record(page);
    const menu = await openMenu();
    await userEvent.click(document.body);
    await waitFor(() => expect(menu.isConnected).toBe(false));
    await waitFor(() => expect(screen.getByText('REC')).toBeTruthy());
  });

  it('choosing an item lets go and runs it', async () => {
    const page = renderPage();
    await record(page);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Next phrase' }));
    await waitFor(() => expect(screen.getByText('REC')).toBeTruthy());
  });

  it('a menu opened when not recording starts nothing', async () => {
    const page = renderPage();
    await ready();
    await openMenu();
    expect(screen.queryByText('REC · reading paused')).toBeNull();
    expect(page.daw.recordStart).not.toHaveBeenCalled();
  });

  it('a destructive roll asks with the take held; no rolls nothing, yes rolls confirmed', async () => {
    const page = renderPage({ setup: 'reaper', daw: destructive() });
    await record(page);
    await press('r', 'KeyR');
    await waitFor(() => expect(page.dialog()?.spec.title).toBe('Roll again from ¶ 1?'));
    expect(page.dialog()?.spec.body).toBe('Audacity will record over the audio from here, and what it replaces is not kept as a take.');
    expect(screen.getByText('REC · reading paused')).toBeTruthy();
    await act(async () => page.dialog()!.answer(false));
    await waitFor(() => expect(screen.getByText('REC')).toBeTruthy());
    expect(page.daw.roll).not.toHaveBeenCalled();
    await press('r', 'KeyR');
    await waitFor(() => expect(page.dialog()).toBeTruthy());
    await act(async () => page.dialog()!.answer(true));
    await waitFor(() => expect(page.daw.roll).toHaveBeenCalledWith('c1', expect.any(Number), { confirmed: true }));
  });

  it('REAPER rolls without a question and counts the punch', async () => {
    const page = renderPage();
    await record(page);
    await press('ArrowDown');
    await press('r', 'KeyR');
    await waitFor(() => expect(page.daw.roll).toHaveBeenCalledWith('c1', expect.any(Number), { confirmed: false }));
    expect(page.overlay.getSnapshot().dialogs).toHaveLength(0);
    await waitFor(() => expect(screen.getByText(/1 punch\b/)).toBeTruthy());
  });
});

describe('start-from-here-and-record-from-here', () => {
  it('right-click Start from here moves the reading position there and marks the next start', async () => {
    renderPage();
    await ready();
    const word = document.querySelector('[data-unit="3"] [data-word]')!;
    await act(async () => {
      fireEvent.contextMenu(word, { button: 2, clientX: 10, clientY: 10 });
    });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Start from here' }));
    await waitFor(() => expect(current()).toBe('3'));
    expect(screen.getByText(/Next roll starts from ¶ 2/)).toBeTruthy();
  });

  it('opening the Booth at a paragraph and offset from Script starts there', async () => {
    renderPage({ search: '?chapter=c1&para=p3&at=28' });
    await ready();
    await waitFor(() => expect(current()).toBe('6'));
    expect(screen.getByText(/Next roll starts from ¶ 3/)).toBeTruthy();
  });
});

describe('rapid-chapter-steps-are-not-dropped', () => {
  const shown = () => screen.getByRole('button', { name: /^Chapter: / }).getAttribute('aria-label');

  it('three presses of Next in one tick move three chapters, not one', async () => {
    renderPage();
    await ready();
    const start = shown();
    const next = screen.getByRole('button', { name: 'Next chapter' });
    act(() => {
      fireEvent.click(next);
      fireEvent.click(next);
      fireEvent.click(next);
    });
    await waitFor(() => expect(shown()).not.toBe(start));
    await settle();
    const rapid = shown();
    // The same three presses made one at a time end on the same chapter.
    cleanup();
    renderPage();
    await ready();
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Next chapter' }));
      await settle();
    }
    expect(rapid).toBe(shown());
  });

  it('Next then Previous before the chapter loads lands back where it began', async () => {
    renderPage();
    await ready();
    const start = shown();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Next chapter' })));
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Previous chapter' })));
    await settle();
    await waitFor(() => expect(shown()).toBe(start));
  });
});

describe('the-chapter-cannot-change-during-a-take', () => {
  it('the picker and its arrows are disabled while recording', async () => {
    const page = renderPage();
    await ready();
    const picker = screen.getByRole('button', { name: /Chapter: .*Change chapter/ });
    expect((picker as HTMLButtonElement).disabled).toBe(false);
    await record(page);
    // The stepper is off, not a fieldset full of dead buttons: the arrows stay focusable and say why (aria-disabled), and a press changes nothing.
    const next = screen.getByRole('button', { name: 'Next chapter' });
    // The picker is a new element while it is off (its hint's wrapper is the tab stop and says why), so it is read again.
    const off = screen.getByRole('button', { name: /Chapter: .*Change chapter/ });
    expect(off.matches(':disabled') || off.getAttribute('aria-disabled') === 'true' || off.hasAttribute('data-disabled')).toBe(true);
    expect(screen.getByRole('group', { name: 'Not while recording. Stop the take first.' }).tabIndex).toBe(0);
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Previous chapter' }).getAttribute('aria-disabled')).toBe('true');
    const before = picker.getAttribute('aria-label');
    await userEvent.click(next);
    await settle();
    expect(screen.getByRole('button', { name: /Chapter: .*Change chapter/ }).getAttribute('aria-label')).toBe(before);
  });

  it('the arrows promise no shortcut the Booth does not have, and say why they are off', async () => {
    const page = renderPage();
    await ready();
    await userEvent.hover(screen.getByRole('button', { name: 'Next chapter' }));
    expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', 'Next chapter');
    await userEvent.unhover(screen.getByRole('button', { name: 'Next chapter' }));
    await record(page);
    await userEvent.hover(screen.getByRole('button', { name: 'Next chapter' }));
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('Not while recording. Stop the take first.'));
  });
});

describe('engine-and-model-are-not-in-the-booth', () => {
  it('has no engine, model, microphone field or "Record with" control', async () => {
    renderPage();
    await ready();
    expect(screen.queryByText(/record with/i)).toBeNull();
    expect(screen.queryByRole('combobox', { name: /engine|model|microphone/i })).toBeNull();
    expect(screen.queryByText(/whisper|moonshine/i)).toBeNull();
  });
});

describe('credits-are-readable-and-recordable', () => {
  const credits = {
    creditsTemplates: async () => [{ id: 'o', kind: 'opening', name: 'Opening', body: '[Title]' }],
    creditsPreview: async () => ({ text: 'This is [Title].\nRead by the narrator.', words: 7, unresolved: ['Title'] }),
  };

  it('open as a source with the unresolved-token warning, and record to their own region', async () => {
    const page = renderPage({ search: '?credits=opening', api: credits as Partial<NarrationApi> });
    await screen.findByText('Read', { exact: false });
    expect(screen.getByRole('button', { name: /Credits tokens with no value: Title/ })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: /^Record$/ }) as HTMLButtonElement).disabled).toBe(false));
    await space();
    await waitFor(() => expect(page.daw.recordStart).toHaveBeenCalledWith('credits-opening'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Stop$/ })).toBeTruthy());
    await space();
    // The take maps to the credits' own region in the passage map.
    await waitFor(() =>
      expect(page.passageMapRecordRun).toHaveBeenCalledWith(
        'credits-opening',
        expect.arrayContaining([expect.objectContaining({ kind: 'start', pid: 'credits-opening-0' })]),
      ),
    );
  });
});

describe('the resume line', () => {
  it('offers where the recording ends and choosing it moves the reading position', async () => {
    renderPage({ api: { teleprompterLocate: async () => LOCATED } });
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: /Resume at ¶ 2/ }));
    expect(current()).not.toBe('0');
  });
});

describe('a refused stop keeps the take and the question', () => {
  it('shows the sentence and does not leave', async () => {
    const refused: DawResult = { ok: false, changed: false, message: 'Not now.', undoSteps: 0, refused: 'Not now.' };
    const page = renderPage();
    page.daw.recordStop.mockResolvedValueOnce(refused);
    await record(page);
    await press('Escape');
    await act(async () => page.dialog()!.answer(true));
    await waitFor(() => expect(page.dialog()?.spec.body).toContain('Not now.'));
    expect(page.dialog()?.spec.confirmLabel).toBe('Leave anyway');
    expect(page.navigate).not.toHaveBeenCalled();
  });
});

// SN-O103: the bookmarks (SN-O81) and the pickup session (SN-O82) on the page.
const held = (over: Partial<Bookmark>): Bookmark => ({
  id: 'b1',
  chapterId: 'c1',
  paragraphId: 'p3',
  paragraph: 2,
  offset: 28,
  label: '',
  note: '',
  createdAt: '2026-10-11T10:00:00Z',
  stale: false,
  ...over,
});
const currentText = () => document.querySelector<HTMLElement>('[data-state="cur"]')?.textContent ?? '';
const bodyText = () => document.querySelector('[data-booth-text]')?.textContent ?? '';
const ribbons = () => document.querySelectorAll('[data-bmk-margin] [data-bm]');

describe('bookmarks on the page', () => {
  it('B bookmarks the word being read and the toast Undo takes it back', async () => {
    const page = renderPage();
    await ready();
    await press('b', 'KeyB');
    await waitFor(() => expect(page.overlay.getSnapshot().toasts.map((toast) => toast.text)).toEqual(['Bookmark added.']));
    await waitFor(() => expect(ribbons()).toHaveLength(1));
    const toast = page.overlay.getSnapshot().toasts.find((item) => item.text === 'Bookmark added.');
    await act(async () => {
      await toast?.action?.onAction();
    });
    await waitFor(() => expect(ribbons()).toHaveLength(0));
  });

  it('Alt+] and Alt+[ step between bookmarks, into the next chapter when the next one is there', async () => {
    renderPage({ api: { bookmarksList: async () => [held({}), held({ id: 'b2', chapterId: 'c2', paragraphId: 'q1', paragraph: 0, offset: 2 })] } });
    await ready();
    await waitFor(() => expect(ribbons()).toHaveLength(1));
    await press(']', 'BracketRight', { altKey: true });
    await waitFor(() => expect(currentText()).toContain('The roses watched her go.'));
    await press(']', 'BracketRight', { altKey: true });
    await waitFor(() => expect(driver.search()).toContain('chapter=c2'));
    await waitFor(() => expect(bodyText()).toContain('A new day began in the court.'));
  });

  it('right-click offers Bookmark here on a word, and Edit and Delete on a ribbon', async () => {
    renderPage({ api: { bookmarksList: async () => [held({})] } });
    await ready();
    const word = document.querySelector('[data-unit="1"] [data-word="0"]')!;
    act(() => {
      fireEvent.contextMenu(word, { button: 2, clientX: 10, clientY: 10 });
    });
    const menu = await screen.findByRole('menu');
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(labels.slice(0, 2)).toEqual(['Start from here', 'Bookmark here']);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(ribbons()).toHaveLength(1));
    act(() => {
      fireEvent.contextMenu(ribbons()[0], { button: 2, clientX: 10, clientY: 10 });
    });
    const ribbonMenu = await screen.findByRole('menu');
    expect(
      within(ribbonMenu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Edit bookmark', 'Delete bookmark']);
  });
});

const pickup = (id: string, chapterId: string, paragraphId: string, script: string): PickupItem => ({
  id,
  chapterId,
  paragraphId,
  paragraph: null,
  time: 65,
  at: null,
  type: 'misread',
  script,
  context: '',
  source: 'you',
  confidence: null,
  confReason: '',
  included: true,
  done: false,
  waiting: false,
});

function pickupHost() {
  let items = [pickup('k1', 'c1', 'p3', 'She turned and walked away.'), pickup('k2', 'c2', 'q1', 'A new day began in the court.')];
  const answer = (): PickupList => ({ pickups: items.map((item) => ({ ...item })), leftOut: [] });
  return {
    pickupsList: vi.fn(async () => answer()),
    pickupsSetDone: vi.fn(async (id: string, done: boolean) => {
      items = items.map((item) => (item.id === id ? { ...item, done } : item));
      return answer();
    }),
  };
}

describe('a pickup session on the page', () => {
  it('a pickup session lists its lines, steps with N and exits to Pickups', async () => {
    const host = pickupHost();
    const page = renderPage({ search: '?chapter=c1&pickups=k1,k2', api: host });
    await ready();
    const panel = await screen.findByRole('complementary', { name: 'Side panel' });
    await within(panel).findByText('Pickups · 2 open');
    // The reading starts on the session's first line, which is marked in the text.
    await waitFor(() => expect(currentText()).toContain('She turned'));
    expect(document.querySelector('#bkeys')?.textContent).toContain('Next pickup');
    await press('n', 'KeyN');
    await waitFor(() => expect(driver.search()).toContain('chapter=c2'));
    expect(decodeURIComponent(driver.search())).toContain('pickups=k1,k2');
    await waitFor(() => expect(bodyText()).toContain('A new day began in the court.'));
    await waitFor(() => expect(screen.getByRole('button', { name: /A new day began/ }).getAttribute('aria-current')).toBe('true'));
    // Shift+N goes back, into the first line's chapter and onto its paragraph.
    await press('N', 'KeyN', { shiftKey: true });
    await waitFor(() => expect(driver.search()).toContain('chapter=c1'));
    await waitFor(() => expect(currentText()).toContain('She turned'));
    await press('Escape');
    await waitFor(() => expect(page.navigate).toHaveBeenCalledWith('/pickups'));
  });

  it('a take marks the lines it read over as recorded', async () => {
    const host = pickupHost();
    const page = renderPage({ search: '?chapter=c1&pickups=k1,k2', api: host });
    await ready();
    await waitFor(() => expect(currentText()).toContain('She turned'));
    await record(page);
    await space();
    await waitFor(() => expect(host.pickupsSetDone).toHaveBeenCalledWith('k1', true));
    expect(host.pickupsSetDone).not.toHaveBeenCalledWith('k2', true);
    await waitFor(() => expect(screen.getAllByText('Pickups · 1 open').length).toBeGreaterThan(0));
  });

  it('opening the Booth any other way is no session: no list, no N, and Exit goes to the Script', async () => {
    const host = pickupHost();
    const page = renderPage({ api: host });
    await ready();
    expect(screen.queryByText(/^Pickups · /)).toBeNull();
    expect(host.pickupsList).not.toHaveBeenCalled();
    expect(document.querySelector('#bkeys')?.textContent).not.toContain('Next pickup');
    await press('Escape');
    await waitFor(() => expect(page.navigate).toHaveBeenCalledWith('/script'));
  });
});

// SN-O11: the rest of the Booth parity audit (docs/research/studio-next-parity-booth.md, G2 to G15).
const toasts = (page: ReturnType<typeof renderPage>) => page.overlay.getSnapshot().toasts.map((toast) => toast.text);

/** A host whose listening session the test drives: it pushes the session's state and events as the sidecar would. */
function voiceHost() {
  const events = new Set<(event: TeleprompterEvent) => void>();
  const states = new Set<(state: TeleprompterState) => void>();
  return {
    api: {
      subscribeTeleprompterEvent: (on: (event: TeleprompterEvent) => void) => {
        events.add(on);
        return () => events.delete(on);
      },
      subscribeTeleprompterState: (on: (state: TeleprompterState) => void) => {
        states.add(on);
        return () => states.delete(on);
      },
      teleprompterStart: vi.fn(async () => ({ status: 'started' as const })),
    } as Partial<NarrationApi>,
    state: (state: Partial<TeleprompterState>) =>
      act(() => states.forEach((on) => on({ phase: 'running', message: '', engine: 'whisper', chapter: 'c1', script: null, position: null, ...state }))),
    event: (event: TeleprompterEvent) => act(() => events.forEach((on) => on(event))),
  };
}

describe('a take stops by itself at the end of the chapter', () => {
  it('a take stops by itself at the end of the chapter and says the take is saved', async () => {
    const voice = voiceHost();
    const page = renderPage({ api: voice.api });
    await record(page);
    await voice.state({});
    await voice.event({ type: 'position', read: 30, committed: 30, status: 'done', jump: null, skipped: null });
    // "Done - stopping in a few seconds unless you read on": the take runs on until the session stops itself.
    await settle();
    expect(page.daw.recordStop).not.toHaveBeenCalled();
    await voice.state({ phase: 'stopped', message: 'Stopped at the end of the chapter.' });
    // The same stop the Stop button makes: one recordStop through the Record control, and the passage map's run ends.
    await waitFor(() => expect(page.daw.recordStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Record$/ })).toBeTruthy());
    await waitFor(() => expect(page.passageMapRecordRun).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toasts(page)).toContain('Take saved'));
  });

  it('reading on past the end keeps the take, and a session that stops elsewhere does not stop it', async () => {
    const voice = voiceHost();
    const page = renderPage({ api: voice.api });
    await record(page);
    await voice.state({});
    await voice.event({ type: 'position', read: 30, committed: 30, status: 'done', jump: null, skipped: null });
    await voice.event({ type: 'position', read: 12, committed: 12, status: 'listening', jump: 'restart', skipped: null });
    await voice.state({ phase: 'stopped', message: '' });
    await settle();
    expect(page.daw.recordStop).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Stop$/ })).toBeTruthy();
  });
});

describe('the speaker chips write through the shared cues', () => {
  it('confirming a suggested chip writes the shared speaker', async () => {
    const cue: GuideDialogueCue = {
      id: 'cue-1',
      chapterId: 'c1',
      paragraphId: 'p2',
      quote_start: 0,
      quote_end: 20,
      quote_text: '“Off with her head,”',
      speaker_entity_id: 'e-queen',
      speaker_source: 'tag',
      evidence: {},
      corrected: false,
    } as GuideDialogueCue;
    const guideCorrectCue = vi.fn(async () => {});
    renderPage({ api: { guideDialogueCues: async () => [cue], guideCorrectCue } as Partial<NarrationApi> });
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Speaker Queen. Change speaker' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirm “Queen”' }));
    await waitFor(() => expect(guideCorrectCue).toHaveBeenCalledWith('cue-1', 'e-queen'));
  });
});

describe('every way out of the page asks while a take records', () => {
  it('every way out of the page asks while a take records', async () => {
    const page = renderPage();
    await record(page);
    // Each exit the shell runs asks the page's guard before it moves: the palette's jump to a page, a link from a toast, the mouse's
    // Back and Forward buttons (the shell asks with no destination), the rail, and a project switch (the start page).
    const exits = { palette: '/proof', toast: '/pickups', mouseButtons: '', rail: '/production', projectSwitch: '/' };
    for (const [exit, path] of Object.entries(exits))
      expect({ exit, verdict: page.journal.checkLeave(path) }).toEqual({ exit, verdict: { ask: expect.objectContaining({ title: 'Stop recording?' }) } });
    // Asking stops nothing: only the narrator's Stop and leave does.
    await settle();
    expect(page.daw.recordStop).not.toHaveBeenCalled();
    expect(screen.getByText('REC')).toBeTruthy();
  });
});

describe('the right-click menu', () => {
  it('right-click offers the phrase, take and text commands', async () => {
    const page = renderPage();
    await ready();
    const open = async () => {
      act(() => {
        fireEvent.contextMenu(document.querySelector('[data-unit="1"] [data-word="0"]')!, { button: 2, clientX: 10, clientY: 10 });
      });
      return screen.findByRole('menu');
    };
    const menu = await open();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Start from here', 'Bookmark here', 'Next phrase', 'Back one phrase', 'Punch and roll', 'Larger text', 'Smaller text', 'Exit Booth']);
    const text = () => document.querySelector<HTMLElement>('[data-booth-text] > div')!.style.fontSize;
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Larger text' }));
    expect(text()).toBe('44px');
    await userEvent.click(within(await open()).getByRole('menuitem', { name: 'Smaller text' }));
    expect(text()).toBe('40px');
    await userEvent.click(within(await open()).getByRole('menuitem', { name: 'Next phrase' }));
    expect(current()).toBe('1');
    await userEvent.click(within(await open()).getByRole('menuitem', { name: 'Back one phrase' }));
    expect(current()).toBe('0');
    await userEvent.click(within(await open()).getByRole('menuitem', { name: 'Exit Booth' }));
    await waitFor(() => expect(page.navigate).toHaveBeenCalledWith('/script'));
  });
});

describe('F11 and the window', () => {
  it('F11 takes the window fullscreen and the Booth gives it back on leaving', async () => {
    const page = renderPage();
    await ready();
    await press('F11');
    await waitFor(() => expect(host.toggleFullscreen).toHaveBeenCalledTimes(1));
    await settle();
    expect(host.exitFullscreen).not.toHaveBeenCalled();
    page.view.unmount();
    expect(host.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('a Booth that did not make the window fullscreen leaves it as it is', async () => {
    const page = renderPage();
    await ready();
    page.view.unmount();
    expect(host.exitFullscreen).not.toHaveBeenCalled();
  });
});

describe('the footer room tone', () => {
  it("the footer shows the project's measured room tone", async () => {
    // The microphone saved in Settings is the one whose room tone the footer shows.
    const settingsForScope = async (scope: string) => (scope === 'global' ? { Teleprompter: [{ key: 'input_device', value: 'USB Mic', isSet: true }] } : {});
    renderPage({
      api: { settingsForScope } as unknown as Partial<NarrationApi>,
      measurements: createMockMeasurements({ roomTone: { 'USB Mic': -58.6 } }),
    });
    await ready();
    expect(await screen.findByText('Room −58.6 dB')).toBeTruthy();
  });

  it('says the room is not measured yet when there is no reading', async () => {
    renderPage({ measurements: createMockMeasurements({ none: true }) });
    await ready();
    expect(await screen.findByText('Room not measured yet')).toBeTruthy();
  });
});

describe('Page Down and Page Up', () => {
  it('Page Down and Page Up scroll the view without moving the reading position', async () => {
    const sized = [
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600),
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(5000),
    ];
    renderPage();
    await ready();
    const text = document.querySelector<HTMLElement>('[data-booth-text] > div')!;
    const y = () => parseFloat(/-?[\d.]+(?=px)/.exec(text.style.transform)?.[0] ?? '0');
    const y0 = y();
    await press('PageDown');
    expect(y0 - y()).toBeCloseTo(480);
    expect(current()).toBe('0');
    await press('PageUp');
    expect(y()).toBeCloseTo(y0);
    expect(current()).toBe('0');
    sized.forEach((spy) => spy.mockRestore());
  });
});

describe('the text choices are saved', () => {
  const text = () => document.querySelector<HTMLElement>('[data-booth-text] > div')!;

  it('the text size and font come from the saved choices', async () => {
    window.localStorage.setItem(BOOTH_SIZE_STORAGE_KEY, '52');
    window.localStorage.setItem(TEXT_PREFS_STORAGE_KEY, JSON.stringify({ font: 'Verdana', size: 18, spacing: 1.8, width: 64 }));
    renderPage();
    await ready();
    expect(text().style.fontSize).toBe('52px');
    expect(text().style.fontFamily).toContain('Verdana');
  });

  it('a size changed by the keys is the one the next visit opens with', async () => {
    renderPage();
    await ready();
    await press('=', 'Equal');
    expect(window.localStorage.getItem(BOOTH_SIZE_STORAGE_KEY)).toBe('44');
    cleanup();
    renderPage();
    await ready();
    expect(text().style.fontSize).toBe('44px');
  });
});

describe('the chapter is named as the manuscript heads it', () => {
  const chapters = (title: string, next: string): ManuscriptChapter[] =>
    [
      { id: 'c1', title, subtitle: 'Down the Rabbit-Hole', index: 0, wordCount: 30, status: 'not_started', contentKind: 'narration' },
      { id: 'c2', title: next, subtitle: 'The Pool of Tears', index: 1, wordCount: 6, status: 'not_started', contentKind: 'narration' },
    ] as ManuscriptChapter[];

  it.each([
    ['gutenberg', 'CHAPTER I.', 'CHAPTER II.'],
    ['numbered', '1.', '2.'],
    ['colon', 'Chapter 1:', 'Chapter 2:'],
  ])('names the chapter in the manuscript style (%s)', async (_style, title, next) => {
    renderPage({ api: { manuscriptChapters: async () => chapters(title, next) } });
    await ready();
    const picker = screen.getByRole('button', { name: /Chapter: .*Change chapter/ });
    expect(picker.textContent).toContain(`${title} Down the Rabbit-Hole`);
    await userEvent.click(picker);
    expect(await screen.findByRole('menuitemradio', { name: `${next} The Pool of Tears` })).toBeTruthy();
  });
});

describe('the reference in the side panel', () => {
  const mark = (over: Partial<Mark>): Mark => ({
    id: 'm1',
    chapterId: 'c1',
    paragraphId: 'p1',
    paragraph: 0,
    start: 15,
    end: 20,
    quote: 'quiet',
    type: 'stress',
    text: 'Soft, almost a whisper.',
    thread: [{ who: 'author', text: 'Yes, hushed.', at: '2026-10-01T10:00:00Z' }],
    createdAt: '2026-10-01T09:00:00Z',
    stale: false,
    ...over,
  });
  const MARKS: Marks = {
    types: [{ key: 'stress', name: 'Word stress', colour: 'copper', style: 'highlight', asks: false }],
    marks: [mark({})],
  };
  const reference = () => document.getElementById('booth-reference');
  const word = (unit: number, index: number) => document.querySelector<HTMLElement>(`[data-unit="${unit}"] [data-word="${index}"]`)!;

  it('clicking a marked word shows the note and its thread in the side panel', async () => {
    renderPage({ api: { marksList: async () => MARKS } });
    await ready();
    await waitFor(() => expect(word(0, 3).title).toBe('Word stress'));
    expect(reference()).toBeNull();
    await userEvent.click(word(0, 3));
    const ref = within(reference()!);
    expect(ref.getByText('Word stress')).toBeTruthy();
    expect(ref.getByText('“quiet”')).toBeTruthy();
    expect(ref.getByText('Soft, almost a whisper.')).toBeTruthy();
    expect(ref.getByText('Yes, hushed.')).toBeTruthy();
    expect(ref.getByText(/Author/)).toBeTruthy();
    // The click still moves the reading position.
    expect(current()).toBe('0');
  });

  it('a note under a paragraph opens its text; empty space or a plain word clears the reference', async () => {
    renderPage({ api: { marksList: async () => MARKS } });
    await ready();
    const note = await screen.findByRole('button', { name: 'Word stress: Soft, almost a whisper.' });
    await userEvent.click(note);
    expect(within(reference()!).getByText('Yes, hushed.')).toBeTruthy();
    await userEvent.click(document.querySelector<HTMLElement>('[data-booth-text]')!);
    expect(reference()).toBeNull();
    await userEvent.click(note);
    expect(reference()).not.toBeNull();
    await userEvent.click(word(2, 1));
    expect(reference()).toBeNull();
    expect(current()).toBe('2');
  });

  it('above 1280 clicking the text does not close the inline panel', async () => {
    renderPage();
    await ready();
    const panel = document.getElementById('booth-side')!;
    expect(panel.hidden).toBe(false);
    await userEvent.click(word(1, 2));
    await userEvent.click(document.querySelector<HTMLElement>('[data-booth-text]')!);
    expect(panel.hidden).toBe(false);
  });

  it('a Story Bible name shows its entry', async () => {
    renderPage({ api: { marksList: async () => MARKS } });
    await ready();
    await userEvent.click(word(0, 1));
    expect(within(reference()!).getByText('The walled rose garden.')).toBeTruthy();
  });

  it('a marks list the host refuses leaves the text unmarked and says why', async () => {
    const page = renderPage({ api: { marksList: () => Promise.reject(new Error('The marks file could not be read.')) } });
    await ready();
    await waitFor(() => expect(page.overlay.getSnapshot().toasts.map((toast) => toast.text)).toContain('The marks file could not be read.'));
    expect(screen.queryByRole('button', { name: /Word stress/ })).toBeNull();
  });
});

describe('the text follows the voice: the listening microphone and the model', () => {
  const noSavedDevice = async () => ({});
  const savedDevice = (name: string) => async () => ({
    Teleprompter: [{ key: 'input_device', label: 'Microphone', kind: 'text', value: name, effectiveValue: name, isSet: true }],
  });
  const reaperInput = (device?: string) => async () =>
    device
      ? { status: 'matched' as const, message: `REAPER records from "${device}", so "${device}" is selected.`, reaperDevice: device, device, candidates: [] }
      : {
          status: 'unavailable' as const,
          reason: 'reaper_no_device' as const,
          message: 'REAPER did not say which input device it has open. Choose the microphone yourself.',
          candidates: [],
        };
  const two = async () => ({ devices: [{ name: 'USB Mic' }, { name: 'Line In' }], error: null });

  it('with no microphone chosen, a take listens to the one the DAW records from and Levels names it', async () => {
    const teleprompterStart = vi.fn(async () => ({ status: 'started' as const }));
    const saveSettings = vi.fn(async () => {});
    const page = renderPage({
      api: {
        settingsForScope: noSavedDevice,
        teleprompterReaperInput: reaperInput('Line In'),
        teleprompterDevices: two,
        teleprompterStart,
        saveSettings,
      } as never,
    });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith('Teleprompter', 'global', { input_device: 'Line In' }));
    await record(page);
    await waitFor(() => expect(teleprompterStart).toHaveBeenCalledWith(expect.objectContaining({ device: 'Line In', chapter: 'c1' })));
    expect(document.getElementById('blisten-why')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Levels' }));
    const menu = await screen.findByRole('dialog', { name: 'Levels' });
    expect(within(menu).getByText('Line In')).toBeTruthy();
    expect(within(menu).getByText('Chosen in REAPER')).toBeTruthy();
    expect(within(menu).queryByRole('combobox')).toBeNull();
  });

  it('a microphone the narrator chose is kept over the DAW’s', async () => {
    const teleprompterStart = vi.fn(async () => ({ status: 'started' as const }));
    const page = renderPage({
      api: { settingsForScope: savedDevice('USB Mic'), teleprompterReaperInput: reaperInput('Line In'), teleprompterDevices: two, teleprompterStart } as never,
    });
    await record(page);
    await waitFor(() => expect(teleprompterStart).toHaveBeenCalledWith(expect.objectContaining({ device: 'USB Mic' })));
  });

  it('when the DAW cannot say, the footer says to choose one in Levels, and the choice is what the next take listens to', async () => {
    const teleprompterStart = vi.fn(async () => ({ status: 'started' as const }));
    const page = renderPage({
      api: { settingsForScope: noSavedDevice, teleprompterReaperInput: reaperInput(), teleprompterDevices: two, teleprompterStart } as never,
    });
    await ready();
    await waitFor(() =>
      expect(document.getElementById('blisten-why')?.textContent).toBe('Choose the microphone the Booth listens to in Levels, so the text follows your voice.'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Levels' }));
    const menu = await screen.findByRole('dialog', { name: 'Levels' });
    expect(within(menu).getByText('REAPER did not say which input device it has open. Choose the microphone yourself.')).toBeTruthy();
    await userEvent.selectOptions(within(menu).getByRole('combobox', { name: 'Microphone' }), 'USB Mic');
    await userEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Levels' })).toBeNull());
    await waitFor(() => expect(document.getElementById('blisten-why')).toBeNull());
    await record(page);
    await waitFor(() => expect(teleprompterStart).toHaveBeenCalledWith(expect.objectContaining({ device: 'USB Mic' })));
  });

  it('a missing model is asked for when the take starts, and nothing downloads until the narrator says so', async () => {
    const assetsInstall = vi.fn();
    const teleprompterStart = vi.fn(async () => ({
      status: 'asset_required' as const,
      engine: 'whisper' as const,
      model: {
        id: 'tiny',
        displayName: 'Whisper tiny',
        version: '1',
        publisher: 'OpenAI',
        license: 'MIT',
        licenseUrl: '',
        modelCardUrl: '',
        provenanceUrl: '',
      },
      installState: 'not_installed' as const,
      downloadSize: 1,
      diskSize: 1,
      installPath: 'C:/assets/whisper',
    }));
    const page = renderPage({ api: { settingsForScope: savedDevice('USB Mic'), teleprompterStart, assetsInstall } as never });
    await ready();
    await space();
    expect(await screen.findByRole('alertdialog', { name: 'Download local Whisper model?' })).toBeTruthy();
    expect(page.daw.recordStart).toHaveBeenCalledTimes(1);
    expect(assetsInstall).not.toHaveBeenCalled();
  });

  it('a session that fails to start says so in the footer; the take goes on', async () => {
    const teleprompterStart = vi.fn(async () => {
      throw new Error('The microphone is in use by another application.');
    });
    const page = renderPage({ api: { settingsForScope: savedDevice('USB Mic'), teleprompterStart } as never });
    await record(page);
    await waitFor(() =>
      expect(document.getElementById('blisten-why')?.textContent).toBe('The text cannot follow your voice: The microphone is in use by another application.'),
    );
    expect(screen.getByRole('button', { name: /^Stop$/ })).toBeTruthy();
  });
});
