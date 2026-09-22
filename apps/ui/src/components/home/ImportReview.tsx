import type { ManuscriptContentKind, ManuscriptImportPreview, ManuscriptImportSection, ManuscriptImportSelection, WorkJob } from '../../types';
import { Checkbox } from '../primitives/Checkbox';
import { Select } from '../primitives/Select';

const SECTION_KIND_OPTIONS = [
  { value: 'narration', label: 'Narration chapter' },
  { value: 'opening', label: 'Front Matter' },
  { value: 'reference', label: 'Reference material' },
];

const LABEL_CLASSES = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";
const LEGEND_CLASSES = `px-1 ${LABEL_CLASSES}`;

// The title and, when the heading had one, the subtitle, the way the reader writes them ("Chapter One — Down the Rabbit-Hole").
function sectionName(section: ManuscriptImportSection): string {
  return section.subtitle ? `${section.title} — ${section.subtitle}` : section.title;
}

type ImportReviewProps = {
  preview: ManuscriptImportPreview;
  // The preview job's progress and log, which the review shows as "Preview activity".
  job: Pick<WorkJob, 'percent' | 'logs'>;
  selection: ManuscriptImportSelection;
  onSelectionChange: (update: (current: ManuscriptImportSelection) => ManuscriptImportSelection) => void;
  headingLevel: number;
  // Markdown only: the narrator chose another chapter heading level, so the host reads the file again.
  onHeadingLevelChange: (level: number) => void;
};

// The body of the "Import <file>" review dialog: what the importer found, and the choices the narrator can change before it commits.
// The choices are held by the caller (Home), which also sends them with the commit; this only shows them and reports a change.
export function ImportReview({ preview, job, selection, onSelectionChange, headingLevel, onHeadingLevelChange }: ImportReviewProps) {
  const candidates = preview.characterCandidates ?? [];
  const sections = preview.sections ?? [];
  // No explicit list yet means every suggestion is checked, and a change writes the whole list out.
  const checkedIds = selection.characterCandidateIds ?? candidates.map((item) => item.id);
  return (
    <>
      {preview.format === 'markdown' && (
        <label className="mt-4 flex items-center gap-2 text-sm">
          Markdown chapter heading level
          <Select
            label="Markdown chapter heading level"
            value={String(headingLevel)}
            options={[1, 2, 3, 4, 5, 6].map((level) => ({ value: String(level), label: `H${level}` }))}
            onChange={(value) => onHeadingLevelChange(Number(value))}
          />
        </label>
      )}
      {preview.format === 'pdf' && preview.chapterTitles.length > 0 && <p className="mt-3 text-xs">Detected chapters: {preview.chapterTitles.join(' · ')}</p>}
      {sections.length > 0 && (
        <fieldset className="mt-4 min-w-0 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <legend className={LEGEND_CLASSES}>Review imported structure</legend>
          <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Reference material stays readable but is excluded from audiobook totals and Proofing.
          </p>
          <div className="space-y-1.5">
            {sections.map((section) => (
              <label key={section.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate" title={sectionName(section)}>
                  {section.title}
                  {section.subtitle && <span style={{ color: 'var(--text-muted)' }}> — {section.subtitle}</span>}
                </span>
                <Select
                  label={`${sectionName(section)} content type`}
                  className="flex-none"
                  value={selection.sectionKinds?.[section.id] ?? section.contentKind}
                  options={SECTION_KIND_OPTIONS}
                  onChange={(value) =>
                    onSelectionChange((current) => ({ ...current, sectionKinds: { ...current.sectionKinds, [section.id]: value as ManuscriptContentKind } }))
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {candidates.length > 0 && (
        <fieldset className="mt-4 min-w-0 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <legend className={LEGEND_CLASSES}>Story Bible character suggestions</legend>
          <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Checked names become reviewable Character entries after import.
          </p>
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
              {candidate.description && <span style={{ color: 'var(--text-muted)' }}> — {candidate.description}</span>}
            </Checkbox>
          ))}
        </fieldset>
      )}
      <div className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        <div className={`mb-1.5 ${LABEL_CLASSES}`}>Preview activity</div>
        <div className="progressbar h-4 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div className="h-full bg-[var(--accent)] transition-[width] duration-[0.4s] ease-in-out" style={{ width: `${job.percent}%` }} />
        </div>
        {/* A log longer than the box scrolls, so the keyboard must reach it (the same as the log of the running import). */}
        <div
          tabIndex={0}
          className="mt-2 h-36 overflow-y-auto border border-[var(--border)] bg-[var(--surface-2)] font-['IBM_Plex_Mono',ui-monospace,monospace] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
        >
          {job.logs.map((line, index) => (
            <div key={`${index}-${line}`} className="border-b border-[var(--border)] px-[0.45rem] py-1">
              {line}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
