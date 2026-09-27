import { useState } from 'react';
import type { GuideEntity, PronunciationQuery } from '../../types';
import { Button } from '../primitives/Button';
import { StatusBadge } from '../primitives/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { Tab, TabList, TabPanel, Tabs } from '../primitives/Tabs';
import { pronunciationStatusInfo } from '../storybible/pronunciationStatus';

type RailTab = 'pronunciations' | 'characters' | 'queries';

// A name in a rail list: plain text that opens the entry's Story Bible summary, the same shape as the reader rail's entries
// (teleprompter/ReaderRail.tsx), which `Button`'s padded, uppercase chrome does not fit.
const NAME_BUTTON = 'text-left font-semibold text-[var(--text)] underline-offset-2 hover:underline';

// The Script page's rail (stage-navigation-and-page-replacement.prd.md Phase 3, mock 02): Pronunciations, Characters and Queries
// over the Story Bible the reader already loaded. A name opens the same summary a mark in the text opens; the queries are the
// Story Bible's own (prep-depth P3), and Manage queries opens that same panel (storybible/PronunciationQueries.tsx), so marking
// one sent, answering it or exporting them happens in one place. `queries` is undefined until the first read answers.
export function ScriptRail({
  entities,
  queries,
  queriesError,
  openEntity,
  openQueries,
}: {
  entities: GuideEntity[];
  queries?: PronunciationQuery[];
  /** Why the queries could not be read; the rest of the rail still works. */
  queriesError?: string;
  openEntity: (entity: GuideEntity) => void;
  openQueries: () => void;
}) {
  const [tab, setTab] = useState<RailTab>('pronunciations');
  const pronounced = entities.filter((entity) => entity.pronunciation.ipa.trim());
  const characters = entities.filter((entity) => entity.category === 'Character');

  return (
    <Tabs value={tab} onChange={(next) => setTab(next as RailTab)} className="flex min-h-0 flex-col">
      <TabList label="Prep" activation="automatic">
        <Tab value="pronunciations">Pronunciations · {pronounced.length}</Tab>
        <Tab value="characters">Characters · {characters.length}</Tab>
        <Tab value="queries">{queries ? `Queries · ${queries.length}` : 'Queries'}</Tab>
      </TabList>
      <TabPanel value="pronunciations" className="min-h-0 overflow-y-auto">
        {pronounced.length === 0 ? (
          <p className="p-3 text-sm text-[var(--text-muted)]">No pronunciations yet. Build the Story Bible to find the names.</p>
        ) : (
          <Table label="Pronunciations">
            <TableHead sticky>
              <TableRow>
                <TableHeader>Word</TableHeader>
                <TableHeader>Say it</TableHeader>
                <TableHeader>Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {pronounced.map((entity) => {
                const status = pronunciationStatusInfo(entity.pronunciation);
                return (
                  <TableRow key={entity.id}>
                    <TableCell>
                      <button type="button" className={NAME_BUTTON} onClick={() => openEntity(entity)}>
                        {entity.canonical_name}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-[0.8rem] break-all">{entity.pronunciation.ipa}</TableCell>
                    <TableCell>
                      <StatusBadge tone={status.tone} label={status.label} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TabPanel>
      <TabPanel value="characters" className="min-h-0 overflow-y-auto">
        {characters.length === 0 ? (
          <p className="p-3 text-sm text-[var(--text-muted)]">No characters in the Story Bible yet.</p>
        ) : (
          <ul aria-label="Characters" className="divide-y divide-[var(--border)]">
            {characters.map((entity) => (
              <li key={entity.id} className="px-3 py-2">
                <button type="button" className={`${NAME_BUTTON} block`} onClick={() => openEntity(entity)}>
                  {entity.canonical_name}
                </button>
                {entity.description.text && <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{entity.description.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </TabPanel>
      <TabPanel value="queries" className="flex min-h-0 flex-col">
        {queriesError ? (
          <p role="alert" className="p-3 text-sm text-[var(--danger-text)]">
            Couldn't read the queries: {queriesError}
          </p>
        ) : !queries ? (
          <p className="p-3 text-sm text-[var(--text-muted)]">Loading the queries…</p>
        ) : queries.length === 0 ? (
          <p className="p-3 text-sm text-[var(--text-muted)]">The author has confirmed every pronunciation.</p>
        ) : (
          <ul aria-label="Pronunciation queries" className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto">
            {queries.map((row) => {
              const status = pronunciationStatusInfo(row);
              return (
                <li key={`${row.entityId}:${row.aliasIndex ?? ''}`} className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{row.name}</div>
                    {row.chapter && <div className="text-xs text-[var(--text-muted)]">{row.chapter}</div>}
                  </div>
                  <StatusBadge tone={status.tone} label={status.label} />
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-[var(--border)] p-3">
          <Button variant="ghost" className="text-xs" onClick={openQueries}>
            Manage queries
          </Button>
        </div>
      </TabPanel>
    </Tabs>
  );
}
