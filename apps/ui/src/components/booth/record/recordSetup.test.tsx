// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiProvider } from '../../../api/ApiContext';
import type { DawCapabilities, DawTransport } from '../../../api/contracts/daw';
import { createMockApi } from '../../../api/mockApi';
import { DAW_SETUPS } from '../../../fixtures/daw';
import { PortOverrides } from '../../../ports/usePort';
import type { DawClient } from '../../../ports/daw';
import type { NarrationApi } from '../../../types';
import { dawClientFor } from './fixtures';
import { REAPER_LAUNCHER_ACTION as LAUNCHER_ACTION } from '../../engine/dawConnectGuide';
import { RecordSetup } from './RecordSetup';
import { recordSetupFor, type RecordSetupFacts } from './recordSetupModel';
import { stoppedInDaw, TAKE_TOPIC, useRecordControl, forgetAppTake } from './useRecordControl';

// A take one test leaves running is not the next test's.
beforeEach(() => forgetAppTake());

afterEach(cleanup);

const LAUNCHER = 'C:\\Users\\n\\AppData\\Local\\narration-utils\\runtime\\abc\\reaper\\NarrationStudio_Launcher.lua';
const LINKED = { dawFileLinked: true, launcherPath: LAUNCHER };

/** REAPER's setup with record refused for `reason`, everything else as the connected setup. */
function recordRefused(reason: 'experimental_off' | 'turned_off' | 'standalone' | 'not_running', daw: DawCapabilities['daw'] = 'REAPER'): DawCapabilities {
  const base = DAW_SETUPS.reaper;
  return {
    ...base,
    daw,
    reachable: reason !== 'not_running' && reason !== 'standalone',
    capabilities: { ...base.capabilities, record: { level: 'experimental', available: false, reason, message: `refused: ${reason}` } },
  };
}

describe('recordSetupFor the project the DAW has open', () => {
  it('offers the open-project notice when Record could start but the DAW has another project open', () => {
    expect(recordSetupFor(DAW_SETUPS.reaper, { ...LINKED, openProject: 'different' })).toEqual({ kind: 'other-project', dawName: 'REAPER' });
  });

  it('offers it for no other reading of the open project: the same one, or one that cannot be told', () => {
    expect(recordSetupFor(DAW_SETUPS.reaper, { ...LINKED, openProject: 'same' })).toBeNull();
    expect(recordSetupFor(DAW_SETUPS.reaper, { ...LINKED, openProject: 'unknown' })).toBeNull();
    expect(recordSetupFor(DAW_SETUPS.reaper, LINKED)).toBeNull();
  });

  it('puts what stops Record altogether first: a switched-off Record or a DAW that is not answering is not a wrong-project problem', () => {
    expect(recordSetupFor(recordRefused('experimental_off'), { ...LINKED, openProject: 'different' })).toMatchObject({ kind: 'turn-on' });
    expect(recordSetupFor(recordRefused('not_running'), { ...LINKED, openProject: 'different' })).toMatchObject({ kind: 'connect' });
  });
});

describe('recordSetupFor', () => {
  it('offers nothing while Record is available', () => {
    expect(recordSetupFor(DAW_SETUPS.reaper, LINKED)).toBeNull();
  });

  it('offers the one-click turn-on for the experimental switch and for record turned off', () => {
    expect(recordSetupFor(recordRefused('experimental_off'), LINKED)).toEqual({ kind: 'turn-on', dawName: 'REAPER', inApp: false });
    expect(recordSetupFor(recordRefused('turned_off'), LINKED)).toMatchObject({ kind: 'turn-on' });
  });

  it('offers the REAPER connection steps when no bridge is connected, also on a launch with no DAW', () => {
    expect(recordSetupFor(recordRefused('standalone'), LINKED)).toMatchObject({
      kind: 'connect',
      notAnswering: false,
      linked: true,
      launcherPath: LAUNCHER,
      guide: { dawName: 'REAPER' },
    });
    expect(recordSetupFor(recordRefused('standalone', 'none'), { dawFileLinked: false, launcherPath: '' })).toMatchObject({ kind: 'connect', linked: false });
    expect(recordSetupFor(recordRefused('not_running'), LINKED)).toMatchObject({ kind: 'connect', notAnswering: true });
  });

  it('offers no REAPER steps to another DAW, nor for a refusal the narrator cannot fix here', () => {
    expect(recordSetupFor(recordRefused('standalone', 'Audacity'), LINKED)).toBeNull();
    const unsupported = {
      ...DAW_SETUPS.reaper,
      capabilities: { ...DAW_SETUPS.reaper.capabilities, record: { level: 'unsupported' as const, available: false, reason: 'unsupported' as const } },
    };
    expect(recordSetupFor(unsupported, LINKED)).toBeNull();
  });
});

function mount(capabilities: DawCapabilities, facts: RecordSetupFacts = LINKED, overrides: Partial<NarrationApi> = {}) {
  const api = createMockApi(overrides);
  const say = vi.fn();
  const onSettings = vi.fn();
  const onChanged = vi.fn();
  render(
    <ApiProvider api={api}>
      <RecordSetup capabilities={capabilities} facts={facts} say={say} onSettings={onSettings} onChanged={onChanged} />
    </ApiProvider>,
  );
  return { say, onSettings, onChanged };
}

describe('RecordSetup when the app turns the launch away', () => {
  /** A mock api whose attach event the test sends by hand, as the host does when REAPER hands its project to a busy app. */
  function mountWithAttach() {
    let send: (state: { attached: boolean; reason?: string }) => void = () => {};
    const api = createMockApi({
      subscribeProjectAttach: (listener: (state: { attached: boolean; reason?: string }) => void) => ((send = listener), () => {}),
    } as Partial<NarrationApi>);
    render(
      <ApiProvider api={api}>
        <RecordSetup capabilities={recordRefused('standalone')} facts={LINKED} say={vi.fn()} onSettings={vi.fn()} onChanged={vi.fn()} onCheckAgain={vi.fn()} />
      </ApiProvider>,
    );
    return (state: { attached: boolean; reason?: string }) => act(() => send(state));
  }

  it('says the project was turned away and what to do, until it is taken or the narrator checks again', async () => {
    const attach = mountWithAttach();
    expect(screen.queryByRole('alert')).toBeNull();
    attach({ attached: false, reason: 'Narration Studio is busy, so the current project was left unchanged.' });
    // The headline says what happened, not "not answering" (REAPER did start): walkthrough M15.
    expect(screen.getByRole('heading', { name: 'REAPER started, but its project was turned away' })).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Narration Studio is busy');
    expect(alert.textContent).toContain('Finish or cancel what is running, then press Open in REAPER and connect again.');
    attach({ attached: true });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Connect REAPER to record' })).toBeTruthy();
    attach({ attached: false, reason: 'busy again' });
    expect(screen.getByRole('alert')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal with no reason says nothing it cannot back', () => {
    const attach = mountWithAttach();
    attach({ attached: false });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('RecordSetup', () => {
  it('turn-on-saves-only-records-own-toggle-and-says-so', async () => {
    const saveSettings = vi.fn(async () => createMockApi().bootstrap());
    const { say, onChanged } = mount(recordRefused('experimental_off'), LINKED, { saveSettings } as Partial<NarrationApi>);
    expect(screen.getByRole('heading', { name: 'Recording in REAPER is experimental' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on Record' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(saveSettings).toHaveBeenCalledWith('DAW', 'global', { 'capability.record': 'on' });
    expect(say.mock.calls[0][0]).toMatch(/^Record in REAPER is on\./);
  });

  it('turn-on-says-why-when-the-save-fails', async () => {
    const saveSettings = vi.fn(async () => {
      throw new Error('settings are read-only');
    });
    const { say, onChanged } = mount(recordRefused('experimental_off'), LINKED, { saveSettings } as Partial<NarrationApi>);
    await userEvent.click(screen.getByRole('button', { name: 'Turn on Record' }));
    await waitFor(() => expect(say).toHaveBeenCalled());
    expect(say.mock.calls[0]).toEqual([expect.stringMatching(/^Record could not be turned on: .*read-only/), 'error']);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('connect-lists-the-launcher-steps-with-the-path-to-copy', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { say } = mount(recordRefused('standalone'));
    expect(screen.getByRole('heading', { name: 'Connect REAPER to record' })).toBeTruthy();
    const steps = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain('Load ReaScript');
    expect(steps[0]).toContain(LAUNCHER);
    expect(steps[1]).toContain(LAUNCHER_ACTION);
    await userEvent.click(screen.getByRole('button', { name: 'Copy path' }));
    expect(writeText).toHaveBeenCalledWith(LAUNCHER);
    await waitFor(() => expect(say).toHaveBeenCalledWith('Launcher file path copied.'));
  });

  it('connect-starts-with-linking-the-project-when-none-is-linked-and-cannot-open-reaper-yet', async () => {
    const { onSettings } = mount(recordRefused('standalone', 'none'), { dawFileLinked: false, launcherPath: LAUNCHER });
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0].textContent).toContain('.rpp');
    await userEvent.click(screen.getByRole('button', { name: 'Link in Settings' }));
    expect(onSettings).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Open in REAPER and connect' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('open-and-connect-turns-on-the-launcher-start-then-launches-reaper', async () => {
    const order: string[] = [];
    const saveSettings = vi.fn(async (...args: unknown[]) => {
      order.push(`save ${JSON.stringify(args)}`);
      return createMockApi().bootstrap();
    });
    const launchDaw = vi.fn(async () => {
      order.push('launch');
      return { launched: true, path: 'C:\\Program Files\\REAPER (x64)\\reaper.exe', source: 'registry' };
    });
    const { say, onChanged } = mount(recordRefused('not_running'), LINKED, { saveSettings, launchDaw } as Partial<NarrationApi>);
    expect(screen.getByRole('heading', { name: 'REAPER is not answering' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open in REAPER and connect' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(order).toEqual([`save ${JSON.stringify(['DAW', 'global', { auto_start_launcher: 'true' }])}`, 'launch']);
    expect(say.mock.calls[0][0]).toMatch(/^REAPER is starting/);
  });

  it('open-and-connect-says-why-reaper-did-not-start', async () => {
    const launchDaw = vi.fn(async () => {
      throw new Error('REAPER was not found');
    });
    const { say } = mount(recordRefused('standalone'), LINKED, { launchDaw } as Partial<NarrationApi>);
    await userEvent.click(screen.getByRole('button', { name: 'Open in REAPER and connect' }));
    await waitFor(() => expect(say).toHaveBeenCalled());
    expect(say.mock.calls[0]).toEqual([expect.stringMatching(/^REAPER could not be started: .*not found/), 'error', 'daw-start']);
  });

  it('draws nothing while Record is available', () => {
    mount(DAW_SETUPS.reaper);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('useRecordControl follows the DAW live', () => {
  /** The DAW client of the connected setup whose capability and transport events the test sends by hand. */
  function liveClient(initial: DawCapabilities) {
    let onCapabilities: (next: DawCapabilities) => void = () => {};
    let onTransport: (next: DawTransport) => void = () => {};
    const client: DawClient = {
      ...dawClientFor('reaper'),
      capabilities: async () => initial,
      subscribeCapabilities: (listener) => ((onCapabilities = listener), () => {}),
      subscribeTransport: (listener) => ((onTransport = listener), () => {}),
    };
    return { client, capabilities: (next: DawCapabilities) => onCapabilities(next), transport: (next: DawTransport) => onTransport(next) };
  }

  function hook(initial: DawCapabilities) {
    const live = liveClient(initial);
    const notify = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider api={createMockApi()}>
        <PortOverrides clients={{ daw: live.client }}>{children}</PortOverrides>
      </ApiProvider>
    );
    const view = renderHook(() => useRecordControl({ chapterId: 'c1', notify }), { wrapper });
    return { ...live, notify, ...view };
  }

  it('record-turned-on-while-the-booth-is-open-enables-record', async () => {
    const { result, capabilities } = hook(recordRefused('experimental_off'));
    await waitFor(() => expect(result.current.disabled).toBe(true));
    act(() => capabilities(DAW_SETUPS.reaper));
    await waitFor(() => expect(result.current.disabled).toBe(false));
  });

  it('a-take-stopped-in-the-daw-ends-here-only-after-the-daw-was-heard-recording', async () => {
    const { result, transport, notify } = hook(DAW_SETUPS.reaper);
    await waitFor(() => expect(result.current.disabled).toBe(false));
    await act(() => result.current.toggle());
    expect(result.current.recording).toBe(true);
    // The stopped state from before the take, heard first, is not its end.
    act(() => transport({ playing: false, recording: false }));
    expect(result.current.recording).toBe(true);
    act(() => transport({ playing: true, recording: true, position: 3 }));
    act(() => transport({ playing: false, recording: false }));
    await waitFor(() => expect(result.current.recording).toBe(false));
    expect(notify).toHaveBeenCalledWith(stoppedInDaw('REAPER'), TAKE_TOPIC);
  });
});

describe('RecordSetup says what it waits for and when it last looked', () => {
  function mountChecked(capabilities: DawCapabilities, extra: Partial<React.ComponentProps<typeof RecordSetup>> = {}) {
    const onCheckAgain = vi.fn();
    render(
      <ApiProvider api={createMockApi()}>
        <RecordSetup
          capabilities={capabilities}
          facts={LINKED}
          say={vi.fn()}
          onSettings={vi.fn()}
          onChanged={vi.fn()}
          checkedAt={Date.now() - 7000}
          onCheckAgain={onCheckAgain}
          {...extra}
        />
      </ApiProvider>,
    );
    return { onCheckAgain };
  }

  it('connect-names-what-it-waits-for-and-the-last-check-and-offers-check-again', async () => {
    const { onCheckAgain } = mountChecked(recordRefused('standalone'));
    expect(screen.getByText(/Waiting for REAPER to connect/)).toBeTruthy();
    expect(screen.getByText(/Last checked \d+ s ago/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it('the-ticking-last-checked-time-is-not-in-a-live-region-a-screen-reader-would-repeat-every-second', () => {
    mountChecked(recordRefused('standalone'));
    const ticking = screen.getByText(/Last checked \d+ s ago/);
    expect(ticking.closest('[aria-live],[role="status"],[role="alert"]')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/Waiting for REAPER to connect/);
    expect(screen.getByRole('status').textContent).not.toMatch(/\d+ s ago/);
  });

  it('not-answering-says-the-heartbeat-went-quiet', () => {
    mountChecked(recordRefused('not_running'));
    expect(screen.getByText(/Waiting for REAPER to answer/)).toBeTruthy();
  });

  it('says-so-when-it-has-not-checked-yet', () => {
    mountChecked(recordRefused('standalone'), { checkedAt: null });
    expect(screen.getByText(/Not checked yet/)).toBeTruthy();
  });

  it('a-quiet-read-says-it-cannot-tell-instead-of-the-last-answer', () => {
    mountChecked(recordRefused('standalone'), { readFailed: true });
    expect(screen.getByText(/Can.t tell whether REAPER is connected/)).toBeTruthy();
  });

  it('does-not-claim-the-project-is-unlinked-when-the-link-state-could-not-be-read', () => {
    mountChecked(recordRefused('standalone'), { facts: { dawFileLinked: false, launcherPath: '' }, factsFailed: true });
    expect(screen.queryByRole('button', { name: 'Link in Settings' })).toBeNull();
    expect(screen.getByText(/Could not read whether a project file is linked/)).toBeTruthy();
  });

  it('turn-on-also-offers-check-again', () => {
    mountChecked(recordRefused('experimental_off'));
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });
});

describe('RecordSetup when the DAW has a different project open', () => {
  const different = { ...LINKED, openProject: 'different' as const };
  const linkResult = { selected: true, linked: true, path: 'D:/Audio/Open.rpp', insideProject: false };

  it("says what is wrong in the narrator's words and offers to link the open one, to open Settings and to check again", () => {
    mount(DAW_SETUPS.reaper, different);
    expect(screen.getByRole('heading', { name: 'REAPER has a different project open' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'REAPER has a different project open' }).textContent).toContain('would not land in the project linked here');
    expect(screen.getByRole('button', { name: 'Link the open project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DAW settings' })).toBeTruthy();
  });

  it('shows what it waits for and when it last looked, with Check again', async () => {
    const onCheckAgain = vi.fn();
    render(
      <ApiProvider api={createMockApi()}>
        <RecordSetup
          capabilities={DAW_SETUPS.reaper}
          facts={different}
          say={vi.fn()}
          onSettings={vi.fn()}
          onChanged={vi.fn()}
          checkedAt={Date.now() - 7000}
          onCheckAgain={onCheckAgain}
        />
      </ApiProvider>,
    );
    expect(screen.getByText('Waiting for REAPER to open the linked project.')).toBeTruthy();
    expect(screen.getByText('Last checked 7 s ago.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it('says it cannot tell, not the last answer, when the last read failed', () => {
    render(
      <ApiProvider api={createMockApi()}>
        <RecordSetup
          capabilities={DAW_SETUPS.reaper}
          facts={different}
          say={vi.fn()}
          onSettings={vi.fn()}
          onChanged={vi.fn()}
          readFailed
          onCheckAgain={vi.fn()}
        />
      </ApiProvider>,
    );
    expect(screen.getByText("Can't tell whether REAPER has the linked project open.")).toBeTruthy();
  });

  it('link-the-open-project opens the project picker once, however fast it is pressed, and reads the link facts again when it links', async () => {
    let finish: (value: typeof linkResult) => void = () => {};
    const linkDawFile = vi.fn(() => new Promise<typeof linkResult>((resolve) => (finish = resolve)));
    const { say, onChanged } = mount(DAW_SETUPS.reaper, different, { linkDawFile } as Partial<NarrationApi>);
    const button = screen.getByRole('button', { name: 'Link the open project' });
    await userEvent.dblClick(button);
    await userEvent.click(button);
    expect(linkDawFile).toHaveBeenCalledTimes(1);
    await act(async () => finish(linkResult));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(say).toHaveBeenCalledWith('REAPER project linked.');
  });

  it("says the host's note when it links a file outside the project folder", async () => {
    const linkDawFile = vi.fn(async () => ({ ...linkResult, note: 'Open.rpp is in D:/Audio.' }));
    const { say } = mount(DAW_SETUPS.reaper, different, { linkDawFile } as Partial<NarrationApi>);
    await userEvent.click(screen.getByRole('button', { name: 'Link the open project' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('REAPER project linked. Open.rpp is in D:/Audio.'));
  });

  it('a picker the narrator closes changes and says nothing; a file that cannot be linked says why', async () => {
    const linkDawFile = vi.fn(async () => ({ selected: false, linked: false }));
    const { say, onChanged } = mount(DAW_SETUPS.reaper, different, { linkDawFile } as Partial<NarrationApi>);
    await userEvent.click(screen.getByRole('button', { name: 'Link the open project' }));
    await waitFor(() => expect(linkDawFile).toHaveBeenCalled());
    expect(say).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    cleanup();
    const refused = vi.fn(async () => ({ selected: true, linked: false, message: 'That is not a REAPER project file.' }));
    const second = mount(DAW_SETUPS.reaper, different, { linkDawFile: refused } as Partial<NarrationApi>);
    await userEvent.click(screen.getByRole('button', { name: 'Link the open project' }));
    await waitFor(() => expect(second.say).toHaveBeenCalledWith('That is not a REAPER project file.', 'error'));
  });

  it('a host that throws says so, and the button is pressable again', async () => {
    const linkDawFile = vi.fn().mockRejectedValueOnce(new Error('the dialog failed')).mockResolvedValue(linkResult);
    const { say, onChanged } = mount(DAW_SETUPS.reaper, different, { linkDawFile } as Partial<NarrationApi>);
    await userEvent.click(screen.getByRole('button', { name: 'Link the open project' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith(expect.stringContaining('the dialog failed'), 'error'));
    await userEvent.click(screen.getByRole('button', { name: 'Link the open project' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('is not drawn once the open project is the linked one', () => {
    mount(DAW_SETUPS.reaper, { ...LINKED, openProject: 'same' });
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
