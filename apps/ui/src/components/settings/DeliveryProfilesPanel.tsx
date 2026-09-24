import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import type { DeliveryProfile, DeliveryProfileEdit, DeliveryProfileRef, DeliveryProfilesState, Scope } from '../../types';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Select } from '../primitives/Select';
import type { Notify } from '../primitives/Toast';
import { deliveryProfileKey, deliveryProfileTitle } from '../delivery/deliveryProfile';
import { LOCK_ICON, Mark } from '../delivery/RuleBadges';
import { DeliveryProfileEditor } from './DeliveryProfileEditor';

const MUTED = { color: 'var(--text-muted)' };

/** A select option's value: a built-in at its version, a custom profile by its id alone (it always judges with its latest revision). */
const optionValue = (ref: DeliveryProfileRef | DeliveryProfile) =>
  'builtIn' in ref ? (ref.builtIn ? `${ref.id}@${ref.version}` : ref.id) : ref.version ? `${ref.id}@${ref.version}` : ref.id;

/** How many of a custom profile's numbers differ from the built-in it is based on, and how many rules are off. */
function differences(profile: DeliveryProfile, base?: DeliveryProfile) {
  let numbers = 0;
  for (const rule of profile.rules) {
    const original = base?.rules.find((candidate) => candidate.id === rule.id);
    if (!original) continue;
    if (original.min !== rule.min) numbers += 1;
    if (original.max !== rule.max) numbers += 1;
  }
  return { numbers, off: profile.rules.filter((rule) => rule.off).length };
}

function describe(profile: DeliveryProfile, base?: DeliveryProfile): string {
  if (profile.builtIn) {
    const host = profile.source.url ? ` · from ${new URL(profile.source.url).host}, read ${profile.source.readOn}` : '';
    return `Built in · read-only · ${profile.rules.length} rules${host}`;
  }
  const { numbers, off } = differences(profile, base);
  return [
    'Custom',
    profile.note ? profile.note.replace(/\.$/, '').replace(/^Moved/, 'moved') : '',
    base ? `based on ${deliveryProfileTitle(base)}` : '',
    `revision ${profile.revision}`,
    numbers > 0 ? `${numbers} ${numbers === 1 ? 'number' : 'numbers'} changed` : '',
    off > 0 ? `${off} ${off === 1 ? 'rule' : 'rules'} off` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Settings > Delivery (delivery-platform-profiles.prd.md Phases 3 and 4, mockups 05 and 06): the profile this project is judged
 * against (or, in the Global scope, the default for every project that has not chosen one), and the profiles themselves. A
 * built-in cannot be changed; Duplicate makes a custom copy whose numbers can change and whose rules can be turned off. A
 * choice takes effect at once: the Delivery page and the report judge against it the next time they are read.
 */
export function DeliveryProfilesPanel({ scope, notify }: { scope: Scope; notify: Notify }) {
  const api = useApi();
  const [state, setState] = useState<DeliveryProfilesState>();
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<DeliveryProfile>();
  const [editError, setEditError] = useState<string>();
  const [deleting, setDeleting] = useState<DeliveryProfile>();

  const load = useCallback(() => {
    api
      .deliveryProfiles()
      .then((next) => {
        setState(next);
        setLoadError(undefined);
      })
      .catch((error) => setLoadError(apiErrorMessage(error)));
  }, [api]);
  useEffect(load, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify(apiErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
        The delivery profiles could not be read: {loadError}
      </p>
    );
  }
  if (!state) {
    return (
      <p className="text-sm" style={MUTED}>
        Reading the delivery profiles…
      </p>
    );
  }

  const byKey = (key?: string) => state.profiles.find((profile) => deliveryProfileKey(profile) === key);
  const baseOf = (profile: DeliveryProfile) => (profile.basedOn ? byKey(profile.basedOn) : undefined);
  const globalProfile = state.profiles.find((profile) => optionValue(profile) === optionValue(state.globalDefault));
  const options = state.profiles.map((profile) => ({
    value: optionValue(profile),
    label: `${deliveryProfileTitle(profile)} · ${profile.builtIn ? 'built in' : 'custom'}`,
  }));
  const projectOptions = [{ value: '', label: `The Global default (${globalProfile ? deliveryProfileTitle(globalProfile) : 'ACX'})` }, ...options];
  const choose = (value: string) =>
    run(async () => {
      const profile = state.profiles.find((candidate) => optionValue(candidate) === value);
      const next = await api.deliverySelectProfile(scope, profile?.id ?? '', profile?.builtIn ? profile.version : '');
      setState(next);
      notify(
        profile
          ? `${scope === 'global' ? 'The Global default is now' : 'This project is now judged against'} ${deliveryProfileTitle(profile)}.`
          : 'This project now uses the Global default.',
      );
    });
  const usedBy = (profile: DeliveryProfile) =>
    [
      globalProfile && deliveryProfileKey(globalProfile) === deliveryProfileKey(profile) ? 'Global default' : '',
      state.hasProject && state.projectChoice && optionValue(state.projectChoice) === optionValue(profile) ? 'This project' : '',
    ].filter(Boolean);

  const duplicate = (profile: DeliveryProfile) =>
    run(async () => {
      const copy = await api.deliveryDuplicateProfile(profile.id, profile.builtIn ? profile.version : '');
      setState(await api.deliveryProfiles());
      notify(`Duplicated as "${copy.name}".`);
      setEditError(undefined);
      setEditing(copy);
    });
  const save = (edit: DeliveryProfileEdit) =>
    void (async () => {
      setBusy(true);
      try {
        const saved = await api.deliverySaveProfile(edit);
        setState(await api.deliveryProfiles());
        setEditing(undefined);
        notify(`Saved "${saved.name}", revision ${saved.revision}.`);
      } catch (error) {
        setEditError(apiErrorMessage(error));
      } finally {
        setBusy(false);
      }
    })();
  const remove = (profile: DeliveryProfile) =>
    run(async () => {
      setState(await api.deliveryDeleteProfile(profile.id));
      setDeleting(undefined);
      notify(`Deleted "${profile.name}".`);
    });

  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <h3 className="text-base font-semibold">{scope === 'global' ? 'Default delivery profile' : 'Delivery profile for this project'}</h3>
        <p style={MUTED}>
          {scope === 'global'
            ? 'Every project that has not chosen its own profile is judged against this one.'
            : 'The Delivery page and the report judge this project’s files against it. Each project keeps its own choice.'}
        </p>
        <div className="max-w-md">
          <Select
            label={scope === 'global' ? 'Default delivery profile' : 'Delivery profile for this project'}
            value={scope === 'global' ? optionValue(state.globalDefault) : state.projectChoice ? optionValue(state.projectChoice) : ''}
            onChange={(value) => void choose(value)}
            options={scope === 'global' ? options : projectOptions}
            disabled={busy || (scope === 'project' && !state.hasProject)}
            fullWidth
          />
        </div>
        {state.notice && (
          <p role="status" style={{ color: 'var(--warn-text)' }}>
            {state.notice}
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-base font-semibold">Profiles</h3>
        <p style={MUTED}>
          A built-in profile cannot be changed. Duplicate it to change its numbers or turn a rule off; a copy cannot add a kind of rule the app does not check.
          Other platforms (Findaway Voices, Author&apos;s Republic, Google Play, Kobo) are not built in yet.
        </p>
        <ul aria-label="Delivery profiles" className="divide-y rounded-md border" style={{ borderColor: 'var(--border)' }}>
          {state.profiles.map((profile) => {
            const users = usedBy(profile);
            return (
              <li key={profile.id} className="flex flex-wrap items-center justify-between gap-3 p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{deliveryProfileTitle(profile)}</span>
                    {profile.builtIn ? (
                      <Mark tone="muted" icon={LOCK_ICON}>
                        Built in
                      </Mark>
                    ) : (
                      <Mark tone="muted">Custom</Mark>
                    )}
                  </div>
                  <div className="text-xs" style={MUTED}>
                    {describe(profile, baseOf(profile))}
                  </div>
                  <div className="text-xs" style={MUTED}>
                    Used by: {users.length > 0 ? users.join(' · ') : 'no project open here'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => void duplicate(profile)} disabled={busy}>
                    Duplicate
                  </Button>
                  {!profile.builtIn && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditError(undefined);
                          setEditing(profile);
                        }}
                        disabled={busy}
                      >
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => setDeleting(profile)} disabled={busy}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {editing && (
        <DeliveryProfileEditor profile={editing} base={baseOf(editing)} pending={busy} error={editError} onCancel={() => setEditing(undefined)} onSave={save} />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          body="A project that chose it is judged against the Global default from then on. This cannot be undone."
          confirmLabel="Delete profile"
          confirmVariant="danger"
          pending={busy}
          confirm={() => void remove(deleting)}
          cancel={() => setDeleting(undefined)}
        />
      )}
    </div>
  );
}
