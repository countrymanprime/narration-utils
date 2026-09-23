// The browser mock's take comparison (take review Phase 10), answering the way apps/desktop/takecompare_job.go does: the
// same refusals, a running job whose percent and stage advance one step per poll (standing in for the sidecar's own
// progress file, ADR 0015), and a finished comparison saved into the findings mock as a take_comparison finding, in the
// shape tests/fixtures/contracts/findings-list-take-comparison.json pins. The reads disagree on purpose, as the PRD's
// disagreement fixtures do: one reads every word but has a noisy room, another is clean but misreads a word and stops
// early. Nothing here ranks them (Q9). `hold` keeps a started comparison part way through.
import type { Finding, JobEnded, TakeComparisonEvidence, TakeComparisonJob, TakeComparisonMember, TakeMetrics, TakeReviewApi } from '../types';
import { takeReviewEvidenceSchema } from './schemas/takeReview';
import { WIRE_TAKE_REVIEW_FINDINGS, wireClone } from './mockFixtures';

type Store = { get: (id: string) => Promise<Finding>; save: (finding: Finding) => void };

const SPAN_TEXT = 'There was nothing so very remarkable in that; nor did Alice';
// The words of a read fill its range after a 0.3 s lead-in and before a 0.3 s tail.
const LEAD_SECONDS = 0.3;
const wordStep = (length: number, words: number): number => (length - 2 * LEAD_SECONDS) / words;

const STAGES: Array<[number, string]> = [
  [2, 'Transcribing take 1/2'],
  [48, 'Transcribing take 2/2'],
  [98, 'Writing results...'],
];

function metricsFor(
  read: number,
  source: { take_guid: string; source_file: string; source_start: number; source_length: number },
  spokenWords: number,
  spanWords: number,
): TakeMetrics {
  // Even reads are on the chapter track with a noisy room; odd ones are clean pickups on a track of their own, so they have no
  // neighbour to measure their level against.
  const noisy = read % 2 === 0;
  const speech = spokenWords * wordStep(source.source_length, spanWords);
  const length = source.source_length;
  const range = { start_seconds: source.source_start, length_seconds: length };
  const clipRuns = noisy
    ? []
    : [
        { channel: 0, start_seconds: 1.21, duration_seconds: 0.0002, samples: 4 },
        { channel: 0, start_seconds: 1.84, duration_seconds: 0.0001, samples: 3 },
      ];
  const integrated = noisy ? -18.6 : -21.1;
  return {
    take_guid: source.take_guid,
    take_index: 0,
    source: { file: source.source_file, kind: 'WAVE', range },
    audio: {
      file: source.source_file,
      sample_rate: 48000,
      channels: 1,
      duration_seconds: length,
      integrated_lufs: integrated,
      rms_dbfs: integrated - 3,
      sample_peak_dbfs: noisy ? -4.2 : 0,
      true_peak_dbtp: noisy ? -3.9 : 0.3,
      noise_floor_dbfs: noisy ? -47.6 : -68.9,
      digital_silent_windows: 0,
      full_scale_samples: noisy ? 0 : 7,
      clip_run_count: clipRuns.length,
      clip_runs: clipRuns,
      range,
    },
    clipping: { status: 'measured', full_scale_samples: noisy ? 0 : 7, clip_run_count: clipRuns.length, clip_runs: clipRuns },
    noise: { status: 'measured', noise_floor_dbfs: noisy ? -47.6 : -68.9, digital_silent_windows: 0 },
    level_consistency: noisy
      ? { status: 'measured', integrated_lufs: integrated, neighbor_median_lufs: -19.0, delta_lu: 0.4, neighbors_measured: 2, neighbors_unavailable: 0 }
      : {
          status: 'unavailable',
          reason: 'no neighbouring item has a measurable integrated loudness',
          integrated_lufs: integrated,
          neighbor_median_lufs: null,
          delta_lu: null,
          neighbors_measured: 0,
          neighbors_unavailable: 0,
        },
    duration: {
      status: 'measured',
      item_seconds: length,
      source_seconds: length,
      audio_seconds: length,
      speech_seconds: speech,
      words_per_minute: (spokenWords / speech) * 60,
    },
    pause_profile: {
      status: 'measured',
      min_pause_seconds: 0.3,
      long_pause_seconds: 2,
      count: noisy ? 1 : 0,
      total_seconds: noisy ? 0.6 : 0,
      longest_seconds: noisy ? 0.6 : 0,
      median_seconds: noisy ? 0.6 : 0,
      long_pauses: [],
      leading_seconds: LEAD_SECONDS,
      trailing_seconds: noisy ? LEAD_SECONDS : null,
    },
    coverage: noisy ? { measured: 5, total: 5, unavailable: [] } : { measured: 4, total: 5, unavailable: ['level_consistency'] },
  };
}

/** A read of the span: even reads say every word, odd ones misread the fifth word and stop three words early. */
function comparedMember(
  read: number,
  source: { item_guid: string; take_guid: string; source_file: string; source_start: number; source_length: number },
  words: string[],
): TakeComparisonMember {
  const clean = read % 2 === 0;
  const unreadFrom = clean ? words.length : words.length - 3;
  const step = wordStep(source.source_length, words.length);
  const at = (seconds: number) => Math.round(seconds * 1000) / 1000;
  const time = (index: number) => at(source.source_start + LEAD_SECONDS + index * step);
  const states = words.map((_, index) => {
    const status = index >= unreadFrom ? 'unread' : !clean && index === 4 ? 'misread' : 'matched';
    return status === 'unread' ? { index, status, start: null, end: null } : { index, status, start: time(index), end: at(time(index) + step * 0.8) };
  }) satisfies TakeComparisonMember['words'];
  const divergences: TakeComparisonMember['divergences'] = clean
    ? []
    : [
        {
          kind: 'misread',
          position: 'within',
          first_word: 4,
          last_word: 4,
          manuscript_text: words[4],
          audio_text: 'remarkably',
          start: time(4),
          end: at(time(4) + step * 0.8),
        },
        {
          kind: 'unread',
          position: 'after',
          first_word: unreadFrom,
          last_word: words.length - 1,
          manuscript_text: words.slice(unreadFrom).join(' '),
          audio_text: '',
          start: null,
          end: null,
        },
      ];
  const matched = states.filter((state) => state.status === 'matched').length;
  return {
    ...source,
    compared: true,
    fidelity: matched / words.length,
    counts: { matched, misread: clean ? 0 : 1, skipped: 0, unread: words.length - unreadFrom, extra_words: 0 },
    words: states,
    divergences,
    metrics: metricsFor(read, source, unreadFrom, words.length),
  };
}

/** The comparison the mock saves for a take-review group, or undefined for a finding that is not a comparable group. */
export function mockTakeComparisonOf(group: Finding): Finding | undefined {
  const parsed = takeReviewEvidenceSchema.safeParse(group.evidence);
  if (group.analyzer !== 'take-review' || !parsed.success || parsed.data.members.length < 2) return undefined;
  const words = SPAN_TEXT.split(' ');
  const evidence: TakeComparisonEvidence = {
    source_finding_id: group.id,
    span: {
      first_unit: parsed.data.matched_span_first,
      last_unit: parsed.data.matched_span_last,
      words: words.map((text, index) => ({ index, text, unit: parsed.data.matched_span_first, paragraph: 2 })),
    },
    model: 'small',
    compared: parsed.data.members.length,
    members: parsed.data.members.map(({ item_guid, take_guid, source_file, source_start, source_length }, read) =>
      comparedMember(read, { item_guid, take_guid, source_file, source_start, source_length }, words),
    ),
  };
  return {
    schema_version: 1,
    id: `c0${group.id.slice(2)}`,
    analyzer: 'take-comparison',
    project: group.project,
    source: {},
    manuscript: { chapter_id: 'chapter-1', chapter_title: group.manuscript?.chapter_title ?? 'Chapter 1', expected: SPAN_TEXT },
    category: 'take_comparison',
    severity: 'info',
    confidence: null,
    evidence_version: `e0${group.id.slice(2)}`,
    confidence_reason:
      "A comparison shows each take's evidence per category, side by side. It does not add the categories up or pick a take: you choose the take in REAPER.",
    evidence,
    review: { status: 'unreviewed' },
  };
}

function comparisonOf(group: Finding): Finding {
  const comparison = mockTakeComparisonOf(group);
  if (!comparison) throw new Error(`the mock fixture ${group.id} is not a comparable group`);
  return comparison;
}

/** The comparison of the fixture's pickup group, for tests. */
export const WIRE_TAKE_COMPARISON_FINDING = comparisonOf(WIRE_TAKE_REVIEW_FINDINGS[0]);

export function createTakeComparisonMock(
  store: Store,
  publish: (event: JobEnded) => void,
  hold = false,
): Pick<TakeReviewApi, 'takeComparisonStart' | 'takeComparisonState' | 'takeComparisonCancel'> {
  let job: TakeComparisonJob = {
    id: null,
    kind: 'take_comparison',
    phase: 'idle',
    message: 'Ready to compare takes.',
    percent: 0,
    logs: [],
    elapsed: 0,
    findingId: '',
  };
  let stage = 0;
  let comparison: Finding | undefined;

  const end = (phase: 'success' | 'cancelled', message: string) => {
    job = { ...job, phase, message, percent: phase === 'success' ? 100 : job.percent, logs: [...job.logs, message] };
    publish({ id: job.id ?? '', kind: 'take_comparison', outcome: phase, message, durationMs: Math.round(job.elapsed * 1000) });
  };

  const advance = () => {
    if (job.phase !== 'running' || hold) return;
    if (stage < STAGES.length) {
      const [percent, message] = STAGES[stage];
      stage += 1;
      job = { ...job, percent, message, logs: [...job.logs, message], elapsed: job.elapsed + 4 };
      return;
    }
    if (comparison) {
      store.save(comparison);
      job = { ...job, comparisonId: comparison.id };
    }
    end('success', "Compared the takes. Each one's evidence is shown side by side.");
  };

  return {
    takeComparisonStart: async (findingId) => {
      if (job.phase === 'running') throw new Error('a take comparison is already running');
      const group = await store.get(findingId).catch(() => {
        throw new Error('this group is not in the review list any more; reload the list');
      });
      comparison = mockTakeComparisonOf(group);
      if (!comparison) throw new Error('only a group of repeated reads from Find pickups and duplicates can be compared');
      const reads = takeReviewEvidenceSchema.safeParse(group.evidence);
      const message = `Comparing ${reads.success ? reads.data.members.length : 0} reads.`;
      stage = 0;
      job = { id: 'take-comparison-1', kind: 'take_comparison', phase: 'running', message, percent: 0, logs: [message], elapsed: 0, findingId };
      if (hold) {
        const [percent, stageMessage] = STAGES[1];
        job = { ...job, percent, message: stageMessage, logs: [message, STAGES[0][1], stageMessage], elapsed: 21 };
      }
      return wireClone(job);
    },
    takeComparisonState: async () => {
      advance();
      return wireClone(job);
    },
    takeComparisonCancel: async () => {
      if (job.phase === 'running') end('cancelled', 'Comparison cancelled. Nothing was saved.');
      return wireClone(job);
    },
  };
}
