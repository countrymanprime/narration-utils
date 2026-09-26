// The mock host (mockApi.ts): projects and the DAW link.
import type { DawCatalogEntry, NarrationApi, ProjectAttachState, RecentProject } from '../../types';
import { wireClone } from '../mockFixtures';
import type { MockApiSeed } from './state';

const DEFAULT_PROJECT_FOLDER = 'C:/Projects/Alice-in-Wonderland';
const DEFAULT_PROJECT_NAME = 'Alice’s Adventures in Wonderland';
// Mirrors the Go host's Phase 1 default (`~/NarrationUtils`, project.DefaultDirName): what an empty parent
// resolves to in ProjectCreateIn.
const DEFAULT_PROJECTS_DIRECTORY = 'C:/Users/Mock/NarrationUtils';

/** Mirrors the Go backend's `filepath.Base(path)` default-naming rule for a folder chosen with no explicit name. */
function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** The project bindings: the open project, the recent list, the linked DAW project file and the DAW catalog. */
export function createProjectMock(initial: MockApiSeed) {
  let projectFolder = initial.projectFolder ?? DEFAULT_PROJECT_FOLDER;
  let projectName = initial.projectFolder === undefined ? DEFAULT_PROJECT_NAME : basename(projectFolder);
  let daw = 'REAPER';
  // Whether the mock project has a linked DAW project file (PRD W13/W14/W19), independent of `daw`: real Bootstrap
  // computes this from the manifest, not the label. Defaults to true so the existing default-linked mock scenarios
  // (App.test.tsx clicking into Proofing) keep working; attaching a different project resets it, like a fresh
  // project would have no link yet.
  let dawFileLinked = initial.dawFileLinked ?? true;
  let dawRppPath = `${projectFolder}/${basename(projectFolder)}.rpp`;
  // Independent of dawFileLinked/dawReachable: a Phase 1 detection fact about the machine, not about this
  // project's link (docs/architecture/daw-integration.md). Defaults to true so the default capture shows
  // REAPER detected; ?mockDawNotDetected=1 flips it for the not-detected + "Get REAPER" state.
  const dawCatalogInstalled = initial.dawCatalogInstalled ?? true;
  const DAW_CATALOG: DawCatalogEntry[] = [
    {
      id: 'reaper',
      name: 'REAPER',
      publisher: 'Cockos Incorporated',
      licenseNote: "A fully-functional evaluation license from the publisher's own site; see their page for terms.",
      installed: dawCatalogInstalled,
      ...(dawCatalogInstalled ? { path: 'C:/Program Files/REAPER (x64)/reaper.exe', source: 'uninstall_registry' } : {}),
    },
  ];
  let recentProjects: RecentProject[] = [
    { path: 'C:/Projects/Alice-in-Wonderland', name: 'Alice’s Adventures in Wonderland', lastOpened: '2026-09-15T09:00:00Z' },
    { path: 'C:/Projects/Voltage-and-the-Undercroft', name: 'Voltage and the Undercroft', lastOpened: '2026-09-10T18:30:00Z' },
  ];
  const projectAttachSubscribers = new Set<(state: ProjectAttachState) => void>();
  const attachProject = (path: string, name?: string) => {
    projectFolder = path;
    projectName = name || basename(path);
    daw = 'Standalone';
    // A newly attached project has no stored DAW link yet, matching the real host: dawFileLinked is computed from
    // the new project's own manifest, not carried over from whatever was open before.
    dawFileLinked = false;
    dawRppPath = `${projectFolder}/${projectName}.rpp`;
    projectAttachSubscribers.forEach((fn) => fn({ attached: true }));
    return { switched: true };
  };
  const bindings = {
    subscribeProjectAttach: (onUpdate) => {
      projectAttachSubscribers.add(onUpdate);
      return () => projectAttachSubscribers.delete(onUpdate);
    },
    projectRecents: async () => wireClone(recentProjects),
    selectProjectFolder: async () => ({ selected: true, path: 'C:/Projects/Mock-Project' }),
    switchProject: async (path, name) => attachProject(path, name),
    createProject: async (parent, name) => attachProject(`${parent || DEFAULT_PROJECTS_DIRECTORY}/${name}`, name),
    removeRecentProject: async (path) => {
      recentProjects = recentProjects.filter((entry) => entry.path.toLowerCase() !== path.toLowerCase());
      return wireClone(recentProjects);
    },
    linkDawFile: async () => {
      if (initial.dawLinkMismatch) {
        const elsewhere = 'C:/Projects/Elsewhere/Elsewhere.rpp';
        return {
          selected: true,
          linked: false,
          path: elsewhere,
          folderMismatch: true,
          message: `Elsewhere.rpp is outside this project's folder (${projectFolder}). Choose a REAPER project file saved inside the project, or open that project instead.`,
        };
      }
      dawFileLinked = true;
      return { selected: true, linked: true, path: dawRppPath };
    },
    // The mock never grows a real heartbeat (dawReachable stays whatever Bootstrap already reports, ADR 0092
    // Phase 7 is Go/Lua only): this just answers as if REAPER accepted the launch.
    launchDaw: async () => ({ launched: true, path: 'C:/Program Files/REAPER (x64)/reaper.exe', source: 'uninstall_registry' }),
    dawCatalogList: async () => wireClone(DAW_CATALOG),
    dawCatalogOpenDownloadPage: async (id) => {
      if (!DAW_CATALOG.some((entry) => entry.id === id)) throw new Error(`Unknown DAW catalog entry "${id}"`);
      // The mock has no real browser to open; it only proves the call reached a known id (Vitest's "no navigation
      // without a click" success metric is exercised at the component level, not here).
    },
  } satisfies Partial<NarrationApi>;
  return {
    bindings,
    projectFolder: () => projectFolder,
    projectName: () => projectName,
    daw: () => daw,
    dawFileLinked: () => dawFileLinked,
  };
}

export type ProjectMock = ReturnType<typeof createProjectMock>;
