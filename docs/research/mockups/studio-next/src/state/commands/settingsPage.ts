/**
 * Settings: navigation, edits, resets and the downloads list. A change applies at once (no Save button); when the host cannot write
 * it the previous value stays in effect and the row says so. Downloads are paced by a timer in the mock and can fail the ways a real one can.
 */
import { CATEGORIES, rowOf, ROWS, type SettingRow } from '@/fixtures/settings'
import { assetOf } from '@/fixtures/settingsAssets'
import { sizeText } from '@/format/size'
import { assetStatus, fallbackFor } from '@/selectors/settingsView'
import type { CatId, SettingsFilter } from '../slices/settings'
import type { Page } from '../slices/ui'
import { getState, update } from '../store'
import { announce, toast } from '@/ui/overlay'
import { go } from './nav'

export function openSettings(opts: { cat?: CatId; row?: string; from?: Page } = {}): void {
  const cat = opts.cat ?? (opts.row ? rowOf(opts.row).cat : getState().ui.settings.cat)
  update((d) => {
    d.ui.settings.cat = cat
    d.ui.settings.q = ''
    d.ui.settings.filter = 'all'
    d.ui.settings.focusRow = opts.row ?? null
    d.ui.settings.from = opts.from ?? null
    d.ui.settings.navOpen = false
  })
  go('settings')
}
export function backFromSettings(): void {
  const from = getState().ui.settings.from
  if (!from) return
  update((d) => { d.ui.settings.from = null })
  go(from)
}
export const clearFocusRow = (): void => update((d) => { d.ui.settings.focusRow = null })
export const setCat = (cat: CatId): void => update((d) => { d.ui.settings.cat = cat; d.ui.settings.q = ''; d.ui.settings.navOpen = false })
export const setQuery = (q: string): void => update((d) => { d.ui.settings.q = q })
export const setFilter = (f: SettingsFilter): void => update((d) => { d.ui.settings.filter = f })
export const toggleAdvanced = (cat: string): void => update((d) => { d.ui.settings.advanced[cat] = !d.ui.settings.advanced[cat] })
export const toggleNav = (): void => update((d) => { d.ui.settings.navOpen = !d.ui.settings.navOpen })

/** Why a value is not accepted, or null. The checks are the host's; the page only shows the sentence. */
export function problemWith(r: SettingRow, v: string): string | null {
  if (r.id === 'daw.reaperPath' && v.trim() && !/^[a-z]:\\.*reaper\.exe$/i.test(v.trim())) return 'This is not the path to reaper.exe. Use the full path, such as C:\\Program Files\\REAPER\\reaper.exe.'
  if (r.id === 'project.narrator' && v.length > 80) return 'Use 80 characters or fewer.'
  return null
}

function write(r: SettingRow, v: string, project: boolean): boolean {
  const bad = problemWith(r, v)
  const failing = getState().mock.settingsView === 'save-error'
  if (bad || failing) {
    update((d) => { d.ui.settings.errors[r.id] = bad ?? 'The change could not be saved because the settings file is read-only. The previous value is still in use.' })
    announce(r.label + ' not saved. ' + (bad ?? 'The settings file could not be written.'))
    return false
  }
  update((d) => {
    delete d.ui.settings.errors[r.id]
    const store = project ? d.ui.settings.overrides : d.ui.settings.values
    if (!project && v === r.def) delete d.ui.settings.values[r.id]
    else store[r.id] = v
    d.ui.settings.saved = { row: r.id, n: (d.ui.settings.saved?.n ?? 0) + 1 }
  })
  announce(r.label + ' saved.')
  return true
}
export const setComputer = (id: string, v: string): boolean => write(rowOf(id), v, false)
export const setOverride = (id: string, v: string): boolean => write(rowOf(id), v, true)
export function clearOverride(id: string): void {
  update((d) => { delete d.ui.settings.overrides[id]; delete d.ui.settings.errors[id]; d.ui.settings.saved = { row: id, n: (d.ui.settings.saved?.n ?? 0) + 1 } })
  announce(rowOf(id).label + ' now follows the computer setting.')
}
export function resetRow(id: string): void {
  update((d) => { delete d.ui.settings.values[id]; delete d.ui.settings.errors[id]; d.ui.settings.saved = { row: id, n: (d.ui.settings.saved?.n ?? 0) + 1 } })
  announce(rowOf(id).label + ' reset to its default.')
}
export function resetCategory(cat: CatId): void {
  const ids = ROWS.filter((r) => r.cat === cat).map((r) => r.id)
  update((d) => { for (const id of ids) { delete d.ui.settings.values[id]; delete d.ui.settings.overrides[id]; delete d.ui.settings.errors[id] } })
  announce(CATEGORIES.find((c) => c.id === cat)!.label + ' reset to defaults.')
  toast('Reset to defaults.')
}

// ---- downloads
const running = new Map<string, ReturnType<typeof setTimeout>>()
const STEP_MS = 220
const STEP_PCT = 20

function fail(id: string, pct: number, reason: string): void {
  running.delete(id)
  update((d) => { d.ui.settings.assets[id] = { status: 'failed', pct, reason } })
  announce((assetOf(id)?.name ?? id) + ' could not be downloaded. ' + reason)
}

export function installAsset(id: string): void {
  const a = assetOf(id)
  if (!a || running.has(id)) return
  const st = assetStatus(getState(), a).status
  if (st === 'installed' || st === 'unavailable') return
  const host = getState().mock.analysisHost
  if (host === 'lowdisk') return fail(id, 0, 'Not enough free disk space: ' + sizeText(a.sizeMB) + ' needed, 120 MB free.')
  update((d) => { d.ui.settings.assets[id] = { status: 'downloading', pct: 0 } })
  const tick = (pct: number): void => {
    if (getState().mock.analysisHost === 'blocked') return fail(id, pct, 'Could not reach ' + a.host + '. Check the connection and try again.')
    if (pct >= 100) {
      update((d) => { d.ui.settings.assets[id] = { status: 'verifying', pct: 100 } })
      running.set(id, setTimeout(() => {
        running.delete(id)
        update((d) => { d.ui.settings.assets[id] = { status: 'installed', pct: 100 } })
        announce(a.name + ' downloaded and checked.')
        toast(a.name + ' is ready.')
      }, STEP_MS))
      return
    }
    update((d) => { d.ui.settings.assets[id] = { status: 'downloading', pct } })
    running.set(id, setTimeout(() => tick(pct + STEP_PCT), STEP_MS))
  }
  running.set(id, setTimeout(() => tick(STEP_PCT), STEP_MS))
}
export function cancelAsset(id: string): void {
  const t = running.get(id)
  if (t) clearTimeout(t)
  running.delete(id)
  const a = assetOf(id)
  // A cancelled download goes back to what it was: not on the disk.
  update((d) => { d.ui.settings.assets[id] = { status: 'missing', pct: 0 } })
  if (a) toast('Download of ' + a.name + ' cancelled.')
}
export function dismissAssetFailure(id: string): void {
  update((d) => { d.ui.settings.assets[id] = { status: 'missing', pct: 0 } })
}
export function repairAsset(id: string): void {
  update((d) => { d.ui.settings.assets[id] = { status: 'missing', pct: 0 } })
  installAsset(id)
}

/**
 * Remove an asset. When a setting uses it, the setting moves to the smallest other installed choice and says so; when there is none the removal
 * is refused. Returns what happened so the caller can word it.
 */
export function removeAsset(id: string): { ok: true; moved: string[] } | { ok: false; reason: string } {
  const a = assetOf(id)
  if (!a) return { ok: false, reason: 'There is no such file.' }
  const s = getState()
  const moves: Array<[SettingRow, string]> = []
  for (const r of ROWS) {
    if (r.kind !== 'choice' || !r.options) continue
    const uses = (v: string | undefined): boolean => v !== undefined && r.options!.find((o) => o.value === v)?.asset === id
    if (uses(s.ui.settings.values[r.id] ?? r.def) || uses(s.ui.settings.overrides[r.id])) {
      const to = fallbackFor(s, r, id)
      if (!to) return { ok: false, reason: a.name + ' is the only installed choice for “' + r.label + '”. Download another first.' }
      moves.push([r, to])
    }
  }
  update((d) => {
    d.ui.settings.assets[id] = { status: 'missing', pct: 0 }
    for (const [r, to] of moves) {
      if (uses2(d.ui.settings.overrides[r.id], r, id)) d.ui.settings.overrides[r.id] = to
      if (uses2(d.ui.settings.values[r.id] ?? r.def, r, id)) { if (to === r.def) delete d.ui.settings.values[r.id]; else d.ui.settings.values[r.id] = to }
    }
  })
  toast(a.name + ' removed.')
  return { ok: true, moved: moves.map(([r, to]) => r.label + ' now uses ' + (r.options!.find((o) => o.value === to)?.label ?? to)) }
}
const uses2 = (v: string | undefined, r: SettingRow, id: string): boolean => v !== undefined && r.options!.find((o) => o.value === v)?.asset === id

export function clearProjectData(): void {
  toast('Derived data cleared. Checks will run again.')
}
