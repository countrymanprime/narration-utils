import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bootstrap, Scope, ScopedSettingField, TtsCatalog } from '../../types';
import { useApi } from '../../api/ApiContext';
import { Heading } from '../primitives/Heading';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { ScopedSetting } from './ScopedSetting';

type SettingsCategory = { key: string; label: string; tool?: string; scopes: Scope[]; filter?: (field: ScopedSettingField) => boolean };
const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { key: 'General', label: 'General', tool: 'General', scopes: ['global'] },
  { key: 'Manuscript', label: 'Manuscript', tool: 'Manuscript', scopes: ['global', 'project'] },
  { key: 'TranscriptCompare', label: 'Proofing', tool: 'TranscriptCompare', scopes: ['global', 'project'] },
  { key: 'ManuscriptGuide', label: 'Story Bible', tool: 'ManuscriptGuide', scopes: ['global', 'project'] },
  { key: 'Daw', label: 'DAW Integration', scopes: ['global'] },
  { key: 'Piper', label: 'TTS', tool: 'Piper', scopes: ['global', 'project'] },
  { key: 'ProjectData', label: 'Project data', scopes: ['project'] },
];

export function Settings({
  data,
  notify,
  onDirtyChange,
  registerActions,
  onProjectDataCleared,
}: {
  data: Bootstrap;
  notify: (text: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  registerActions: (actions: { save: () => Promise<void>; discard: () => Promise<void> }) => void;
  onProjectDataCleared: () => Promise<void>;
}) {
  const api = useApi();
  const [scope, setScope] = useState<Scope>('global');
  const [category, setCategory] = useState('General');
  const [settings, setSettings] = useState<Record<string, ScopedSettingField[]>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [pendingChange, setPendingChange] = useState<() => void>();
  const [confirmClearProjectData, setConfirmClearProjectData] = useState(false);
  const [ttsCatalog, setTtsCatalog] = useState<TtsCatalog>();
  const [confirmRemoveVoice, setConfirmRemoveVoice] = useState(false);
  const [loadError, setLoadError] = useState('');
  const categories = useMemo(() => SETTINGS_CATEGORIES.filter((entry) => entry.scopes.includes(scope)), [scope]);
  const active = categories.find((entry) => entry.key === category) ?? categories[0];
  const fields = active?.tool ? (settings[active.tool] || []).filter((field) => !active.filter || active.filter(field)) : [];
  const applyPalette = useCallback((next: Record<string, ScopedSettingField[]>) => {
    const root = document.documentElement;
    const pairs: Record<string, string> = {
      color_character: '--character',
      color_location: '--place',
      color_organization: '--org',
      color_lore: '--lore',
      color_item: '--item',
      color_event: '--event',
      color_needs_review: '--review',
      color_note: '--note',
    };
    [...(next.ManuscriptGuide || []), ...(next.Manuscript || [])].forEach((field) => {
      if (pairs[field.key] && field.effectiveValue) root.style.setProperty(pairs[field.key], `#${field.effectiveValue.replace('#', '')}`);
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.settingsForScope(scope);
      const catalog = category === 'Piper' ? await api.ttsCatalog() : undefined;
      setSettings(next);
      setTtsCatalog(catalog);
      setLoadError('');
      applyPalette(next);
      const currentTool = active?.tool;
      const currentFields = currentTool ? (next[currentTool] || []).filter((field) => !active?.filter || active.filter(field)) : [];
      setValues(Object.fromEntries(currentFields.map((field) => [field.key, field.value])));
      setDirty(false);
    } catch (error) {
      const message = String(error);
      setLoadError(message);
      notify(message);
    }
  }, [active, api, applyPalette, category, notify, scope]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (active?.key !== category) setCategory(categories[0]?.key ?? '');
  }, [scope, active?.key, categories, category]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const save = useCallback(async () => {
    if (!active?.tool) return;
    try {
      await api.saveSettings(active.tool, scope, values);
      notify(`${scope === 'global' ? 'Global' : 'Project'} settings saved.`);
      await load();
    } catch (error) {
      notify(String(error));
    }
  }, [active?.tool, api, load, notify, scope, values]);
  const discard = useCallback(async () => {
    await load();
  }, [load]);
  useEffect(() => {
    registerActions({ save, discard });
  }, [save, discard, registerActions]);
  const requestChange = (next: () => void) => {
    if (dirty) setPendingChange(() => next);
    else next();
  };
  const clearOverride = async (key: string) => {
    if (!active?.tool) return;
    try {
      await api.saveSettings(active.tool, 'project', { [key]: null });
      notify('Project override cleared.');
      await load();
    } catch (error) {
      notify(String(error));
    }
  };
  const selectedTtsVoice = ttsCatalog?.voices.find((voice) => voice.id === ttsCatalog.voice.id);
  const reaperLauncher = data.runtime.Reaper?.launcherPath;

  return (
    <div className="settings-page">
      <Heading title="Settings" />
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {(['global', 'project'] as Scope[]).map((option) => (
          <button key={option} className={`tab-btn ${scope === option ? 'active' : ''}`} onClick={() => requestChange(() => setScope(option))}>
            {option === 'global' ? 'Global' : 'This Project'}
          </button>
        ))}
      </div>
      <div className="settings-workspace">
        <nav className="settings-nav space-y-1">
          {categories.map((entry) => (
            <button
              key={entry.key}
              className={`rail-btn ${category === entry.key ? 'active' : ''}`}
              onClick={() => requestChange(() => setCategory(entry.key))}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <section className="panel settings-scroll">
          <div className="panel-head">
            <h2 className="f-label text-lg">{active?.label}</h2>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {scope === 'global' ? 'Global defaults' : 'This Project — falls back to Global where unset'}
            </span>
          </div>
          <div className="panel-body">
            {loadError && (
              <div className="mb-4 rounded-md p-3 text-sm" role="alert" style={{ background: 'var(--review-soft)', color: 'var(--review)' }}>
                Settings could not be loaded: {loadError}. Select another category or try again.
              </div>
            )}
            {category === 'Daw' ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 rounded-md p-3" style={{ background: 'var(--surface-2)' }}>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: 'var(--character)' }} />
                  <div>
                    <div className="font-medium">{data.daw}</div>
                    <div style={{ color: 'var(--text-muted)' }}>Connected — detected automatically from the running project.</div>
                  </div>
                </div>
                {reaperLauncher && (
                  <div className="rounded-md p-3" style={{ background: 'var(--surface-2)' }}>
                    <div className="font-medium">REAPER launcher</div>
                    <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                      Import this action once in REAPER. If Narration Utils is moved or updated, re-import this path when prompted; the app never changes REAPER
                      for you.
                    </p>
                    <code className="mt-2 block break-all rounded p-2 text-xs" style={{ background: 'var(--surface)' }}>
                      {reaperLauncher}
                    </code>
                    <button
                      className="btn btn-ghost mt-2 text-xs"
                      type="button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(reaperLauncher)
                          .then(() => notify('REAPER launcher path copied.'))
                          .catch(() => notify('Could not copy the REAPER launcher path.'))
                      }
                    >
                      Copy path
                    </button>
                  </div>
                )}
              </div>
            ) : category === 'ProjectData' ? (
              <div className="space-y-4 text-sm">
                <div className="rounded-md p-3" style={{ background: 'var(--surface-2)' }}>
                  <div className="font-medium">Clear derived project data</div>
                  <div className="mt-1" style={{ color: 'var(--text-muted)' }}>
                    Removes the imported manuscript and stored source, Story Bible, proofing artifacts, reader notes/bookmarks, and saved comparison results.
                    Settings remain.
                  </div>
                </div>
                <button className="btn btn-danger" onClick={() => setConfirmClearProjectData(true)}>
                  Clear derived project data…
                </button>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                {category === 'Piper' && (
                  <div className="mb-4 space-y-3 rounded-md p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
                    <div>
                      <div className="font-medium">Local TTS previews</div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        Piper voices are optional, catalog-managed local assets. Selecting a voice never downloads it; downloading is confirmed when you request
                        a preview.
                      </div>
                    </div>
                    {selectedTtsVoice && (
                      <div className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                        <div>
                          <div className="font-medium">{selectedTtsVoice.displayName}</div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {selectedTtsVoice.installState === 'installed'
                              ? 'Installed and verified'
                              : selectedTtsVoice.installState === 'verification_failed'
                                ? 'Needs repair'
                                : 'Not installed'}{' '}
                            · {Math.ceil(selectedTtsVoice.downloadSize / (1024 * 1024))} MB
                          </div>
                        </div>
                        {selectedTtsVoice.installState === 'installed' && (
                          <button className="btn btn-ghost text-xs" type="button" onClick={() => setConfirmRemoveVoice(true)}>
                            Remove local voice…
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-3">
                  {fields.map((field) => (
                    <ScopedSetting
                      key={field.key}
                      field={field}
                      scope={scope}
                      value={values[field.key] ?? ''}
                      change={(value) => {
                        setValues((current) => ({ ...current, [field.key]: value }));
                        setDirty(true);
                      }}
                      onClearOverride={() => clearOverride(field.key)}
                    />
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--warn)' }}>
                    {dirty && 'Unsaved changes'}
                  </span>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost" type="button" disabled={!dirty} onClick={() => void discard()}>
                      Discard changes
                    </button>
                    <button className="btn btn-primary" type="submit" disabled={!dirty}>
                      Save
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
      {pendingChange && (
        <ConfirmDialog
          title="Unsaved settings"
          body="Save or discard changes before continuing?"
          confirmLabel="Save & continue"
          confirm={() => {
            const next = pendingChange;
            setPendingChange(undefined);
            void save().then(next);
          }}
          dangerLabel="Discard & continue"
          danger={() => {
            const next = pendingChange;
            setPendingChange(undefined);
            void discard().then(next);
          }}
          cancel={() => setPendingChange(undefined)}
        />
      )}
      {confirmClearProjectData && (
        <ConfirmDialog
          title="Clear derived project data?"
          body="This permanently removes the imported manuscript and stored source, Story Bible and proofing data, reader notes/bookmarks, and saved comparison results for this project. Settings will remain."
          confirmLabel="Clear project data"
          confirm={async () => {
            try {
              await api.clearProjectData();
              setConfirmClearProjectData(false);
              notify('Derived project data cleared.');
              await onProjectDataCleared();
            } catch (error) {
              notify(String(error));
            }
          }}
          cancel={() => setConfirmClearProjectData(false)}
        />
      )}
      {confirmRemoveVoice && selectedTtsVoice && (
        <ConfirmDialog
          title="Remove local preview voice?"
          body={`Remove ${selectedTtsVoice.displayName} from this computer? Your settings and project preview WAVs remain; requesting a new preview will ask to download the voice again.`}
          confirmLabel="Remove voice"
          confirm={() =>
            void api
              .ttsRemove(selectedTtsVoice.id)
              .then(async () => {
                setConfirmRemoveVoice(false);
                notify('Local preview voice removed.');
                await load();
              })
              .catch((error) => notify(String(error)))
          }
          cancel={() => setConfirmRemoveVoice(false)}
        />
      )}
    </div>
  );
}
