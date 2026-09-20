import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import type { WorkJob } from '../../types';
import { screen } from './portalScreen';
import { WorkDialog } from './WorkDialog';

const runningJob: WorkJob = {
  id: 'job-1',
  kind: 'manuscript_import',
  phase: 'running',
  message: 'Parsing chapter 4 of 12',
  percent: 35,
  elapsed: 12.6,
  logs: ['Reading source file', 'Detected 12 chapters', 'Parsing chapter 1 of 12', 'Parsing chapter 2 of 12', 'Parsing chapter 3 of 12'],
};

const longPath =
  'C:/Users/author/Documents/Manuscripts/The_Very_Long_Running_Series/Book_Three_The_Reckoning/Drafts/Final/chapter_twenty_seven_the_long_way_home_revised_v14_reviewed_by_editor_FINAL.docx';

const meta = {
  title: 'Primitives/WorkDialog',
  component: WorkDialog,
  args: { title: 'Import manuscript', job: runningJob, close: fn(), cancel: fn() },
} satisfies Meta<typeof WorkDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// Busy states show Cancel (when a cancel handler is wired) and never Close.
export const Preparing: Story = {
  args: { job: { ...runningJob, phase: 'preparing', message: 'Reading source file', percent: 5, elapsed: 1.2, logs: ['Reading source file'] } },
};

// percent 0 while running is the indeterminate state: the bar slides instead of filling, and no value is announced.
export const RunningIndeterminate: Story = {
  args: { job: { ...runningJob, message: 'Starting', percent: 0, elapsed: 0.4, logs: [] } },
  play: async () => {
    const bar = await screen.findByRole('progressbar', { name: 'Import manuscript progress' });
    await expect(bar).not.toHaveAttribute('aria-valuenow');
  },
};

// A determinate job announces its value, and its message is a live region.
export const RunningWithProgress: Story = {
  play: async () => {
    await expect(await screen.findByRole('progressbar', { name: 'Import manuscript progress' })).toHaveAttribute('aria-valuenow', '35');
    await expect(screen.getByRole('status')).toHaveTextContent('Parsing chapter 4 of 12');
  },
};

export const Committing: Story = {
  args: { job: { ...runningJob, phase: 'committing', message: 'Writing manuscript to project', percent: 92, elapsed: 20.1 } },
};

// Some callers (Story Bible rebuild) pass no cancel handler, so a running job has no actions at all.
export const RunningWithoutCancel: Story = { args: { title: 'Rebuild Story Bible', cancel: undefined } };

export const Success: Story = {
  args: {
    job: { ...runningJob, phase: 'success', message: 'Imported 12 chapters', percent: 100, elapsed: 24.9, logs: [...runningJob.logs, 'Wrote 12 chapters'] },
  },
};

// A failed job shows the error text in place of the progress message, announced as an alert.
export const ErrorState: Story = {
  args: {
    job: { ...runningJob, phase: 'error', error: 'Could not read chapter 4: unsupported encoding', elapsed: 13.2 },
  },
  play: async () => {
    await expect(await screen.findByRole('alert')).toHaveTextContent('Could not read chapter 4');
  },
};

export const Cancelled: Story = {
  args: { job: { ...runningJob, phase: 'cancelled', message: 'Import cancelled', elapsed: 14 } },
};

// ADR 0001: long unbroken tokens in the message and log lines must wrap, and many log lines scroll inside the log box.
export const LongLogs: Story = {
  args: {
    job: {
      ...runningJob,
      message: `Parsing ${longPath}`,
      logs: [...Array.from({ length: 30 }, (_, index) => `Parsing paragraph ${index + 1} of 214`), `Warning: ${longPath} has an unrecognised style`],
    },
  },
};

// While a job runs only Cancel is offered; Close appears once it finishes.
export const CancelInvokesCancel: Story = {
  play: async ({ args }) => {
    await screen.findByRole('button', { name: 'Cancel' });
    await expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(args.cancel).toHaveBeenCalledOnce();
    await expect(args.close).not.toHaveBeenCalled();
  },
};

// Escape does not stop a running job (Cancel is a deliberate action) and is not the way out of it either.
export const EscapeIsIgnoredWhileRunning: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Import manuscript' });
    await userEvent.keyboard('{Escape}');
    await expect(args.cancel).not.toHaveBeenCalled();
    await expect(args.close).not.toHaveBeenCalled();
    await expect(screen.getByRole('dialog', { name: 'Import manuscript' })).toBeVisible();
  },
};

export const CloseInvokesCloseWhenFinished: Story = {
  args: { job: { ...runningJob, phase: 'success', message: 'Imported 12 chapters', percent: 100, elapsed: 24.9 } },
  play: async ({ args }) => {
    await screen.findByRole('button', { name: 'Close' });
    await expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await expect(args.close).toHaveBeenCalledOnce();
    await expect(args.cancel).not.toHaveBeenCalled();
  },
};

// Once the job has finished Escape works as Close.
export const EscapeClosesWhenFinished: Story = {
  args: { job: { ...runningJob, phase: 'success', message: 'Imported 12 chapters', percent: 100, elapsed: 24.9 } },
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Import manuscript' });
    await userEvent.keyboard('{Escape}');
    await expect(args.close).toHaveBeenCalledOnce();
  },
};
