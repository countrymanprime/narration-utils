// The mock's provider capabilities (provider-ports PRD Phase 14): a stand-in for the host's provider registries
// (apps/desktop/internal/asrport, ttsport, pronunciationport, captureport) and bindings_providers.go's answer over them. Its rows
// mirror the registries' rows in their registration order; a row declared for other platforms answers unsupported with the
// host's sentence. Nothing in the mock installs an asset, so installed counts are only what the seed says.
import type { ProviderCapabilities, ProviderCapabilitiesApi, ProviderEntry } from './contracts/providers';
import { wireClone } from './mockFixtures';

type MockPort = 'asr' | 'tts' | 'pronunciation' | 'capture';

type MockRow = { name: string; label: string; platforms: string[]; modes: string[]; assetKind?: string };

/** The registries' rows, default first, as the Go packages register them. */
const ROWS: Record<MockPort, MockRow[]> = {
  asr: [
    { name: 'whisper', label: 'Whisper', platforms: [], modes: ['live', 'batch'], assetKind: 'whisper' },
    { name: 'moonshine', label: 'Moonshine', platforms: ['windows'], modes: ['live'], assetKind: 'moonshine' },
  ],
  tts: [{ name: 'piper', label: 'Piper', platforms: [], modes: [], assetKind: 'tts' }],
  pronunciation: [
    { name: 'cmu', label: 'CMU dictionary', platforms: [], modes: ['pronounce'] },
    { name: 'espeak', label: 'eSpeak NG', platforms: [], modes: ['pronounce'] },
  ],
  capture: [
    { name: 'dshow', label: 'DirectShow', platforms: ['windows'], modes: [] },
    { name: 'coreaudio', label: 'Core Audio', platforms: ['darwin'], modes: [] },
  ],
};

const PLATFORM_LABELS: Record<string, string> = { windows: 'Windows', darwin: 'macOS', linux: 'Linux' };

export type ProvidersMockSeed = {
  /** The host's platform, a GOOS value; defaults to 'windows', the platform the app ships on. */
  platform?: string;
  /** Installed assets by asset kind ('whisper', 'moonshine', 'tts'); a kind left out has no catalog, so its rows report no count. */
  installed?: Partial<Record<string, number>>;
};

const runsOn = (row: MockRow, platform: string) => row.platforms.length === 0 || row.platforms.includes(platform);

function entryFor(row: MockRow, platform: string, isDefault: boolean, seed: ProvidersMockSeed): ProviderEntry {
  const entry: ProviderEntry = {
    label: row.label,
    default: isDefault,
    platforms: [...row.platforms],
    modes: [...row.modes],
    support: runsOn(row, platform)
      ? { level: 'supported', available: true }
      : {
          level: 'unsupported',
          available: false,
          reason: 'unsupported',
          message: `${row.label} is not available on ${PLATFORM_LABELS[platform] ?? platform}.`,
        },
  };
  if (row.assetKind) {
    const installed = seed.installed?.[row.assetKind];
    entry.asset = installed === undefined ? { kind: row.assetKind } : { kind: row.assetKind, installed };
  }
  return entry;
}

function portRows(port: MockPort, platform: string, seed: ProvidersMockSeed): Record<string, ProviderEntry> {
  const rows = ROWS[port];
  // Capture's default is per platform, the first row declared for it (captureport.For); every other port's is its first row.
  const defaultName = port === 'capture' ? rows.find((row) => runsOn(row, platform))?.name : rows[0]?.name;
  return Object.fromEntries(rows.map((row) => [row.name, entryFor(row, platform, row.name === defaultName, seed)]));
}

function currentCapabilities(seed: ProvidersMockSeed): ProviderCapabilities {
  const platform = seed.platform ?? 'windows';
  return {
    platform,
    asr: portRows('asr', platform, seed),
    tts: portRows('tts', platform, seed),
    pronunciation: portRows('pronunciation', platform, seed),
    capture: portRows('capture', platform, seed),
  };
}

export function createProvidersMock(seed: ProvidersMockSeed = {}): ProviderCapabilitiesApi {
  const current = currentCapabilities(seed);
  return { providerCapabilities: async () => wireClone(current) };
}
