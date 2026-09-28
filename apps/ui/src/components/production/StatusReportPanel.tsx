import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { ProductionReportExport } from '../../api/contracts/production';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Panel } from '../primitives/Panel';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

/**
 * The status report export (production-tracking.prd.md Phase 5, user flow step 5): an explicit action that writes an
 * HTML page anyone can open and a JSON file with the same figures the page just showed (hours by stage, PFH, the
 * deadline and milestone status, book-wide readiness counts), into the project's own sidecar folder. The contracted
 * amount and effective rate are left out unless the narrator ticks the box: a status report is often the one thing a
 * narrator shares with someone they would not otherwise tell their rate.
 */
export function StatusReportPanel() {
  const api = useApi();
  const [includeContractedAmount, setIncludeContractedAmount] = useState(false);
  const [pending, setPending] = useState(false);
  const [written, setWritten] = useState<ProductionReportExport>();
  const [problem, setProblem] = useState<string>();

  const exportReport = async () => {
    setPending(true);
    setProblem(undefined);
    try {
      setWritten(await api.productionStatusReport(includeContractedAmount));
    } catch (error) {
      setWritten(undefined);
      setProblem(apiErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      title="Status report"
      actions={
        <Button onClick={() => void exportReport()} pending={pending}>
          Export status report
        </Button>
      }
    >
      <p className="mt-1 text-sm" style={MUTED}>
        Writes an HTML page anyone can open and a JSON file with the same figures shown above (hours by stage, hours per finished hour, the deadline and
        milestone status, and chapter readiness counts) into this project’s narration-utils/production/reports folder.
      </p>
      <div className="mt-2">
        <Checkbox checked={includeContractedAmount} onChange={setIncludeContractedAmount}>
          Include the contracted amount and effective rate (left out by default)
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
            {written.contractedAmountIncluded
              ? 'The contracted amount and effective rate are included.'
              : 'The contracted amount and effective rate are left out.'}
          </p>
        </div>
      )}
    </Panel>
  );
}
