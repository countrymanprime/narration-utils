import { useState } from 'react'
import { PAGE_LABEL } from '@/fixtures/settings'
import { ASSETS, CACHE_DIR, KIND_LABEL, type AssetKind, type AssetSpec } from '@/fixtures/settingsAssets'
import { sizeText } from '@/format/size'
import { activeFor, assetStatus, diskUsedMB, installedAssets } from '@/selectors/settingsView'
import { go } from '@/state/commands/nav'
import { cancelAsset, dismissAssetFailure, installAsset, removeAsset, repairAsset } from '@/state/commands/settingsPage'
import type { AssetStatus } from '@/state/slices/settings'
import { getState, useStudio } from '@/state/store'
import { confirmDialog } from '@/ui/ConfirmDialog'
import { Btn, Empty, IconButton, Pill, Seg, type PillKind } from '@/ui/primitives'
import { toast } from '@/ui/overlay'
import { AnalysisTools } from './AnalysisTools'

const PILL: Record<AssetStatus, [PillKind, string]> = {
  installed: ['ok', 'Installed · checked'], downloading: ['info', 'Downloading'], verifying: ['info', 'Checking the download'], failed: ['bad', 'Download failed'],
  missing: ['neutral', 'Not installed'], repair: ['warn', 'Needs repair'], unavailable: ['neutral', 'Not available yet'],
}

function askRemove(a: AssetSpec): void {
  const s = getState()
  const uses = activeFor(s, a)
  const body = uses.length
    ? 'It is chosen for: ' + uses.join(', ') + '. Those settings switch to the smallest other model you have, and checks made with it are marked out of date. ' + sizeText(a.sizeMB) + ' is freed. You can download it again.'
    : sizeText(a.sizeMB) + ' is freed. You can download it again.'
  confirmDialog({
    title: 'Remove ' + a.name + '?', body, confirmLabel: 'Remove', focus: 'cancel',
    onConfirm: () => { const r = removeAsset(a.id); if (!r.ok) toast(r.reason); else if (r.moved.length) toast(r.moved.join('. ') + '.') },
  })
}

function Actions({ a }: { a: AssetSpec }) {
  const st = useStudio((x) => assetStatus(x, a).status)
  if (st === 'missing') return <IconButton icon="download" tip={'Download ' + a.name + ' (' + sizeText(a.sizeMB) + ')'} data-asset-install={a.id} onClick={() => installAsset(a.id)} />
  if (st === 'installed') return <IconButton icon="trash" tip={'Remove ' + a.name} className="danger" data-asset-remove={a.id} onClick={() => askRemove(a)} />
  if (st === 'downloading' || st === 'verifying') return <IconButton icon="x" tip={'Cancel the download of ' + a.name} data-asset-cancel={a.id} onClick={() => cancelAsset(a.id)} />
  if (st === 'repair') return <><IconButton icon="refresh" tip={'Repair ' + a.name} data-asset-repair={a.id} onClick={() => repairAsset(a.id)} /><IconButton icon="trash" tip={'Remove ' + a.name} className="danger" onClick={() => askRemove(a)} /></>
  if (st === 'failed') return <><IconButton icon="refresh" tip={'Try ' + a.name + ' again'} data-asset-retry={a.id} onClick={() => { dismissAssetFailure(a.id); installAsset(a.id) }} /><IconButton icon="x" tip="Dismiss" onClick={() => dismissAssetFailure(a.id)} /></>
  return null
}

function Line({ a }: { a: AssetSpec }) {
  const s = useStudio((x) => x)
  const job = assetStatus(s, a)
  const [kind, label] = PILL[job.status]
  const uses = activeFor(s, a)
  const busy = job.status === 'downloading' || job.status === 'verifying'
  return (
    <tr data-asset={a.id} data-status={job.status}>
      <th scope="row"><b>{a.name}</b><span className="sub stg-block">{KIND_LABEL[a.kind]}{a.sizeMB ? ' · ' + sizeText(a.sizeMB) : ''}{a.note ? ' · ' + a.note : ''}</span><span className="sub stg-block">{a.does}</span></th>
      <td data-label="Status">
        <Pill kind={kind} size="sm">{label}</Pill>
        {uses.length && job.status === 'installed' ? <span className="sub stg-block">In use: {uses.join(', ')}</span> : null}
        {busy ? <span className="compprog"><span className="cc-bar" role="progressbar" aria-label={'Downloading ' + a.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.pct}><i style={{ width: job.pct + '%' }} /></span><span className="sub">{job.status === 'verifying' ? 'Checking…' : job.pct + '%'}</span></span> : null}
        {job.status === 'failed' && job.reason ? <span className="sub stg-block" role="alert">{job.reason}</span> : null}
        {job.status === 'repair' ? <span className="sub stg-block">A file failed its check.</span> : null}
        {job.status === 'unavailable' && a.unavailable ? <span className="sub stg-block">{a.unavailable}</span> : null}
      </td>
      <td data-label="Used by"><span className="usedby">{a.used.map((p) => <button key={p} type="button" className="chip" onClick={() => go(p)} aria-label={'Used by ' + PAGE_LABEL[p] + '. Go to ' + PAGE_LABEL[p]}>{PAGE_LABEL[p]}</button>)}</span></td>
      <td className="act"><span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}><Actions a={a} /></span></td>
    </tr>
  )
}

const FILTERS: Array<[AssetKind | 'all', string]> = [['all', 'All'], ['speech', 'Speech to text'], ['voice', 'Voices'], ['language', 'Language'], ['tool', 'Tools']]

/** One list for everything the app downloads. What each one is used for is chosen in the section that uses it. */
export function ModelsPane() {
  const s = useStudio((x) => x)
  const [kind, setKind] = useState<AssetKind | 'all'>('all')
  const view = s.mock.settingsView
  const list = ASSETS.filter((a) => kind === 'all' || a.kind === kind)
  const have = installedAssets(s).length
  if (view === 'loading') return (
    <div className="stack" aria-busy="true" aria-label="Loading models and downloads">
      {[0, 1, 2, 3, 4].map((i) => <div className="skeleton" key={i} />)}
      <span className="sr-only" role="status">Reading the models on this computer…</span>
    </div>
  )
  if (view === 'load-error') return (
    <div className="banner bad" role="alert">
      <b>The list of models could not be read.</b>
      <span>The folder {CACHE_DIR} did not answer. Your downloads are not touched.</span>
      <span className="row"><Btn className="sm" onClick={() => { import('@/state/store').then(({ update }) => update((d) => { d.mock.settingsView = 'ready' })) }}>Try again</Btn><Btn className="sm quiet" onClick={() => toast('Opens the folder in Explorer.')}>Open the folder</Btn></span>
    </div>
  )
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="diskbar" data-disk>
        <span><b>{sizeText(diskUsedMB(s))}</b> used by {have} {have === 1 ? 'item' : 'items'}</span>
        <span className="sub">Stored in <code>{CACHE_DIR}</code></span>
        <span className="row" style={{ gap: 6 }}>
          <Btn className="sm" onClick={() => toast('Opens the folder in Explorer.')}>Open folder</Btn>
          <Btn className="sm quiet" onClick={() => confirmDialog({ title: 'Change where downloads are kept?', body: 'The files are copied to the new folder and checked, then removed from this one. Nothing is downloaded again.', confirmLabel: 'Choose a folder…', focus: 'cancel', onConfirm: () => toast('Opens a folder picker.') })}>Change location…</Btn>
        </span>
      </div>
      {have === 0 ? (
        <Empty title="Nothing is downloaded yet">
          <p style={{ margin: 0, maxWidth: '50ch' }}>Narration Studio needs a transcription model to check recordings and a voice to preview names. The recommended pair is about 600 MB.</p>
          <Btn className="primary" onClick={() => { installAsset('whisper-small'); installAsset('voice-ljspeech') }}>Download the recommended set</Btn>
        </Empty>
      ) : null}
      <Seg<AssetKind | 'all'> label="Show" value={kind} onChange={setKind} options={FILTERS} />
      <table className="assets">
        <caption className="sr-only">Models, voices and tools</caption>
        <thead><tr><th scope="col">Name, type and size</th><th scope="col">Status</th><th scope="col">Used by</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{list.map((a) => <Line key={a.id} a={a} />)}</tbody>
      </table>
      <h3 className="subh">Story Bible analysis tools</h3>
      <AnalysisTools bare />
    </div>
  )
}
