// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import { GuideDetail } from './GuideDetail';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDetail(entity: (typeof WIRE_ENTITIES)[number], api = createMockApi()) {
  render(
    <ApiProvider api={api}>
      <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
  return api;
}

/** A reference clip's name also appears as an <option> in the "approve a region" picker, so a plain text query
 * matches both; this finds the one inside the reference row (an <li>). */
async function findReferenceRow(name: string): Promise<HTMLElement> {
  const row = await waitFor(() => {
    const match = screen.getAllByText(name).find((el) => el.closest('li'));
    if (!match) throw new Error(`no reference row for ${name}`);
    return match.closest('li') as HTMLElement;
  });
  return row;
}

describe('Story Bible character detail: voice references (character-continuity-review P6)', () => {
  it('lists a character entry’s own approved reference clips, not another character’s', async () => {
    const alice = WIRE_ENTITIES.find((row) => row.id === 'alice');
    if (!alice) throw new Error('fixture must include alice');
    renderDetail(alice);
    expect(await screen.findByText('Reference clips')).toBeTruthy();
    expect(await findReferenceRow('Alice ref A')).toBeTruthy();
    expect(screen.queryByText('Hatter ref (moved)')).toBeNull();
  });

  it('a place entry (not a Character) shows neither reference clips nor dialogue cues', async () => {
    const place = WIRE_ENTITIES.find((row) => row.category === 'Place');
    if (!place) throw new Error('fixture must include a place');
    renderDetail(place);
    await waitFor(() => expect(screen.getByDisplayValue(place.canonical_name)).toBeTruthy());
    expect(screen.queryByText('Reference clips')).toBeNull();
  });

  it('approving a region as a reference adds it to the list', async () => {
    const alice = WIRE_ENTITIES.find((row) => row.id === 'alice');
    if (!alice) throw new Error('fixture must include alice');
    const user = userEvent.setup();
    renderDetail(alice);
    await findReferenceRow('Alice ref A');
    const regionSelect = await screen.findByRole('combobox', { name: 'Approve a region for Alice' });
    await user.selectOptions(regionSelect, 'March Hare ref A');
    await user.click(screen.getByRole('button', { name: 'Approve as reference' }));
    expect(await findReferenceRow('March Hare ref A')).toBeTruthy();
  });

  it('revoking a reference removes it from the list', async () => {
    const alice = WIRE_ENTITIES.find((row) => row.id === 'alice');
    if (!alice) throw new Error('fixture must include alice');
    const user = userEvent.setup();
    renderDetail(alice);
    const row = await findReferenceRow('Alice ref A');
    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryAllByText('Alice ref A').some((el) => el.closest('li'))).toBe(false));
  });

  it('a reference whose region changed since approval shows a warning badge', async () => {
    const hatter = WIRE_ENTITIES.find((row) => row.id === 'mad-hatter');
    if (!hatter) throw new Error('fixture must include mad-hatter');
    renderDetail(hatter);
    await screen.findByText('Hatter ref (moved)');
    expect(screen.getByText('Changed since approval')).toBeTruthy();
  });
});

describe('Story Bible character detail: dialogue cue attribution (character-continuity-review P6)', () => {
  it('shows an unknown cue and lets the narrator attribute it', async () => {
    const alice = WIRE_ENTITIES.find((row) => row.id === 'alice');
    if (!alice) throw new Error('fixture must include alice');
    const user = userEvent.setup();
    const api = renderDetail(alice);
    expect(await screen.findByText('“Have some wine.”')).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Speaker for “Have some wine.”' });
    await user.selectOptions(select, 'Alice');
    await waitFor(async () => expect((await api.guideDialogueCues()).find((cue) => cue.id === 'cue-2')?.speaker_entity_id).toBe('alice'));
  });

  it('shows a cue already attributed to this character with its excerpt', async () => {
    const alice = WIRE_ENTITIES.find((row) => row.id === 'alice');
    if (!alice) throw new Error('fixture must include alice');
    renderDetail(alice);
    expect(await screen.findByText('“Oh dear!”')).toBeTruthy();
  });
});
