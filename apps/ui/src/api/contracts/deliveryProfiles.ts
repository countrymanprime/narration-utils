// Delivery profiles (docs/prds/delivery-platform-profiles.prd.md, ADR 0179): a named, versioned set of rules the rendered
// files are judged against, each citing the platform requirement it enforces and saying whether the app measures it, cannot
// check it yet, or leaves it to listening. The built-in ACX profile ships (acx@2026-09); a custom profile is a copy with
// changed numbers or rules turned off. Field names are internal/deliveryprofile's own.

export type DeliveryRuleScope = 'file' | 'book';
export type DeliveryRuleLevel = 'required' | 'advice';
/** How the app checks a rule: by measuring it, not yet (with why), or not at all (a listening check). */
export type DeliveryRuleCheckedBy = 'measured' | 'not_yet' | 'listen';
/** How the requirement was established: read on the platform's own page, from secondary sources only, or read differently by different sources. */
export type DeliveryVerification = 'verified' | 'to_verify' | 'conflicting';

/** Where a requirement comes from; `quoted` says whether `requirement` is the page's own words (a paraphrase otherwise). */
export type DeliverySource = { title: string; url: string; requirement: string; quoted: boolean; readOn: string };

/** A rule's softer second check: a value of `metric` above `max` adds `text` to the result, and a warning. */
export type DeliveryAdvice = { metric: string; max: number; unit: string; text: string };

export type DeliveryRule = {
  id: string;
  label: string;
  scope: DeliveryRuleScope;
  metric: string;
  unit: string;
  /** Inclusive bounds; null is unbounded. */
  min: number | null;
  max: number | null;
  oneOf: number[];
  /** A bound the numbers cannot hold ("192 kbps+ CBR"). */
  boundText?: string;
  sameAcrossFiles: boolean;
  advice: DeliveryAdvice | null;
  level: DeliveryRuleLevel;
  checkedBy: DeliveryRuleCheckedBy;
  notCheckedWhy?: string;
  source: DeliverySource;
  verification: DeliveryVerification;
  verificationNote?: string;
  /** Set on a custom profile's rule the narrator turned off: listed as off, never judged. */
  off?: boolean;
};

/** A built-in's `version` is the month its platform's page was read; a custom profile's `revision` counts its saves. */
export type DeliveryProfile = {
  id: string;
  version: string;
  revision: number;
  name: string;
  platform: string;
  builtIn: boolean;
  basedOn?: string;
  note?: string;
  source: DeliverySource;
  rules: DeliveryRule[];
};

/** A saved choice: a built-in's id and version, or a custom profile's id (it always judges with its latest revision). */
export type DeliveryProfileRef = { id: string; version?: string };

export type DeliveryRuleStatus = 'met' | 'not_met' | 'not_measurable' | 'not_checked' | 'off';

/** One rule's result for one file (or for the book). `value` is what was measured; `why` says why it was not judged. */
export type DeliveryRuleResult = {
  ruleId: string;
  status: DeliveryRuleStatus;
  value: number | null;
  violation?: 'above_max' | 'below_min' | 'not_one_of' | 'differs_across_files';
  why?: string;
  advice?: string;
};

/**
 * Every profile the narrator can choose (the built-ins first), the Global default, the current project's own choice (null:
 * the Global default), the key of the profile the project is judged against, and why a choice could not be used.
 */
export type DeliveryProfilesState = {
  profiles: DeliveryProfile[];
  globalDefault: DeliveryProfileRef;
  hasProject: boolean;
  projectChoice: DeliveryProfileRef | null;
  projectProfile: string;
  notice?: string;
};

/** What the editor sends for a custom profile: its name, and each rule's bounds and whether it is off. */
export type DeliveryProfileEdit = { id: string; name: string; rules: { id: string; off: boolean; min: number | null; max: number | null }[] };

export type DeliveryProfileScope = 'global' | 'project';

export interface DeliveryProfilesApi {
  /** Every profile, the Global default and the project's choice. */
  deliveryProfiles(): Promise<DeliveryProfilesState>;
  /** Saves a choice for a scope (an empty id clears the project's own choice) and answers the profiles again. */
  deliverySelectProfile(scope: DeliveryProfileScope, id: string, version: string): Promise<DeliveryProfilesState>;
  /** Copies a profile into a new custom profile and answers it. */
  deliveryDuplicateProfile(id: string, version: string): Promise<DeliveryProfile>;
  /** Saves a custom profile's name, numbers and rules turned off; a built-in is refused. Answers it, revision bumped. */
  deliverySaveProfile(edit: DeliveryProfileEdit): Promise<DeliveryProfile>;
  /** Deletes a custom profile and answers the profiles again; a built-in is refused. */
  deliveryDeleteProfile(id: string): Promise<DeliveryProfilesState>;
}
