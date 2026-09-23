import type { ManuscriptImportPreview, ManuscriptImportSection } from './contracts/manuscript';

/**
 * Which manuscript the mock host says the narrator picked: a Word file, a Markdown one (which has the heading-level choice), a Word
 * file whose headings had a title and subtitle run together, which the importer split and reports as a repair, or a plain-text file
 * whose first chapter has an epigraph on the line under its heading, which the importer read as the subtitle (a line that returns to
 * the text when the narrator turns the subtitle off, story-bible-and-import-ux-briefs PRD, Phase 5).
 */
export type MockImportKind = 'docx' | 'markdown' | 'repaired' | 'text';

// The epigraph the plain-text book has under "Chapter One", which the importer takes for the subtitle.
const TEXT_EPIGRAPH = '“Curiouser and curiouser!” cried Alice';

const REPAIR_NOTICES = [
  'Heading "CHAPTER ONEDown the Rabbit-Hole" had no gap between its number and title; split into "CHAPTER ONE" and "Down the Rabbit-Hole".',
  'Heading "CHAPTER TWOThe Pool of Tears" had no gap between its number and title; split into "CHAPTER TWO" and "The Pool of Tears".',
];

// The sections of every kind the importer proposes for a book with front matter, chapters, a character list and a glossary. They
// are in the order the host sends them: the titles the parser read come first, in document order, and "Front Matter" (the
// paragraphs before the first heading) is added after them, so it is last (apps/desktop/internal/importer/model.go, newDraft).
const SECTIONS: readonly ManuscriptImportSection[] = [
  { id: 'section-0001', title: 'Chapter One', subtitle: 'Down the Rabbit-Hole', subtitleOff: 'title', contentKind: 'narration', paragraphCount: 42 },
  { id: 'section-0002', title: 'Chapter Two', subtitle: 'The Pool of Tears', subtitleOff: 'title', contentKind: 'narration', paragraphCount: 38 },
  { id: 'section-0003', title: 'Chapter Three', contentKind: 'narration', paragraphCount: 35 },
  {
    id: 'section-0004',
    title: 'Chapter Four',
    subtitle: 'In Which Alice Considers a Great Many Things About Cats, Dinah, Bats and the Improbable Business of Falling',
    subtitleOff: 'title',
    contentKind: 'narration',
    paragraphCount: 40,
  },
  { id: 'section-0005', title: 'Chapter Five', contentKind: 'narration', paragraphCount: 45 },
  { id: 'section-0006', title: 'Glossary', contentKind: 'reference', paragraphCount: 12 },
  { id: 'section-0007', title: 'Characters', contentKind: 'reference', paragraphCount: 6 },
  { id: 'section-0008', title: 'Front Matter', contentKind: 'opening', paragraphCount: 3 },
];

const FORMATS = { docx: 'docx', markdown: 'markdown', repaired: 'docx', text: 'txt' } as const;
const EXTENSIONS = { docx: 'docx', markdown: 'md', repaired: 'docx', text: 'txt' } as const;

// In a plain-text file a subtitle is the line under the heading, so turned off it returns to the text; Chapter One's is an epigraph.
function asPlainText(section: ManuscriptImportSection): ManuscriptImportSection {
  if (!section.subtitle) return { ...section };
  return { ...section, subtitle: section.id === 'section-0001' ? TEXT_EPIGRAPH : section.subtitle, subtitleOff: 'body' };
}

/**
 * What the mock host answers for an import preview. It is a book the importer has plenty to say about (every kind of section and three
 * character suggestions), so the review dialog is seen the way a narrator meets it. `chapterTitles` holds every heading the parser read,
 * the character list and the glossary included, exactly as the host sends it before the sections are classified.
 */
export function mockImportPreview(kind: MockImportKind = 'docx'): ManuscriptImportPreview {
  const sections = kind === 'text' ? SECTIONS.map(asPlainText) : SECTIONS.map((section) => ({ ...section }));
  return {
    format: FORMATS[kind],
    sourceName: `Alice.${EXTENSIONS[kind]}`,
    paragraphCount: sections.reduce((total, section) => total + section.paragraphCount, 0),
    chapterTitles: sections.filter((section) => section.contentKind !== 'opening').map((section) => section.title),
    sections,
    characterCandidates: [
      {
        id: 'candidate-section-0007-001',
        name: 'Alice',
        description: 'A curious girl who follows a White Rabbit',
        sourceSectionId: 'section-0007',
        properties: [
          { key: 'Species', value: 'Human' },
          { key: 'Age', value: 'Seven' },
        ],
      },
      {
        id: 'candidate-section-0007-002',
        name: 'The White Rabbit',
        description: 'Always late, and always looking at his watch',
        sourceSectionId: 'section-0007',
      },
      { id: 'candidate-section-0007-003', name: 'The Duchess', description: '', sourceSectionId: 'section-0007' },
    ],
    ...(kind === 'repaired' ? { notices: [...REPAIR_NOTICES] } : {}),
  };
}

/** The staged import log the host writes for a preview (apps/desktop/internal/importer), worded as its Word, Markdown and text readers word it. */
export function mockImportPreviewLog(preview: ManuscriptImportPreview, headingLevel: number): string[] {
  const sections = preview.sections ?? [];
  const chapters = preview.chapterTitles.length;
  const suggestions = preview.characterCandidates?.length ?? 0;
  const read =
    preview.format === 'markdown'
      ? [
          `Reading Markdown file ${preview.sourceName}`,
          `Parsing 48 KB using H${headingLevel} as the chapter heading level`,
          `Read ${preview.paragraphCount} paragraphs under ${chapters} chapter headings`,
        ]
      : preview.format === 'txt'
        ? [`Reading text file ${preview.sourceName}`, 'Parsing 48 KB']
        : [
            `Opening Word document ${preview.sourceName}`,
            'Reading document structure (52 KB of text)',
            `Read ${preview.paragraphCount + chapters} paragraphs, ${chapters} of them headings`,
          ];
  return [
    ...read,
    ...(preview.notices ?? []),
    'Classifying front matter, chapters and reference sections',
    `Found ${chapters} chapters in ${sections.length} sections`,
    `Preview ready: ${preview.paragraphCount} paragraphs, ${chapters} chapters, ${suggestions} character suggestions`,
  ];
}
