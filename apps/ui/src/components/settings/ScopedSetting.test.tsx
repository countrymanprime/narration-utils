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
});
