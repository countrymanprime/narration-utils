import { act as rtlAct, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountSettings } from './helpers/settings'
import { linesOf } from '@/selectors/bible'
import { phrasesOf, unattributed } from '@/selectors/phrases'
import { NARRATOR, entryOfSpeaker, speakerCandidates, speakerIn } from '@/selectors/speakers'
import { addName, removeName, renameEntry } from '@/state/commands/bible'
import { setTypeSpeaks } from '@/state/commands/settings'
import { createInitialState, getState, resetState, update } from '@/state/store'
import { openSpeakerPicker } from '@/ui/SpeakerPicker'
import { OverlayHost } from '@/ui/OverlayHost'

const upd = (fn: Parameters<typeof update>[0]): void => { rtlAct(() => update(fn)) }
beforeEach(() => resetState(createInitialState()))
afterEach(cleanup)

const data = () => getState().data
const aliases = () => speakerCandidates(data()).map((c) => c.alias)

describe('speakers are derived from the Story Bible', () => {
  it('are the aliases of entries whose type can speak', () => {
    expect(aliases()).toEqual(expect.arrayContaining(['Alice', 'Queen', 'Five', 'Seven', 'Two']))
    expect(aliases()).not.toContain('garden')
    expect(aliases()).not.toContain('thimble')
    const c = speakerCandidates(data()).find((x) => x.alias === 'Five')!
    expect(c).toMatchObject({ entryName: 'The gardeners', kind: 'Character', colour: 'violet' })
    expect(entryOfSpeaker(data(), 'Five')?.id).toBe('the-gardeners')
    expect(entryOfSpeaker(data(), 'garden')).toBeUndefined()
  })

  it('detects "said X" by alias, longest first, whole words, ignoring case', () => {
    const d = data()
    expect(speakerIn('said Five, in a sulky tone', d)).toBe('Five')
    expect(speakerIn('said the QUEEN OF HEARTS', d)).toBe('Queen of Hearts')
    expect(speakerIn('said fivefold', d)).toBeNull()
    expect(speakerIn('Five stood there', d)).toBeNull()
  })

  it('migrated confirmations are aliases, and narration stays NARR', () => {
    const vals = Object.values(data().confirmedSpeakers)
    expect(vals.length).toBeGreaterThan(0)
    vals.forEach((v) => expect(entryOfSpeaker(data(), v)).toBeDefined())
    const p = data().paragraphs.find((x) => x.id === '8-2')!
    expect(phrasesOf(p, data()).filter((x) => !x.q).every((x) => x.spk === NARRATOR)).toBe(true)
  })

  it('a quoted line nobody is named for stays unknown', () => {
    const before = unattributed(data(), '5')
    upd((d) => { d.data.bibleTypes.find((t) => t.k === 'Character')!.speaker = false })
    expect(unattributed(data(), '5')).toBeGreaterThan(before)
  })

  it('adding an alias to a Character makes it pickable and detectable', () => {
    expect(aliases()).not.toContain('Cheshire')
    expect(addName('alice', 'Cheshire')).toBe(true)
    expect(aliases()).toContain('Cheshire')
    expect(speakerIn('said Cheshire softly', data())).toBe('Cheshire')
    expect(entryOfSpeaker(data(), 'Cheshire')?.id).toBe('alice')
  })

  it('renaming an entry renames the alias and keeps its confirmed lines', () => {
    const key = '8-9:0'
    upd((d) => { d.data.confirmedSpeakers[key] = 'Alice' })
    expect(renameEntry('alice', 'Alice Liddell')).toBe(true)
    expect(aliases()).toContain('Alice Liddell')
    expect(aliases()).not.toContain('Alice')
    expect(data().confirmedSpeakers[key]).toBe('Alice Liddell')
  })

  it('a removed alias is no longer a speaker, and its stale confirmation falls back to detection', () => {
    addName('queen-of-hearts', 'Her Majesty')
    update((d) => { d.data.confirmedSpeakers['8-13:0'] = 'Her Majesty' })
    expect(phrasesOf(data().paragraphs.find((p) => p.id === '8-13')!, data())[0]).toMatchObject({ spk: 'Her Majesty', confirmed: true })
    removeName('queen-of-hearts', data().bible.find((e) => e.id === 'queen-of-hearts')!.aka.indexOf('Her Majesty'))
    expect(aliases()).not.toContain('Her Majesty')
    expect(phrasesOf(data().paragraphs.find((p) => p.id === '8-13')!, data())[0].confirmed).toBe(false)
  })

  it('removing the Can speak flag removes the type\'s entries; setting it on another type adds them', () => {
    setTypeSpeaks(data().bibleTypes.findIndex((t) => t.k === 'Character'), false)
    expect(aliases()).toEqual([])
    setTypeSpeaks(data().bibleTypes.findIndex((t) => t.k === 'Item'), true)
    expect(aliases()).toEqual(expect.arrayContaining(['thimble', 'hookah']))
    expect(aliases()).not.toContain('Alice')
  })

  it('Story Bible lines follow the aliases', () => {
    const q = data().bible.find((e) => e.id === 'queen-of-hearts')!
    expect(linesOf(data(), q).length).toBeGreaterThan(0)
    upd((d) => { d.data.bibleTypes.find((t) => t.k === 'Character')!.speaker = false })
    expect(linesOf(data(), data().bible.find((e) => e.id === 'queen-of-hearts')!)).toEqual([])
  })
})

describe('Settings: Can speak', () => {
  it('has a per-type checkbox wired to the data', async () => {
    mountSettings('project')
    const box = screen.getByRole('checkbox', { name: 'Can speak: Character' })
    expect(box).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: 'Can speak: Location' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(box)
    expect(getState().data.bibleTypes.find((t) => t.k === 'Character')!.speaker).toBe(false)
    expect(document.querySelector('[data-tip="Entries of this type can be picked as the speaker of a quoted line"]')).not.toBeNull()
  })
})

describe('the picker', () => {
  it('offers only speaking entries and never a Narrator', async () => {
    addName('the-garden', 'Garden Voice')
    render(<OverlayHost />)
    rtlAct(() => openSpeakerPicker({ x: 10, y: 10 }, '8-2:0', '?', false))
    await userEvent.type(screen.getByLabelText('Search speakers'), 'a')
    expect(screen.queryByRole('option', { name: /narrator/i })).toBeNull()
    expect(screen.queryByRole('option', { name: /Garden Voice/ })).toBeNull()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
  })
})
