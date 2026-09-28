import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { chapterName } from '../../chapterName';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import { useApi } from '../../api/ApiContext';
import { ChapterSuggestionHint, preselectedChapter } from './ChapterSuggestionHint';
import { BoothSession, type BoothSource } from './BoothSession';
import { CREDITS_LABEL, type CreditsKind } from './readerModel';
import { ACTIVE_PHASES, errorText } from './useTeleprompterSession';
import type { ChapterSuggestion, CreditsRenderResult, GuideEntity, ManuscriptChapter, ManuscriptNote } from '../../types';

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';
const CREDITS_KINDS: CreditsKind[] = ['opening', 'closing'];
/** Picker values for the credits; a chapter's value is its id, which never starts with this prefix. */
const CREDITS_PREFIX = 'credits:';

const creditsKindOf = (value: string): CreditsKind | undefined => CREDITS_KINDS.find((kind) => value === `${CREDITS_PREFIX}${kind}`);

type Props = {
  /** Opens Settings > Credits, where a token with no value is filled in (C6's "link to fix in Settings"). */
  onFixCredits?: () => void;
  /** Exit booth: back to where the narrator came from. */
  onExit: () => void;
};

const NO_ENTITIES: GuideEntity[] = [];
const NO_NOTES: ManuscriptNote[] = [];

/**
 * The credits as the Booth reads them (audiobook-credits-templates.prd.md Phase 4, ADR 0150): the first opening- and
 * first closing-kind template (ADR 0093), each rendered by the host's one renderer (`creditsPreview`). A secondary read, as
 * on the Manuscript page: a failure leaves the credits out of the picker rather than blocking the chapters.
 */
function useCreditsPreviews(): Partial<Record<CreditsKind, CreditsRenderResult>> {
  const api = useApi();
  const [previews, setPreviews] = useState<Partial<Record<CreditsKind, CreditsRenderResult>>>({});
  useEffect(() => {
    let live = true;
    void (async () => {
      const templates = await api.creditsTemplates().catch(() => []);
      const rendered = await Promise.all(
        CREDITS_KINDS.map(async (kind) => {
          const template = templates.find((item) => item.kind === kind);
          const preview = template ? await api.creditsPreview(template.body).catch(() => undefined) : undefined;
          return [kind, preview] as const;
        }),
      );
      if (live) setPreviews(Object.fromEntries(rendered.filter(([, preview]) => preview && preview.words > 0)));
    })();
    return () => {
      live = false;
    };
  }, [api]);
  return previews;
}

/** What the Booth's address names (`/booth?chapter=<id>` or `/booth?credits=opening`), or nothing. */
export function boothQuery(target: { chapter: string } | { credits: CreditsKind }): string {
  return 'chapter' in target ? `?chapter=${encodeURIComponent(target.chapter)}` : `?credits=${target.credits}`;
}

function pickerValueOf(params: URLSearchParams): string {
  const credits = params.get('credits');
  if (credits && CREDITS_KINDS.includes(credits as CreditsKind)) return `${CREDITS_PREFIX}${credits}`;
  return params.get('chapter') ?? '';
}

/**
 * The Record stage's one page (stage-navigation-and-page-replacement.prd.md Phase 4, mock 03), replacing the Teleprompter
 * page, the Manuscript's Read aloud dialog and its booth dialog (ADR 0407: one page per job). The pre-session setup is the
 * chapter picker (with the credits, and REAPER's suggested chapter, ADR 0113) above the text, the resume prompt and the
 * command bar's microphone, engine and model; once a session starts the setup folds away and the reading surface is all
 * that shows. What it reads is in the address (`?chapter=` or `?credits=`), so a Script card, a bookmark and Back all land
 * on the same chapter; with neither, it opens on REAPER's confidently suggested chapter, else the last chapter read.
 */
export function BoothPage({ onFixCredits, onExit }: Props) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const [suggestion, setSuggestion] = useState<ChapterSuggestion>();
  const [entities, setEntities] = useState<GuideEntity[]>(NO_ENTITIES);
  const [notes, setNotes] = useState<ManuscriptNote[]>(NO_NOTES);
  const [fallback, setFallback] = useState('');
  const [error, setError] = useState('');
  const creditsPreviews = useCreditsPreviews();
  const chosen = pickerValueOf(params) || fallback;

  useEffect(() => {
    let live = true;
    void Promise.all([
      api.manuscriptChapters(),
      api.readerState().catch(() => undefined),
      // The REAPER suggestion (ADR 0113) is only a hint: no .rpp in the project, or none chosen yet, is the normal case
      // for a narrator not using REAPER, so a failure means no hint rather than an error on the page.
      api.chapterSuggestion().catch(() => undefined),
      api.teleprompterState().catch(() => undefined),
      // The marks in the text are secondary: without them the chapter still reads.
      api.guideEntities().catch(() => NO_ENTITIES),
      api.noteList().catch(() => NO_NOTES),
    ])
      .then(([all, reader, suggested, host, nextEntities, nextNotes]) => {
        if (!live) return;
        const narration = all.filter((item) => (item.contentKind ?? 'narration') === 'narration');
        setChapters(narration);
        setSuggestion(suggested);
        setEntities(nextEntities);
        setNotes(nextNotes);
        const last = narration.find((item) => item.id === reader?.activeChapter || item.title === reader?.activeChapter);
        // A confident suggestion names the chapter being recorded, so it wins over the last chapter read - but never
        // over a session already running, whose chapter the reader is showing.
        const sessionRunning = host && ACTIVE_PHASES.includes(host.phase);
        const running = sessionRunning ? narration.find((item) => item.id === host.chapter)?.id : undefined;
        const recording = sessionRunning ? undefined : preselectedChapter(suggested, narration);
        setFallback(running || recording || (last ?? narration[0])?.id || '');
      })
      .catch((reason) => live && setError(errorText(reason)));
    return () => {
      live = false;
    };
  }, [api]);

  const creditsKind = creditsKindOf(chosen);
  const creditsPreview = creditsKind ? creditsPreviews[creditsKind] : undefined;
  const chapter = creditsKind ? undefined : chapters?.find((item) => item.id === chosen);
  const chapterNotes = useMemo(
    () => (chapter ? notes.filter((item) => item.chapterId === chapter.id || (!item.chapterId && item.chapter === chapter.title)) : NO_NOTES),
    [notes, chapter],
  );

  // Choosing is an address change (replacing, so Back leaves the Booth rather than stepping through the picker).
  const select = (value: string) => {
    const kind = creditsKindOf(value);
    setParams(new URLSearchParams(boothQuery(kind ? { credits: kind } : { chapter: value }).slice(1)), { replace: true });
  };

  const creditsOption = (kind: CreditsKind) => (creditsPreviews[kind] ? [{ value: `${CREDITS_PREFIX}${kind}`, label: CREDITS_LABEL[kind] }] : []);
  const options = [...creditsOption('opening'), ...(chapters ?? []).map((item) => ({ value: item.id, label: chapterName(item) })), ...creditsOption('closing')];
  const source: BoothSource | undefined = creditsKind
    ? creditsPreview && { kind: 'credits', credits: creditsKind, preview: creditsPreview }
    : chapter && { kind: 'chapter', chapter };

  const setup = chapters && chapters.length > 0 && (
    <div className="mx-auto mb-4 w-full max-w-3xl">
      <Panel>
        <label className={LABEL_CLASS} htmlFor="booth-chapter">
          Chapter
        </label>
        <Select id="booth-chapter" className="mt-1" fullWidth value={chosen} onChange={select} options={options} />
        <ChapterSuggestionHint suggestion={suggestion} chapters={chapters} value={chapter?.id ?? ''} onChoose={select} />
      </Panel>
    </div>
  );

  return (
    // The Booth fills AppShell's content area edge to edge (mock 03), inside the area's own padding.
    <div className="-m-4 flex h-[calc(100%+2rem)] flex-col md:-m-6 md:h-[calc(100%+3rem)]">
      <h1 className="sr-only">Booth</h1>
      {chapters?.length === 0 && (
        <div className="p-4 md:p-6">
          <Panel title="This manuscript has no chapters to read">
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              The booth reads narration chapters. Import a manuscript with at least one narration chapter first.
            </p>
          </Panel>
        </div>
      )}
      {error && (
        <p role="alert" className="p-4 text-sm md:p-6" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
      {source && (
        <div className="min-h-0 flex-1">
          <BoothSession
            key={creditsKind ? `credits:${creditsKind}` : source.kind === 'chapter' ? source.chapter.id : ''}
            source={source}
            entities={source.kind === 'chapter' ? entities : undefined}
            notes={source.kind === 'chapter' ? chapterNotes : undefined}
            setup={setup}
            onExit={onExit}
            onFixCredits={onFixCredits}
          />
        </div>
      )}
    </div>
  );
}
