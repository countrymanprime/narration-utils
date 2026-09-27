import type { Meta, StoryObj } from '@storybook/react-vite';
import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { IconButton } from './IconButton';
import { TagInput } from './TagInput';
import { TooltipTarget } from './Tooltip';

// The caller owns the lists (as the Proofing page does): the component only reports what the user did.
function Hints(props: ComponentProps<typeof TagInput>) {
  const [tags, setTags] = useState([...props.tags]);
  const [suggestions, setSuggestions] = useState([...props.suggestions]);
  return (
    <div className="max-w-xl">
      <TagInput
        {...props}
        tags={tags}
        suggestions={suggestions}
        onAdd={(text) => {
          setTags((current) => [...current, text.trim()]);
          props.onAdd(text);
        }}
        onRemove={(tag) => {
          setTags((current) => current.filter((item) => item !== tag));
          props.onRemove(tag);
        }}
        onAcceptSuggestion={(term) => {
          setSuggestions((current) => current.filter((item) => item !== term));
          setTags((current) => [...current, term]);
          props.onAcceptSuggestion(term);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Primitives/TagInput',
  component: TagInput,
  args: {
    label: 'Vocabulary hints',
    inputLabel: 'Add a vocabulary term',
    placeholder: 'Add a term…',
    tags: ['Wonderland', 'Cheshire'],
    suggestions: ['Mad Hatter'],
    emptyText: 'No hints yet — add one, or suggest from the manuscript.',
    onAdd: fn(),
    onRemove: fn(),
    onAcceptSuggestion: fn(),
    actions: (
      <TooltipTarget text="Suggest from manuscript">
        <IconButton label="Suggest from manuscript">
          <FontAwesomeIcon icon={faWandMagicSparkles} />
        </IconButton>
      </TooltipTarget>
    ),
  },
  render: (args) => <Hints {...args} />,
} satisfies Meta<typeof TagInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { tags: [], suggestions: [] } };
export const OnlySuggestions: Story = { args: { tags: [], suggestions: ['Wonderland', 'Cheshire'] } };

// Typing a term and pressing Enter reports it once, empties the box and the chip appears - the pill box is the whole
// input, so there is no separate Add row to press instead.
export const EnterAddsATerm: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole('textbox', { name: 'Add a vocabulary term' });
    await userEvent.type(box, 'Dormouse{Enter}');
    await expect(args.onAdd).toHaveBeenCalledTimes(1);
    await expect(args.onAdd).toHaveBeenLastCalledWith('Dormouse');
    await expect(box).toHaveValue('');
    await expect(canvas.getByRole('button', { name: 'Remove Dormouse' })).toBeVisible();
  },
};

// A typed comma commits the draft immediately, the same as Enter (V5): a term never holds a comma.
export const CommaAddsATerm: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole('textbox', { name: 'Add a vocabulary term' });
    await userEvent.type(box, 'Dormouse,');
    await expect(args.onAdd).toHaveBeenLastCalledWith('Dormouse');
    await expect(box).toHaveValue('');
  },
};

// Clicking away from a half-typed draft commits it too (ADR 0055's blur-commit), so a click on Remove, Suggest or a
// page's own submit button never silently drops what was just typed.
export const BlurCommitsTheDraft: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole('textbox', { name: 'Add a vocabulary term' });
    await userEvent.type(box, 'Dormouse');
    await userEvent.click(canvas.getByRole('button', { name: 'Suggest from manuscript' }));
    await expect(args.onAdd).toHaveBeenLastCalledWith('Dormouse');
  },
};

// Backspace on an empty draft removes the most recently added tag (ADR 0363).
export const BackspaceRemovesTheLastTag: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole('textbox', { name: 'Add a vocabulary term' });
    await userEvent.click(box);
    await userEvent.keyboard('{Backspace}');
    await expect(args.onRemove).toHaveBeenLastCalledWith('Cheshire');
    await expect(canvas.queryByRole('button', { name: 'Remove Cheshire' })).toBeNull();
  },
};

export const BlankIsNotAdded: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Add a vocabulary term' }), '   {Enter}');
    await expect(args.onAdd).not.toHaveBeenCalled();
  },
};

// Removing a chip reports it and puts the cursor back in the typing box (the cross that had focus is gone).
export const RemovingKeepsTheCursorInThePage: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Cheshire' }));
    await expect(args.onRemove).toHaveBeenLastCalledWith('Cheshire');
    await expect(canvas.getByRole('textbox', { name: 'Add a vocabulary term' })).toHaveFocus();
  },
};

export const AcceptingASuggestion: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '+ Mad Hatter' }));
    await expect(args.onAcceptSuggestion).toHaveBeenLastCalledWith('Mad Hatter');
    await expect(canvas.getByRole('button', { name: 'Remove Mad Hatter' })).toBeVisible();
  },
};
