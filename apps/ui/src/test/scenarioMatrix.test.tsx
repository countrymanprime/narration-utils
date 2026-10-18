// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { useApi } from '../api/ApiContext';
import { ChapterList } from '../components/script/page/chapters/ChapterList';
import { chapterHeading } from '../chapterHeading';
import { StudioProvider } from '../studio/StudioProvider';
import type { ManuscriptChapter } from '../types';
import { CHAPTER_SHAPES } from '../fixtures/chapters';
import { renderScenario, renderScenarioApp } from '../fixtures/renderScenario';
import { makeScenario, SCENARIO_DAW_SETUPS, SCENARIO_SIZES } from '../fixtures/scenario';
import { shellPages } from '../components/layout/AppShell';

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

// The page lists what the manuscript port answers, as Script does.
function ChaptersFromPort() {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  useEffect(() => void api.manuscriptChapters().then(setChapters), [api]);
  return (
    <StudioProvider>
      <ChapterList chapters={chapters} currentId={null} onJump={() => {}} />
    </StudioProvider>
  );
}

const cases = CHAPTER_SHAPES.flatMap((shape) => SCENARIO_SIZES.map((chapters) => ({ shape, chapters })));

describe('matrix-renders-one-page-in-every-scenario', () => {
  it.each(cases)('$shape, $chapters chapters', async ({ shape, chapters: count }) => {
    const scenario = makeScenario({ shape, chapters: count });
    renderScenario(scenario, <ChaptersFromPort />);
    const [first] = scenario.chapters;
    const last = scenario.chapters[count - 1];
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(count));
    const rows = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(rows[0]).toContain(chapterHeading(first).title);
    expect(rows[count - 1]).toContain(chapterHeading(last).title);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('\n');
    if (shape === 'titleOnly') {
      for (const other of makeScenario({ shape: 'titleAndSubtitle', chapters: count }).chapters) {
        expect(text).not.toContain(other.subtitle);
      }
    }
    if (shape === 'legacyNewline') {
      const [, subtitle] = first.title.split('\n');
      expect(text).toContain(subtitle);
      expect(rows[0]).not.toContain('\n');
    }
  });
});

// Every routed page, read from the app's own list (the rail's pages and Settings) so a page swap needs no edit here: a page
// that is added, renamed or removed changes this list, not this file.
const pages = shellPages({ hasManuscript: true, dawFileLinked: true });
const appCases = pages.flatMap((page) =>
  CHAPTER_SHAPES.flatMap((shape) => SCENARIO_DAW_SETUPS.map((daw) => ({ page: page.label, route: page.id, shape, daw }))),
);

describe('every page renders in every chapter shape and DAW setup', () => {
  it('reads at least the rail and Settings', () => {
    expect(pages.length).toBeGreaterThanOrEqual(8);
  });

  it.each(appCases)('$page, $shape, $daw', async ({ page, route, shape, daw }) => {
    const scenario = makeScenario({ shape, chapters: SCENARIO_SIZES[0], daw });
    renderScenarioApp(scenario, route, <App />);
    // The page's own level-one heading appears once the app has booted (Booth's is screen-reader only), and nothing throws.
    await screen.findByRole('heading', { level: 1, name: new RegExp(page.replace(/[&]/g, '.')) }, { timeout: 5000 });
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
    // A shape that carries no subtitle shows none of another scenario's.
    if (shape === 'titleOnly') {
      const text = document.body.textContent ?? '';
      for (const other of makeScenario({ shape: 'titleAndSubtitle', chapters: SCENARIO_SIZES[0], daw }).chapters) {
        expect(text).not.toContain(other.subtitle);
      }
    }
  });
});
