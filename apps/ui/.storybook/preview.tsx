import type { Decorator, Preview } from '@storybook/react-vite';
import '../src/fonts';
import '../src/styles.css';
import { TooltipProvider } from '../src/components/primitives/Tooltip';
import { applyResolvedTheme, type ResolvedTheme } from '../src/theme/theme';

// Applied synchronously during render (not in an effect) so the very first
// paint of a story already carries the right palette - the atlas runner waits on
// story render, not on a follow-up effect.
const withTheme: Decorator = (Story, context) => {
  const theme: ResolvedTheme = context.globals.theme === 'dark' ? 'dark' : 'light';
  applyResolvedTheme(theme);
  return (
    // isolate: same reason as `#root` in index.html - popups portal to <body> and must stack above the story.
    <div className="isolate min-h-screen bg-[var(--bg)] p-4 text-[var(--text)]">
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  initialGlobals: { theme: 'light' },
  globalTypes: {
    theme: {
      description: 'App colour theme (drives <html data-theme>)',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: 'fullscreen',
    // addon-a11y defaults to test:'todo' (violations only warn). 'error' makes an
    // axe violation fail the story, which is what the atlas runner asserts.
    a11y: { test: 'error' },
    controls: { matchers: { color: /(background|color)$/i } },
  },
};

export default preview;
