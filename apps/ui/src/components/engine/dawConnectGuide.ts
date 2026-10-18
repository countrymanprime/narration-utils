import type { DawKind } from '../../api/contracts/daw';

/**
 * How a narrator connects a DAW to this app, in that DAW's own words, for a page that must not word a DAW itself (the Booth's setup
 * steps). Only REAPER has a bridge to connect: the app never installs anything into REAPER (docs/architecture/daw-integration.md), so
 * the narrator loads the launcher action once and runs it, and REAPER started by this app with the launcher connects at once.
 */
export type DawConnectGuide = {
  dawName: string;
  /** The step that links the project to the DAW's project file, while none is linked. */
  link: string;
  /** The one-time step that puts the bridge into the DAW; the launcher file's path follows it when the host knows it. */
  install: string;
  /** The file `install` names, when the host did not report its path. */
  installFile: string;
  /** Said under `install`: why it may need doing again. */
  installAgain: string;
  /** The step that connects, every session. */
  run: string;
  /** The button that starts the DAW on the linked project and connects in one go, the setting it saves first, and what it does. */
  launch: { label: string; settings: Record<string, string>; note: string };
};

/** The REAPER action the launcher file becomes once it is loaded, as REAPER's action list names it. */
export const REAPER_LAUNCHER_ACTION = 'Script: NarrationStudio_Launcher.lua';

const REAPER_GUIDE: DawConnectGuide = {
  dawName: 'REAPER',
  link: 'Link this project’s REAPER project file (.rpp).',
  install: 'Once only: in REAPER, choose Actions, Show action list, then New action, Load ReaScript, and pick the launcher file',
  installFile: 'NarrationStudio_Launcher.lua, in the reaper folder beside this app',
  installAgain: 'Load it again after this app is updated: the file moves with each update.',
  run: `With the chapter’s project open in REAPER, run ${REAPER_LAUNCHER_ACTION} from the action list. This app connects and Record turns on here.`,
  launch: {
    label: 'Open in REAPER and connect',
    // REAPER runs a script it is started with, so the launcher connects this launch whether or not the action was loaded.
    settings: { auto_start_launcher: 'true' },
    note: 'With REAPER closed: opens the linked project and connects. Settings then starts the link each time this app opens REAPER.',
  },
};

/** The guide for the launch's DAW: REAPER's, also for a launch with no DAW at all, since REAPER is the one DAW this app connects to by a
 * bridge; null for a DAW with nothing to connect from here. */
export function dawConnectGuide(daw: DawKind): DawConnectGuide | null {
  return daw === 'REAPER' || daw === 'none' ? REAPER_GUIDE : null;
}
