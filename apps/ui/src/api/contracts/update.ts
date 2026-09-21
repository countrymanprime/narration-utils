/** Which releases count as an update: release candidates and stable ones (the default), or promoted releases only. */
export type UpdateChannel = 'candidates' | 'stable';

/** A release newer than the running version, as the host describes it after a check. */
export type UpdateAvailable = {
  /** Bare semver, `0.2.7`: a release candidate and its promotion name the same version. */
  version: string;
  tag: string;
  candidate: boolean;
  /** The release notes page on GitHub, built by the host from the repository and the tag. */
  notesUrl: string;
  /** The size of the download in bytes. */
  size: number;
  publishedAt: string;
  /** Whether this platform can replace itself with it; where it cannot, the narrator is told and pointed at the release. */
  replaces: boolean;
};

/** What the host knows about updates: the running version, when it last looked, and what it found. */
export type UpdateStatus = {
  version: string;
  /** A development build has no release to compare with, so it is never offered an update. */
  development: boolean;
  /** The release platform (`windows-x64`), empty where this program has no release. */
  platform: string;
  channel: UpdateChannel;
  /** When the last successful check finished (ISO 8601), empty if none did. */
  lastChecked: string;
  /** Why the last check failed, in words a narrator can read; empty when it worked. */
  failure: string;
  available: UpdateAvailable | null;
};

export interface UpdateApi {
  /** The remembered answer of the last check. It asks nobody. */
  updateStatus(): Promise<UpdateStatus>;
  /** Asks GitHub now (the Check now button). A failure is reported in `failure`, not thrown. */
  updateCheck(): Promise<UpdateStatus>;
  /** Opens the release notes of the release that was found in the browser. */
  updateOpenNotes(): Promise<void>;
  /** Calls `onStatus` when a background check found a release newer than the running version. */
  subscribeUpdate(onStatus: (status: UpdateStatus) => void): () => void;
}
