import { Fragment, useEffect, type ReactNode } from 'react'
import { CATEGORIES, PAGE_LABEL, PAGE_SETTINGS, ROWS, type Category, type SettingRow } from '@/fixtures/settings'
import { anyChanged, visible, type Hit } from '@/selectors/settingsView'
import { go } from '@/state/commands/nav'
import { clearFocusRow, resetCategory, setCat, toggleAdvanced } from '@/state/commands/settingsPage'
import type { CatId } from '@/state/slices/settings'
import { useStudio } from '@/state/store'
import { Btn, Empty } from '@/ui/primitives'
import { CUSTOM, UpdateNow } from './Controls'
import { ModelsPane } from './ModelsPane'
import { Row } from './SettingRow'

const bySection = (rows: SettingRow[]): Array<[string, SettingRow[]]> => {
  const out: Array<[string, SettingRow[]]> = []
  for (const r of rows) {
    const g = out.find(([s]) => s === r.section)
    if (g) g[1].push(r); else out.push([r.section, [r]])
  }
  return out
}

function RowOf({ row }: { row: SettingRow }) {
  const c = CUSTOM[row.id]
  return c ? <Row row={row}>{c()}</Row> : <Row row={row} />
}

function Section({ title, rows }: { title: string; rows: SettingRow[] }) {
  return (
    <section className="ssec" aria-label={title}>
      <h3 className="subh">{title}</h3>
      <div className="panel"><div className="rows">{rows.map((r) => <RowOf key={r.id} row={r} />)}</div></div>
    </section>
  )
}

/** Scroll to, focus and light up the setting another page asked for; it also opens the Advanced section it sits in. */
function useDeepLink(rows: SettingRow[], cat: CatId): void {
  const target = useStudio((s) => s.ui.settings.focusRow)
  const open = useStudio((s) => !!s.ui.settings.advanced[cat])
  useEffect(() => {
    if (!target) return
    const r = rows.find((x) => x.id === target)
    if (r?.advanced && !open) { toggleAdvanced(cat); return }
    const el = document.querySelector<HTMLElement>('[data-row="' + target + '"]')
    if (!el) return
    el.scrollIntoView?.({ block: 'center' })
    el.classList.add('flash')
    el.querySelector<HTMLElement>('input,button[role="combobox"],button,[role="radio"]')?.focus({ preventScroll: true })
    const t = setTimeout(() => el.classList.remove('flash'), 2200)
    clearFocusRow()
    return () => clearTimeout(t)
  }, [target, open, rows, cat])
}

function CategoryPane({ cat }: { cat: Category }) {
  const s = useStudio((x) => x)
  const rows = ROWS.filter((r) => r.cat === cat.id && visible(s.mock, r))
  const basic = rows.filter((r) => !r.advanced)
  const adv = rows.filter((r) => r.advanced)
  const open = !!s.ui.settings.advanced[cat.id]
  const changed = rows.filter((r) => anyChanged(s.ui.settings, r)).length
  useDeepLink(rows, cat.id)
  return (
    <>
      <div className="phd">
        <div><h2 id="stg-h" tabIndex={-1}>{cat.label}</h2><p className="sub" style={{ margin: 0 }}>{cat.blurb}</p></div>
        {changed ? <Btn className="sm quiet" onClick={() => resetCategory(cat.id)}>Reset {cat.label} to defaults</Btn> : null}
      </div>
      {cat.id === 'models' ? <ModelsPane /> : (
        <>
          {bySection(basic).map(([t, r]) => <Section key={t} title={t} rows={r} />)}
          {cat.id === 'app' ? <section className="ssec" aria-label="About"><h3 className="subh">About</h3><div className="panel"><div className="pb"><UpdateNow /></div></div></section> : null}
          {adv.length ? (
            <section className="ssec">
              <h3 className="subh"><button type="button" className="disc" aria-expanded={open} aria-controls={'adv-' + cat.id} onClick={() => toggleAdvanced(cat.id)}>
                <span aria-hidden="true">{open ? '▾' : '▸'}</span> Advanced <span className="sub">({adv.length})</span></button></h3>
              <div id={'adv-' + cat.id} hidden={!open}>{open ? bySection(adv).map(([t, r]) => <Section key={t} title={t} rows={r} />) : null}</div>
            </section>
          ) : null}
        </>
      )}
    </>
  )
}

function PageIndexTable({ items }: { items: typeof PAGE_SETTINGS }) {
  return (
    <div className="panel"><div className="rows">
      {items.map((p) => (
        <div className="srow" key={p.id} data-page-setting={p.id}>
          <div className="srow-l"><span className="srow-t"><b>{p.label}</b></span><span className="sub srow-d">{p.why}</span><span className="srow-m"><span className="sub">Set on {PAGE_LABEL[p.page]} › {p.where}</span></span></div>
          <div className="srow-c"><Btn className="sm" onClick={() => go(p.page)} aria-label={'Open ' + PAGE_LABEL[p.page] + ' to set ' + p.label}>Open {PAGE_LABEL[p.page]}</Btn></div>
        </div>
      ))}
    </div></div>
  )
}
export function PagesPane() {
  return (
    <>
      <div className="phd"><div><h2 id="stg-h" tabIndex={-1}>Set on a page</h2><p className="sub" style={{ margin: 0, maxWidth: '62ch' }}>These settings used to be here. Each one only changes what one page does, so it now sits on that page, next to what it changes. Search finds them too.</p></div></div>
      <PageIndexTable items={PAGE_SETTINGS} />
    </>
  )
}

/** The result list while the narrator searches or filters: rows from every category, each under the category it belongs to. */
export function Results({ hits, empty }: { hits: Hit[]; empty: string }) {
  const s = useStudio((x) => x)
  if (!hits.length) return <Empty title={empty}><span>Try a word from the setting’s name, such as “whisper”, “voice” or “reaper”.</span></Empty>
  const cats = [...new Set(hits.map((h) => h.cat))]
  return (
    <>
      {cats.map((c) => {
        const mine = hits.filter((h) => h.cat === c)
        const rows = mine.flatMap((h) => (h.row ? [h.row] : []))
        const pages = mine.flatMap((h) => (h.page ? [h.page] : []))
        const cat = CATEGORIES.find((x) => x.label === c)
        return (
          <section className="ssec" key={c} aria-label={c}>
            <h3 className="subh row">{c}{cat ? <button type="button" className="linkbtn" onClick={() => setCat(cat.id)}>Show the whole category</button> : null}</h3>
            {rows.length ? <div className="panel"><div className="rows">{rows.map((r) => <Fragment key={r.id}><RowOf row={r} /></Fragment>)}</div></div> : null}
            {pages.length ? <PageIndexTable items={pages} /> : null}
          </section>
        )
      })}
      <span className="sr-only" role="status">{hits.length} {hits.length === 1 ? 'setting' : 'settings'} found</span>
      <span hidden>{s.ui.settings.q}</span>
    </>
  )
}

export function pane(cat: CatId): ReactNode {
  if (cat === 'pages') return <PagesPane />
  return <CategoryPane cat={CATEGORIES.find((c) => c.id === cat)!} />
}

