import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
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

// A download shows its bytes next to the message, outside the live region (they change on every poll, so only the progress bar carries them
// for a screen reader).
export const DownloadWithBytes: Story = {
  args: {
    title: 'Downloading preview voice',
    job: { ...runningJob, kind: 'asset_install', message: 'Downloading and verifying the approved voice…', detail: '44 of 109 MB', percent: 40, logs: [] },
  },
  play: async () => {
    const bar = await screen.findByRole('progressbar', { name: 'Downloading preview voice progress' });
    await expect(bar).toHaveAttribute('aria-valuetext', '44 of 109 MB');
    await expect(screen.getByRole('status')).not.toHaveTextContent('MB');
  },
};

// The import while it writes to the project has no Cancel, so it shows the notice.
export const Committing: Story = {
  args: {
    cancel: undefined,
    job: { ...runningJob, phase: 'committing', message: 'Writing manuscript to project', percent: 92, elapsed: 20.1 },
  },
};

// Some callers (Story Bible rebuild, an import that is writing) pass no cancel handler. The dialog stays blocking and says
// why nothing can be pressed: the notice describes the dialog, no empty action row is drawn, and focus rests on the body region.
export const RunningWithoutCancel: Story = {
  args: { title: 'Rebuild Story Bible', cancel: undefined },
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Rebuild Story Bible' });
    await expect(dialog).toHaveAccessibleDescription('This step cannot be cancelled. Close appears when it finishes.');
    await expect(screen.queryAllByRole('button')).toHaveLength(0);
    await expect(document.querySelector('[data-dialog-actions]')).toBeNull();
    // The body region is the only focus target, so focus is never lost.
    await waitFor(() => expect(document.activeElement).toBe(dialog.querySelector('[tabindex="0"]')));
  },
};

// A job the caller lets keep running (the Story Bible rebuild, ADR 0076): the notice says the window can be closed and a message
// will arrive, and Continue in background (and Escape) dismisses the dialog without stopping the job.
export const RunningInBackground: Story = {
  args: { title: 'Rebuild Story Bible', cancel: undefined, background: fn() },
  play: async ({ args }) => {
    const dialog = await screen.findByRole('dialog', { name: 'Rebuild Story Bible' });
    await expect(dialog).toHaveAccessibleDescription(/keeps running, and a message appears when it finishes/);
    await expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue in background' }));
    await expect(args.background).toHaveBeenCalledOnce();
    await expect(args.close).not.toHaveBeenCalled();
  },
};

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
