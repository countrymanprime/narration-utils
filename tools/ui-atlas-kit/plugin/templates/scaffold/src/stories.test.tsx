// @vitest-environment jsdom
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as previewAnnotations from '../.storybook/preview';

// Every story in the repo is also a unit test: it renders under the same
// decorators as Storybook and its play() interaction has to pass. New stories
// are picked up by the glob; nothing to register. (Axe and layout checks need a
// real browser and run in tests/atlas instead.)
setProjectAnnotations([previewAnnotations]);
afterEach(cleanup);

type ComposedStory = { run: () => Promise<void> };

const storyModules = import.meta.glob<Record<string, unknown>>('./**/*.stories.tsx', { eager: true });

describe('stories render and their interactions pass', () => {
  it('finds the story files', () => {
    expect(Object.keys(storyModules).length).toBeGreaterThan(0);
  });

  for (const [file, module] of Object.entries(storyModules)) {
    const stories = composeStories(module as Parameters<typeof composeStories>[0]) as unknown as Record<string, ComposedStory>;
    for (const [name, Story] of Object.entries(stories)) {
      it(`${file.replace('./', '')} > ${name}`, async () => {
        await Story.run();
      });
    }
  }
});
