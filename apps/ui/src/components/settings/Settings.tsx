import { describeApiError } from '../../api/errorMessage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bootstrap, Scope, ScopedSettingField, TtsCatalog, WhisperCatalog } from '../../types';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Tab, TabList, TabPanel, Tabs } from '../primitives/Tabs';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useTheme } from '../../theme/ThemeContext';
import type { ThemePreference } from '../../theme/theme';
import { AboutPanel } from './AboutPanel';
import { ScopedSetting } from './ScopedSetting';
import { UpdatesPanel } from './UpdatesPanel';
import type { Notify } from '../primitives/Toast';

type SettingsCategory = { key: string; label: string; tool?: string; scopes: Scope[]; filter?: (field: ScopedSettingField) => boolean };
const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { key: 'General', label: 'General', tool: 'General', scopes: ['global'] },
  { key: 'Appearance', label: 'Appearance', scopes: ['global'] },
  { key: 'Manuscript', label: 'Manuscript', tool: 'Manuscript', scopes: ['global', 'project'] },
  { key: 'TranscriptCompare', label: 'Proofing', tool: 'TranscriptCompare', scopes: ['global', 'project'] },
  { key: 'ManuscriptGuide', label: 'Story Bible', tool: 'ManuscriptGuide', scopes: ['global', 'project'] },
  { key: 'Daw', label: 'DAW Integration', scopes: ['global'] },
  { key: 'Piper', label: 'TTS', tool: 'Piper', scopes: ['global', 'project'] },
  { key: 'ProjectData', label: 'Project data', scopes: ['project'] },
  { key: 'About', label: 'About & updates', tool: 'Updates', scopes: ['global'] },
];
const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// What the narrator edited. The form holds every field of the category, and a field with no value in this scope holds an
// empty string, which the host rejects for a choice or a colour ("unsupported value for chunk_seconds"): sending the whole
// form failed every save in a scope that had any unset field (a project has none set until one is saved).
// A field with no value of its own shows the value it inherits, so putting it back to that value is no change either: sending
// it would pin the inherited value as an override (a two-state switch makes that easy to do by accident).
function changedValues(fields: readonly ScopedSettingField[], values: Record<string, string>): Record<string, string> {
  const isChanged = (field: ScopedSettingField, next: string) => next !== field.value && !(field.value === '' && next === field.effectiveValue);
  return Object.fromEntries(fields.filter((field) => isChanged(field, values[field.key] ?? field.value)).map((field) => [field.key, values[field.key]]));
}

export function Settings({
  data,
  notify,
  onDirtyChange,
  registerActions,
  onProjectDataCleared,
}: {
  data: Bootstrap;
  notify: Notify;
  onDirtyChange: (dirty: boolean) => void;
  registerActions: (actions: { save: () => Promise<void>; discard: () => Promise<void> }) => void;
  onProjectDataCleared: () => Promise<void>;
}) {
  const api = useApi();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const [scope, setScope] = useState<Scope>('global');
  // Tailwind's `md` (48rem): from there the category list stands beside the panel, below it the list is a row.
  const sideBySide = useMediaQuery('(min-width: 48rem)', true);
  const [category, setCategory] = useState('General');
  const [settings, setSettings] = useState<Record<string, ScopedSettingField[]>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [pendingChange, setPendingChange] = useState<() => void>();
  const [confirmClearProjectData, setConfirmClearProjectData] = useState(false);
  const [ttsCatalog, setTtsCatalog] = useState<TtsCatalog>();
  const [confirmRemoveVoice, setConfirmRemoveVoice] = useState(false);
  const [whisperCatalog, setWhisperCatalog] = useState<WhisperCatalog>();
  const [confirmRemoveModel, setConfirmRemoveModel] = useState(false);
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
      const modelCatalog = category === 'TranscriptCompare' ? await api.whisperCatalog() : undefined;
      setSettings(next);
      setTtsCatalog(catalog);
      setWhisperCatalog(modelCatalog);
      setLoadError('');
      applyPalette(next);
      const currentTool = active?.tool;
      const currentFields = currentTool ? (next[currentTool] || []).filter((field) => !active?.filter || active.filter(field)) : [];
      setValues(Object.fromEntries(currentFields.map((field) => [field.key, field.value])));
      setDirty(false);
    } catch (error) {
      const message = describeApiError(error);
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
      const changed = changedValues(settings[active.tool] ?? [], values);
      // An edit that was put back leaves nothing to save: reloading is what clears "Unsaved changes", and the host is not asked.
      if (Object.keys(changed).length > 0) {
        await api.saveSettings(active.tool, scope, changed);
        notify(`${scope === 'global' ? 'Global' : 'Project'} settings saved.`);
      }
      await load();
    } catch (error) {
      notify(describeApiError(error), 'error');
    }
  }, [active?.tool, api, load, notify, scope, settings, values]);
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
      notify(describeApiError(error), 'error');
    }
  };
  const selectedTtsVoice = ttsCatalog?.voices.find((voice) => voice.id === ttsCatalog.voice.id);
  const selectedWhisperModel = whisperCatalog?.models.find((model) => model.id === whisperCatalog.model.id);
  const reaperLauncher = data.runtime.Reaper?.launcherPath;
  // The update panel asks the host what is available on the saved channel, so it starts over when that changes.
  const savedUpdateChannel = settings.Updates?.find((field) => field.key === 'channel')?.effectiveValue ?? '';

  return (
    <Tabs
      value={scope}
      onChange={(next) => requestChange(() => setScope(next as Scope))}
      className="mx-auto grid max-w-6xl grid-rows-[auto_auto_minmax(0,1fr)] gap-4 md:h-[calc(100dvh-6.5rem)]"
    >
      <Heading title="Settings" />
      <TabList label="Settings scope">
        <Tab value="global">Global</Tab>
        <Tab value="project">This Project</Tab>
      </TabList>
      <TabPanel value={scope} className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
        {/* The categories are vertical tabs in the wide layout and a row below it; `contents` lets the list and the panel join the grid above. */}
        <Tabs
          value={category}
          onChange={(next) => requestChange(() => setCategory(next))}
          orientation={sideBySide ? 'vertical' : 'horizontal'}
          className="contents"
        >
          <TabList
            label="Settings categories"
            variant="sidebar"
            className="settings-nav static flex gap-1 space-y-1 overflow-auto md:sticky md:top-0 md:block md:self-start md:overflow-visible"
          >
            {categories.map((entry) => (
              <Tab key={entry.key} value={entry.key}>
                {entry.label}
              </Tab>
            ))}
          </TabList>
          <TabPanel
            value={category}
            className="min-h-0 overflow-visible rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] md:overflow-auto"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
              <h2 className="font-['Barlow_Condensed',sans-serif] text-lg tracking-[0.08em] uppercase">{active?.label}</h2>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {scope === 'global' ? 'Global defaults' : 'This Project — falls back to Global where unset'}
              </span>
            </div>
            <div className="p-[1.1rem]">
              {loadError && (
                <div className="mb-4 rounded-md p-3 text-sm" role="alert" style={{ background: 'var(--review-soft)', color: 'var(--danger-text)' }}>
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
                        Import this action once in REAPER. If Narration Utils is moved or updated, re-import this path when prompted; the app never changes
                        REAPER for you.
                      </p>
                      <code className="mt-2 block rounded p-2 text-xs break-all" style={{ background: 'var(--surface)' }}>
                        {reaperLauncher}
                      </code>
                      <Button
                        variant="ghost"
                        className="mt-2 text-xs"
                        type="button"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(reaperLauncher)
                            .then(() => notify('REAPER launcher path copied.'))
                            .catch(() => notify('Could not copy the REAPER launcher path.', 'error'))
                        }
                      >
                        Copy path
                      </Button>
                    </div>
                  )}
                </div>
              ) : category === 'Appearance' ? (
                <div className="space-y-3 text-sm">
                  <div className="font-medium">Theme</div>
                  <div style={{ color: 'var(--text-muted)' }}>Choose Light or Dark, or follow your system setting.</div>
                  <ToggleGroup
                    label="Theme"
                    className="gap-2"
                    value={themePreference}
                    onChange={(next) => setThemePreference(next as ThemePreference)}
                    options={THEME_OPTIONS}
                  />
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
                  <Button variant="danger" onClick={() => setConfirmClearProjectData(true)}>
                    Clear derived project data…
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}
                >
                  {category === 'About' && (
                    <>
                      <AboutPanel version={data.version} />
                      <UpdatesPanel key={savedUpdateChannel} formDirty={dirty} />
                    </>
                  )}
                  {category === 'TranscriptCompare' && (
                    <div className="mb-4 space-y-3 rounded-md p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
                      <div>
                        <div className="font-medium">Local Whisper models</div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          Whisper models are optional, catalog-managed local assets. Selecting a model never downloads it; downloading is confirmed when you
                          start a comparison.
                        </div>
                      </div>
                      {selectedWhisperModel && (
                        <div className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                          <div>
                            <div className="font-medium">{selectedWhisperModel.displayName}</div>
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {selectedWhisperModel.installState === 'installed'
                                ? 'Installed and verified'
                                : selectedWhisperModel.installState === 'verification_failed'
                                  ? 'Needs repair'
                                  : 'Not installed'}{' '}
                              · {Math.ceil(selectedWhisperModel.downloadSize / (1024 * 1024))} MB
                            </div>
                          </div>
                          {selectedWhisperModel.installState === 'installed' && (
                            <Button variant="ghost" className="text-xs" type="button" onClick={() => setConfirmRemoveModel(true)}>
                              Remove local model…
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {category === 'Piper' && (
                    <div className="mb-4 space-y-3 rounded-md p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
                      <div>
                        <div className="font-medium">Local TTS previews</div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          Piper voices are optional, catalog-managed local assets. Selecting a voice never downloads it; downloading is confirmed when you
                          request a preview.
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
                            <Button variant="ghost" className="text-xs" type="button" onClick={() => setConfirmRemoveVoice(true)}>
                              Remove local voice…
                            </Button>
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
                    <span className="text-xs" style={{ color: 'var(--warn-text)' }}>
                      {dirty && 'Unsaved changes'}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="ghost" type="button" disabled={!dirty} onClick={() => void discard()}>
                        Discard changes
                      </Button>
                      <Button variant="primary" type="submit" disabled={!dirty}>
                        Save
                      </Button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </TabPanel>
        </Tabs>
      </TabPanel>
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
          confirmVariant="danger"
          confirm={async () => {
            try {
              await api.clearProjectData();
              setConfirmClearProjectData(false);
              notify('Derived project data cleared.');
              await onProjectDataCleared();
            } catch (error) {
              notify(describeApiError(error), 'error');
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
          confirmVariant="danger"
          confirm={() =>
            void api
              .ttsRemove(selectedTtsVoice.id)
              .then(async () => {
                setConfirmRemoveVoice(false);
                notify('Local preview voice removed.');
                await load();
              })
              .catch((error) => notify(describeApiError(error), 'error'))
          }
          cancel={() => setConfirmRemoveVoice(false)}
        />
      )}
      {confirmRemoveModel && selectedWhisperModel && (
        <ConfirmDialog
          title="Remove local Whisper model?"
          body={`Remove ${selectedWhisperModel.displayName} from this computer? Starting a comparison with this model selected will ask to download it again.`}
          confirmLabel="Remove model"
          confirmVariant="danger"
          confirm={() =>
            void api
              .whisperRemove(selectedWhisperModel.id)
              .then(async () => {
                setConfirmRemoveModel(false);
                notify('Local Whisper model removed.');
                await load();
              })
              .catch((error) => notify(describeApiError(error), 'error'))
          }
          cancel={() => setConfirmRemoveModel(false)}
        />
      )}
    </Tabs>
  );
}
