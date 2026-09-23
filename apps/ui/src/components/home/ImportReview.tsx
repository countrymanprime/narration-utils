import { useEffect, useRef } from 'react';
import type { ManuscriptContentKind, ManuscriptImportPreview, ManuscriptImportSection, ManuscriptImportSelection } from '../../types';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Disclosure } from '../primitives/Disclosure';
import { Select } from '../primitives/Select';
import { Tooltip } from '../primitives/Tooltip';
import {
  checkedCandidateIds,
  describeReview,
  effectiveKind,
  groupSections,
  hasSubtitleChoice,
  hasSubtitleChoices,
  isGroupOpen,
  plural,
  reviewCounts,
  reviewedHeading,
  subtitleKept,
  type ReviewGroupKey,
  type ReviewGroupOpen,
} from './importReviewModel';

const SECTION_KIND_OPTIONS = [
  { value: 'narration', label: 'Narration chapter' },
  { value: 'opening', label: 'Front Matter' },
  { value: 'reference', label: 'Reference material' },
];

// What each group is for, in one short string that is true for that group (the old sentence spoke of reference material only, and front
// matter is left out of the audiobook totals and Proofing in just the same way). Reference material is filtered from the chapter lists
// (ADR 0005); front matter is listed.
const FRONT_MATTER_NOTE = 'Not counted as a chapter: excluded from audiobook totals and Proofing. Still listed and readable in the manuscript.';
const REFERENCE_NOTE = 'Excluded from audiobook totals, Proofing and the chapter list. Still readable in the manuscript.';

const LEGEND_CLASSES = "px-1 font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";

// The heading as it will be written: the title and, when it keeps one, the subtitle, the way the reader writes them ("Chapter One — Down
// the Rabbit-Hole"), and a line turned off that returns to the text, said as such.
function sectionName(section: ManuscriptImportSection, selection: ManuscriptImportSelection): string {
  const heading = reviewedHeading(section, selection);
  if (heading.textLine) return `${heading.title} · ${heading.textLine} ${TEXT_LINE_NOTE}`;
  return heading.subtitle ? `${heading.title} — ${heading.subtitle}` : heading.title;
}

// Said of a subtitle line turned off that becomes the chapter's first paragraph again, so it is narrated (an epigraph under a plain-text heading).
const TEXT_LINE_NOTE = 'is read as text';

/**
 * The lines at the top of the review dialog that say what was found: the format and size with the number of narration chapters, then
 * what else exists (front matter, reference material, suggestions, repairs), all counted from the narrator's choices as they stand.
 */
export function ImportSummary({
  preview,
  selection,
  requiresReset,
}: {
  preview: ManuscriptImportPreview;
  selection: ManuscriptImportSelection;
  requiresReset: boolean;
}) {
  const { headline, detail } = describeReview(preview, reviewCounts(preview, selection));
  return (
    <>
      <p>
        {headline}
        {requiresReset && ' This replaces the active manuscript and clears Story Bible, notes, bookmarks, statuses, and saved comparison results.'}
      </p>
      {detail && <p className="mt-1 text-xs">{detail}</p>}
    </>
  );
}

type ImportReviewProps = {
  preview: ManuscriptImportPreview;
  selection: ManuscriptImportSelection;
  onSelectionChange: (update: (current: ManuscriptImportSelection) => ManuscriptImportSelection) => void;
  headingLevel: number;
  // Markdown only: the narrator chose another chapter heading level, so the host reads the file again.
  onHeadingLevelChange: (level: number) => void;
  // Which groups the narrator opened or closed by hand. The caller holds it, above the dialog that is swapped for a progress dialog while a
  // heading level is read again, so a re-read does not fold the groups back.
  groupOpen: ReviewGroupOpen;
  onGroupOpenChange: (group: ReviewGroupKey, open: boolean) => void;
  // The seam for the per-import "Build the Story Bible after import" choice (owner decision D8: on by default). The choice and the build that
  // follows an import belong to the Story Bible briefs work; this dialog only draws the checkbox when it is handed one, so that work adds the
  // state and the chaining and touches nothing here. Home passes nothing yet, and nothing is shown that does nothing.
  buildStoryBible?: { checked: boolean; onChange: (checked: boolean) => void };
};

// The body of the "Import <file>" review dialog: the choices the narrator can change before the import is written, grouped by what each
// section will be, with a count for each group so a decision is easy to find. The choices are held by the caller (Home), which also sends
// them with the commit; this only shows them and reports a change.
export function ImportReview({
  preview,
  selection,
  onSelectionChange,
  headingLevel,
  onHeadingLevelChange,
  groupOpen,
  onGroupOpenChange,
  buildStoryBible,
}: ImportReviewProps) {
  const candidates = preview.characterCandidates ?? [];
  const sections = preview.sections ?? [];
  const notices = preview.notices ?? [];
  const counts = reviewCounts(preview, selection);
  const groups = groupSections(sections, selection);
  const checkedIds = checkedCandidateIds(preview, selection);
  const open = (key: ReviewGroupKey) => isGroupOpen(key, groupOpen, counts);
  const root = useRef<HTMLDivElement>(null);
  // Reclassifying a row moves it to another group, which is a new place in the page: the select is put back in focus there, so a keyboard
  // narrator does not lose their place, and a group the row moved into opens so the change can be seen.
  const focusAfterMove = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfterMove.current;
    if (id === null) return;
    focusAfterMove.current = null;
    // Matched by comparing, not by building a selector from a host-sent id.
    [...(root.current?.querySelectorAll<HTMLElement>('[data-section-select]') ?? [])].find((select) => select.dataset.sectionSelect === id)?.focus();
  });
  const reclassify = (section: ManuscriptImportSection, kind: ManuscriptContentKind) => {
    if (kind !== effectiveKind(section, selection)) {
      focusAfterMove.current = section.id;
      onGroupOpenChange(kind, true);
    }
    onSelectionChange((current) => ({ ...current, sectionKinds: { ...current.sectionKinds, [section.id]: kind } }));
  };
  const sectionGroup = (kind: ManuscriptContentKind, title: string, summary: string, note?: { label: string; text: string }) =>
    groups[kind].length > 0 && (
      <Disclosure
        title={title}
        summary={summary}
        open={open(kind)}
        onOpenChange={(next) => onGroupOpenChange(kind, next)}
        className="border-t border-[var(--border)]"
        aside={note && <Tooltip label={note.label} text={note.text} />}
      >
        <div className="space-y-1.5 pt-1 pb-3 pl-5">
          {groups[kind].map((section) => {
            const heading = reviewedHeading(section, selection);
            const name = sectionName(section, selection);
            return (
              <div key={section.id} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate" title={name}>
                  {heading.title}
                  {heading.subtitle && <span className="text-[var(--text-muted)]"> — {heading.subtitle}</span>}
                  {heading.textLine && (
                    <span className="text-[var(--text-muted)]">
                      {' '}
                      · {heading.textLine} {TEXT_LINE_NOTE}
                    </span>
                  )}
                </span>
                {hasSubtitleChoice(section) && (
                  // The heading's second line, read as its subtitle or not (story-bible-and-import-ux-briefs PRD, Phase 5). The visible word is
                  // short so the row keeps its room for the title; the name says which line it is about.
                  <div className="flex-none">
                    <Checkbox
                      checked={subtitleKept(section, selection)}
                      onChange={(keep) =>
                        onSelectionChange((current) => ({ ...current, subtitleOverrides: { ...current.subtitleOverrides, [section.id]: keep } }))
                      }
                    >
                      Subtitle <span className="sr-only">— {section.subtitle}</span>
                    </Checkbox>
                  </div>
                )}
                <Select
                  label={`${name} content type`}
                  className="flex-none"
                  data-section-select={section.id}
                  value={effectiveKind(section, selection)}
                  options={SECTION_KIND_OPTIONS}
                  onChange={(value) => reclassify(section, value as ManuscriptContentKind)}
                />
              </div>
            );
          })}
        </div>
      </Disclosure>
    );
  const subtitleChoices = hasSubtitleChoices(preview);
  return (
    <div ref={root}>
      {(preview.format === 'markdown' || buildStoryBible || subtitleChoices) && (
        <fieldset className="mt-4 min-w-0 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <legend className={LEGEND_CLASSES}>Import options</legend>
          <div className="space-y-2">
            {preview.format === 'markdown' && (
              <label className="flex items-center gap-2 text-sm">
                Markdown chapter heading level
                <Select
                  label="Markdown chapter heading level"
                  value={String(headingLevel)}
                  options={[1, 2, 3, 4, 5, 6].map((level) => ({ value: String(level), label: `H${level}` }))}
                  onChange={(value) => onHeadingLevelChange(Number(value))}
                />
              </label>
            )}
            {subtitleChoices && (
              // The default every row starts from; a row set by hand keeps its own answer (owner decision I2: a book's house style here,
              // the exceptions on the rows).
              <Checkbox
                checked={selection.subtitleDefault ?? true}
                onChange={(next) => onSelectionChange((current) => ({ ...current, subtitleDefault: next }))}
              >
                Read a heading's second line as its subtitle
              </Checkbox>
            )}
            {buildStoryBible && (
              <Checkbox checked={buildStoryBible.checked} onChange={buildStoryBible.onChange}>
                Build the Story Bible after import
              </Checkbox>
            )}
          </div>
        </fieldset>
      )}
      {preview.format === 'pdf' && preview.chapterTitles.length > 0 && <p className="mt-3 text-xs">Detected chapters: {preview.chapterTitles.join(' · ')}</p>}
      {(sections.length > 0 || candidates.length > 0 || notices.length > 0) && (
        <fieldset className="mt-4 min-w-0">
          <legend className={LEGEND_CLASSES}>Review what was found</legend>
          {sectionGroup('narration', 'Narration chapters', `${counts.narration} ${plural(counts.narration, 'chapter')}`)}
          {sectionGroup('opening', 'Front matter', `${counts.opening} ${plural(counts.opening, 'section')}`, {
            label: 'About front matter',
            text: FRONT_MATTER_NOTE,
          })}
          {sectionGroup('reference', 'Reference material', `${counts.reference} ${plural(counts.reference, 'section')}`, {
            label: 'About reference material',
            text: REFERENCE_NOTE,
          })}
          {candidates.length > 0 && (
            <Disclosure
              title="Story Bible character suggestions"
              summary={`${counts.suggestionsChecked} of ${counts.suggestionsTotal} checked`}
              open={open('characters')}
              onOpenChange={(next) => onGroupOpenChange('characters', next)}
              className="border-t border-[var(--border)]"
            >
              <div className="pt-1 pb-3 pl-5">
                <p className="mb-2 text-xs text-[var(--text-muted)]">Checked names become reviewable Character entries after import.</p>
                <div className="mb-2 flex gap-2">
                  <Button
                    variant="ghost"
                    className="text-xs"
                    onClick={() => onSelectionChange((current) => ({ ...current, characterCandidateIds: candidates.map((item) => item.id) }))}
                  >
                    Select all
                  </Button>
                  <Button variant="ghost" className="text-xs" onClick={() => onSelectionChange((current) => ({ ...current, characterCandidateIds: [] }))}>
                    Select none
                  </Button>
                </div>
                {candidates.map((candidate) => (
                  <Checkbox
                    key={candidate.id}
                    checked={checkedIds.includes(candidate.id)}
                    onChange={(next) => {
                      const selected = new Set(checkedIds);
                      if (next) selected.add(candidate.id);
                      else selected.delete(candidate.id);
                      onSelectionChange((current) => ({ ...current, characterCandidateIds: [...selected] }));
                    }}
                  >
                    {candidate.name}
                    {candidate.description && <span className="text-[var(--text-muted)]"> — {candidate.description}</span>}
                  </Checkbox>
                ))}
              </div>
            </Disclosure>
          )}
          {notices.length > 0 && (
            <Disclosure
              title="Repairs"
              summary={`${notices.length} made to the source`}
              open={open('repairs')}
              onOpenChange={(next) => onGroupOpenChange('repairs', next)}
              className="border-t border-[var(--border)]"
            >
              <ul className="list-disc space-y-1 pt-1 pb-3 pl-9 text-xs break-words text-[var(--text-muted)]">
                {notices.map((notice, index) => (
                  <li key={`${index}-${notice}`}>{notice}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </fieldset>
      )}
    </div>
  );
}
