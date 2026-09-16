// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreviewAudio } from './usePreviewAudio';

class PreviewAudio {
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);

  constructor(readonly src: string) {}
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('usePreviewAudio', () => {
  it('ignores a stale request after the selected entity changes', async () => {
    let resolvePreview: (value: { status: 'ready'; url: string }) => void = () => {};
    const requestPreview = vi.fn(
      () =>
        new Promise<{ status: 'ready'; url: string }>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const notify = vi.fn();
    vi.stubGlobal('Audio', PreviewAudio);
    const { result, rerender } = renderHook(
      ({ resetKey }) =>
        usePreviewAudio({
          resetKey,
          requestPreview,
          onAssetRequired: vi.fn(),
          notify,
        }),
      { initialProps: { resetKey: 'first' } },
    );

    act(() => void result.current.playPreview());
    rerender({ resetKey: 'second' });
    await act(async () => resolvePreview({ status: 'ready', url: '/stale.wav' }));

    expect(requestPreview).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(result.current.playingPreview).toBeUndefined();
  });

  it('stops active audio when the feature unmounts', async () => {
    const previews: PreviewAudio[] = [];
    vi.stubGlobal(
      'Audio',
      class extends PreviewAudio {
        constructor(src: string) {
          super(src);
          previews.push(this);
        }
      },
    );
    const { result, unmount } = renderHook(() =>
      usePreviewAudio({
        resetKey: 'entry',
        requestPreview: async () => ({ status: 'ready', url: '/preview.wav' }),
        onAssetRequired: vi.fn(),
        notify: vi.fn(),
      }),
    );

    await act(async () => result.current.playPreview());
    expect(result.current.playingPreview).toBe('canonical');
    unmount();
    expect(previews[0].pause).toHaveBeenCalledTimes(1);
    expect(previews[0].currentTime).toBe(0);
  });
});
