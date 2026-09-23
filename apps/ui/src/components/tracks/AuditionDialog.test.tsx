// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditionDialog } from './AuditionDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TAKE_REVIEW_FINDINGS } from '../../api/mockFixtures';

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
}

const instances: FakeAudio[] = [];

beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal(
    'Audio',
    class extends FakeAudio {
      constructor() {
        super();
        instances.push(this);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const finding = WIRE_TAKE_REVIEW_FINDINGS[0];

function renderDialog(onClose = vi.fn()) {
  const api = createMockApi();
  render(
    <ApiProvider api={api}>
      <AuditionDialog finding={finding} onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onClose };
}

describe('AuditionDialog', () => {
  it('labels the audition as raw source with no FX or edits', () => {
    renderDialog();

    expect(screen.getByText('Raw source, no FX or edits applied')).toBeTruthy();
  });

  it('defaults A and B to the finding’s first two reads', () => {
    renderDialog();

    expect((screen.getByLabelText('Read A') as HTMLSelectElement).value).toBe(finding.evidence!.members[0].item_guid);
    expect((screen.getByLabelText('Read B') as HTMLSelectElement).value).toBe(finding.evidence!.members[1].item_guid);
  });

  it('plays read A from its own source range and stops read B if it was playing', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Play read B' }));
    expect(instances[1]?.play).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Play read A' }));

    expect(instances[0]?.play).toHaveBeenCalledTimes(1);
    expect(instances[1]?.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Pause read A' })).toBeTruthy();
  });

  it('toggles a playing read to pause on a second press', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Play read A' }));
    await screen.findByRole('button', { name: 'Pause read A' });
    await user.click(screen.getByRole('button', { name: 'Pause read A' }));

    expect(instances[0]?.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Play read A' })).toBeTruthy();
  });

  it('shows a readable error for a side whose audio fails to load', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Play read A' }));
    act(() => instances[0]?.dispatchEvent(new Event('error')));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('couldn’t be played');
  });

  it('closes via the dialog close control', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
