/**
 * Mock-only controls: they force the states the app can be in so every screen can be checked.
 * They live in the "Mock states" panel and are not part of the product.
 */
import type { AnalysisHost } from '@/domain/components'

export interface MockState {
  hasManuscript: boolean
  setup: 'reaper' | 'reaper-off' | 'builtin' | 'audacity'
  launch: 'daw' | 'start'
  companion: boolean
  /** Is the app's last change still on top of REAPER's undo list? */
  reaperTop: 'mine' | 'other'
  deliveryReady: boolean
  dictLocal: 'installed' | 'missing'
  net: 'online' | 'offline'
  /** Whether the recorder and the take log can report anything (room tone, recorded days, booth time). */
  measurements: 'available' | 'none'
  /** Whether the recogniser has transcribed the recordings (Editing draws the script against what was heard). */
  alignment: 'ready' | 'none'
  /** The project has changes in the DAW that are not saved yet. */
  dawUnsaved: boolean
  /** The DAW re-created its items and takes since the app read them: calls that name them are refused. */
  dawStale: boolean
  /** "Choose a file" uses a sample manuscript */
  autoSample: boolean
  deadline: 'ok' | 'tight' | 'behind' | 'custom'
  /** The host the optional analysis tools download from: reachable, blocked, or the disk has no room. */
  analysisHost: AnalysisHost
  /** The chapter REAPER's playhead is in (the top bar says the app is following it). */
  dawChapter: string
  /** Settings: what the page can read. `load-error`: the settings file cannot be read. `save-error`: a change cannot be written. */
  settingsView: 'ready' | 'loading' | 'load-error' | 'save-error'
  /** Settings: which models and voices are on the disk. */
  assets: 'mixed' | 'none'
  /** Which treatment the selected item (menu, list, row) gets, to compare options */
  highlight: 'soft' | 'pill' | 'bar' | 'outline' | 'solid'
}
export const initialMock: MockState = {
  hasManuscript: true, setup: 'reaper', launch: 'daw', companion: false, reaperTop: 'mine', deliveryReady: false,
  dictLocal: 'installed', net: 'online', measurements: 'available', alignment: 'ready', dawUnsaved: false, dawStale: false, autoSample: true, deadline: 'ok', analysisHost: 'reachable', dawChapter: '5', highlight: 'bar', settingsView: 'ready', assets: 'mixed',
}

export const DEADLINES = { ok: '2026-10-14', tight: '2026-10-04', behind: '2026-09-30' } as const
