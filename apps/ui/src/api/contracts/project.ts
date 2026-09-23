export type RecentProject = { path: string; name: string; lastOpened: string };
export type ProjectFolderSelection = { selected: boolean; path?: string };
export type ProjectSwitchResult = { switched: boolean; reason?: string };
/**
 * ProjectLinkDawFile's result (PRD project-workspace-and-daw-link.prd.md, Open Question W19): `selected` is false only
 * when the narrator cancelled the file dialog, in which case nothing else is set. `linked` is false when the chosen
 * file sits outside the project folder - `folderMismatch` and `message` explain why (W15: refuse rather than silently
 * re-pointing the project, since that would orphan the imported manuscript and needs W4's Lua changes first).
 */
export type DawLinkResult = { selected: boolean; linked: boolean; path?: string; folderMismatch?: boolean; message?: string };

export interface ProjectApi {
  projectRecents(): Promise<RecentProject[]>;
  selectProjectFolder(): Promise<ProjectFolderSelection>;
  switchProject(path: string, name?: string): Promise<ProjectSwitchResult>;
  // parent is the folder the new project folder is created under; an empty string defaults to the Phase 1
  // projects directory (ProjectCreateIn, PRD W9). name is the project's own folder name, always required:
  // the New Project dialog collects it, replacing the old full-path createProject(path, name?).
  createProject(parent: string, name: string): Promise<ProjectSwitchResult>;
  removeRecentProject(path: string): Promise<RecentProject[]>;
  /**
   * Opens a native "*.rpp" file dialog and links the chosen file to the current project (W19's one shared binding
   * behind the header pill, the Tracks page and Settings' DAW category).
   */
  linkDawFile(): Promise<DawLinkResult>;
}
