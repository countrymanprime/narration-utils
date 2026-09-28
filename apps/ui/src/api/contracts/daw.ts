// The DAW port's capability payload (DAW port PRD Phase 4, ADR 0300): what the launch's DAW can do right now, computed by
// the host's dawport.Resolver from the adapter's declaration, the bridge's reachability and the narrator's
// DAW.capability.<name> settings. apps/desktop/bindings_daw.go is the binding and the daw_capabilities_changed event;
// apps/desktop/internal/dawport/capability.go is the capability catalog this file's DAW_CAPABILITIES mirrors.

/** Which DAW the launch is talking to, or 'none' for a standalone launch (dawport.Kind.String() in Go). */
export type DawKind = 'REAPER' | 'Audacity' | 'none';

/** How far the launch's DAW supports a capability (port.Level.String() in Go). */
export type DawCapabilityLevel = 'unsupported' | 'not_yet_available' | 'experimental' | 'supported';

/** Why a capability is unavailable now (port.Reason in Go); absent when it is available. */
export type DawCapabilityReason = 'standalone' | 'not_running' | 'experimental_off' | 'failed' | 'turned_off' | 'not_yet' | 'unsupported';

/** One capability's answer. `reason` and `message` are set only when `available` is false; `message` is a whole sentence
 * for the narrator, worded by the resolver or the adapter (dawport.Explainer), never by the UI. */
export type DawCapabilitySupport = {
  level: DawCapabilityLevel;
  available: boolean;
  reason?: DawCapabilityReason;
  message?: string;
};

/** The DAW port's capability names (dawport.Capability in Go). New ones may appear later (a new adapter capability);
 * this union is the ones this build knows, not a closed wire contract - `DawCapabilities['capabilities']` is a plain
 * string-keyed record for that reason. */
export type DawCapabilityKey =
  | 'review'
  | 'navigate'
  | 'markers'
  | 'pickups'
  | 'line_identity'
  | 'render_config'
  | 'cleanup_tools'
  | 'retake_lanes'
  | 'project_state'
  | 'take_create'
  | 'heartbeat'
  | 'project_read'
  | 'track_state'
  | 'track_select'
  | 'record'
  | 'punch'
  | 'regions'
  | 'takes'
  | 'fx_chains'
  | 'silence_trim'
  | 'item_gain'
  | 'render_with_fx'
  | 'master_chain_read'
  | 'macro_render';

export type DawCapabilities = {
  daw: DawKind;
  /** Whether the DAW is answering now (the heartbeat), not per capability: a capability may still be unavailable for
   * another reason (turned off, experimental, not yet available) even while this is true. */
  reachable: boolean;
  capabilities: Record<string, DawCapabilitySupport>;
};

/** The capability catalog, in the order Settings lists them and the resolver's All() does (dawport.Capabilities() in
 * Go). The Settings mock fixture (mockFixtures.ts) and the DAW mock (dawMock.ts) both read this, so neither drifts
 * from the port's names or labels. */
export const DAW_CAPABILITIES: ReadonlyArray<{ key: DawCapabilityKey; label: string }> = [
  { key: 'review', label: 'Compare the recording with the manuscript' },
  { key: 'navigate', label: 'Go to and loop findings' },
  { key: 'markers', label: 'Add markers' },
  { key: 'pickups', label: 'Pickup list' },
  { key: 'line_identity', label: 'Line identity' },
  { key: 'render_config', label: 'Chapter render setup' },
  { key: 'cleanup_tools', label: 'Cleanup tools' },
  { key: 'retake_lanes', label: 'Retake lanes' },
  { key: 'project_state', label: 'Project change check' },
  { key: 'take_create', label: 'Create takes' },
  { key: 'heartbeat', label: 'Connection status' },
  { key: 'project_read', label: 'Read the saved project' },
  { key: 'track_state', label: 'Read track arm state' },
  { key: 'track_select', label: 'Select a track in REAPER' },
  { key: 'record', label: 'Record' },
  { key: 'punch', label: 'Punch and roll' },
  { key: 'regions', label: 'Chapter regions' },
  { key: 'takes', label: 'Choose the active take' },
  { key: 'fx_chains', label: 'FX chains' },
  { key: 'silence_trim', label: 'Silence trim' },
  { key: 'item_gain', label: 'Level matching' },
  { key: 'render_with_fx', label: "Mastering with the project's FX" },
  { key: 'master_chain_read', label: 'Master and track FX listing' },
  { key: 'macro_render', label: 'Mastering with an effect macro' },
];

/** The DAW's transport as of its last heartbeat (daw_transport_changed, DAW port PRD Phase 9, ADR 0305;
 * apps/desktop/bindings_daw_transport.go). `recording` counts a paused recording too; `playing` is REAPER's play bit, so it
 * is also true while recording. `position` (project seconds, moving on about every 1.5 s) is sent only while playing or
 * recording. With no DAW, a DAW not answering, or a bridge script too old to report it, both are false. */
export type DawTransport = {
  playing: boolean;
  recording: boolean;
  position?: number;
};

export interface DawCapabilitiesApi {
  dawCapabilities(): Promise<DawCapabilities>;
  subscribeDawCapabilities(onUpdate: (state: DawCapabilities) => void): () => void;
  /** Pushed only: there is no request for it. The host pushes the current transport on its first tick after launch and
   * then only on a change, so a subscriber that joins later hears nothing until the next change. */
  subscribeDawTransport(onUpdate: (state: DawTransport) => void): () => void;
}
