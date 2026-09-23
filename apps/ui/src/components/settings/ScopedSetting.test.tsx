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

  it('shows a bool as a switch named by the setting, on when the stored value is "true", and stores "true" or "false"', () => {
    const change = renderSetting({ ...FIELD, key: 'notify_done', label: 'Notify when a job finishes', kind: 'bool', choices: [], effectiveValue: 'true' });
    const toggle = screen.getByRole('switch', { name: 'Notify when a job finishes' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(change).toHaveBeenLastCalledWith('false');
    cleanup();
    const changeOn = renderSetting({ ...FIELD, key: 'notify_done', label: 'Notify when a job finishes', kind: 'bool', choices: [], effectiveValue: 'false' });
    const off = screen.getByRole('switch', { name: 'Notify when a job finishes' });
    expect(off.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(off);
    expect(changeOn).toHaveBeenLastCalledWith('true');
  });

  it('reads the value being edited before the saved one, so the switch follows a click', () => {
    renderSetting({ ...FIELD, key: 'notify_done', label: 'Notify me', kind: 'bool', choices: [], value: 'false', effectiveValue: 'true' });
    expect(screen.getByRole('switch', { name: 'Notify me' }).getAttribute('aria-checked')).toBe('false');
  });

  it('treats anything but "true" as off, so a value the host never validated cannot turn a switch on', () => {
    renderSetting({ ...FIELD, key: 'notify_done', label: 'Notify me', kind: 'bool', choices: [], effectiveValue: 'yes' });
    expect(screen.getByRole('switch', { name: 'Notify me' }).getAttribute('aria-checked')).toBe('false');
  });

  it('offers Reset on a project bool that has an override', () => {
    const clear = vi.fn();
    render(
      <TooltipProvider>
        <ScopedSetting
          field={{ ...FIELD, key: 'notify_done', label: 'Notify me', kind: 'bool', choices: [], isSet: true, value: 'false' }}
          scope="project"
          value="false"
          change={vi.fn()}
          onClearOverride={clear}
        />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(clear).toHaveBeenCalledTimes(1);
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
  describe('a number', () => {
    const LIMIT: ScopedSettingField = {
      ...FIELD,
      key: 'true_peak_dbtp_max',
      label: 'True peak, highest',
      kind: 'number',
      choices: [],
      effectiveValue: '',
      effectiveSource: 'hardcoded',
      number: { min: -60, max: 0, step: 0.1, unit: 'dBTP' },
    };
    const renderNumber = (field: ScopedSettingField, scope: 'global' | 'project', value = field.value, change = vi.fn()) => {
      render(
        <TooltipProvider>
          <ScopedSetting field={field} scope={scope} value={value} change={change} onClearOverride={vi.fn()} />
        </TooltipProvider>,
      );
      return change;
    };

    it('is a named decimal box with its unit and range, and reports what is typed', () => {
      const change = renderNumber(LIMIT, 'global');
      const box = screen.getByRole('textbox', { name: 'True peak, highest' }) as HTMLInputElement;
      expect(box.inputMode).toBe('decimal');
      expect(box.value).toBe('');
      expect(box.placeholder).toBe('Not set');
      expect(screen.getByText('dBTP')).toBeTruthy();
      expect(screen.getByText('From -60 to 0 dBTP')).toBeTruthy();
      fireEvent.change(box, { target: { value: '-3' } });
      expect(change).toHaveBeenCalledWith('-3');
    });

    it('can be emptied, since an empty number is "not set", not the inherited value typed back in', () => {
      renderNumber({ ...LIMIT, value: '-3', isSet: true, effectiveValue: '-3', effectiveSource: 'global' }, 'global', '');
      expect((screen.getByRole('textbox', { name: 'True peak, highest' }) as HTMLInputElement).value).toBe('');
    });

    it('shows the inherited value as the placeholder of an unset project field', () => {
      renderNumber({ ...LIMIT, effectiveValue: '-3', effectiveSource: 'global' }, 'project');
      expect(screen.getByPlaceholderText('Inherits -3')).toBeTruthy();
      cleanup();
      // A global field never shows a project's value as if it were inherited.
      renderNumber({ ...LIMIT, effectiveValue: '-1', effectiveSource: 'project' }, 'global');
      expect(screen.getByPlaceholderText('Not set')).toBeTruthy();
      cleanup();
      // A project override being cleared inherits a value the page does not know yet.
      renderNumber({ ...LIMIT, value: '-1', isSet: true, effectiveValue: '-1', effectiveSource: 'project' }, 'project', '');
      expect(screen.getByPlaceholderText('Inherits Global')).toBeTruthy();
    });

    it('says what is wrong with a value that cannot be saved, in place of the range', () => {
      renderNumber(LIMIT, 'global', '5');
      const box = screen.getByRole('textbox', { name: 'True peak, highest' });
      expect(box.getAttribute('aria-invalid')).toBe('true');
      const message = screen.getByText('Enter a value from -60 to 0 dBTP.');
      expect(box.getAttribute('aria-describedby')).toBe(message.id);
      expect(screen.queryByText('From -60 to 0 dBTP')).toBeNull();
    });
  });

  it('shows the update channel in words, not as the stored names', () => {
    renderSetting({ ...FIELD, key: 'channel', label: 'Update channel', choices: ['candidates', 'stable'], effectiveValue: 'candidates' });
    const select = screen.getByRole('combobox', { name: 'Update channel' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['Candidates and stable', 'Stable only']);
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['candidates', 'stable']);
  });
});
