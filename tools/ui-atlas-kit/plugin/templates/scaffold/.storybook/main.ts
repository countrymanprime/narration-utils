import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // Stories run as unit tests through composeStories (src/stories.test.tsx), so one test runner is enough.
  // @storybook/addon-vitest is not needed (and needs Vitest 3+).
  // TODO(ui-atlas-init): if stories load images or fonts by absolute URL (/images/logo.png), add staticDirs: ['../public'].
  addons: ['@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
};

export default config;
