// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { useRecordInReaper } from './useRecordInReaper';
import type { NarrationApi, ReadAloudRecording, ScopedSettingField } from '../../types';

function field(key: string, effectiveValue: string): ScopedSettingField {
  return { key, label: key, kind: 'bool', choices: [], value: effectiveValue, isSet: true, effectiveValue, effectiveSource: 'project' };
}

function fakeApi(overrides: Partial<NarrationApi> = {}): NarrationApi {
  return {
    settingsForScope: vi.fn(async () => ({})),
    saveSettings: vi.fn(async () => ({}) as never),
    readAloudArmOnly: vi.fn(async () => ({ outcome: 'armed' }) as ReadAloudRecording),
    readAloudRecordStart: vi.fn(async () => ({ outcome: 'started', trackGuid: '{1}', position: 0 }) as ReadAloudRecording),
    readAloudRecordStop: vi.fn(async () => ({ outcome: 'stopped', restored: 0, kept: 0 }) as ReadAloudRecording),
    ...overrides,
  } as unknown as NarrationApi;
}

function wrapper(api: NarrationApi) {
  return ({ children }: { children: ReactNode }) => createElement(ApiProvider, { api, children });
}

describe('useRecordInReaper', () => {
  it('reads the project-scope setting once and reports it loaded', async () => {
    const settingsForScope = vi.fn(async () => ({ ReadAloud: [field('record_in_reaper', 'true'), field('record_confirmed', 'true')] }));
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ settingsForScope })) });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.enabled).toBe(true);
    expect(settingsForScope).toHaveBeenCalledWith('project');
  });

  it('defaults off and unconfirmed when the project has never set it', async () => {
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi()) });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.enabled).toBe(false);
  });

  it('turning the toggle on for the first time asks for confirmation instead of saving at once', async () => {
    const saveSettings = vi.fn(async () => ({}) as never);
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ saveSettings })) });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.toggle());

    expect(result.current.confirmPending).toBe(true);
    expect(result.current.enabled).toBe(false);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('confirming turns the toggle on and remembers both the choice and that it was confirmed', async () => {
    const saveSettings = vi.fn(async () => ({}) as never);
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ saveSettings })) });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.toggle());

    act(() => result.current.confirm());

    expect(result.current.confirmPending).toBe(false);
    expect(result.current.enabled).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith('ReadAloud', 'project', { record_in_reaper: 'true', record_confirmed: 'true' });
  });

  it('cancelling the confirm leaves the toggle off', async () => {
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi()) });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.toggle());

    act(() => result.current.cancelConfirm());

    expect(result.current.confirmPending).toBe(false);
    expect(result.current.enabled).toBe(false);
  });

  it('turning the toggle off (once confirmed before) saves at once, with no confirm', async () => {
    const settingsForScope = vi.fn(async () => ({ ReadAloud: [field('record_in_reaper', 'true'), field('record_confirmed', 'true')] }));
    const saveSettings = vi.fn(async () => ({}) as never);
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ settingsForScope, saveSettings })) });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => result.current.toggle());

    expect(result.current.enabled).toBe(false);
    expect(result.current.confirmPending).toBe(false);
    expect(saveSettings).toHaveBeenCalledWith('ReadAloud', 'project', { record_in_reaper: 'false' });
  });

  it('turning it on again after it was confirmed before does not ask again', async () => {
    const settingsForScope = vi.fn(async () => ({ ReadAloud: [field('record_in_reaper', 'false'), field('record_confirmed', 'true')] }));
    const saveSettings = vi.fn(async () => ({}) as never);
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ settingsForScope, saveSettings })) });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.toggle());

    expect(result.current.confirmPending).toBe(false);
    expect(result.current.enabled).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith('ReadAloud', 'project', { record_in_reaper: 'true' });
  });

  it('armOnly asks the host and surfaces a refusal as an error', async () => {
    const readAloudArmOnly = vi.fn(
      async () => ({ outcome: 'refused', reason: 'already_recording', message: 'REAPER is already recording.' }) as ReadAloudRecording,
    );
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ readAloudArmOnly })) });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // A synchronous act() callback (the promise is discarded, not returned) so React flushes the immediate
    // setArmPending(true) before this assertion, rather than switching act() into async mode.
    act(() => {
      void result.current.armOnly();
    });
    expect(result.current.armPending).toBe(true);

    await waitFor(() => expect(result.current.armPending).toBe(false));
    expect(readAloudArmOnly).toHaveBeenCalledWith('chapter-1');
    expect(result.current.error).toBe('REAPER is already recording.');
  });

  it('beforeStart does nothing and answers true when the toggle is off', async () => {
    const readAloudRecordStart = vi.fn();
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ readAloudRecordStart })) });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => expect(await result.current.beforeStart()).toBe(true));
    expect(readAloudRecordStart).not.toHaveBeenCalled();
  });

  it('beforeStart does nothing and answers true when the capability is unavailable, even with the toggle on', async () => {
    const settingsForScope = vi.fn(async () => ({ ReadAloud: [field('record_in_reaper', 'true'), field('record_confirmed', 'true')] }));
    const readAloudRecordStart = vi.fn();
    const { result } = renderHook(() => useRecordInReaper('chapter-1', false), { wrapper: wrapper(fakeApi({ settingsForScope, readAloudRecordStart })) });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => expect(await result.current.beforeStart()).toBe(true));
    expect(readAloudRecordStart).not.toHaveBeenCalled();
  });

  it('beforeStart does nothing and answers true with no chapter (credits mode), even with the toggle on', async () => {
    const settingsForScope = vi.fn(async () => ({ ReadAloud: [field('record_in_reaper', 'true'), field('record_confirmed', 'true')] }));
    const readAloudRecordStart = vi.fn();
    const { result } = renderHook(() => useRecordInReaper(undefined, true), { wrapper: wrapper(fakeApi({ settingsForScope, readAloudRecordStart })) });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => expect(await result.current.beforeStart()).toBe(true));
    expect(readAloudRecordStart).not.toHaveBeenCalled();
  });

  it('beforeStart starts the recording and answers true on "started"', async () => {
    const settingsForScope = vi.fn(async () => ({ ReadAloud: [field('record_in_reaper', 'true'), field('record_confirmed', 'true')] }));
    const readAloudRecordStart = vi.fn(async () => ({ outcome: 'started', trackGuid: '{1}', position: 3 }) as ReadAloudRecording);
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ settingsForScope, readAloudRecordStart })) });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => expect(await result.current.beforeStart()).toBe(true));
    expect(readAloudRecordStart).toHaveBeenCalledWith('chapter-1');
    expect(result.current.recording).toBe(true);
    expect(result.current.error).toBeUndefined();
  });

  it('beforeStart answers false and sets error on a refusal, and never marks itself recording', async () => {
    const settingsForScope = vi.fn(async () => ({ ReadAloud: [field('record_in_reaper', 'true'), field('record_confirmed', 'true')] }));
    const readAloudRecordStart = vi.fn(
      async () => ({ outcome: 'refused', reason: 'not_armed', message: 'No track is armed in REAPER.' }) as ReadAloudRecording,
    );
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ settingsForScope, readAloudRecordStart })) });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => expect(await result.current.beforeStart()).toBe(false));
    expect(result.current.recording).toBe(false);
    expect(result.current.error).toBe('No track is armed in REAPER.');
  });

  it('afterStop is a no-op unless beforeStart actually started a recording', async () => {
    const readAloudRecordStop = vi.fn();
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), { wrapper: wrapper(fakeApi({ readAloudRecordStop })) });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.afterStop());

    expect(readAloudRecordStop).not.toHaveBeenCalled();
  });

  it('afterStop stops a recording this hook started, and clears the recording flag', async () => {
    const settingsForScope = vi.fn(async () => ({ ReadAloud: [field('record_in_reaper', 'true'), field('record_confirmed', 'true')] }));
    const readAloudRecordStart = vi.fn(async () => ({ outcome: 'started', trackGuid: '{1}', position: 0 }) as ReadAloudRecording);
    const readAloudRecordStop = vi.fn(async () => ({ outcome: 'stopped', restored: 1, kept: 0 }) as ReadAloudRecording);
    const { result } = renderHook(() => useRecordInReaper('chapter-1', true), {
      wrapper: wrapper(fakeApi({ settingsForScope, readAloudRecordStart, readAloudRecordStop })),
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await act(async () => {
      await result.current.beforeStart();
    });
    expect(result.current.recording).toBe(true);

    act(() => result.current.afterStop());

    expect(result.current.recording).toBe(false);
    await waitFor(() => expect(readAloudRecordStop).toHaveBeenCalledTimes(1));
  });
});
