import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Heading } from './Heading';

// Heading renders the page-level <h1> by default, with an optional muted line under it. `level` changes the tag only
// (2 or 3 under another heading); the look is the same at every level.
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

// TracksPage puts the selected .rpp file's name here. A file name has no break opportunity, so it must wrap
// anywhere: this story is the atlas's sideways-overflow check for it at the narrow viewport.
export const LongUnbrokenSubtitle: Story = {
  args: {
    title: 'Tracks',
    children: 'The_Very_Long_Running_Series_Book_Three_The_Reckoning_chapter_twenty_seven_revised_v14_reviewed_by_editor_FINAL.rpp',
  },
};

// A section title under the page title: the outline reads 1, 2, 3 (axe's heading-order rule would flag a bare h2).
export const Levels: Story = {
  render: () => (
    <div className="space-y-2">
      <Heading title="Settings" />
      <Heading title="Story Bible defaults" level={2} />
      <Heading title="Extraction" level={3} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Story Bible defaults' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 3, name: 'Extraction' })).toBeVisible();
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
