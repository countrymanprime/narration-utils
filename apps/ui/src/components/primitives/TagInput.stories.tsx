import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';
import { TagInput } from './TagInput';

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
    actions: <Button variant="ghost">Suggest from manuscript</Button>,
  },
  render: (args) => <Hints {...args} />,
} satisfies Meta<typeof TagInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { tags: [], suggestions: [] } };
export const OnlySuggestions: Story = { args: { tags: [], suggestions: ['Wonderland', 'Cheshire'] } };

// Typing a term and pressing Enter (or Add) reports it once, empties the box and the chip appears.
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

export const AddButtonAddsATerm: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Add a vocabulary term' }), 'Dormouse');
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }));
    await expect(args.onAdd).toHaveBeenLastCalledWith('Dormouse');
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
