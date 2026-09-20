import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Heading } from './Heading';

// Heading has no level or variant prop: it always renders the page-level <h1>
// with an optional muted line under it, so the stories vary only the content.
const meta = {
  title: 'Primitives/Heading',
  component: Heading,
  args: { title: 'Tracks' },
} satisfies Meta<typeof Heading>;

export default meta;
type Story = StoryObj<typeof meta>;

// Settings, Manuscript, Story Bible and Proofing use the bare title.
export const TitleOnly: Story = { args: { title: 'Settings' } };

export const WithSubtitle: Story = { args: { title: 'Tracks', children: 'Detected from the project’s REAPER file.' } };

// Home passes inline markup, so children must accept more than a string.
export const WithRichSubtitle: Story = {
  args: {
    title: 'Welcome back',
    children: (
      <>
        Project folder: <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]">…/the-salt-road/</span>
      </>
    ),
  },
};

// text-balance keeps a wrapped title from ending on an orphaned word.
export const LongTitleWraps: Story = {
  args: {
    title: 'The complete unabridged audiobook production notes for the second volume of the salt road trilogy',
    children: 'Wraps onto several lines on narrow screens without overflowing.',
  },
};

export const LongSubtitleWraps: Story = {
  args: {
    title: 'Tracks',
    children:
      'Detected from the project’s REAPER file, which lists every recorded chapter and its takes. Re-scan the folder after saving the project to pick up new tracks.',
  },
};

export const RendersLevelOneHeading: Story = {
  args: { title: 'Settings', children: 'Global and project defaults.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(canvas.getByText('Global and project defaults.')).toBeVisible();
  },
};

// No children means no empty subtitle paragraph is left behind.
export const TitleOnlyOmitsSubtitle: Story = {
  args: { title: 'Settings' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('p')).toBeNull();
  },
};
