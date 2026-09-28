// The mock's DAW port capabilities (DAW port PRD Phase 4): a stand-in for the host's dawport.Resolver, over the same
// three inputs (a declaration per DAW kind, the narrator's per-capability toggles, and reachability) and the same
// refusal order (declaration, then toggle, then runtime) as apps/desktop/internal/dawport/resolver.go. It has no
// action of its own to trigger a live update from - it always answers the seeded picture - so subscribeDawCapabilities
// only emits once, on subscribe, like every other subscribe-based mock that has nothing pending.
import type { DawCapabilities, DawCapabilityKey, DawCapabilityLevel, DawCapabilitySupport, DawCapabilitiesApi, DawKind, DawTransport } from './contracts/daw';
import { DAW_CAPABILITIES } from './contracts/daw';
import { wireClone } from './mockFixtures';

/** Mirrors dawport.Needs (capability.go): what a capability needs from the running engine before it can be used. */
type DawMockNeeds = 'running' | 'bridge' | 'nothing';

/** REAPER's declaration (apps/desktop/internal/dawport/reaper/reaper.go's `declares`): today's behaviour exactly. */
const REAPER_DECLARATION: Record<DawCapabilityKey, DawCapabilityLevel> = {
  review: 'supported',
  navigate: 'supported',
  markers: 'supported',
  pickups: 'supported',
  line_identity: 'supported',
  render_config: 'supported',
  cleanup_tools: 'supported',
  retake_lanes: 'supported',
  project_state: 'supported',
  take_create: 'supported',
  heartbeat: 'supported',
  project_read: 'supported',
  track_state: 'experimental',
  track_select: 'experimental',
  record: 'experimental',
  punch: 'experimental',
  regions: 'experimental',
  takes: 'experimental',
  fx_chains: 'experimental',
  silence_trim: 'experimental',
  item_gain: 'experimental',
  render_with_fx: 'experimental',
  master_chain_read: 'experimental',
};

const CAPABILITY_NEEDS: Record<DawCapabilityKey, DawMockNeeds> = {
  review: 'running',
  navigate: 'running',
  markers: 'running',
  pickups: 'running',
  line_identity: 'running',
  render_config: 'running',
  cleanup_tools: 'running',
  retake_lanes: 'running',
  project_state: 'running',
  take_create: 'running',
  heartbeat: 'bridge',
  project_read: 'nothing',
  track_state: 'running',
  track_select: 'running',
  record: 'running',
  punch: 'running',
  regions: 'running',
  takes: 'running',
  fx_chains: 'running',
  silence_trim: 'running',
  item_gain: 'running',
  render_with_fx: 'running',
  master_chain_read: 'running',
};

/** The host's own wording for a REAPER that is not connected or not answering, and the resolver's generic wording for
 * every other refusal (apps/desktop/internal/dawport/resolver.go, apps/desktop/internal/dawport/reaper/reaper.go). */
const MESSAGE_STANDALONE_REAPER = 'REAPER is not connected to this app. Open this app from the Narration Utils action in REAPER.';
const MESSAGE_NOT_RUNNING_REAPER = 'REAPER is not answering. Check that REAPER is open and the Narration Utils action is running, then try again.';
const MESSAGE_NO_ENGINE = 'No DAW is connected to this app. Open this app from your DAW to use it.';
const MESSAGE_TURNED_OFF = 'Turned off in Settings.';
const MESSAGE_EXPERIMENTAL_OFF = 'Experimental: switched off in Settings.';
/** ADR 0144's sentence, for what an Audacity launch does not build (audacity-integration PRD). */
const MESSAGE_AUDACITY_NOT_YET =
  "Audacity support is not available yet. This version can't read audio from Audacity or add labels to it, so open the project from REAPER to compare it.";
/** An Audacity launch's built but Experimental capabilities while no page opens the pipe (ADR 0355,
 * apps/desktop/internal/dawport/audacity/audacity.go's Declaration). */
const MESSAGE_AUDACITY_NOT_CONNECTED = "Audacity isn't connected to this app yet. This part of Audacity support is still being tested.";
/** What the Audacity adapter builds, Experimental until the owner's verification pass (ADR 0355); the rest is not_yet_available. */
const AUDACITY_EXPERIMENTAL: ReadonlySet<DawCapabilityKey> = new Set<DawCapabilityKey>(['navigate', 'markers']);

type DawToggle = 'auto' | 'on' | 'off';

export type DawMockSeed = {
  /** Which DAW the launch is talking to; defaults to 'REAPER'. */
  daw?: DawKind;
  /** Whether there is a live REAPER file bridge at all (dawport.Runtime.Bridge); defaults to true for 'REAPER',
   * ignored for 'Audacity' and 'none' (neither ever opens one). false models "REAPER declared but not connected":
   * every NeedsBridge/NeedsRunning capability answers 'standalone', the same message as no DAW at all. */
  connected?: boolean;
  /** Whether the connected bridge is answering (dawport.Runtime.Reachable, the heartbeat); defaults to `connected`'s
   * value. false models a connected-but-stale REAPER (closed without the app noticing yet): every NeedsRunning
   * capability answers 'not_running', but the heartbeat capability itself (NeedsBridge only) stays available - its
   * whole job is reporting this. */
  reachable?: boolean;
  /** The narrator's per-capability toggle, by key; a key left out is 'auto'. */
  toggles?: Partial<Record<DawCapabilityKey, DawToggle>>;
  /** The old DAW.experimental_reaper_actions switch: while true, every Experimental capability left on 'auto' is on. */
  experimentalOn?: boolean;
  /** The transport daw_transport_changed reports (DAW port PRD Phase 9); defaults to stopped. Only a connected, reachable
   * REAPER reports one: every other seed is stopped whatever this says, as the host's is with no heartbeat to read. */
  transport?: DawTransport;
};

function declarationFor(daw: DawKind): Record<string, DawCapabilityLevel> {
  if (daw === 'REAPER') return REAPER_DECLARATION;
  if (daw === 'Audacity') {
    return Object.fromEntries(
      DAW_CAPABILITIES.map(({ key }) => [key, AUDACITY_EXPERIMENTAL.has(key) ? ('experimental' as const) : ('not_yet_available' as const)]),
    );
  }
  return Object.fromEntries(DAW_CAPABILITIES.map(({ key }) => [key, 'unsupported' as const]));
}

function explain(daw: DawKind, key: DawCapabilityKey, reason: DawCapabilitySupport['reason']): string {
  if (daw === 'Audacity') {
    if (reason === 'not_yet') return MESSAGE_AUDACITY_NOT_YET;
    if (reason === 'standalone' || reason === 'not_running') return MESSAGE_AUDACITY_NOT_CONNECTED;
  }
  if (daw === 'REAPER') {
    if (reason === 'standalone') return MESSAGE_STANDALONE_REAPER;
    if (reason === 'not_running') return MESSAGE_NOT_RUNNING_REAPER;
  }
  switch (reason) {
    case 'standalone':
      return MESSAGE_NO_ENGINE;
    case 'turned_off':
      return MESSAGE_TURNED_OFF;
    case 'experimental_off':
      return MESSAGE_EXPERIMENTAL_OFF;
    case 'not_yet':
      return `${DAW_CAPABILITIES.find((c) => c.key === key)?.label ?? key} is not available with ${daw} yet.`;
    default:
      return `${DAW_CAPABILITIES.find((c) => c.key === key)?.label ?? key} is not something ${daw} can do.`;
  }
}

function supportFor(daw: DawKind, key: DawCapabilityKey, seed: DawMockSeed, connected: boolean, reachable: boolean): DawCapabilitySupport {
  const level = declarationFor(daw)[key] ?? 'unsupported';
  if (level === 'unsupported') return { level, available: false, reason: 'standalone', message: explain(daw, key, 'standalone') };
  if (level === 'not_yet_available') return { level, available: false, reason: 'not_yet', message: explain(daw, key, 'not_yet') };
  const toggle = seed.toggles?.[key] ?? 'auto';
  if (toggle === 'off') return { level, available: false, reason: 'turned_off', message: explain(daw, key, 'turned_off') };
  if (toggle !== 'on' && level === 'experimental' && !seed.experimentalOn) {
    return { level, available: false, reason: 'experimental_off', message: explain(daw, key, 'experimental_off') };
  }
  const needs = CAPABILITY_NEEDS[key];
  if (needs !== 'nothing' && !connected) return { level, available: false, reason: 'standalone', message: explain(daw, key, 'standalone') };
  if (needs === 'running' && !reachable) return { level, available: false, reason: 'not_running', message: explain(daw, key, 'not_running') };
  return { level, available: true };
}

function currentCapabilities(seed: DawMockSeed): DawCapabilities {
  const daw = seed.daw ?? 'REAPER';
  const connected = daw === 'REAPER' && (seed.connected ?? true);
  const reachable = connected && (seed.reachable ?? true);
  const capabilities: Record<string, DawCapabilitySupport> = {};
  for (const { key } of DAW_CAPABILITIES) capabilities[key] = supportFor(daw, key, seed, connected, reachable);
  return { daw, reachable, capabilities };
}

function currentTransport(seed: DawMockSeed, capabilities: DawCapabilities): DawTransport {
  if (!capabilities.reachable || !capabilities.capabilities.heartbeat?.available || !seed.transport) return { playing: false, recording: false };
  const { playing, recording, position } = seed.transport;
  return playing || recording ? { playing, recording, ...(position === undefined ? {} : { position }) } : { playing, recording };
}

export function createDawMock(seed: DawMockSeed = {}): DawCapabilitiesApi {
  const current = currentCapabilities(seed);
  const transport = currentTransport(seed, current);
  return {
    dawCapabilities: async () => wireClone(current),
    subscribeDawCapabilities: (onUpdate) => {
      onUpdate(wireClone(current));
      return () => {};
    },
    // Like the host's first tick after launch: the seeded transport once, on subscribe.
    subscribeDawTransport: (onUpdate) => {
      onUpdate(wireClone(transport));
      return () => {};
    },
  };
}
