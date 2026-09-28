// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { RecordingMockSeed } from '../../api/recordingMock';
import type { NarrationApi } from '../../types';
import { TooltipProvider } from '../primitives/Tooltip';
import { peakText, RecordButton, RecorderSetup, RecorderStatus, RecorderTakes } from './BuiltinRecorder';
import { useRecorder, useRecordingEngine, type Recorder } from './useRecorder';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockApi(recording: RecordingMockSeed = {}): NarrationApi {
  return createMockApi({}, { recording });
}

function wrapper(api: NarrationApi) {
  return ({ children }: { children: ReactNode }) => createElement(ApiProvider, { api, children: createElement(TooltipProvider, null, children) });
}

/** Renders every recorder surface over one useRecorder, as the Booth does. */
function Surfaces() {
  const recorder = useRecorder();
  return (
    <>
      <RecorderStatus recorder={recorder} />
      <RecorderSetup recorder={recorder} />
      <RecordButton recorder={recorder} />
      <RecorderTakes recorder={recorder} />
    </>
  );
}

function renderSurfaces(api: NarrationApi) {
  return render(<Surfaces />, { wrapper: wrapper(api) });
}

describe('the built-in recorder in the Booth', () => {
  it('a project on REAPER offers "Record with" and nothing of the recorder else', async () => {
    renderSurfaces(mockApi());
    const choice = await screen.findByRole('group', { name: 'Record with' });
    expect(within(choice).getByRole('button', { name: 'REAPER' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Experimental')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Takes' })).toBeNull();
    expect(screen.queryByLabelText('Recorder input')).toBeNull();
  });

  it('choosing the built-in recorder lists its devices, its folder and the takes', async () => {
    const api = mockApi();
    renderSurfaces(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Built-in recorder' }));

    expect(await screen.findByRole('heading', { name: 'Takes' })).toBeTruthy();
    expect(((await screen.findByLabelText('Recorder input')) as HTMLSelectElement).value).toBe('Analogue 1 + 2 (Focusrite USB Audio)');
    expect(screen.getByText('C:/Projects/Alice/Recordings')).toBeTruthy();
    expect(screen.getByText(/Recorded/).textContent).toMatch('Recorded 01:55 · 3 takes');
    expect(screen.getByText('Unfinished')).toBeTruthy();
    // Newest first.
    expect(screen.getAllByRole('button', { name: /^Play Take/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Play Take 003',
      'Play Take 002',
      'Play Take 001',
    ]);
    expect(screen.getByRole('group', { name: 'Built-in recorder, 3 takes' })).toBeTruthy();
    expect((await api.recorderState()).engine).toBe('builtin');
  });

  it('Record starts a take, shows REC and the level, and Stop saves the next take', async () => {
    renderSurfaces(mockApi({ engine: 'builtin' }));
    const record = await screen.findByRole('button', { name: 'Record a take' });
    await waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(record);

    const stop = await screen.findByRole('button', { name: /^Stop recording, 00:0\d$/ });
    expect(stop.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('group', { name: 'Built-in recorder, take 4' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('−14.2 pk')).toBeTruthy());
    // The meter button is off while a take records, and the engine cannot change.
    expect((screen.getByRole('button', { name: 'Check level' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'REAPER' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(stop);
    expect(await screen.findByRole('button', { name: 'Play Take 004' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record a take' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Check level meters the chosen device before a take and stops again', async () => {
    const api = mockApi({ engine: 'builtin' });
    const meter = vi.spyOn(api, 'recorderMeterStart');
    renderSurfaces(api);
    const check = await screen.findByRole('button', { name: 'Check level' });
    await waitFor(() => expect((check as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(check);
    await waitFor(() => expect(meter).toHaveBeenCalledWith('Analogue 1 + 2 (Focusrite USB Audio)'));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop level check' }));
    expect(await screen.findByRole('button', { name: 'Check level' })).toBeTruthy();
  });

  it('a refused start says why', async () => {
    renderSurfaces(mockApi({ engine: 'builtin', startFails: true }));
    const record = await screen.findByRole('button', { name: 'Record a take' });
    await waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(record);
    expect((await screen.findByRole('alert')).textContent).toMatch('could not open Analogue 1 + 2 (Focusrite USB Audio)');
  });

  it('a take that ended by itself is said once, with the dropouts', async () => {
    renderSurfaces(mockApi({ engine: 'builtin', lastTakeFailed: true }));
    expect((await screen.findByRole('status')).textContent).toMatch('Analogue 1 + 2 (Focusrite USB Audio) stopped delivering audio');
  });

  it('where the row is unavailable the built-in recorder cannot be chosen and says why', async () => {
    renderSurfaces(mockApi({ unavailable: true }));
    expect(((await screen.findByRole('button', { name: 'Built-in recorder' })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('WASAPI is not available on Linux.')).toBeTruthy();
  });

  it('no device listed blocks Record', async () => {
    renderSurfaces(mockApi({ engine: 'builtin', takes: 'none', devices: 'none' }));
    expect(await screen.findByText('No microphone found')).toBeTruthy();
    expect(screen.getByText(/Recording cannot start until a device is listed/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Record a take' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('No takes yet. Record starts the first.')).toBeTruthy();
  });

  it('without a project nothing of the recorder shows', async () => {
    renderSurfaces(mockApi({ hasProject: false }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Built-in recorder, no takes yet' })).toBeTruthy());
    expect(screen.queryByRole('group', { name: 'Record with' })).toBeNull();
  });

  it('Play plays a take through the media route and Stop stops it', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    renderSurfaces(mockApi({ engine: 'builtin' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play Take 003' }));
    expect(play).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Take 003' }));
    expect(pause).toHaveBeenCalled();
  });

  it('leaving the Booth stops a take so it never records on unseen', async () => {
    const api = mockApi({ engine: 'builtin', recording: true });
    const stop = vi.spyOn(api, 'recorderStop');
    const { result, unmount } = renderHook(() => useRecorder(), { wrapper: wrapper(api) });
    await waitFor(() => expect((result.current as Recorder).recording).toBe(true));
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});

describe('useRecordingEngine', () => {
  it("follows the project's engine for the engine chip", async () => {
    const api = mockApi();
    const { result } = renderHook(() => useRecordingEngine(), { wrapper: wrapper(api) });
    expect(result.current).toBe('daw');
    await act(async () => {
      await api.recorderChooseEngine('builtin');
    });
    expect(result.current).toBe('builtin');
  });
});

describe('peakText', () => {
  it('reads like mock 03, with a real minus sign, and a dash in silence', () => {
    expect(peakText(-14.2)).toBe('−14.2 pk');
    expect(peakText(0)).toBe('0.0 pk');
    expect(peakText(null)).toBe('— pk');
    expect(peakText(-100)).toBe('— pk');
  });
});
