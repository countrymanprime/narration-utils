import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { CreditTemplate, DeliveryProfile, DeliveryRule, DeliveryRuleResult, RetailSample } from '../../types';
import { formatRuleValue } from './deliveryProfile';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LISTEN_ICON, ResultIcon } from './RuleBadges';

const MUTED = { color: 'var(--text-muted)' };

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

/** What the result says under the rule: its value, or why it has none, and what the project already has for it. */
function bookLines(rule: DeliveryRule, result: DeliveryRuleResult | undefined, bonus: string | undefined): string[] {
  const lines: string[] = [];
  if (result?.value !== null && result?.value !== undefined) lines.push(`${formatRuleValue(rule, result.value)}${rule.unit ? ` ${rule.unit}` : ''}`);
  else if (result?.violation === 'differs_across_files') lines.push('The measured files do not all agree.');
  else if (result?.why) lines.push(result.why);
  if (bonus) lines.push(bonus);
  return lines;
}

const STATUS_WORDS: Record<DeliveryRuleResult['status'], string> = {
  met: 'Met',
  not_met: 'Not met',
  not_checked: 'Not checked by the app',
  not_measurable: 'Not measurable',
  off: 'Off',
};

/**
 * The book-level rules (delivery-platform-profiles.prd.md Phase 7), drawn as mock 05's delivery package checklist (stage
 * navigation Phase 8): credits files, retail sample, one section per file and consistency (subjective, never automated) and
 * channels the same across every measured file. Credits and the retail sample are read from the project as a whole, as a bonus
 * line under the rule's own "not checked by the app" reason, never as a pass. Each item says its result in words (for a screen
 * reader) as well as by its icon.
 */
export function BookChecklist({ profile, bookRules }: { profile: DeliveryProfile; bookRules: readonly DeliveryRuleResult[] }) {
  const facts = useBookFacts();
  const rules = profile.rules.filter((rule) => rule.scope === 'book' && !rule.off);
  if (rules.length === 0) return null;
  const bonusFor = (ruleId: string): string | undefined =>
    ruleId === 'acx.credits' ? facts.credits : ruleId === 'acx.retail_sample' ? facts.retailSample : undefined;
  return (
    <ul aria-label="Book checklist" className="divide-y divide-[var(--border)]">
      {rules.map((rule) => {
        const result = bookRules.find((candidate) => candidate.ruleId === rule.id);
        const lines = bookLines(rule, result, bonusFor(rule.id));
        return (
          <li key={rule.id} className="flex items-start gap-1 py-2 text-sm">
            {rule.checkedBy === 'listen' ? (
              <FontAwesomeIcon icon={LISTEN_ICON} aria-hidden="true" className="mt-0.5 mr-1.5 size-3.5 flex-none" style={{ color: 'var(--non-text)' }} />
            ) : (
              <span className="mt-0.5 flex">
                <ResultIcon status={result?.status ?? 'not_checked'} />
              </span>
            )}
            <span className="min-w-0">
              <span className="block font-medium">
                {rule.label}
                <span className="sr-only">: {rule.checkedBy === 'listen' ? 'Listen' : STATUS_WORDS[result?.status ?? 'not_checked']}</span>
              </span>
              {lines.map((line) => (
                <span key={line} className="block text-[0.8rem]" style={MUTED}>
                  {line}
                </span>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
