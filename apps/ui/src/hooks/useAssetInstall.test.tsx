// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetInstallJob } from '../types';
import { useAssetInstall } from './useAssetInstall';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const job = (patch: Partial<AssetInstallJob> = {}): AssetInstallJob => ({
  id: 'job-1',
  phase: 'downloading',
  message: 'Downloading…',
  percent: 0,
  bytesDone: 0,
  bytesTotal: 1000,
  error: '',
  ...patch,
});

/** A scripted host: `start` answers the first job, `state` answers each step in order and then repeats the last one. */
function scripted(steps: AssetInstallJob[]) {
  let at = 0;
  return {
    start: vi.fn(async () => steps[0]),
    state: vi.fn(async () => steps[Math.min(++at, steps.length - 1)]),
    cancel: vi.fn(async () => job({ phase: 'cancelled', message: 'Voice download cancelled.' })),
  };
}

const settle = async (ms = 400) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useAssetInstall', () => {
  it('shows every step the host reports, from the first bytes to success, and calls onSuccess once', async () => {
    const host = scripted([
      job(),
      job({ percent: 40, bytesDone: 400 }),
      job({ phase: 'verifying', percent: 99, bytesDone: 1000, message: 'Checking…' }),
      job({ phase: 'success', percent: 100, bytesDone: 1000, message: 'Voice installed and verified.' }),
    ]);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAssetInstall({ ...host, onSuccess }));
    await act(async () => {
      void result.current.begin();
    });
    expect(result.current.job?.phase).toBe('downloading');
    await settle();
    expect(result.current.job).toMatchObject({ percent: 40, bytesDone: 400 });
    await settle();
    expect(result.current.job?.phase).toBe('verifying');
    await settle();
    expect(result.current.job?.phase).toBe('success');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(host.state).toHaveBeenCalledTimes(3);
    expect(host.state).toHaveBeenCalledWith('job-1');
    await settle(2000);
    expect(host.state).toHaveBeenCalledTimes(3);
  });

  it('starts one install however many times it is asked while one is running', async () => {
    const host = scripted([job()]);
    const { result } = renderHook(() => useAssetInstall(host));
    await act(async () => {
      void result.current.begin();
      void result.current.begin();
      void result.current.begin();
    });
    expect(host.start).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(true);
  });

  it('reports a job that ended in error once, with the host sentence, and does not call onSuccess', async () => {
    const sentence = 'The downloaded voice did not match the approved file, so it was not installed.';
    const host = scripted([job(), job({ phase: 'error', message: sentence, error: sentence })]);
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() => useAssetInstall({ ...host, onSuccess, onFailure }));
    await act(async () => {
      void result.current.begin();
    });
    await settle();
    expect(result.current.job?.error).toBe(sentence);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(sentence);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
  });

  it('turns a failed call into a failure sentence and lets the narrator try again', async () => {
    const host = {
      ...scripted([job()]),
      start: vi
        .fn()
        .mockRejectedValueOnce(new Error('the host is not answering'))
        .mockResolvedValue(job({ phase: 'success', percent: 100 })),
    };
    const { result } = renderHook(() => useAssetInstall(host));
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.failure).toBe('the host is not answering');
    expect(result.current.running).toBe(false);
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.failure).toBe('');
    expect(result.current.job?.phase).toBe('success');
  });

  it('cancels the running job and shows the host answer, without calling onSuccess', async () => {
    const host = scripted([job(), job({ phase: 'cancelled', message: 'Voice download cancelled.' })]);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAssetInstall({ ...host, onSuccess }));
    await act(async () => {
      void result.current.begin();
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(host.cancel).toHaveBeenCalledWith('job-1');
    expect(result.current.job?.phase).toBe('cancelled');
    await settle();
    expect(result.current.running).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('stops polling and never calls onSuccess once the page that started it has gone', async () => {
    const host = scripted([job(), job({ phase: 'success', percent: 100 })]);
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() => useAssetInstall({ ...host, onSuccess }));
    await act(async () => {
      void result.current.begin();
    });
    unmount();
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.state).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('reset forgets the job so a dialog can be dismissed, and a later begin starts fresh', async () => {
    const host = scripted([job({ phase: 'error', message: 'It failed.', error: 'It failed.' })]);
    const { result } = renderHook(() => useAssetInstall(host));
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.job?.phase).toBe('error');
    act(() => result.current.reset());
    expect(result.current.job).toBeUndefined();
    expect(result.current.failure).toBe('');
    await act(async () => {
      await result.current.begin();
    });
    expect(host.start).toHaveBeenCalledTimes(2);
  });

  it('keeps each distinct message once, in order, and counts the seconds it has been running', async () => {
    const host = scripted([
      job({ message: 'Downloading…' }),
      job({ message: 'Downloading…', percent: 50, bytesDone: 500 }),
      job({ phase: 'verifying', message: 'Checking…' }),
      job({ phase: 'success', message: 'Done.' }),
    ]);
    const { result } = renderHook(() => useAssetInstall(host));
    await act(async () => {
      void result.current.begin();
    });
    await settle(1200);
    expect(result.current.log).toEqual(['Downloading…', 'Checking…', 'Done.']);
    expect(result.current.seconds).toBeGreaterThanOrEqual(1);
  });

  it('reset while the install is running stops following it, and the host job is left to finish', async () => {
    const host = scripted([job(), job({ percent: 40, bytesDone: 400 })]);
    const { result } = renderHook(() => useAssetInstall(host));
    await act(async () => {
      void result.current.begin();
    });
    act(() => result.current.reset());
    await settle(2000);
    expect(host.state).not.toHaveBeenCalled();
    expect(result.current.job).toBeUndefined();
    expect(result.current.running).toBe(false);
  });

  it('a poll answer asked for before a Cancel was answered does not put Cancel back', async () => {
    let releaseState: (job: AssetInstallJob) => void = () => {};
    const host = {
      start: vi.fn(async () => job()),
      state: vi.fn(() => new Promise<AssetInstallJob>((resolve) => (releaseState = resolve))),
      cancel: vi.fn(async () => job({ phase: 'cancelled', message: 'Voice download cancelled.' })),
    };
    const { result } = renderHook(() => useAssetInstall(host));
    await act(async () => {
      void result.current.begin();
    });
    await settle(400); // the poll is now in flight
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.job?.phase).toBe('cancelled');
    await act(async () => {
      releaseState(job({ percent: 41, bytesDone: 410 })); // the answer that was asked for before the cancel
    });
    expect(result.current.job?.phase).toBe('cancelled');
    expect(result.current.running).toBe(false);
  });

  it('says why a Cancel did not work and leaves the running job showing', async () => {
    const host = { ...scripted([job()]), cancel: vi.fn().mockRejectedValue(new Error('the host is busy')) };
    const { result } = renderHook(() => useAssetInstall(host));
    await act(async () => {
      void result.current.begin();
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.cancelFailure).toBe('the host is busy');
    expect(result.current.job?.phase).toBe('downloading');
    expect(result.current.failure).toBe('');
  });

  it('leaving the page while the start call is in flight ends quietly', async () => {
    let settleStart: (job: AssetInstallJob) => void = () => {};
    const host = { ...scripted([job()]), start: vi.fn(() => new Promise<AssetInstallJob>((resolve) => (settleStart = resolve))) };
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() => useAssetInstall({ ...host, onSuccess }));
    await act(async () => {
      void result.current.begin();
    });
    unmount();
    await act(async () => {
      settleStart(job({ phase: 'success', percent: 100 }));
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(host.state).not.toHaveBeenCalled();
  });

  it('runs one install under StrictMode, which mounts every effect twice', async () => {
    const host = scripted([job(), job({ phase: 'success', percent: 100 })]);
    const onSuccess = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useAssetInstall({ ...host, onSuccess }), { wrapper });
    await act(async () => {
      void result.current.begin();
    });
    await settle();
    expect(host.start).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
