// @vitest-environment jsdom
// Pronunciation controls (story bible entries PRD, phase 3, D13/B8-B11): Play is gated on a pronunciation existing, with a
// keyboard-reachable reason; Generate (missing) and Replace (present) live in edit mode only, offer CMU and eSpeak
// explicitly, and are blocked for locked entries.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import type { GuideEntity } from '../../types';
import { GuideDetail } from './GuideDetail';

afterEach(() => cleanup());

const fixture = (pick: (row: GuideEntity) => boolean): GuideEntity => {
  const row = WIRE_ENTITIES.find(pick);
  if (!row) throw new Error('the fixture entry is missing');
  return row;
};
const withPronunciation = fixture((row) => Boolean(row.pronunciation.ipa) && !row.locked);
const withoutPronunciation = fixture((row) => !row.pronunciation.ipa && !row.locked);
const locked = fixture((row) => row.locked);

function renderDetail(entity: GuideEntity, overrides: Record<string, unknown> = {}) {
  const api = createMockApi(overrides);
  const guidePronounce = vi.spyOn(api, 'guidePronounce');
  render(
    <ApiProvider api={api}>
      <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
  return { guidePronounce };
}

describe('Play gating (B8)', () => {
  it('is disabled with a reachable reason when there is no pronunciation, and reachable enabled when there is one', () => {
    renderDetail(withoutPronunciation);
    const play = screen.getByRole('button', { name: 'Play preview' });
    expect(play.getAttribute('aria-disabled')).toBe('true');
    expect(play.hasAttribute('disabled')).toBe(false);
    play.focus();
    expect(document.activeElement).toBe(play);
  });

  it('is enabled when a pronunciation exists', () => {
    renderDetail(withPronunciation);
    expect(screen.getByRole('button', { name: 'Play preview' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('gates an alias play button the same way', () => {
    const base = withPronunciation;
    const entity: GuideEntity = {
      ...base,
      aliases: [
        { text: 'Ungenerated', pronunciation: { ipa: '', source: 'not generated', confidence: 'unknown' }, occurrences: [] },
        base.aliases[0] ?? { text: 'Has one', pronunciation: { ipa: '/x/', source: 'CMU dictionary', confidence: 'medium' }, occurrences: [] },
      ],
    };
    renderDetail(entity);
    const buttons = screen.getAllByRole('button', { name: 'Play alias pronunciation' });
    expect(buttons[0].getAttribute('aria-disabled')).toBe('true');
    expect(buttons[1].getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Generate and Replace (D13, B9, B10)', () => {
  it('offers no Generate or Replace control in the read view', () => {
    renderDetail(withoutPronunciation);
    expect(screen.queryByRole('button', { name: 'Generate pronunciation' })).toBeNull();
  });

  it('offers Generate in edit mode when there is no pronunciation, and calls it with the chosen source', async () => {
    const user = userEvent.setup();
    const { guidePronounce } = renderDetail(withoutPronunciation);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    await user.click(screen.getByRole('button', { name: 'Generate pronunciation' }));
    await user.click(await screen.findByRole('menuitem', { name: /CMU dictionary/ }));
    await waitFor(() => expect(guidePronounce).toHaveBeenCalledWith(withoutPronunciation.id, 'cmu'));
  });

  it('offers Replace in edit mode when a pronunciation exists, with both sources, and no Generate', async () => {
    const user = userEvent.setup();
    const { guidePronounce } = renderDetail(withPronunciation);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    expect(screen.queryByRole('button', { name: 'Generate pronunciation' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Replace pronunciation' }));
    const menu = await screen.findAllByRole('menuitem');
    expect(menu.map((item) => item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('CMU'), expect.stringContaining('eSpeak')]));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /eSpeak/ }));
    await waitFor(() => expect(guidePronounce).toHaveBeenCalledWith(withPronunciation.id, 'espeak'));
  });

  it('is blocked for a locked entity: no Edit, so no Generate or Replace can be reached', () => {
    renderDetail(locked);
    expect(screen.queryByRole('button', { name: 'Generate pronunciation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace pronunciation' })).toBeNull();
  });

  it('says why when the chosen engine has nothing for the name', async () => {
    const api = createMockApi();
    vi.spyOn(api, 'guidePronounce').mockRejectedValue('The CMU dictionary has no entry for "Zzyzxqq".');
    const notify = vi.fn();
    render(
      <ApiProvider api={api}>
        <GuideDetail
          entity={withoutPronunciation}
          entities={WIRE_ENTITIES}
          reload={vi.fn().mockResolvedValue(undefined)}
          notify={notify}
          goToManuscript={vi.fn()}
        />
      </ApiProvider>,
    );
    const user = userEvent.setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    await user.click(screen.getByRole('button', { name: 'Generate pronunciation' }));
    await user.click(await screen.findByRole('menuitem', { name: /CMU dictionary/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('The CMU dictionary has no entry for "Zzyzxqq".', 'error'));
    // Retry stays available - the control is not disabled by the failure.
    expect(screen.getByRole('button', { name: 'Generate pronunciation' })).toBeTruthy();
  });
});
