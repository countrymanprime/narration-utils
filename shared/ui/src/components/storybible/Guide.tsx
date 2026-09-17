import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExport, faLock, faPlus, faRotate, faXmark } from '@fortawesome/free-solid-svg-icons';
import { normalizeGuideEntity, type GuideEntity, type WorkJob } from '../../types';
import { categoryCssName, categoryLabel, sortEntities, STORY_BIBLE_TABS } from '../../state';
import { useApi } from '../../api/ApiContext';
import { Heading } from '../primitives/Heading';
import { TooltipTarget } from '../primitives/Tooltip';
import { GuideDetail } from './GuideDetail';
import { WorkDialog } from '../primitives/WorkDialog';

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

// A brand-new entity has no backend record at all until a category is chosen
// (see GuideDetail's isNewDraft handling) - this is a purely local stand-in
// for the form to render against, never sent anywhere.
const emptyGuideEntity = (name: string): GuideEntity => ({
  id: '',
  canonical_name: name,
  aliases: [],
  category: 'Draft',
  occurrences: [],
  occurrence_count: 0,
  pronunciation: { ipa: '', source: '', confidence: '' },
  description: { text: '', evidence: {} },
  personality_notes: [],
  relationships: [],
  locked: false,
  review_state: 'reviewed',
});

export function Guide({ notify, goToManuscript }: { notify: (text: string) => void; goToManuscript: (chapter: string, paragraph: number) => void }) {
  const api = useApi();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const entityId = location.hash ? decodeURIComponent(location.hash.slice(1)) : undefined;
  const [rows, setRows] = useState<GuideEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('All');
  const [sort, setSort] = useState<EntitySort>({ key: 'name', dir: 'asc' });
  const [buildJob, setBuildJob] = useState<WorkJob>();
  const [pendingNewEntity, setPendingNewEntity] = useState<{ name: string }>();
  // Memoized so the object identity only changes when a draft opens/closes,
  // not on every Guide re-render - GuideDetail resets its local form state
  // whenever the `entity` prop identity changes, so a fresh object per
  // render would silently discard whatever the user just typed.
  const newEntityDraft = useMemo(() => (pendingNewEntity ? emptyGuideEntity(pendingNewEntity.name) : undefined), [pendingNewEntity]);

  const load = useCallback(
    async (selectId?: string) => {
      try {
        const next = ((await api.guideEntities()) || []).map(normalizeGuideEntity);
        setRows(next);
        setSelectedId((current) => (next.find((row) => row.id === (selectId ?? current)) || next.find((row) => row.category !== 'Draft'))?.id);
      } catch (error) {
        notify(String(error));
      }
    },
    [api, notify],
  );
  useEffect(() => {
    void load(entityId);
    if (entityId) routerNavigate('/story-bible', { replace: true });
  }, [entityId, load, routerNavigate]);
  useEffect(() => {
    if (!buildJob?.id || !['preparing', 'running'].includes(buildJob.phase)) return;
    let active = true;
    const refresh = () =>
      void api
        .guideBuildState()
        .then(async (next) => {
          if (!active) return;
          setBuildJob(next);
          if (next.phase === 'success') {
            // Await the reload before dismissing the dialog/showing success,
            // so the page never briefly renders on stale (pre-build) rows -
            // that render used to trip the route ErrorBoundary once, which
            // looked exactly like the build itself had failed.
            await load();
            if (!active) return;
            notify(next.result?.message || 'Story Bible rebuilt.');
            setBuildJob(undefined);
          }
        })
        .catch(
          (error) => active && setBuildJob((current) => (current ? { ...current, phase: 'error', error: String(error), message: String(error) } : current)),
        );
    refresh();
    const timer = window.setInterval(refresh, 250);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, buildJob?.id, buildJob?.phase, load, notify]);

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

  // No backend record is created here - see GuideDetail's isNewDraft prop.
  // Navigating away or picking a different row just discards this, matching
  // a "doesn't exist until saved" model instead of create-then-delete.
  const addEntity = () => {
    const base = 'New entity';
    const name = rows.some((row) => row.canonical_name.toLowerCase() === base.toLowerCase()) ? `${base} ${rows.length + 1}` : base;
    setPendingNewEntity({ name });
  };
  const selectRow = (id?: string) => {
    setPendingNewEntity(undefined);
    setSelectedId(id);
  };

  return (
    <div className="guide-page mx-auto max-w-6xl">
      <div className="guide-page-header space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Heading title="Story Bible" />
          <div className="flex gap-2">
            <TooltipTarget text="Add entity">
              <button aria-label="Add entity" className="icon-btn" onClick={addEntity}>
                <FontAwesomeIcon icon={faPlus} />
              </button>
            </TooltipTarget>
            <TooltipTarget text="Build / refresh Story Bible">
              <button
                aria-label="Build / refresh Story Bible"
                className="icon-btn"
                onClick={async () => {
                  try {
                    const job = await api.guideBuild();
                    if (job.phase === 'success') {
                      await load();
                      notify(job.result?.message || 'Story Bible rebuilt.');
                    } else setBuildJob(job);
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
                  <tr key={row.id} data-row className={!pendingNewEntity && selectedId === row.id ? 'row-selected' : ''} onClick={() => selectRow(row.id)}>
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
          <GuideDetail
            entity={newEntityDraft ?? selected}
            isNewDraft={Boolean(newEntityDraft)}
            onDiscardNewDraft={() => setPendingNewEntity(undefined)}
            onCreatedNewDraft={(id) => {
              setPendingNewEntity(undefined);
              void load(id);
            }}
            entities={rows}
            reload={load}
            notify={notify}
            goToManuscript={goToManuscript}
          />
        </div>
      </div>
      {buildJob && <WorkDialog title="Rebuild Story Bible" job={buildJob} close={() => setBuildJob(undefined)} />}
    </div>
  );
}
