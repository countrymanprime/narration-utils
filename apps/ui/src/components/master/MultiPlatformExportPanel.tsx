import { useState } from 'react';
import type { DeliveryProfile, DeliveryRuleStatus, MultiPackagePhase, MultiPackageResult } from '../../types';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Panel } from '../primitives/Panel';
import { ProgressBar } from '../primitives/ProgressBar';
import { SectionLabel } from '../primitives/SectionLabel';
import { ResultIcon } from './RuleBadges';
import type { ExportJobs } from './useExportJobs';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };
const OK = { color: 'var(--ok-text)' };
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";

/** The label a checkbox gives a profile: its platform for a built-in, its own name for a custom profile - the same
 * rule MasterQcPage.tsx's own `platformName` applies to the single-select platform tabs (ADR 0480: the tabs stay
 * the project's own single delivery-profile choice; this list is a separate, multi-select export-platform picker). */
const platformNameFor = (profile: DeliveryProfile) => (profile.builtIn ? profile.platform : profile.name);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A multi-platform result's own status, in the same icon language as a package checklist row (RuleBadges.tsx). */
const RESULT_STATUS: Record<MultiPackagePhase, { icon: DeliveryRuleStatus; word: string }> = {
  pending: { icon: 'not_measurable', word: 'Waiting' },
  running: { icon: 'not_checked', word: 'Building…' },
  success: { icon: 'met', word: 'Built' },
  error: { icon: 'not_met', word: "Couldn't build" },
};

function ResultRow({ result }: { result: MultiPackageResult }) {
  const { icon, word } = RESULT_STATUS[result.phase];
  return (
    <li className="flex items-start gap-1 py-2 text-sm">
      <span className="mt-0.5 flex">
        <ResultIcon status={icon} />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">
          {result.platform}
          <span className="sr-only">: {word}</span>
        </span>
        {result.phase === 'success' && (
          <>
            <span className={`${MONO} block text-[0.8rem] [overflow-wrap:anywhere]`} style={MUTED}>
              {result.outputDir}
            </span>
            <span className="block text-[0.8rem]" style={MUTED}>
              {plural(result.files.length, 'file')}
            </span>
          </>
        )}
        {result.phase === 'error' && (
          <span className="block text-[0.8rem]" style={DANGER}>
            {result.error || result.message}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * One mastered/encoded source's packages for several platforms in one action (render-encode-master.prd.md Phase 6):
 * a checkbox per profile the host lists (the same list Master & QC's platform tabs read, ADR 0480 - the tabs
 * themselves stay a single-select choice of the project's own judged profile, never repurposed here), a "Build N
 * packages" action once at least one is checked and the export job has files ready, a progress indicator and Cancel
 * while it runs, and a per-profile result row once it has (or has started to) run.
 */
export function MultiPlatformExportPanel({ profiles, jobs }: { profiles: DeliveryProfile[]; jobs: ExportJobs }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { multiPackageJob, multiPackageRunning, multiPackageProblem } = jobs;

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const chosen = profiles.filter((profile) => selected.has(profile.id));
  const canBuild = chosen.length > 0 && jobs.doneFiles.length > 0 && !jobs.exportRunning && !jobs.packageRunning && !multiPackageRunning;
  const results = multiPackageJob && multiPackageJob.phase !== 'idle' ? multiPackageJob.results : [];

  return (
    <Panel title="Multi-platform export">
      {profiles.length === 0 ? (
        <p className="text-sm" style={MUTED}>
          No delivery platforms are set up yet.
        </p>
      ) : (
        <fieldset className="flex flex-col gap-0.5">
          <SectionLabel as="legend" className="mb-1">
            Build packages for
          </SectionLabel>
          {profiles.map((profile) => (
            <Checkbox key={profile.id} checked={selected.has(profile.id)} onChange={(checked) => toggle(profile.id, checked)} disabled={multiPackageRunning}>
              {platformNameFor(profile)}
            </Checkbox>
          ))}
        </fieldset>
      )}
      {results.length > 0 && (
        <ul aria-label="Multi-platform export results" className="mt-3 divide-y divide-[var(--border)]">
          {results.map((result) => (
            <ResultRow key={result.profile} result={result} />
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void jobs.startMultiPackage(chosen)} disabled={!canBuild} pending={multiPackageRunning}>
          Build {plural(chosen.length, 'package')}
        </Button>
        {multiPackageRunning && (
          <Button variant="secondary" onClick={jobs.cancelMultiPackage}>
            Cancel
          </Button>
        )}
      </div>
      {multiPackageRunning && <ProgressBar label="Building packages" value={null} running className="mt-2" />}
      {multiPackageProblem && (
        <p role="alert" className="mt-2 text-sm" style={DANGER}>
          {multiPackageProblem}
        </p>
      )}
      {multiPackageJob && multiPackageJob.phase !== 'idle' && multiPackageJob.phase !== 'running' && (
        <p aria-live="polite" className="mt-2 text-sm" style={multiPackageJob.phase === 'error' ? DANGER : OK}>
          {multiPackageJob.message}
        </p>
      )}
    </Panel>
  );
}
