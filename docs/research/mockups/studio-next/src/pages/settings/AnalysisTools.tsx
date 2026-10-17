import '@/styles/components.css'
import type { ComponentSpec, ComponentStatus } from '@/domain/components'
import { minutesText, sizeText } from '@/format/size'
import { componentProvider } from '@/providers/components'
import { jobOf, statusOf } from '@/selectors/components'
import { cancelInstall, dismissFailure, installComponent, removeComponent, setAnalysisPrompt } from '@/state/commands/components'
import { useStudio } from '@/state/store'
import { confirmDialog } from '@/ui/ConfirmDialog'
import { memoryText, openConsent } from '@/ui/ComponentConsent'
import { Checkbox, IconButton, Pill, type PillKind } from '@/ui/primitives'

const PILL: Record<ComponentStatus, [PillKind, string]> = {
  installed: ['ok', 'Installed · checked'],
  downloading: ['info', 'Downloading'],
  verifying: ['info', 'Checking the download'],
  failed: ['bad', 'Download failed'],
  'not-installed': ['neutral', 'Not installed'],
  unavailable: ['neutral', 'Not available yet'],
}

function Row({ s }: { s: ComponentSpec }) {
  const ui = useStudio((x) => x.ui)
  const status = statusOf(ui, s)
  const job = jobOf(ui, s.id)
  const [kind, label] = PILL[status]
  return (
    <div className="comp" data-component={s.id} data-status={status}>
      <div className="comphead">
        <b>{s.name}</b>
        <Pill kind={kind} size="sm">{label}</Pill>
        <span className="spacer" style={{ flex: 1 }} />
        {status === 'not-installed' ? <IconButton icon="download" tip={'Download ' + s.name + '…'} data-comp-install={s.id} aria-haspopup="dialog" onClick={() => openConsent([s.id])} /> : null}
        {status === 'installed' ? (
          <IconButton icon="trash" tip={'Remove ' + s.name} className="danger" data-comp-remove={s.id}
            onClick={() => confirmDialog({ title: 'Remove ' + s.name + '?', body: 'It is deleted from this computer. You can download it again.', confirmLabel: 'Remove', focus: 'cancel', onConfirm: () => { void removeComponent(s.id) } })} />
        ) : null}
        {status === 'downloading' || status === 'verifying' ? <IconButton icon="x" tip={'Cancel the download of ' + s.name} data-comp-cancel={s.id} onClick={() => cancelInstall(s.id)} /> : null}
        {status === 'failed' ? (
          <>
            <IconButton icon="refresh" tip={'Try ' + s.name + ' again'} data-comp-retry={s.id} onClick={() => { dismissFailure(s.id); void installComponent(s.id) }} />
            <IconButton icon="x" tip="Dismiss" data-comp-dismiss={s.id} onClick={() => dismissFailure(s.id)} />
          </>
        ) : null}
      </div>
      <p>{s.does}</p>
      {status === 'unavailable' ? <span className="sub" data-comp-reason>{s.unavailable}</span> : (
        <span className="sub compfacts" data-comp-facts>
          <span>{sizeText(s.sizeMB)}</span><span>from {s.host}</span><span>needs {memoryText(s.ramGB)}</span>{s.minutesPerBook ? <span>{minutesText(s.minutesPerBook)} per book</span> : null}
        </span>
      )}
      {(status === 'downloading' || status === 'verifying') && job ? (
        <div className="compprog">
          <div className="cc-bar" role="progressbar" aria-label={'Downloading ' + s.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.pct}><i style={{ width: job.pct + '%' }} /></div>
          <span className="sub">{status === 'verifying' ? 'Checking…' : job.pct + '% of ' + sizeText(s.sizeMB)}</span>
        </div>
      ) : null}
      {status === 'failed' && job?.reason ? <span className="sub" role="alert" data-comp-error>{job.reason}</span> : null}
    </div>
  )
}

/** The optional tools that make the Story Bible scan better. Nothing is downloaded until the narrator agrees. `bare` draws the list without a panel, for a Settings section that has its own heading. */
export function AnalysisTools({ bare }: { bare?: boolean }) {
  const ask = useStudio((s) => s.ui.prefs.analysisPrompt === 'ask')
  const body = (
    <div className="pb stack" style={{ overflow: 'visible', padding: bare ? 0 : undefined }}>
      <div className="comps">{componentProvider().specs().map((s) => <Row key={s.id} s={s} />)}</div>
      <Checkbox label="Offer better analysis when scanning" labelClassName="row" checked={ask} onCheckedChange={(c) => setAnalysisPrompt(c ? 'ask' : 'basic')} />
    </div>
  )
  if (bare) return <div id="analysis">{body}</div>
  return <section className="panel" id="analysis"><div className="ph"><h2>Story Bible analysis</h2></div>{body}</section>
}
