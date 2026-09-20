import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { isListableChapter } from '../../state';
import type { ManuscriptChapter, ReaderBookmark, SearchHit } from '../../types';

export const STATUS_LABELS = { not_started: 'Not Started', recording: 'Recording', editing: 'Editing', proofing: 'Proofing', finalized: 'Finalized' } as const;
export const STATUS_ORDER = ['not_started', 'recording', 'editing', 'proofing', 'finalized'] as const;
export const STATUS_COLOR: Record<keyof typeof STATUS_LABELS, string> = {
  not_started: 'var(--text-faint)',
  recording: 'var(--info)',
  editing: 'var(--warn)',
  proofing: 'var(--org)',
  finalized: 'var(--character)',
};

export function ChapterNav({
  chapters,
  bookmarks,
  searchQuery,
  searchResults,
  lineNumbers,
  select,
  removeBookmark,
}: {
  chapters: ManuscriptChapter[];
  selectedId?: string;
  bookmarks: ReaderBookmark[];
  searchQuery: string;
  searchResults: SearchHit[];
  lineNumbers: Map<number, number>;
  select: (id: string, paragraph?: number) => void;
  removeBookmark: (id: string) => void;
}) {
  const searching = Boolean(searchQuery.trim());
  const lineNumber = (paragraph?: number) => (paragraph === undefined ? undefined : (lineNumbers.get(paragraph) ?? paragraph));
  const matchesFor = (chapter: ManuscriptChapter) =>
    searchResults.filter((hit) => hit.chapterId === chapter.id || (!hit.chapterId && hit.chapter === chapter.title));
  const listableChapters = chapters.filter(isListableChapter);
  const visibleChapters = searching ? listableChapters.filter((chapter) => matchesFor(chapter).length > 0) : listableChapters;
  return (
    <div className="space-y-1">
      {searching && searchResults.length === 0 && (
        <div className="p-2 text-xs" style={{ color: 'var(--text-faint)' }}>
          No matches
        </div>
      )}
      {visibleChapters.map((chapter) => {
        const chapterBookmarks = bookmarks.filter((item) => item.chapterId === chapter.id);
        const chapterBookmark = chapterBookmarks.find((item) => item.kind === 'chapter');
        return (
          <div key={chapter.id} className="rounded-[0.4rem]">
            <button
              className="flex w-full items-center gap-[0.6rem] rounded-[0.4rem] border border-transparent px-[0.7rem] py-[0.55rem] text-left hover:bg-[var(--surface-2)]"
              onClick={() => select(chapter.id)}
            >
              <span className="size-2 flex-none rounded-full" style={{ background: STATUS_COLOR[chapter.status] }} />
              <span className="flex-1 truncate text-sm font-medium">{chapter.title}</span>
              {chapterBookmark && <FontAwesomeIcon className="text-[var(--accent)]" icon={faBookmark} />}
              <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-faint)' }}>
                {(chapter.wordCount / 1000).toFixed(0)}k
              </span>
            </button>
            {searching
              ? matchesFor(chapter).map((hit, index) => (
                  <div
                    key={`${hit.paragraph}-${index}`}
                    className="mr-[0.35rem] mb-[0.2rem] ml-7 flex items-center justify-between gap-[0.4rem] border-l border-[var(--border)] px-[0.4rem] py-[0.28rem] text-[0.74rem] text-[var(--text-muted)]"
                  >
                    <button
                      className="w-full"
                      aria-label={`Search result in ${chapter.title}, line ${lineNumber(hit.paragraph)}`}
                      onClick={() => select(chapter.id, hit.paragraph)}
                    >
                      <FontAwesomeIcon icon={faMagnifyingGlass} />
                      <span className="truncate">
                        Line {lineNumber(hit.paragraph)} · {hit.excerpt}
                      </span>
                    </button>
                  </div>
                ))
              : chapterBookmarks
                  .filter((item) => item.kind !== 'chapter')
                  .map((item) => (
                    <div
                      key={item.id}
                      className="mr-[0.35rem] mb-[0.2rem] ml-7 flex items-center justify-between gap-[0.4rem] border-l border-[var(--border)] px-[0.4rem] py-[0.28rem] text-[0.74rem] text-[var(--text-muted)]"
                    >
                      <button className="flex min-w-0 items-center gap-[0.35rem]" onClick={() => select(chapter.id, item.paragraph)}>
                        <FontAwesomeIcon icon={faBookmark} />
                        {item.kind === 'note' ? 'Note' : `Line ${lineNumber(item.paragraph)}`}
                      </button>
                      <button className="text-[var(--text-faint)]" aria-label={`Remove ${item.kind} bookmark`} onClick={() => removeBookmark(item.id)}>
                        ×
                      </button>
                    </div>
                  ))}
          </div>
        );
      })}
    </div>
  );
}
