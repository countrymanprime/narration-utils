import { describe, expect, it } from 'vitest';
import { MOCK_FIDELITY, mockFidelityFrom } from './mockHost/mockFidelity';
import { createMockApi } from './mockApi';
import { deliveryProfilesStateSchema } from './schemas/deliveryProfiles';

// `?mockFidelity=05` (mockHost/mockFidelity.ts): the Master & QC mock backend drawn as benchmark mock 05 draws it. The fixture holds
// only data the app can produce, so these check it through the public NarrationApi surface, and through the wire schema.

describe('?mockFidelity=05', () => {
  it('is a known mock, and nothing else is', () => {
    expect(mockFidelityFrom('05')).toBe('05');
    expect(mockFidelityFrom('5')).toBeUndefined();
    expect(mockFidelityFrom(null)).toBeUndefined();
  });

  it('configures ACX beside four other platforms, ACX still chosen, in the shape the host sends', async () => {
    const api = createMockApi({}, MOCK_FIDELITY['05']);
    const state = await api.deliveryProfiles();
    expect(deliveryProfilesStateSchema.parse(state)).toBeTruthy();
    expect(state.profiles.map((profile) => profile.name)).toEqual(['ACX', 'INaudio', 'Google Play', 'Apple (M4B)', 'Kobo']);
    expect(state.projectProfile).toBe('acx@2026-09');
  });

  it("picks the book's six rendered files and judges only the fifth over the noise floor limit", async () => {
    const api = createMockApi({}, MOCK_FIDELITY['05']);
    const { paths } = await api.measurePickFiles();
    expect(paths).toHaveLength(6);
    await api.measureAnalyze(paths);
    let job = await api.measureState();
    for (let polls = 0; job.phase === 'running' && polls < 60; polls += 1) job = await api.measureState();
    expect(job.phase).toBe('success');
    expect(job.message).toBe('Measured 6 files.');
    const failing = job.files.filter((file) => file.rules.some((result) => result.status === 'not_met'));
    expect(failing.map((file) => file.name)).toEqual(['04 The Rabbit Sends in a Little Bill.wav']);
    expect(failing[0].rules.filter((result) => result.status === 'not_met').map((result) => result.ruleId)).toEqual(['acx.noise_floor']);
  });
});
