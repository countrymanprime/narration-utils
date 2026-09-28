import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { DeliveryReportExport } from '../../types';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Panel } from '../primitives/Panel';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The report export (diagnostics PRD Phase 7, user flow step 5): an explicit action that writes an HTML page a reviewer can open
 * without the app and a JSON file with the same finding IDs, covering the last measurement and diagnostics check, into the project's
 * sidecar folder. File locations stay out unless the narrator ticks the box. The host refuses while a job runs, without a project, or
 * with nothing measured; the page shows why.
 */
export function ReportExportPanel({ busy }: { busy: boolean }) {
  const api = useApi();
  const [includePaths, setIncludePaths] = useState(false);
  const [pending, setPending] = useState(false);
  const [written, setWritten] = useState<DeliveryReportExport>();
  const [problem, setProblem] = useState<string>();

  const exportReport = async () => {
    setPending(true);
    setProblem(undefined);
    try {
      setWritten(await api.deliveryExportReport(includePaths));
    } catch (error) {
      setWritten(undefined);
      setProblem(apiErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      title="Report"
      actions={
        <Button onClick={() => void exportReport()} pending={pending} disabled={busy}>
          Export report
        </Button>
      }
    >
      <p className="mt-1 text-sm" style={MUTED}>
        Writes an HTML page anyone can open and a JSON file with the same findings, of the files measured and checked here, into this project’s
        narration-utils/delivery folder. Every open finding and every file not measured is listed. It is a measurement, not a distributor’s approval, and your
        audio is never changed.
      </p>
      <div className="mt-2">
        <Checkbox checked={includePaths} onChange={setIncludePaths}>
          Include each file’s full location (otherwise only file names are written)
        </Checkbox>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-sm" style={DANGER}>
          The report was not written: {problem}
        </p>
      )}
      {written && (
        <div aria-live="polite" className="mt-2 text-sm">
          <p>
            Wrote <span className="font-medium [overflow-wrap:anywhere]">{written.htmlFile}</span> and{' '}
            <span className="font-medium [overflow-wrap:anywhere]">{written.jsonFile}</span> to {written.folder}.
          </p>
          <p className="mt-1" style={MUTED}>
            {count(written.files, 'file', 'files')}, {count(written.openFindings, 'open finding', 'open findings')} of {written.findings};{' '}
            {written.pathsIncluded ? 'full file locations included.' : 'file names only, no locations.'}
          </p>
        </div>
      )}
    </Panel>
  );
}
