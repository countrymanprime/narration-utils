import type { Decorator, Preview } from '@storybook/react-vite';
// TODO(ui-atlas-init): import the app's global stylesheet, e.g. import '../src/index.css';

// Set the same attribute/class the app uses for theming BEFORE first paint, synchronously during
// render (not in an effect), so the atlas runner never screenshots the wrong palette.
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('{{THEME_ATTR}}', theme);
  // TODO(ui-atlas-init): wrap in the app's providers (router, tooltip, i18n, theme) if components need them.
  return <Story />;
};

const preview: Preview = {
  decorators: [withTheme],
  initialGlobals: { theme: 'light' },
  globalTypes: {
    theme: {
      description: 'App colour theme',
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
    // 'todo' only warns. 'error' makes an axe violation fail the story, which the atlas runner asserts.
    a11y: { test: 'error' },
  },
};

export default preview;
