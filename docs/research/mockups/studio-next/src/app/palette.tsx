import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { openModal } from '@/ui/overlay'
import { allCommands, searchAll, type PaletteItem } from './registry'
import { modals } from './modals'
import './commands'
import './search-sources'
import { Input } from '@/ui/primitives'

function hl(t: string, term: string): ReactNode {
  const k = term ? t.toLowerCase().indexOf(term) : -1
  return k < 0 ? t : <>{t.slice(0, k)}<mark>{t.slice(k, k + term.length)}</mark>{t.slice(k + term.length)}</>
}

/** The jump menu is also search: type to match pages, chapters, text in the manuscript, Story Bible entries and marks. Start with > for commands only. */
function Palette({ close, preset }: { close: () => void; preset: string }) {
  const [q, setQ] = useState(preset)
  const [i, setI] = useState(0)
  /** The group that is open. With nothing typed the menu shows only the pages and one row per group; a group opens to its own commands. */
  const [group, setGroup] = useState<string | null>(null)
  const ref = useRef<HTMLUListElement>(null)
  const items = useMemo(() => {
    const raw = q.trim()
    const cmdOnly = raw.startsWith('>')
    const term = (cmdOnly ? raw.slice(1) : raw).trim().toLowerCase()
    const out: PaletteItem[] = []
    const all = allCommands()
    const row = (c: (typeof all)[number], t = ''): PaletteItem => ({ g: c.g, h: hl(c.l, t && c.l.toLowerCase().includes(t) ? t : ''), sub: c.off ? 'Needs a manuscript' : c.k, rawSub: !c.off, fn: c.fn, off: c.off, keepOpen: Boolean(c.off) })
    if (!term && !cmdOnly) {
      if (group) {
        out.push({ g: group, h: '‹ All commands', fn: () => { setGroup(null); setI(0) }, keepOpen: true })
        all.filter((c) => c.g === group).forEach((c) => out.push(row(c)))
        return out
      }
      const groups = [...new Set(all.map((c) => c.g))]
      groups.forEach((g) => out.push({ g: 'Commands', h: g, sub: String(all.filter((c) => c.g === g).length), fn: () => { setGroup(g); setI(0) }, keepOpen: true }))
      return out
    }
    const cm = all.filter((c) => !term || c.l.toLowerCase().includes(term) || (c.hint && c.hint.includes(term)))
    if (!cmdOnly && term.length >= 2) out.push(...searchAll(term))
    cm.forEach((c) => out.push(row(c, term)))
    return out
  }, [q, group])
  const idx = Math.min(i, Math.max(0, items.length - 1))
  useEffect(() => { ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [idx, items])
  const run = (c?: PaletteItem): void => { if (c?.off) return; if (c?.keepOpen) { c.fn(); return } close(); c?.fn() }
  let last = ''
  return (
    <>
      <div className="border-0 border-b border-solid border-[var(--line)]">
      <Input
        variant="bare" className="big px-4 py-[14px] text-[16px]" id="pq" autoFocus autoComplete="off" aria-controls="pl" value={q} placeholder="Search, or jump to a page or chapter. Type > for commands."
        onChange={(e) => { setQ(e.target.value); setI(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(items.length - 1, idx + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, idx - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); run(items[idx]) }
          else if (e.key === 'Backspace' && !q && group) { e.preventDefault(); setGroup(null); setI(0) }
        }}
      />
      </div>
      <ul className="cmds" id="pl" role="listbox" ref={ref}>
        {items.length ? items.map((c, n) => {
          const head = c.g !== last
          last = c.g
          return (
            <span key={n} style={{ display: 'contents' }}>
              {head ? <li className="sec" role="presentation">{c.g}</li> : null}
              <li role="option" aria-selected={n === idx} aria-disabled={c.off ? 'true' : undefined} data-tip={c.off} data-n={n} onClick={() => run(c)}>
                <span>{c.h}</span>
                <span className="g">{c.off ? c.sub : c.keepOpen ? (c.sub ? c.sub + ' ›' : '') : c.rawSub && c.sub ? <kbd>{c.sub}</kbd> : c.sub}</span>
              </li>
            </span>
          )
        }) : <li style={{ cursor: 'default' }}>Nothing matches</li>}
      </ul>
    </>
  )
}

modals.palette = (preset = '') => openModal({ label: 'Jump menu', render: ({ close }) => <Palette close={close} preset={preset} /> })
