// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuideEntity, PronunciationQuery } from '../../types';
import { ScriptRail } from './ScriptRail';

afterEach(cleanup);

const entity = (id: string, name: string, category: string, ipa: string, status?: 'researched' | 'query_sent' | 'author_confirmed'): GuideEntity => ({
  id,
  canonical_name: name,
  category,
  locked: false,
  review_state: 'generated',
  pronunciation: { ipa, source: ipa ? 'cmu' : '', confidence: '', status: status ?? 'researched' },
  description: { text: `${name}, described.`, evidence: {} },
  personality_notes: [],
  properties: [],
  aliases: [],
  relationships: [],
  occurrences: [],
  occurrence_count: 0,
});

const ENTITIES = [
  entity('alice', 'Alice', 'Character', '/ˈælɪs/', 'author_confirmed'),
  entity('rabbit', 'White Rabbit', 'Character', '/waɪt ˈræbɪt/'),
  entity('garden', 'Queen’s Garden', 'Place', '/ɡɑːrdən/', 'query_sent'),
  entity('tulgey', 'Tulgey Wood', 'Place', ''),
];

const query = (entityId: string, name: string, status: PronunciationQuery['status']): PronunciationQuery => ({
  entityId,
  aliasIndex: null,
  name,
  entry: name,
  category: 'Place',
  ipa: '',
  source: '',
  status,
  note: '',
  chapter: 'Chapter 1 — Down the Rabbit-Hole',
  excerpt: '',
});

const QUERIES = [query('garden', 'Queen’s Garden', 'query_sent'), query('rabbit', 'White Rabbit', 'researched')];

function renderRail(overrides: Partial<Parameters<typeof ScriptRail>[0]> = {}) {
  const props = { entities: ENTITIES, queries: QUERIES, openEntity: vi.fn(), openQueries: vi.fn(), ...overrides };
  render(<ScriptRail {...props} />);
  return props;
}

describe('ScriptRail (stage navigation Phase 3, mock 02)', () => {
  it('names its three tabs with their counts and opens on Pronunciations', () => {
    renderRail();
    const tabs = within(screen.getByRole('tablist', { name: 'Prep' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Pronunciations · 3', 'Characters · 2', 'Queries · 2']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('lists every name with a pronunciation: the word, how to say it and its status', () => {
    renderRail();
    const table = screen.getByRole('table', { name: 'Pronunciations' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['Alice', '/ˈælɪs/', 'Author confirmed'],
      ['White Rabbit', '/waɪt ˈræbɪt/', 'Researched'],
      ['Queen’s Garden', '/ɡɑːrdən/', 'Query sent'],
    ]);
  });

  it('opens a name’s Story Bible summary from the Pronunciations and Characters tabs', () => {
    const { openEntity } = renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'Queen’s Garden' }));
    expect(openEntity).toHaveBeenLastCalledWith(ENTITIES[2]);
    fireEvent.click(screen.getByRole('tab', { name: 'Characters · 2' }));
    fireEvent.click(screen.getByRole('button', { name: /White Rabbit/ }));
    expect(openEntity).toHaveBeenLastCalledWith(ENTITIES[1]);
    expect(screen.queryByRole('button', { name: /Queen’s Garden/ })).toBeNull();
  });

  it('lists the names the author has not confirmed and opens the queries panel', () => {
    const { openQueries } = renderRail();
    fireEvent.click(screen.getByRole('tab', { name: 'Queries · 2' }));
    const table = screen.getByRole('table', { name: 'Names to confirm' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['Queen’s GardenChapter 1 — Down the Rabbit-Hole', 'Query sent'],
      ['White RabbitChapter 1 — Down the Rabbit-Hole', 'Researched'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Manage queries' }));
    expect(openQueries).toHaveBeenCalled();
  });

  it('keeps Manage queries pinned under every tab, as mock 02 pins its actions', () => {
    renderRail();
    expect(screen.getByRole('tab', { name: /^Pronunciations/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Manage queries' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Characters/ }));
    expect(screen.getAllByRole('button', { name: 'Manage queries' })).toHaveLength(1);
  });

  it('says so while the queries load, and when every pronunciation is confirmed', () => {
    renderRail({ queries: undefined });
    expect(screen.getByRole('tab', { name: 'Queries' })).toBeTruthy();
    cleanup();
    renderRail({ queries: [] });
    fireEvent.click(screen.getByRole('tab', { name: 'Queries · 0' }));
    expect(screen.getByText('The author has confirmed every pronunciation.')).toBeTruthy();
  });

  it('says why the queries could not be read, and keeps Manage queries', () => {
    renderRail({ queries: undefined, queriesError: 'The Story Bible file could not be read.' });
    fireEvent.click(screen.getByRole('tab', { name: 'Queries' }));
    expect(screen.getByRole('alert').textContent).toBe("Couldn't read the queries: The Story Bible file could not be read.");
    expect(screen.getByRole('button', { name: 'Manage queries' })).toBeTruthy();
  });
});
