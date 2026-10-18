import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { describeApiError } from '../../../api/errorMessage';
import { usePort } from '../../../ports/usePort';
import type { Scope, ScopedSettingField } from '../../../types';
import { Button } from '../../primitives/Button';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { Panel } from '../../primitives/Panel';
import type { Notify } from '../../primitives/Toast';
import { ToggleGroup } from '../../primitives/ToggleGroup';
import { ScopedSetting } from '../ScopedSetting';
import { useScopedFields, useSettingsForms } from './settingsForms';

const SCOPE_LABEL: Record<Scope, string> = { global: 'Global', project: 'This project' };
const SCOPE_SUBTITLE: Record<Scope, string> = { global: 'Global defaults', project: 'This project, falling back to Global where unset' };

// What the narrator edited. The form holds every field of the tool, and a field with no value in this scope holds an
// empty string, which the host rejects for a choice or a colour ("unsupported value for chunk_seconds"): sending the whole
// form failed every save in a scope that had any unset field (a project has none set until one is saved).
// A field with no value of its own shows the value it inherits, so putting it back to that value is no change either: sending
// it would pin the inherited value as an override (a two-state switch makes that easy to do by accident).
// An emptied number is "not set", which the host takes as null (a number is never saved as "").
function changedValues(fields: readonly ScopedSettingField[], values: Record<string, string>): Record<string, string | null> {
  const isChanged = (field: ScopedSettingField, next: string) => next !== field.value && !(field.value === '' && next === field.effectiveValue);
  const saved = (field: ScopedSettingField, next: string) => (field.kind === 'number' && next === '' ? null : next);
  return Object.fromEntries(
    fields.filter((field) => isChanged(field, values[field.key] ?? field.value)).map((field) => [field.key, saved(field, values[field.key] ?? '')]),
  );
}

/** What a panel's own parts are drawn from: the scope on show and its fields, as last read. */
type ScopedPanelState = { scope: Scope; fields: readonly ScopedSettingField[]; dirty: boolean; reload: () => Promise<void> };

export type ScopedFieldsPanelProps = {
  /** The panel's anchor (`settings-<id>`) and its key among the page's forms. */
  id: string;
  title: string;
  /** The settings tool whose fields the form edits; absent for a panel with no generic fields. */
  tool?: string;
  /** The scopes the panel offers, the first shown first. Two scopes draw a Global / This project switch in the header. */
  scopes: readonly Scope[];
  /** Leaves a field out of the form (one another panel already offers). A module-level function, not one made per render. */
  filter?: (field: ScopedSettingField) => boolean;
  notify: Notify;
  /** Drawn above the fields. */
  before?: (state: ScopedPanelState) => ReactNode;
  /** Drawn below the fields, above Save. */
  after?: (state: ScopedPanelState) => ReactNode;
  /** Replaces the form in a scope where the panel is not a form of fields (DAW Integration in a project); `undefined` keeps it. */
  replace?: (state: ScopedPanelState) => ReactNode;
  /** Told when the narrator picks a value, with the form as it is now and a way to put this field back; the panel still holds the pick. */
  onChoose?: (change: { key: string; value: string; values: Record<string, string>; revert: () => void }) => void;
};

/**
 * A Settings panel over one settings tool, kept from the old category list (features the Studio Next mock has no panel
 * for stay as built, as a panel of the page's one column). It edits the tool's fields in Global or in This project,
 * shows Save and Discard once something changed, and asks before a scope switch would drop an edit. Its edits join
 * the page's dirty flag and its leave guard through `SettingsFormsProvider`.
 */
export function ScopedFieldsPanel({ id, title, tool, scopes, filter, notify, before, after, replace, onChoose }: ScopedFieldsPanelProps) {
  const system = usePort('system');
  const { register } = useSettingsForms();
  const [scope, setScope] = useState<Scope>(scopes[0]!);
  const { fields: read, error, reload } = useScopedFields(tool, scope);
  // `filter` is a module-level function, so the list keeps its identity between reads.
  const fields = useMemo(() => (read ?? []).filter((field) => !filter || filter(field)), [read, filter]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [pendingScope, setPendingScope] = useState<Scope>();

  // A clean form follows what was last read; an edited one keeps the narrator's values until saved or discarded.
  useEffect(() => {
    if (!dirty) setValues(Object.fromEntries((read ?? []).map((field) => [field.key, field.value])));
  }, [read, dirty]);

  const save = useCallback(async () => {
    if (!tool || !read) return;
    try {
      const changed = changedValues(read, values);
      // An edit that was put back leaves nothing to save: the host is not asked, and "Unsaved changes" clears.
      if (Object.keys(changed).length > 0) {
        await system.saveSettings(tool, scope, changed);
        notify(`${scope === 'global' ? 'Global' : 'Project'} settings saved.`);
      }
      setDirty(false);
      await reload();
    } catch (failure) {
      notify(describeApiError(failure), 'error');
    }
  }, [system, notify, read, reload, scope, tool, values]);
  const discard = useCallback(async () => {
    setDirty(false);
    await reload();
  }, [reload]);
  useEffect(() => {
    register(id, { dirty, save, discard });
  }, [id, dirty, save, discard, register]);
  useEffect(() => () => register(id, undefined), [id, register]);

  const clearOverride = async (key: string) => {
    if (!tool) return;
    try {
      await system.saveSettings(tool, 'project', { [key]: null });
      notify('Project override cleared.');
      await reload();
    } catch (failure) {
      notify(describeApiError(failure), 'error');
    }
  };
  const chooseScope = (next: Scope) => {
    if (next === scope) return;
    if (dirty) setPendingScope(next);
    else setScope(next);
  };

  const state: ScopedPanelState = { scope, fields, dirty, reload };
  const replaced = replace?.(state);
  return (
    <div id={`settings-${id}`} className="scroll-mt-4">
      <Panel
        title={title}
        subtitle={scopes.length > 1 || scope === 'project' ? SCOPE_SUBTITLE[scope] : undefined}
        actions={
          scopes.length > 1 ? (
            <ToggleGroup
              label={`${title} scope`}
              look="segmented"
              value={scope}
              onChange={(next) => chooseScope(next as Scope)}
              options={scopes.map((entry) => ({ value: entry, label: SCOPE_LABEL[entry] }))}
            />
          ) : undefined
        }
      >
        {error && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center gap-3 rounded-md p-3 text-sm"
            style={{ background: 'var(--review-soft)', color: 'var(--danger-text)' }}
          >
            <span>Settings could not be loaded: {error}.</span>
            <Button variant="secondary" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        )}
        {replaced ?? (
          <form
            className="space-y-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {before?.(state)}
            {tool && !read && !error && <p className="m-0 text-[var(--text-muted)]">Reading the settings…</p>}
            {fields.length > 0 && (
              <div className="space-y-3">
                {fields.map((field) => (
                  <ScopedSetting
                    key={field.key}
                    field={field}
                    scope={scope}
                    value={values[field.key] ?? ''}
                    change={(value) => {
                      const previous = values[field.key] ?? '';
                      setValues((current) => ({ ...current, [field.key]: value }));
                      setDirty(true);
                      onChoose?.({
                        key: field.key,
                        value,
                        values: { ...values, [field.key]: value },
                        revert: () => setValues((current) => ({ ...current, [field.key]: previous })),
                      });
                    }}
                    onClearOverride={() => clearOverride(field.key)}
                  />
                ))}
              </div>
            )}
            {after?.(state)}
            {dirty && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--warn-text)' }}>
                  Unsaved changes
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" type="button" onClick={() => void discard()}>
                    Discard changes
                  </Button>
                  <Button variant="primary" type="submit">
                    Save
                  </Button>
                </div>
              </div>
            )}
          </form>
        )}
      </Panel>
      {pendingScope && (
        <ConfirmDialog
          title="Unsaved settings"
          body="Save or discard changes before continuing?"
          confirmLabel="Save & continue"
          confirm={() => {
            const next = pendingScope;
            setPendingScope(undefined);
            void save().then(() => setScope(next));
          }}
          dangerLabel="Discard & continue"
          danger={() => {
            const next = pendingScope;
            setPendingScope(undefined);
            void discard().then(() => setScope(next));
          }}
          cancel={() => setPendingScope(undefined)}
        />
      )}
    </div>
  );
}
