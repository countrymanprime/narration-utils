export type RecentProject = { path: string; name: string; lastOpened: string };
export type ProjectFolderSelection = { selected: boolean; path?: string };
export type ProjectSwitchResult = { switched: boolean; reason?: string };

export interface ProjectApi {
  projectRecents(): Promise<RecentProject[]>;
  selectProjectFolder(): Promise<ProjectFolderSelection>;
  switchProject(path: string, name?: string): Promise<ProjectSwitchResult>;
  // parent is the folder the new project folder is created under; an empty string defaults to the Phase 1
  // projects directory (ProjectCreateIn, PRD W9). name is the project's own folder name, always required:
  // the New Project dialog collects it, replacing the old full-path createProject(path, name?).
  createProject(parent: string, name: string): Promise<ProjectSwitchResult>;
  removeRecentProject(path: string): Promise<RecentProject[]>;
}
