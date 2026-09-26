// The mock host (mockApi.ts): REAPER actions.
import type {
  ChapterTagsPreview,
  CleanupToolsState,
  LineIdentityState,
  NarrationApi,
  PickupsMoment,
  PickupsState,
  ProjectStateState,
  RenderConfigState,
  RetakeLanesState,
} from '../../types';
import {
  WIRE_CHAPTER_TAGS_EMBED_SUCCESS,
  WIRE_CHAPTER_TAGS_PREVIEW_IDLE,
  WIRE_CHAPTER_TAGS_PREVIEW_NOT_RENDERED,
  WIRE_CHAPTER_TAGS_PREVIEW_READY,
  WIRE_CLEANUP_TOOLS_ERROR,
  WIRE_CLEANUP_TOOLS_IDLE,
  WIRE_CLEANUP_TOOLS_LAUNCHED,
  WIRE_LINE_IDENTITY_ERROR,
  WIRE_LINE_IDENTITY_IDLE,
  WIRE_LINE_IDENTITY_READ_SUCCESS,
  WIRE_LINE_IDENTITY_STAMP_CONFLICT,
  WIRE_PICKUPS_ERROR,
  WIRE_PICKUPS_EXPORT_SUCCESS,
  WIRE_PICKUPS_IDLE,
  WIRE_PICKUPS_IMPORT_SUCCESS,
  WIRE_PICKUPS_NEXT_SUCCESS,
  WIRE_PROJECT_STATE_CHECKED,
  WIRE_PROJECT_STATE_IDLE,
  WIRE_RENDER_CONFIG_ERROR,
  WIRE_RENDER_CONFIG_IDLE,
  WIRE_RENDER_CONFIG_NO_REGIONS,
  WIRE_RENDER_CONFIG_SUCCESS,
  WIRE_RETAKE_LANES_ERROR,
  WIRE_RETAKE_LANES_IDLE,
  WIRE_RETAKE_LANES_LIST,
  WIRE_RETAKE_LANES_NONE,
  WIRE_RETAKE_LANES_PICKED,
  wireClone,
} from '../mockFixtures';
import type { MockApiSeed } from './state';

/**
 * The REAPER actions the Tracks page runs, each a run with its own state and live event: line identity, pickups,
 * the chapter render, the cleanup tools, the project-state check, retake lanes and chapter tags.
 */
export function createReaperActionsMock(initial: MockApiSeed, projectFolder: () => string) {
  let lineIdentity: LineIdentityState = wireClone(
    initial.lineIdentity === 'success'
      ? WIRE_LINE_IDENTITY_READ_SUCCESS
      : initial.lineIdentity === 'conflict'
        ? WIRE_LINE_IDENTITY_STAMP_CONFLICT
        : initial.lineIdentity === 'error'
          ? WIRE_LINE_IDENTITY_ERROR
          : WIRE_LINE_IDENTITY_IDLE,
  );
  const lineIdentitySubscribers = new Set<(state: LineIdentityState) => void>();
  const publishLineIdentity = () => lineIdentitySubscribers.forEach((fn) => fn(wireClone(lineIdentity)));
  let pickups: PickupsState = wireClone(
    initial.pickups === 'import-success'
      ? WIRE_PICKUPS_IMPORT_SUCCESS
      : initial.pickups === 'next-success'
        ? WIRE_PICKUPS_NEXT_SUCCESS
        : initial.pickups === 'export-success'
          ? WIRE_PICKUPS_EXPORT_SUCCESS
          : initial.pickups === 'error'
            ? WIRE_PICKUPS_ERROR
            : WIRE_PICKUPS_IDLE,
  );
  // The pickups a real REAPER project would still have open: seeded to match whichever WIRE_PICKUPS_* fixture
  // booted above, so Next and Resolve behave consistently with what the seed already shows as remaining.
  let pickupsOpen: PickupsMoment[] =
    initial.pickups === undefined || initial.pickups === 'error'
      ? []
      : [
          { position: 9.25, tag: 'narrator', note: 'Mispronounced "labyrinthine"' },
          { position: 42, tag: '', note: 'Dog barked in the background' },
        ];
  let pickupsResolvedCount = 0;
  // The 'error' seed models a broken REAPER script (the recurring cause a real ERROR event reports), not a
  // one-off: every action keeps failing the same way until the narrator fixes REAPER and reopens, the same as
  // a real session import_pickups/next_pickup/etc. would if the script itself is what's wrong.
  const pickupsAlwaysErrors = initial.pickups === 'error';
  const pickupsSubscribers = new Set<(state: PickupsState) => void>();
  const publishPickups = () => pickupsSubscribers.forEach((fn) => fn(wireClone(pickups)));
  // Mirrors the Go service's begin(): every new run starts from a clean state (no stale next/resolved/importReport/csv
  // from a previous run), except remaining/total, which survive so the count does not flash back to zero.
  const beginPickups = (phase: PickupsState['phase'], message: string) => {
    pickups = { ...wireClone(WIRE_PICKUPS_IDLE), runId: String(Date.now()), phase, message, remaining: pickups.remaining, total: pickups.total };
  };
  // A run's settled outcome is either onSuccess (the normal path) or, when pickupsAlwaysErrors, the same
  // REAPER error every time. Every action's setTimeout callback runs this instead of writing its own success
  // state directly, so the 'error' seed stays broken across every action, not just the first.
  const settlePickups = (onSuccess: () => void) => {
    if (pickupsAlwaysErrors) {
      pickups = { ...pickups, phase: 'error', message: WIRE_PICKUPS_ERROR.message };
    } else {
      onSuccess();
    }
    publishPickups();
  };
  let renderConfig: RenderConfigState = wireClone(
    initial.renderConfig === 'success'
      ? WIRE_RENDER_CONFIG_SUCCESS
      : initial.renderConfig === 'no-regions'
        ? WIRE_RENDER_CONFIG_NO_REGIONS
        : initial.renderConfig === 'error'
          ? WIRE_RENDER_CONFIG_ERROR
          : WIRE_RENDER_CONFIG_IDLE,
  );
  // The 'no-regions' seed models a project with no chapter regions yet (Configure still succeeds - it is just
  // project-info keys - but predicts 0 files); 'error' models a broken REAPER script, sticking the same way the
  // pickups 'error' seed does.
  const renderConfigHasRegions = initial.renderConfig !== 'no-regions';
  const renderConfigAlwaysErrors = initial.renderConfig === 'error';
  const renderConfigSubscribers = new Set<(state: RenderConfigState) => void>();
  const publishRenderConfig = () => renderConfigSubscribers.forEach((fn) => fn(wireClone(renderConfig)));
  let cleanupTools: CleanupToolsState = wireClone(
    initial.cleanupTools === 'launched' ? WIRE_CLEANUP_TOOLS_LAUNCHED : initial.cleanupTools === 'error' ? WIRE_CLEANUP_TOOLS_ERROR : WIRE_CLEANUP_TOOLS_IDLE,
  );
  const cleanupToolsAlwaysErrors = initial.cleanupTools === 'error';
  const cleanupToolsSubscribers = new Set<(state: CleanupToolsState) => void>();
  const publishCleanupTools = () => cleanupToolsSubscribers.forEach((fn) => fn(wireClone(cleanupTools)));
  let projectState: ProjectStateState = wireClone(WIRE_PROJECT_STATE_IDLE);
  const projectStateSubscribers = new Set<(state: ProjectStateState) => void>();
  const publishProjectState = () => projectStateSubscribers.forEach((fn) => fn(wireClone(projectState)));
  const retakeLanesList = wireClone(initial.retakeLanes === 'none' ? WIRE_RETAKE_LANES_NONE : WIRE_RETAKE_LANES_LIST);
  let retakeLanes: RetakeLanesState = wireClone(
    initial.retakeLanes === 'picked' ? WIRE_RETAKE_LANES_PICKED : initial.retakeLanes === 'error' ? WIRE_RETAKE_LANES_ERROR : WIRE_RETAKE_LANES_IDLE,
  );
  const retakeLanesAlwaysErrors = initial.retakeLanes === 'error';
  const retakeLanesSubscribers = new Set<(state: RetakeLanesState) => void>();
  const publishRetakeLanes = () => retakeLanesSubscribers.forEach((fn) => fn(wireClone(retakeLanes)));
  // Chapter tag embedding (Phase 12) never talks to REAPER: its preview is a fixed seed, not derived from
  // renderConfig's live state, since the two are independent bindings on the real host too (ChapterTagsPreview
  // reads renderConfig.Snapshot() itself, server-side).
  const chapterTagsPreview: ChapterTagsPreview = wireClone(
    initial.chapterTags === 'ready'
      ? WIRE_CHAPTER_TAGS_PREVIEW_READY
      : initial.chapterTags === 'not-rendered'
        ? WIRE_CHAPTER_TAGS_PREVIEW_NOT_RENDERED
        : WIRE_CHAPTER_TAGS_PREVIEW_IDLE,
  );
  const chapterTagsEmbedAlwaysErrors = initial.chapterTagsEmbedAlwaysErrors === true;
  const bindings = {
    lineIdentityStamp: async (rows, overwrite) => {
      if (rows.length === 0) throw new Error('select at least one item to stamp');
      lineIdentity = {
        ...wireClone(WIRE_LINE_IDENTITY_IDLE),
        runId: String(Date.now()),
        phase: 'stamping',
        message: 'Stamping manuscript line identity in REAPER…',
      };
      publishLineIdentity();
      setTimeout(() => {
        if (lineIdentity.phase !== 'stamping') return;
        const applied = rows.length;
        lineIdentity = {
          ...lineIdentity,
          phase: 'success',
          message: `Stamped ${applied} line${applied === 1 ? '' : 's'}.`,
          stamp: { applied, unchanged: 0, missingCount: 0, conflictsCount: 0, missing: [], conflicts: [] },
        };
        publishLineIdentity();
      }, 300);
      void overwrite; // the mock never simulates a real conflict from a second stamp; WIRE_LINE_IDENTITY_STAMP_CONFLICT covers that state directly (initial.lineIdentity)
      return { status: 'started' };
    },
    lineIdentityRead: async () => {
      lineIdentity = {
        ...wireClone(WIRE_LINE_IDENTITY_IDLE),
        runId: String(Date.now()),
        phase: 'reading',
        message: 'Reading manuscript line identity from REAPER…',
      };
      publishLineIdentity();
      setTimeout(() => {
        if (lineIdentity.phase !== 'reading') return;
        lineIdentity = { ...wireClone(WIRE_LINE_IDENTITY_READ_SUCCESS), runId: lineIdentity.runId };
        publishLineIdentity();
      }, 300);
      return { status: 'started' };
    },
    lineIdentityState: async () => wireClone(lineIdentity),
    subscribeLineIdentity: (onUpdate) => {
      lineIdentitySubscribers.add(onUpdate);
      onUpdate(wireClone(lineIdentity));
      return () => lineIdentitySubscribers.delete(onUpdate);
    },
    pickupsImport: async (csvText) => {
      const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const dataLines = lines.length > 0 && lines[0].toLowerCase().startsWith('start') ? lines.slice(1) : lines;
      const rowErrors: string[] = [];
      const added: PickupsMoment[] = [];
      dataLines.forEach((line, index) => {
        const [startRaw, note, tag] = line.split(',');
        const position = Number(startRaw);
        if (!Number.isFinite(position) || position < 0 || !note) {
          rowErrors.push(`line ${index + 1}: could not parse this row`);
          return;
        }
        added.push({ position, note: note.trim(), tag: (tag ?? '').trim() });
      });
      if (added.length === 0) throw new Error(`no valid pickups were found in the file${rowErrors[0] ? `: ${rowErrors[0]}` : ''}`);
      pickupsOpen = [...pickupsOpen, ...added];
      beginPickups('importing', 'Importing pickups into REAPER…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'importing') return;
        settlePickups(() => {
          pickups = {
            ...pickups,
            phase: 'success',
            message: `Imported ${added.length} pickup${added.length === 1 ? '' : 's'}.`,
            importReport: { added: added.length, existing: 0, invalid: 0 },
            remaining: pickupsOpen.length,
            total: pickupsOpen.length + pickupsResolvedCount,
          };
        });
      }, 300);
      return { status: 'started', rowErrors };
    },
    pickupsExport: async () => {
      beginPickups('exporting', 'Exporting pickups from REAPER…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'exporting') return;
        settlePickups(() => {
          const rows = pickupsOpen.map((row) => `${row.position.toFixed(6)},${row.note},${row.tag}`);
          const csv = ['start,note,tag', ...rows].join('\n') + (rows.length > 0 ? '\n' : '');
          pickups = {
            ...pickups,
            phase: 'success',
            message: `Exported ${pickupsOpen.length} pickup${pickupsOpen.length === 1 ? '' : 's'}.`,
            csv,
            remaining: pickupsOpen.length,
            total: pickupsOpen.length + pickupsResolvedCount,
          };
        });
      }, 300);
      return { status: 'started' };
    },
    pickupsNext: async () => {
      beginPickups('jumping', 'Jumping to the next pickup…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'jumping') return;
        settlePickups(() => {
          if (pickupsOpen.length === 0) {
            pickups = { ...pickups, phase: 'error', message: 'No pickups remain.' };
          } else {
            pickups = { ...pickups, phase: 'success', message: 'Jumped to the next pickup.', next: pickupsOpen[0] };
          }
        });
      }, 300);
      return { status: 'started' };
    },
    pickupsResolve: async (position) => {
      beginPickups('resolving', 'Resolving this pickup…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'resolving') return;
        settlePickups(() => {
          const index = pickupsOpen.findIndex((row) => Math.abs(row.position - position) <= 0.15);
          if (index < 0) {
            pickups = { ...pickups, phase: 'error', message: 'No open pickup was found at that position.' };
          } else {
            const resolved = pickupsOpen[index];
            pickupsOpen = pickupsOpen.filter((_, candidateIndex) => candidateIndex !== index);
            pickupsResolvedCount += 1;
            pickups = {
              ...pickups,
              phase: 'success',
              message: 'Marked this pickup done.',
              resolved,
              remaining: pickupsOpen.length,
              total: pickupsOpen.length + pickupsResolvedCount,
            };
          }
        });
      }, 300);
      return { status: 'started' };
    },
    pickupsCount: async () => {
      beginPickups('counting', 'Counting pickups…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'counting') return;
        settlePickups(() => {
          const remaining = pickupsOpen.length;
          const total = remaining + pickupsResolvedCount;
          pickups = { ...pickups, phase: 'success', message: `${remaining} pickup${remaining === 1 ? '' : 's'} remaining of ${total}.`, remaining, total };
        });
      }, 300);
      return { status: 'started' };
    },
    pickupsState: async () => wireClone(pickups),
    subscribePickups: (onUpdate) => {
      pickupsSubscribers.add(onUpdate);
      onUpdate(wireClone(pickups));
      return () => pickupsSubscribers.delete(onUpdate);
    },
    renderConfigConfigure: async (outputFolder) => {
      const folder = outputFolder.trim();
      if (!folder) throw new Error('an output folder is required');
      renderConfig = { ...wireClone(WIRE_RENDER_CONFIG_IDLE), runId: String(Date.now()), phase: 'configuring', message: 'Configuring the chapter render…' };
      publishRenderConfig();
      setTimeout(() => {
        if (renderConfig.phase !== 'configuring') return;
        if (renderConfigAlwaysErrors) {
          renderConfig = { ...renderConfig, phase: 'error', message: WIRE_RENDER_CONFIG_ERROR.message };
        } else if (renderConfigHasRegions) {
          const targets = [`${folder}\\Chapter 1.wav`, `${folder}\\Chapter 2.wav`];
          renderConfig = {
            ...renderConfig,
            phase: 'success',
            folder,
            targets,
            count: targets.length,
            message: `Render configured for ${targets.length} chapter files. Press Render in REAPER to create them.`,
          };
        } else {
          renderConfig = {
            ...renderConfig,
            phase: 'success',
            folder,
            targets: [],
            count: 0,
            message: 'Render configured. No chapter regions were found yet: create them before rendering.',
          };
        }
        publishRenderConfig();
      }, 300);
      return { status: 'started' };
    },
    renderConfigSuggestFolder: async () => ({ folder: `${projectFolder()}\\renders` }),
    renderConfigState: async () => wireClone(renderConfig),
    subscribeRenderConfig: (onUpdate) => {
      renderConfigSubscribers.add(onUpdate);
      onUpdate(wireClone(renderConfig));
      return () => renderConfigSubscribers.delete(onUpdate);
    },
    cleanupToolsLaunch: async (tool) => {
      const labels: Record<string, string> = { repair_pops_clicks: 'Repair Pops/Clicks', magnolius_declick: 'Magnolius DeClick' };
      const label = labels[tool];
      if (!label) throw new Error(`unknown cleanup tool "${tool}"`);
      cleanupTools = { ...wireClone(WIRE_CLEANUP_TOOLS_IDLE), runId: String(Date.now()), phase: 'launching', tool, message: `Opening ${label} in REAPER…` };
      publishCleanupTools();
      setTimeout(() => {
        if (cleanupTools.phase !== 'launching') return;
        cleanupTools = cleanupToolsAlwaysErrors
          ? { ...cleanupTools, phase: 'error', message: WIRE_CLEANUP_TOOLS_ERROR.message }
          : {
              ...cleanupTools,
              phase: 'launched',
              action: tool === 'repair_pops_clicks' ? WIRE_CLEANUP_TOOLS_LAUNCHED.action : 'Script: Magnolius_DeClick.lua',
              message: `${label} is open in REAPER. Nothing has changed yet: the repair happens only when you apply it there.`,
            };
        publishCleanupTools();
      }, 300);
      return { status: 'started' };
    },
    cleanupToolsState: async () => wireClone(cleanupTools),
    subscribeCleanupTools: (onUpdate) => {
      cleanupToolsSubscribers.add(onUpdate);
      onUpdate(wireClone(cleanupTools));
      return () => cleanupToolsSubscribers.delete(onUpdate);
    },
    projectStateCheck: async () => {
      if (initial.projectState === 'error') throw new Error('the REAPER bridge is unavailable');
      projectState = { ...wireClone(WIRE_PROJECT_STATE_IDLE), runId: String(Date.now()), phase: 'checking', message: "Checking REAPER's project state…" };
      publishProjectState();
      setTimeout(() => {
        if (projectState.phase !== 'checking') return;
        const changeCount = initial.projectState === 'unchanged' ? 41 : (WIRE_PROJECT_STATE_CHECKED.changeCount ?? 42);
        projectState = { ...wireClone(WIRE_PROJECT_STATE_CHECKED), runId: projectState.runId, changeCount };
        publishProjectState();
      }, 150);
      return { status: 'started' as const };
    },
    projectStateChangedSince: async (current, baseline) => ({ changed: current !== baseline }),
    projectStateState: async () => wireClone(projectState),
    subscribeProjectState: (onUpdate) => {
      projectStateSubscribers.add(onUpdate);
      onUpdate(wireClone(projectState));
      return () => projectStateSubscribers.delete(onUpdate);
    },
    retakeLanesList: async () => wireClone(retakeLanesList),
    retakeLanesPick: async (lineId, itemGuid) => {
      const line = retakeLanesList.lines.find((candidate) => candidate.lineId === lineId);
      const retake = line?.retakes.find((candidate) => candidate.itemGuid === itemGuid);
      if (!line || !retake)
        throw new Error('that retake is not on a fixed-lane track in the saved project; save the project in REAPER and open the list again');
      retakeLanes = {
        ...wireClone(WIRE_RETAKE_LANES_IDLE),
        runId: String(Date.now()),
        phase: 'picking',
        lineId,
        itemGuid,
        trackName: line.trackName,
        message: `Asking REAPER to play this retake on ${line.trackName}…`,
      };
      publishRetakeLanes();
      setTimeout(() => {
        if (retakeLanes.phase !== 'picking') return;
        retakeLanes = retakeLanesAlwaysErrors
          ? { ...retakeLanes, phase: 'error', message: WIRE_RETAKE_LANES_ERROR.message }
          : {
              ...retakeLanes,
              phase: 'picked',
              lane: retake.lane,
              message: `Lane ${retake.lane + 1} is now the only lane playing on ${line.trackName}. To go back, use Undo in REAPER: it restores what played before.`,
            };
        publishRetakeLanes();
      }, 300);
      return { status: 'started' };
    },
    retakeLanesState: async () => wireClone(retakeLanes),
    subscribeRetakeLanes: (onUpdate) => {
      retakeLanesSubscribers.add(onUpdate);
      onUpdate(wireClone(retakeLanes));
      return () => retakeLanesSubscribers.delete(onUpdate);
    },
    chapterTagsPreview: async () => wireClone(chapterTagsPreview),
    chapterTagsEmbed: async (destPath) => {
      if (!destPath.trim()) throw new Error('choose the MP3 file to add chapters to');
      if (chapterTagsEmbedAlwaysErrors) throw new Error('could not write chapter tags to the new copy');
      return wireClone(WIRE_CHAPTER_TAGS_EMBED_SUCCESS);
    },
  } satisfies Partial<NarrationApi>;
  return { bindings };
}
