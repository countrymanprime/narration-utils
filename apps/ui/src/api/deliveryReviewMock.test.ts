import { describe, expect, it } from 'vitest';
import { createMockApi } from './mockApi';
import type { Finding, NarrationApi } from '../types';

// The mock's delivery findings follow the host's review semantics (delivery_findings_test.go), so the Review page built on
// the mock behaves as it will on the host.

async function measure(api: NarrationApi) {
  let job = await api.measureAnalyze((await api.measurePickFiles()).paths);
  while (job.phase === 'running') job = await api.measureState();
  return job;
}

const delivery = async (api: NarrationApi, includeNotInLatestRun = false) =>
  (await api.findingsList({ category: 'delivery_qc', includeNotInLatestRun })).findings;

const rule = (finding: Finding) => `${finding.source.file?.split('/').pop()} ${String(finding.evidence?.rule)}`;

describe('delivery findings in the mock findings store', () => {
  it('saves one finding per rule not met or not measurable per measured file, and none for advice or a failed file', async () => {
    const api = createMockApi();
    expect(await delivery(api)).toEqual([]);
    await measure(api);
    const rules = (await delivery(api)).map(rule).sort();
    expect(rules).toContain('Chapter 01.wav acx.sample_rate');
    expect(rules).toContain('Chapter 02 (silent).wav acx.rms');
    expect(rules.some((one) => one.startsWith('Chapter 03.mp3'))).toBe(false);
    expect(new Set(rules).size).toBe(rules.length);
  });

  it('keeps a decision while the evidence is the same, and resolves a rule the profile no longer misses', async () => {
    const api = createMockApi();
    await measure(api);
    const rate = (await delivery(api)).find((finding) => finding.evidence?.rule === 'acx.sample_rate')!;
    await api.findingsReview({ id: rate.id, evidenceVersion: rate.evidence_version ?? '', status: 'dismissed', note: 'Resampled on export' });
    await measure(api);
    expect((await api.findingsGet(rate.id)).review.status).toBe('dismissed');

    // A custom profile judges the project now: every ACX finding is resolved (not in the latest run) and its own raised.
    const copy = await api.deliveryDuplicateProfile('acx', '2026-09');
    await api.deliverySelectProfile('project', copy.id, '');
    const all = await delivery(api, true);
    expect(all.filter((finding) => finding.evidence?.profile === 'acx@2026-09').every((finding) => finding.not_in_latest_run)).toBe(true);
    expect((await delivery(api)).every((finding) => String(finding.evidence?.profile).startsWith(`${copy.id}@`))).toBe(true);
    expect((await api.findingsGet(rate.id)).review.status).toBe('dismissed');
  });
});
