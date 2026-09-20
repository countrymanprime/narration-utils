// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { danglingAriaReferences } from './ariaReferences';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';

afterEach(cleanup);

function Example({ activation = 'manual', onChange = () => undefined }: { activation?: 'manual' | 'automatic'; onChange?: (value: string) => void }) {
  const [value, setValue] = useState('global');
  return (
    <Tabs
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    >
      <TabList label="Settings scope" activation={activation}>
        <Tab value="global">Global</Tab>
        <Tab value="project">This Project</Tab>
        <Tab value="advanced">Advanced</Tab>
      </TabList>
      <TabPanel value={value}>
        <button type="button">Save</button>
        <span>Showing {value}</span>
      </TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('is a named tablist of tabs whose selected one controls the panel, and no reference dangles', () => {
    const { container } = render(<Example />);
    expect(screen.getByRole('tablist', { name: 'Settings scope' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    const panel = screen.getByRole('tabpanel', { name: 'Global' });
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
    expect(danglingAriaReferences(container)).toEqual([]);
  });

  it('selects a tab by click and reports its value', async () => {
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'This Project' }));
    expect(onChange).toHaveBeenCalledWith('project');
    expect(screen.getByRole('tab', { name: 'This Project' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Showing project')).toBeTruthy();
  });

  it('moves focus with the arrow keys without selecting, and Enter selects (manual activation)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Example onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Global' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'This Project' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('project');
  });

  it('selects as focus moves with automatic activation', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Example activation="automatic" onChange={onChange} />);
    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('advanced');
    expect(screen.getByText('Showing advanced')).toBeTruthy();
  });

  it('leaves the panel out of the tab order: Tab goes from the strip to the control inside it', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });

  it('does not change the selection by itself when the parent refuses the change', async () => {
    const user = userEvent.setup();
    render(
      <Tabs value="global" onChange={() => undefined}>
        <TabList label="Scope">
          <Tab value="global">Global</Tab>
          <Tab value="project">This Project</Tab>
        </TabList>
        <TabPanel value="global">Panel</TabPanel>
      </Tabs>,
    );
    await user.click(screen.getByRole('tab', { name: 'This Project' }));
    expect(screen.getByRole('tab', { name: 'Global' }).getAttribute('aria-selected')).toBe('true');
  });
});
