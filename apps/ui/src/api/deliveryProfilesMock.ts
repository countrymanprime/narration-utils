// The browser mock's delivery profiles (docs/prds/delivery-platform-profiles.prd.md, ADR 0179), answering the way
// apps/desktop/delivery_profiles.go and internal/deliveryprofile do: the built-in ACX profile (the same rules as
// tests/fixtures/contracts/delivery-profiles.json pins, which wireContracts.test.ts checks), rule-by-rule evaluation of a
// measured file and of the book, the Global default and the project's choice, and a custom profile's duplicate, edit and
// delete with the host's refusals. `custom` boots with a custom profile ("My ACX, tighter peak") chosen for the project.
import type {
  DeliveryProfile,
  DeliveryProfileRef,
  DeliveryProfilesApi,
  DeliveryProfilesState,
  DeliveryRule,
  DeliveryRuleResult,
  DeliverySource,
  Finding,
  MeasureReport,
} from '../types';
import { wireClone } from './mockFixtures';

/** The key the host names a profile by (deliveryprofile.Profile.Key). */
const deliveryProfileKey = (profile: DeliveryProfile) => (profile.builtIn ? `${profile.id}@${profile.version}` : `${profile.id}@r${profile.revision}`);

const ACX_URL = 'https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements';
const source = (requirement: string, readOn: string, quoted = false): DeliverySource => ({
  title: 'ACX Audio Submission Requirements',
  url: ACX_URL,
  requirement,
  quoted,
  readOn,
});
const READ = '2026-09-20';
const LEVELS_READ = '2026-09-23';
const CHECKLIST = 'Not checked by the app yet: the book checklist comes later.';

type RuleSeed = Partial<DeliveryRule> & Pick<DeliveryRule, 'id' | 'label' | 'scope' | 'metric' | 'checkedBy' | 'source' | 'verification'>;
const rule = (seed: RuleSeed): DeliveryRule => ({
  unit: '',
  min: null,
  max: null,
  oneOf: [],
  sameAcrossFiles: false,
  advice: null,
  level: 'required',
  ...seed,
});

/** The built-in ACX profile, as internal/deliveryprofile/acx.go ships it. */
export const MOCK_ACX: DeliveryProfile = {
  id: 'acx',
  version: '2026-09',
  revision: 0,
  name: 'ACX',
  platform: 'ACX',
  builtIn: true,
  source: { title: 'ACX Audio Submission Requirements', url: ACX_URL, requirement: '', quoted: false, readOn: READ },
  rules: [
    rule({
      id: 'acx.rms',
      label: 'RMS',
      scope: 'file',
      metric: 'rms_dbfs',
      unit: 'dBFS',
      min: -23,
      max: -18,
      checkedBy: 'measured',
      source: source('Each file measures between -23 dB and -18 dB RMS.', LEVELS_READ),
      verification: 'to_verify',
      verificationNote: 'RMS definition to compare with ACX Check: the app measures the whole file, silences included, over every channel.',
    }),
    rule({
      id: 'acx.peak',
      label: 'Peak',
      scope: 'file',
      metric: 'sample_peak_dbfs',
      unit: 'dBFS',
      max: -3,
      advice: { metric: 'true_peak_dbtp', max: -3, unit: 'dBTP', text: 'true peak above −3 dBTP may clip after MP3 encoding' },
      checkedBy: 'measured',
      source: source('Each file has peak values no higher than -3 dB.', LEVELS_READ),
      verification: 'to_verify',
      verificationNote: 'Sample or true peak to confirm: the app judges the sample peak and shows the true peak as advice.',
    }),
    rule({
      id: 'acx.noise_floor',
      label: 'Noise floor',
      scope: 'file',
      metric: 'noise_floor_dbfs',
      unit: 'dBFS',
      max: -60,
      checkedBy: 'measured',
      source: source('Each file has a noise floor no higher than -60 dB RMS.', LEVELS_READ),
      verification: 'to_verify',
      verificationNote: 'Window definition to compare with ACX Check: the app takes the quietest 0.5 s that is not digital silence.',
    }),
    rule({
      id: 'acx.sample_rate',
      label: 'Sample rate',
      scope: 'file',
      metric: 'sample_rate',
      unit: 'Hz',
      oneOf: [44100],
      checkedBy: 'measured',
      source: source('Each file is sampled at 44.1 kHz.', LEVELS_READ),
      verification: 'verified',
    }),
    rule({
      id: 'acx.file_length',
      label: 'File length',
      scope: 'file',
      metric: 'duration_seconds',
      unit: 's',
      max: 7200,
      checkedBy: 'measured',
      source: source('Each file is no longer than 120 minutes.', READ),
      verification: 'verified',
    }),
    rule({
      id: 'acx.room_tone_head',
      label: 'Room tone, head',
      scope: 'file',
      metric: 'head_room_tone_seconds',
      unit: 's',
      min: 0.5,
      max: 5,
      checkedBy: 'measured',
      advice: {
        metric: 'head_digital_silence_seconds',
        max: 0,
        unit: 's',
        text: 'the head holds digital silence (exact zeros): ACX asks for room tone, not silence',
      },
      source: source('1 to 5 seconds of room tone at the beginning of each file.', READ),
      verification: 'conflicting',
      verificationNote:
        "ACX's page was read as 1 to 5 s; current guides say 0.5 to 1 s. Judged 0.5 to 5 s (the looser reading) until the owner reads ACX's page.",
    }),
    rule({
      id: 'acx.room_tone_tail',
      label: 'Room tone, tail',
      scope: 'file',
      metric: 'tail_room_tone_seconds',
      unit: 's',
      min: 1,
      max: 5,
      checkedBy: 'measured',
      advice: {
        metric: 'tail_digital_silence_seconds',
        max: 0,
        unit: 's',
        text: 'the tail holds digital silence (exact zeros): ACX asks for room tone, not silence',
      },
      source: source('1 to 5 seconds of room tone at the end of each file.', READ),
      verification: 'verified',
    }),
    rule({
      id: 'acx.format',
      label: 'MP3 format',
      scope: 'file',
      metric: 'mp3_format',
      unit: 'kbps',
      min: 192,
      boundText: '192 kbps+ CBR',
      checkedBy: 'measured',
      source: source('Each file is an MP3 at 192 kbps or higher, constant bit rate (CBR).', LEVELS_READ),
      verification: 'verified',
    }),
    rule({
      id: 'acx.channels',
      label: 'Channels',
      scope: 'book',
      metric: 'channels',
      oneOf: [1, 2],
      sameAcrossFiles: true,
      checkedBy: 'measured',
      source: source('Every file is mono or stereo, the same in every file.', READ),
      verification: 'to_verify',
      verificationNote: "The same-in-every-file wording and any mono preference are to read on ACX's page.",
    }),
    rule({
      id: 'acx.one_section_per_file',
      label: 'One section per file',
      scope: 'book',
      metric: 'one_section_per_file',
      checkedBy: 'listen',
      notCheckedWhy: 'Listen: each file holds one chapter or section and starts with its section header.',
      source: source('Each file holds one chapter or section and starts with a section header.', READ),
      verification: 'verified',
    }),
    rule({
      id: 'acx.credits',
      label: 'Credits files',
      scope: 'book',
      metric: 'credits_files',
      checkedBy: 'not_yet',
      notCheckedWhy: CHECKLIST,
      source: source('Opening and closing credits should be separate files', READ, true),
      verification: 'verified',
    }),
    rule({
      id: 'acx.retail_sample',
      label: 'Retail sample',
      scope: 'book',
      metric: 'retail_sample_seconds',
      unit: 's',
      max: 300,
      checkedBy: 'not_yet',
      notCheckedWhy: CHECKLIST,
      source: source('A retail audio sample of 5 minutes or less.', READ),
      verification: 'verified',
      verificationNote: "Some guides also give a 1 minute minimum; to read on ACX's page.",
    }),
    rule({
      id: 'acx.consistency',
      label: 'Consistency',
      scope: 'book',
      metric: 'consistency',
      checkedBy: 'listen',
      notCheckedWhy: 'Listen: consistent sound and levels across files, no extraneous sounds.',
      source: source('Consistent in overall sound and formatting, free of extraneous sounds.', READ),
      verification: 'to_verify',
      verificationNote: "Recorded from guides; ACX's own wording is to read on its page.",
    }),
  ],
};

/**
 * The custom profile `?mockDeliveryProfile=custom` chooses for the project (mockup 05): ACX with a lower RMS floor and a tighter
 * peak, and room tone at the head and the sample rate turned off (the narrator renders at 48 kHz and converts on export).
 */
export function mockCustomProfile(): DeliveryProfile {
  const profile = wireClone({
    ...MOCK_ACX,
    id: 'custom-0123456789abcdef',
    version: '',
    revision: 3,
    name: 'My ACX, tighter peak',
    builtIn: false,
    basedOn: 'acx@2026-09',
  });
  const changes: Record<string, Partial<DeliveryRule>> = {
    'acx.rms': { min: -24 },
    'acx.peak': { max: -3.5 },
    'acx.room_tone_head': { off: true },
    'acx.sample_rate': { off: true },
  };
  profile.rules = profile.rules.map((one) => ({ ...one, ...changes[one.id] }));
  return profile;
}

const metricValue = (report: MeasureReport, metric: string): number | null | undefined => {
  switch (metric) {
    case 'integrated_lufs':
    case 'rms_dbfs':
    case 'sample_peak_dbfs':
    case 'true_peak_dbtp':
    case 'noise_floor_dbfs':
      return report[metric];
    case 'duration_seconds':
      return report.duration_seconds;
    case 'sample_rate':
      return report.sample_rate;
    case 'channels':
      return report.channels;
    case 'head_room_tone_seconds':
    case 'tail_room_tone_seconds':
    case 'head_digital_silence_seconds':
    case 'tail_digital_silence_seconds':
      return report[metric];
    case 'mp3_format':
      // The bitrate: every frame's when the file is CBR, the average when it is not (then not met, not_cbr).
      if (!report.mp3) return undefined;
      return report.mp3.cbr ? report.mp3.bitrate_kbps : report.mp3.average_bitrate_kbps;
  }
  return undefined;
};

/** deliveryprofile.otherKindWhy: an MP3 is not decoded, and a WAV has no MP3 container to check. */
const FROM_SAMPLES = new Set([
  'integrated_lufs',
  'rms_dbfs',
  'sample_peak_dbfs',
  'true_peak_dbtp',
  'noise_floor_dbfs',
  'head_room_tone_seconds',
  'tail_room_tone_seconds',
]);
const otherKindWhy = (report: MeasureReport, metric: string): string | undefined =>
  report.mp3 && FROM_SAMPLES.has(metric)
    ? 'Not measured on an MP3: the app reads its headers only and does not decode it. Measure the WAV render it came from.'
    : !report.mp3 && metric === 'mp3_format'
      ? 'This is a WAV render; measure the MP3 you upload to check its format.'
      : undefined;

const violationOf = (one: DeliveryRule, value: number): DeliveryRuleResult['violation'] =>
  one.oneOf.length > 0 && !one.oneOf.includes(value)
    ? 'not_one_of'
    : one.max !== null && value > one.max
      ? 'above_max'
      : one.min !== null && value < one.min
        ? 'below_min'
        : undefined;

const notCheckedWhy = (one: DeliveryRule) =>
  one.notCheckedWhy ?? (one.checkedBy === 'listen' ? 'Listen: the app does not judge this.' : 'Not checked by the app yet.');
const OFF = 'Turned off in this profile: not judged.';

function finding(
  file: string,
  profile: DeliveryProfile,
  one: DeliveryRule,
  kind: string,
  fields: Pick<Finding, 'severity' | 'confidence_reason' | 'evidence'>,
): Finding {
  return {
    schema_version: 1,
    id: `mock-measure-${file.split(/[\\/]/).pop() ?? file}-${profile.id}-${one.id}-${kind}`.replace(/[^A-Za-z0-9-]/g, '-'),
    analyzer: 'measure',
    project: {},
    source: { file },
    category: 'delivery_qc',
    confidence: 1,
    ...fields,
    review: { status: 'unreviewed' },
  };
}

/** deliveryprofile.EvaluateFile: one result per file rule, and the findings they raise. */
export function evaluateMockFile(report: MeasureReport, file: string, profile: DeliveryProfile): { rules: DeliveryRuleResult[]; findings: Finding[] } {
  const rules: DeliveryRuleResult[] = [];
  const findings: Finding[] = [];
  const key = deliveryProfileKey(profile);
  for (const one of profile.rules.filter((candidate) => candidate.scope === 'file')) {
    const base = { metric: one.metric, rule: one.id, profile: key };
    const value = metricValue(report, one.metric);
    if (one.off) {
      rules.push({ ruleId: one.id, status: 'off', value: null, why: OFF });
      continue;
    }
    const otherKind = one.checkedBy === 'measured' ? otherKindWhy(report, one.metric) : undefined;
    if (otherKind) {
      rules.push({ ruleId: one.id, status: 'not_checked', value: null, why: otherKind });
      continue;
    }
    if (one.checkedBy !== 'measured' || value === undefined) {
      rules.push({ ruleId: one.id, status: 'not_checked', value: null, why: notCheckedWhy(one) });
      continue;
    }
    if (value === null || !Number.isFinite(value)) {
      rules.push({
        ruleId: one.id,
        status: 'not_measurable',
        value: null,
        why: 'Could not be measured (silence, or audio shorter than the measurement needs); never counted as met.',
      });
      findings.push(
        finding(file, profile, one, 'unavailable', {
          severity: 'info',
          confidence_reason: 'the measurement could not be made (silence, or audio shorter than the measurement window)',
          evidence: { ...base, available: false },
        }),
      );
      continue;
    }
    const violation = one.metric === 'mp3_format' && report.mp3 && !report.mp3.cbr ? 'not_cbr' : violationOf(one, value);
    const advised = one.advice ? metricValue(report, one.advice.metric) : undefined;
    const advice = one.advice && typeof advised === 'number' && advised > one.advice.max ? one.advice.text : undefined;
    rules.push({ ruleId: one.id, status: violation ? 'not_met' : 'met', value, ...(violation ? { violation } : {}), ...(advice ? { advice } : {}) });
    if (violation) {
      const bounds = {
        ...(one.min !== null ? { limit_min: one.min } : {}),
        ...(one.max !== null ? { limit_max: one.max } : {}),
        ...(one.oneOf.length > 0 ? { allowed: one.oneOf } : {}),
      };
      findings.push(
        finding(file, profile, one, 'out_of_range', {
          severity: one.level === 'advice' ? 'warning' : 'error',
          confidence_reason: 'deterministic measurement of the decoded samples',
          evidence: { ...base, value, violation, ...bounds },
        }),
      );
    }
    if (advice && one.advice && typeof advised === 'number') {
      findings.push(
        finding(file, profile, one, 'advice', {
          severity: 'warning',
          confidence_reason: 'deterministic measurement of the decoded samples',
          evidence: { ...base, metric: one.advice.metric, value: advised, violation: 'above_max', limit_max: one.advice.max, advice },
        }),
      );
    }
  }
  return { rules, findings };
}

/** deliveryprofile.EvaluateBook over the measured files' reports. */
export function evaluateMockBook(reports: readonly MeasureReport[], profile: DeliveryProfile): DeliveryRuleResult[] {
  return profile.rules
    .filter((one) => one.scope === 'book')
    .map((one): DeliveryRuleResult => {
      if (one.off) return { ruleId: one.id, status: 'off', value: null, why: OFF };
      if (one.checkedBy !== 'measured') return { ruleId: one.id, status: 'not_checked', value: null, why: notCheckedWhy(one) };
      let first: number | undefined;
      for (const report of reports) {
        const value = metricValue(report, one.metric);
        if (value === undefined) return { ruleId: one.id, status: 'not_checked', value: null, why: notCheckedWhy(one) };
        if (value === null) continue;
        const violation = violationOf(one, value);
        if (violation) return { ruleId: one.id, status: 'not_met', value, violation };
        if (first === undefined) first = value;
        else if (one.sameAcrossFiles && first !== value) return { ruleId: one.id, status: 'not_met', value: null, violation: 'differs_across_files' };
      }
      return first === undefined
        ? { ruleId: one.id, status: 'not_measurable', value: null, why: 'No measured file to judge.' }
        : { ruleId: one.id, status: 'met', value: first };
    });
}

export type MockDeliveryProfileSeed = 'custom';

const refOf = (profile: DeliveryProfile): DeliveryProfileRef => (profile.builtIn ? { id: profile.id, version: profile.version } : { id: profile.id });

/** The profiles, the Global default and the project's choice; `current` answers the profile the project is judged against. */
export function createDeliveryProfilesMock(seed?: MockDeliveryProfileSeed): DeliveryProfilesApi & { current: () => DeliveryProfile } {
  const custom: DeliveryProfile[] = seed === 'custom' ? [mockCustomProfile()] : [];
  let globalDefault: DeliveryProfileRef = refOf(MOCK_ACX);
  let projectChoice: DeliveryProfileRef | null = seed === 'custom' ? refOf(custom[0]) : null;
  let nextId = 1;

  const all = () => [MOCK_ACX, ...custom];
  const find = (ref: DeliveryProfileRef) => all().find((one) => one.id === ref.id && (!one.builtIn || !ref.version || one.version === ref.version));
  const current = () => wireClone((projectChoice && find(projectChoice)) ?? find(globalDefault) ?? MOCK_ACX);
  const state = (): DeliveryProfilesState =>
    wireClone({
      profiles: all(),
      globalDefault,
      hasProject: true,
      projectChoice,
      projectProfile: deliveryProfileKey(current()),
      ...(projectChoice && !find(projectChoice)
        ? { notice: 'The delivery profile this project chose is no longer there, so it is judged against the Global default.' }
        : {}),
    });
  const refuseBuiltIn = (id: string, what: string) => {
    if (id === MOCK_ACX.id) throw new Error(`a built-in profile cannot be ${what}`);
  };

  return {
    current,
    deliveryProfiles: async () => state(),
    deliverySelectProfile: async (scope, id, version) => {
      if (scope !== 'global' && scope !== 'project') throw new Error(`unsupported scope "${scope}": choose global or project`);
      if (scope === 'project' && id === '') {
        projectChoice = null;
        return state();
      }
      const profile = find({ id, version });
      if (!profile) throw new Error(`there is no delivery profile "${id}"`);
      if (scope === 'global') globalDefault = refOf(profile);
      else projectChoice = refOf(profile);
      return state();
    },
    deliveryDuplicateProfile: async (id, version) => {
      const original = find({ id, version });
      if (!original) throw new Error(`there is no delivery profile "${id}"`);
      const title = original.builtIn ? `${original.name} (${original.version === '2026-09' ? 'September 2026' : original.version})` : original.name;
      const copy: DeliveryProfile = wireClone({
        ...original,
        id: `custom-mock-${nextId++}`,
        version: '',
        revision: 1,
        builtIn: false,
        name: `${title} copy`,
        ...(original.builtIn ? { basedOn: deliveryProfileKey(original) } : {}),
      });
      custom.push(copy);
      return wireClone(copy);
    },
    deliverySaveProfile: async (edit) => {
      refuseBuiltIn(edit.id, 'changed; duplicate it to change its numbers');
      const index = custom.findIndex((one) => one.id === edit.id);
      if (index < 0) throw new Error(`there is no custom delivery profile "${edit.id}"`);
      const saved = custom[index];
      const name = edit.name.trim();
      if (name === '' || name.length > 80) throw new Error("a profile's name must be 1 to 80 characters");
      if (edit.rules.length !== saved.rules.length) throw new Error('a custom profile keeps the rules it was made with; it cannot add or drop one');
      const rules = saved.rules.map((original, i) => {
        const next = edit.rules[i];
        // The host writes `off` only when it is set (omitempty).
        const one: DeliveryRule = { ...original };
        delete one.off;
        if (next.off) one.off = true;
        if (next.id !== one.id) throw new Error(`rule "${next.id}" is not rule "${one.id}" of this profile`);
        const adjustable = one.scope === 'file' && one.checkedBy !== 'listen' && (one.min !== null || one.max !== null) && one.oneOf.length === 0;
        if (!adjustable) return one;
        if ((next.min === null) !== (one.min === null) || (next.max === null) !== (one.max === null))
          throw new Error(`${one.label}: a copy can change a bound, not add or remove one`);
        if (next.min !== null && next.max !== null && next.min > next.max)
          throw new Error(`${one.label}: the lowest (${next.min}) is above the highest (${next.max})`);
        return { ...one, min: next.min, max: next.max };
      });
      custom[index] = { ...saved, name, rules, revision: saved.revision + 1 };
      return wireClone(custom[index]);
    },
    deliveryDeleteProfile: async (id) => {
      refuseBuiltIn(id, 'deleted');
      const index = custom.findIndex((one) => one.id === id);
      if (index < 0) throw new Error(`there is no custom delivery profile "${id}"`);
      custom.splice(index, 1);
      if (globalDefault.id === id) globalDefault = refOf(MOCK_ACX);
      return state();
    },
  };
}
