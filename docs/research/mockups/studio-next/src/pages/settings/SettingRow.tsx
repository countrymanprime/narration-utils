import { useEffect, useId, useState, type ReactNode } from 'react'
import { PAGE_LABEL, type Option, type SettingRow } from '@/fixtures/settings'
import { assetOf } from '@/fixtures/settingsAssets'
import { assetStatus, anyChanged, computerValue, hasOverride, isChanged, projectValue } from '@/selectors/settingsView'
import { go } from '@/state/commands/nav'
import { clearOverride, installAsset, cancelAsset, resetRow, setCat, setComputer, setOverride } from '@/state/commands/settingsPage'
import { useStudio } from '@/state/store'
import { confirmDialog } from '@/ui/ConfirmDialog'
import { Btn, Checkbox, IconButton, Input, NumberInput, Pill, Select } from '@/ui/primitives'

const SCOPE: Record<SettingRow['scope'], string> = { computer: 'This computer', project: 'This project', both: 'All projects', browser: 'This computer' }

export function ScopeBadge({ row }: { row: SettingRow }) {
  const s = useStudio((x) => x.ui.settings)
  return (
    <span className="row" style={{ gap: 6 }}>
      <Pill kind={row.scope === 'project' ? 'copper' : 'neutral'} size="sm">{SCOPE[row.scope]}</Pill>
      {hasOverride(s, row) ? <Pill kind="copper" size="sm">Overridden here</Pill> : null}
    </span>
  )
}

/** The pages that read this setting. Each one goes there; the setting is changed here, once. */
export function UsedBy({ row }: { row: SettingRow }) {
  if (!row.used.length) return null
  return (
    <span className="usedby">
      <span className="sub">Used by</span>
      {row.used.map((p) => <button key={p} type="button" className="chip" data-used={p} aria-label={'Used by ' + PAGE_LABEL[p] + '. Go to ' + PAGE_LABEL[p]} onClick={() => go(p)}>{PAGE_LABEL[p]}</button>)}
    </span>
  )
}

/** Under a choice of downloadable things: is the chosen one on the disk, and a way to get it without leaving the row. */
export function AssetNote({ row, value }: { row: SettingRow; value: string }) {
  const st = useStudio((x) => x)
  const asset = assetOf(row.options?.find((o) => o.value === value)?.asset ?? '')
  if (!asset) return null
  const job = assetStatus(st, asset)
  if (job.status === 'installed') return null
  const busy = job.status === 'downloading' || job.status === 'verifying'
  return (
    <div className="assetnote" data-asset-note={asset.id}>
      {busy ? (
        <>
          <div className="cc-bar" role="progressbar" aria-label={'Downloading ' + asset.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.pct}><i style={{ width: job.pct + '%' }} /></div>
          <span className="sub">{job.status === 'verifying' ? 'Checking…' : job.pct + '%'}</span>
          <IconButton icon="x" tip={'Cancel the download of ' + asset.name} onClick={() => cancelAsset(asset.id)} />
        </>
      ) : job.status === 'failed' ? (
        <>
          <Pill kind="bad" size="sm">Download failed</Pill><span className="sub" role="alert">{job.reason}</span>
          <Btn className="sm" onClick={() => { cancelAsset(asset.id); installAsset(asset.id) }}>Try again</Btn>
        </>
      ) : (
        <>
          <Pill kind="warn" size="sm">Not on this computer</Pill>
          <span className="sub">{asset.name} must be downloaded before it is used.</span>
          <Btn className="sm" onClick={() => installAsset(asset.id)} aria-label={'Download ' + asset.name}>Download</Btn>
        </>
      )}
      <button type="button" className="linkbtn" onClick={() => setCat('models')}>Models &amp; downloads</button>
    </div>
  )
}

function TextControl({ value, onCommit, label, invalid, id, describedBy, placeholder, width }: { value: string; onCommit: (v: string) => void; label: string; invalid: boolean; id: string; describedBy?: string; placeholder?: string; width?: number }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = (): void => { if (v !== value) onCommit(v) }
  return <Input id={id} type="text" value={v} aria-label={label} aria-describedby={describedBy} invalid={invalid} placeholder={placeholder} style={{ width: width ?? 320, maxWidth: '100%' }}
    onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
}

/** The control for one value of a plain setting. `which` says whose value it is, for the accessible name. */
export function ValueControl({ row, value, onChange, which, id, describedBy, invalid }: { row: SettingRow; value: string; onChange: (v: string) => void; which?: string; id: string; describedBy?: string; invalid?: boolean }) {
  const name = row.label + (which ? ' (' + which + ')' : '')
  if (row.kind === 'bool') {
    return (
      <span className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
        <Checkbox id={id} aria-label={name} checked={value === 'true'} onCheckedChange={(c) => onChange(c ? 'true' : 'false')} />
        <span className="sub" aria-hidden="true">{value === 'true' ? 'On' : 'Off'}</span>
      </span>
    )
  }
  if (row.kind === 'choice') {
    const opts = (row.options ?? []).map((o: Option) => ({ value: o.value, label: o.label }))
    return <Select id={id} aria-label={name} aria-describedby={describedBy} value={value} onValueChange={onChange} options={opts} style={{ width: 260, maxWidth: '100%' }} />
  }
  if (row.kind === 'number') {
    return (
      <span className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
        <NumberInput id={id} aria-label={name} aria-describedby={describedBy} value={Number(value)} min={row.min} max={row.max} step={row.step} onValueChange={(n) => onChange(String(n))} style={{ width: 96 }} />
        {row.unit ? <span className="sub">{row.unit}</span> : null}
      </span>
    )
  }
  return <TextControl id={id} value={value} onCommit={onChange} label={name} invalid={!!invalid} describedBy={describedBy} placeholder={row.id === 'daw.reaperPath' ? 'C:\\Program Files\\REAPER\\reaper.exe' : undefined} width={row.id === 'daw.reaperPath' ? 420 : undefined} />
}

/**
 * One setting: what it is, whose it is, who reads it, and its control. Changes apply at once; a changed row says so in words and can be
 * reset; a row that allows a project override shows whether this project uses the computer value or its own.
 */
export function Row({ row, children }: { row: SettingRow; children?: ReactNode }) {
  const s = useStudio((x) => x.ui.settings)
  const uid = useId()
  const cid = 'set-' + row.id
  const err = s.errors[row.id]
  const changed = anyChanged(s, row)
  const comp = computerValue(s, row)
  const saved = s.saved?.row === row.id
  const defLabel = row.options?.find((o) => o.value === row.def)?.label ?? (row.def || 'empty')
  const describedBy = uid + 'd' + (err ? ' ' + uid + 'e' : '')
  const apply = (v: string, project: boolean): void => {
    if (row.costly && !project) {
      confirmDialog({ title: row.costly.title, body: row.costly.body, confirmLabel: row.costly.confirm, focus: 'cancel', onConfirm: () => { setComputer(row.id, v) } })
      return
    }
    if (project) setOverride(row.id, v)
    else setComputer(row.id, v)
  }
  return (
    <div className="srow" data-row={row.id} data-changed={changed ? 'true' : undefined} data-scope={row.scope}>
      <div className="srow-l">
        <span className="srow-t">
          <label htmlFor={children ? undefined : cid} id={uid + 'l'}>{row.label}</label>
          {changed ? <Pill kind="info" size="sm">Changed</Pill> : null}
        </span>
        <span className="sub srow-d" id={uid + 'd'}>{row.desc}</span>
        <span className="srow-m"><ScopeBadge row={row} /><UsedBy row={row} />{row.also ? <span className="sub">Also set in {row.also}</span> : null}</span>
      </div>
      <div className="srow-c">
        {children ?? (
          <>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <ValueControl row={row} id={cid} value={comp} onChange={(v) => apply(v, false)} describedBy={describedBy} invalid={!!err} which={row.scope === 'both' ? 'all projects' : undefined} />
              {isChanged(s, row) ? <IconButton icon="undo" tip={'Reset ' + row.label + ' to ' + defLabel} className="ghost" onClick={() => resetRow(row.id)} /> : null}
            </div>
            {row.kind === 'choice' ? <AssetNote row={row} value={comp} /> : null}
            {row.scope === 'both' ? (
              hasOverride(s, row) ? (
                <div className="override" data-override={row.id}>
                  <span className="sub">This project uses</span>
                  <ValueControl row={row} id={cid + '-p'} value={projectValue(s, row)} onChange={(v) => apply(v, true)} which="this project" describedBy={describedBy} />
                  <Btn className="ghost sm" onClick={() => clearOverride(row.id)} aria-label={'Use the computer setting for ' + row.label}>Use computer setting</Btn>
                  {row.kind === 'choice' ? <AssetNote row={row} value={projectValue(s, row)} /> : null}
                </div>
              ) : (
                <div className="override"><span className="sub">This project uses the computer setting.</span>
                  <Btn className="ghost sm" onClick={() => setOverride(row.id, comp)} aria-label={'Override ' + row.label + ' for this project'}>Override for this project</Btn></div>
              )
            ) : null}
          </>
        )}
        {row.effect ? <span className="sub">{row.effect}</span> : null}
        <span className="srow-s" id={uid + 'e'}>
          {err ? <span className="err"><span className="errmark" aria-hidden="true">!</span>{err}</span> : saved ? <span className="saved" key={s.saved?.n}>Saved</span> : null}
        </span>
      </div>
    </div>
  )
}

