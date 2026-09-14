import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExport, faLock, faPlus, faRotate, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { GuideEntity } from '../../types';
import { categoryCssName, categoryLabel, sortEntities, STORY_BIBLE_TABS } from '../../state';
import { useApi } from '../../api/ApiContext';
import { Heading } from '../primitives/Heading';
import { TooltipTarget } from '../primitives/Tooltip';
import { GuideDetail } from './GuideDetail';

type EntitySort = { key: 'name' | 'occurrences'; dir: 'asc' | 'desc' };
const TAB_PLURAL: Record<string, string> = {
  Character: 'Characters',
  Location: 'Locations',
  Organization: 'Organizations',
  Lore: 'Lore',
  Item: 'Items',
  Event: 'Events',
  'Needs Review': 'Needs Review',
};

export function Guide({
  notify,
  goToManuscript,
}: {
  notify: (text: string) => void;
  goToManuscript: (chapter: string, paragraph: number) => void;
}) {
  const api = useApi();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const entityId = location.hash ? decodeURIComponent(location.hash.slice(1)) : undefined;
  const [rows, setRows] = useState<GuideEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('All');
  const [sort, setSort] = useState<EntitySort>({ key: 'name', dir: 'asc' });

  const load = async (selectId?: string) => {
    try {
      const next = (await api.guideEntities()) || [];
      setRows(next);
      setSelectedId((current) => (next.find((row) => row.id === (selectId ?? current)) || next.find((row) => row.category !== 'Draft'))?.id);
    } catch (error) {
      notify(String(error));
    }
  };
  useEffect(() => {
    void load(entityId);
    if (entityId) routerNavigate('/story-bible', { replace: true });
  }, [entityId]);

  // A Draft entry (a brand new, not-yet-categorized entity) is hidden from
  // every tab/search except while it's the one open in the detail pane - it
  // isn't a "real" browsable entry until it has a category.
  const visible = rows.filter((row) => row.category !== 'Draft' || row.id === selectedId);
  const filtered = visible
    .filter((row) => tab === 'All' || categoryLabel(row.category) === tab)
    .filter((row) =>
      `${row.canonical_name} ${row.aliases.map((alias) => alias.text).join(' ')} ${categoryLabel(row.category)}`.toLowerCase().includes(query.toLowerCase()),
    );
  const sorted = sortEntities(filtered, sort);
  const selected = rows.find((row) => row.id === selectedId);
  const toggleSort = (key: EntitySort['key']) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'occurrences' ? 'desc' : 'asc' }));
  const sortArrow = (key: EntitySort['key']) => (sort.key !== key ? '' : sort.dir === 'asc' ? '↑' : '↓');

  const addEntity = async () => {
    const base = 'New entity';
    const name = rows.some((row) => row.canonical_name.toLowerCase() === base.toLowerCase()) ? `${base} ${rows.length + 1}` : base;
    try {
      const id = await api.guideCreate(name, '', []);
      await load(id);
    } catch (error) {
      notify(String(error));
    }
  };

  return (
    <div className="guide-page mx-auto max-w-6xl">
      <div className="guide-page-header space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Heading title="Story Bible" />
          <div className="flex gap-2">
            <TooltipTarget text="Add entity">
              <button aria-label="Add entity" className="icon-btn" onClick={() => void addEntity()}>
                <FontAwesomeIcon icon={faPlus} />
              </button>
            </TooltipTarget>
            <TooltipTarget text="Build / refresh Story Bible">
              <button
                aria-label="Build / refresh Story Bible"
                className="icon-btn"
                onClick={async () => {
                  try {
                    notify(await api.guideBuild());
                    await load();
                  } catch (error) {
                    notify(String(error));
                  }
                }}
              >
                <FontAwesomeIcon icon={faRotate} />
              </button>
            </TooltipTarget>
            <TooltipTarget text="Export hotwords">
              <button
                aria-label="Export hotwords"
                className="icon-btn"
                onClick={async () => {
                  try {
                    notify(`Hotwords exported to ${await api.guideExport()}`);
                  } catch (error) {
                    notify(String(error));
                  }
                }}
              >
                <FontAwesomeIcon icon={faFileExport} />
              </button>
            </TooltipTarget>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--border)' }}>
          {STORY_BIBLE_TABS.map((name) => (
            <button key={name} onClick={() => setTab(name)} className={`tab-btn whitespace-nowrap ${tab === name ? 'active' : ''}`}>
              {name === 'All' ? `All · ${visible.length}` : `${TAB_PLURAL[name]} · ${visible.filter((row) => categoryLabel(row.category) === name).length}`}
            </button>
          ))}
        </div>
      </div>
      <div className="guide-workspace grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <section className="panel flex min-h-0 flex-col overflow-hidden">
          <div className="panel-body pb-2">
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                className="input"
                aria-label="Search entries"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search entries…"
                style={query ? { paddingRight: '2.25rem' } : undefined}
              />
              {query && (
                <TooltipTarget text="Clear search" style={{ position: 'absolute', right: '.25rem', top: '50%', transform: 'translateY(-50%)' }}>
                  <button aria-label="Clear search" className="icon-btn" onClick={() => setQuery('')}>
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </TooltipTarget>
              )}
            </div>
          </div>
          <div className="guide-list-scroll px-2 pb-2">
            <table className="dtable">
              <thead className="sticky-table-head">
                <tr>
                  <th>
                    <button className={`sort-btn ${sort.key === 'name' ? 'active' : ''}`} onClick={() => toggleSort('name')}>
                      Name {sortArrow('name')}
                    </button>
                  </th>
                  <th className="text-right">
                    <button className={`sort-btn ${sort.key === 'occurrences' ? 'active' : ''}`} onClick={() => toggleSort('occurrences')}>
                      Occurrences {sortArrow('occurrences')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.id} data-row className={selectedId === row.id ? 'row-selected' : ''} onClick={() => setSelectedId(row.id)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={`cat-dot type-${categoryCssName(row.category)}`} />
                        <span className="truncate text-sm font-medium">{row.canonical_name}</span>
                        {row.locked && <FontAwesomeIcon icon={faLock} className="text-[10px]" style={{ color: 'var(--text-faint)' }} />}
                      </div>
                      <div className="mt-0.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                        {categoryLabel(row.category)}
                      </div>
                    </td>
                    <td className="f-mono text-right" style={{ color: 'var(--text-faint)' }}>
                      {row.occurrence_count}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={2} className="text-sm" style={{ color: 'var(--text-faint)' }}>
                      No matching entries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <div className="guide-detail-panel min-w-0">
          <GuideDetail entity={selected} entities={rows} reload={load} notify={notify} select={setSelectedId} goToManuscript={goToManuscript} />
        </div>
      </div>
    </div>
  );
}
