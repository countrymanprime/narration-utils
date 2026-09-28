import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { ProductionMilestone, ProductionPlan } from '../../api/contracts/production';
import { Button } from '../primitives/Button';
import { Field } from '../primitives/Field';
import { Panel } from '../primitives/Panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { TextField } from '../primitives/TextField';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

/**
 * The one milestone template (Q5 A): ACX's 15-minute checkpoint, added like any other milestone and edited or removed the same
 * way. The app names it; it does not enforce ACX's own approval process.
 */
export const ACX_CHECKPOINT: ProductionMilestone = {
  name: 'ACX 15-minute checkpoint',
  dueDate: '',
  note: 'Upload the first 15 minutes for the rights holder to approve.',
};

type Saving = 'plan' | 'milestones' | undefined;

/**
 * The book's delivery plan (production-tracking.prd.md Phase 3's bindings, set from the Production page in Phase 4): the delivery
 * date and contracted amount the figures above use, and the milestones. The host checks every date and amount and refuses a bad
 * one whole (internal/production/plan.go); the page only turns the amount's text into a number.
 */
export function PlanPanel({ onSaved }: { onSaved: () => void }) {
  const api = useApi();
  const [loaded, setLoaded] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string>();
  const [milestones, setMilestones] = useState<ProductionMilestone[]>([]);
  const [saving, setSaving] = useState<Saving>();
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const show = (plan: ProductionPlan) => {
    setDeadline(plan.deadline ?? '');
    setAmount(plan.contractedAmount === null ? '' : String(plan.contractedAmount));
    setMilestones(plan.milestones);
  };

  useEffect(() => {
    let active = true;
    api
      .productionPlan()
      .then((plan) => {
        if (!active) return;
        show(plan);
        setLoaded(true);
      })
      .catch((error) => active && setProblem(`The delivery plan could not be read: ${apiErrorMessage(error)}`));
    return () => {
      active = false;
    };
  }, [api]);

  const save = async (what: Exclude<Saving, undefined>, write: () => Promise<ProductionPlan>) => {
    setSaving(what);
    setProblem(undefined);
    setSaved(undefined);
    try {
      show(await write());
      setSaved(what === 'plan' ? 'Saved the delivery date and amount.' : 'Saved the milestones.');
      onSaved();
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setSaving(undefined);
    }
  };

  const savePlan = () => {
    const trimmed = amount.trim();
    const value = trimmed === '' ? null : Number(trimmed.replace(/,/g, ''));
    if (value !== null && !(Number.isFinite(value) && value >= 0)) {
      setAmountError('Write the amount as a number of zero or more, like 2400, or leave it empty.');
      return;
    }
    setAmountError(undefined);
    void save('plan', () => api.setProductionDeadline(deadline.trim(), value));
  };

  const change = (index: number, patch: Partial<ProductionMilestone>) =>
    setMilestones((current) => current.map((milestone, at) => (at === index ? { ...milestone, ...patch } : milestone)));
  const hasCheckpoint = milestones.some((milestone) => milestone.name.trim() === ACX_CHECKPOINT.name);

  return (
    <Panel title="Delivery plan">
      <p className="mt-1 text-xs" style={MUTED}>
        The delivery date and what the book pays you. Both are optional: until they are set, the days left and the effective rate stay a dash.
      </p>
      {problem && (
        <p role="alert" className="mt-2 text-sm" style={DANGER}>
          {problem}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-2 text-sm">
          {saved}
        </p>
      )}
      {/* Each Field sits in its own wrapper: Field spaces itself from the one before only as a first child. */}
      <div className="mt-1 grid gap-x-4 min-[768px]:grid-cols-2">
        <div>
          <Field label="Delivery date" value={deadline} onChange={setDeadline} placeholder="YYYY-MM-DD" hint="Leave empty for none." disabled={!loaded} />
        </div>
        <div>
          <Field
            label="Contracted amount"
            value={amount}
            onChange={setAmount}
            placeholder="2400"
            hint="In your own currency; leave empty for none."
            error={amountError}
            disabled={!loaded}
          />
        </div>
      </div>
      <Button className="mt-3" pending={saving === 'plan'} disabled={!loaded || saving === 'milestones'} onClick={savePlan}>
        Save date and amount
      </Button>

      <h3 className="mt-5 font-semibold">Milestones</h3>
      {milestones.length === 0 ? (
        <p className="mt-1 text-sm" style={MUTED}>
          No milestones yet.
        </p>
      ) : (
        // A milestone is a row of the same three facts, so the list is a table: the column headers name the fields.
        <div className="mt-1 overflow-x-auto">
          <Table label="Milestones">
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Due date</TableHeader>
                <TableHeader>Note</TableHeader>
                <TableHeader hiddenLabel="Remove" />
              </TableRow>
            </TableHead>
            <TableBody>
              {milestones.map((milestone, index) => (
                // The list is edited in place and saved whole, so a row's position is its identity until the next save.
                <TableRow key={index}>
                  <TableCell className="min-w-[10rem]">
                    <TextField label="Name" value={milestone.name} onChange={(name) => change(index, { name })} />
                  </TableCell>
                  <TableCell className="w-[10rem] min-w-[8rem]">
                    <TextField label="Due date" value={milestone.dueDate} onChange={(dueDate) => change(index, { dueDate })} placeholder="YYYY-MM-DD" />
                  </TableCell>
                  <TableCell className="min-w-[10rem]">
                    <TextField label="Note" value={milestone.note ?? ''} onChange={(note) => change(index, { note })} />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${milestone.name.trim() || `milestone ${index + 1}`}`}
                      onClick={() => setMilestones((current) => current.filter((_, at) => at !== index))}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={!loaded} onClick={() => setMilestones((current) => [...current, { name: '', dueDate: '' }])}>
          Add milestone
        </Button>
        <Button variant="ghost" disabled={!loaded || hasCheckpoint} onClick={() => setMilestones((current) => [...current, { ...ACX_CHECKPOINT }])}>
          Add the ACX 15-minute checkpoint
        </Button>
        <Button
          pending={saving === 'milestones'}
          disabled={!loaded || saving === 'plan'}
          onClick={() => void save('milestones', () => api.saveProductionMilestones(milestones))}
        >
          Save milestones
        </Button>
      </div>
    </Panel>
  );
}
