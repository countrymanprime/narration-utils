// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providedCommands } from '../../input/commandProviders';
import { chapterName } from '../../chapterName';
import { useGoToCommands, type GoToChapter, type GoToPage } from './useGoToCommands';

afterEach(cleanup);

const pages: GoToPage[] = [
  { id: 'proof', label: 'Proof' },
  { id: 'production', label: 'Production' },
];
const chapters: GoToChapter[] = [
  { id: 'c2', title: 'Chapter 2', subtitle: 'The Road' },
  { id: 'c3', title: 'Chapter 3' },
];

function Harness({ go, pageList = pages, chapterList = chapters }: { go: (target: unknown) => void; pageList?: GoToPage[]; chapterList?: GoToChapter[] }) {
  useGoToCommands({ pages: pageList, chapters: chapterList, go });
  return null;
}

describe('useGoToCommands', () => {
  it('chapters-by-formatted-name: each chapter is "Go to" plus its formatted name, and the page rows come from the list too', () => {
    render(<Harness go={() => {}} />);
    const commands = providedCommands();
    expect(commands.filter((c) => c.group === 'Chapters').map((c) => c.label)).toEqual(chapters.map((c) => `Go to ${chapterName(c, 'full')}`));
    expect(commands.filter((c) => c.group === 'Go to').map((c) => c.label)).toEqual(['Go to Proof', 'Go to Production']);
  });

  it('running a command calls go with its target once', () => {
    const go = vi.fn();
    render(<Harness go={go} />);
    const commands = providedCommands();
    commands.find((c) => c.label === 'Go to Proof')?.run();
    commands.find((c) => c.label.startsWith('Go to Chapter 3'))?.run();
    expect(go.mock.calls).toEqual([[{ kind: 'page', id: 'proof' }], [{ kind: 'chapter', id: 'c3' }]]);
  });

  it('follows new lists without registering twice, and is removed on unmount', () => {
    const { rerender, unmount } = render(<Harness go={() => {}} />);
    rerender(<Harness go={() => {}} chapterList={[{ id: 'c9', title: 'Chapter 9' }]} />);
    expect(
      providedCommands()
        .filter((c) => c.group === 'Chapters')
        .map((c) => c.label),
    ).toEqual(['Go to Chapter 9']);
    expect(providedCommands().filter((c) => c.group === 'Go to')).toHaveLength(2);
    unmount();
    expect(providedCommands()).toEqual([]);
  });

  it('ids are unique per target and clash with no catalogue row', () => {
    render(<Harness go={() => {}} />);
    const ids = providedCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("passes a page's reason through, so the jump menu lists it off", () => {
    const off: GoToPage[] = [
      { id: 'proof', label: 'Proof', disabledReason: 'Import a manuscript to unlock this page.' },
      { id: 'production', label: 'Production' },
    ];
    render(<Harness go={() => {}} pageList={off} />);
    const rows = providedCommands().filter((c) => c.group === 'Go to');
    expect(rows.map((c) => c.disabledReason)).toEqual(['Import a manuscript to unlock this page.', undefined]);
  });
});
