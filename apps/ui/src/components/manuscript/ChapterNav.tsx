import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { STATUS_COLOR } from '../../chapterStatus';
import { chapterLineNumber, isListableChapter } from '../../state';
import type { ManuscriptChapter, ReaderBookmark, SearchHit } from '../../types';

export function ChapterNav({
  chapters,
  bookmarks,
  searchQuery,
  searchResults,
  titleMatches = new Set(),
  pending = false,
  lineNumbers,
  select,
  removeBookmark,
}: {
  chapters: ManuscriptChapter[];
  selectedId?: string;
  bookmarks: ReaderBookmark[];
  searchQuery: string;
  searchResults: SearchHit[];
  // Chapters whose title or subtitle matched, filtered client-side and never debounced (R2) - shown
  // right away, before any line result has had a chance to arrive.
  titleMatches?: Set<string>;
  // A query has been typed but the debounced line search has not settled for it yet (R1).
  pending?: boolean;
  lineNumbers: Map<number, number>;
  select: (id: string, paragraph?: number) => void;
  removeBookmark: (id: string) => void;
}) {
  const searching = Boolean(searchQuery.trim());
  const matchesFor = (chapter: ManuscriptChapter) =>
    searchResults.filter((hit) => hit.chapterId === chapter.id || (!hit.chapterId && hit.chapter === chapter.title));
  const listableChapters = chapters.filter(isListableChapter);
  const visibleChapters = searching ? listableChapters.filter((chapter) => titleMatches.has(chapter.id) || matchesFor(chapter).length > 0) : listableChapters;
  // A hit in a hidden (reference) chapter never surfaces a row, so "No matches" reads off what is
  // actually shown, not the raw result count - otherwise a query that only hits Contents or
  // Characters left the panel blank with no explanation (see ADR 0005 and the Evidence section).
  const visibleHitCount = searching ? visibleChapters.reduce((total, chapter) => total + matchesFor(chapter).length, 0) : 0;
  return (
    <div className="space-y-1">
      {searching && pending && (
        <div className="p-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Searching…
        </div>
      )}
      {searching && !pending && visibleHitCount === 0 && titleMatches.size === 0 && (
        <div className="p-2 text-xs" style={{ color: 'var(--text-muted)' }}>
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
              {chapterBookmark && <FontAwesomeIcon className="text-[var(--bookmark)]" icon={faBookmark} />}
              <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
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
                      aria-label={`Search result in ${chapter.title}, line ${chapterLineNumber(chapter, hit.paragraph, lineNumbers)}`}
                      onClick={() => select(chapter.id, hit.paragraph)}
                    >
                      <FontAwesomeIcon icon={faMagnifyingGlass} />
                      <span className="truncate">
                        Line {chapterLineNumber(chapter, hit.paragraph, lineNumbers)} · {hit.excerpt}
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
                        <FontAwesomeIcon className="text-[var(--bookmark)]" icon={faBookmark} />
                        {item.kind === 'note' ? 'Note' : `Line ${chapterLineNumber(chapter, item.paragraph ?? -1, lineNumbers)}`}
                      </button>
                      <button className="text-[var(--text-muted)]" aria-label={`Remove ${item.kind} bookmark`} onClick={() => removeBookmark(item.id)}>
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
