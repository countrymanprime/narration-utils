import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ message }: { message: string }): never {
  throw new Error(message);
}

// The boundary always logs a caught error through console.error (its own
// componentDidCatch, plus React itself), and the atlas runner fails any story that
// logs one. The log is expected here, so mute it for the throwing stories only and
// put the real function back when the story is torn down.
const muteExpectedRenderErrorLog = () => {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
};

// Fixing the cause happens outside the boundary (it stays on the fallback until
// reset), then "Try again" re-renders the children, which no longer throw.
function RecoveryDemo({ onError }: { onError?: (error: unknown) => void }) {
  const [repaired, setRepaired] = useState(false);
  return (
    <>
      <div className="p-6 pb-0">
        <Button variant="ghost" onClick={() => setRepaired(true)}>
          Repair chapter data
        </Button>
      </div>
      <ErrorBoundary onError={onError}>{repaired ? <p>Chapter 1 loaded without problems.</p> : <Bomb message="Chapter 1 has no text" />}</ErrorBoundary>
    </>
  );
}

const meta = {
  title: 'Primitives/ErrorBoundary',
  component: ErrorBoundary,
  args: { children: <p>Chapter 1 loaded without problems.</p>, onError: fn() },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Chapter 1 loaded without problems.')).toBeVisible();
    await expect(canvas.queryByText('Something went wrong')).toBeNull();
    await expect(args.onError).not.toHaveBeenCalled();
  },
};

export const ChildThrows: Story = {
  args: { children: <Bomb message="Cannot read properties of undefined (reading 'chapters')" /> },
  beforeEach: muteExpectedRenderErrorLog,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Something went wrong')).toBeVisible();
    await expect(canvas.getByText("Error: Cannot read properties of undefined (reading 'chapters')")).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(args.onError).toHaveBeenCalledOnce();
  },
};

export const TryAgainRecovers: Story = {
  render: (args) => <RecoveryDemo onError={args.onError} />,
  beforeEach: muteExpectedRenderErrorLog,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Something went wrong')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Repair chapter data' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.getByText('Chapter 1 loaded without problems.')).toBeVisible();
    await expect(canvas.queryByText('Something went wrong')).toBeNull();
  },
};
