import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { CreditTemplate, DeliveryProfile, DeliveryRule, DeliveryRuleResult, RetailSample } from '../../types';
import { Panel } from '../primitives/Panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { formatRuleValue } from './deliveryProfile';
import { Requirement } from './DeliveryProfilePanel';
import { LISTEN_ICON } from './RuleBadges';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ResultMark } from './RuleBadges';

const MUTED = { color: 'var(--text-muted)' };
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";

/**
 * What the project already has for a book rule the app cannot check yet (`acx.credits`, `acx.retail_sample`): read
 * directly from the credits feature, since matching files to chapters (`credits-in-chapter-table.prd.md` Phase 3)
 * has not landed. Undefined while loading, or on any read failure - the row still shows the rule's own "not checked"
 * reason either way, this is only ever a bonus line under it.
 */
function useBookFacts(): { credits?: string; retailSample?: string } {
  const api = useApi();
  const [credits, setCredits] = useState<string>();
  const [retailSample, setRetailSample] = useState<string>();
  useEffect(() => {
    let active = true;
    api
      .creditsTemplates()
      .then((templates: CreditTemplate[]) => {
        if (!active) return;
        const has = (kind: string) => templates.some((template) => template.kind === kind);
        const missing = [!has('opening') && 'opening', !has('closing') && 'closing'].filter(Boolean) as string[];
        setCredits(missing.length === 0 ? 'Opening and closing credits templates are set up.' : `No ${missing.join(' or ')} credits template set up yet.`);
      })
      .catch(() => active && setCredits(undefined));
    api
      .creditsRetailSample()
      .then((answer: { sample: RetailSample | null; problem: string }) => {
        if (!active) return;
        setRetailSample(
          answer.sample ? `A retail sample is picked, about ${Math.round(answer.sample.seconds)}s.` : answer.problem || 'No retail sample picked yet.',
        );
      })
      .catch(() => active && setRetailSample(undefined));
    return () => {
      active = false;
    };
  }, [api]);
  return { credits, retailSample };
}

/** The result's value or why it has none, for a book rule (no single file to point at, unlike `FileRulesPanel`'s `ThisFile`). */
function BookValue({ rule, result, bonus }: { rule: DeliveryRule; result?: DeliveryRuleResult; bonus?: string }) {
  const lines: string[] = [];
  if (result?.value !== null && result?.value !== undefined) {
    lines.push(`${formatRuleValue(rule, result.value)}${rule.unit ? ` ${rule.unit}` : ''}`);
  } else if (result?.violation === 'differs_across_files') {
    lines.push('The measured files do not all agree.');
  } else if (result?.why) {
    lines.push(result.why);
  }
  return (
    <>
      {lines.map((line, index) => (
        <span key={index} className={`block ${index === 0 ? 'font-medium' : 'text-[0.8rem]'}`} style={index === 0 ? undefined : MUTED}>
          {line}
        </span>
      ))}
      {bonus && (
        <span className="mt-1 block text-[0.8rem]" style={MUTED}>
          {bonus}
        </span>
      )}
    </>
  );
}

/**
 * The book-level rules (delivery-platform-profiles.prd.md Phase 7): credits files, retail sample, one section per
 * file and consistency (subjective, never automated) and channels the same across every measured file. Needs files
 * matched to chapters to check per file (`credits-in-chapter-table.prd.md` Phase 3, not landed): until then, credits
 * and the retail sample are read from the project as a whole, as a bonus line under the rule's own "not checked by
 * the app" reason, never as a pass. `job.bookRules` already carries every book rule's result (channels is measured
 * today); this panel is only their checklist, since `FileRulesPanel` lists file rules one file at a time.
 */
export function BookChecklistPanel({ profile, bookRules }: { profile: DeliveryProfile; bookRules: readonly DeliveryRuleResult[] }) {
  const facts = useBookFacts();
  const rules = profile.rules.filter((rule) => rule.scope === 'book' && !rule.off);
  if (rules.length === 0) return null;
  const bonusFor = (ruleId: string): string | undefined =>
    ruleId === 'acx.credits' ? facts.credits : ruleId === 'acx.retail_sample' ? facts.retailSample : undefined;
  return (
    <Panel title="Book checklist">
      <p className="text-sm" style={MUTED}>
        Requirements for the book as a whole, not one file at a time.
      </p>
      <div tabIndex={0} className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset">
        <Table label="Book checklist" className="mt-3">
          <TableHead>
            <TableRow>
              <TableHeader>Result</TableHeader>
              <TableHeader>Rule</TableHeader>
              <TableHeader>In this project</TableHeader>
              <TableHeader>Requirement</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => {
              const result = bookRules.find((candidate) => candidate.ruleId === rule.id);
              return (
                <TableRow key={rule.id}>
                  <TableCell className="align-top">{result && <ResultMark status={result.status} />}</TableCell>
                  <TableCell className="min-w-[8rem] align-top">
                    <span className="block font-medium">{rule.label}</span>
                    <span className={`${MONO} block text-[0.72rem]`} style={MUTED}>
                      {rule.id}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-[13rem] align-top text-sm">
                    {rule.checkedBy === 'listen' && (
                      <FontAwesomeIcon
                        icon={LISTEN_ICON}
                        aria-hidden="true"
                        className="mt-0.5 mr-1.5 size-3.5 flex-none"
                        style={{ color: 'var(--non-text)' }}
                      />
                    )}
                    <BookValue rule={rule} result={result} bonus={bonusFor(rule.id)} />
                  </TableCell>
                  <TableCell className="min-w-[12rem] align-top text-sm">
                    <Requirement rule={rule} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
