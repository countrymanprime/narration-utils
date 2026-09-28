import type { DeliveryProfile, DeliveryRuleStatus, MeasureJob, PackageChecklistStatus } from '../../types';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { ProgressBar } from '../primitives/ProgressBar';
import { BookChecklist } from './BookChecklist';
import { fileVerdict } from './fileVerdict';
import { ResultIcon } from './RuleBadges';
import type { ExportJobs } from './useExportJobs';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };
const OK = { color: 'var(--ok-text)' };
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";

/** A built package's checklist item as a rule result, for its icon and its words. */
const PACKAGE_STATUS: Record<PackageChecklistStatus, { status: DeliveryRuleStatus; words: string }> = {
  included: { status: 'met', words: 'Included' },
  missing: { status: 'not_met', words: 'Missing' },
  off: { status: 'off', words: 'Off' },
  not_applicable: { status: 'not_checked', words: 'Not applicable' },
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What the package is waiting on, in the mock's words: the files that fail a check, and the ones not mastered and encoded yet. */
function waitingOn(measure: MeasureJob | undefined, jobs: ExportJobs): string | undefined {
  const failing = measure?.files.filter((file) => fileVerdict(file) === 'fail').length ?? 0;
  const parts = [
    failing > 0 ? `${plural(failing, 'failing check')}` : '',
    jobs.doneFiles.length === 0 ? 'files mastered and encoded (Master all to spec…)' : '',
  ].filter(Boolean);
  return parts.length > 0 ? `Waiting on ${parts.join(' and ')}.` : undefined;
}

/**
 * The delivery package for the platform chosen in Master & QC's tabs (stage-navigation-and-page-replacement.prd.md Phase 8, mock
 * 05's side panel; render-encode-master.prd.md Phase 5): the book checklist, then once a package is built the checklist the
 * packager judged and its outputs, the folder and every file it wrote. "Build packages" assembles the files already mastered and
 * encoded on this page. Mock 05's "Preview naming" is left out: nothing reports the package's file names before it is built.
 */
export function DeliveryPackagePanel({
  profile,
  platform,
  measure,
  jobs,
}: {
  profile?: DeliveryProfile;
  platform: string;
  measure?: MeasureJob;
  jobs: ExportJobs;
}) {
  const { packageJob, packageRunning, packageProblem } = jobs;
  const built = packageJob && !packageRunning && packageJob.phase !== 'idle' ? packageJob : undefined;
  const canPackage = !!profile && jobs.doneFiles.length > 0 && !jobs.exportRunning && !packageRunning;
  const waiting = waitingOn(measure, jobs);
  return (
    <Panel title={`Delivery package · ${platform}`}>
      {built && built.checklist.length > 0 ? (
        <ul aria-label="Package checklist" className="divide-y divide-[var(--border)]">
          {built.checklist.map((item) => (
            <li key={item.ruleId} className="flex items-start gap-1 py-2 text-sm">
              <span className="mt-0.5 flex">
                <ResultIcon status={PACKAGE_STATUS[item.status].status} />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">
                  {item.label}
                  <span className="sr-only">: {PACKAGE_STATUS[item.status].words}</span>
                </span>
                {item.detail && (
                  <span className="block text-[0.8rem]" style={MUTED}>
                    {item.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        profile && <BookChecklist profile={profile} bookRules={measure?.bookRules ?? []} />
      )}
      {built && built.files.length > 0 && (
        <section className="mt-3">
          <h3 className="section-label">Outputs</h3>
          <p className={`${MONO} mt-1 text-[0.8rem] [overflow-wrap:anywhere]`} style={MUTED}>
            {built.outputDir}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {built.files.map((file) => (
              <li key={file.destPath} className={`${MONO} [overflow-wrap:anywhere]`}>
                {file.name}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => profile && void jobs.startPackage(profile)} disabled={!canPackage} pending={packageRunning}>
          Build packages
        </Button>
        {packageRunning && (
          <Button variant="secondary" onClick={jobs.cancelPackage}>
            Cancel
          </Button>
        )}
      </div>
      {packageRunning && <ProgressBar label="Building the package" value={null} running className="mt-2" />}
      {packageProblem && (
        <p role="alert" className="mt-2 text-sm" style={DANGER}>
          {packageProblem}
        </p>
      )}
      {built ? (
        <p aria-live="polite" className="mt-2 text-sm" style={built.phase === 'error' ? DANGER : OK}>
          {built.message}
        </p>
      ) : (
        waiting && (
          <p className="mt-2 text-sm" style={MUTED}>
            {waiting}
          </p>
        )
      )}
    </Panel>
  );
}
