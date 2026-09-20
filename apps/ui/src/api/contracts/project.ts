export type RecentProject = { path: string; name: string; lastOpened: string };
export type ProjectFolderSelection = { selected: boolean; path?: string };
export type ProjectSwitchResult = { switched: boolean; reason?: string };

export interface ProjectApi {
  projectRecents(): Promise<RecentProject[]>;
  selectProjectFolder(): Promise<ProjectFolderSelection>;
  switchProject(path: string, name?: string): Promise<ProjectSwitchResult>;
  createProject(path: string, name?: string): Promise<ProjectSwitchResult>;
  removeRecentProject(path: string): Promise<RecentProject[]>;
}
