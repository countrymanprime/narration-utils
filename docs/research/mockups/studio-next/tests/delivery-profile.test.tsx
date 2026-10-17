import { act as rtlAct, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chooseOption } from './helpers/select'
import '@/app/commands'
import { allCommands } from '@/app/registry'
import { modals } from '@/app/modals'
import Companion from '@/pages/Companion'
import { ProjectPicker } from '@/pages/production/ProjectPicker'
import { mountSettings } from './helpers/settings'
import { PLATFORM_PROFILES } from '@/fixtures/platforms'
import { PlatformProfile } from '@/domain/schemas'
import { measureOptions, measureText } from '@/selectors/milestones'
import { platformHas, platformOf } from '@/selectors/platform'
import { setDeliveryProfile } from '@/state/commands/schedule'
import { newProject } from '@/state/commands/manuscript'
import { createInitialState, getState, resetState, update } from '@/state/store'
import { OverlayHost } from '@/ui/OverlayHost'
import { closeTopModal, getOverlay } from '@/ui/overlay'

beforeEach(() => resetState(createInitialState()))
afterEach(() => {
  cleanup()
  while (getOverlay().modals.length) closeTopModal()
})

describe('Delivery profile', () => {
  it('the profile list is data: ACX and a neutral Other / none, each valid against the schema', () => {
    expect(PLATFORM_PROFILES.map((p) => p.label)).toEqual(['ACX', 'Other / none'])
    for (const p of PLATFORM_PROFILES) expect(() => PlatformProfile.parse(p)).not.toThrow()
  })

  it('one lookup answers what a profile unlocks; an unknown profile reads as the neutral one', () => {
    const b = getState().data
    expect(platformHas(b, 'checkpoint15')).toBe(true)
    expect(platformHas({ deliveryProfile: 'none' }, 'checkpoint15')).toBe(false)
    expect(platformOf({ deliveryProfile: 'gone' }).id).toBe('none')
  })

  it('the checkpoint is offered as a measure only when the profile unlocks it, and a stored one stays selectable', () => {
    const offered = (p: string, cur?: string) => measureOptions({ deliveryProfile: p }, cur).map((o) => o.value)
    expect(offered('acx')).toContain('checkpoint')
    expect(offered('none')).not.toContain('checkpoint')
    expect(offered('none', 'checkpoint')).toContain('checkpoint')
    expect(measureOptions({ deliveryProfile: 'acx' }).find((o) => o.value === 'checkpoint')!.label).toBe('15-minute checkpoint')
  })

  it('measures read as the value the narrator chose', () => {
    expect(measureText('checkpoint')).toBe('First 15 finished minutes')
    expect(measureText('min20')).toBe('First 20 finished minutes')
    expect(measureText('ch4')).toBe('First 4 chapters edited and proofed')
    expect(measureText('all')).toBe('Whole book')
    expect(measureText(undefined)).toBe('Custom')
  })

  it('choosing ACX gives an unset contract the profile default and keeps a payment the narrator set', () => {
    update((d) => { d.data.contract = { payment: 'none', amount: null }; d.data.deliveryProfile = 'none' })
    rtlAct(() => setDeliveryProfile('acx'))
    expect(getState().data.deliveryProfile).toBe('acx')
    expect(getState().data.contract).toEqual({ payment: 'pfh', amount: null })
    update((d) => { d.data.contract = { payment: 'royalty', amount: 20 } })
    rtlAct(() => setDeliveryProfile('none'))
    expect(getState().data.contract).toEqual({ payment: 'royalty', amount: 20 })
  })

  it('a new project starts with no delivery profile chosen', () => {
    rtlAct(() => newProject())
    expect(getState().data.deliveryProfile).toBe('none')
  })

  it('is changed in Settings', async () => {
    mountSettings('delivery')
    expect(screen.getByRole('combobox', { name: 'Delivery profile' })).toHaveTextContent('ACX')
    await chooseOption(screen.getByRole('combobox', { name: 'Delivery profile' }), 'Other / none')
    expect(getState().data.deliveryProfile).toBe('none')
  })

  it('the palette still offers Replace manuscript, which opens the replace flow', () => {
    let mode = ''
    const old = modals.importFlow
    modals.importFlow = (m) => { mode = m }
    allCommands().find((c) => c.l === 'Replace manuscript…')!.fn()
    modals.importFlow = old
    expect(mode).toBe('replace')
  })
})

describe('App logo', () => {
  it('is the microphone in the project picker and the companion', () => {
    const { container } = render(<ProjectPicker close={() => {}} />)
    expect(container.querySelector('.logo svg')!.getAttribute('data-icon')).toBe('microphone')
    cleanup()
    update((d) => { d.mock.companion = true })
    const c = render(<Companion />)
    expect(c.container.querySelector('.cmph .logo svg')!.getAttribute('data-icon')).toBe('microphone')
  })
})
