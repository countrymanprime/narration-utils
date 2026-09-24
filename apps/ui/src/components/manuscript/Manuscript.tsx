import { LoadError } from '../layout/LoadError';
import { describeApiError } from '../../api/errorMessage';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAnglesDown, faAnglesUp, faFont, faList } from '@fortawesome/free-solid-svg-icons';
import type {
  CreditsRenderResult,
  CreditTemplate,
  GuideEntity,
  ManuscriptChapter,
  ManuscriptNote,
  ManuscriptParagraph,
  ReaderState,
  RetailSample,
  SearchHit,
} from '../../types';
import { categoryCssName, chapterLineNumbers, chapterTextMatches, isListableChapter, STORY_BIBLE_TABS } from '../../state';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import { useTextSelection } from '../../hooks/useTextSelection';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { SlideOver } from '../primitives/SlideOver';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { ChapterNav } from './ChapterNav';
import { CreditsEntry } from './CreditsEntry';
import { loadCreditsExpanded, saveCreditsExpanded, type CreditsExpanded } from './creditsExpandedStorage';
import { ReaderCard } from './ReaderCard';
import { retailSampleRange } from './retailSampleRange';
import { SearchBar } from './SearchBar';
import { ParagraphView } from './ParagraphView';
import { SelectionMenu } from './SelectionMenu';
import { AddNoteDialog } from './AddNoteDialog';
import { DictionaryInstallPrompt, isSingleWord, WordLookupAnswer } from './WordLookup';
import { LOOKUP_ACTION, useWordLookup } from './useWordLookup';
import { CAT_DOT_BG, CAT_DOT_CLASS, EntitySummary } from './EntitySummary';
import { IconButton } from '../primitives/IconButton';
import type { Notify } from '../primitives/Toast';
import { ReadAloudDialog } from '../teleprompter/ReadAloudDialog';

// Read aloud (teleprompter-manuscript-integration.prd.md) reads narration chapters only, matching the standalone
// Teleprompter page's own chapter filter.
const isNarrationChapter = (chapter: Pick<ManuscriptChapter, 'contentKind'>) => (chapter.contentKind ?? 'narration') === 'narration';

const TEXT_SIZES = ['small', 'medium', 'large'] as const;
const TEXT_SIZE_OPTIONS = TEXT_SIZES.map((value) => ({ value, label: value }));
// --hl-pad-y sizes a highlight's vertical padding so its background fills the
// full line height at each text size (see primitives/Highlight.tsx).
const READER_TEXT_CLASSES = {
  small: 'text-sm leading-5 [--hl-pad-y:0.07em]',
  medium: 'text-base leading-6 [--hl-pad-y:0.09em]',
  large: 'text-xl leading-7 [--hl-pad-y:0.07em]',
} as const;
// How long "Go to line" keeps its destination highlighted (ADR: halved from 60s so it settles
// sooner once the narrator has found the line - see the reader search and controls PRD, R7).
const JUMP_HIGHLIGHT_MS = 30_000;
const LINE_NUMBER_PADDING_CLASSES = { small: '!pt-2', medium: '!pt-2.5', large: '!pt-3' } as const;
const defaultState: ReaderState = { expandedChapters: [], bookmarks: [] };
const escapeSelector = (value: string) =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');

export function Manuscript({
  notify,
  focusStoryBibleEntity,
  projectFolder,
}: {
  notify: Notify;
  focusStoryBibleEntity: (id: string) => void;
  /** Keys the credits cards' remembered open state (MC5 b): a project's own choice, not the viewer's in general. */
  projectFolder: string;
}) {
  const api = useApi();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const readerRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const searchRequest = useRef(0);
  const requestedChapters = useRef(new Set<string>());
  const highlightTimer = useRef<number | undefined>(undefined);
  // The selection's actions that call the host (a Story Bible entry, a lookup) run one at a time (ADR 0075).
  const selectionActions = usePendingAction();
  const wordLookup = useWordLookup({ notify, actions: selectionActions });
  const [bandHeight, setBandHeight] = useState(0);
  const [chapters, setChapters] = useState<Awaited<ReturnType<typeof api.manuscriptChapters>>>([]);
  const [paragraphs, setParagraphs] = useState<ManuscriptParagraph[]>([]);
  const [loadingChapters, setLoadingChapters] = useState<Set<string>>(new Set());
  const [entities, setEntities] = useState<GuideEntity[]>([]);
  const [notes, setNotes] = useState<ManuscriptNote[]>([]);
  const [readerState, setReaderState] = useState<ReaderState>(defaultState);
  const [sheet, setSheet] = useState<'chapters' | 'detail'>();
  const [textSize, setTextSize] = useState<(typeof TEXT_SIZES)[number]>('medium');
  const [detail, setDetail] = useState<{ entity?: GuideEntity; note?: ManuscriptNote }>();
  const [pendingNote, setPendingNote] = useState<{ paragraphIndex: number; anchorStart: number; anchorEnd: number; anchorText: string }>();
  const [jumpTarget, setJumpTarget] = useState<number>();
  const [readAloudChapter, setReadAloudChapter] = useState<ManuscriptChapter>();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  // The query text a result was actually fetched for - not the debounce hook's own state, so an
  // Enter that jumps the debounce (R1) still reads as settled right away, instead of "Searching..."
  // lingering for the rest of the window a keystroke already bypassed.
  const [lastFetchedQuery, setLastFetchedQuery] = useState('');
  // Mirrors lastFetchedQuery for the debounce effect below to read without depending on it (a
  // dependency would also fire the effect right when Enter's own fetch settles, one render before
  // the debounced value itself has caught up - re-firing fetchSearch with the *old*, not-yet-caught-up
  // debouncedQuery. A ref lets the effect stay keyed on debouncedQuery alone.
  const lastFetchedQueryRef = useRef('');
  const debouncedQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  // Credits pseudo-entries (PRD audiobook-credits-templates.prd.md, Phase 3): read-only, never chapters, so they
  // live entirely in local state - no readerState field, no manuscript.json entry, nothing ChapterNav or search
  // iterates over. Per ADR 0093's convention (the Home estimate's own reading default until a project can choose
  // its own opening/closing template), this uses the first opening-kind and first closing-kind template the
  // library returns, rendered with the current project's values.
  const [creditsTemplates, setCreditsTemplates] = useState<CreditTemplate[]>([]);
  const [creditsPreviews, setCreditsPreviews] = useState<{ opening?: CreditsRenderResult; closing?: CreditsRenderResult }>({});
  // Open by default (MC5), remembered per project in browser storage - never in expandedChapters/readerStateSave,
  // since a credits id is not a chapter id and the host's paragraph fetch would fail for one.
  const [creditsExpanded, setCreditsExpandedState] = useState<CreditsExpanded>(() => loadCreditsExpanded(projectFolder));
  const setCreditsExpanded = useCallback(
    (next: CreditsExpanded | ((current: CreditsExpanded) => CreditsExpanded)) => {
      setCreditsExpandedState((current) => {
        const resolved = typeof next === 'function' ? next(current) : next;
        saveCreditsExpanded(projectFolder, resolved);
        return resolved;
      });
    },
    [projectFolder],
  );
  // The retail sample the narrator picked in Settings > Credits (Phase 5, C10, ADR 0152): a marker on its lines, read
  // like the credits templates above - a failure leaves the reader unmarked rather than blocking it.
  const [retailSample, setRetailSample] = useState<RetailSample | null>(null);
  const { selection, clear: clearSelection } = useTextSelection(readerRef);
  // Reference material (Contents, Characters, ...) stays in manuscript.json and the chapter list,
  // but is never a page the narrator flips through - see isListableChapter and the reader search and
  // controls PRD Phase 5 (supersedes the reader half of ADR 0005; ADR 0090).
  const recordedChapters = useMemo(() => chapters.filter(isListableChapter), [chapters]);
  const active = readerState.activeChapter || recordedChapters[0]?.id;
  const lineNumbers = useMemo(() => chapterLineNumbers(paragraphs), [paragraphs]);
  const titleMatches = useMemo(() => chapterTextMatches(chapters, searchQuery), [chapters, searchQuery]);
  // True once there is a query the panel has not shown results for yet - the debounce wait, or
  // (briefly) the request itself - so "No matches" never flashes before a settled answer exists (R1).
  const searchPending = Boolean(searchQuery.trim()) && searchQuery !== lastFetchedQuery;
  const sampleRange = useMemo(() => retailSampleRange(chapters, retailSample), [chapters, retailSample]);
  const openingTemplate = creditsTemplates.find((template) => template.kind === 'opening');
  const closingTemplate = creditsTemplates.find((template) => template.kind === 'closing');
  // The read-aloud dialog's notes, memoized so its marks (and every memoized row of its reader) keep their identity.
  const readAloudNotes = useMemo(
    () =>
      readAloudChapter ? notes.filter((item) => item.chapterId === readAloudChapter.id || (!item.chapterId && item.chapter === readAloudChapter.title)) : [],
    [notes, readAloudChapter],
  );

  useEffect(() => {
    const element = bandRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setBandHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);
  const closeSheet = () => {
    setSheet(undefined);
    setDetail(undefined);
  };
  // Discards any in-flight search response too (the same guard fetchSearch checks), so a slow
  // response that resolves after a clear can never repopulate results the narrator just dismissed.
  const clearSearch = () => {
    searchRequest.current += 1;
    setSearchQuery('');
    setSearchResults([]);
    lastFetchedQueryRef.current = '';
    setLastFetchedQuery('');
  };
  const saveState = useCallback(
    async (next: ReaderState) => {
      setReaderState(next);
      try {
        await api.readerStateSave({
          activeChapter: next.activeChapter,
          activeSourceLine: next.activeSourceLine,
          expandedChapters: next.expandedChapters || [],
        });
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    },
    [api, notify],
  );

  const [loadError, setLoadError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    void (async () => {
      try {
        const [nextChapters, nextEntities, state, nextNotes] = await Promise.all([
          api.manuscriptChapters(),
          api.guideEntities(),
          api.readerState(),
          api.noteList(),
        ]);
        const firstChapter = nextChapters.filter(isListableChapter)[0]?.id;
        const chapterId = (value: string | undefined) => nextChapters.find((item) => item.id === value || item.title === value)?.id || value;
        // A reader state saved before this phase (or a manuscript re-imported since) may still point
        // at a reference chapter (R14: the filter covers existing manuscripts too, since it keys on
        // contentKind, not a migration flag) - fall back to the first recorded one instead.
        const resolvedActive = chapterId(state.activeChapter);
        const activeChapter = nextChapters.find((item) => item.id === resolvedActive && isListableChapter(item)) ? resolvedActive : firstChapter;
        // Built from the already-resolved activeChapter (not the raw, possibly-hidden state.activeChapter),
        // so a reader state saved before this phase still opens expanded on the chapter it now falls back
        // to, instead of rendering that chapter's header collapsed with nothing expanded underneath.
        const expandedChapters = (state.expandedChapters ?? [activeChapter])
          .map(chapterId)
          .filter((id): id is string => Boolean(id))
          .filter((id) => nextChapters.find((item) => item.id === id && isListableChapter(item)));
        setLoadError(undefined);
        setChapters(nextChapters);
        setNotes(nextNotes);
        setEntities(nextEntities);
        setReaderState({ ...state, activeChapter, expandedChapters });
      } catch (error) {
        // Nothing to read without these four lists, so the page says so inline and offers Retry (ADR 0069).
        setLoadError(describeApiError(error));
      }
    })();
  }, [api, loadAttempt]);
  // Credits templates (Phase 3): a secondary read, like AudiobookEstimatePanel's own credits stat - a failure here
  // should not block the manuscript itself, so it is swallowed and simply leaves no credits entries rendered.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const templates = await api.creditsTemplates();
        if (active) setCreditsTemplates(templates);
      } catch {
        if (active) setCreditsTemplates([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [api, loadAttempt]);
  useEffect(() => {
    let active = true;
    api
      .creditsRetailSample()
      .then((answer) => active && setRetailSample(answer.sample))
      .catch(() => active && setRetailSample(null));
    return () => {
      active = false;
    };
  }, [api, loadAttempt]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [opening, closing] = await Promise.all([
        openingTemplate ? api.creditsPreview(openingTemplate.body).catch(() => undefined) : Promise.resolve(undefined),
        closingTemplate ? api.creditsPreview(closingTemplate.body).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      if (active) setCreditsPreviews({ opening, closing });
    })();
    return () => {
      active = false;
    };
  }, [api, openingTemplate, closingTemplate]);
  useEffect(() => {
    for (const chapterId of readerState.expandedChapters || []) {
      if (requestedChapters.current.has(chapterId)) continue;
      requestedChapters.current.add(chapterId);
      setLoadingChapters((current) => new Set(current).add(chapterId));
      void api
        .manuscriptParagraphs(chapterId)
        .then((next) => setParagraphs((current) => [...current.filter((paragraph) => paragraph.chapterId !== chapterId), ...next]))
        .catch((error) => notify(describeApiError(error), 'error'))
        .finally(() =>
          setLoadingChapters((current) => {
            const next = new Set(current);
            next.delete(chapterId);
            return next;
          }),
        );
    }
  }, [readerState.expandedChapters, api, notify]);
  const showChapter = useCallback(
    (chapter: string, paragraph?: number) => {
      if (!chapter) return;
      const target = chapters.find((item) => item.id === chapter || item.title === chapter);
      const chapterId = target?.id || chapter;
      // Every caller (search results, Story Bible "Go to line", hash links, ...) funnels through
      // here, so this one guard covers all of them (R13/ADR 0090) rather than duplicating it at
      // each call site - a reference chapter is never a page the reader shows.
      if (target && !isListableChapter(target)) {
        notify("That link points to reference material, which isn't shown in the manuscript reader.");
        return;
      }
      const next = { ...readerState, activeChapter: chapterId, expandedChapters: Array.from(new Set([...(readerState.expandedChapters || []), chapterId])) };
      void saveState(next);
      const selector = paragraph === undefined ? `[data-chapter-id="${escapeSelector(chapterId)}"]` : `[data-paragraph="${paragraph}"]`;
      // Expanding a chapter that wasn't already rendered mounts a new
      // ParagraphView (which re-runs entity highlighting) before the target
      // node exists; poll across frames instead of guessing a fixed delay so
      // cross-chapter jumps land correctly once the node actually appears.
      const deadline = Date.now() + 2000;
      const attempt = () => {
        const target = document.querySelector<HTMLElement>(selector);
        if (target) {
          target.scrollIntoView?.({ behavior: 'smooth', block: paragraph === undefined ? 'start' : 'center' });
          window.clearTimeout(highlightTimer.current);
          if (paragraph !== undefined) {
            setJumpTarget(paragraph);
            highlightTimer.current = window.setTimeout(() => setJumpTarget(undefined), JUMP_HIGHLIGHT_MS);
          }
          return;
        }
        if (Date.now() < deadline) requestAnimationFrame(attempt);
      };
      requestAnimationFrame(attempt);
    },
    [chapters, readerState, saveState, notify],
  );
  // Deep links into a specific paragraph/chapter arrive as a URL anchor -
  // "#p123" for paragraph 123 (its globally unique index, assigned at
  // manuscript import - see manuscript_guide.py's export_manuscript), or
  // "#cChapter Title" to land on a chapter without a specific line. A
  // paragraph-to-chapter mapping arrives with the lightweight chapter list,
  // so this does not wait for any paragraph body to load.
  // showChapter changes identity every time it saves reader state, and the router clears the
  // hash asynchronously, so without this guard the effect re-fires for a hash it already
  // handled and loops ("Maximum update depth exceeded").
  const handledHash = useRef('');
  useEffect(() => {
    const hash = location.hash;
    if (!hash) {
      handledHash.current = '';
      return;
    }
    if (handledHash.current === hash) return;
    // "#credits-opening"/"#credits-closing" (Home's credits rows, credits-in-chapter-table.prd.md Phase 2, CT7): open
    // the matching pseudo-entry and scroll to it, matching "#c<id>"'s open-and-scroll for a chapter. Checked before the
    // generic "#c" prefix below, which would otherwise swallow it (both start with "#c").
    if (hash === '#credits-opening' || hash === '#credits-closing') {
      const kind = hash === '#credits-opening' ? 'opening' : 'closing';
      handledHash.current = hash;
      setCreditsExpanded((current) => ({ ...current, [kind]: true }));
      const deadline = Date.now() + 2000;
      const attempt = () => {
        const target = document.querySelector<HTMLElement>(`[data-credits-entry="${kind}"]`);
        if (target) {
          target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          return;
        }
        if (Date.now() < deadline) requestAnimationFrame(attempt);
      };
      requestAnimationFrame(attempt);
      routerNavigate('/manuscript', { replace: true });
      return;
    }
    let chapter: string | undefined;
    let paragraph: number | undefined;
    if (hash.startsWith('#p')) {
      paragraph = Number(hash.slice(2));
      if (Number.isNaN(paragraph)) return;
      chapter = chapters.find((item) => item.paragraphIds?.some((row) => row.index === paragraph))?.id;
      if (!chapter) return;
    } else if (hash.startsWith('#c')) {
      const target = decodeURIComponent(hash.slice(2));
      chapter = chapters.find((item) => item.id === target || item.title === target)?.id || target;
    } else {
      return;
    }
    handledHash.current = hash;
    // showChapter itself guards against a reference chapter (R13/ADR 0090: a no-op with a message,
    // the reader has no "reference chapter's own view" to redirect to instead), so every caller -
    // this hash link, a search result, Story Bible "Go to line" - gets the same behavior for free.
    showChapter(chapter, paragraph);
    routerNavigate('/manuscript', { replace: true });
  }, [location.hash, chapters, routerNavigate, showChapter, setCreditsExpanded]);
  const toggleManualChapter = (chapter: string) => {
    const expanded = new Set(readerState.expandedChapters || []);
    if (expanded.has(chapter)) expanded.delete(chapter);
    else expanded.add(chapter);
    void saveState({ ...readerState, activeChapter: chapter, expandedChapters: [...expanded] });
  };
  const toggleChapterBookmark = async (chapter: string) => {
    const current = readerState.bookmarks.find((item) => item.kind === 'chapter' && item.chapterId === chapter);
    try {
      if (current) {
        await api.readerBookmarkDelete(current.id);
        setReaderState({ ...readerState, bookmarks: readerState.bookmarks.filter((item) => item.id !== current.id) });
      } else {
        const title = chapters.find((item) => item.id === chapter)?.title || '';
        const next = await api.readerBookmarkCreate({ kind: 'chapter', chapter: title, chapterId: chapter });
        setReaderState({ ...readerState, bookmarks: [...readerState.bookmarks, next] });
      }
    } catch (error) {
      notify(describeApiError(error), 'error');
    }
  };
  // The one place that ever calls the Go search: from the debounce effect below once it settles,
  // and directly on Enter (R1). searchRequest guards a stale response the same way it always did.
  const fetchSearch = useCallback(
    async (query: string) => {
      const request = ++searchRequest.current;
      const settle = () => {
        lastFetchedQueryRef.current = query;
        setLastFetchedQuery(query);
      };
      if (!query.trim()) {
        setSearchResults([]);
        settle();
        return;
      }
      try {
        const results = await api.manuscriptSearch(query);
        if (request !== searchRequest.current) return;
        setSearchResults(results);
        settle();
      } catch (error) {
        if (request !== searchRequest.current) return;
        notify(describeApiError(error), 'error');
        settle();
      }
    },
    [api, notify],
  );
  useEffect(() => {
    // Enter (R1) already fetched this exact query directly - skip the redundant repeat once the
    // debounce hook's own timer independently catches up to the same settled value a moment later.
    if (debouncedQuery === lastFetchedQueryRef.current) return;
    void fetchSearch(debouncedQuery);
  }, [debouncedQuery, fetchSearch]);
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
      const created = await api.noteCreate(paragraph.chapterId, paragraph.id, text, target.anchorStart, target.anchorEnd, target.anchorText);
      setNotes((current) => [...current, created]);
      notify('Note added.');
    } catch (error) {
      notify(describeApiError(error), 'error');
    }
  };
  const deleteNote = async (id: string) => {
    try {
      await api.noteDelete(id);
      setNotes((current) => current.filter((item) => item.id !== id));
      closeSheet();
      notify('Note deleted.');
    } catch (error) {
      notify(describeApiError(error), 'error');
    }
  };

  if (loadError) return <LoadError title="Manuscript" message={loadError} retry={() => setLoadAttempt((attempt) => attempt + 1)} />;

  return (
    <div className="reader-page min-h-full [--reader-inline:1.5rem] max-md:[--reader-inline:1rem]" style={{ '--band-h': `${bandHeight}px` } as CSSProperties}>
      <div
        ref={bandRef}
        className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)] p-0 shadow-[0_2px_8px_color-mix(in_srgb,var(--text)_10%,transparent)]"
      >
        <div className="px-[var(--reader-inline)] pt-4 pb-3">
          <div className="mb-4 flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
            <Heading title="Manuscript" />
            <div className="flex flex-wrap gap-x-4 gap-y-[0.65rem] font-['Barlow_Condensed',sans-serif] text-[0.72rem] tracking-wider text-[var(--text-muted)] uppercase">
              {[...STORY_BIBLE_TABS.filter((item) => item !== 'All'), 'Note'].map((name) => (
                <span key={name} className="flex items-center gap-1">
                  <span className={CAT_DOT_CLASS} style={{ background: CAT_DOT_BG[categoryCssName(name === 'Location' ? 'Place' : name)] }} />
                  {name}
                </span>
              ))}
            </div>
          </div>
          {/* One control cluster: text size on the left, chapters/search and expand/collapse on the right (R12) - wraps to
              a second line only below 400px, since ml-auto pushes the right group down with the row rather than
              overlapping it once the row can no longer fit both groups side by side. */}
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Tooltip
                label="Text size"
                icon={<FontAwesomeIcon icon={faFont} />}
                text="The manuscript always uses the full reading width - adjust text size instead."
              />
              <ToggleGroup
                label="Text size"
                className="gap-1"
                value={textSize}
                onChange={(value) => setTextSize(value as (typeof TEXT_SIZES)[number])}
                options={TEXT_SIZE_OPTIONS}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <TooltipTarget text="Chapters & Search">
                <IconButton
                  label="Chapters & Search"
                  onClick={() => {
                    setDetail(undefined);
                    setSheet('chapters');
                  }}
                >
                  <FontAwesomeIcon icon={faList} />
                </IconButton>
              </TooltipTarget>
              <TooltipTarget text="Expand all chapters">
                <IconButton
                  label="Expand all chapters"
                  onClick={() => {
                    void saveState({ ...readerState, expandedChapters: recordedChapters.map((chapter) => chapter.id) });
                    setCreditsExpanded({ opening: true, closing: true });
                  }}
                >
                  <FontAwesomeIcon icon={faAnglesDown} />
                </IconButton>
              </TooltipTarget>
              <TooltipTarget text="Collapse all chapters">
                <IconButton
                  label="Collapse all chapters"
                  onClick={() => {
                    void saveState({ ...readerState, expandedChapters: [] });
                    setCreditsExpanded({ opening: false, closing: false });
                  }}
                >
                  <FontAwesomeIcon icon={faAnglesUp} />
                </IconButton>
              </TooltipTarget>
            </div>
          </div>
        </div>
      </div>
      <div ref={readerRef} className="reader-chapters pt-3">
        {openingTemplate && (
          <CreditsEntry
            kind="opening"
            preview={creditsPreviews.opening}
            expanded={creditsExpanded.opening}
            onToggle={() => setCreditsExpanded((current) => ({ ...current, opening: !current.opening }))}
            textClass={READER_TEXT_CLASSES[textSize]}
          />
        )}
        {recordedChapters.map((chapter) => {
          const expanded = (readerState.expandedChapters || []).includes(chapter.id);
          const chapterBookmark = readerState.bookmarks.find((item) => item.kind === 'chapter' && item.chapterId === chapter.id);
          return (
            <ReaderCard
              key={chapter.id}
              chapterId={chapter.id}
              title={chapter.title}
              subtitle={chapter.subtitle}
              expanded={expanded}
              onToggleExpand={() => toggleManualChapter(chapter.id)}
              bookmarked={Boolean(chapterBookmark)}
              onToggleBookmark={() => void toggleChapterBookmark(chapter.id)}
              showRetailSample={Boolean(sampleRange?.chapterIds.has(chapter.id))}
              showReadAloud={isNarrationChapter(chapter)}
              onReadAloud={() => setReadAloudChapter(chapter)}
              wordCount={chapter.wordCount}
            >
              {loadingChapters.has(chapter.id) ? (
                <div className="space-y-2 p-4" aria-label={`Loading ${chapter.title}`}>
                  {(chapter.paragraphIds || []).map((paragraph) => (
                    <div key={paragraph.id} className="h-5 animate-pulse rounded bg-[var(--surface-2)]" />
                  ))}
                </div>
              ) : (
                <ParagraphView
                  paragraphs={paragraphs.filter((item) => item.chapterId === chapter.id)}
                  entities={entities}
                  notes={notes.filter((item) => item.chapterId === chapter.id || (!item.chapterId && item.chapter === chapter.title))}
                  textClass={READER_TEXT_CLASSES[textSize]}
                  lineNumberPadding={LINE_NUMBER_PADDING_CLASSES[textSize]}
                  jumpTarget={jumpTarget}
                  retailSample={sampleRange}
                  openEntity={(entity) => {
                    setDetail({ entity });
                    setSheet('detail');
                  }}
                  openNote={(note) => {
                    setDetail({ note });
                    setSheet('detail');
                  }}
                />
              )}
            </ReaderCard>
          );
        })}
        {closingTemplate && (
          <CreditsEntry
            kind="closing"
            preview={creditsPreviews.closing}
            expanded={creditsExpanded.closing}
            onToggle={() => setCreditsExpanded((current) => ({ ...current, closing: !current.closing }))}
            textClass={READER_TEXT_CLASSES[textSize]}
          />
        )}
      </div>
      {selection && !pendingNote && (
        <SelectionMenu
          selection={selection}
          addNote={addNote}
          addingToStoryBible={selectionActions.isPending('add')}
          addToStoryBible={() =>
            void selectionActions.run('add', async () => {
              try {
                const id = await api.guideCreate(selection.text, '', []);
                clearSelection();
                focusStoryBibleEntity(id);
              } catch (error) {
                notify(describeApiError(error), 'error');
              }
            })
          }
          lookUp={
            isSingleWord(selection.text)
              ? () =>
                  void wordLookup.lookUp(selection.text).then((moved) => {
                    if (moved) clearSelection();
                  })
              : undefined
          }
          lookingUp={selectionActions.isPending(LOOKUP_ACTION)}
          dismiss={clearSelection}
        />
      )}
      <SlideOver open={wordLookup.answerOpen} title={`Look up: ${wordLookup.answer?.query ?? ''}`} onClose={wordLookup.closeAnswer}>
        {wordLookup.answer && <WordLookupAnswer answer={wordLookup.answer} />}
      </SlideOver>
      {wordLookup.gate && <DictionaryInstallPrompt gate={wordLookup.gate} install={wordLookup.install} dismiss={wordLookup.closeGate} />}
      {pendingNote && <AddNoteDialog anchorText={pendingNote.anchorText} confirm={(text) => void confirmNote(text)} cancel={() => setPendingNote(undefined)} />}
      <SlideOver
        open={Boolean(sheet)}
        title={detail?.note ? 'Note' : detail?.entity?.canonical_name || 'Chapters & Search'}
        onClose={closeSheet}
        // Escape clears an in-progress search before it closes the panel, so a narrator who
        // mistypes doesn't lose the panel along with the query (R8): the first Escape is handled
        // right here (inside Base UI's own dismiss flow, which is the only listener that reliably
        // sees the key - a separate window-level handler raced it and lost, since Base UI's Drawer
        // stops the native event from reaching window once it decides to act on Escape) and keeps
        // the panel open; a second Escape returns false and the panel closes as normal.
        onEscape={() => {
          if (sheet !== 'chapters' || !searchQuery.trim()) return false;
          clearSearch();
          return true;
        }}
      >
        {detail?.note ? (
          <>
            <div className="mb-3">
              <div className="section-label mb-1 font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
                Anchored text
              </div>
              <p className="text-sm italic">“{detail.note.anchorText || 'Paragraph note'}”</p>
            </div>
            <div className="mb-4">
              <div className="section-label mb-1 font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
                Note
              </div>
              <p className="text-sm">{detail.note.text}</p>
            </div>
            <Button variant="danger" className="text-xs" onClick={() => void deleteNote(detail.note!.id)}>
              Delete note
            </Button>
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
            <Button variant="ghost" className="mt-4 text-xs" onClick={() => focusStoryBibleEntity(detail.entity!.id)}>
              Open in Story Bible →
            </Button>
          </>
        ) : (
          <>
            <SearchBar query={searchQuery} onQueryChange={setSearchQuery} onEnter={() => void fetchSearch(searchQuery)} autoFocus />
            <div className="mt-4 border-t pt-3">
              <div className="section-label mb-1 font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
                Chapters
              </div>
              <ChapterNav
                chapters={chapters}
                selectedId={active}
                bookmarks={readerState.bookmarks}
                searchQuery={searchQuery}
                searchResults={searchResults}
                titleMatches={titleMatches}
                pending={searchPending}
                lineNumbers={lineNumbers}
                select={(id, paragraph) => {
                  const chapter = chapters.find((item) => item.id === id);
                  if (chapter) {
                    clearSearch();
                    closeSheet();
                    showChapter(chapter.id, paragraph);
                  }
                }}
                removeBookmark={(id) =>
                  void api
                    .readerBookmarkDelete(id)
                    .then(() => setReaderState((current) => ({ ...current, bookmarks: current.bookmarks.filter((item) => item.id !== id) })))
                    .catch((error) => notify(describeApiError(error), 'error'))
                }
              />
            </div>
          </>
        )}
      </SlideOver>
      {readAloudChapter && (
        <ReadAloudDialog chapter={readAloudChapter} entities={entities} notes={readAloudNotes} onClose={() => setReadAloudChapter(undefined)} />
      )}
    </div>
  );
}
