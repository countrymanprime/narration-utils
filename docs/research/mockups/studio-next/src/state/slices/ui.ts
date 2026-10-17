/**
 * Screen state, by page. Each slice has its own initial value so a page can add fields without touching the others.
 * Nothing here is book data: it is where you are, what is selected, and how you like to read.
 */
import type { ComponentJob } from '@/domain/components'
import { initialSettings, type SettingsUi } from './settings'

export type Page = 'production' | 'schedule' | 'script' | 'bible' | 'booth' | 'editing' | 'proof' | 'pickups' | 'master' | 'delivery' | 'settings'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type DictSource = 'web' | 'local' | 'api'

/** Choices that follow the narrator between sessions. Saved to local storage. */
export interface Prefs {
  zoom: number
  theme: ThemeChoice
  /** Reader text */
  readerSize: number
  readerSpacing: number
  readerWidth: number
  readerFont: string
  dictSource: DictSource
  /** Story Bible analysis tools that are downloaded (ids from the component registry). */
  installedComponents: string[]
  /** 'ask': offer better analysis when a scan starts with none installed. 'basic': the narrator said not to ask again. */
  analysisPrompt: 'ask' | 'basic'
}
export const initialPrefs: Prefs = { zoom: 1, theme: 'system', readerSize: 20, readerSpacing: 1.7, readerWidth: 64, readerFont: 'Georgia', dictSource: 'web', installedComponents: [], analysisPrompt: 'ask' }

export interface ScriptUi {
  tab: 'pron' | 'bible' | 'marks' | 'queries' | 'bookmarks'
  /** Selected annotation id */
  sel: string | null
  /** Word shown in the Words tab */
  word: string | null
  /** Story Bible entry id shown in the side panel */
  entryId: string | null
  /** A looked-up text with no entry yet, and the selection it came from */
  miss: string | null
  missSel: SelectionInfo | null
  drawer: 'ch' | 'rail' | null
  find: { open: boolean; q: string; i: number; list: boolean }
  /** Counts up each time Find is asked for, so the box takes focus again even when it is already open */
  findNonce: number
  /** Reader scroll requests, consumed once by the page */
  pendingJump: string | null
  pendingPid: string | null
  qfilter: 'open' | 'resolved' | 'all'
  whoSel: Record<string, 'author' | 'you'>
  /** "annotationId:messageIndex" being edited */
  aedit: string | null
  /** Chapter at the top of the reader */
  spyAt: string | null
  /** A bookmark the reader is asked to scroll to (consumed once), the one last gone to (next / previous start from it), and the paragraph lit for a moment */
  pendingBm: string | null
  bmAt: string | null
  bmFlash: string | null
}
export interface SelectionInfo { pid: string; s: number; e: number; q: string }
export const initialScript: ScriptUi = {
  tab: 'pron', sel: null, word: null, entryId: null, miss: null, missSel: null, drawer: null,
  find: { open: false, q: '', i: 0, list: true }, findNonce: 0, pendingJump: null, pendingPid: null, qfilter: 'open', whoSel: {}, aedit: null, spyAt: null, pendingBm: null, bmAt: null, bmFlash: null,
}

export type ProofSort = 'time' | 'confidence' | 'severity'
export interface ProofUi {
  scope: 'all' | 'chapter'
  sel: number | null
  /** `open`: not decided yet. `unfixed`: not cleared (decided but not fixed, waived or dismissed counts too). `done`: decided. */
  filter: 'all' | 'open' | 'unfixed' | 'done' | 'pickup'
  sort: ProofSort
  /** The evidence each note had when the narrator last looked at it (key and heard text), by note id. */
  seen: Record<number, { key: string; heard: string }>
  /** What the narrator typed to go with a decision, by note id. It stays until the decision is made. */
  dnote: Record<number, string>
  query: string
  findOpen: boolean
  who: 'proofer' | 'you'
  /** Index of the thread message being edited */
  edit: number | null
  winStart: number
  winLen: number
  /** Note the window was last centred on */
  winFor: number | null
  winFilter: boolean
  /** Seconds, while playing a note's context */
  play: number | null
  /** The take being played raw at a flagged spot (Takes at this spot), or null. */
  takePlay: string | null
  /** The recording check running now (chapter and percent done), or null. */
  checkRun: { chapterId: string; pct: number } | null
  /** The check's findings are listed under the card. */
  findingsOpen: boolean
  /** Which findings the list shows. */
  findingsFilter: 'todo' | 'accepted' | 'ignored'
}
export const initialProof: ProofUi = { scope: 'all', sel: 1, filter: 'all', sort: 'time', seen: {}, dnote: {}, query: '', findOpen: false, who: 'proofer', edit: null, winStart: 0, winLen: 60, winFor: null, winFilter: true, play: null, takePlay: null, checkRun: null, findingsOpen: false, findingsFilter: 'todo' }

import { DEFAULT_OFFLINE_ENGINE } from '@/fixtures/speech'
import type { CleanupKind, CleanupParams, DrawerTab, Level } from '@/selectors/editing'
import { initialLevels, initialParams } from '@/selectors/editing'
import type { Sel } from '@/selectors/scriptedit'
import type { FxScope } from '@/domain/schemas'

/** The effect being added: its range, preset, scope and (for a take-level effect) the take. */
export interface FxDraft { start: number; end: number; preset: string; scope: FxScope; takeId: string | null }
export interface EditingUi {
  /** The drawer beside the script: clean-up findings, effects, backups, and (narrow widths) the timeline. Null when it is closed. */
  drawer: DrawerTab | null
  /** The synchronized timeline strip under the script (wide windows). */
  strip: boolean
  /** The word the keys are on; the playing word and the selection start from here. */
  cursor: string | null
  /** The selected words (whole words, in the text's order); null when only the cursor is placed. */
  sel: Sel | null
  /** The word whose card (misread, low confidence, a second read) is open, or `dup:` and a paragraph id for a line read twice. */
  flag: string | null
  /** Which kind of word the drawer's list is stepping through, when it is. */
  flagKind: string | null
  /** Seconds into the chapter recording while the script plays; null when it does not. */
  playT: number | null
  /** The script plays to here and stops (a selection); null plays on. */
  playTo: number | null
  /** The text follows the playing word. A hand scroll stops it until the next play. */
  follow: boolean
  /** Passages whose takes are open under the line. */
  openTakes: string[]
  /** Selected passage (the one the cursor is in), cleanup operation, and effect region. */
  passage: string | null
  /** The take the keyboard is on (T and Shift+T move it, Enter keeps it). Null follows the active take. */
  take: string | null
  /** The take being played now (a second Space stops it); null when nothing plays. */
  playing: string | null
  /** The two takes being compared. Null follows the defaults. */
  abA: string | null
  abB: string | null
  op: CleanupKind
  /** The level chosen for each operation, or null once a threshold was edited by hand. */
  level: Record<CleanupKind, Level | null>
  params: Record<CleanupKind, CleanupParams>
  /** Findings the narrator unticked; every other proposal is applied. */
  skip: string[]
  /** The finding highlighted in the list. */
  row: string | null
  advanced: boolean
  /** Passages whose hidden takes are shown for a look (nothing changes in the DAW). */
  revealed: string[]
  fx: string | null
  /** The add-effect form is open. */
  adding: boolean
  draft: FxDraft
}
export const initialEditing: EditingUi = {
  drawer: null, strip: false, cursor: null, sel: null, flag: null, flagKind: null, playT: null, playTo: null, follow: true, openTakes: [],
  passage: null, take: null, playing: null, abA: null, abB: null, op: 'gaps', level: initialLevels(), params: initialParams(),
  skip: [], row: null, advanced: false, revealed: [], fx: null, adding: false, draft: { start: 60, end: 70, preset: 'robot', scope: 'section', takeId: null },
}

export interface PickupsUi {
  scope: 'all' | 'chapter'
  sel: string | null
  /** The Booth is showing a pickup session */
  mode: boolean
  /** Ids of the lines in the session */
  lines: string[]
  at: string | null
}
export const initialPickups: PickupsUi = { scope: 'all', sel: null, mode: false, lines: [], at: null }

export interface MasterUi { row: string | null }
export const initialMaster: MasterUi = { row: null }

export interface DeliveryUi { profile: string; built: boolean; out: string }
export const initialDelivery: DeliveryUi = { profile: 'acx', built: false, out: 'C:\\Audiobooks\\Alice\\delivery' }

export interface BoothRef { entryId: string | null; annId: string | null }
export interface BoothUi {
  rec: boolean
  recSec: number
  /** Phrase and word being read */
  cur: number
  wcur: number
  textSize: number
  take: number
  rail: boolean
  /** Seconds recorded in earlier takes this session */
  recAll: number
  /** Phrase the current take started at */
  takeFrom: number
  /** Seconds into the chapter recording where the current take started */
  takeAt: number
  /** Each roll again: the paragraph it rolled from and when in the take */
  punches: Array<{ pi: number; at: string }>
  /** Phrase the narrator chose to start (or roll again) from, or null */
  punchAt: number | null
  /** The take is held while a Booth menu is open */
  paused: boolean
  /** While recording, the phrase the narrator is browsing to (the wheel); null follows the reading position */
  browse: boolean
  /** What the side panel shows at the top: a Story Bible entry and/or an annotation clicked in the text */
  ref: BoothRef | null
  mic: string
  inLevel: number
  outLevel: number
}
export const initialBooth: BoothUi = {
  rec: false, recSec: 0, cur: 0, wcur: 0, textSize: 40, take: 3, rail: true, recAll: 0, takeFrom: 0, takeAt: 0,
  punches: [], punchAt: null, paused: false, browse: false, ref: null, mic: 'USB audio interface · Input 1', inLevel: 70, outLevel: 60,
}

import type { BibleEntry, Relationship } from '@/domain/schemas'
/** An entry opens read-only. Editing keeps a copy of the entry and its relationships so Cancel can put them back. */
export interface BibleEdit {
  id: string; entry: BibleEntry; rels: Relationship[]
  /** A new entry that has not been saved: Cancel (or leaving it) drops it. */
  draft?: boolean
}
export type BibleSort = 'name' | 'type' | 'chapters'
export interface BibleUi {
  sel: string | null; q: string; kind: string; editing: BibleEdit | null
  sort: BibleSort
  /** Only the entries that arrived from the import and have not been reviewed. */
  reviewOnly: boolean
  /** Only what has something to verify, with the suggestions that have no entry yet. */
  verifyOnly: boolean
  /** A suggestion with no entry yet, shown where an entry would be. */
  selSug: string | null
}
export const initialBible: BibleUi = { sel: 'queen-of-hearts', q: '', kind: 'All', editing: null, sort: 'name', reviewOnly: false, verifyOnly: false, selSug: null }

export interface CheckConfig { model: string; chunk: number; overlap: number; workers: number }
export const initialCheck: CheckConfig = { model: DEFAULT_OFFLINE_ENGINE, chunk: 30, overlap: 2, workers: 4 }

export interface UiState {
  page: Page
  /** Project ids pinned to the taskbar jump list. */
  pinned: string[]
  /** The import dialog has been offered for this "no manuscript" period (Script page). */
  importPromptShown: boolean
  /** The chapter every page shares. */
  chapter: string
  prefs: Prefs
  script: ScriptUi
  proof: ProofUi
  editing: EditingUi
  pickups: PickupsUi
  master: MasterUi
  delivery: DeliveryUi
  booth: BoothUi
  bible: BibleUi
  check: CheckConfig
  /** Downloads in progress or failed, by component id. */
  components: Record<string, ComponentJob>
  settings: SettingsUi
  /** Companion window: the note shown (shares the Proof selection). */
}
export const initialUi = (prefs: Prefs): UiState => ({
  page: 'production', pinned: ['alice'], importPromptShown: false, chapter: '8', prefs,
  script: initialScript, proof: initialProof, editing: initialEditing, pickups: initialPickups, master: initialMaster, delivery: initialDelivery,
  booth: initialBooth, bible: initialBible, check: initialCheck, components: {}, settings: initialSettings,
})
