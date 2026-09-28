import type { DeliveryProfile, MeasureFileResult } from '../../types';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { BookConsistency } from './BookConsistency';
import { fileVerdict, leftToCheck, misses } from './fileVerdict';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };
const OK = { color: 'var(--ok-text)' };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Why a file fails in sentences, each with a suggested fix; or that it passes, and what the narrator still checks by hand. */
function Verdict({ file, profile }: { file: MeasureFileResult; profile: DeliveryProfile }) {
  const missed = misses(file, profile);
  const advice = file.rules.flatMap((result) => (result.advice ? [result.advice] : []));
  const left = leftToCheck(file);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {missed.length > 0 ? (
        missed.map((miss) => (
          <div key={miss.rule.id}>
            <p className="font-semibold" style={DANGER}>
              {miss.text}
            </p>
            {miss.fix && (
              <p className="mt-0.5" style={MUTED}>
                Suggested fix: {miss.fix}
              </p>
            )}
          </div>
        ))
      ) : (
        <p className="font-semibold" style={OK}>
          Every rule the app checks is met.
        </p>
      )}
      {advice.map((text) => (
        <p key={text} style={{ color: 'var(--warn-text)' }}>
          Advice: {text}.
        </p>
      ))}
      {left > 0 && (
        <p style={MUTED}>
          {plural(left, 'rule')} the app could not judge for this file: check {left === 1 ? 'it' : 'them'} yourself before uploading (Every rule).
        </p>
      )}
    </div>
  );
}

/**
 * Mock 05's "04 · Why it fails" (stage-navigation-and-page-replacement.prd.md Phase 8): the chosen file's missed rules in words
 * with a suggested fix, beside the book's consistency; "Every rule" opens the file rule by rule (delivery-platform-profiles.prd.md
 * Phase 3). With no file chosen it is the book's consistency alone. Mock 05's "Quietest 5 s" and "Open in REAPER" are left out:
 * the host can neither play a stretch of a rendered file nor open one in the DAW yet.
 */
export function WhyItFails({
  file,
  profile,
  files,
  rulesOpen,
  onToggleRules,
}: {
  file?: MeasureFileResult;
  profile: DeliveryProfile;
  files: readonly MeasureFileResult[];
  rulesOpen: boolean;
  onToggleRules: () => void;
}) {
  if (!file) {
    return (
      <Panel title="Book consistency">
        <BookConsistency profile={profile} files={files} titled={false} />
      </Panel>
    );
  }
  const failed = fileVerdict(file) === 'fail';
  return (
    <Panel
      title={`${file.name} · ${failed ? 'Why it fails' : 'Why it passes'}`}
      actions={
        <Button variant="ghost" onClick={onToggleRules} aria-expanded={rulesOpen}>
          Every rule
        </Button>
      }
    >
      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <Verdict file={file} profile={profile} />
        <BookConsistency profile={profile} files={files} />
      </div>
    </Panel>
  );
}
