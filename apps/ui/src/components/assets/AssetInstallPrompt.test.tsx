// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetInstallJob } from '../../types';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import { AssetInstallPrompt } from './AssetInstallPrompt';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const job = (patch: Partial<AssetInstallJob> = {}): AssetInstallJob => ({
  id: 'job-1',
  kind: 'tts',
  assetId: 'v',
  phase: 'downloading',
  message: 'Downloading and verifying the approved voice…',
  percent: 0,
  bytesDone: 0,
  bytesTotal: 100 * 1024 * 1024,
  error: '',
  ...patch,
});

function Harness({ steps, dismiss = vi.fn(), onSuccess = vi.fn() }: { steps: AssetInstallJob[]; dismiss?: () => void; onSuccess?: () => void }) {
  const at = useRef(0);
  const install = useAssetInstall({
    start: async () => steps[0],
    state: async () => steps[Math.min(++at.current, steps.length - 1)],
    cancel: async () => job({ phase: 'cancelled', message: 'Voice download cancelled.' }),
    onSuccess,
  });
  return (
    <AssetInstallPrompt
      ask={{ title: 'Download local preview voice?', body: 'It is not bundled.', confirmLabel: 'Download voice' }}
      workTitle="Downloading preview voice"
      install={install}
      dismiss={dismiss}
    >
      <p>Voice: LJ Speech</p>
    </AssetInstallPrompt>
  );
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('AssetInstallPrompt', () => {
  it('asks first, with what the caller says about the asset, and starts nothing until Download is pressed', () => {
    render(<Harness steps={[job()]} />);
    expect(screen.getByRole('alertdialog', { name: 'Download local preview voice?' })).toBeTruthy();
    expect(screen.getByText('Voice: LJ Speech')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('then shows the real bytes so far, the percent and a Cancel that stops the download', async () => {
    render(<Harness steps={[job(), job({ percent: 40, bytesDone: 40 * 1024 * 1024 })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download voice' }));
    await advance(400);
    expect(screen.getByRole('dialog', { name: 'Downloading preview voice' })).toBeTruthy();
    expect(screen.getByText(/40 of 100 MB/)).toBeTruthy();
    // The bytes are outside the live region, so a screen reader is not told about every poll; the bar carries them.
    expect(screen.getByRole('status').textContent).not.toMatch(/MB/);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('40 of 100 MB');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await advance(0);
    expect(screen.getAllByText('Voice download cancelled.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('while the files are being checked there is no Cancel, and the dialog says so', async () => {
    render(
      <Harness
        steps={[job(), job({ phase: 'verifying', percent: 99, bytesDone: 100 * 1024 * 1024, message: 'Checking the voice against its approved checksum…' })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download voice' }));
    await advance(400);
    expect(screen.getAllByText(/Checking the voice/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByText(/cannot be cancelled/i)).toBeTruthy();
  });

  it('shows a failure as an alert with Close, and Close dismisses the prompt', async () => {
    const dismiss = vi.fn();
    const sentence = 'The voice could not be downloaded. Check your internet connection and try again.';
    render(<Harness dismiss={dismiss} steps={[job(), job({ phase: 'error', message: sentence, error: sentence })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download voice' }));
    await advance(400);
    expect(screen.getByRole('alert').textContent).toBe(sentence);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('shows a call that failed outright the same way', async () => {
    function Failing() {
      const install = useAssetInstall({
        start: () => Promise.reject(new Error('the host is not answering')),
        state: async () => job(),
        cancel: async () => job(),
      });
      return (
        <AssetInstallPrompt ask={{ title: 'Download?', body: 'b', confirmLabel: 'Download' }} workTitle="Downloading" install={install} dismiss={() => {}} />
      );
    }
    render(<Failing />);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await advance(0);
    expect(screen.getByRole('alert').textContent).toBe('the host is not answering');
  });

  it('Cancel in the question dismisses it without starting anything', () => {
    const dismiss = vi.fn();
    render(<Harness dismiss={dismiss} steps={[job()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
