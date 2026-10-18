import { useEffect, useRef } from 'react';
import { chapterName, type ChapterNameInput } from '../../chapterName';
import { registerCommandProvider, type ProvidedCommand } from '../../input/commandProviders';

export type GoToPage = {
  id: string;
  label: string;
  /** Set when the page is off: "Go to" is listed with this reason and does not open it. */ disabledReason?: string;
};
export type GoToChapter = ChapterNameInput & { id: string };

/** What `go` is asked to open. The caller maps it onto its own navigation. */
export type GoToTarget = { kind: 'page'; id: string } | { kind: 'chapter'; id: string };

/**
 * Registers one command provider for "Go to <page>" and "Go to <chapter>" while the caller is mounted (docs/architecture/studio-shell-and-registries.md#command-providers-and-go-to).
 * The lists are arguments, so this file names no page and no chapter; the shell passes them from its navigation model. The provider
 * reads the latest lists each time the jump menu opens, so a new array never re-registers it.
 */
export function useGoToCommands({
  pages,
  chapters,
  go,
}: {
  pages: readonly GoToPage[];
  chapters: readonly GoToChapter[];
  go: (target: GoToTarget) => void;
}): void {
  const latest = useRef({ pages, chapters, go });
  latest.current = { pages, chapters, go };

  useEffect(
    () =>
      registerCommandProvider(() => {
        const { pages: pageList, chapters: chapterList, go: open } = latest.current;
        const commands: ProvidedCommand[] = [
          ...pageList.map((page) => ({
            id: `goto.page.${page.id}`,
            group: 'Go to',
            label: `Go to ${page.label}`,
            disabledReason: page.disabledReason,
            run: () => open({ kind: 'page', id: page.id }),
          })),
          ...chapterList.map((chapter) => ({
            id: `goto.chapter.${chapter.id}`,
            group: 'Chapters',
            label: `Go to ${chapterName(chapter, 'full')}`,
            run: () => open({ kind: 'chapter', id: chapter.id }),
          })),
        ];
        return commands;
      }),
    [],
  );
}
