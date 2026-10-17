import { act as rtlAct, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import BiblePage from '@/pages/Bible'
import { mountSettings } from './helpers/settings'
import { EXTRACTION_SOURCES, VERIFY_BELOW } from '@/config/extraction'
import { ComponentSpec } from '@/domain/components'
import { ExtractionSuggestion } from '@/domain/extraction'
import { COMPONENT_SPECS } from '@/fixtures/components'
import { BOOKNLP_FINDINGS, GLINER_FINDINGS } from '@/fixtures/extraction'
import { minutesText, sizeText } from '@/format/size'
import { createMockComponents, setComponentProvider, componentProvider, type InstallProgress } from '@/providers/components'
import { createMockBookNlp, createMockGliner, extractionProvider } from '@/providers/extraction'
import { anyInstalled, recommended, scanSources, shouldOffer, statusOf } from '@/selectors/components'
import { autoStatus } from '@/selectors/extraction'
import { cancelInstall, dismissFailure, installComponent, installComponents, removeComponent, setAnalysisPrompt } from '@/state/commands/components'
import { scanManuscript } from '@/state/commands/extraction'
import { createInitialState, getState, resetState, undoLast, update } from '@/state/store'
import { initialPrefs } from '@/state/slices/ui'
import { OverlayHost } from '@/ui/OverlayHost'
import { closeTopModal, dismissToast, getOverlay } from '@/ui/overlay'

const FAST = { stepMs: 1, stepPct: 25, verifyMs: 1 }
const ui = () => getState().ui
const installed = () => ui().prefs.installedComponents
const run = <T,>(fn: () => T): T => { let r!: T; rtlAct(() => { r = fn() }); return r }
const spec = (id: string) => COMPONENT_SPECS.find((s) => s.id === id)!
const setHost = (h: 'reachable' | 'blocked' | 'lowdisk'): void => run(() => update((d) => { d.mock.analysisHost = h }))
const have = (...ids: string[]): void => run(() => update((d) => { d.ui.prefs.installedComponents = ids }))
const bySource = (src: string) => getState().data.suggestions.filter((s) => s.source === src)

beforeEach(() => {
  localStorage.clear()
  const s = createInitialState({ prefs: { ...initialPrefs } })
  s.ui.page = 'bible'
  resetState(s)
  setComponentProvider(createMockComponents(FAST))
})
afterEach(() => {
  cleanup()
  while (getOverlay().modals.length) closeTopModal()
  getOverlay().toasts.forEach((t) => dismissToast(t.id))
})

describe('the component registry', () => {
  it('is data that passes its schema, with the four entries', () => {
    expect(COMPONENT_SPECS.map((s) => ComponentSpec.safeParse(s).success)).toEqual([true, true, true, true])
    expect(componentProvider().specs().map((s) => s.id)).toEqual(['gliner', 'booknlp-small', 'booknlp-big', 'local-llm'])
  })
  it('carries what the consent needs: what it does, size, host, licence, memory, time per book', () => {
    for (const s of COMPONENT_SPECS) {
      expect(s.does.length).toBeGreaterThan(20)
      expect(s.host).toMatch(/\./)
      expect(s.licence.length).toBeGreaterThan(10)
      expect(s.sizeMB).toBeGreaterThan(0)
      expect(s.ramGB).toBeGreaterThan(0)
    }
    expect(spec('booknlp-small').sizeMB).toBe(161)
    expect(spec('booknlp-big').sizeMB).toBe(1200)
  })
  it('marks the local language model as not available yet, with a reason and no download', () => {
    const llm = spec('local-llm')
    expect(llm.unavailable).toBeTruthy()
    expect(statusOf(ui(), llm)).toBe('unavailable')
  })
  it('recommends GLiNER with the small BookNLP', () => {
    expect(recommended(COMPONENT_SPECS).map((s) => s.id)).toEqual(['gliner', 'booknlp-small'])
  })
  it('rejects a malformed entry', () => {
    expect(ComponentSpec.safeParse({ id: 'x', name: 'X' }).success).toBe(false)
  })
  it('writes sizes and times for people', () => {
    expect(sizeText(161)).toBe('161 MB')
    expect(sizeText(1200)).toBe('1.2 GB')
    expect(sizeText(5000)).toBe('5 GB')
    expect(minutesText(3)).toBe('about 3 min')
    expect(minutesText(120)).toBe('about 2 h')
  })
  it('each scanner component is filed under a registered extraction source', () => {
    const ids = EXTRACTION_SOURCES.map((s) => s.id) as string[]
    for (const s of COMPONENT_SPECS) if (s.source) expect(ids).toContain(s.source)
    expect(EXTRACTION_SOURCES.find((s) => s.id === 'gliner')).toMatchObject({ label: 'GLiNER', icon: expect.any(String) })
    expect(EXTRACTION_SOURCES.find((s) => s.id === 'booknlp')).toMatchObject({ label: 'BookNLP', icon: expect.any(String) })
  })
})

describe('the mock provider (install state machine)', () => {
  it('reports progress up to 100, then checking, then succeeds', async () => {
    const seen: InstallProgress[] = []
    const res = await componentProvider().install('gliner', (p) => seen.push(p))
    expect(res).toEqual({ ok: true })
    expect(seen[0]).toEqual({ phase: 'downloading', pct: 0 })
    expect(seen.filter((p) => p.phase === 'downloading').map((p) => p.pct)).toEqual([0, 25, 50, 75, 100])
    expect(seen[seen.length - 1]).toEqual({ phase: 'verifying', pct: 100 })
  })
  it('cancels part way', async () => {
    const ctl = new AbortController()
    const seen: InstallProgress[] = []
    const p = componentProvider().install('gliner', (e) => { seen.push(e); if (e.pct >= 25) ctl.abort() }, ctl.signal)
    const res = await p
    expect(res).toMatchObject({ ok: false, kind: 'cancelled' })
    expect(seen.some((e) => e.phase === 'verifying')).toBe(false)
  })
  it('fails with the host named when the host is unreachable', async () => {
    setHost('blocked')
    const res = await componentProvider().install('gliner', () => {})
    expect(res).toMatchObject({ ok: false, kind: 'unreachable' })
    expect((res as { reason: string }).reason).toContain('huggingface.co')
  })
  it('fails before starting when the disk is too full, saying how much', async () => {
    setHost('lowdisk')
    const seen: InstallProgress[] = []
    const res = await componentProvider().install('booknlp-big', (e) => seen.push(e))
    expect(res).toMatchObject({ ok: false, kind: 'disk' })
    expect((res as { reason: string }).reason).toMatch(/1\.2 GB needed/)
    expect(seen).toEqual([])
  })
  it('refuses what is not available, and removes what exists', async () => {
    expect(await componentProvider().install('local-llm', () => {})).toMatchObject({ ok: false, kind: 'unavailable' })
    expect(await componentProvider().install('nope', () => {})).toMatchObject({ ok: false })
    expect(await componentProvider().remove('gliner')).toEqual({ ok: true })
    expect(await componentProvider().remove('nope')).toMatchObject({ ok: false })
  })
})

describe('install, cancel, fail, remove (commands)', () => {
  it('installs: job shows progress, then it is installed and the job is gone', async () => {
    const p = installComponent('gliner')
    expect(ui().components.gliner).toMatchObject({ phase: 'downloading' })
    expect(statusOf(ui(), spec('gliner'))).toBe('downloading')
    expect(await p).toBe(true)
    expect(installed()).toEqual(['gliner'])
    expect(ui().components.gliner).toBeUndefined()
    expect(statusOf(ui(), spec('gliner'))).toBe('installed')
  })
  it('keeps the installed state in the saved preferences', async () => {
    await installComponent('booknlp-small')
    expect(JSON.parse(localStorage.getItem('ns-prefs') ?? '{}').installedComponents).toEqual(['booknlp-small'])
    const fresh = createInitialState()
    expect(fresh.ui.prefs.installedComponents).toEqual(['booknlp-small'])
  })
  it('cancel stops it and leaves it not installed', async () => {
    const p = installComponent('booknlp-big')
    cancelInstall('booknlp-big')
    expect(await p).toBe(false)
    expect(installed()).toEqual([])
    expect(ui().components['booknlp-big']).toBeUndefined()
    expect(statusOf(ui(), spec('booknlp-big'))).toBe('not-installed')
  })
  it('a blocked host leaves a failed job with the reason; trying again after the host is back works', async () => {
    setHost('blocked')
    expect(await installComponent('gliner')).toBe(false)
    expect(ui().components.gliner).toMatchObject({ phase: 'failed' })
    expect(ui().components.gliner.reason).toContain('huggingface.co')
    expect(statusOf(ui(), spec('gliner'))).toBe('failed')
    setHost('reachable')
    dismissFailure('gliner')
    expect(statusOf(ui(), spec('gliner'))).toBe('not-installed')
    expect(await installComponent('gliner')).toBe(true)
  })
  it('low disk space fails with a reason and installs nothing', async () => {
    setHost('lowdisk')
    expect(await installComponent('gliner')).toBe(false)
    expect(ui().components.gliner.reason).toMatch(/Not enough free disk space/)
    expect(installed()).toEqual([])
  })
  it('ignores a second start, an installed one and an unavailable one', async () => {
    const p = installComponent('gliner')
    expect(await installComponent('gliner')).toBe(false)
    await p
    expect(await installComponent('gliner')).toBe(false)
    expect(await installComponent('local-llm')).toBe(false)
    expect(installed()).toEqual(['gliner'])
  })
  it('removes an installed component, and only an installed one', async () => {
    expect(await removeComponent('gliner')).toBe(false)
    await installComponent('gliner')
    expect(await removeComponent('gliner')).toBe(true)
    expect(installed()).toEqual([])
  })
  it('installs several one after another', async () => {
    await installComponents(['gliner', 'booknlp-small'])
    expect([...installed()].sort()).toEqual(['booknlp-small', 'gliner'])
  })
})

describe('scan results by installed set', () => {
  it('registers the sources in the order rules, then the installed tools', () => {
    expect(scanSources(ui(), COMPONENT_SPECS)).toEqual(['rules'])
    have('booknlp-small', 'gliner')
    expect(scanSources(ui(), COMPONENT_SPECS)).toEqual(['rules', 'gliner', 'booknlp'])
  })
  it('nothing installed: no GLiNER or BookNLP findings, and their providers say why', async () => {
    await scanManuscript()
    expect(bySource('gliner')).toHaveLength(0)
    expect(bySource('booknlp')).toHaveLength(0)
    expect(extractionProvider('gliner')!.available()).toMatchObject({ ok: false })
    expect(extractionProvider('booknlp')!.available()).toMatchObject({ ok: false })
  })
  it('GLiNER installed: candidate names under its own source, no speakers or aliases', async () => {
    have('gliner')
    await scanManuscript()
    const g = bySource('gliner')
    expect(g.length).toBe(GLINER_FINDINGS.length)
    expect(g.every((s) => s.kind === 'entry')).toBe(true)
    expect(bySource('booknlp')).toHaveLength(0)
    expect(g.some((s) => s.payload.kind === 'entry' && s.payload.type === 'Location')).toBe(true)
  })
  it('BookNLP small: speakers are sure when a dialogue tag is present and unsure when implicit', async () => {
    have('booknlp-small')
    await scanManuscript()
    const sp = bySource('booknlp').filter((s) => s.kind === 'speaker')
    const tagged = sp.find((s) => s.payload.kind === 'speaker' && s.payload.quote === '“Who are you?”')!
    const implicit = sp.find((s) => s.payload.kind === 'speaker' && s.payload.quote === '“Can you play croquet?”')!
    expect(tagged.confidence!).toBeGreaterThanOrEqual(0.9)
    expect(tagged.status).toBe('accepted-auto')
    expect(implicit.confidence!).toBeLessThan(VERIFY_BELOW)
    expect(implicit.status).toBe('needs-verification')
    expect(getState().data.confirmedSpeakers['5-2:0']).toBe('Caterpillar')
  })
  it('BookNLP: a split group is flagged as a possible duplicate with a merge suggestion that needs verifying', async () => {
    have('booknlp-small')
    await scanManuscript()
    const dup = bySource('booknlp').find((s) => s.flag === 'duplicate')!
    expect(dup.kind).toBe('alias')
    expect(dup.payload).toMatchObject({ kind: 'alias', entry: 'The Pigeon' })
    expect(dup.note).toMatch(/Possible duplicate/)
    expect(dup.status).toBe('needs-verification')
  })
  it('BookNLP large is surer than small on the same lines, and keeps the same flags', async () => {
    have('booknlp-small')
    await scanManuscript()
    const small = Object.fromEntries(bySource('booknlp').map((s) => [s.fp, s.confidence]))
    undoLast()
    have('booknlp-big')
    await scanManuscript()
    const big = bySource('booknlp')
    expect(big.length).toBeGreaterThan(0)
    const better = big.filter((s) => small[s.fp] != null && s.confidence! > small[s.fp]!)
    expect(better.length).toBeGreaterThan(5)
    expect(big.every((s) => small[s.fp] == null || s.confidence! >= small[s.fp]!)).toBe(true)
  })
  it('only things a variant reports are offered by it', async () => {
    expect(BOOKNLP_FINDINGS.every((f) => f.conf.small !== null || f.conf.big !== null)).toBe(true)
    const p = createMockBookNlp(BOOKNLP_FINDINGS.map((f) => ({ ...f, conf: { small: null, big: 0.8 } })), () => ['booknlp-small'])
    expect(await p.run({} as never)).toEqual([])
    const g = createMockGliner(undefined, () => [])
    expect(g.available()).toMatchObject({ ok: false })
  })
  it('every finding is still held to the 75% rule and to evidence verification', async () => {
    have('gliner', 'booknlp-small')
    await scanManuscript()
    const mine = getState().data.suggestions.filter((s) => s.source === 'gliner' || s.source === 'booknlp')
    expect(mine.length).toBeGreaterThan(20)
    for (const s of mine) {
      expect(ExtractionSuggestion.safeParse(s).success).toBe(true)
      if (s.confidence == null || s.confidence < VERIFY_BELOW) expect(s.status).toBe('needs-verification')
      if (s.unverifiedQuote) expect(s.status).toBe('needs-verification')
      if (s.status === 'accepted-auto') expect(autoStatus(s)).toBe('accepted-auto')
      if (s.kind !== 'entry' || s.evidence.length) expect(s.evidence.length || s.unverifiedQuote).toBeTruthy()
    }
  })
  it('the whole scan is one undo step', async () => {
    have('gliner', 'booknlp-small')
    const before = getState().data.suggestions.length
    await scanManuscript()
    expect(getState().data.suggestions.length).toBeGreaterThan(before)
    undoLast()
    expect(getState().data.suggestions.length).toBe(before)
  })
  it('scanning again offers nothing twice', async () => {
    have('gliner', 'booknlp-small')
    await scanManuscript()
    const n = getState().data.suggestions.length
    await scanManuscript()
    expect(getState().data.suggestions.length).toBe(n)
  })
})

describe('when to offer better analysis', () => {
  it('offers when nothing is installed, the narrator has not said no, and nothing is downloading', () => {
    expect(shouldOffer(ui(), COMPONENT_SPECS)).toBe(true)
  })
  it('does not offer once any tool is installed', () => {
    have('gliner')
    expect(anyInstalled(ui(), COMPONENT_SPECS)).toBe(true)
    expect(shouldOffer(ui(), COMPONENT_SPECS)).toBe(false)
  })
  it('does not offer after "don’t ask again", and does again when it is turned back on', () => {
    setAnalysisPrompt('basic')
    expect(shouldOffer(ui(), COMPONENT_SPECS)).toBe(false)
    setAnalysisPrompt('ask')
    expect(shouldOffer(ui(), COMPONENT_SPECS)).toBe(true)
  })
})

describe('Settings: Story Bible analysis', () => {
  const mount = () => mountSettings('models')
  const row = (id: string) => document.querySelector(`[data-component="${id}"]`) as HTMLElement

  it('lists the four components with what each does, size, host, memory and time', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Story Bible analysis tools' })).toBeInTheDocument()
    for (const s of COMPONENT_SPECS) expect(within(row(s.id)).getByText(s.name)).toBeInTheDocument()
    const facts = within(row('booknlp-small')).getByText(/from people\.ischool\.berkeley\.edu/).closest('[data-comp-facts]') as HTMLElement
    expect(facts.textContent).toContain('161 MB')
    expect(facts.textContent).toContain('1.6 GB of memory')
    expect(facts.textContent).toContain('about 3 min per book')
  })
  it('shows the language model as not available yet, with its reason and no button', () => {
    mount()
    const r = row('local-llm')
    expect(within(r).getByText('Not available yet')).toBeInTheDocument()
    expect(r.querySelector('[data-comp-reason]')!.textContent).toBe(spec('local-llm').unavailable)
    expect(within(r).queryAllByRole('button')).toHaveLength(0)
  })
  it('Download asks first: the consent names what it is, size, host and licence; Cancel downloads nothing', async () => {
    mount()
    const u = userEvent.setup()
    await u.click(within(row('gliner')).getByRole('button', { name: 'Download GLiNER…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Download GLiNER' })
    expect(dlg).toHaveTextContent(spec('gliner').does)
    expect(dlg).toHaveTextContent('585 MB')
    expect(dlg).toHaveTextContent('huggingface.co')
    expect(dlg).toHaveTextContent(spec('gliner').licence)
    expect(within(dlg).getByRole('button', { name: 'Download' })).toBeInTheDocument()
    await u.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(getOverlay().modals).toHaveLength(0)
    expect(ui().components.gliner).toBeUndefined()
    expect(installed()).toEqual([])
  })
  it('Download in the consent shows progress with a cancel, then Installed with Remove', async () => {
    setComponentProvider(createMockComponents({ stepMs: 15, stepPct: 25, verifyMs: 15 }))
    mount()
    const u = userEvent.setup()
    await u.click(within(row('gliner')).getByRole('button', { name: 'Download GLiNER…' }))
    await u.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => expect(within(row('gliner')).getByRole('progressbar', { name: 'Downloading GLiNER' })).toBeInTheDocument())
    expect(within(row('gliner')).getByRole('button', { name: 'Cancel the download of GLiNER' })).toBeInTheDocument()
    await waitFor(() => expect(row('gliner')).toHaveAttribute('data-status', 'installed'), { timeout: 3000 })
    expect(within(row('gliner')).getByText('Installed · checked')).toBeInTheDocument()
    expect(within(row('gliner')).getByRole('button', { name: 'Remove GLiNER' })).toBeInTheDocument()
  })
  it('Cancel on a running download returns the row to Download', async () => {
    setComponentProvider(createMockComponents({ stepMs: 30, stepPct: 10, verifyMs: 30 }))
    mount()
    const u = userEvent.setup()
    await u.click(within(row('booknlp-small')).getByRole('button', { name: 'Download BookNLP (small)…' }))
    await u.click(await screen.findByRole('button', { name: 'Download' }))
    await u.click(await screen.findByRole('button', { name: 'Cancel the download of BookNLP (small)' }))
    await waitFor(() => expect(row('booknlp-small')).toHaveAttribute('data-status', 'not-installed'))
    expect(installed()).toEqual([])
  })
  it('a blocked host shows the failure with the host named, and Try again recovers when it is reachable', async () => {
    setHost('blocked')
    mount()
    const u = userEvent.setup()
    await u.click(within(row('gliner')).getByRole('button', { name: 'Download GLiNER…' }))
    await u.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => expect(row('gliner')).toHaveAttribute('data-status', 'failed'))
    expect(row('gliner').querySelector('[data-comp-error]')!.textContent).toContain('huggingface.co')
    setHost('reachable')
    await u.click(within(row('gliner')).getByRole('button', { name: 'Try GLiNER again' }))
    await waitFor(() => expect(row('gliner')).toHaveAttribute('data-status', 'installed'), { timeout: 3000 })
  })
  it('low disk space shows the shortfall', async () => {
    setHost('lowdisk')
    mount()
    const u = userEvent.setup()
    await u.click(within(row('gliner')).getByRole('button', { name: 'Download GLiNER…' }))
    await u.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => expect(row('gliner')).toHaveAttribute('data-status', 'failed'))
    expect(row('gliner').querySelector('[data-comp-error]')!.textContent).toMatch(/Not enough free disk space/)
  })
  it('Remove asks, then removes; saying no keeps it', async () => {
    have('gliner')
    mount()
    const u = userEvent.setup()
    await u.click(within(row('gliner')).getByRole('button', { name: 'Remove GLiNER' }))
    await u.click(within(await screen.findByRole('dialog', { name: 'Remove GLiNER?' })).getByRole('button', { name: 'Cancel' }))
    expect(installed()).toEqual(['gliner'])
    await u.click(within(row('gliner')).getByRole('button', { name: 'Remove GLiNER' }))
    await u.click(within(await screen.findByRole('dialog', { name: 'Remove GLiNER?' })).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(installed()).toEqual([]))
    expect(row('gliner')).toHaveAttribute('data-status', 'not-installed')
  })
  it('the offer preference is a checkbox that follows the saved choice', async () => {
    setAnalysisPrompt('basic')
    mount()
    const cb = screen.getByRole('checkbox', { name: 'Offer better analysis when scanning' })
    expect(cb).not.toBeChecked()
    await userEvent.setup().click(cb)
    expect(ui().prefs.analysisPrompt).toBe('ask')
  })
})

describe('the first scan prompt', () => {
  const mount = () => render(<><BiblePage /><OverlayHost /></>)
  const scan = async () => { await userEvent.setup().click(document.getElementById('sbscan')!) }

  it('appears when nothing is downloaded, with three ways forward', async () => {
    mount()
    await scan()
    const dlg = await screen.findByRole('dialog', { name: 'Scan the manuscript' })
    expect(within(dlg).getByRole('button', { name: 'Use basic scan now' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Download better analysis…' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Import from a file instead' })).toBeInTheDocument()
    expect(within(dlg).getByRole('checkbox', { name: 'Don’t ask again' })).toBeInTheDocument()
  })
  it('is never blocking: Close changes nothing, and basic scan runs the rules', async () => {
    mount()
    const u = userEvent.setup()
    await scan()
    await u.click(await screen.findByRole('button', { name: 'Close' }))
    expect(getOverlay().modals).toHaveLength(0)
    expect(ui().prefs.analysisPrompt).toBe('ask')
    await scan()
    await u.click(await screen.findByRole('button', { name: 'Use basic scan now' }))
    await waitFor(() => expect(getOverlay().toasts.some((t) => /suggestion/.test(t.msg))).toBe(true))
    expect(bySource('gliner')).toHaveLength(0)
  })
  it('“Download better analysis…” opens the consent for GLiNER and BookNLP (small) together', async () => {
    mount()
    const u = userEvent.setup()
    await scan()
    await u.click(await screen.findByRole('button', { name: 'Download better analysis…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Download better analysis' })
    expect(within(dlg).getByRole('heading', { name: /GLiNER/ })).toBeInTheDocument()
    expect(within(dlg).getByRole('heading', { name: /BookNLP \(small\)/ })).toBeInTheDocument()
    expect(dlg.querySelector('[data-consent-total]')!.textContent).toContain('746 MB')
    expect(within(dlg).queryByText(/BookNLP \(large\)/)).toBeNull()
  })
  it('“Import from a file instead” opens the import dialog', async () => {
    mount()
    await scan()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Import from a file instead' }))
    expect(await screen.findByRole('dialog', { name: 'Import entries' })).toBeInTheDocument()
  })
  it('“Don’t ask again” is remembered: the next scan goes straight through', async () => {
    mount()
    const u = userEvent.setup()
    await scan()
    await u.click(await screen.findByRole('checkbox', { name: 'Don’t ask again' }))
    await u.click(screen.getByRole('button', { name: 'Use basic scan now' }))
    expect(ui().prefs.analysisPrompt).toBe('basic')
    expect(JSON.parse(localStorage.getItem('ns-prefs') ?? '{}').analysisPrompt).toBe('basic')
    await waitFor(() => expect(getOverlay().toasts.length).toBeGreaterThan(0))
    await scan()
    expect(getOverlay().modals).toHaveLength(0)
  })
  it('does not appear when a tool is installed, and the scan then uses it', async () => {
    have('booknlp-small')
    mount()
    await scan()
    expect(getOverlay().modals).toHaveLength(0)
    await waitFor(() => expect(bySource('booknlp').length).toBeGreaterThan(0))
  })
  it('shows each suggestion’s source with its name, and the duplicate flag with its note', async () => {
    have('booknlp-small')
    mount()
    await scan()
    await waitFor(() => expect(bySource('booknlp').length).toBeGreaterThan(0))
    const u = userEvent.setup()
    await u.click(document.getElementById('sbverify')!)
    await waitFor(() => expect(document.querySelector('[data-source="booknlp"]')).not.toBeNull())
    await u.click(document.querySelector('[data-sbe="the-pigeon"]') as HTMLElement)
    expect(document.querySelector('[data-sug-dup]')!.textContent).toMatch(/Possible duplicate/)
  })
})
