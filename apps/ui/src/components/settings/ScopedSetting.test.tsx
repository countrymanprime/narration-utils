// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScopedSettingField } from '../../api/contracts/system';
import { TooltipProvider } from '../primitives/Tooltip';
import { ScopedSetting } from './ScopedSetting';

afterEach(cleanup);

const FIELD: ScopedSettingField = {
  key: 'model_size',
  label: 'Model size',
  kind: 'choice',
  choices: ['base', 'small'],
  value: '',
  isSet: false,
  effectiveValue: 'base',
  effectiveSource: 'default',
};

function renderSetting(field: ScopedSettingField, change = vi.fn()) {
  render(
    <TooltipProvider>
      <ScopedSetting field={field} scope="global" value={field.value} change={change} onClearOverride={() => undefined} />
    </TooltipProvider>,
  );
  return change;
}

describe('ScopedSetting controls', () => {
  it('shows a choice as a named select and reports the chosen value', () => {
    const change = renderSetting(FIELD);
    const select = screen.getByRole('combobox', { name: 'Model size' }) as HTMLSelectElement;
    expect(select.value).toBe('base');
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['base', 'small']);
    fireEvent.change(select, { target: { value: 'small' } });
    expect(change).toHaveBeenCalledWith('small');
  });

  it('shows text as a named text box and reports what is typed', () => {
    const change = renderSetting({ ...FIELD, key: 'note', label: 'Note label', kind: 'text', choices: [], effectiveValue: 'Note' });
    const box = screen.getByRole('textbox', { name: 'Note label' }) as HTMLInputElement;
    expect(box.value).toBe('Note');
    fireEvent.change(box, { target: { value: 'Narrator note' } });
    expect(change).toHaveBeenCalledWith('Narrator note');
  });

  it('shows a colour as a picker and a hex box that store the value without the hash, in capitals', () => {
    const change = renderSetting({ ...FIELD, key: 'color_note', label: 'Note color', kind: 'color', choices: [], effectiveValue: 'ffd54f' });
    const picker = screen.getByLabelText('Note color hex') as HTMLInputElement;
    expect(picker.type).toBe('color');
    expect(picker.value).toBe('#ffd54f');
    fireEvent.change(picker, { target: { value: '#a1b2c3' } });
    expect(change).toHaveBeenLastCalledWith('A1B2C3');
    fireEvent.change(screen.getByRole('textbox', { name: 'Note color' }), { target: { value: '#ff8800' } });
    expect(change).toHaveBeenLastCalledWith('FF8800');
  });

  it('shows a neutral grey in the picker for an unset colour and "Not set" in the box', () => {
    renderSetting({ ...FIELD, key: 'color_note', label: 'Note color', kind: 'color', choices: [], effectiveValue: '' });
    expect((screen.getByLabelText('Note color hex') as HTMLInputElement).value).toBe('#808080');
    expect(screen.getByPlaceholderText('Not set')).toBeTruthy();
  });

  it('offers Reset on a project setting that has an override, and reports it', () => {
    const clear = vi.fn();
    render(
      <TooltipProvider>
        <ScopedSetting field={{ ...FIELD, isSet: true, value: 'small' }} scope="project" value="small" change={vi.fn()} onClearOverride={clear} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('offers no Reset on a global setting or on a project setting with no override', () => {
    renderSetting({ ...FIELD, isSet: true });
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
    cleanup();
    render(
      <TooltipProvider>
        <ScopedSetting field={FIELD} scope="project" value="" change={vi.fn()} onClearOverride={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });
});

// jsdom does no layout, so these pin the class contract that the visual suite's collapsed-control check then proves in a
// real browser (settings mobile layout PRD): a grid with no breakpoint gave the control column 45 px at a 390 px window.
// The row is the label cell's parent and the control row is its sibling; nothing carries a test id (the app has none).
describe('ScopedSetting row layout', () => {
  const classesOf = (element: HTMLElement) => element.className.split(/\s+/);

  it('stacks the label above the control below md and puts them side by side from md', () => {
    renderSetting(FIELD);
    const row = screen.getByRole('combobox', { name: 'Model size' }).closest('div.grid') as HTMLElement;
    expect(classesOf(row)).toContain('grid-cols-1');
    expect(classesOf(row)).toContain('md:grid-cols-[12rem_minmax(0,1fr)]');
    expect(classesOf(row)).toContain('lg:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]');
    // The unconditional two-column template is the bug: it must never come back without a breakpoint prefix.
    expect(classesOf(row).filter((token) => token.startsWith('grid-cols-['))).toEqual([]);
  });

  it('lets the control row wrap and shrink, and caps how wide a control grows', () => {
    renderSetting(FIELD);
    const controls = screen.getByRole('combobox', { name: 'Model size' }).closest('div.flex') as HTMLElement;
    for (const token of ['min-w-0', 'flex-wrap', 'max-w-md']) expect(classesOf(controls)).toContain(token);
  });

  it('lets a select grow into the free width and shrink below its content, so Reset drops under it only when it must', () => {
    renderSetting(FIELD);
    const wrapper = screen.getByRole('combobox', { name: 'Model size' }).parentElement as HTMLElement;
    for (const token of ['min-w-0', 'flex-[1_1_10rem]']) expect(classesOf(wrapper)).toContain(token);
  });

  it('lets the hex box of a colour row grow into the free width beside the swatch', () => {
    renderSetting({ ...FIELD, key: 'color_note', label: 'Note color', kind: 'color', choices: [], effectiveValue: 'ffd54f' });
    for (const token of ['min-w-[4.5rem]', 'flex-[1_1_0%]']) expect(classesOf(screen.getByRole('textbox', { name: 'Note color' }))).toContain(token);
  });

  it('lets a text box grow into the free width', () => {
    renderSetting({ ...FIELD, key: 'note', label: 'Note label', kind: 'text', choices: [], effectiveValue: 'Note' });
    for (const token of ['min-w-0', 'flex-[1_1_10rem]']) expect(classesOf(screen.getByRole('textbox', { name: 'Note label' }))).toContain(token);
  });
});
