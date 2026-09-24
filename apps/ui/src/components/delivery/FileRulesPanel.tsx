import type { DeliveryProfile, DeliveryRule, DeliveryRuleResult, MeasureFileResult } from '../../types';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { deliveryProfileTitle, describeMet, describeMiss, formatRuleValue, requirementOwner } from './deliveryProfile';
import { formatLength, formatLevel } from './deliveryFormat';
import { Requirement } from './DeliveryProfilePanel';
import { describeFormat } from './MeasurementsTable';
import { ResultMark, VerificationMark } from './RuleBadges';

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

/** What this file measured for a rule, and how it stands against the bound, in words. */
function ThisFile({ rule, result, owner }: { rule: DeliveryRule; result?: DeliveryRuleResult; owner: string }) {
  if (!result || result.value === null) {
    return <span style={MUTED}>{result?.why ?? 'Not judged.'}</span>;
  }
  const missed = result.status === 'not_met';
  const value = formatRuleValue(rule, result.value);
  return (
    <>
      <span className={`${MONO} block font-semibold`} style={missed ? DANGER : undefined}>
        {value}
        {rule.metric === 'sample_peak_dbfs'
          ? ' (sample peak)'
          : rule.unit && rule.metric !== 'duration_seconds' && rule.metric !== 'sample_rate'
            ? ` ${rule.unit}`
            : ''}
      </span>
      <span className="block text-[0.8rem]" style={missed ? DANGER : MUTED}>
        {missed ? describeMiss(rule, result, `${owner}'s`) : describeMet(rule)}
      </span>
      {result.advice && (
        <span className="block text-[0.8rem]" style={{ color: 'var(--warn-text)' }}>
          Advice: {result.advice}.
        </span>
      )}
    </>
  );
}

/**
 * One measured file against the profile, rule by rule (delivery-platform-profiles.prd.md Phase 3, mockup 04): each file rule's
 * result, the value this file measured, what the platform requires and how that requirement was verified. Loudness and true peak
 * are information here, not rules, unless the profile has a rule for them.
 */
export function FileRulesPanel({ file, profile, onClose }: { file: MeasureFileResult; profile: DeliveryProfile; onClose: () => void }) {
  const report = file.report;
  const owner = profile.builtIn ? profile.platform : 'the profile';
  const rules = profile.rules.filter((rule) => rule.scope === 'file');
  const lufsRule = rules.some((rule) => rule.metric === 'integrated_lufs' && !rule.off);
  return (
    <Panel
      title={`${file.name} against ${deliveryProfileTitle(profile)}`}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {report && (
        <p className="mt-1 text-sm" style={MUTED}>
          {describeFormat(report)} · {formatLength(report.duration_seconds)}.
          {report.integrated_lufs !== null && !lufsRule
            ? ` Loudness ${formatLevel(report.integrated_lufs)} LUFS (information: ${profile.builtIn ? `${profile.platform} sets` : 'the profile has'} no LUFS rule).`
            : ''}
          {report.true_peak_dbtp !== null ? ` True peak ${formatLevel(report.true_peak_dbtp)} dBTP.` : ''}
        </p>
      )}
      {/* tabIndex: the table scrolls sideways in a narrow window, and a scrolling region must be reachable by keyboard. */}
      <div tabIndex={0} className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset">
        <Table label={`${file.name}, rule by rule`} className="mt-3">
          <TableHead>
            <TableRow>
              <TableHeader>Result</TableHeader>
              <TableHeader>Rule</TableHeader>
              <TableHeader>This file</TableHeader>
              <TableHeader>{requirementOwner(profile)}</TableHeader>
              <TableHeader>Source</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => {
              const result = file.rules.find((candidate) => candidate.ruleId === rule.id);
              return (
                <TableRow key={rule.id}>
                  <TableCell className="align-top">{result && <ResultMark status={result.status} />}</TableCell>
                  <TableCell className="min-w-[8rem] align-top">
                    <span className="block font-medium">{rule.label}</span>
                    <span className={`${MONO} block text-[0.72rem]`} style={MUTED}>
                      {rule.id}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-[11rem] align-top text-sm">
                    <ThisFile rule={rule} result={result} owner={owner} />
                  </TableCell>
                  <TableCell className="min-w-[12rem] align-top text-sm">
                    <Requirement rule={rule} />
                  </TableCell>
                  <TableCell className="min-w-[9rem] align-top text-sm">
                    <VerificationMark verification={rule.verification} />
                    {rule.verificationNote && (
                      <span className="mt-1 block text-[0.75rem]" style={MUTED}>
                        {rule.verificationNote}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs" style={MUTED}>
        Book rules (channels the same across files, credits files, retail sample, one section per file, consistency) are listed in the profile; the checklist
        for them comes later.
      </p>
    </Panel>
  );
}
