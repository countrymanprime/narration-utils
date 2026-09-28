import { formatWhen } from '../home/recordingCheckText';
import { Button } from '../primitives/Button';
import type { Notify } from '../primitives/Toast';
import { useProofingRender } from './useProofingRender';

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * A chapter's chosen rendered file (proofing-readiness-signals.prd.md Phase 6): what the delivery checks above are
 * about, and the actions that change it - Choose (or re-choose after it goes stale, missing or unsupported), Clear,
 * and Measure, which reuses the existing measurement job (DX-1) and needs no second file picker (the choice made
 * here is enough). Nothing here evaluates a signal itself; StageEvidence's "What was checked" already shows each
 * delivery check's own state, reason and evidence from the same association.
 */
export function RenderAssociationSection({ chapterId, notify }: { chapterId: string; notify: Notify }) {
  const render = useProofingRender(chapterId, notify);

  if (render.phase === 'loading' && !render.render) {
    return (
      <p className="mt-3 border-t border-[var(--border)] pt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
        Checking the rendered file…
      </p>
    );
  }
  if (render.phase === 'error') {
    return (
      <p role="alert" className="mt-3 border-t border-[var(--border)] pt-3 text-sm" style={{ color: 'var(--danger-text)' }}>
        Couldn’t read the rendered file: {render.error}
      </p>
    );
  }
  const info = render.render;
  if (!info) return null;

  const chooseLabel = info.state === 'none' ? 'Choose rendered file' : info.state === 'current' ? 'Change' : 'Choose rendered file again';

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3 text-sm">
      <h3 className="font-semibold">Rendered file</h3>
      {info.state === 'none' && <p style={{ color: 'var(--text-muted)' }}>{info.reason}</p>}
      {info.state !== 'none' && info.path && (
        <p>
          <span className="font-medium">{baseName(info.path)}</span>
          {info.attestedAt && <span style={{ color: 'var(--text-muted)' }}> · chosen {formatWhen(info.attestedAt)}</span>}
        </p>
      )}
      {(info.state === 'stale' || info.state === 'missing' || info.state === 'unsupported') && <p style={{ color: 'var(--danger-text)' }}>{info.reason}</p>}
      {info.state === 'current' && info.measurement && (
        <p style={{ color: 'var(--text-muted)' }}>Measured {info.measuredAt ? formatWhen(info.measuredAt) : ''}.</p>
      )}
      {info.state === 'current' && info.measurementFailed && <p style={{ color: 'var(--danger-text)' }}>The last measurement of this file failed.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" pending={render.busy} disabled={render.measuring} onClick={() => void render.choose()}>
          {chooseLabel}
        </Button>
        {info.state !== 'none' && (
          <Button variant="ghost" pending={render.busy} disabled={render.measuring} onClick={() => void render.clear()}>
            Clear
          </Button>
        )}
        {info.state === 'current' && (
          <Button variant="ghost" pending={render.measuring} disabled={render.busy} onClick={() => void render.measure()}>
            Measure
          </Button>
        )}
      </div>
    </div>
  );
}
