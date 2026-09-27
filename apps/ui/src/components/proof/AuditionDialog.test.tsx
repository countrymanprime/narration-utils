// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditionDialog } from './AuditionDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TAKE_REVIEW_FINDINGS } from '../../api/mockFixtures';
import { takeReviewEvidenceSchema } from '../../api/schemas/takeReview';

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

const { members } = takeReviewEvidenceSchema.parse(WIRE_TAKE_REVIEW_FINDINGS[0].evidence);

function renderDialog(onClose = vi.fn()) {
  const api = createMockApi();
  render(
    <ApiProvider api={api}>
      <AuditionDialog members={members} onClose={onClose} />
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

    expect(screen.getByRole('combobox', { name: 'Read A' })).toHaveProperty('value', '0');
    expect(screen.getByRole('combobox', { name: 'Read B' })).toHaveProperty('value', '1');
    expect(screen.getByRole('option', { name: /Read 2 — ch1_take2\.wav/, selected: true })).toBeTruthy();
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

  it('tells two takes of one item apart, since they share its item GUID', async () => {
    const user = userEvent.setup();
    const takes = [members[0], { ...members[1], item_guid: members[0].item_guid }];
    render(
      <ApiProvider api={createMockApi({ mediaUrl: (sourceFile) => sourceFile })}>
        <AuditionDialog members={takes} onClose={vi.fn()} />
      </ApiProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Play read B' }));

    expect(instances[1]?.src).toContain('ch1_take2.wav');
  });

  it('closes via the dialog close control', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
