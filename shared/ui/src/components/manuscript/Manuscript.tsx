import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAnglesDown, faAnglesUp, faBookmark as faBookmarkSolid, faList, faXmark } from '@fortawesome/free-solid-svg-icons';
import { faBookmark as faBookmarkRegular } from '@fortawesome/free-regular-svg-icons';
import type { GuideEntity, ManuscriptNote, ManuscriptParagraph, ReaderState, SearchHit } from '../../types';
import { categoryCssName, chapterLineNumbers, STORY_BIBLE_TABS } from '../../state';
import { useApi } from '../../api/ApiContext';
import { useTextSelection } from '../../hooks/useTextSelection';
import { Heading } from '../primitives/Heading';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { ChapterNav } from './ChapterNav';
import { SearchBar } from './SearchBar';
import { ParagraphView } from './ParagraphView';
import { SelectionMenu } from './SelectionMenu';
import { AddNoteDialog } from './AddNoteDialog';
import { EntitySummary } from './EntitySummary';

const TEXT_SIZES = ['small', 'medium', 'large'] as const;
const READER_TEXT_CLASSES = { small: 'text-sm leading-5', medium: 'text-base leading-6', large: 'text-xl leading-7' } as const;
const LINE_NUMBER_PADDING_CLASSES = { small: '!pt-2', medium: '!pt-2.5', large: '!pt-3' } as const;
const defaultState: ReaderState = { expandedChapters: [], bookmarks: [] };
const escapeSelector = (value: string) =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');

export function Manuscript({
  notify,
  focusStoryBibleEntity,
}: {
  notify: (text: string) => void;
  focusStoryBibleEntity: (id: string) => void;
}) {
  const api = useApi();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const readerRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const searchRequest = useRef(0);
  const [bandHeight, setBandHeight] = useState(0);
  const [chapters, setChapters] = useState<Awaited<ReturnType<typeof api.manuscriptChapters>>>([]);
  const [paragraphs, setParagraphs] = useState<ManuscriptParagraph[]>([]);
  const [entities, setEntities] = useState<GuideEntity[]>([]);
  const [notes, setNotes] = useState<ManuscriptNote[]>([]);
  const [readerState, setReaderState] = useState<ReaderState>(defaultState);
  const [sheet, setSheet] = useState<'chapters' | 'detail'>();
  const [textSize, setTextSize] = useState<(typeof TEXT_SIZES)[number]>('medium');
  const [detail, setDetail] = useState<{ entity?: GuideEntity; note?: ManuscriptNote }>();
  const [pendingNote, setPendingNote] = useState<{ paragraphIndex: number; anchorStart: number; anchorEnd: number; anchorText: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const { selection, clear: clearSelection } = useTextSelection(readerRef);
  const active = readerState.activeChapter || chapters[0]?.title;
  const lineNumbers = useMemo(() => chapterLineNumbers(paragraphs), [paragraphs]);

  useEffect(() => {
    const element = bandRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setBandHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const closeSheet = () => {
    setSheet(undefined);
    setDetail(undefined);
  };
  const saveState = async (next: ReaderState) => {
    setReaderState(next);
    try {
      await api.readerStateSave({ activeChapter: next.activeChapter, activeSourceLine: next.activeSourceLine, expandedChapters: next.expandedChapters || [] });
    } catch (error) {
      notify(String(error));
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const [reader, nextEntities, state] = await Promise.all([api.manuscriptReader(), api.guideEntities(), api.readerState()]);
        const firstChapter = reader.chapters[0]?.title;
        const expandedChapters = state.expandedChapters ?? [state.activeChapter || firstChapter].filter((title): title is string => Boolean(title));
        setChapters(reader.chapters);
        setParagraphs(reader.paragraphs);
        setNotes(reader.notes);
        setEntities(nextEntities);
        setReaderState({ ...state, activeChapter: state.activeChapter || firstChapter, expandedChapters });
      } catch (error) {
        notify(String(error));
      }
    })();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showChapter = (chapter: string, paragraph?: number) => {
    if (!chapter) return;
    const next = { ...readerState, activeChapter: chapter, expandedChapters: Array.from(new Set([...(readerState.expandedChapters || []), chapter])) };
    void saveState(next);
    const selector = paragraph === undefined ? `[data-chapter="${escapeSelector(chapter)}"]` : `[data-paragraph="${paragraph}"]`;
    // Expanding a chapter that wasn't already rendered mounts a new
    // ParagraphView (which re-runs entity highlighting) before the target
    // node exists; poll across frames instead of guessing a fixed delay so
    // cross-chapter jumps land correctly once the node actually appears.
    const deadline = Date.now() + 2000;
    const attempt = () => {
      const target = document.querySelector<HTMLElement>(selector);
      if (target) {
        target.scrollIntoView?.({ behavior: 'smooth', block: paragraph === undefined ? 'start' : 'center' });
        target.classList.add('source-flash');
        window.setTimeout(() => target.classList.remove('source-flash'), 1700);
        return;
      }
      if (Date.now() < deadline) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  };
  // Deep links into a specific paragraph/chapter arrive as a URL anchor -
  // "#p123" for paragraph 123 (its globally unique index, assigned at
  // manuscript import - see manuscript_guide.py's export_manuscript), or
  // "#cChapter Title" to land on a chapter without a specific line. A
  // paragraph anchor needs `paragraphs` loaded to resolve its chapter, so
  // this waits (re-running as paragraphs arrives) instead of dropping the
  // link if it fires before the fetch completes.
  useEffect(() => {
    const hash = location.hash;
    if (!hash) return;
    if (hash.startsWith('#p')) {
      const paragraph = Number(hash.slice(2));
      if (Number.isNaN(paragraph)) return;
      const chapter = paragraphs.find((row) => row.index === paragraph)?.chapter;
      if (!chapter) return;
      showChapter(chapter, paragraph);
    } else if (hash.startsWith('#c')) {
      showChapter(decodeURIComponent(hash.slice(2)));
    } else {
      return;
    }
    routerNavigate('/manuscript', { replace: true });
  }, [location.hash, paragraphs]);
  const toggleManualChapter = (chapter: string) => {
    const expanded = new Set(readerState.expandedChapters || []);
    if (expanded.has(chapter)) expanded.delete(chapter);
    else expanded.add(chapter);
    void saveState({ ...readerState, activeChapter: chapter, expandedChapters: [...expanded] });
  };
  const toggleChapterBookmark = async (chapter: string) => {
    const current = readerState.bookmarks.find((item) => item.kind === 'chapter' && item.chapter === chapter);
    try {
      if (current) {
        await api.readerBookmarkDelete(current.id);
        setReaderState({ ...readerState, bookmarks: readerState.bookmarks.filter((item) => item.id !== current.id) });
      } else {
        const next = await api.readerBookmarkCreate({ kind: 'chapter', chapter });
        setReaderState({ ...readerState, bookmarks: [...readerState.bookmarks, next] });
      }
    } catch (error) {
      notify(String(error));
    }
  };
  const runSearch = async (query: string) => {
    setSearchQuery(query);
    const request = ++searchRequest.current;
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await api.manuscriptSearch(query);
      if (request === searchRequest.current) setSearchResults(results);
    } catch (error) {
      if (request === searchRequest.current) notify(String(error));
    }
  };
  const addNote = () => {
    if (!selection || selection.paragraphIndex === undefined || selection.anchorStart === undefined || selection.anchorEnd === undefined) {
      notify('Select text within a single line to add a note.');
      return;
    }
    setPendingNote({
      paragraphIndex: selection.paragraphIndex,
      anchorStart: selection.anchorStart,
      anchorEnd: selection.anchorEnd,
      anchorText: selection.text,
    });
    clearSelection();
  };
  const confirmNote = async (text: string) => {
    const target = pendingNote;
    setPendingNote(undefined);
    const paragraph = paragraphs.find((item) => item.index === target?.paragraphIndex);
    if (!target || !paragraph) return;
    try {
      const created = await api.noteCreate(paragraph.chapter, paragraph.index, text, target.anchorStart, target.anchorEnd, target.anchorText);
      setNotes((current) => [...current, created]);
      notify('Note added.');
    } catch (error) {
      notify(String(error));
    }
  };
  const deleteNote = async (id: string) => {
    try {
      await api.noteDelete(id);
      setNotes((current) => current.filter((item) => item.id !== id));
      closeSheet();
      notify('Note deleted.');
    } catch (error) {
      notify(String(error));
    }
  };

  return (
    <div className="reader-page" style={{ '--band-h': `${bandHeight}px` } as CSSProperties}>
      <div ref={bandRef} className="reader-control-band">
        <div className="reader-control-inner">
          <div className="reader-toolbar">
            <div className="flex items-center gap-3">
              <Heading title="Manuscript" />
              <TooltipTarget text="Chapters & Search">
                <button
                  aria-label="Chapters & Search"
                  className="icon-btn"
                  onClick={() => {
                    setDetail(undefined);
                    setSheet('chapters');
                  }}
                >
                  <FontAwesomeIcon icon={faList} />
                </button>
              </TooltipTarget>
            </div>
            <div className="reader-legend">
              {[...STORY_BIBLE_TABS.filter((item) => item !== 'All'), 'Note'].map((name) => (
                <span key={name} className="flex items-center gap-1">
                  <span className={`cat-dot type-${categoryCssName(name === 'Location' ? 'Place' : name)}`} />
                  {name}
                </span>
              ))}
            </div>
          </div>
          <div className="reader-options">
            <span className="section-label">
              Text size <Tooltip text="The manuscript always uses the full reading width - adjust text size instead." />
            </span>
            <div className="flex gap-1">
              {TEXT_SIZES.map((value) => (
                <button key={value} className={`swatch-toggle ${textSize === value ? 'active' : ''}`} onClick={() => setTextSize(value)}>
                  {value}
                </button>
              ))}
            </div>
            <TooltipTarget text="Expand all chapters">
              <button
                aria-label="Expand all chapters"
                className="icon-btn"
                onClick={() => void saveState({ ...readerState, expandedChapters: chapters.map((chapter) => chapter.title) })}
              >
                <FontAwesomeIcon icon={faAnglesDown} />
              </button>
            </TooltipTarget>
            <TooltipTarget text="Collapse all chapters">
              <button
                aria-label="Collapse all chapters"
                className="icon-btn"
                onClick={() => void saveState({ ...readerState, expandedChapters: [] })}
              >
                <FontAwesomeIcon icon={faAnglesUp} />
              </button>
            </TooltipTarget>
          </div>
        </div>
      </div>
      <div ref={readerRef} className="reader-chapters">
        {chapters.map((chapter) => {
          const expanded = (readerState.expandedChapters || []).includes(chapter.title);
          const chapterBookmark = readerState.bookmarks.find((item) => item.kind === 'chapter' && item.chapter === chapter.title);
          return (
            <article key={chapter.id} className={`reader-chapter chapter-card ${expanded ? 'expanded' : 'collapsed'}`} data-chapter={chapter.title}>
              <header className="reader-chapter-header chapter-card-header">
                <TooltipTarget className="chapter-bookmark-target" text={chapterBookmark ? 'Remove chapter bookmark' : 'Bookmark this chapter'}>
                  <button className={`chapter-bookmark ${chapterBookmark ? 'active' : ''}`} onClick={() => void toggleChapterBookmark(chapter.title)}>
                    <FontAwesomeIcon className="bookmark-outline" icon={faBookmarkRegular} />
                    <FontAwesomeIcon className="bookmark-fill" icon={faBookmarkSolid} />
                  </button>
                </TooltipTarget>
                <button className="chapter-title text-left" onClick={() => toggleManualChapter(chapter.title)}>
                  <h2>
                    {chapter.title} {chapter.subtitle && <span>— {chapter.subtitle}</span>}
                  </h2>
                </button>
                <div className="chapter-meta">
                  <div className="f-mono text-xs">{chapter.wordCount.toLocaleString()} words</div>
                  <div className="mt-0.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                    ~{Math.max(1, Math.round(chapter.wordCount / 200))} min read
                  </div>
                </div>
              </header>
              {expanded && (
                <div className="manuscript-reader mx-auto">
                  <ParagraphView
                    paragraphs={paragraphs.filter((item) => item.chapter === chapter.title)}
                    entities={entities}
                    notes={notes.filter((item) => item.chapter === chapter.title)}
                    textClass={READER_TEXT_CLASSES[textSize]}
                    lineNumberPadding={LINE_NUMBER_PADDING_CLASSES[textSize]}
                    openEntity={(entity) => {
                      setDetail({ entity });
                      setSheet('detail');
                    }}
                    openNote={(note) => {
                      setDetail({ note });
                      setSheet('detail');
                    }}
                  />
                </div>
              )}
            </article>
          );
        })}
      </div>
      {selection && !pendingNote && (
        <SelectionMenu
          selection={selection}
          addNote={addNote}
          addToStoryBible={() => {
            const text = selection.text;
            clearSelection();
            void api.guideCreate(text, '', []).then(focusStoryBibleEntity);
          }}
          dismiss={clearSelection}
        />
      )}
      {pendingNote && <AddNoteDialog anchorText={pendingNote.anchorText} confirm={(text) => void confirmNote(text)} cancel={() => setPendingNote(undefined)} />}
      {sheet && <div className="sheet-backdrop" onMouseDown={closeSheet} />}
      <aside className={`overlay-panel ${sheet ? 'overlay-open' : ''}`} aria-hidden={!sheet}>
        <div className="panel-head">
          <h3 className="text-sm font-semibold">{detail?.note ? 'Note' : detail?.entity?.canonical_name || 'Chapters & Search'}</h3>
          <button className="icon-btn" aria-label="Close" onClick={closeSheet}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className="panel-body scroll-chrome-hidden flex-1 overflow-y-auto">
          {detail?.note ? (
            <>
              <div className="mb-3">
                <div className="section-label mb-1">Anchored text</div>
                <p className="text-sm italic">“{detail.note.anchorText || 'Paragraph note'}”</p>
              </div>
              <div className="mb-4">
                <div className="section-label mb-1">Note</div>
                <p className="text-sm">{detail.note.text}</p>
              </div>
              <button className="btn btn-danger text-xs" onClick={() => void deleteNote(detail.note!.id)}>
                Delete note
              </button>
            </>
          ) : detail?.entity ? (
            <>
              <EntitySummary
                entity={detail.entity}
                jumpToLine={(chapter, paragraph) => {
                  closeSheet();
                  showChapter(chapter, paragraph);
                }}
              />
              <button className="btn btn-ghost mt-4 text-xs" onClick={() => focusStoryBibleEntity(detail.entity!.id)}>
                Open in Story Bible →
              </button>
            </>
          ) : (
            <>
              <SearchBar query={searchQuery} onQueryChange={(value) => void runSearch(value)} />
              <div className="mt-4 border-t pt-3">
                <div className="section-label mb-1">Chapters</div>
                <ChapterNav
                  chapters={chapters}
                  selectedId={chapters.find((item) => item.title === active)?.id}
                  bookmarks={readerState.bookmarks}
                  searchQuery={searchQuery}
                  searchResults={searchResults}
                  lineNumbers={lineNumbers}
                  select={(id, paragraph) => {
                    const chapter = chapters.find((item) => item.id === id);
                    if (chapter) {
                      closeSheet();
                      showChapter(chapter.title, paragraph);
                    }
                  }}
                  removeBookmark={(id) =>
                    void api
                      .readerBookmarkDelete(id)
                      .then(() => setReaderState((current) => ({ ...current, bookmarks: current.bookmarks.filter((item) => item.id !== id) })))
                      .catch((error) => notify(String(error)))
                  }
                />
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
