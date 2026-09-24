import { describe, expect, it } from 'vitest';
import type { JobEnded } from './api/contracts/system';
import { notificationForJobEnd, shouldNotifyForJobEnd, toastForJobEnd } from './jobEnded';

const ended = (patch: Partial<JobEnded>): JobEnded => ({
  id: 'job-1',
  kind: 'story_bible',
  outcome: 'success',
  message: 'Story Bible rebuild complete.',
  durationMs: 4200,
  ...patch,
});

describe('toastForJobEnd', () => {
  it('says what the host said when a job that can finish elsewhere succeeds', () => {
    expect(toastForJobEnd(ended({}))).toEqual({ text: 'Story Bible rebuild complete.', tone: 'info' });
    expect(toastForJobEnd(ended({ kind: 'transcript_compare', message: 'Comparison complete.' }))).toEqual({ text: 'Comparison complete.', tone: 'info' });
  });

  it('makes a failure an error, which stays until it is dismissed', () => {
    expect(toastForJobEnd(ended({ outcome: 'error', message: 'The build failed.' }))).toEqual({ text: 'The build failed.', tone: 'error' });
  });

  it('says something even when the host sent no message', () => {
    expect(toastForJobEnd(ended({ outcome: 'error', message: '' }))?.text).toBeTruthy();
    expect(toastForJobEnd(ended({ message: '' }))?.text).toBeTruthy();
  });

  it('says nothing about a job the narrator cancelled', () => {
    expect(toastForJobEnd(ended({ outcome: 'cancelled', message: 'Comparison cancelled.' }))).toBeUndefined();
  });

  it('leaves the jobs whose modal dialog is on screen to that dialog', () => {
    for (const kind of ['manuscript_import', 'tts_install', 'whisper_install', 'dictionary_install', 'app_update']) {
      expect(toastForJobEnd(ended({ kind })), kind).toBeUndefined();
    }
  });

  it('announces a kind it has never heard of, because a newer host may add jobs', () => {
    expect(toastForJobEnd(ended({ kind: 'future_job', message: 'Done.' }))).toEqual({ text: 'Done.', tone: 'info' });
  });
});

describe('shouldNotifyForJobEnd (N1-N4)', () => {
  it('never notifies while the window is focused (N1)', () => {
    expect(shouldNotifyForJobEnd(ended({ durationMs: 20_000 }), true)).toBe(false);
  });

  it('notifies for a qualifying job that ran 10s or more while unfocused (N3)', () => {
    for (const kind of [
      'story_bible',
      'tts_install',
      'whisper_install',
      'spacy_install',
      'transcript_compare',
      'manuscript_import',
      'recording_coverage',
      'take_review',
      'take_comparison',
      'measurement',
      'diagnostics',
    ]) {
      expect(shouldNotifyForJobEnd(ended({ kind, durationMs: 10_000 }), false), kind).toBe(true);
    }
  });

  it('stays quiet for a fast job so a sub-10s job is not worth interrupting for (N3)', () => {
    expect(shouldNotifyForJobEnd(ended({ durationMs: 9_999 }), false)).toBe(false);
  });

  it('says nothing about a job the narrator cancelled', () => {
    expect(shouldNotifyForJobEnd(ended({ outcome: 'cancelled', durationMs: 60_000 }), false)).toBe(false);
  });

  it('stays quiet for a kind not in the notifiable set, because a newer host may add jobs this PRD did not review', () => {
    expect(shouldNotifyForJobEnd(ended({ kind: 'future_job', durationMs: 60_000 }), false)).toBe(false);
  });
});

describe('notificationForJobEnd', () => {
  it('uses the host message as the body and says what finished', () => {
    expect(notificationForJobEnd(ended({ message: 'Story Bible rebuild complete.' }))).toEqual({
      title: 'Task finished',
      body: 'Story Bible rebuild complete.',
    });
  });

  it('titles a failure differently and still carries the host message', () => {
    expect(notificationForJobEnd(ended({ outcome: 'error', message: 'The build failed.' }))).toEqual({
      title: 'Task failed',
      body: 'The build failed.',
    });
  });
});
