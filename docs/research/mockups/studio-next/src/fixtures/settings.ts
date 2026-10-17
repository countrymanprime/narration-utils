/**
 * What the Settings page lists. Every row says who owns it (scope), which pages read it (used), where else it can be changed (also),
 * and whether it is Advanced. The page, the search and the "used by" chips are all built from this list, so a new setting is one entry here.
 * Keys and defaults follow `fieldSchemas` in the real host; ids here are the mock's own.
 */
import type { Page } from '@/state/slices/ui'
import type { CatId } from '@/state/slices/settings'

export interface Category { id: CatId; label: string; group: string; icon: string; blurb: string }
export const GROUPS = ['Shared tools', 'This project', 'This computer'] as const
export const CATEGORIES: Category[] = [
  { id: 'recording', label: 'Recording & DAW', group: 'Shared tools', icon: 'mic', blurb: 'How the app records and talks to your recording program.' },
  { id: 'speech', label: 'Speech to text', group: 'Shared tools', icon: 'wave', blurb: 'The one transcription engine that Booth, the recording check, Proof and Pickups listen with.' },
  { id: 'voice', label: 'Voice & pronunciation', group: 'Shared tools', icon: 'speaker', blurb: 'The voice that speaks previews, and where definitions and pronunciations come from.' },
  { id: 'models', label: 'Models & downloads', group: 'Shared tools', icon: 'download', blurb: 'Everything the app downloads, in one list. Pick which one is used in the section that uses it.' },
  { id: 'delivery', label: 'Delivery', group: 'Shared tools', icon: 'upload', blurb: 'The standard this project is judged against, and the limits it carries.' },
  { id: 'project', label: 'Project', group: 'This project', icon: 'book', blurb: 'The manuscript, the Story Bible vocabulary, narrator and credits of the open project.' },
  { id: 'appearance', label: 'Appearance & keys', group: 'This computer', icon: 'circleHalf', blurb: 'How the app looks and which keys do what on this computer.' },
  { id: 'app', label: 'App & updates', group: 'This computer', icon: 'gear', blurb: 'Updates, notifications and diagnostics.' },
]

export type Scope = 'computer' | 'project' | 'both' | 'browser'
export type Kind = 'choice' | 'bool' | 'number' | 'text' | 'custom'
export interface Option { value: string; label: string; asset?: string }
export interface SettingRow {
  id: string
  cat: CatId
  section: string
  label: string
  desc: string
  scope: Scope
  kind: Kind
  def: string
  options?: Option[]
  unit?: string
  min?: number
  max?: number
  step?: number
  /** Pages that read this value. */
  used: Page[]
  /** Other places that write the same value (a quick control), so the narrator is not surprised to see it change. */
  also?: string
  advanced?: boolean
  /** Words a narrator might type that the label does not contain. */
  syn?: string
  /** A change that costs something (checks re-run, files move) asks first and says what happens. */
  costly?: { title: string; body: string; confirm: string }
  /** Needs a DAW; the row is hidden for a recorder that cannot use it. */
  needs?: 'reaper'
  /** Text shown beside the control: a note on when it takes effect. */
  effect?: string
}

export const PAGE_LABEL: Record<Page, string> = {
  production: 'Production', schedule: 'Schedule', script: 'Script', bible: 'Story Bible', booth: 'Booth', editing: 'Editing',
  proof: 'Proof', pickups: 'Pickups', master: 'Master & QC', delivery: 'Delivery', settings: 'Settings',
}

const WHISPER: Option[] = [
  { value: 'tiny', label: 'Tiny', asset: 'whisper-tiny' },
  { value: 'small', label: 'Small', asset: 'whisper-small' },
  { value: 'medium', label: 'Medium', asset: 'whisper-medium' },
  { value: 'large-v3-turbo', label: 'Large v3 turbo', asset: 'whisper-large-v3-turbo' },
  { value: 'large-v3', label: 'Large v3', asset: 'whisper-large-v3' },
]

export const ROWS: SettingRow[] = [
  // ---- Recording & DAW
  { id: 'daw.engine', cat: 'recording', section: 'Recording tool', label: 'Record with', desc: 'Where this project’s recordings live. Changing it later does not move existing takes.', scope: 'project', kind: 'custom', def: 'reaper',
    used: ['booth', 'editing', 'pickups', 'proof', 'master'], syn: 'daw reaper audacity built-in recorder' },
  { id: 'daw.mic', cat: 'recording', section: 'Recording tool', label: 'Microphone', desc: 'The input the Booth listens to and the built-in recorder records with.', scope: 'computer', kind: 'choice', def: 'default',
    options: [{ value: 'default', label: 'System default' }, { value: 'shure', label: 'Shure SM7B (USB)' }, { value: 'array', label: 'Laptop microphone array' }],
    used: ['booth'], also: 'Booth › Levels menu', syn: 'input device audio interface' },
  { id: 'daw.reaperPath', cat: 'recording', section: 'REAPER', label: 'REAPER program', desc: 'The full path to reaper.exe, for when the app cannot find it.', scope: 'computer', kind: 'text', def: '',
    used: ['booth'], needs: 'reaper', advanced: true, syn: 'executable location path install', effect: 'Used the next time the app starts REAPER.' },
  { id: 'daw.autoLauncher', cat: 'recording', section: 'REAPER', label: 'Start the launcher script with REAPER', desc: 'Passes the launcher to REAPER as its startup script so the link is ready when REAPER opens.', scope: 'computer', kind: 'bool', def: 'false',
    used: ['booth'], needs: 'reaper', also: 'Booth › Set up recording', syn: 'startup action' },
  { id: 'daw.experimental', cat: 'recording', section: 'REAPER', label: 'Experimental REAPER actions', desc: 'Allows REAPER commands the app has not verified yet. Off keeps the app to the verified ones.', scope: 'computer', kind: 'bool', def: 'false',
    used: ['editing', 'pickups'], needs: 'reaper', advanced: true, syn: 'unverified commands capability' },
  { id: 'daw.capabilities', cat: 'recording', section: 'What the recording tool can do', label: 'Capabilities', desc: 'Each thing the app can ask the recording tool to do, with the reason when it cannot. Auto follows the tool.', scope: 'computer', kind: 'custom', def: 'auto',
    used: ['booth', 'editing', 'pickups', 'proof'], advanced: true, syn: 'record punch markers regions fx chains' },

  // ---- Speech to text
  { id: 'stt.model', cat: 'speech', section: 'Transcription', label: 'Transcription model', desc: 'The model that turns recordings into text for comparing against the manuscript. Bigger is slower and more accurate.', scope: 'both', kind: 'choice', def: 'small',
    options: WHISPER, used: ['production', 'proof', 'pickups', 'editing'], syn: 'whisper accuracy speed recording check compare engine',
    costly: { title: 'Change the transcription model?', body: 'Earlier checks were made with the current model. They are marked out of date and run again in the background.', confirm: 'Change model' } },
  { id: 'stt.live', cat: 'speech', section: 'Live reading in the Booth', label: 'Live engine', desc: 'Follows your voice in the Booth while you record. Whisper runs everywhere; Moonshine is quicker and Windows only.', scope: 'computer', kind: 'choice', def: 'whisper',
    options: [{ value: 'whisper', label: 'Whisper' }, { value: 'moonshine', label: 'Moonshine (Windows)' }], used: ['booth'], syn: 'teleprompter follow along moonshine' },
  { id: 'stt.liveModel', cat: 'speech', section: 'Live reading in the Booth', label: 'Live model', desc: 'A small model keeps the Booth in step with your reading.', scope: 'computer', kind: 'choice', def: 'tiny',
    options: [{ value: 'tiny', label: 'Tiny', asset: 'whisper-tiny' }, { value: 'small', label: 'Small', asset: 'whisper-small' }], used: ['booth'] },
  { id: 'stt.cascade', cat: 'speech', section: 'Recording check', label: 'Two-pass check', desc: 'A fast first pass, then a second model re-checks only what the first could not find.', scope: 'both', kind: 'bool', def: 'false',
    used: ['production', 'pickups'], advanced: true, syn: 'cascade first pass recheck' },
  { id: 'stt.cascadeFirst', cat: 'speech', section: 'Recording check', label: 'First-pass model', desc: 'Used for the whole recording.', scope: 'both', kind: 'choice', def: 'tiny', options: WHISPER, used: ['production'], advanced: true },
  { id: 'stt.cascadeRecheck', cat: 'speech', section: 'Recording check', label: 'Re-check model', desc: 'Used only for passages the first pass could not find or was unsure of.', scope: 'both', kind: 'choice', def: 'large-v3-turbo', options: WHISPER, used: ['production'], advanced: true },
  { id: 'stt.workers', cat: 'speech', section: 'Recording check', label: 'Parallel processes', desc: '0 lets the app choose from the model and this computer’s memory.', scope: 'both', kind: 'number', def: '0', min: 0, max: 16, step: 1,
    used: ['production', 'proof'], advanced: true, syn: 'threads cpu performance' },
  { id: 'stt.chunk', cat: 'speech', section: 'Recording check', label: 'Chunk length', desc: 'Long recordings are cut into pieces of this length and checked at the same time. 0 checks each file whole.', scope: 'both', kind: 'number', def: '300', unit: 's', min: 0, max: 900, step: 30,
    used: ['production', 'proof'], advanced: true, syn: 'seconds overlap' },

  // ---- Voice & pronunciation
  { id: 'voice.id', cat: 'voice', section: 'Preview voice', label: 'Preview voice', desc: 'The voice that says a name or word when you ask for a preview. It does not narrate anything.', scope: 'both', kind: 'choice', def: 'ljspeech',
    options: [{ value: 'ljspeech', label: 'LJ Speech (US English, high)', asset: 'voice-ljspeech' }], used: ['bible', 'script'], syn: 'tts text to speech piper' },
  { id: 'voice.dict', cat: 'voice', section: 'Definitions and pronunciations', label: 'Show definitions from', desc: 'Where a looked-up word gets its definition and pronunciation.', scope: 'computer', kind: 'custom', def: 'web',
    used: ['script', 'bible'], also: 'Script › Words tab', syn: 'dictionary wordnet merriam-webster lookup' },
  { id: 'voice.pron', cat: 'voice', section: 'Definitions and pronunciations', label: 'Pronunciation source for new names', desc: 'Which source a new name tries first. Automatic tries them in order.', scope: 'both', kind: 'choice', def: '',
    options: [{ value: '', label: 'Automatic' }, { value: 'cmu', label: 'CMU dictionary' }, { value: 'wiktionary', label: 'Wiktionary' }, { value: 'espeak', label: 'eSpeak' }], used: ['bible', 'script'], syn: 'ipa cmu wiktionary espeak' },
  { id: 'voice.mwKey', cat: 'voice', section: 'Definitions and pronunciations', label: 'Merriam-Webster key', desc: 'Your own key for online lookups. It is stored apart from the other settings and never shown again after you save it.', scope: 'computer', kind: 'custom', def: '',
    used: ['script', 'bible'], advanced: true, syn: 'api secret online dictionary' },

  // ---- Delivery
  { id: 'delivery.profile', cat: 'delivery', section: 'This project', label: 'Delivery profile', desc: 'The standard this project’s chapters are judged against. Master & QC and Delivery measure and word things from it.', scope: 'project', kind: 'custom', def: 'acx',
    used: ['master', 'delivery', 'production', 'schedule'], also: 'Delivery page, import review', syn: 'acx loudness rms peak noise floor limits platform' },
  { id: 'delivery.default', cat: 'delivery', section: 'For new projects', label: 'Default profile for new projects', desc: 'A new project starts with this profile; the first import still asks.', scope: 'computer', kind: 'choice', def: 'acx',
    options: [{ value: 'acx', label: 'ACX' }, { value: 'none', label: 'Other / none' }], used: ['production'] },
  { id: 'delivery.custom', cat: 'delivery', section: 'For new projects', label: 'Custom profiles', desc: 'Copies of a built-in profile with your own limits. Editing one changes every project that uses it.', scope: 'computer', kind: 'custom', def: '',
    used: ['master', 'delivery'], advanced: true, syn: 'duplicate edit delete limits' },

  // ---- Project
  { id: 'project.manuscript', cat: 'project', section: 'Manuscript', label: 'Manuscript', desc: 'The text this project is recorded from. Replacing it keeps recordings and re-matches them to the new text.', scope: 'project', kind: 'custom', def: '',
    used: ['script', 'booth', 'proof'], syn: 'import replace docx' },
  { id: 'project.build', cat: 'project', section: 'Story Bible', label: 'Build the Story Bible after import', desc: 'Starts the Story Bible build when a manuscript is imported. The import dialog can still turn it off for one import.', scope: 'both', kind: 'bool', def: 'true',
    used: ['bible', 'production'], syn: 'automatic scan' },
  { id: 'project.spacy', cat: 'project', section: 'Story Bible', label: 'Language model for the Story Bible', desc: 'Finds names and places in the manuscript.', scope: 'both', kind: 'choice', def: 'sm',
    options: [{ value: 'sm', label: 'Small (en_core_web_sm)', asset: 'spacy-sm' }, { value: 'lg', label: 'Large (en_core_web_lg)', asset: 'spacy-lg' }], used: ['bible'], syn: 'spacy nlp entity' },
  { id: 'project.types', cat: 'project', section: 'Story Bible', label: 'Entry types', desc: 'The kinds of entry in this project’s Story Bible, and which can speak a quoted line.', scope: 'project', kind: 'custom', def: '', used: ['bible', 'script'] },
  { id: 'project.marks', cat: 'project', section: 'Notes', label: 'Marks', desc: 'The vocabulary for marking the manuscript. Edited in the Script page’s mark editor.', scope: 'project', kind: 'custom', def: '', used: ['script'] },
  { id: 'project.narrator', cat: 'project', section: 'Narrator and credits', label: 'Narrator name', desc: 'Fills the narrator’s name in opening and closing credits.', scope: 'both', kind: 'text', def: 'Alex Reader',
    used: ['production', 'booth', 'delivery'], also: 'Credits setup dialog', syn: 'credits name' },
  { id: 'project.roomTone', cat: 'project', section: 'Narrator and credits', label: 'Room tone per credits file', desc: 'Silence added to each credits file when the length is estimated.', scope: 'computer', kind: 'number', def: '0', unit: 's', min: 0, max: 10, step: 1,
    used: ['production', 'schedule'], advanced: true },
  { id: 'project.credits', cat: 'project', section: 'Narrator and credits', label: 'Credits', desc: 'Templates for the opening and closing credits and the retail sample. Templates are shared; the filled-in values belong to this project.', scope: 'both', kind: 'custom', def: '',
    used: ['production', 'booth', 'delivery'], also: 'Booth, Script and Production “fix credits” links' },
  { id: 'project.data', cat: 'project', section: 'Project data', label: 'Clear derived data', desc: 'Removes checks, caches and analysis results. Your manuscript, recordings and decisions stay.', scope: 'project', kind: 'custom', def: '',
    used: ['proof', 'pickups'], advanced: true },

  // ---- Appearance & keys
  { id: 'look.theme', cat: 'appearance', section: 'Look', label: 'Theme', desc: 'Light, dark, or whichever Windows uses.', scope: 'browser', kind: 'custom', def: 'system',
    used: ['production', 'script', 'booth', 'editing', 'proof', 'master'], also: 'The theme button in the navigation rail', syn: 'dark mode light colour' },
  { id: 'look.reader', cat: 'appearance', section: 'Look', label: 'Reader text', desc: 'Font, size and spacing of the manuscript. The Booth uses its own size and your font.', scope: 'browser', kind: 'custom', def: '',
    used: ['script', 'booth'], also: 'Script › Text settings', syn: 'font size line spacing width' },
  { id: 'look.note', cat: 'appearance', section: 'Look', label: 'Note colour', desc: 'The colour of your notes in the manuscript.', scope: 'both', kind: 'choice', def: 'copper',
    options: [{ value: 'copper', label: 'Copper' }, { value: 'violet', label: 'Violet' }, { value: 'info', label: 'Blue' }, { value: 'ok', label: 'Green' }], used: ['script'], syn: 'color highlight' },
  { id: 'look.zoom', cat: 'appearance', section: 'Look', label: 'Zoom', desc: 'Scales the whole window. Ctrl + plus, Ctrl + minus and Ctrl 0 change it from anywhere.', scope: 'computer', kind: 'custom', def: '1',
    used: ['production', 'script', 'booth', 'editing', 'proof', 'master'], also: 'Header zoom chip, Ctrl + / −', syn: 'scale size dpi' },
  { id: 'keys.map', cat: 'appearance', section: 'Keyboard and pedals', label: 'Shortcuts', desc: 'Every command and its keys. Remap a key, or bind a pedal, from here.', scope: 'computer', kind: 'custom', def: '',
    used: ['booth', 'editing', 'proof', 'script'], syn: 'hotkeys keybindings pedal midi remap' },

  // ---- App & updates
  { id: 'app.updates', cat: 'app', section: 'Updates', label: 'Check for updates on startup', desc: 'Once a day, the app asks the release server whether a newer version exists. It sends nothing about you or your books.', scope: 'computer', kind: 'bool', def: 'true', used: [], syn: 'release version' },
  { id: 'app.channel', cat: 'app', section: 'Updates', label: 'Update channel', desc: 'Stable releases only, or release candidates as well.', scope: 'computer', kind: 'choice', def: 'candidates',
    options: [{ value: 'candidates', label: 'Candidates and stable' }, { value: 'stable', label: 'Stable only' }], used: [] },
  { id: 'app.notify', cat: 'app', section: 'Notifications', label: 'Tell me when a long task finishes', desc: 'Shows a Windows notification when a check or export ends while you are in another program.', scope: 'computer', kind: 'bool', def: 'true', used: ['production', 'proof', 'master'] },
  { id: 'app.debug', cat: 'app', section: 'Diagnostics', label: 'Debug logging', desc: 'Writes the reasons behind the app’s decisions to the run log. Turn it on when asked to send a log.', scope: 'computer', kind: 'bool', def: 'false', used: [], advanced: true, syn: 'log verbose run log diagnostics' },
]

export const rowOf = (id: string): SettingRow => ROWS.find((r) => r.id === id)!
export const catOf = (id: CatId): Category | undefined => CATEGORIES.find((c) => c.id === id)

/** Settings that used to be here and are set on the page that uses them. The Settings page lists them so search still finds them. */
export interface PageSetting { id: string; label: string; page: Page; where: string; why: string; syn?: string }
export const PAGE_SETTINGS: PageSetting[] = [
  { id: 'ps.coverage', label: 'Recording check rules', page: 'production', where: 'Recording check › Rules', why: 'Only the recording check reads them, and the run already shows the values it used.', syn: 'paragraph present missing run misread anchor threshold' },
  { id: 'ps.cleanup', label: 'Silence cleanup thresholds', page: 'master', where: 'Diagnostics › Silence cleanup', why: 'Tuned while looking at a chapter’s findings.', syn: 'breath click pad gap' },
  { id: 'ps.preview', label: 'Preview suggestion', page: 'proof', where: 'Preview › Options', why: 'Only the preview builder uses them.', syn: 'sample length tolerance spot check' },
  { id: 'ps.stages', label: 'Stage suggestions', page: 'production', where: 'Stage board › Suggestions', why: 'They shape the board they appear on.', syn: 'readiness signals required ignored' },
  { id: 'ps.compare', label: 'Compare defaults (chunk length, marker colours)', page: 'proof', where: 'Compare › Options', why: 'Chosen when starting a compare run.', syn: 'misread skipped extra colour' },
  { id: 'ps.punch', label: 'Punch pre-roll', page: 'booth', where: 'Booth › Record setup', why: 'It changes how a punch feels while recording.', syn: 'preroll seconds roll' },
  { id: 'ps.fx', label: 'Favourite effects', page: 'editing', where: 'Effects tab', why: 'Chosen from the effects list while editing.', syn: 'plugin fx chain' },
  { id: 'ps.fxcap', label: 'Effects coverage cap', page: 'editing', where: 'Effects tab', why: 'It already lives there only.', syn: 'percent warn' },
  { id: 'ps.backups', label: 'Audacity backups (window and retention)', page: 'editing', where: 'Backups tab', why: 'Three places edited it before; Editing is its one home.', syn: 'window days retention keep' },
]
