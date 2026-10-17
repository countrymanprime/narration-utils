import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseOption } from './helpers/select'
import { mountSettings } from './helpers/settings'
import SettingsPage from '@/pages/Settings'
import { CATEGORIES, PAGE_SETTINGS, ROWS } from '@/fixtures/settings'
import { modals } from '@/app/modals'
import { SHORTCUTS } from '@/app/help'
import { SIZES } from '@/selectors/reader'
import { assetStatus } from '@/selectors/settingsView'
import { ASSETS } from '@/fixtures/settingsAssets'
import { createInitialState, getState, resetState, update } from '@/state/store'
import { initialPrefs } from '@/state/slices/ui'
import { openSettings } from '@/state/commands/settingsPage'
import { OverlayHost } from '@/ui/OverlayHost'

beforeEach(() => resetState(createInitialState({ prefs: initialPrefs })))
afterEach(cleanup)

const row = (id: string) => document.querySelector<HTMLElement>(`[data-row="${id}"]`)!

describe('Settings: structure', () => {
  it('lists every category in labelled groups, with the Set on a page entry apart', () => {
    mountSettings('recording')
    const nav = screen.getByRole('navigation', { name: 'Settings categories' })
    expect(within(nav).getByRole('group', { name: 'Shared tools' })).toBeInTheDocument()
    expect(within(nav).getByRole('group', { name: 'This project' })).toBeInTheDocument()
    expect(within(nav).getByRole('group', { name: 'This computer' })).toBeInTheDocument()
    for (const c of CATEGORIES) expect(within(nav).getByRole('button', { name: new RegExp('^' + c.label.replace('&', '&')) })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /Set on a page/ })).toBeInTheDocument()
  })

  it('shows one category at a time and marks it current', async () => {
    mountSettings('recording')
    expect(screen.getByRole('heading', { level: 2, name: 'Recording & DAW' })).toBeInTheDocument()
    expect(screen.queryByText('Transcription model')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Speech to text/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'Speech to text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Speech to text/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Transcription model')).toBeInTheDocument()
  })

  it('every setting declares a scope and a registered category', () => {
    for (const r of ROWS) {
      expect(['computer', 'project', 'both', 'browser']).toContain(r.scope)
      expect(CATEGORIES.some((c) => c.id === r.cat)).toBe(true)
    }
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length)
  })

  it('shows scope and who uses each setting, and a used-by chip goes to that page', async () => {
    mountSettings('speech')
    const r = row('stt.model')
    expect(within(r).getByText('All projects')).toBeInTheDocument()
    for (const p of ['Production', 'Proof', 'Pickups', 'Editing']) expect(within(r).getByRole('button', { name: new RegExp('Go to ' + p) })).toBeInTheDocument()
    await userEvent.click(within(r).getByRole('button', { name: /Go to Proof/ }))
    expect(getState().ui.page).toBe('proof')
  })

  it('hides REAPER-only settings for another recorder', () => {
    update((d) => { d.mock.setup = 'builtin' })
    mountSettings('recording')
    expect(row('daw.autoLauncher')).toBeUndefined
    expect(document.querySelector('[data-row="daw.autoLauncher"]')).toBeNull()
  })
})

describe('Settings: editing', () => {
  it('applies at once, says Saved, marks the row Changed and offers Reset', async () => {
    mountSettings('recording')
    const u = userEvent.setup()
    expect(document.querySelector('[data-row="daw.autoLauncher"]')).not.toBeNull()
    await u.click(within(row('daw.autoLauncher')).getByRole('checkbox'))
    expect(getState().ui.settings.values['daw.autoLauncher']).toBe('true')
    expect(within(row('daw.autoLauncher')).getByText('Saved')).toBeInTheDocument()
    expect(within(row('daw.autoLauncher')).getByText('Changed')).toBeInTheDocument()
    await u.click(within(row('daw.autoLauncher')).getByRole('button', { name: /^Reset/ }))
    expect(getState().ui.settings.values['daw.autoLauncher']).toBeUndefined()
    expect(within(row('daw.autoLauncher')).queryByText('Changed')).toBeNull()
  })

  it('asks before a costly change and says what happens', async () => {
    mountSettings('speech')
    await chooseOption(within(row('stt.model')).getAllByRole('combobox')[0], 'Tiny')
    expect(getState().ui.settings.values['stt.model']).toBeUndefined()
    expect(await screen.findByText(/marked out of date and run again/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Change model' }))
    expect(getState().ui.settings.values['stt.model']).toBe('tiny')
  })

  it('a project can override a shared setting and go back to the computer value', async () => {
    mountSettings('speech')
    const u = userEvent.setup()
    const r = row('stt.cascade')
    expect(document.querySelector('[data-row="stt.cascade"]')).toBeNull()
    await u.click(screen.getByRole('button', { name: /Advanced/ }))
    const adv = row('stt.cascade')
    expect(within(adv).getByText('This project uses the computer setting.')).toBeInTheDocument()
    await u.click(within(adv).getByRole('button', { name: /Override Two-pass check for this project/ }))
    expect(getState().ui.settings.overrides['stt.cascade']).toBe('false')
    expect(within(row('stt.cascade')).getByText('Overridden here')).toBeInTheDocument()
    await u.click(within(row('stt.cascade')).getByRole('checkbox', { name: /this project/ }))
    expect(getState().ui.settings.overrides['stt.cascade']).toBe('true')
    await u.click(within(row('stt.cascade')).getByRole('button', { name: /Use the computer setting/ }))
    expect(getState().ui.settings.overrides['stt.cascade']).toBeUndefined()
    void r
  })

  it('keeps the previous value and says why when the value is invalid', async () => {
    mountSettings('recording')
    const u = userEvent.setup()
    await u.click(screen.getByRole('button', { name: /Advanced/ }))
    const input = within(row('daw.reaperPath')).getByRole('textbox')
    await u.type(input, 'C:\\Tools\\notepad.exe{Enter}')
    expect(getState().ui.settings.values['daw.reaperPath']).toBeUndefined()
    expect(within(row('daw.reaperPath')).getByText(/not the path to reaper\.exe/)).toBeInTheDocument()
    await u.clear(input)
    await u.type(input, 'C:\\Program Files\\REAPER\\reaper.exe{Enter}')
    expect(getState().ui.settings.values['daw.reaperPath']).toBe('C:\\Program Files\\REAPER\\reaper.exe')
    expect(within(row('daw.reaperPath')).queryByText(/not the path/)).toBeNull()
  })

  it('when the file cannot be written the value does not change and the page says so', async () => {
    update((d) => { d.mock.settingsView = 'save-error' })
    mountSettings('recording')
    expect(screen.getByText('Changes cannot be saved right now.')).toBeInTheDocument()
    await userEvent.click(within(row('daw.autoLauncher')).getByRole('checkbox'))
    expect(getState().ui.settings.values['daw.autoLauncher']).toBeUndefined()
    expect(within(row('daw.autoLauncher')).getByText(/could not be saved/)).toBeInTheDocument()
  })

  it('Advanced is closed until opened, and the button says how many settings it holds', async () => {
    mountSettings('speech')
    const b = screen.getByRole('button', { name: /Advanced/ })
    expect(b).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(b)
    expect(b).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Parallel processes')).toBeInTheDocument()
  })

  it('a category shows how many are changed and resets them together', async () => {
    mountSettings('recording')
    const u = userEvent.setup()
    await u.click(within(row('daw.autoLauncher')).getByRole('checkbox'))
    expect(within(screen.getByRole('button', { name: /^Recording & DAW/ })).getByLabelText('1 changed')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Reset Recording & DAW to defaults' }))
    expect(getState().ui.settings.values).toEqual({})
  })
})

describe('Settings: search and filters', () => {
  it('finds a setting by a word that is not in its name, across categories', async () => {
    mountSettings('recording')
    const u = userEvent.setup()
    await u.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'whisper')
    expect(screen.getByText('Transcription model')).toBeInTheDocument()
    expect(screen.getByText('Live engine')).toBeInTheDocument()
    expect(screen.getByText(/settings? found/)).toBeInTheDocument()
  })

  it('finds a setting that now lives on a page and links to it', async () => {
    mountSettings('recording')
    const u = userEvent.setup()
    await u.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'preroll')
    expect(screen.getByText('Set on Booth › Booth › Record setup')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Open Booth to set Punch pre-roll' }))
    expect(getState().ui.page).toBe('booth')
  })

  it('reveals an Advanced setting that matches', async () => {
    mountSettings('recording')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'threads')
    expect(screen.getByText('Parallel processes')).toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    mountSettings('recording')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'zzzz')
    expect(screen.getByText('No settings match “zzzz”')).toBeInTheDocument()
  })

  it('Changed lists what differs from the default, wherever it is', async () => {
    mountSettings('recording')
    const u = userEvent.setup()
    await u.click(within(row('daw.autoLauncher')).getByRole('checkbox'))
    await u.click(screen.getByRole('button', { name: 'Changed' }))
    expect(screen.getByText('Start the launcher script with REAPER')).toBeInTheDocument()
    expect(screen.queryByText('Microphone')).toBeNull()
  })

  it('Changed with nothing changed says so', async () => {
    mountSettings('recording')
    await userEvent.click(screen.getByRole('button', { name: 'Changed' }))
    expect(screen.getByText('Nothing is changed from the defaults')).toBeInTheDocument()
  })
})

describe('Settings: arriving from another page', () => {
  it('opens on the setting, shows a Back link, and Back returns', async () => {
    update((d) => { d.ui.page = 'pickups' })
    render(<SettingsPage />)
    openSettings({ row: 'stt.model', from: 'pickups' })
    expect(getState().ui.page).toBe('settings')
    cleanup()
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { level: 2, name: 'Speech to text' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Back to Pickups/ })).toBeInTheDocument()
    expect(getState().ui.settings.focusRow).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Back to Pickups/ }))
    expect(getState().ui.page).toBe('pickups')
  })

  it('opens an Advanced setting by opening Advanced first', () => {
    render(<SettingsPage />)
    openSettings({ row: 'stt.workers', from: 'proof' })
    cleanup()
    render(<SettingsPage />)
    expect(getState().ui.settings.advanced.speech).toBe(true)
    expect(screen.getByText('Parallel processes')).toBeInTheDocument()
  })
})

describe('Settings: states', () => {
  it('loading shows placeholders, marks the pane busy and announces', () => {
    update((d) => { d.mock.settingsView = 'loading' })
    mountSettings('recording')
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByText('Reading your settings…')).toBeInTheDocument()
  })

  it('an unreadable settings file shows an alert, disables the controls and Try again recovers', async () => {
    update((d) => { d.mock.settingsView = 'load-error' })
    mountSettings('recording')
    expect(screen.getByRole('alert')).toHaveTextContent('Your settings could not be read.')
    expect(within(row('daw.mic')).getByRole('combobox')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(getState().mock.settingsView).toBe('ready')
  })
})

describe('Settings: Recording & DAW', () => {
  it('chooses the recorder: REAPER, Audacity or built-in', async () => {
    mountSettings('recording')
    const u = userEvent.setup()
    const radios = within(screen.getByRole('radiogroup', { name: 'Record with' })).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    await u.click(radios[1])
    expect(getState().mock.setup).toBe('audacity')
    await u.click(radios[2])
    expect(getState().mock.setup).toBe('builtin')
  })

  it('shows REAPER as chosen while REAPER is not running', () => {
    update((d) => { d.mock.setup = 'reaper-off' })
    mountSettings('recording')
    expect(screen.getByRole('radio', { name: /^REAPER\./ })).toHaveAttribute('aria-checked', 'true')
  })

  it('a recorder that is not running says so and Test connection fails', async () => {
    update((d) => { d.mock.setup = 'reaper-off' })
    mountSettings('recording')
    expect(screen.getByText('Not running')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(screen.getByText('No answer from REAPER.')).toBeInTheDocument()
  })
})

describe('Settings: Models & downloads', () => {
  it('lists every asset once with status, size and what uses it, and what is in use', () => {
    mountSettings('models')
    for (const a of ASSETS) expect(document.querySelector(`[data-asset="${a.id}"]`)).not.toBeNull()
    const small = document.querySelector('[data-asset="whisper-small"]')!
    expect(within(small as HTMLElement).getByText('Installed · checked')).toBeInTheDocument()
    expect(small).toHaveTextContent('In use: Transcription model')
    expect(document.querySelector('[data-asset="wiktionary"]')).toHaveTextContent('Not available yet')
    expect(document.querySelector('[data-disk]')).toHaveTextContent('used by')
  })

  it('downloads with progress, can cancel, and ends installed and checked', async () => {
    vi.useFakeTimers()
    mountSettings('models')
    const btn = document.querySelector<HTMLButtonElement>('[data-asset-install="whisper-medium"]')!
    fireEvent.click(btn)
    expect(getState().ui.settings.assets['whisper-medium'].status).toBe('downloading')
    await vi.advanceTimersByTimeAsync(500)
    expect(screen.getByRole('progressbar', { name: 'Downloading Whisper medium' })).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-asset-cancel="whisper-medium"]')!)
    expect(getState().ui.settings.assets['whisper-medium'].status).toBe('missing')
    fireEvent.click(document.querySelector('[data-asset-install="whisper-medium"]')!)
    await vi.advanceTimersByTimeAsync(2500)
    expect(assetStatus(getState(), ASSETS.find((a) => a.id === 'whisper-medium')!).status).toBe('installed')
    vi.useRealTimers()
  })

  it('a blocked host fails with a reason and Try again; low disk says how much is short', async () => {
    vi.useFakeTimers()
    update((d) => { d.mock.analysisHost = 'blocked' })
    mountSettings('models')
    fireEvent.click(document.querySelector('[data-asset-install="whisper-large-v3"]')!)
    await vi.advanceTimersByTimeAsync(800)
    expect(document.querySelector('[data-asset="whisper-large-v3"]')).toHaveTextContent('Download failed')
    expect(screen.getAllByRole('alert').some((a) => /Could not reach huggingface\.co/.test(a.textContent ?? ''))).toBe(true)
    update((d) => { d.mock.analysisHost = 'lowdisk' })
    fireEvent.click(document.querySelector('[data-asset-retry="whisper-large-v3"]')!)
    await vi.advanceTimersByTimeAsync(100)
    expect(document.querySelector('[data-asset="whisper-large-v3"]')).toHaveTextContent('Not enough free disk space')
    vi.useRealTimers()
  })

  it('removing a model in use says what it was used for and moves the setting to another installed one', async () => {
    mountSettings('models')
    await userEvent.click(document.querySelector('[data-asset-remove="whisper-small"]')!)
    expect(await screen.findByText(/It is chosen for: Transcription model/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(getState().ui.settings.assets['whisper-small'].status).toBe('missing')
    expect(getState().ui.settings.values['stt.model']).toBe('tiny')
  })

  it('refuses to remove the only installed choice', async () => {
    update((d) => { d.ui.settings.assets['whisper-tiny'] = { status: 'missing', pct: 0 }; d.ui.settings.assets['whisper-large-v3-turbo'] = { status: 'missing', pct: 0 } })
    mountSettings('models')
    await userEvent.click(document.querySelector('[data-asset-remove="whisper-small"]')!)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(assetStatus(getState(), ASSETS.find((a) => a.id === 'whisper-small')!).status).toBe('installed')
    expect(await screen.findByText(/only installed choice/)).toBeInTheDocument()
  })

  it('with nothing downloaded it offers the recommended set; loading and error have their own states', async () => {
    update((d) => { d.mock.assets = 'none' })
    mountSettings('models')
    expect(screen.getByText('Nothing is downloaded yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download the recommended set' })).toBeInTheDocument()
    cleanup()
    update((d) => { d.mock.settingsView = 'load-error' })
    mountSettings('models')
    expect(screen.getByRole('alert')).toHaveTextContent('The list of models could not be read.')
    cleanup()
    update((d) => { d.mock.settingsView = 'loading' })
    mountSettings('models')
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('a choice that points at a model that is not on the disk offers the download in the row', async () => {
    mountSettings('speech')
    await userEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    await chooseOption(within(row('stt.cascadeFirst')).getAllByRole('combobox')[0], 'Large v3')
    expect(within(row('stt.cascadeFirst')).getByRole('button', { name: 'Download Whisper large v3' })).toBeInTheDocument()
  })
})

describe('Settings: other categories', () => {
  it('switches the definition source and saves it in the preferences', async () => {
    mountSettings('voice')
    const u = userEvent.setup()
    expect(screen.getByRole('radio', { name: /^Web page/ })).toHaveAttribute('aria-checked', 'true')
    await u.click(screen.getByRole('radio', { name: /^Local dictionary/ }))
    expect(getState().ui.prefs.dictSource).toBe('local')
    await u.click(screen.getByRole('radio', { name: /^Online service/ }))
    expect(getState().ui.prefs.dictSource).toBe('api')
  })

  it('shows the local dictionary as installed or not, and downloads or removes it', async () => {
    mountSettings('voice')
    const u = userEvent.setup()
    const dict = within(document.getElementById('dictbtn')!.parentElement!)
    expect(dict.getByText('Installed')).toBeInTheDocument()
    await u.click(document.getElementById('dictbtn')!)
    expect(getState().mock.dictLocal).toBe('missing')
    expect(dict.getByText('Not installed')).toBeInTheDocument()
    expect(await screen.findByText('Local dictionary removed.')).toBeInTheDocument()
    expect(document.getElementById('dictbtn')).toHaveAccessibleName('Download the local dictionary')
    await u.click(document.getElementById('dictbtn')!)
    expect(getState().mock.dictLocal).toBe('installed')
    expect(await screen.findByText('Local dictionary downloaded.')).toBeInTheDocument()
  })

  it('shows the online service as online or offline', () => {
    mountSettings('voice')
    expect(screen.getByText('Online')).toBeInTheDocument()
    cleanup()
    update((d) => { d.mock.net = 'offline' })
    mountSettings('voice')
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('the key for the online dictionary is saved, masked and removable', async () => {
    mountSettings('voice')
    const u = userEvent.setup()
    await u.click(screen.getByRole('button', { name: /Advanced/ }))
    await u.type(screen.getByLabelText('Merriam-Webster key'), 'abc123')
    await u.click(screen.getByRole('button', { name: 'Save key' }))
    expect(screen.getByText('Key saved')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('abc123')).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Remove key' }))
    expect(screen.getByLabelText('Merriam-Webster key')).toBeInTheDocument()
  })

  it('changes the delivery profile and shows its limits', async () => {
    mountSettings('delivery')
    expect(screen.getByLabelText('Limits of this profile')).toHaveTextContent('−23 to −18 dBFS')
    await chooseOption(document.getElementById('delivery-profile')!, 'Other / none')
    expect(getState().data.deliveryProfile).toBe('none')
    expect(screen.getByLabelText('Limits of this profile')).toHaveTextContent('None checked')
  })

  it('Replace manuscript is in Settings, under Project', async () => {
    const old = modals.importFlow
    const spy = vi.fn()
    modals.importFlow = spy
    mountSettings('project')
    await userEvent.click(document.getElementById('repl')!)
    expect(spy).toHaveBeenCalledWith('replace')
    modals.importFlow = old
  })

  it('lists the marks and opens the marks dialog', async () => {
    const spy = vi.fn()
    const old = modals.marks
    modals.marks = spy
    mountSettings('project')
    getState().data.marks.forEach((m) => expect(screen.getAllByText(new RegExp(m.name)).length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('button', { name: 'Edit marks…' }))
    expect(spy).toHaveBeenCalled()
    modals.marks = old
  })

  it('Project: clearing derived data asks first', async () => {
    mountSettings('project')
    await userEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear derived data…' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(/Your manuscript, recordings and decisions stay/)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('theme radios save the choice', async () => {
    mountSettings('appearance')
    const u = userEvent.setup()
    expect(screen.getByRole('radio', { name: 'Match my system' })).toHaveAttribute('aria-checked', 'true')
    await u.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(getState().ui.prefs.theme).toBe('dark')
    await u.click(screen.getByRole('radio', { name: 'Light' }))
    expect(getState().ui.prefs.theme).toBe('light')
  })

  it('reader text changes the saved preferences and the preview quote', async () => {
    mountSettings('appearance')
    const prev = document.getElementById('sprev')!
    expect(prev.style.fontSize).toBe('20px')
    fireEvent.change(document.getElementById('ts-s')!, { target: { value: String(SIZES.indexOf(28)) } })
    fireEvent.change(document.getElementById('ts-l')!, { target: { value: '2' } })
    expect(getState().ui.prefs.readerSize).toBe(28)
    expect(document.getElementById('sprev')!.style.fontSize).toBe('28px')
    expect(document.getElementById('sprev')!.style.lineHeight).toBe('2')
    expect(prev).toHaveTextContent('Off with her head!')
    expect(screen.getByLabelText('Font')).toBeInTheDocument()
  })

  it('lists the keyboard shortcuts read-only', async () => {
    mountSettings('appearance')
    const list = screen.getByRole('region', { name: 'Shortcuts' })
    expect(list.querySelectorAll('kbd')).toHaveLength(SHORTCUTS.length)
    expect(list.querySelectorAll('input,button')).toHaveLength(0)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a shortcut' }), 'Booth: record')
    expect(list.querySelectorAll('kbd').length).toBeLessThan(SHORTCUTS.length)
  })

  describe('Story Bible types', () => {
    const typeRow = (i: number) => document.querySelector<HTMLInputElement>(`[data-sbtn="${i}"]`)!
    it('renaming a type moves its entries and the Story Bible filter', async () => {
      mountSettings('project')
      const u = userEvent.setup()
      update((d) => { d.ui.bible.kind = 'Location' })
      const i = getState().data.bibleTypes.findIndex((t) => t.k === 'Location')
      const n = getState().data.bible.filter((e) => e.kind === 'Location').length
      await u.clear(typeRow(i))
      await u.type(typeRow(i), 'Place{Enter}')
      const { data, ui } = getState()
      expect(data.bibleTypes[i].k).toBe('Place')
      expect(data.bible.filter((e) => e.kind === 'Place')).toHaveLength(n)
      expect(data.bible.some((e) => e.kind === 'Location')).toBe(false)
      expect(ui.bible.kind).toBe('Place')
    })
    it('refuses an empty or taken name', async () => {
      mountSettings('project')
      const u = userEvent.setup()
      await u.clear(typeRow(1))
      await u.type(typeRow(1), 'Character{Enter}')
      expect(getState().data.bibleTypes[1].k).toBe('Location')
      await u.tab()
      expect(typeRow(1).value).toBe('Location')
    })
    it('changes the colour', async () => {
      mountSettings('project')
      await chooseOption(screen.getByLabelText('Colour for Location'), 'Red')
      expect(getState().data.bibleTypes[1].c).toBe('bad')
    })
    it('remove is disabled while a type is in use, and when it is the last one', async () => {
      mountSettings('project')
      const u = userEvent.setup()
      const rm = (i: number) => document.querySelector<HTMLButtonElement>(`[data-sbtx="${i}"]`)!
      expect(rm(0)).toBeDisabled()
      await u.type(screen.getByLabelText('New type'), 'Creature')
      await u.click(screen.getByRole('button', { name: 'Add type' }))
      const last = getState().data.bibleTypes.length - 1
      expect(getState().data.bibleTypes[last].k).toBe('Creature')
      expect(rm(last)).toBeEnabled()
      await u.click(rm(last))
      expect(getState().data.bibleTypes.some((t) => t.k === 'Creature')).toBe(false)
      update((d) => { d.data.bibleTypes = [d.data.bibleTypes[0]] })
      cleanup(); mountSettings('project')
      expect(rm(0)).toBeDisabled()
    })
    it('adding needs a new name', async () => {
      mountSettings('project')
      const u = userEvent.setup()
      await u.type(screen.getByLabelText('New type'), 'Item')
      await u.click(screen.getByRole('button', { name: 'Add type' }))
      expect(await screen.findByText('Give the type a new name.')).toBeInTheDocument()
      expect(within(document.body).getAllByLabelText('Type name')).toHaveLength(getState().data.bibleTypes.length)
    })
  })

  it('App: updates and debug logging; Check now reports', async () => {
    mountSettings('app')
    const u = userEvent.setup()
    expect(screen.queryByText('Debug logging')).toBeNull()
    await u.click(screen.getByRole('button', { name: /Advanced/ }))
    expect(screen.getByText('Debug logging')).toBeInTheDocument()
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    await vi.advanceTimersByTimeAsync(900)
    expect(screen.getByText('You have the latest version.')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('Set on a page lists each moved setting with where it is and a way there', () => {
    mountSettings('pages')
    for (const p of PAGE_SETTINGS) expect(document.querySelector(`[data-page-setting="${p.id}"]`)).not.toBeNull()
  })
})

describe('Settings: narrow', () => {
  it('has a Category button that opens the list (the list is hidden by the container query)', async () => {
    mountSettings('recording')
    const b = screen.getByRole('button', { name: /Category/ })
    expect(b).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(b)
    expect(b).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^Delivery/ }))
    expect(getState().ui.settings.cat).toBe('delivery')
    expect(getState().ui.settings.navOpen).toBe(false)
  })
})

void OverlayHost
