import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';
import { Field } from './Field';
import { Heading } from './Heading';
import { Panel } from './Panel';

// Panel is only a surface: border, background, padding and shadow around
// whatever the caller passes. It has no header or actions slot, so those
// stories compose the same markup the real pages put inside it.
const meta = {
  title: 'Primitives/Panel',
  component: Panel,
  args: { children: 'No narratable manuscript chapters found yet. Select a manuscript from Home to see an audiobook estimate.' },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

// AudiobookEstimatePanel renders bare text for its empty state.
export const TextOnly: Story = {};

// TracksPage: a semibold title line and a muted explanation.
export const TitleAndDescription: Story = {
  args: {
    children: (
      <>
        <div className="font-semibold">No REAPER project file found</div>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          This project folder doesn&rsquo;t contain a .rpp file. Save your REAPER project into the folder, then reopen this page.
        </p>
      </>
    ),
  },
};

const onUseFile = fn();

// The section heading is an <h2> beneath the page's <h1>; a Panel titled with
// an <h2> and no <h1> above it would trip axe's heading-order rule.
export const WithHeaderAndActions: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Tracks">Detected from the project’s REAPER file.</Heading>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Choose a REAPER project file</h2>
          <div className="flex gap-2">
            <Button variant="ghost">Rescan folder</Button>
            <Button onClick={onUseFile}>Use this file</Button>
          </div>
        </div>
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
      <Panel>
        <h2 className="font-medium">Choose manuscript chapter</h2>
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
      <Panel>
        <h2 className="font-medium">Marra Venn</h2>
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
      <Panel>
        <h2 className="font-medium">Chapter 12: The Salt Road</h2>
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
