// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkJob } from '../../types';
import { WorkDialog } from './WorkDialog';

afterEach(cleanup);

const job = (patch: Partial<WorkJob>): WorkJob => ({
  id: 'job-1',
  kind: 'manuscript_import',
  phase: 'running',
  message: 'Parsing chapter 4 of 12',
  percent: 35,
  elapsed: 12,
  logs: [],
  ...patch,
});

const PHASES: WorkJob['phase'][] = ['preparing', 'running', 'committing', 'success', 'error', 'cancelled'];

describe('WorkDialog', () => {
  it('never leaves a dialog with nothing to press and nothing said about it', () => {
    // Every phase, with and without a cancel handler: a control to press, or the dialog says why there is none.
    for (const phase of PHASES) {
      for (const cancel of [undefined, vi.fn()]) {
        render(<WorkDialog title="Rebuild Story Bible" job={job({ phase })} close={vi.fn()} cancel={cancel} />);
        const dialog = screen.getByRole('dialog', { name: 'Rebuild Story Bible' });
        const buttons = dialog.querySelectorAll('button');
        const describedBy = dialog.getAttribute('aria-describedby');
        const explained = /cannot be cancelled/.test((describedBy && document.getElementById(describedBy)?.textContent) || '');
        expect(buttons.length > 0 || explained, `${phase} ${cancel ? 'with' : 'without'} cancel`).toBe(true);
        cleanup();
      }
    }
  });

  it('says a running job cannot be cancelled when it has no Cancel, and describes the dialog with it', () => {
    render(<WorkDialog title="Rebuild Story Bible" job={job({ phase: 'running' })} close={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Rebuild Story Bible' });
    expect(screen.getByText(/cannot be cancelled/i).closest('[id]')?.id).toBe(dialog.getAttribute('aria-describedby'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders no empty action row while a job with no Cancel runs', () => {
    render(<WorkDialog title="Rebuild Story Bible" job={job({ phase: 'committing' })} close={vi.fn()} />);
    expect(document.querySelector('[data-dialog-actions]')).toBeNull();
  });

  it('shows Cancel and no explanation while a cancellable job runs', () => {
    render(<WorkDialog title="Import manuscript" job={job({ phase: 'preparing' })} close={vi.fn()} cancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(document.querySelector('[data-dialog-actions]')).not.toBeNull();
    expect(screen.queryByText(/cannot be cancelled/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('offers Close, and no explanation, once the job has finished', () => {
    for (const phase of ['success', 'error', 'cancelled'] as const) {
      render(<WorkDialog title="Rebuild Story Bible" job={job({ phase, percent: 100 })} close={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
      expect(screen.queryByText(/cannot be cancelled/i)).toBeNull();
      cleanup();
    }
  });

  it('slides and fills only for people who have not asked for reduced motion', () => {
    render(<WorkDialog title="Rebuild Story Bible" job={job({ percent: 0 })} close={vi.fn()} />);
    const fill = document.querySelector('.progressbar > div');
    expect(fill).not.toBeNull();
    const classes = (fill as HTMLElement).className.split(/\s+/);
    expect(classes).toContain('motion-safe:animate-[work-progress-slide_1.15s_ease-in-out_infinite]');
    expect(classes).toContain('motion-safe:transition-[width]');
    expect(classes.filter((c) => /^(animate|transition)-/.test(c))).toEqual([]);
  });
});
