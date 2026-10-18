import { act as rtlAct, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { modals } from '@/app/modals'
import { navReason, MANUSCRIPT_REASON } from '@/selectors/nav'
import { createInitialState, getState, resetState, update } from '@/state/store'
import { closePop, closeTopModal, getOverlay } from '@/ui/overlay'

const GATED = ['Schedule', 'Script', 'Story Bible', 'Booth', 'Editing', 'Proof', 'Pickups', 'Master & QC', 'Delivery']
const OPEN = ['Production', 'Settings']
const rail = (): HTMLElement => screen.getByRole('navigation', { name: 'Main' })
const item = (name: string): HTMLElement => within(rail()).getByRole('button', { name })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  resetState(createInitialState())
})
afterEach(() => {
  cleanup()
  closePop()
  while (getOverlay().modals.length) closeTopModal()
})

describe('Rail with no manuscript', () => {
  it('the table gates the nine pages and never Production or Settings', () => {
    expect(navReason('production', false)).toBeUndefined()
    expect(navReason('settings', false)).toBeUndefined()
    for (const page of ['schedule', 'script', 'bible', 'booth', 'editing', 'proof', 'pickups', 'master', 'delivery'] as const) {
      expect(navReason(page, false), page).toBe(MANUSCRIPT_REASON)
      expect(navReason(page, true), page).toBeUndefined()
    }
  })

  it('shows the nine pages off, each still a focusable button that keeps its name and says why', () => {
    update((d) => { d.mock.hasManuscript = false })
    render(<App />)
    for (const name of GATED) {
      const b = item(name)
      expect(b.getAttribute('aria-disabled'), name).toBe('true')
      expect((b as HTMLButtonElement).disabled, name).toBe(false)
      expect(b.tabIndex, name).toBeGreaterThanOrEqual(0)
      expect(b.getAttribute('data-tip'), name).toBe(MANUSCRIPT_REASON)
      expect(b.getAttribute('aria-describedby'), name).toBeTruthy()
      expect(document.getElementById(b.getAttribute('aria-describedby')!)?.textContent, name).toBe(MANUSCRIPT_REASON)
    }
    for (const name of OPEN) expect(item(name).getAttribute('aria-disabled'), name).toBeNull()
  })

  it('offers every page once a manuscript is imported', () => {
    render(<App />)
    for (const name of GATED) expect(item(name).getAttribute('aria-disabled'), name).toBeNull()
  })

  it('a press on an off item opens a note with the reason and does not leave the page', async () => {
    update((d) => { d.mock.hasManuscript = false })
    render(<App />)
    const before = getState().ui.page
    await userEvent.setup().click(item('Proof'))
    expect(getState().ui.page).toBe(before)
    expect(document.querySelector('.navwhy')?.textContent).toContain(MANUSCRIPT_REASON)
  })

  it('Enter on a focused off item does the same', async () => {
    update((d) => { d.mock.hasManuscript = false })
    render(<App />)
    const u = userEvent.setup()
    item('Booth').focus()
    await u.keyboard('{Enter}')
    expect(document.querySelector('.navwhy')?.textContent).toContain(MANUSCRIPT_REASON)
    expect(getState().ui.page).not.toBe('booth')
  })

  it('draws no count badge: the notes and pickups held belong to the earlier manuscript', () => {
    update((d) => { d.mock.hasManuscript = false })
    render(<App />)
    expect(rail().querySelectorAll('.ct').length).toBe(0)
  })

  it('removing the manuscript while on a gated page keeps the page, which asks for one, and marks its item current and off', () => {
    update((d) => { d.ui.page = 'proof' })
    render(<App />)
    rtlAct(() => update((d) => { d.mock.hasManuscript = false }))
    expect(getState().ui.page).toBe('proof')
    expect(screen.getByText('This project has no manuscript yet. Import one to begin.')).toBeTruthy()
    expect(item('Proof').getAttribute('aria-current')).toBe('page')
    expect(item('Proof').getAttribute('aria-disabled')).toBe('true')
  })

  it('an item that is focused when the manuscript goes keeps focus', () => {
    render(<App />)
    item('Pickups').focus()
    rtlAct(() => update((d) => { d.mock.hasManuscript = false }))
    expect(document.activeElement).toBe(item('Pickups'))
  })
})

describe('Jump menu with no manuscript', () => {
  it('lists the nine pages off with the reason and runs nothing on Enter or a click', async () => {
    update((d) => { d.mock.hasManuscript = false; d.ui.page = 'production' })
    render(<App />)
    rtlAct(() => modals.palette())
    const u = userEvent.setup()
    await u.type(document.querySelector<HTMLInputElement>('#pq')!, 'Go to')
    for (const name of GATED) {
      const row = screen.getByRole('option', { name: new RegExp('^Go to ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
      expect(row.getAttribute('aria-disabled'), name).toBe('true')
      expect(row.getAttribute('data-tip'), name).toBe(MANUSCRIPT_REASON)
    }
    await u.click(screen.getByRole('option', { name: /^Go to Proof/ }))
    expect(getState().ui.page).toBe('production')
    expect(getOverlay().modals.length).toBe(1)
    expect(screen.getByRole('option', { name: /^Go to Production/ }).getAttribute('aria-disabled')).toBeNull()
    expect(screen.getByRole('option', { name: /^Go to Settings/ }).getAttribute('aria-disabled')).toBeNull()
  })
})
