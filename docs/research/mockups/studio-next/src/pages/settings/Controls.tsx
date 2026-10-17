/** The controls of the settings that are more than one value: each is the body of a Row whose registry entry says `custom`. */
import { useEffect, useState, type ReactNode } from 'react'
import { SHORTCUTS } from '@/app/help'
import { modals } from '@/app/modals'


import { num } from '@/format/time'
import { dawOf } from '@/selectors/settingsView'
import { calc } from '@/selectors/progress'
import { platformProfiles } from '@/selectors/platform'
import { fontCss } from '@/selectors/reader'
import { setDeliveryProfile } from '@/state/commands/schedule'
import { setPrefs, setZoom } from '@/state/commands/prefs'
import { addType, removeType, renameType, setRecording, setTypeColour, setTypeSpeaks, toggleLocalDictionary, TYPE_COLOURS } from '@/state/commands/settings'
import { clearProjectData } from '@/state/commands/settingsPage'
import type { DictSource, ThemeChoice } from '@/state/slices/ui'
import { useData, useMock, useStudio } from '@/state/store'
import { confirmDialog } from '@/ui/ConfirmDialog'
import { TextSettings } from '@/ui/TextSettings'
import { Btn, Checkbox, IconButton, Input, Pill, Select, Swatch } from '@/ui/primitives'
import { Radio, RadioGroup } from '@/ui/primitives/RadioGroup'
import { toast } from '@/ui/overlay'

/** The recording tool: which one, and whether the app can reach it right now. */
export function RecordingTool() {
  const mock = useMock()
  const daw = dawOf(mock)
  const [test, setTest] = useState<'idle' | 'ok' | 'bad'>('idle')
  useEffect(() => setTest('idle'), [mock.setup])
  const status = daw === 'builtin' ? (['neutral', 'Built-in recorder', 'Recording happens in the app. Nothing to connect.'] as const)
    : mock.setup === 'reaper-off' ? (['warn', 'Not running', 'REAPER is chosen but is not running. Start REAPER, or choose another recorder.'] as const)
      : daw === 'audacity' ? (['ok', 'Audacity linked', 'Linked to the open Audacity project.'] as const) : (['ok', 'REAPER linked', 'Linked to Alice.rpp. Following chapter 5.'] as const)
  return (
    <div className="stack" style={{ gap: 12 }}>
      <RadioGroup name="rec" aria-label="Record with" value={daw} onValueChange={setRecording}>
        <Radio value="reaper" label="REAPER. Recordings live in the DAW." />
        <Radio value="audacity" label="Audacity. Recordings live in the DAW." />
        <Radio value="builtin" label="Built-in recorder. Recordings live in the app." />
      </RadioGroup>
      <div className="statuscard" data-daw-status={mock.setup} role="group" aria-label="Connection">
        <Pill kind={status[0]} dot>{status[1]}</Pill>
        <span className="sub">{status[2]}</span>
        {daw !== 'builtin' ? <Btn className="sm" onClick={() => setTest(mock.setup === 'reaper-off' ? 'bad' : 'ok')}>Test connection</Btn> : null}
        <span role="status" className="sub">{test === 'ok' ? 'Connected. Answered in 40 ms.' : test === 'bad' ? 'No answer from REAPER.' : ''}</span>
      </div>
    </div>
  )
}

const CAPS: Array<[string, string, string]> = [
  ['record', 'Start and stop recording', ''],
  ['punch', 'Punch in and roll again', ''],
  ['markers', 'Add markers', ''],
  ['backups', 'Keep Audacity backups', 'Audacity only'],
  ['fx_chains', 'Put effects on tracks', ''],
  ['input_level', 'Set the input level', 'No recording tool offers this yet'],
]
export function Capabilities() {
  const mock = useMock()
  const daw = dawOf(mock)
  const [v, setV] = useState<Record<string, string>>({})
  const reasonOf = (k: string, note: string): string => (k === 'backups' && daw !== 'audacity' ? 'Not offered by this recorder' : k === 'input_level' ? note : daw === 'builtin' && k !== 'record' ? 'The built-in recorder does not do this' : '')
  return (
    <div className="stack" style={{ gap: 8 }}>
      <table className="caps">
        <caption className="sr-only">What the recording tool can do</caption>
        <thead><tr><th scope="col">What</th><th scope="col">Setting</th><th scope="col">Now</th></tr></thead>
        <tbody>
          {CAPS.map(([k, l, note]) => {
            const why = reasonOf(k, note)
            return (
              <tr key={k}>
                <th scope="row">{l}</th>
                <td data-label="Setting"><Select aria-label={l} value={v[k] ?? 'auto'} style={{ width: 120 }} onValueChange={(x) => setV({ ...v, [k]: x })}
                  options={[{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} /></td>
                <td data-label="Now">{why ? <><Pill kind="neutral" size="sm">Unavailable</Pill> <span className="sub">{why}</span></> : <Pill kind="ok" size="sm">Available</Pill>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <span className="sub">Six of 34 are shown. Auto follows what the recording tool reports.</span>
    </div>
  )
}

/** Where definitions come from; the local dictionary is a download and says whether it is there. */
export function Definitions() {
  const mock = useMock()
  const p = useStudio((s) => s.ui.prefs)
  const installed = mock.dictLocal === 'installed'
  return (
    <RadioGroup<DictSource> name="dsrc" aria-label="Show definitions from" value={p.dictSource} onValueChange={(v) => setPrefs({ dictSource: v })}>
      <Radio value="web" label="Web page. Opens the dictionary site." />
      <Radio value="local" label="Local dictionary. Shows definitions and pronunciations inline."
        extra={<><Pill kind={installed ? 'ok' : 'neutral'} size="sm">{installed ? 'Installed' : 'Not installed'}</Pill>
          <IconButton icon={installed ? 'trash' : 'download'} tip={installed ? 'Remove the local dictionary' : 'Download the local dictionary'} className={installed ? 'danger' : ''} id="dictbtn" onClick={toggleLocalDictionary} /></>} />
      <Radio value="api" label="Online service. Shows definitions inline when online."
        extra={<Pill kind={mock.net === 'online' ? 'ok' : 'warn'} size="sm">{mock.net === 'online' ? 'Online' : 'Offline'}</Pill>} />
    </RadioGroup>
  )
}

/** A secret: stored apart, never shown again, replaced or removed. */
export function SecretKey() {
  const [has, setHas] = useState(false)
  const [draft, setDraft] = useState('')
  const [res, setRes] = useState('')
  const online = useMock().net === 'online'
  return (
    <div className="stack" style={{ gap: 8 }}>
      {has ? (
        <div className="row"><Pill kind="ok" size="sm">Key saved</Pill><span className="sub">••••••••••••</span>
          <Btn className="sm" onClick={() => setRes(online ? 'The key works.' : 'Offline: cannot test the key.')}>Test key</Btn>
          <Btn className="sm quiet danger" onClick={() => { setHas(false); setRes('') }}>Remove key</Btn></div>
      ) : (
        <div className="row"><Input type="password" aria-label="Merriam-Webster key" autoComplete="off" value={draft} style={{ width: 280 }} onChange={(e) => setDraft(e.target.value)} />
          <Btn className="sm" disabled={!draft.trim()} onClick={() => { setHas(true); setDraft(''); setRes('Key saved.') }}>Save key</Btn></div>
      )}
      <span className="sub" role="status">{res}</span>
    </div>
  )
}

export function DeliveryProfile() {
  const data = useData()
  const acx = data.deliveryProfile === 'acx'
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Select id="delivery-profile" aria-label="Delivery profile" style={{ maxWidth: 260 }} value={data.deliveryProfile} onValueChange={setDeliveryProfile}
        options={platformProfiles().map((p) => ({ value: p.id, label: p.label }))} />
      <dl className="limits" aria-label="Limits of this profile">
        {acx ? <>
          <div><dt>Loudness (RMS)</dt><dd>−23 to −18 dBFS</dd></div>
          <div><dt>Sample peak</dt><dd>−3 dBFS or lower</dd></div>
          <div><dt>Noise floor</dt><dd>−60 dBFS or lower</dd></div>
        </> : <div><dt>Limits</dt><dd>None checked. Master &amp; QC measures but does not judge.</dd></div>}
      </dl>
    </div>
  )
}

export function CustomProfiles() {
  const [list, setList] = useState<string[]>(['ACX, peak −4 dBFS'])
  return (
    <div className="stack" style={{ gap: 8 }}>
      {list.length ? list.map((n, i) => (
        <div className="row" key={n + i}><b>{n}</b><span className="sub">Copy of ACX · used by 1 project</span><span className="spacer" style={{ flex: 1 }} />
          <IconButton icon="copy" tip={'Duplicate ' + n} onClick={() => setList([...list, n + ' copy'])} />
          <IconButton icon="pencil" tip={'Edit ' + n} onClick={() => toast('Opens the profile editor.')} />
          <IconButton icon="trash" tip={'Delete ' + n} className="danger" onClick={() => confirmDialog({ title: 'Delete “' + n + '”?', body: 'Projects that use it fall back to the built-in profile it was copied from.', confirmLabel: 'Delete', focus: 'cancel', onConfirm: () => setList(list.filter((_, j) => j !== i)) })} />
        </div>
      )) : <span className="sub">No custom profiles. Duplicate the built-in ACX profile to make one.</span>}
      <div><Btn className="sm" onClick={() => setList([...list, 'ACX copy'])}>Duplicate ACX</Btn></div>
    </div>
  )
}

export function Manuscript() {
  const mock = useMock()
  const data = useData()
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="sub">{mock.hasManuscript ? 'Imported ' + data.manuscript.imported + ' · ' + num(calc(data).W) + ' words' : 'No manuscript yet'}</span>
      {mock.hasManuscript
        ? <Btn className="quiet danger" id="repl" onClick={() => modals.importFlow('replace')}>Replace manuscript…</Btn>
        : <Btn id="imp0" onClick={() => modals.importFlow('import')}>Import manuscript</Btn>}
    </div>
  )
}

function TypeRow({ index }: { index: number }) {
  const data = useData()
  const t = data.bibleTypes[index]
  const [v, setV] = useState(t.k)
  useEffect(() => setV(t.k), [t.k])
  const n = data.bible.filter((e) => e.kind === t.k).length
  const commit = (): void => { if (v !== t.k && !renameType(index, v)) setV(t.k) }
  return (
    <div className="row typerow">
      <Swatch colour={t.c} />
      <Input type="text" data-sbtn={index} value={v} aria-label="Type name" style={{ flex: '1 1 140px', minWidth: 0 }} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
      <Select data-sbtc={index} aria-label={'Colour for ' + t.k} style={{ width: 130 }} value={t.c} onValueChange={(c) => setTypeColour(index, c as typeof t.c)} options={TYPE_COLOURS.map(([c, l]) => ({ value: c, label: l }))} />
      <span data-tip="Entries of this type can be picked as the speaker of a quoted line" className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
        <Checkbox data-sbts={index} checked={!!t.speaker} aria-label={'Can speak: ' + t.k} onCheckedChange={(c) => setTypeSpeaks(index, c)} />
        <span className="sub">Can speak</span>
      </span>
      <span className="sub" style={{ minWidth: 70 }}>{n} {n === 1 ? 'entry' : 'entries'}</span>
      <IconButton icon="trash" tip={'Remove ' + t.k} className="quiet danger" data-sbtx={index} disabled={n > 0 || data.bibleTypes.length < 2} onClick={() => removeType(index)} />
    </div>
  )
}
export function BibleTypes() {
  const data = useData()
  const [name, setName] = useState('')
  const add = (): void => { if (addType(name)) setName('') }
  return (
    <div className="stack">
      {data.bibleTypes.map((t, i) => <TypeRow key={i} index={i} />)}
      <div className="row">
        <Input type="text" id="sbtnew" placeholder="New type" aria-label="New type" style={{ width: 200 }} value={name} onChange={(e) => setName(e.target.value)} />
        <IconButton icon="plus" tip="Add type" id="sbtadd" onClick={add} />
      </div>
    </div>
  )
}
export function Marks() {
  const data = useData()
  return (
    <div className="row">
      {data.marks.map((x) => <Pill key={x.k} kind="neutral"><Swatch colour={x.c} />{x.name}{x.ask ? ' · tracks a reply' : ''}</Pill>)}
      <IconButton icon="pencil" tip="Edit marks…" id="editmarks" onClick={() => modals.marks()} />
    </div>
  )
}
export function Credits() {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row"><b>Opening credits</b><Pill kind="ok" size="sm">Ready</Pill><span className="sub">Template “Standard”</span></div>
      <div className="row"><b>Closing credits</b><Pill kind="warn" size="sm">Needs a narrator name</Pill></div>
      <div className="row"><b>Retail sample</b><span className="sub">Chapter 1, 0:00 to 5:00</span></div>
      <div><Btn className="sm" onClick={() => toast('Opens the credits editor.')}>Edit credits…</Btn></div>
    </div>
  )
}
export function ProjectData() {
  return (
    <div><Btn className="quiet danger" onClick={() => confirmDialog({ title: 'Clear derived data?', body: 'Checks, caches and analysis results are removed and will run again. Your manuscript, recordings and decisions stay.', confirmLabel: 'Clear', focus: 'cancel', onConfirm: clearProjectData })}>Clear derived data…</Btn></div>
  )
}

export function Theme() {
  const p = useStudio((s) => s.ui.prefs)
  return (
    <RadioGroup<ThemeChoice> name="theme" aria-label="Theme" value={p.theme} onValueChange={(v) => setPrefs({ theme: v })}>
      <Radio value="system" label="Match my system" />
      <Radio value="light" label="Light" />
      <Radio value="dark" label="Dark" />
    </RadioGroup>
  )
}
export function ReaderText() {
  const p = useStudio((s) => s.ui.prefs)
  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <TextSettings />
      <div className="quote" id="sprev" style={{ fontFamily: fontCss(p.readerFont), fontSize: p.readerSize, lineHeight: p.readerSpacing }}>“Off with her head!” the Queen shouted at the top of her voice. Nobody moved.</div>
    </div>
  )
}
export function Zoom() {
  const z = useStudio((s) => s.ui.prefs.zoom)
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <Select aria-label="Zoom" value={String(z)} style={{ width: 120 }} onValueChange={(v) => setZoom(Number(v))}
        options={[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((v) => ({ value: String(v), label: Math.round(v * 100) + '%' }))} />
      {z !== 1 ? <IconButton icon="undo" tip="Reset zoom to 100%" className="ghost" onClick={() => setZoom(1)} /> : null}
    </div>
  )
}
export function Shortcuts() {
  const [q, setQ] = useState('')
  const list = SHORTCUTS.filter(([a, b]) => (a + ' ' + b).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <div className="row"><Input type="search" aria-label="Find a shortcut" placeholder="Find a shortcut" value={q} style={{ width: 240 }} onChange={(e) => setQ(e.target.value)} />
        <Btn className="sm" onClick={() => toast('Press the new key. Esc cancels.')}>Remap a key…</Btn></div>
      <div className="sheetgrid keylist" role="region" aria-label="Shortcuts" tabIndex={0} style={{ padding: 0 }}>
        {list.length ? list.map(([a, b]) => <div key={a}><span>{a}</span><kbd>{b}</kbd></div>) : <span className="sub">No shortcut matches.</span>}
      </div>
    </div>
  )
}

export function UpdateNow() {
  const net = useMock().net
  const [st, setSt] = useState<'idle' | 'checking' | 'current' | 'bad'>('idle')
  useEffect(() => { if (st !== 'checking') return; const t = setTimeout(() => setSt(net === 'online' ? 'current' : 'bad'), 700); return () => clearTimeout(t) }, [st, net])
  return (
    <div className="row">
      <span className="sub">Narration Studio · mock build</span>
      <Btn className="sm" disabled={st === 'checking'} onClick={() => setSt('checking')}>{st === 'checking' ? 'Checking…' : 'Check now'}</Btn>
      <span role="status" className="sub">{st === 'current' ? 'You have the latest version.' : st === 'bad' ? 'Could not reach the release server. Try again when online.' : ''}</span>
    </div>
  )
}

export const CUSTOM: Record<string, () => ReactNode> = {
  'daw.engine': () => <RecordingTool />, 'daw.capabilities': () => <Capabilities />, 'voice.dict': () => <Definitions />, 'voice.mwKey': () => <SecretKey />,
  'delivery.profile': () => <DeliveryProfile />, 'delivery.custom': () => <CustomProfiles />, 'project.manuscript': () => <Manuscript />, 'project.types': () => <BibleTypes />,
  'project.marks': () => <Marks />, 'project.credits': () => <Credits />, 'project.data': () => <ProjectData />, 'look.theme': () => <Theme />, 'look.reader': () => <ReaderText />,
  'look.zoom': () => <Zoom />, 'keys.map': () => <Shortcuts />,
}

