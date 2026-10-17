/** What the Settings page shows, derived from the rows, the narrator's changes and the mock's state. Pure functions of the store. */
import { ASSETS, assetOf, type AssetSpec } from '@/fixtures/settingsAssets'
import { CATEGORIES, PAGE_SETTINGS, ROWS, rowOf, type PageSetting, type SettingRow } from '@/fixtures/settings'
import type { AssetJob, AssetStatus, SettingsUi } from '@/state/slices/settings'
import type { StudioState } from '@/state/types'

type S = Pick<StudioState, 'ui' | 'mock'>

/** The value the project uses: its own override, else the computer value, else the default. */
export const computerValue = (s: SettingsUi, r: SettingRow): string => s.values[r.id] ?? r.def
export const projectValue = (s: SettingsUi, r: SettingRow): string => s.overrides[r.id] ?? computerValue(s, r)
export const hasOverride = (s: SettingsUi, r: SettingRow): boolean => r.scope === 'both' && s.overrides[r.id] !== undefined
export const isChanged = (s: SettingsUi, r: SettingRow): boolean => s.values[r.id] !== undefined && s.values[r.id] !== r.def
export const anyChanged = (s: SettingsUi, r: SettingRow): boolean => isChanged(s, r) || hasOverride(s, r)

/** The recorder this project uses, from the mock's setup. */
export const dawOf = (m: S['mock']): 'reaper' | 'audacity' | 'builtin' => (m.setup === 'audacity' ? 'audacity' : m.setup === 'builtin' ? 'builtin' : 'reaper')
export const visible = (m: S['mock'], r: SettingRow): boolean => !r.needs || dawOf(m) === 'reaper'

export function assetStatus(s: S, a: AssetSpec): AssetJob {
  const job = s.ui.settings.assets[a.id]
  if (job) return job
  let status: AssetStatus = a.base
  if (s.mock.assets === 'none' && status !== 'unavailable') status = 'missing'
  else if (a.id === 'dictionary') status = s.mock.dictLocal === 'installed' ? 'installed' : 'missing'
  return { status, pct: 0 }
}
export const installedAssets = (s: S): AssetSpec[] => ASSETS.filter((a) => assetStatus(s, a).status === 'installed' || assetStatus(s, a).status === 'repair')
export const diskUsedMB = (s: S): number => installedAssets(s).reduce((n, a) => n + a.sizeMB, 0)

/** Which choices of which settings point at this asset: "In use" is a reason not to remove it quietly. */
export function activeFor(s: S, a: AssetSpec): string[] {
  const out: string[] = []
  for (const r of ROWS) {
    if (r.kind !== 'choice' || !r.options) continue
    const picks = [computerValue(s.ui.settings, r), s.ui.settings.overrides[r.id]].filter((v): v is string => v !== undefined)
    if (picks.some((v) => r.options!.find((o) => o.value === v)?.asset === a.id)) out.push(r.label)
  }
  return out
}

/** The smallest installed asset a removal can fall back to for this choice, or null when there is none. */
export function fallbackFor(s: S, r: SettingRow, without: string): string | null {
  const have = (r.options ?? []).filter((o) => o.asset && o.asset !== without && assetOf(o.asset) && assetStatus(s, assetOf(o.asset)!).status === 'installed')
  return have[0]?.value ?? null
}

export interface Hit { row?: SettingRow; page?: PageSetting; cat: string }
const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean)
const hay = (...p: Array<string | undefined>): string => p.filter(Boolean).join(' ').toLowerCase()

/** Rows and page settings whose label, description, section, category or synonyms contain every word typed. */
export function search(s: S, q: string): Hit[] {
  const w = words(q)
  if (!w.length) return []
  const hits: Hit[] = []
  for (const r of ROWS) {
    if (!visible(s.mock, r)) continue
    const cat = CATEGORIES.find((c) => c.id === r.cat)!.label
    const h = hay(r.label, r.desc, r.section, cat, r.syn)
    if (w.every((x) => h.includes(x))) hits.push({ row: r, cat })
  }
  for (const p of PAGE_SETTINGS) if (w.every((x) => hay(p.label, p.where, p.why, p.syn).includes(x))) hits.push({ page: p, cat: 'Set on a page' })
  return hits
}

/** How many rows a category has that differ from the default, for the count on its entry in the list. */
export const changedCount = (s: S, cat: string): number => ROWS.filter((r) => r.cat === cat && visible(s.mock, r) && anyChanged(s.ui.settings, r)).length
export { rowOf }
