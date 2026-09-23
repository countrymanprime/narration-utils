// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkJob } from '../types';
import { useWorkJob } from './useWorkJob';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const job = (phase: WorkJob['phase'], extra: Partial<WorkJob> = {}): WorkJob => ({
  id: 'job-1',
  kind: 'story_bible',
  phase,
  message: phase,
  percent: 10,
  logs: [],
  elapsed: 1,
  ...extra,
});

// Lets every queued promise callback run, so a poll's answer reaches state inside act().
const flush = () => act(async () => void (await Promise.resolve()));

describe('useWorkJob', () => {
  it('does not poll while there is no job, or while the job is in a phase it does not follow', async () => {
    const poll = vi.fn(async () => job('running'));
    const { result } = renderHook(() => useWorkJob({ poll }));
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(poll).not.toHaveBeenCalled();
    act(() => result.current[1](job('ready')));
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(poll).not.toHaveBeenCalled();
    expect(result.current[0]?.phase).toBe('ready');
  });

  it('polls a running job at once and then every interval, and shows each answer the host gives', async () => {
    const answers = [job('running', { percent: 20 }), job('running', { percent: 60 })];
    const poll = vi.fn(async () => answers.shift() ?? job('running', { percent: 90 }));
    const { result } = renderHook(() => useWorkJob({ poll, intervalMs: 250 }));
    act(() => result.current[1](job('running')));
    await flush();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
    expect(result.current[0]?.percent).toBe(20);
    await act(async () => void vi.advanceTimersByTime(250));
    await flush();
    expect(result.current[0]?.percent).toBe(60);
  });

  it('follows the phases it is told to, and keeps a reported success on screen by default', async () => {
    const poll = vi.fn(async () => job('success'));
    const { result } = renderHook(() => useWorkJob({ poll, pollingPhases: ['preparing', 'committing'], intervalMs: 200 }));
    act(() => result.current[1](job('committing')));
    await flush();
    expect(result.current[0]?.phase).toBe('success');
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('runs onSuccess and waits for it before clearing the job, so nothing renders on stale data in between', async () => {
    let finishReload: () => void = () => {};
    const onSuccess = vi.fn(() => new Promise<void>((resolve) => (finishReload = resolve)));
    const { result } = renderHook(() => useWorkJob({ poll: async () => job('success'), onSuccess }));
    act(() => result.current[1](job('running')));
    await flush();
    expect(onSuccess).toHaveBeenCalled();
    expect(result.current[0]?.phase).toBe('running');
    await act(async () => finishReload());
    expect(result.current[0]).toBeUndefined();
  });

  it('turns a failed poll into an error the dialog shows, in the words the narrator reads', async () => {
    const poll = vi.fn(async () => {
      throw new Error('the host stopped answering');
    });
    const { result } = renderHook(() => useWorkJob({ poll }));
    act(() => result.current[1](job('running')));
    await flush();
    expect(result.current[0]?.phase).toBe('error');
    expect(result.current[0]?.error).toMatch(/the host stopped answering/);
    expect(result.current[0]?.message).toBe(result.current[0]?.error);
    expect(result.current[0]?.id).toBe('job-1');
  });

  it('stops polling and ignores a late answer once it unmounts', async () => {
    let answer: (value: WorkJob) => void = () => {};
    const poll = vi.fn(() => new Promise<WorkJob>((resolve) => (answer = resolve)));
    const { result, unmount } = renderHook(() => useWorkJob({ poll }));
    act(() => result.current[1](job('running')));
    const seen = result.current[0];
    unmount();
    await act(async () => answer(job('error')));
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(poll).toHaveBeenCalledTimes(1);
    expect(seen?.phase).toBe('running');
  });
});
