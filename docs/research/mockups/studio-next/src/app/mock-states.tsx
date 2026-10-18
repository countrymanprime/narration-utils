import { IconButton } from '@/ui/primitives'
import { chaptersFor } from '@/fixtures/book'
import { DEADLINES, type MockState } from '@/state/slices/mock'
import { update, useStudio } from '@/state/store'
import { recheckNotes } from '@/state/commands/proof'
import { HEADING_STYLES, type HeadingStyle } from '@/format/headings'
import { closePop, openPopoverAt, toast } from '@/ui/overlay'
import { modals } from './modals'
import { Checkbox } from '@/ui/primitives/Checkbox'
import { Radio as RadioItem } from '@/ui/primitives/RadioGroup'

/**
 * Mock-only control: it forces the states the app can be in. It is not part of the product.
 * Each group is data about the scenario; the screens read the same state either way.
 */
function Radio({ name, value, label, checked, onChange }: { name: string; value: string; label: string; checked: boolean; onChange: () => void }) {
  return <RadioItem name={name} value={value} label={label} checked={checked} onCheckedChange={onChange} />
}

const REVIEW: Array<[string, 'Reviewed' | 'Proposed']> = [
  ['Production', 'Reviewed'], ['Schedule', 'Reviewed'], ['Script', 'Reviewed'], ['Booth', 'Proposed'], ['Editing', 'Proposed'], ['Proof', 'Proposed'],
  ['Pickups', 'Proposed'], ['Master & QC', 'Proposed'], ['Story Bible', 'Proposed'], ['Settings', 'Proposed'], ['Companion', 'Proposed'], ['Delivery', 'Proposed'],
]

function setBookSize(n: 12 | 40): void {
  update((d) => {
    const keep = d.data.chapters.filter((c) => !c.id.startsWith('x'))
    const wanted = chaptersFor(n).filter((c) => c.id.startsWith('x'))
    const close = keep.findIndex((c) => c.id === 'close')
    d.data.chapters = [...keep.slice(0, close), ...wanted, ...keep.slice(close)]
  })
}

function setMock(patch: Partial<MockState>): void {
  update((d) => { Object.assign(d.mock, patch) })
}

function MockStates() {
  const mock = useStudio((s) => s.mock)
  const data = useStudio((s) => s.data)
  const longBook = data.chapters.some((c) => c.id.startsWith('x'))
  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="row"><b style={{ font: '600 18px var(--f-display)' }}>Mock states</b><span className="spacer" /><IconButton icon="x" tip="Close" className="ghost" onClick={closePop} /></div>
      <div className="sub">Concept mock with invented sample data. This panel forces states and is not part of the app.</div>
      <div className="sp-grp"><span className="label">Selection highlight</span>
        {([['bar', 'Accent bar (current)'], ['soft', 'Soft block'], ['pill', 'Pill'], ['outline', 'Outline'], ['solid', 'Solid chip']] as const).map(([k, l]) => (
          <Radio key={k} name="hl" value={k} label={l} checked={mock.highlight === k} onChange={() => setMock({ highlight: k })} />
        ))}
      </div>
      <div className="sp-grp"><span className="label">Manuscript</span>
        <Radio name="manuscript" value="present" label="Imported" checked={mock.hasManuscript} onChange={() => update((d) => { d.mock.hasManuscript = true; d.ui.importPromptShown = false; d.ui.script.pendingJump = null })} />
        <Radio name="manuscript" value="none" label="No manuscript yet" checked={!mock.hasManuscript} onChange={() => update((d) => { d.mock.hasManuscript = false; d.ui.importPromptShown = false })} />
        <label className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><Checkbox aria-label="“Choose a file” uses a sample manuscript" checked={mock.autoSample} onCheckedChange={(c) => setMock({ autoSample: c })} /> <span>“Choose a file” uses a sample manuscript</span></label>
      </div>
      <div className="sp-grp"><span className="label">Recording setup</span>
        <Radio name="setup" value="reaper" label="REAPER linked (recordings live in the DAW)" checked={mock.setup === 'reaper'} onChange={() => setMock({ setup: 'reaper' })} />
        <Radio name="setup" value="reaper-off" label="REAPER not running" checked={mock.setup === 'reaper-off'} onChange={() => setMock({ setup: 'reaper-off' })} />
        <Radio name="setup" value="audacity" label="Audacity (recordings live in the DAW)" checked={mock.setup === 'audacity'} onChange={() => setMock({ setup: 'audacity' })} />
        <Radio name="setup" value="builtin" label="Built-in recorder (recordings live in the app)" checked={mock.setup === 'builtin'} onChange={() => setMock({ setup: 'builtin' })} />
      </div>
      <div className="sp-grp"><span className="label">DAW project</span>
        <label className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><Checkbox aria-label="The project has changes the DAW has not saved" checked={mock.dawUnsaved} onCheckedChange={(c) => setMock({ dawUnsaved: c })} /> <span>Unsaved changes in the DAW</span></label>
        <label className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><Checkbox aria-label="Items and takes were re-created in the DAW" checked={mock.dawStale} onCheckedChange={(c) => setMock({ dawStale: c })} /> <span>Items changed in the DAW since the app read them</span></label>
      </div>
      <div className="sp-grp"><span className="label">How the app was launched</span>
        <Radio name="launch" value="daw" label="From REAPER (project auto-selected)" checked={mock.launch === 'daw'} onChange={() => { setMock({ launch: 'daw' }); toast('Launched from REAPER: Alice.rpp opened automatically.') }} />
        <Radio name="launch" value="start" label="From the Start menu (project picker)" checked={mock.launch === 'start'} onChange={() => { setMock({ launch: 'start' }); closePop(); setTimeout(() => modals.projectPicker(), 0) }} />
      </div>
      <div className="sp-grp"><span className="label">Window</span>
        <Radio name="win" value="full" label="Full app" checked={!mock.companion} onChange={() => setMock({ companion: false })} />
        <Radio name="win" value="companion" label="Companion (380 px, beside the DAW)" checked={mock.companion} onChange={() => setMock({ companion: true })} />
      </div>
      <div className="sp-grp"><span className="label">REAPER’s undo list</span>
        <Radio name="ru" value="mine" label="The app’s last change is on top" checked={mock.reaperTop === 'mine'} onChange={() => setMock({ reaperTop: 'mine' })} />
        <Radio name="ru" value="other" label="Something else was done in REAPER since" checked={mock.reaperTop === 'other'} onChange={() => setMock({ reaperTop: 'other' })} />
      </div>
      <div className="sp-grp"><span className="label">Chapter headings in the manuscript</span>
        {HEADING_STYLES.map((h) => (
          <Radio key={h.key} name="hd" value={h.key} label={h.example} checked={data.manuscript.headingStyle === h.key}
            onChange={() => update((d) => { d.data.manuscript.headingStyle = h.key as HeadingStyle })} />
        ))}
      </div>
      <div className="sp-grp"><span className="label">Book length</span>
        <Radio name="book" value="12" label="As imported (12 chapters)" checked={!longBook} onChange={() => setBookSize(12)} />
        <Radio name="book" value="40" label="40 chapters" checked={longBook} onChange={() => setBookSize(40)} />
      </div>
      <div className="sp-grp"><span className="label">Delivery preflight</span>
        <Radio name="dl" value="blocked" label="As the book stands (failing and unmastered chapters)" checked={!mock.deliveryReady} onChange={() => update((d) => { d.mock.deliveryReady = false; d.ui.delivery.built = false })} />
        <Radio name="dl" value="ready" label="Every chapter passes" checked={mock.deliveryReady} onChange={() => update((d) => { d.mock.deliveryReady = true; d.ui.delivery.built = false })} />
      </div>
      <div className="sp-grp"><span className="label">Local dictionary</span>
        <Radio name="dict" value="installed" label="Installed" checked={mock.dictLocal === 'installed'} onChange={() => setMock({ dictLocal: 'installed' })} />
        <Radio name="dict" value="missing" label="Not installed" checked={mock.dictLocal === 'missing'} onChange={() => setMock({ dictLocal: 'missing' })} />
      </div>
      <div className="sp-grp"><span className="label">Network</span>
        <Radio name="net" value="online" label="Online" checked={mock.net === 'online'} onChange={() => setMock({ net: 'online' })} />
        <Radio name="net" value="offline" label="Offline" checked={mock.net === 'offline'} onChange={() => setMock({ net: 'offline' })} />
      </div>
      <div className="sp-grp"><span className="label">Analysis tools</span>
        <Radio name="ahost" value="reachable" label="Reachable" checked={mock.analysisHost === 'reachable'} onChange={() => setMock({ analysisHost: 'reachable' })} />
        <Radio name="ahost" value="blocked" label="Download blocked" checked={mock.analysisHost === 'blocked'} onChange={() => setMock({ analysisHost: 'blocked' })} />
        <Radio name="ahost" value="lowdisk" label="Low disk space" checked={mock.analysisHost === 'lowdisk'} onChange={() => setMock({ analysisHost: 'lowdisk' })} />
      </div>
      <div className="sp-grp"><span className="label">Measurements</span>
        <Radio name="meas" value="available" label="Reported" checked={mock.measurements === 'available'} onChange={() => setMock({ measurements: 'available' })} />
        <Radio name="meas" value="none" label="Nothing measured yet" checked={mock.measurements === 'none'} onChange={() => setMock({ measurements: 'none' })} />
      </div>
      <div className="sp-grp"><span className="label">Recognised words</span>
        <Radio name="aln" value="ready" label="Transcribed" checked={mock.alignment === 'ready'} onChange={() => setMock({ alignment: 'ready' })} />
        <Radio name="aln" value="none" label="Not transcribed yet" checked={mock.alignment === 'none'} onChange={() => setMock({ alignment: 'none' })} />
      </div>
      <div className="sp-grp"><span className="label">Proof</span>
        <button type="button" className="btn sm" id="mock-recheck" onClick={() => { const n = recheckNotes(); toast(n ? n + (n > 1 ? ' notes now have' : ' note now has') + ' new evidence' : 'Nothing changed in any note.') }}>A re-check changes some notes’ evidence</button>
      </div>
      <div className="sp-grp"><span className="label">Due date</span>
        {([['ok', 'Comfortable · Oct 14'], ['tight', 'Tight · Oct 4'], ['behind', 'Behind · Sep 30']] as const).map(([k, l]) => (
          <Radio key={k} name="deadline" value={k} label={l} checked={mock.deadline === k} onChange={() => update((d) => { d.mock.deadline = k; d.data.due = DEADLINES[k] })} />
        ))}
      </div>
      <div className="sp-grp"><span className="label">Try</span>
        <div className="row">
          <button type="button" className="btn sm" onClick={() => { closePop(); modals.importFlow('replace') }}>Replace manuscript</button>
          <button type="button" className="btn sm" onClick={() => { closePop(); modals.projectPicker() }}>Project picker</button>
        </div>
      </div>
      <div className="sp-grp"><span className="label">Page review status</span>
        {REVIEW.map(([n, st]) => <div className="optrow" key={n}><span>{n}</span><span className={'pill ' + (st === 'Reviewed' ? 'ok' : 'copper')}>{st}</span></div>)}
      </div>
    </div>
  )
}

modals.mockStates = () => {
  const btn = document.getElementById('mockbtn')
  const z = parseFloat(document.documentElement.style.zoom) || 1
  const w = document.documentElement.clientWidth
  // The panel opens above the floating button in the bottom right corner.
  openPopoverAt(Math.max(8, w - 340 - 16), 8, () => <MockStates />, 'mockpanel', btn, { width: 340, maxHeight: 'calc(100% - 80px)', overflow: 'auto' })
}
