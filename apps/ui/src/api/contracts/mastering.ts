// The mastering port's choice payload (ADR 0306, owner decision D86): every mastering chain this build has, read from the host's
// Go registry (internal/masteringport), what each needs and whether it can be chosen now, and the current project's own choice.
// apps/desktop/bindings_mastering.go is the binding. Master & QC (stage navigation Phase 8) reads it to draw the chain.
import type { DawCapabilitySupport } from './daw';

/** One step of a row's own fixed chain (masteringport.Step), in words that hold for any delivery profile. */
export type MasteringStep = { name: string; detail: string };

export type MasteringProvider = {
  /** The row's name, the value the project's choice stores ('builtin', 'daw'). New rows may appear, so it is a plain string. */
  name: string;
  /** The chain's name in words, from its registry row. */
  label: string;
  /** Whether this is the row a project masters with until it chooses another. */
  default: boolean;
  /** What the chain masters from: 'wav' (a rendered WAV file) or 'daw_region' (the DAW renders a region through its own FX). */
  modes: string[];
  /** Whether every master with this chain needs the narrator's approval first (any chain that makes the DAW render). */
  needsApproval: boolean;
  /** The DAW port capabilities the chain uses (dawport.Capability names), which the launch's DAW must have available. */
  needs: string[];
  /** Whether it can be chosen now: the DAW port's own Support shape (port.Support in Go). */
  support: DawCapabilitySupport;
  /** The row's own chain in order, drawn before anything is mastered; empty when the chain is not the app's (the DAW row, whose
   * project FX chain decides). */
  chain: MasteringStep[];
};

export type MasteringProviders = {
  hasProject: boolean;
  /** The project's own choice as stored, even one that cannot be used now; null when it has none, and always without a project. */
  choice: string | null;
  /** The row the project masters with: its choice when that can run, otherwise the default. */
  effective: string;
  /** Every row, the default first. */
  providers: MasteringProvider[];
  /** Why the project's choice is not the row it masters with; absent when it is. */
  notice?: string;
};

export interface MasteringApi {
  masteringProviders(): Promise<MasteringProviders>;
  /** Saves the current project's choice; '' clears it. Refuses, with the row's sentence, a row that is unknown or not available
   * yet, and without a project. */
  masteringChooseProvider(name: string): Promise<MasteringProviders>;
}
