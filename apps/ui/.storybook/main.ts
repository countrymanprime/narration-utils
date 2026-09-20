import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // addon-vitest is deliberately absent: it needs Vitest 3+ and this repo is on 2.
  // Stories run as unit tests through composeStories instead (src/stories.test.tsx).
  addons: ['@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
};

export default config;
