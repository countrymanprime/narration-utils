import { chapterName } from '../../chapterName';
import { isListableChapter } from '../../state';
import type { ManuscriptChapter } from '../../types';
import { StatusBadge } from '../primitives/StatusBadge';

export const SCRIPT_SECTION_LABEL =
  "section-label font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";

// Mock 02 draws a numbered chapter as "8 · Croquet-Ground", not "Chapter 8 — The Queen's Croquet-Ground", so the column reads at a
// glance. A chapter that is not numbered ("Prologue — Before") keeps its own name, and the full name is the hover title.
const NUMBERED = /^chapter\s+(\d+)\s*(?:[—–:-]\s*(.+))?$/i;
function compactChapterName(name: string): string {
  const match = NUMBERED.exec(name.trim());
  if (!match) return name;
  return match[2] ? `${match[1]} · ${match[2]}` : match[1];
}

// The Script page's chapter column (stage-navigation-and-page-replacement.prd.md Phase 3, mock 02's "Chapters · Prep"): the
// chapters the reader shows (reference material never, ADR 0090), the one being read marked, and each chapter's prep status.
// The status is the one prep count the app has per chapter today: the names first heard in it whose pronunciation the author
// has not confirmed (prep-depth P3's queries). A chapter with none shows nothing rather than a tick, since nothing else says
// its prep is done (prep-depth P7's rollup will).
export function ScriptChapterList({
  chapters,
  activeId,
  toConfirm,
  select,
}: {
  chapters: ManuscriptChapter[];
  activeId?: string;
  /** Names to confirm, by chapter id. */
  toConfirm: ReadonlyMap<string, number>;
  select: (chapterId: string) => void;
}) {
  return (
    <nav aria-label="Chapters">
      <h2 className={`${SCRIPT_SECTION_LABEL} mb-2 px-2`}>Chapters · Prep</h2>
      <ul className="space-y-0.5">
        {chapters.filter(isListableChapter).map((chapter) => {
          const active = chapter.id === activeId;
          const count = toConfirm.get(chapter.id) ?? 0;
          return (
            <li key={chapter.id}>
              <button
                type="button"
                aria-current={active || undefined}
                title={chapterName(chapter)}
                onClick={() => select(chapter.id)}
                className={`w-full rounded-[0.4rem] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)] ${
                  active ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]' : 'text-[var(--text)]'
                }`}
              >
                {compactChapterName(chapterName(chapter))}
              </button>
              {count > 0 && (
                <div className="px-2 pb-1">
                  <StatusBadge tone="warning" label={`${count} to confirm`} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
