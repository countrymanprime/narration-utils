// `?mockFidelity=<mock>`: the mock backend drawn as a benchmark mock draws its screen, so the pixel-match tool
// (tests/visual/mock-match) scores the page's style rather than its sample data (mock-fidelity-primitives-and-components.prd.md
// Q5, D67). A fixture sets only fields the app has; what the mock draws with no data behind it stays the app's own.
import { PRODUCTION_SCENARIOS } from '../productionMock';
import type { MockApiSeed } from './state';

export type MockFidelity = '01' | '05';

export const MOCK_FIDELITY: Record<MockFidelity, Partial<MockApiSeed>> = {
  // Benchmark 01-production-home: chapters 1-4 finished, 5 in proof, 6 in edit, 7 being recorded (the timer runs on it),
  // 8-12 not started; the opening credits finished; the mock's delivery date, hours and rate.
  '01': {
    production: PRODUCTION_SCENARIOS['mock-fidelity-01'],
    chapterStatuses: {
      'chapter-1': 'finalized',
      'chapter-2': 'finalized',
      'chapter-3': 'finalized',
      'chapter-4': 'finalized',
      'chapter-5': 'proofing',
      'chapter-6': 'editing',
      'chapter-7': 'recording',
      'chapter-8': 'not_started',
      'chapter-9': 'not_started',
      'chapter-10': 'not_started',
      'chapter-11': 'not_started',
      'chapter-12': 'not_started',
    },
    creditsStatuses: { opening: 'finalized', closing: 'editing' },
  },
  // Benchmark 05-master-delivery: the six rendered files of the book (the fifth over ACX's noise floor) to check, and ACX beside the
  // four other platforms the narrator has configured. The mock's invented wording and its OUTPUTS list stay the app's own.
  '05': { measure: 'mock-05', deliveryProfile: 'platforms' },
};

export const mockFidelityFrom = (value: string | null): MockFidelity | undefined => (value === '01' || value === '05' ? value : undefined);
