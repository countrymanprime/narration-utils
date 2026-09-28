// The browser mock's delivery findings on the Review page (delivery-platform-profiles.prd.md Phase 9), answering the way
// apps/desktop/delivery_findings.go and deliveryprofile.ReviewFindings do: when a measurement ends, and when the project's
// profile changes, every measured file's rules that are not met or could not be measured are saved into the findings
// store, one finding per rule per file with the id Master & QC gives it; a rule met again resolves its finding
// (not in the latest run), and a decision holds while the audio and the rule are the same.
import type { DeliveryProfile, DeliveryProfilesApi, Finding, MeasureJob } from '../types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** deliveryprofile.Profile.Title: "ACX (September 2026)" for a built-in, a custom profile's own name. */
function profileTitle(profile: DeliveryProfile): string {
  if (!profile.builtIn) return profile.name;
  const match = /^(\d{4})-(\d{2})$/.exec(profile.version);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${profile.name} (${month} ${match[1]})` : `${profile.name} (${profile.version})`;
}

/** The store partition the host saves delivery findings under (deliveryprofile.ReviewAnalyzer). */
export const DELIVERY_REVIEW_ANALYZER = 'measure';

/** ReviewFindings over a judged job: the files it measured and each one's findings for the Review page. */
export function mockDeliveryReviewFindings(job: MeasureJob): { files: string[]; findings: Finding[] } {
  const profile = job.profile;
  if (!profile) return { files: [], findings: [] };
  const files: string[] = [];
  const findings: Finding[] = [];
  for (const file of job.files) {
    if (file.status !== 'measured' || !file.report) continue;
    files.push(file.path);
    for (const result of file.rules) {
      if (result.status !== 'not_met' && result.status !== 'not_measurable') continue;
      const rule = profile.rules.find((candidate) => candidate.id === result.ruleId);
      // The rule's own finding, not its advice (true peak, digital silence at an edge): advice stays on Master & QC.
      const raised = file.findings.find((candidate) => candidate.evidence?.rule === result.ruleId && candidate.evidence.advice === undefined);
      if (!rule || !raised) continue;
      findings.push({
        ...raised,
        evidence: {
          ...raised.evidence,
          rule_label: rule.label,
          requirement: rule.source.requirement,
          profile_name: profileTitle(profile),
          ...(rule.unit ? { unit: rule.unit } : {}),
        },
        // The host hashes the audio's fingerprint, the rule's bound and how the value stood; the mock spells it out.
        evidence_version: [
          'mock',
          file.fingerprint?.sha256 ?? '',
          rule.id,
          result.status,
          result.violation ?? '',
          result.value ?? '',
          rule.min ?? '',
          rule.max ?? '',
        ].join(':'),
      });
    }
  }
  return { files, findings };
}

/** The profile bindings, each re-judging the last measurement for the Review page once it has changed a profile. */
export function resavingAfterProfileChange(api: DeliveryProfilesApi, resave: () => void): DeliveryProfilesApi {
  return {
    ...api,
    deliverySelectProfile: async (...args) => {
      const answer = await api.deliverySelectProfile(...args);
      resave();
      return answer;
    },
    deliverySaveProfile: async (...args) => {
      const answer = await api.deliverySaveProfile(...args);
      resave();
      return answer;
    },
    deliveryDeleteProfile: async (...args) => {
      const answer = await api.deliveryDeleteProfile(...args);
      resave();
      return answer;
    },
  };
}
