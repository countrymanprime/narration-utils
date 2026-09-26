import { useEffect, useState } from 'react';
import { chapterName } from '../../chapterName';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import { useApi } from '../../api/ApiContext';
import { ChapterSuggestionHint, preselectedChapter } from './ChapterSuggestionHint';
import { ReadAlongView } from './ReadAlongView';
import { ReadingControlBar } from './ReadingControlBar';
import { CREDITS_LABEL, type CreditsKind } from './readerModel';
import { UnresolvedCreditsWarning } from './UnresolvedCreditsWarning';
import { useFollowCursor } from './useFollowCursor';
import { ACTIVE_PHASES, errorText, useTeleprompterSession } from './useTeleprompterSession';
import type { ChapterSuggestion, CreditsRenderResult, ManuscriptChapter } from '../../types';

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';
const CREDITS_KINDS: CreditsKind[] = ['opening', 'closing'];
/** Picker values for the credits; a chapter's value is its id, which never starts with this prefix. */
const CREDITS_PREFIX = 'credits:';

const creditsKindOf = (value: string): CreditsKind | undefined => CREDITS_KINDS.find((kind) => value === `${CREDITS_PREFIX}${kind}`);

type Props = {
  /** Opens Settings > Credits, where a token with no value is filled in (C6's "link to fix in Settings"). */
  onFixCredits?: () => void;
};

/**
 * The credits as the teleprompter reads them (audiobook-credits-templates.prd.md Phase 4, ADR 0150): the first opening- and
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

export function TeleprompterPage({ onFixCredits }: Props = {}) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const [chosen, setChosen] = useState('');
  const [suggestion, setSuggestion] = useState<ChapterSuggestion>();
  const [error, setError] = useState('');
  const creditsPreviews = useCreditsPreviews();

  useEffect(() => {
    let live = true;
    void Promise.all([
      api.manuscriptChapters(),
      api.readerState().catch(() => undefined),
      // The REAPER suggestion (ADR 0113) is only a hint: no .rpp in the project, or none chosen yet, is the normal case
      // for a narrator not using REAPER, so a failure means no hint rather than an error on the page.
      api.chapterSuggestion().catch(() => undefined),
      api.teleprompterState().catch(() => undefined),
    ])
      .then(([all, reader, suggested, host]) => {
        if (!live) return;
        const narration = all.filter((item) => (item.contentKind ?? 'narration') === 'narration');
        setChapters(narration);
        setSuggestion(suggested);
        const last = narration.find((item) => item.id === reader?.activeChapter || item.title === reader?.activeChapter);
        // A confident suggestion names the chapter being recorded, so it wins over the last chapter read - but never
        // over a session already running, whose chapter the reader is showing.
        const sessionRunning = host && ACTIVE_PHASES.includes(host.phase);
        const recording = sessionRunning ? undefined : preselectedChapter(suggested, narration);
        setChosen((current) => current || recording || (last ?? narration[0])?.id || '');
      })
      .catch((reason) => live && setError(errorText(reason)));
    return () => {
      live = false;
    };
  }, [api]);

  const creditsKind = creditsKindOf(chosen);
  const creditsPreview = creditsKind ? creditsPreviews[creditsKind] : undefined;
  const chapterId = creditsKind ? '' : chosen;
  const t = useTeleprompterSession({
    chapterId,
    chapter: chapters?.find((item) => item.id === chapterId),
    credits: creditsKind && creditsPreview ? { kind: creditsKind, text: creditsPreview.text } : undefined,
  });
  const follow = useFollowCursor({ active: t.active, cursor: t.cursor });

  const select = (value: string) => {
    setChosen(value);
    t.reset();
  };

  const creditsOption = (kind: CreditsKind) => (creditsPreviews[kind] ? [{ value: `${CREDITS_PREFIX}${kind}`, label: CREDITS_LABEL[kind] }] : []);
  const options = [...creditsOption('opening'), ...(chapters ?? []).map((item) => ({ value: item.id, label: chapterName(item) })), ...creditsOption('closing')];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Heading title="Teleprompter">Read a chapter aloud and follow along - the highlight moves with your voice.</Heading>
      {chapters?.length === 0 && (
        <Panel title="This manuscript has no chapters to read">
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            The teleprompter reads narration chapters. Import a manuscript with at least one narration chapter first.
          </p>
        </Panel>
      )}
      {creditsKind && creditsPreview && creditsPreview.unresolved.length > 0 && (
        <UnresolvedCreditsWarning kind={creditsKind} tokens={creditsPreview.unresolved} onFix={onFixCredits} />
      )}
      {chapters && chapters.length > 0 && (
        <>
          <Panel>
            <label className={LABEL_CLASS} htmlFor="teleprompter-chapter">
              Chapter
            </label>
            <Select id="teleprompter-chapter" className="mt-1" fullWidth value={chosen} onChange={select} options={options} />
            <ChapterSuggestionHint suggestion={suggestion} chapters={chapters} value={chapterId} onChoose={select} />
          </Panel>
          <ReadAlongView session={t} follow={follow} />
        </>
      )}
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
      {chapters && chapters.length > 0 && (
        // Sticky, not a `Dialog` footer (Q11 A): the standalone page has no dialog shell of its own.
        <div className="sticky bottom-0 rounded-[0.55rem] border bg-[var(--surface)]" style={{ borderColor: 'var(--border)' }}>
          <ReadingControlBar session={t} follow={follow} />
        </div>
      )}
    </div>
  );
}
