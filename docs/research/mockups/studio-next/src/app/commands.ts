import { chName } from '@/selectors/chapters'
import { go, openInScript } from '@/state/commands/nav'
import { openSettings } from '@/state/commands/settingsPage'
import { CATEGORIES } from '@/fixtures/settings'
import { setPrefs, setZoom, toggleTheme } from '@/state/commands/prefs'
import { openFind } from '@/state/commands/script'
import { getState, undoLast, update } from '@/state/store'
import { toast } from '@/ui/overlay'
import { SIZES } from '@/selectors/reader'
import { modals } from './modals'
import { registerCommands, type Command } from './registry'

const PAGE_LIST: Array<[Parameters<typeof go>[0], string]> = [
  ['production', 'Production'], ['schedule', 'Schedule'], ['script', 'Script'], ['bible', 'Story Bible'], ['booth', 'Booth'],
  ['editing', 'Editing'], ['proof', 'Proof'], ['pickups', 'Pickups'], ['master', 'Master & QC'], ['delivery', 'Delivery'], ['settings', 'Settings'],
]
export const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5]

/** Commands every page has. Pages add their own with registerCommands. */
registerCommands(() => {
  const s = getState()
  const out: Command[] = []
  const add = (g: string, l: string, fn: () => void, k = '', hint?: string): void => { out.push({ g, l, k, fn, hint }) }
  PAGE_LIST.forEach(([p, l]) => add('Go to', 'Go to ' + l, () => go(p)))
  add('Settings', 'Open settings', () => openSettings({ from: getState().ui.page === 'settings' ? undefined : getState().ui.page }), 'Ctrl ,')
  CATEGORIES.forEach((c) => add('Settings', 'Settings: ' + c.label, () => openSettings({ cat: c.id }), '', 'settings'))
  s.data.chapters.forEach((c) => add('Chapters', 'Go to ' + chName(s.data, c), () => openInScript(c.id), '', 'chapter'))
  add('Manuscript', 'Find in the manuscript', () => openFind(), 'Ctrl F')
  add('Manuscript', 'Import manuscript…', () => modals.importFlow('import'))
  add('Manuscript', 'Replace manuscript…', () => modals.importFlow('replace'))
  add('Project', 'Switch project…', () => modals.projectPicker())
  const size = s.ui.prefs.readerSize
  add('Script', 'Larger reader text', () => { setPrefs({ readerSize: SIZES.find((v) => v > size) ?? size }); go('script') })
  add('Script', 'Smaller reader text', () => { setPrefs({ readerSize: [...SIZES].reverse().find((v) => v < size) ?? size }); go('script') })
  add('Script', 'Define my marks…', () => { go('script'); modals.marks() })
  add('Script', 'Show my queries to the author', () => { update((d) => { d.ui.script.tab = 'queries' }); go('script') })
  add('Script', 'Show my notes', () => { update((d) => { d.ui.script.tab = 'marks' }); go('script') })
  const z = s.ui.prefs.zoom
  add('Zoom', 'Zoom in', () => setZoom(Math.min(1.5, +(z + 0.1).toFixed(2))), '', 'zoom')
  add('Zoom', 'Zoom out', () => setZoom(Math.max(0.8, +(z - 0.1).toFixed(2))), '', 'zoom')
  add('Zoom', 'Reset zoom to 100%', () => setZoom(1), '', 'zoom')
  ZOOMS.forEach((v) => add('Zoom', 'Set zoom to ' + Math.round(v * 100) + '%', () => setZoom(v), '', 'zoom'))
  add('View', 'Toggle dark theme', () => toggleTheme(s.ui.prefs.theme))
  add('View', 'Show keyboard shortcuts', () => modals.help(), '?')
  add('View', 'Mock states…', () => modals.mockStates())
  const last = s.history[s.history.length - 1]
  if (last) add('Undo', 'Undo: ' + last.label, () => toast(undoLast().message), 'Ctrl Z')
  add('Undo', 'Undo history…', () => modals.history())
  return out
})
