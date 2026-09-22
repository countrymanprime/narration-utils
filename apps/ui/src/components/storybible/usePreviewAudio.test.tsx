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

// A few bytes of base64: the hook only decodes it, and a real WAV is not needed.
const READY_AUDIO = 'UklGRg==';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Ready = { status: 'ready'; audioBase64: string; mimeType: string };

/** Renders the hook against a preview request that a test scripts one call at a time. */
function renderPreviewHook(requests: Array<() => Promise<Ready>>, audioClass: new (src: string) => PreviewAudio = PreviewAudio) {
  vi.stubGlobal('Audio', audioClass);
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
  const notify = vi.fn();
  const requestPreview = vi.fn(() => (requests.shift() ?? (() => Promise.reject(new Error('unscripted request'))))());
  const hook = renderHook(() => usePreviewAudio({ resetKey: 'entry', requestPreview, onAssetRequired: vi.fn(), notify }));
  return { ...hook, notify, requestPreview };
}

const ready = (audioBase64 = READY_AUDIO): Ready => ({ status: 'ready', audioBase64, mimeType: 'audio/wav' });

describe('usePreviewAudio failures', () => {
  it('says why the host could not render, without an "Error:" prefix, and lets the next click retry', async () => {
    const { result, notify, requestPreview } = renderPreviewHook([
      () => Promise.reject(new Error('the preview took longer than 2m0s and was stopped; try again')),
      () => Promise.resolve(ready()),
    ]);

    await act(async () => result.current.playPreview());
    expect(notify).toHaveBeenCalledWith('The preview took longer than 2m0s and was stopped; try again', 'error');
    expect(result.current.playingPreview).toBeUndefined();

    await act(async () => result.current.playPreview());
    expect(requestPreview).toHaveBeenCalledTimes(2);
    expect(result.current.playingPreview).toBe('canonical');
  });

  it('reports the host reason when Wails rejects with a plain string', async () => {
    const { result, notify } = renderPreviewHook([() => Promise.reject('"..." could not be spoken: the voice produced no audio for it.')]);

    await act(async () => result.current.playPreview());

    expect(notify).toHaveBeenCalledWith('"..." could not be spoken: the voice produced no audio for it.', 'error');
    expect(result.current.playingPreview).toBeUndefined();
  });

  it('refuses an empty preview instead of handing the browser a zero-byte file', async () => {
    const { result, notify } = renderPreviewHook([() => Promise.resolve(ready(''))]);

    await act(async () => result.current.playPreview());

    expect(notify).toHaveBeenCalledWith('The preview audio was empty. Try playing it again.', 'error');
    expect(result.current.playingPreview).toBeUndefined();
  });

  it('reports audio that cannot be decoded', async () => {
    const { result, notify } = renderPreviewHook([() => Promise.resolve(ready('***not base64***'))]);

    await act(async () => result.current.playPreview());

    expect(notify).toHaveBeenCalledWith('The preview audio was not valid. Try playing it again.', 'error');
    expect(result.current.playingPreview).toBeUndefined();
  });

  it('names the browser reason when playback is rejected, and resets so play works again', async () => {
    let rejectNext = true;
    class RejectingAudio extends PreviewAudio {
      play = vi.fn(() => {
        if (!rejectNext) return Promise.resolve();
        rejectNext = false;
        return Promise.reject(new DOMException('The element has no supported sources.', 'NotSupportedError'));
      });
    }
    const { result, notify } = renderPreviewHook([() => Promise.resolve(ready()), () => Promise.resolve(ready())], RejectingAudio);

    await act(async () => result.current.playPreview());
    expect(notify).toHaveBeenCalledWith('Preview audio could not be played (NotSupportedError: The element has no supported sources.).', 'error');
    expect(result.current.playingPreview).toBeUndefined();

    await act(async () => result.current.playPreview());
    expect(result.current.playingPreview).toBe('canonical');
  });

  it('resets to idle when the audio element reports an error', async () => {
    const audios: PreviewAudio[] = [];
    class ErroringAudio extends PreviewAudio {
      constructor(src: string) {
        super(src);
        audios.push(this);
      }
    }
    const { result, notify } = renderPreviewHook([() => Promise.resolve(ready())], ErroringAudio);

    await act(async () => result.current.playPreview());
    expect(result.current.playingPreview).toBe('canonical');
    act(() => audios[0].onerror?.());

    expect(notify).toHaveBeenCalledWith('Preview audio could not be played.', 'error');
    expect(result.current.playingPreview).toBeUndefined();
  });

  it('does not report a corrupt file twice when both onerror and play() reject', async () => {
    const audios: PreviewAudio[] = [];
    class CorruptAudio extends PreviewAudio {
      play = vi.fn(() => {
        // The element fires its error event, then the pending play() promise rejects.
        audios[0].onerror?.();
        return Promise.reject(new DOMException('The element has no supported sources.', 'NotSupportedError'));
      });
      constructor(src: string) {
        super(src);
        audios.push(this);
      }
    }
    const { result, notify } = renderPreviewHook([() => Promise.resolve(ready())], CorruptAudio);

    await act(async () => result.current.playPreview());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Preview audio could not be played.', 'error');
    expect(result.current.playingPreview).toBeUndefined();
  });

  it('stays quiet when the narrator stops a preview that is still starting', async () => {
    let rejectPlay: (reason: unknown) => void = () => {};
    const playCalls = vi.fn();
    class PendingAudio extends PreviewAudio {
      play = vi.fn(() => {
        playCalls();
        return new Promise<void>((_resolve, reject) => (rejectPlay = reject));
      });
    }
    const { result, notify } = renderPreviewHook([() => Promise.resolve(ready())], PendingAudio);

    let starting: Promise<void> = Promise.resolve();
    act(() => {
      starting = result.current.playPreview();
    });
    await vi.waitFor(() => expect(playCalls).toHaveBeenCalledTimes(1));
    act(() => result.current.stopPreview());
    await act(async () => {
      rejectPlay(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
      await starting;
    });

    expect(notify).not.toHaveBeenCalled();
    expect(result.current.playingPreview).toBeUndefined();
  });

  it('treats whitespace-only audio as empty and never gives an empty rejection a blank message', async () => {
    const { result, notify } = renderPreviewHook([() => Promise.resolve(ready('   ')), () => Promise.reject(new Error(''))]);

    await act(async () => result.current.playPreview());
    expect(notify).toHaveBeenLastCalledWith('The preview audio was empty. Try playing it again.', 'error');

    await act(async () => result.current.playPreview());
    expect(notify).toHaveBeenLastCalledWith('Unknown error', 'error');
  });
});

describe('usePreviewAudio', () => {
  it('ignores a stale request after the selected entity changes', async () => {
    let resolvePreview: (value: { status: 'ready'; audioBase64: string; mimeType: string }) => void = () => {};
    const requestPreview = vi.fn(
      () =>
        new Promise<{ status: 'ready'; audioBase64: string; mimeType: string }>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const notify = vi.fn();
    vi.stubGlobal('Audio', PreviewAudio);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
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
    await act(async () => resolvePreview({ status: 'ready', audioBase64: READY_AUDIO, mimeType: 'audio/wav' }));

    expect(requestPreview).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(result.current.playingPreview).toBeUndefined();
  });

  it('stops active audio when the feature unmounts', async () => {
    const previews: PreviewAudio[] = [];
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
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
        requestPreview: async () => ({ status: 'ready', audioBase64: READY_AUDIO, mimeType: 'audio/wav' }),
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
