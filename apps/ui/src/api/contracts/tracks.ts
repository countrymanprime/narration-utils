export type TrackItem = {
  /** The item's own GUID (REAPER's IGUID), the identity a Link chapters stamp writes to and every LineIdentityLine row is keyed by. */
  guid: string;
  position: number;
  length: number;
  name: string;
  sourceKind: string;
  sourceFile: string;
  sourceAvailable: boolean;
  supported: boolean;
};

export type Track = {
  guid: string;
  index: number;
  name: string;
  color: string;
  muted: boolean;
  soloed: boolean;
  items: TrackItem[];
};

export type TracksProject = {
  path: string;
  tracks: Track[];
};

/** `selected` is empty when more than one .rpp file was found and none has been chosen yet. */
export type TracksDiscovery = {
  candidates: string[];
  selected: string;
};

export interface TracksApi {
  tracksDiscover(): Promise<TracksDiscovery>;
  tracksSelect(path: string): Promise<TracksDiscovery>;
  tracksList(): Promise<TracksProject>;
  /** Builds a playable URL for a resolved track item source file; synchronous, not a request. */
  mediaUrl(sourceFile: string): string;
}
