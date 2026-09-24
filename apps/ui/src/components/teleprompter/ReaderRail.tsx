import { useId, type ComponentProps } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import type { GuideEntity, ManuscriptNote } from '../../types';
import { CAT_DOT_BG, CAT_DOT_CLASS, EntitySummary } from '../manuscript/EntitySummary';
import { IconButton } from '../primitives/IconButton';
import { Tab, TabList, TabPanel, Tabs } from '../primitives/Tabs';
import { TooltipTarget } from '../primitives/Tooltip';
import { ReaderFlagsPanel } from './ReaderFlagsPanel';
import { ReaderKey } from './ReaderKey';
import type { ReaderMarkTarget } from './readerModel';
import type { RailState, RailTab } from './readerPreferences';

const SECTION_LABEL = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";
const NOTE_ITEM =
  'rounded-[0.35rem] border border-transparent px-2 py-1.5 text-sm aria-[current=true]:border-[var(--accent)] aria-[current=true]:bg-[var(--surface-2)]';
const LIST_BUTTON =
  'flex w-full items-center gap-2 rounded-[0.35rem] border border-transparent px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none aria-[current=true]:border-[var(--accent)] aria-[current=true]:bg-[var(--surface-2)]';

type Props = {
  state: RailState;
  onTab: (tab: RailTab) => void;
  onToggle: () => void;
  /** A session is running, so words can be clicked to seek (the key says so). */
  seekable: boolean;
  /** The story bible entries mentioned in this chapter, in the order they first appear. */
  entities: GuideEntity[];
  /** The notes on this chapter, in reading order. */
  notes: ManuscriptNote[];
  /** What the narrator last opened, from a mark in the text or from the entry list here. */
  selected?: ReaderMarkTarget;
  onSelect: (target: ReaderMarkTarget) => void;
  /** The Flags tab (Phase 7): the session's suspected flags, which kinds show, dismissal and the save status. */
  flagPanel: Omit<ComponentProps<typeof ReaderFlagsPanel>, 'selected' | 'onSelect'>;
};

/**
 * The read-aloud dialog's side rail (teleprompter-manuscript-integration.prd.md Phase 5): the key, the session's suspected
 * flags (Phase 7), the chapter's notes and its story bible entries, beside the text rather than over it, so opening one never covers, moves or scrolls the
 * text being read. It is sticky and scrolls on its own. Whether it is open and which tab shows are per-viewer
 * preferences kept in browser storage (`readerPreferences.ts`); the owner of that state is `ReadAloudDialog`.
 */
export function ReaderRail({ state, onTab, onToggle, seekable, entities, notes, selected, onSelect, flagPanel }: Props) {
  const entityHeadingId = useId();
  const railHeadingId = useId();
  if (!state.open)
    return (
      <div className="md:sticky md:top-0">
        <TooltipTarget text="Show the key, notes and story bible">
          <IconButton label="Show reading panel" onClick={onToggle}>
            <FontAwesomeIcon icon={faChevronLeft} />
          </IconButton>
        </TooltipTarget>
      </div>
    );

  const selectedEntity = selected?.kind === 'entity' ? selected.entity : undefined;
  const selectedNote = selected?.kind === 'note' ? selected.note : undefined;
  const selectedFlag = selected?.kind === 'flag' ? selected.flag : undefined;
  return (
    <aside
      aria-labelledby={railHeadingId}
      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow)] md:sticky md:top-0 md:h-full md:w-[19rem] md:overflow-y-auto lg:w-[20rem]"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span id={railHeadingId} className={SECTION_LABEL}>
          Reading panel
        </span>
        <TooltipTarget text="Hide the panel and widen the text">
          <IconButton label="Hide reading panel" onClick={onToggle} className="flex-none">
            <FontAwesomeIcon icon={faChevronRight} />
          </IconButton>
        </TooltipTarget>
      </div>
      <Tabs value={state.tab} onChange={(tab) => onTab(tab as RailTab)}>
        <TabList label="Panel sections" activation="automatic">
          <Tab value="key">Key</Tab>
          <Tab value="flags">Flags</Tab>
          <Tab value="notes">Notes</Tab>
          <Tab value="bible">Story bible</Tab>
        </TabList>
        <TabPanel value="key" className="pt-3">
          <ReaderKey seekable={seekable} marks layout="list" />
        </TabPanel>
        <TabPanel value="flags" className="pt-3">
          <ReaderFlagsPanel {...flagPanel} selected={selectedFlag} onSelect={(flag) => onSelect({ kind: 'flag', flag })} />
        </TabPanel>
        <TabPanel value="notes" className="pt-3">
          {notes.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No notes in this chapter.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((note) => (
                // A note is read here, not opened further, so the list is text: the one a mark opened is current.
                <li key={note.id} className={NOTE_ITEM} aria-current={note.id === selectedNote?.id || undefined}>
                  <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
                    “{note.anchorText || 'Paragraph note'}”
                  </p>
                  <p className="mt-0.5">{note.text}</p>
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
        <TabPanel value="bible" className="space-y-4 pt-3">
          {selectedEntity && (
            <section aria-labelledby={entityHeadingId}>
              <h3 id={entityHeadingId} className="mb-2 font-semibold">
                {selectedEntity.canonical_name}
              </h3>
              <EntitySummary entity={selectedEntity} />
            </section>
          )}
          <div>
            <div className={`mb-1.5 ${SECTION_LABEL}`}>In this chapter</div>
            {entities.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No story bible entries are mentioned in this chapter.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {entities.map((entity) => (
                  <li key={entity.id}>
                    <button
                      type="button"
                      className={LIST_BUTTON}
                      aria-current={entity.id === selectedEntity?.id || undefined}
                      onClick={() => onSelect({ kind: 'entity', entity })}
                    >
                      <span className={CAT_DOT_CLASS} style={{ background: CAT_DOT_BG[entity.category] ?? 'var(--review)' }} aria-hidden />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{entity.canonical_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabPanel>
      </Tabs>
    </aside>
  );
}
