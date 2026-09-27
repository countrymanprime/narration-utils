// The provider ports' capability payload (provider-ports PRD Phase 14, ADR 0301): every provider this build can hand its sidecars,
// read from the host's Go registries (internal/asrport, ttsport, pronunciationport, captureport), whether it runs on this platform,
// and, for one whose models or voices come from the asset catalog, how many are installed. apps/desktop/bindings_providers.go is
// the binding. It is read-only and no screen reads it yet.
import type { DawCapabilitySupport } from './daw';

/** A provider's answer on this platform: the DAW port's own Support shape (port.Support in Go), so both ports speak one way. */
export type ProviderSupport = DawCapabilitySupport;

/** The asset kind a provider's models or voices install from. `installed` counts the ones installed now; it is absent when the
 * kind has no catalog in this launch, which is not the same answer as 0 ("none yet"). */
export type ProviderAsset = {
  kind: string;
  installed?: number;
};

export type ProviderEntry = {
  /** The provider's name in words, from its registry row. */
  label: string;
  /** Whether this is the port's default on this platform: the row used when no setting names one. */
  default: boolean;
  /** GOOS values the provider runs on; empty means every platform. */
  platforms: string[];
  /** What the provider can do: 'live'/'batch' for speech recognition, 'pronounce'/'browse' for pronunciation; empty for the
   * ports whose providers have one job (voice, capture). */
  modes: string[];
  /** Absent for a provider that installs nothing. */
  asset?: ProviderAsset;
  support: ProviderSupport;
};

/** Each port's rows by the name its setting or sidecar flag stores. New rows may appear (a new engine is a new row), so these are
 * plain string-keyed records, not closed unions. */
export type ProviderCapabilities = {
  /** The host's platform, a GOOS value ('windows', 'darwin', 'linux'). */
  platform: string;
  asr: Record<string, ProviderEntry>;
  tts: Record<string, ProviderEntry>;
  pronunciation: Record<string, ProviderEntry>;
  capture: Record<string, ProviderEntry>;
};

export interface ProviderCapabilitiesApi {
  providerCapabilities(): Promise<ProviderCapabilities>;
}
