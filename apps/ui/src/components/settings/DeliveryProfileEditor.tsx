import { useMemo, useState } from 'react';
import type { DeliveryProfile, DeliveryProfileEdit, DeliveryRule } from '../../types';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { Field } from '../primitives/Field';
import { Switch } from '../primitives/Switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { TextField } from '../primitives/TextField';
import { deliveryProfileTitle, formatBound } from '../delivery/deliveryProfile';
import { Mark } from '../delivery/RuleBadges';

const MUTED = { color: 'var(--text-muted)' };
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";

/** A length is edited in minutes; every other bound in the rule's own unit. */
const toShown = (rule: DeliveryRule, value: number | null) =>
  value === null ? '' : String(rule.metric === 'duration_seconds' ? Number((value / 60).toFixed(4)) : value);
const shownUnit = (rule: DeliveryRule) => (rule.metric === 'duration_seconds' ? 'min' : rule.unit);
const fromShown = (rule: DeliveryRule, text: string): number | null | undefined => {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  return rule.metric === 'duration_seconds' ? value * 60 : value;
};

type Draft = { off: boolean; min: string; max: string };

const adjustable = (rule: DeliveryRule) =>
  rule.scope === 'file' && rule.checkedBy !== 'listen' && (rule.min !== null || rule.max !== null) && rule.oneOf.length === 0;

/**
 * Edit a custom delivery profile (delivery-platform-profiles.prd.md Phase 4, mockup 06): its name, each file rule on or off, and the
 * numbers of a rule that has a range, beside the built-in it is based on. A copy cannot add a kind of rule the app does not check,
 * and a rule with a fixed value (the sample rate, the MP3 format, the channels) can only be turned off; the book rules are kept
 * as they are. Saving makes the next revision, and every project using the profile is judged again without measuring.
 */
export function DeliveryProfileEditor({
  profile,
  base,
  pending,
  error,
  onCancel,
  onSave,
}: {
  profile: DeliveryProfile;
  /** The built-in the profile is based on, whose numbers are shown beside each rule; absent for a profile moved from old limits with no base. */
  base?: DeliveryProfile;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (edit: DeliveryProfileEdit) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(profile.rules.map((rule) => [rule.id, { off: rule.off ?? false, min: toShown(rule, rule.min), max: toShown(rule, rule.max) }])),
  );
  const fileRules = profile.rules.filter((rule) => rule.scope === 'file');
  const baseRule = (id: string) => base?.rules.find((rule) => rule.id === id);
  const platform = base?.platform ?? 'Base';

  const problems = useMemo(() => {
    const out: Record<string, string> = {};
    for (const rule of fileRules.filter(adjustable)) {
      const draft = drafts[rule.id];
      const min = rule.min === null ? null : fromShown(rule, draft.min);
      const max = rule.max === null ? null : fromShown(rule, draft.max);
      if (min === undefined || max === undefined) out[rule.id] = `${rule.label}: enter a number`;
      else if (min !== null && max !== null && min > max) out[rule.id] = `${rule.label}: the lowest is above the highest`;
    }
    return out;
  }, [drafts, fileRules]);
  const nameProblem = name.trim() === '' ? 'Give the profile a name.' : name.trim().length > 80 ? 'A name is at most 80 characters.' : undefined;
  const invalid = nameProblem !== undefined || Object.keys(problems).length > 0;

  const update = (id: string, change: Partial<Draft>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  const save = () => {
    if (invalid) return;
    onSave({
      id: profile.id,
      name: name.trim(),
      rules: profile.rules.map((rule) => {
        const draft = drafts[rule.id];
        const bound = (text: string, original: number | null) => (original === null || !adjustable(rule) ? original : (fromShown(rule, text) ?? original));
        return { id: rule.id, off: draft.off, min: bound(draft.min, rule.min), max: bound(draft.max, rule.max) };
      }),
    });
  };
  const changed = (rule: DeliveryRule) => {
    const original = baseRule(rule.id);
    if (!original || !adjustable(rule)) return false;
    const draft = drafts[rule.id];
    return (original.min !== null && fromShown(rule, draft.min) !== original.min) || (original.max !== null && fromShown(rule, draft.max) !== original.max);
  };

  return (
    <Dialog
      title="Edit profile"
      onClose={onCancel}
      description={`${base ? `Based on ${deliveryProfileTitle(base)}. ` : ''}Saving makes revision ${profile.revision + 1}; projects using it are judged again without measuring.`}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={save} disabled={invalid} pending={pending}>
            Save profile
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="max-w-md">
          <Field label="Name" value={name} onChange={setName} error={nameProblem} />
        </div>
        {/* tabIndex: the table scrolls sideways in a narrow window, and a scrolling region must be reachable by keyboard. */}
        <div
          tabIndex={0}
          className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
        >
          <Table label="Rules of this profile">
            <TableHead>
              <TableRow>
                <TableHeader>On</TableHeader>
                <TableHeader>Rule</TableHeader>
                <TableHeader>Lowest</TableHeader>
                <TableHeader>Highest</TableHeader>
                <TableHeader>{platform}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {fileRules.map((rule) => {
                const draft = drafts[rule.id];
                const original = baseRule(rule.id);
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="align-top">
                      <Switch checked={!draft.off} onChange={(on) => update(rule.id, { off: !on })}>
                        <span className="sr-only">{`${rule.label} on`}</span>
                      </Switch>
                    </TableCell>
                    <TableCell className="min-w-[9rem] align-top" style={draft.off ? MUTED : undefined}>
                      <span className="inline-flex flex-wrap items-center gap-2 font-medium">
                        {rule.label}
                        {changed(rule) && <Mark tone="warn">Changed</Mark>}
                      </span>
                      {draft.off && (
                        <span className="block text-[0.75rem]" style={MUTED}>
                          Off: not judged, listed as off in the report
                        </span>
                      )}
                      {problems[rule.id] && (
                        <span role="alert" className="block text-[0.75rem]" style={{ color: 'var(--danger-text)' }}>
                          {problems[rule.id]}
                        </span>
                      )}
                    </TableCell>
                    {adjustable(rule) ? (
                      (['min', 'max'] as const).map((side) => (
                        <TableCell key={side} className="min-w-[7.5rem] align-top">
                          {rule[side] === null ? (
                            <span className="text-sm" style={MUTED}>
                              none
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <TextField
                                label={`${rule.label}, ${side === 'min' ? 'lowest' : 'highest'} (${shownUnit(rule)})`}
                                value={draft[side]}
                                onChange={(value) => update(rule.id, { [side]: value })}
                                disabled={draft.off}
                                inputMode="decimal"
                                mono
                                className="max-w-24 min-w-20"
                              />
                              <span className="flex-none text-xs" style={MUTED}>
                                {shownUnit(rule)}
                              </span>
                            </span>
                          )}
                        </TableCell>
                      ))
                    ) : (
                      <TableCell colSpan={2} className="align-top text-sm" style={MUTED}>
                        Fixed by {platform}; can only be turned off
                      </TableCell>
                    )}
                    <TableCell className={`${MONO} align-top text-[0.8rem] whitespace-nowrap`} style={MUTED}>
                      {original ? formatBound(original) : ''}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs" style={MUTED}>
          The listen-only and book rules (one section per file, credits files, retail sample, consistency, channels the same in every file) are kept as in{' '}
          {base ? base.name : 'the profile'}. A copy cannot add a kind of rule the app does not check.
        </p>
        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
            The profile was not saved: {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
