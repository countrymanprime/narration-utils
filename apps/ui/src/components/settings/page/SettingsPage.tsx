import { useEffect, type ReactNode } from 'react';
import type { Bootstrap, ScopedSettingField } from '../../../types';
import { LocalAssets } from '../../assets/LocalAssets';
import { Heading } from '../../primitives/Heading';
import { Panel } from '../../primitives/Panel';
import type { Notify } from '../../primitives/Toast';
import { AboutPanel } from '../AboutPanel';
import { AnalysisToolsSection } from '../analysis/AnalysisToolsSection';
import { BackupsSection } from '../BackupsSection';
import { CapabilitySection } from '../CapabilitySection';
import { CreditsPanel } from '../CreditsPanel';
import { DeliveryProfilesPanel } from '../DeliveryProfilesPanel';
import { KeyboardPanel } from '../KeyboardPanel';
import { ManuscriptSection } from '../ManuscriptSection';
import { OnlineDictionaryPanel } from '../OnlineDictionaryPanel';
import { RecordingCheckSummary } from '../RecordingCheckSummary';
import { registerSettingsSection } from '../sections';
import { UpdatesPanel } from '../UpdatesPanel';
import { AppearancePanel } from './AppearancePanel';
import { BoothPanel } from './BoothPanel';
import { DawPanel } from './DawPanel';
import { DefinitionsPanel } from './DefinitionsPanel';
import { DeliveryProfileField } from './DeliveryProfileField';
import { KeysPanel } from './KeysPanel';
import { LocalModelCard } from './LocalModelCard';
import { MarksPanel } from './MarksPanel';
import { ProjectDataPanel } from './ProjectDataPanel';
import { ReaderTextPanel } from './ReaderTextPanel';
import { RecordingPanel } from './RecordingPanel';
import { ScopedFieldsPanel } from './ScopedFieldsPanel';
import { SettingsFormsProvider, useScopedFields } from './settingsForms';
import { StoryBibleTypesPanel } from './StoryBibleTypesPanel';

// The DAW Integration panel draws the sections registered for `Daw`, in order.
registerSettingsSection('Daw', 'capabilities', CapabilitySection, 10);
registerSettingsSection('Daw', 'backups', BackupsSection, 20);

// The analysis prompt is the Story Bible analysis panel's checkbox, so the Story Bible fields leave it out.
const notAnalysisPrompt = (field: ScopedSettingField) => field.key !== 'analysis_prompt';

/** A deep link's category (App.tsx's `SETTINGS_ANCHORS`) to the panel it scrolls to (`settings-<id>`). */
const PANEL_FOR_CATEGORY: Record<string, string> = {
  Recording: 'recording',
  Credits: 'credits',
  Delivery: 'delivery',
  Cleanup: 'cleanup',
  Teleprompter: 'booth',
  Daw: 'daw',
  ManuscriptGuide: 'storybible',
  Manuscript: 'manuscript',
};

export type SettingsPageProps = {
  data: Bootstrap;
  notify: Notify;
  onDirtyChange: (dirty: boolean) => void;
  registerActions: (actions: { save: () => Promise<void>; discard: () => Promise<void> }) => void;
  onProjectDataCleared: () => Promise<void>;
  /** The shared "link a REAPER project file" action. */
  onLinkDawFile: () => void;
  /** Navigates the app (the Manuscript panel: the import flow's credits prompt links to Settings > Credits). */
  go: (page: string) => void;
  /** Re-reads the shared application state after an import commits (the Manuscript panel). */
  refreshBootstrap: () => Promise<void>;
  /** The panel a deep link opens on (`#credits`, `#delivery`, `#cleanup`, `#booth`, `#recording`): the page scrolls to it. */
  initialCategory?: string;
};

/** Settings > Keyboard & pedals: the remapping list, over the Global `Keymap.overrides` it saves. */
function KeyboardPedalsPanel({ notify }: { notify: Notify }) {
  const { fields, reload } = useScopedFields('Keymap', 'global');
  return (
    <div id="settings-keyboard" className="scroll-mt-4">
      <Panel title="Keyboard & pedals">
        <KeyboardPanel overridesField={fields?.find((field) => field.key === 'overrides')} notify={notify} reload={reload} />
      </Panel>
    </div>
  );
}

/** A kept panel with no generic fields: its body is the old category's own component. */
function KeptPanel({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div id={`settings-${id}`} className="scroll-mt-4">
      <Panel title={title} subtitle={subtitle}>
        {children}
      </Panel>
    </div>
  );
}

/**
 * The Settings page, at `/settings`: one 860 px column under one heading. First the Studio Next mock's panels, in its
 * order (Recording, Delivery profile, Definitions and pronunciations, Reader text, Marks, Story Bible types, Story Bible
 * analysis, Appearance, Keyboard shortcuts, Manuscript); then, as panels of the same column, the settings the mock
 * has no panel for, kept as built. A panel over Global and This project switches scope in its own header, and its
 * edits join the page's one dirty flag and leave guard (`SettingsFormsProvider`). `initialCategory` scrolls to its panel.
 */
export function SettingsPage({
  data,
  notify,
  onDirtyChange,
  registerActions,
  onProjectDataCleared,
  onLinkDawFile,
  go,
  refreshBootstrap,
  initialCategory,
}: SettingsPageProps) {
  useEffect(() => {
    const panel = initialCategory && PANEL_FOR_CATEGORY[initialCategory];
    if (panel) document.getElementById(`settings-${panel}`)?.scrollIntoView?.({ block: 'start' });
  }, [initialCategory]);

  return (
    <SettingsFormsProvider notify={notify} onDirtyChange={onDirtyChange} registerActions={registerActions}>
      <div className="flex max-w-[860px] flex-col gap-4">
        <Heading title="Settings" />
        <div id="settings-recording" className="scroll-mt-4">
          <RecordingPanel dawFileLinked={data.dawFileLinked} onLinkDawFile={onLinkDawFile} notify={notify} />
        </div>
        <DeliveryProfileField />
        <DefinitionsPanel />
        <ReaderTextPanel />
        <MarksPanel />
        <StoryBibleTypesPanel />
        <AnalysisToolsSection />
        <AppearancePanel />
        <KeysPanel />
        <div id="settings-manuscript" className="scroll-mt-4">
          <ManuscriptSection data={data} go={go} notify={notify} refreshBootstrap={refreshBootstrap} />
        </div>

        <ScopedFieldsPanel id="general" title="General" tool="General" scopes={['global']} notify={notify} />
        <KeyboardPedalsPanel notify={notify} />
        <ScopedFieldsPanel id="note-colour" title="Note colour" tool="Manuscript" scopes={['global', 'project']} notify={notify} />
        {/* The recording check's thresholds and alignment (docs/utilities/recording-coverage.md), Proposed and uncalibrated. */}
        <ScopedFieldsPanel
          id="recording-check"
          title="Recording check"
          tool="RecordingCoverage"
          scopes={['global', 'project']}
          notify={notify}
          before={({ fields, scope }) => <RecordingCheckSummary fields={fields} scope={scope} />}
        />
        {/* The silence cleanup analyzer's own thresholds (apps/desktop/internal/measure/cleanup.go). */}
        <ScopedFieldsPanel id="cleanup" title="Silence cleanup" tool="Cleanup" scopes={['global', 'project']} notify={notify} />
        <ScopedFieldsPanel
          id="proof"
          title="Proof"
          tool="TranscriptCompare"
          scopes={['global', 'project']}
          notify={notify}
          before={({ fields }) => <LocalModelCard kind="model" fields={fields} notify={notify} />}
        />
        {/* The preview suggestion's target, tolerance, preset and ending exclusion (docs/architecture/preview-suggestion.md). */}
        <ScopedFieldsPanel id="preview" title="Preview suggestion" tool="Preview" scopes={['global', 'project']} notify={notify} />
        {/* Which signals must be met for a stage suggestion (docs/architecture/stage-recommendations.md). */}
        <ScopedFieldsPanel id="stage-suggestions" title="Stage suggestions" tool="StageRecommendations" scopes={['global', 'project']} notify={notify} />
        <ScopedFieldsPanel
          id="storybible"
          title="Story Bible"
          tool="ManuscriptGuide"
          scopes={['global', 'project']}
          filter={notAnalysisPrompt}
          notify={notify}
          // The narrator's own Merriam-Webster key is theirs, not a project's, so it is set in Global only.
          before={({ scope }) => scope === 'global' && <OnlineDictionaryPanel notify={notify} />}
        />
        {/* The Global default profile and the custom profiles; the project's own choice is the Delivery profile panel. */}
        <KeptPanel id="delivery" title="Delivery profiles">
          <DeliveryProfilesPanel notify={notify} />
        </KeptPanel>
        <DawPanel data={data} notify={notify} onLinkDawFile={onLinkDawFile} />
        <ScopedFieldsPanel
          id="tts"
          title="TTS"
          tool="Piper"
          scopes={['global', 'project']}
          notify={notify}
          before={({ fields }) => <LocalModelCard kind="voice" fields={fields} notify={notify} />}
        />
        {/* The Booth's microphone, engine and model: the key stays the settings tool's name. */}
        <BoothPanel notify={notify} />
        <KeptPanel id="local-assets" title="Local assets">
          <LocalAssets notify={notify} />
        </KeptPanel>
        <ProjectDataPanel notify={notify} onProjectDataCleared={onProjectDataCleared} />
        {/* Credit values are per project; the global narrator default lives in General. */}
        <KeptPanel id="credits" title="Credits" subtitle="This project">
          <CreditsPanel notify={notify} />
        </KeptPanel>
        <ScopedFieldsPanel
          id="about"
          title="About & updates"
          tool="Updates"
          scopes={['global']}
          notify={notify}
          before={({ fields, dirty }) => (
            <>
              <AboutPanel version={data.version} />
              {/* The update panel asks the host what is available on the saved channel, so it starts over when that changes. */}
              <UpdatesPanel key={fields.find((field) => field.key === 'channel')?.effectiveValue ?? ''} formDirty={dirty} />
            </>
          )}
        />
      </div>
    </SettingsFormsProvider>
  );
}
