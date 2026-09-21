import { describe, expect, it } from 'vitest';
import type { JobEnded } from './api/contracts/system';
import { toastForJobEnd } from './jobEnded';

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
    for (const kind of ['manuscript_import', 'tts_install', 'whisper_install', 'app_update']) {
      expect(toastForJobEnd(ended({ kind })), kind).toBeUndefined();
    }
  });

  it('announces a kind it has never heard of, because a newer host may add jobs', () => {
    expect(toastForJobEnd(ended({ kind: 'future_job', message: 'Done.' }))).toEqual({ text: 'Done.', tone: 'info' });
  });
});
