import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { chooseOption } from './helpers/select'
import { closePop, closeTopModal, dismissToast, getOverlay } from '@/ui/overlay'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Production from '@/pages/Production'
import { mountSettings } from './helpers/settings'
import { modals } from '@/app/modals'
import { ensureImportPrompt } from '@/state/commands/manuscript'
import { OverlayHost } from '@/ui/OverlayHost'
import { chName, outlineName } from '@/selectors/chapters'
import { act as rtlAct } from '@testing-library/react'
import { createInitialState, getState, resetState, update } from '@/state/store'
const upd = (fn: Parameters<typeof update>[0]) => rtlAct(() => update(fn))
import type { HeadingStyle } from '@/format/headings'

const mount = () => render(<><Production /><OverlayHost /></>)
/** Replacing the manuscript lives in Settings, under Manuscript. */
const mountSettingsPage = () => mountSettings('project')
beforeEach(() => resetState(createInitialState()))
afterEach(() => {
  cleanup()
  while (getOverlay().modals.length) closeTopModal()
  closePop()
  for (const t of getOverlay().toasts) dismissToast(t.id)
})
const flagOf = (id: string) => getState().data.chapters.find((c) => c.id === id)!

/** Settings opens the replace; Production is mounted too, where the flags it leaves behind show. */
function replaceFlow() {
  mountSettings('project', <Production />)
  fireEvent.click(document.getElementById('repl')!)
  fireEvent.click(screen.getByText('Choose a file…'))
  fireEvent.click(screen.getByRole('button', { name: 'Next: what changes' }))
}

describe('Import and replace', () => {
  it('Replace manuscript is in Settings, under Manuscript, and not on Production', () => {
    mount()
    expect(document.getElementById('repl')).toBeNull()
    expect(screen.queryByRole('button', { name: /Replace manuscript/ })).toBeNull()
    cleanup()
    mountSettingsPage()
    const section = screen.getByRole('heading', { name: 'Manuscript' }).closest('section') as HTMLElement
    expect(within(section).getByText(/^Imported /)).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'Replace manuscript…' }))
    expect(screen.getByRole('dialog', { name: 'Replace manuscript' })).toBeInTheDocument()
  })

  it('the first import asks for the delivery profile, from the profile list, and keeps the choice', async () => {
    upd((d) => { d.mock.hasManuscript = false; d.data.deliveryProfile = 'none' })
    mount()
    fireEvent.click(document.getElementById('imp0')!)
    fireEvent.click(screen.getByText('Choose a file…'))
    const sel = within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Delivery profile' })
    await chooseOption(sel, 'ACX')
    fireEvent.click(screen.getByText('Import reviewed manuscript'))
    expect(getState().data.deliveryProfile).toBe('acx')
  })

  it('a replace does not ask for the delivery profile', () => {
    replaceFlow()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(within(screen.getByRole('dialog')).queryByRole('combobox', { name: 'Delivery profile' })).toBeNull()
  })

  it('imports: choose, check the outline from the book data, import', () => {
    upd((d) => { d.mock.hasManuscript = false })
    mount()
    fireEvent.click(document.getElementById('imp0')!)
    expect(screen.getByText(/step 1 of 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Choose a file…'))
    expect(screen.getByText(/step 2 of 2/)).toBeInTheDocument()
    const { data } = getState()
    expect(screen.getByText('Opening pages')).toBeInTheDocument()
    expect(screen.getByText('Closing pages')).toBeInTheDocument()
    expect(screen.getAllByText(outlineName(data, data.chapters[3])).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Import reviewed manuscript'))
    expect(getState().mock.hasManuscript).toBe(true)
    expect(screen.getByText('Manuscript imported. 12 chapters found.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each<[HeadingStyle]>([['gutenberg'], ['numbered'], ['colon']])('outline and changes use the %s heading style', (headingStyle) => {
    resetState(createInitialState({ headingStyle }))
    replaceFlow()
    const { data } = getState()
    const c8 = data.chapters.find((c) => c.id === '8')!
    expect(screen.getByText(chName(data, c8), { selector: 'b' })).toBeInTheDocument()
  })

  it('Cancel and Back work; Escape closes', () => {
    mountSettingsPage()
    fireEvent.click(document.getElementById('repl')!)
    fireEvent.click(screen.getByText('Choose a file…'))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Choose your manuscript')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('replace in DAW mode flags changed chapters and leaves recordings alone', () => {
    replaceFlow()
    expect(screen.getByText(/Your recordings live in your DAW/)).toBeInTheDocument()
    expect(screen.getAllByText('Flag: check recording in REAPER')).toHaveLength(2)
    expect(screen.getByText('Flag only: not recorded yet')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Replace manuscript', { selector: 'button' }))
    expect(flagOf('3').flag).toMatchObject({ type: 'daw' })
    expect(flagOf('3').rec).toBe(100)
    expect(flagOf('8').flag).toMatchObject({ type: 'text' })
    expect(screen.getByText('Manuscript replaced. 3 chapters flagged.')).toBeInTheDocument()
  })

  it('replace in built-in mode archives the takes, flags the chapter, and Restore brings them back', () => {
    upd((d) => { d.mock.setup = 'builtin' })
    replaceFlow()
    expect(screen.getByText(/Your recordings were made in the app/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Replace manuscript', { selector: 'button' }))
    const c3 = flagOf('3')
    expect(c3).toMatchObject({ rec: 0, edit: 0, proof: 0, archived: 100 })
    expect(c3.flag?.type).toBe('archived')
    expect(c3.flag?.text).toContain('100% of takes archived')
    // The Production page shows the flag and the review dialog restores.
    fireEvent.click(screen.getAllByText('Text changed')[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    expect(flagOf('3').rec).toBe(100)
    expect(flagOf('3').flag).toBeUndefined()
    expect(screen.getByText('Archived takes restored.')).toBeInTheDocument()
  })

  it('the flags dialog marks chapters reviewed and stays open until none are left', () => {
    replaceFlow()
    fireEvent.click(screen.getByText('Replace manuscript', { selector: 'button' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    const dlg = screen.getByRole('dialog', { name: 'Chapters to review' })
    expect(dlg.querySelectorAll('[data-ok]')).toHaveLength(3)
    for (const id of ['3', '5']) fireEvent.click(dlg.querySelector(`[data-ok="${id}"]`)!)
    fireEvent.click(dlg.querySelector('[data-ok="8"]')!)
    expect(screen.getByText('No chapters need review.')).toBeInTheDocument()
  })

  it('Open in Script goes to the chapter', () => {
    replaceFlow()
    fireEvent.click(screen.getByText('Replace manuscript', { selector: 'button' }))
    rtlAct(() => modals.flags())
    fireEvent.click(document.querySelector('[data-view="5"]')!)
    expect(getState().ui.page).toBe('script')
    expect(getState().ui.script.pendingJump).toBe('5')
  })

  it('offers the import once per "no manuscript" period', () => {
    vi.useFakeTimers()
    const open = vi.fn()
    const old = modals.importFlow
    modals.importFlow = open
    upd((d) => { d.mock.hasManuscript = false })
    ensureImportPrompt()
    ensureImportPrompt()
    vi.runAllTimers()
    expect(open).toHaveBeenCalledTimes(1)
    expect(getState().ui.importPromptShown).toBe(true)
    upd((d) => { d.ui.importPromptShown = false })
    ensureImportPrompt()
    vi.runAllTimers()
    expect(open).toHaveBeenCalledTimes(2)
    modals.importFlow = old
    vi.useRealTimers()
  })
})

describe('Project picker', () => {
  it('opens Alice, refuses the others, pins, and starts a new project on Script', () => {
    mount()
    rtlAct(() => modals.projectPicker())
    expect(screen.getByRole('dialog', { name: 'Choose your project' })).toBeInTheDocument()
    fireEvent.click(document.querySelector('.pcard [data-open="glass"]')!)
    expect(screen.getByText('That project is not available here.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-pin="glass"]')!)
    expect(getState().ui.pinned).toEqual(['alice', 'glass'])
    expect(document.querySelector('[data-pin="glass"]')!.getAttribute('aria-label')).toBe('Unpin')
    fireEvent.click(screen.getByRole('button', { name: 'Preview taskbar jump list' }))
    expect(document.querySelectorAll('[data-jo]')).toHaveLength(3)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('.pcard [data-open="alice"]')!)
    expect(screen.getByText('Opened from REAPER: Alice.rpp')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('New project clears the manuscript, names the book, and goes to Script', () => {
    mount()
    rtlAct(() => modals.projectPicker())
    fireEvent.click(screen.getByText('New project'))
    const s = getState()
    expect(s.mock.hasManuscript).toBe(false)
    expect(s.data.projectName).toBe('Untitled book')
    expect(s.data.deliveryProfile).toBe('none')
    expect(s.ui.page).toBe('script')
  })
})
