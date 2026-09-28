// @vitest-environment jsdom
// Alias pronunciation controls (story-bible-and-import-ux-briefs PRD, phase 11): every alias gets the same edit-mode
// Generate/Replace control, preview and pronunciation-work panel the entity already has (ADR 0018), scoped to its own
// aliasIndex. The host and mock already accept an aliasIndex on every pronunciation call (story bible phase 3, B8-B11);
// this only wires the UI to it.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_ENTITIES } from '../../api/mockFixtures';
import type { GuideEntity } from '../../types';
import { GuideDetail } from './GuideDetail';

afterEach(() => cleanup());

// White Rabbit: unlocked, one alias ("Rabbit") with an existing pronunciation.
const withAliasPronunciation = (): GuideEntity => {
  const row = WIRE_ENTITIES.find((entity) => entity.id === 'white-rabbit');
  if (!row) throw new Error('the fixture entry is missing');
  return row;
};

const withUngeneratedAlias = (): GuideEntity => {
  const base = withAliasPronunciation();
  return { ...base, aliases: [{ ...base.aliases[0], pronunciation: { ipa: '', source: 'not generated', confidence: 'unknown' } }] };
};

const lockedWithAlias = (): GuideEntity => {
  const row = WIRE_ENTITIES.find((entity) => entity.locked && entity.aliases.length > 0);
  if (!row) throw new Error('the fixture entry is missing');
  return row;
};

function renderDetail(entity: GuideEntity, overrides: Record<string, unknown> = {}) {
  const api = createMockApi(overrides);
  const spies = {
    guidePronounce: vi.spyOn(api, 'guidePronounce'),
    guidePronounceUser: vi.spyOn(api, 'guidePronounceUser'),
    guidePronunciationUseAlternate: vi.spyOn(api, 'guidePronunciationUseAlternate'),
    guidePronunciationSetStatus: vi.spyOn(api, 'guidePronunciationSetStatus'),
  };
  render(
    <ApiProvider api={api}>
      <GuideDetail entity={entity} entities={WIRE_ENTITIES} reload={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} goToManuscript={vi.fn()} />
    </ApiProvider>,
  );
  return spies;
}

const aliasRow = (aliasText: string) => screen.getByRole('row', { name: new RegExp(aliasText) });

describe('alias Generate and Replace (phase 11)', () => {
  it('offers no Generate or Replace control for an alias in the read view', () => {
    renderDetail(withUngeneratedAlias());
    expect(screen.queryByRole('button', { name: 'Generate alias pronunciation' })).toBeNull();
  });

  it('offers Generate for an alias with no pronunciation, and calls it with the chosen source and alias index', async () => {
    const user = userEvent.setup();
    const entity = withUngeneratedAlias();
    const { guidePronounce } = renderDetail(entity);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    const row = aliasRow(entity.aliases[0].text);
    await user.click(within(row).getByRole('button', { name: 'Generate alias pronunciation' }));
    await user.click(await screen.findByRole('menuitem', { name: /CMU dictionary/ }));
    await waitFor(() => expect(guidePronounce).toHaveBeenCalledWith(entity.id, 'cmu', 0));
  });

  it('offers Replace, not Generate, for an alias that already has a pronunciation', async () => {
    const user = userEvent.setup();
    const entity = withAliasPronunciation();
    const { guidePronounce } = renderDetail(entity);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    const row = aliasRow(entity.aliases[0].text);
    expect(within(row).queryByRole('button', { name: 'Generate alias pronunciation' })).toBeNull();
    await user.click(within(row).getByRole('button', { name: 'Replace alias pronunciation' }));
    await user.click(await screen.findByRole('menuitem', { name: /eSpeak/ }));
    await waitFor(() => expect(guidePronounce).toHaveBeenCalledWith(entity.id, 'espeak', 0));
  });

  it('never offers Generate or Replace for a locked entity, for the entity or any alias', () => {
    renderDetail(lockedWithAlias());
    expect(screen.queryByRole('button', { name: 'Generate pronunciation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace pronunciation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate alias pronunciation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace alias pronunciation' })).toBeNull();
  });

  it('keeps each alias row independent: replacing one alias does not touch another', async () => {
    const user = userEvent.setup();
    const base = withAliasPronunciation();
    const entity: GuideEntity = {
      ...base,
      aliases: [base.aliases[0], { text: 'Bunny', pronunciation: { ipa: '/ˈbʌni/', source: 'CMU dictionary', confidence: 'medium' }, occurrences: [] }],
    };
    const { guidePronounce } = renderDetail(entity);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    const secondRow = aliasRow('Bunny');
    await user.click(within(secondRow).getByRole('button', { name: 'Replace alias pronunciation' }));
    await user.click(await screen.findByRole('menuitem', { name: /CMU dictionary/ }));
    await waitFor(() => expect(guidePronounce).toHaveBeenCalledWith(entity.id, 'cmu', 1));
  });
});

describe('alias pronunciation work panel (phase 11)', () => {
  it('opens its own details panel independent of the entity and other aliases, and saves the alias index', async () => {
    const user = userEvent.setup();
    const entity = withAliasPronunciation();
    const { guidePronounceUser } = renderDetail(entity);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    const row = aliasRow(entity.aliases[0].text);
    fireEvent.click(within(row).getByRole('button', { name: 'Pronunciation details' }));
    const ipaBox = within(row).getByRole('textbox', { name: 'Your pronunciation' });
    await user.type(ipaBox, 'wɪ');
    await user.click(within(row).getByRole('button', { name: 'Use mine' }));
    await waitFor(() => expect(guidePronounceUser).toHaveBeenCalledWith(entity.id, 'wɪ', 0));
  });

  it('saves an alias pronunciation status with the alias index', async () => {
    const user = userEvent.setup();
    const entity = withAliasPronunciation();
    const { guidePronunciationSetStatus } = renderDetail(entity);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    const row = aliasRow(entity.aliases[0].text);
    fireEvent.click(within(row).getByRole('button', { name: 'Pronunciation details' }));
    await user.selectOptions(within(row).getByRole('combobox', { name: `Pronunciation status for ${entity.aliases[0].text}` }), 'author_confirmed');
    await user.click(within(row).getByRole('button', { name: 'Save status' }));
    await waitFor(() => expect(guidePronunciationSetStatus).toHaveBeenCalledWith(entity.id, 'author_confirmed', '', 0));
  });

  it('switches an alias to its kept alternate pronunciation, keyed by alias index', async () => {
    const user = userEvent.setup();
    const base = withAliasPronunciation();
    const entity: GuideEntity = {
      ...base,
      aliases: [{ ...base.aliases[0], pronunciation: { ...base.aliases[0].pronunciation, alternate: { ipa: 'ɹæb', source: 'user', confidence: 'narrator' } } }],
    };
    const { guidePronunciationUseAlternate } = renderDetail(entity);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this entry' }));
    const row = aliasRow(entity.aliases[0].text);
    fireEvent.click(within(row).getByRole('button', { name: 'Pronunciation details' }));
    await user.click(within(row).getByRole('button', { name: `Use ɹæb for ${entity.aliases[0].text}` }));
    await waitFor(() => expect(guidePronunciationUseAlternate).toHaveBeenCalledWith(entity.id, 0));
  });
});
