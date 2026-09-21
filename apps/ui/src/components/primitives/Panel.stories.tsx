import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';
import { Field } from './Field';
import { Heading } from './Heading';
import { Panel } from './Panel';

// Panel is a surface: border, background, padding and shadow around whatever the caller passes. Given a `title` it is a
// named region (a level-2 heading and aria-labelledby), and `actions` sit beside the title.
const meta = {
  title: 'Primitives/Panel',
  component: Panel,
  args: { children: 'No narratable manuscript chapters found yet. Select a manuscript from Home to see an audiobook estimate.' },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

// AudiobookEstimatePanel renders bare text for its empty state.
export const TextOnly: Story = {};

// TracksPage: a title and a muted explanation. The title is a level-2 heading and names the region.
export const TitleAndDescription: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Tracks" />
      <Panel title="No REAPER project file found">
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          This project folder doesn&rsquo;t contain a .rpp file. Save your REAPER project into the folder, then reopen this page.
        </p>
      </Panel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const region = within(canvasElement).getByRole('region', { name: 'No REAPER project file found' });
    await expect(within(region).getByRole('heading', { level: 2, name: 'No REAPER project file found' })).toBeVisible();
  },
};

// A title that is one long unbroken token (a file name) wraps inside the panel instead of overflowing it.
export const LongTitleWraps: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Tracks" />
      <Panel
        title="The_Very_Long_Running_Series_Book_Three_The_Reckoning_chapter_twenty_seven_revised_v14_FINAL.rpp"
        actions={<Button variant="ghost">Rescan folder</Button>}
      >
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          The title wraps and the action stays beside it.
        </p>
      </Panel>
    </div>
  ),
};

const onUseFile = fn();

// The title is an <h2> beneath the page's <h1>; a Panel titled with an <h2> and no <h1> above it would trip axe's
// heading-order rule.
export const WithHeaderAndActions: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Tracks">Detected from the project’s REAPER file.</Heading>
      <Panel
        title="Choose a REAPER project file"
        actions={
          <>
            <Button variant="ghost">Rescan folder</Button>
            <Button onClick={onUseFile}>Use this file</Button>
          </>
        }
      >
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          More than one .rpp file was found in this project folder. Choose which one to read tracks from.
        </p>
      </Panel>
    </div>
  ),
  // Controls placed inside the surface stay clickable (nothing in Panel swallows events).
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Use this file' }));
    await expect(onUseFile).toHaveBeenCalledOnce();
  },
};

export const WithHeaderNoActions: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Proofing" />
      <Panel title="Choose manuscript chapter">
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          The track name did not confidently match a chapter.
        </p>
      </Panel>
    </div>
  ),
};

export const WithFormFields: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Story Bible" />
      <Panel title="Marra Venn">
        <Field label="Description" textarea value="Captain of the river watch. Speaks slowly and keeps a ledger of every favour she is owed." onChange={fn()} />
        <Field label="Timeline context" value="Spring, three winters after the siege" onChange={fn()} />
      </Panel>
    </div>
  ),
};

// Long unbroken prose plus a long list: the panel grows with its content and
// must not overflow sideways at narrow widths.
export const LongContent: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Manuscript" />
      <Panel title="Chapter 12: The Salt Road">
        <p className="mt-2 text-sm">
          The caravan left the lower city before dawn, when the fog off the estuary still hid the harbour lamps and the only sound was the creak of axles on wet
          stone. Marra rode at the rear, counting wagons the way she counted everything: twice, and then once more when she was sure no one was watching her
          lips move. By the time the sun cleared the eastern wall the road had narrowed to a causeway of packed salt, white as bone on either side of the ruts,
          and the drivers had stopped singing.
        </p>
        <p className="mt-2 text-sm">
          Nobody spoke of the toll house. It stood a mile ahead where it had always stood, shuttered and dark, and every one of them knew that a dark toll house
          meant either that the keeper had died or that someone had paid him to look elsewhere.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {Array.from({ length: 12 }, (_, index) => (
            <li key={index}>
              Scene {index + 1}: the caravan halts at milepost {index + 1} and the drivers argue over whether to press on before the tide turns.
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  ),
};
