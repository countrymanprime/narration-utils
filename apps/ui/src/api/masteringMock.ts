// The mock's mastering chains (ADR 0306): a stand-in for the host's internal/masteringport registry and
// bindings_mastering.go's answer over it. Its rows mirror the registry's rows in registration order, the default first; the
// project's choice is kept in memory, and a choice of a row that is unknown or not available yet is refused with the host's
// sentence, changing nothing.
import type { MasteringApi, MasteringProvider, MasteringProviders } from './contracts/mastering';
import { wireClone } from './mockFixtures';

type MockRow = Omit<MasteringProvider, 'default'>;

/** internal/masteringport's rows: builtin.go, then daw.go (Experimental until the owner's REAPER pass). */
const ROWS: MockRow[] = [
  {
    name: 'builtin',
    label: 'Built-in chain (EQ, limiter, gain)',
    modes: ['wav'],
    needsApproval: false,
    needs: [],
    support: { level: 'supported', available: true },
    chain: [
      { name: 'EQ', detail: 'High-pass 80 Hz' },
      { name: 'Limiter', detail: '0.5 dB under the peak limit' },
      { name: 'Gain', detail: 'To the RMS target' },
    ],
  },
  {
    name: 'daw',
    label: "Your DAW's FX chain",
    modes: ['daw_region'],
    needsApproval: true,
    needs: ['render_with_fx', 'master_chain_read'],
    support: { level: 'experimental', available: true },
    chain: [],
  },
];

export type MasteringMockSeed = {
  /** Whether a project is open; defaults to true. */
  hasProject?: boolean;
  /** The project's stored choice; defaults to none (it masters with the default row). */
  choice?: string;
};

function currentProviders(hasProject: boolean, choice: string | null): MasteringProviders {
  const fallback = ROWS[0];
  const state: MasteringProviders = {
    hasProject,
    choice,
    effective: fallback.name,
    providers: ROWS.map((row) => ({ ...row, default: row.name === fallback.name })),
  };
  if (choice === null) return state;
  const row = ROWS.find((candidate) => candidate.name === choice);
  if (!row) {
    state.notice = `This project chose a mastering chain this version does not have ("${choice}"). It masters with the default, ${fallback.label}.`;
  } else if (!row.support.available) {
    state.notice = `${row.support.message} This project masters with the default, ${fallback.label}, until then.`;
  } else {
    state.effective = row.name;
  }
  return state;
}

export function createMasteringMock(seed: MasteringMockSeed = {}): MasteringApi {
  const hasProject = seed.hasProject ?? true;
  let choice: string | null = hasProject ? (seed.choice ?? null) : null;
  return {
    masteringProviders: async () => wireClone(currentProviders(hasProject, choice)),
    masteringChooseProvider: async (name) => {
      if (!hasProject) throw new Error('open a project before choosing how it is mastered');
      if (name !== '') {
        const row = ROWS.find((candidate) => candidate.name === name);
        if (!row) throw new Error(`There is no mastering chain called "${name}".`);
        if (!row.support.available) throw new Error(row.support.message);
      }
      choice = name === '' ? null : name;
      return wireClone(currentProviders(hasProject, choice));
    },
  };
}
