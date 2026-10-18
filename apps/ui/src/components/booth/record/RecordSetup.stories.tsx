import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { ApiProvider } from '../../../api/ApiContext';
import type { DawCapabilities } from '../../../api/contracts/daw';
import { createMockApi } from '../../../api/mockApi';
import { DAW_SETUPS } from '../../../fixtures/daw';
import { RecordSetup } from './RecordSetup';

// The Booth's one-time recording setup, above the footer while Record is unavailable for a reason the narrator can fix from the Booth:
// the Experimental record capability switched off with its one-click turn-on, and REAPER not connected or not answering with
// the launcher steps. It is drawn on the footer's surface, as on the page.
const LAUNCHER = 'C:\\Users\\narrator\\AppData\\Local\\narration-utils\\runtime\\5f2c\\reaper\\NarrationStudio_Launcher.lua';

const refused = (reason: 'experimental_off' | 'standalone' | 'not_running', message: string): DawCapabilities => ({
  ...DAW_SETUPS.reaper,
  reachable: reason === 'experimental_off',
  capabilities: { ...DAW_SETUPS.reaper.capabilities, record: { level: 'experimental', available: false, reason, message } },
});

type Args = {
  capabilities: DawCapabilities;
  linked: boolean;
  open?: 'same' | 'different';
  say: (sentence: string) => void;
  onSettings: () => void;
  onChanged: () => void;
};

function Strip({ capabilities, linked, open, say, onSettings, onChanged }: Args) {
  return (
    <ApiProvider api={createMockApi()}>
      <div className="max-w-full bg-[var(--surface)] py-2">
        <RecordSetup
          capabilities={capabilities}
          facts={{ dawFileLinked: linked, launcherPath: LAUNCHER, openProject: open }}
          say={say}
          onSettings={onSettings}
          onChanged={onChanged}
        />
      </div>
    </ApiProvider>
  );
}

const meta = {
  title: 'Booth/RecordSetup',
  component: Strip,
  args: {
    capabilities: refused('experimental_off', 'Experimental: switched off in Settings.'),
    linked: true,
    say: fn(),
    onSettings: fn(),
    onChanged: fn(),
  },
} satisfies Meta<typeof Strip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TurnOnRecord: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'Recording in REAPER is experimental' })).toBeVisible();
    await expect(within(canvasElement).getByRole('button', { name: 'Turn on Record' })).toBeEnabled();
  },
};

/** The app's own recorder with Experimental off: no DAW setup and no track, and the take goes in the project's Recordings folder. */
export const TurnOnRecordBuiltIn: Story = {
  args: {
    capabilities: {
      ...DAW_SETUPS.builtin,
      capabilities: {
        ...DAW_SETUPS.builtin.capabilities,
        record: { level: 'experimental', available: false, reason: 'experimental_off', message: 'Experimental: switched off in Settings.' },
      },
    },
    linked: false,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'Recording in the built-in recorder is experimental' })).toBeVisible();
    await expect(within(canvasElement).getByText(/saved in the project's Recordings folder/)).toBeInTheDocument();
    await expect(within(canvasElement).getByRole('button', { name: 'Turn on Record' })).toBeEnabled();
  },
};

export const ConnectReaper: Story = {
  args: { capabilities: refused('standalone', 'REAPER is not connected to this app. Open this app from REAPER to use it.') },
};

export const ReaperNotAnswering: Story = {
  args: { capabilities: refused('not_running', 'REAPER is not answering. Check that REAPER is open, then try again.') },
};

export const NoProjectLinked: Story = {
  args: { capabilities: refused('standalone', 'No DAW is connected to this app. Open this app from your DAW to use it.'), linked: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Open in REAPER and connect' })).toBeDisabled();
  },
};

/** Record could start, but the DAW has another project open than the one linked: link the open one, or open the linked one and check again. */
export const OtherProjectOpen: Story = {
  args: { capabilities: DAW_SETUPS.reaper, open: 'different' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'REAPER has a different project open' })).toBeVisible();
    await expect(within(canvasElement).getByRole('button', { name: 'Link the open project' })).toBeEnabled();
    await expect(within(canvasElement).getByRole('button', { name: 'DAW settings' })).toBeEnabled();
  },
};
