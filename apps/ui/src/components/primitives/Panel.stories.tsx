import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';
import { Field } from './Field';
import { Heading } from './Heading';
import { InsetCard } from './InsetCard';
import { Panel, PanelHeader } from './Panel';
import { PANEL_FRAME_CLASS } from './panelStyles';
import { SectionLabel } from './SectionLabel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';

// Panel is a card: border, background, padding and shadow around whatever the caller passes. Given a `title` it is a
// named region (a level-2 heading and aria-labelledby) with a header row over a divider: the title, a `subtitle` on its
// line and `actions` at the right. `flush` drops the body's padding for a table; the sizes are benchmark mock 05's
// (ADR 0640).
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
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
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
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
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
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
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
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
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
        <p className="text-sm">
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

// Measured once the web fonts are in (a fallback face sets different line boxes), and only where there is layout: the
// stories' jsdom run (stories.test.tsx) lays nothing out.
async function laidOut(canvasElement: HTMLElement) {
  if (canvasElement.getBoundingClientRect().width === 0) return false;
  await document.fonts.ready;
  return true;
}

const px = (value: number) => Math.round(value);

// Benchmark mock 05's "Per-file checks" and "Mastering chain" cards: a 50 px header row (its divider included) with a
// Barlow 19 px title and a 13 px muted subtitle 10 px after it on the same line; the body 16 px in from the frame; an
// 8 px radius.
export const MatchesTheMock: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Master & QC" />
      <Panel title="Mastering chain" subtitle="one chain for the book · runs in REAPER as an FX chain">
        <p className="text-sm">Room-tone fill → De-click (light) → High-pass 80 Hz → Limiter −3.5 dBTP</p>
      </Panel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const region = canvas.getByRole('region', { name: 'Mastering chain' });
    const title = within(region).getByRole('heading', { level: 2, name: 'Mastering chain' });
    const subtitle = canvas.getByText(/one chain for the book/);
    if (!(await laidOut(canvasElement))) return;
    const header = title.parentElement!.parentElement!;
    await expect(px(header.getBoundingClientRect().height)).toBe(50);
    await expect(getComputedStyle(header).borderBottomWidth).toBe('1px');
    await expect(getComputedStyle(title).fontSize).toBe('19px');
    await expect(getComputedStyle(title).fontFamily).toContain('Barlow Condensed');
    await expect(getComputedStyle(title).fontWeight).toBe('600');
    await expect(getComputedStyle(subtitle).fontSize).toBe('13px');
    // Inline: on the title's line, 10 px after it.
    await expect(px(subtitle.getBoundingClientRect().left - title.getBoundingClientRect().right)).toBe(10);
    const frame = region.getBoundingClientRect();
    await expect(px(title.getBoundingClientRect().left - frame.left)).toBe(17);
    await expect(getComputedStyle(region).borderTopLeftRadius).toBe('8px');
    const body = canvas.getByText(/Room-tone fill/);
    await expect(px(body.getBoundingClientRect().left - frame.left)).toBe(17);
    await expect(px(body.getBoundingClientRect().top - header.getBoundingClientRect().bottom)).toBe(16);
  },
};

// Mock 05's "Why it fails": buttons in the header make it 55 px (11 px above and below a 32 px button, and the divider).
// Button is 38 px tall until the Button phase, so this measures the 11 px rather than the total.
export const HeaderWithActions: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Master & QC" />
      <Panel
        title="04 · Why it fails"
        actions={
          <>
            <Button variant="ghost">Quietest 5 s</Button>
            <Button variant="ghost">Open in REAPER</Button>
          </>
        }
      >
        <p className="text-sm">Noise floor −57.8 dB (limit −60). Steady hum at 60 Hz and 120 Hz.</p>
      </Panel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Open in REAPER' });
    if (!(await laidOut(canvasElement))) return;
    const header = canvas.getByRole('heading', { level: 2 }).parentElement!.parentElement!;
    const box = header.getBoundingClientRect();
    const narrow = box.width < 400;
    if (narrow) return;
    await expect(px(button.getBoundingClientRect().top - box.top)).toBe(11);
    await expect(px(box.bottom - 1 - button.getBoundingClientRect().bottom)).toBe(11);
    await expect(px(box.right - button.getBoundingClientRect().right)).toBe(17);
  },
};

// A table in a card runs to its edges under the divider (mock 05's per-file checks): `flush` drops the body's padding.
export const FlushTable: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Master & QC" />
      <Panel title="Per-file checks" subtitle="measured on the rendered files" flush>
        <Table label="Per-file checks">
          <TableHead>
            <TableRow>
              <TableHeader>File</TableHeader>
              <TableHeader align="right">Length</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>00 Opening credits</TableCell>
              <TableCell numeric>0:12</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>01 Down the Rabbit-Hole</TableCell>
              <TableCell numeric>11:48</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Panel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const region = canvas.getByRole('region', { name: 'Per-file checks' });
    const table = canvas.getByRole('table', { name: 'Per-file checks' });
    if (!(await laidOut(canvasElement))) return;
    const frame = region.getBoundingClientRect();
    const header = canvas.getByRole('heading', { level: 2 }).parentElement!.parentElement!;
    await expect(px(table.getBoundingClientRect().left)).toBe(px(frame.left + 1));
    await expect(px(table.getBoundingClientRect().right)).toBe(px(frame.right - 1));
    await expect(px(table.getBoundingClientRect().top)).toBe(px(header.getBoundingClientRect().bottom));
  },
};

// Some text above the table keeps its padding, and `Table flush` spans exactly the body's padding.
export const FlushTableUnderText: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Tracks" />
      <Panel title="Tracks">
        <p className="mb-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Every track in the linked REAPER project.
        </p>
        <Table label="Tracks" flush>
          <TableHead>
            <TableRow>
              <TableHeader>Track</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>Narration</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Panel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const region = canvas.getByRole('region', { name: 'Tracks' });
    const table = canvas.getByRole('table', { name: 'Tracks' });
    if (!(await laidOut(canvasElement))) return;
    const frame = region.getBoundingClientRect();
    await expect(px(table.getBoundingClientRect().left)).toBe(px(frame.left + 1));
    await expect(px(table.getBoundingClientRect().right)).toBe(px(frame.right - 1));
  },
};

// A bare card named for a screen reader without a visible title.
export const LabelledWithoutTitle: Story = {
  render: () => (
    <Panel label="Where you stopped">
      <p className="text-sm">You stopped at “the rabbit-hole went straight on like a tunnel”.</p>
    </Panel>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Where you stopped' })).toBeVisible();
  },
};

// Something leads the title (the Story Bible's category dot), and the subtitle can hold a control.
export const LeadingAndRichSubtitle: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Story Bible" />
      <Panel
        title="Marra Venn"
        leading={<span className="size-2.5 rounded-full" style={{ background: 'var(--accent)' }} />}
        subtitle={<Button variant="ghost">Character</Button>}
      >
        <p className="text-sm">Captain of the river watch.</p>
      </Panel>
    </div>
  ),
};

// The narrator's attention is needed: the frame takes the review colour.
export const ReviewTone: Story = {
  render: () => (
    <Panel tone="review">
      <p className="text-sm">
        <strong>The credits need 2 values</strong> before they can be read.
      </p>
    </Panel>
  ),
};

// The body scrolls under a header that stays put, inside the height the page gives the card.
export const ScrollingBody: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Story Bible" />
      <Panel title="Aliases" scroll className="h-64">
        <ul className="space-y-2 text-sm">
          {Array.from({ length: 20 }, (_, index) => (
            <li key={index}>Alias {index + 1}</li>
          ))}
        </ul>
      </Panel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole('heading', { level: 2, name: 'Aliases' });
    if (!(await laidOut(canvasElement))) return;
    const body = canvas.getByText('Alias 1').closest('ul')!.parentElement!;
    await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    await expect(heading).toBeVisible();
  },
};

// A card that is not a section of its own (a TabPanel drawn as a card) takes the header row on its own, with the eyebrow
// label and an inset card inside the body.
export const HeaderOnItsOwn: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Settings" />
      <div role="group" aria-labelledby="settings-title" className={PANEL_FRAME_CLASS}>
        <PanelHeader title="Keyboard" titleId="settings-title" subtitle="Global defaults" />
        <div className="space-y-2 p-4">
          <SectionLabel as="h3">Transport</SectionLabel>
          <InsetCard>Play or pause: Space</InsetCard>
        </div>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('group', { name: 'Keyboard' })).toBeVisible();
  },
};
