/**
 * Settings (proposed, ADR 0865): categories by what is being configured, a scope and "used by" on every setting, instant apply, search.
 * It replaces the single column of panels. The registry that builds it is `fixtures/settings.ts`.
 */
import '@/styles/settings.css'
import { useMemo } from 'react'
import { CATEGORIES, GROUPS, PAGE_LABEL, PAGE_SETTINGS, ROWS } from '@/fixtures/settings'
import { anyChanged, changedCount, hasOverride, search, visible, type Hit } from '@/selectors/settingsView'
import { backFromSettings, setCat, setFilter, setQuery, toggleNav } from '@/state/commands/settingsPage'
import type { SettingsFilter } from '@/state/slices/settings'
import { update, useMock, useStudio } from '@/state/store'
import { Btn, Seg } from '@/ui/primitives'
import { Icon as Ico, type IconName } from '@/ui/Icon'
import { pane, Results } from './settings/Panes'
import { Input } from '@/ui/primitives'


function Nav() {
  const st = useStudio((x) => x)
  const s = st.ui.settings
  const here = s.q.trim() || s.filter !== 'all' ? '' : s.cat
  const current = CATEGORIES.find((c) => c.id === s.cat)?.label ?? 'Set on a page'
  return (
    <nav className="stg-nav" aria-label="Settings categories">
      <button type="button" className="stg-toggle" aria-expanded={s.navOpen} aria-controls="stg-list" onClick={toggleNav}>
        <span className="label">Category</span><b>{current}</b><Ico name={s.navOpen ? 'up' : 'down'} />
      </button>
      <div id="stg-list" className="stg-list" data-open={s.navOpen}>
        {GROUPS.map((g) => (
          <div key={g} role="group" aria-label={g}>
            <div className="grp">{g}</div>
            {CATEGORIES.filter((c) => c.group === g).map((c) => {
              const n = changedCount(st, c.id)
              return (
                <button key={c.id} type="button" className="nav" data-cat={c.id} aria-current={here === c.id ? 'page' : 'false'} onClick={() => setCat(c.id)}>
                  <span className="ic"><Ico name={c.icon as IconName} /></span><span className="nl">{c.label}</span>
                  {n ? <span className="ct" aria-label={n + ' changed'}>{n}</span> : null}
                </button>
              )
            })}
          </div>
        ))}
        <div role="group" aria-label="Elsewhere">
          <div className="grp">Elsewhere</div>
          <button type="button" className="nav" data-cat="pages" aria-current={here === 'pages' ? 'page' : 'false'} onClick={() => setCat('pages')}>
            <span className="ic"><Ico name="external" /></span><span className="nl">Set on a page</span><span className="ct" aria-label={PAGE_SETTINGS.length + ' settings'}>{PAGE_SETTINGS.length}</span>
          </button>
        </div>
      </div>
    </nav>
  )
}

export default function SettingsPage() {
  const st = useStudio((x) => x)
  const mock = useMock()
  const s = st.ui.settings
  const q = s.q.trim()
  const hits = useMemo<Hit[]>(() => {
    if (q) return search(st, q).filter((h) => !h.row || s.filter === 'all' || (s.filter === 'changed' ? anyChanged(s, h.row) : h.row.scope === 'project' || hasOverride(s, h.row)))
    if (s.filter === 'all') return []
    return ROWS.filter((r) => visible(mock, r) && (s.filter === 'changed' ? anyChanged(s, r) : r.scope === 'project' || hasOverride(s, r)))
      .map((row) => ({ row, cat: CATEGORIES.find((c) => c.id === row.cat)!.label }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, s, mock])
  const searching = !!q || s.filter !== 'all'
  const view = mock.settingsView
  const catLabel = CATEGORIES.find((c) => c.id === s.cat)?.label ?? 'Set on a page'
  const loading = view === 'loading' && s.cat !== 'models'
  const broken = view === 'load-error' && s.cat !== 'models'
  return (
    <div className="page stg" data-settings-view={view}>
      <div className="phead">
        <h1>Settings</h1>
        {s.from ? <Btn className="sm" id="stg-back" onClick={backFromSettings}><Ico name="arrowLeft" /> Back to {PAGE_LABEL[s.from]}</Btn> : null}
        <span className="spacer" style={{ flex: 1 }} />
        <div className="stg-find" role="search">
          <Ico name="search" />
          <Input type="search" id="stg-q" aria-label="Search settings" placeholder="Search settings" value={s.q} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && s.q) { e.stopPropagation(); setQuery('') } }} />
          <Seg<SettingsFilter> label="Show" value={s.filter} onChange={setFilter} options={[['all', 'All'], ['changed', 'Changed'], ['project', 'In this project']]} />
        </div>
      </div>
      <div className="stg-body">
        <Nav />
        <main className="stg-pane" aria-labelledby="stg-h" id="stg-pane">
          <div className="crumb2" aria-label="Breadcrumb">Settings <span aria-hidden="true">/</span> {searching ? (q ? 'Search results' : s.filter === 'changed' ? 'Changed from the default' : 'Set for this project') : catLabel}</div>
          {view === 'save-error' ? <div className="banner warn" role="status"><b>Changes cannot be saved right now.</b><span>The settings file is read-only. You can look, but a change is not kept.</span></div> : null}
          {broken ? <div className="banner bad" role="alert"><b>Your settings could not be read.</b><span>The defaults are shown and nothing can be changed until the file can be read.</span>
            <span className="row"><Btn className="sm" onClick={() => update((d) => { d.mock.settingsView = 'ready' })}>Try again</Btn><Btn className="sm quiet" onClick={() => update((d) => { d.mock.settingsView = 'ready' })}>Use the defaults</Btn></span></div> : null}
          {loading ? (
            <div className="stack" aria-busy="true" aria-label={'Loading ' + catLabel}>
              <h2 id="stg-h" tabIndex={-1}>{catLabel}</h2>
              {[0, 1, 2, 3].map((i) => <div className="skeleton tall" key={i} />)}
              <span className="sr-only" role="status">Reading your settings…</span>
            </div>
          ) : (
            <fieldset className="stg-fs" disabled={broken}>
              {searching ? <><h2 id="stg-h" tabIndex={-1} className="sr-only">Results</h2><Results hits={hits} empty={q ? 'No settings match “' + q + '”' : s.filter === 'changed' ? 'Nothing is changed from the defaults' : 'This project overrides nothing'} /></> : pane(s.cat)}
            </fieldset>
          )}
        </main>
      </div>
    </div>
  )
}
