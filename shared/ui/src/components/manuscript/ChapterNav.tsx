import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
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
  selectedId,
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
  const matchesFor = (chapter: ManuscriptChapter) => searchResults.filter((hit) => hit.chapterId === chapter.id || (!hit.chapterId && hit.chapter === chapter.title));
  const visibleChapters = searching ? chapters.filter((chapter) => matchesFor(chapter).length > 0) : chapters;
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
          <div key={chapter.id} className={`chapter-nav-row ${selectedId === chapter.id ? 'active' : ''}`}>
            <button className="entity-row w-full text-left" onClick={() => select(chapter.id)}>
              <span className="size-2 flex-none rounded-full" style={{ background: STATUS_COLOR[chapter.status] }} />
              <span className="flex-1 truncate text-sm font-medium">{chapter.title}</span>
              {chapterBookmark && <FontAwesomeIcon className="chapter-nav-bookmark" icon={faBookmark} />}
              <span className="f-mono text-xs" style={{ color: 'var(--text-faint)' }}>
                {(chapter.wordCount / 1000).toFixed(0)}k
              </span>
            </button>
            {searching
              ? matchesFor(chapter).map((hit, index) => (
                  <div key={`${hit.paragraph}-${index}`} className="chapter-nav-bookmark-item chapter-nav-search-item">
                    <button
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
                    <div key={item.id} className="chapter-nav-bookmark-item">
                      <button onClick={() => select(chapter.id, item.paragraph)}>
                        <FontAwesomeIcon icon={faBookmark} />
                        {item.kind === 'note' ? 'Note' : `Line ${lineNumber(item.paragraph)}`}
                      </button>
                      <button aria-label={`Remove ${item.kind} bookmark`} onClick={() => removeBookmark(item.id)}>
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
