import type { ManuscriptImportPreview, ManuscriptImportSection } from './contracts/manuscript';

/** Which manuscript the mock host says the narrator picked: a Word file, or a Markdown one (which has the heading-level choice). */
export type MockImportKind = 'docx' | 'markdown';

// The sections of every kind the importer proposes for a book with front matter, chapters, a character list and a glossary. They
// are in the order the host sends them: the titles the parser read come first, in document order, and "Front Matter" (the
// paragraphs before the first heading) is added after them, so it is last (apps/desktop/internal/importer/model.go, newDraft).
const SECTIONS: readonly ManuscriptImportSection[] = [
  { id: 'section-0001', title: 'Chapter One', subtitle: 'Down the Rabbit-Hole', contentKind: 'narration', paragraphCount: 42 },
  { id: 'section-0002', title: 'Chapter Two', subtitle: 'The Pool of Tears', contentKind: 'narration', paragraphCount: 38 },
  { id: 'section-0003', title: 'Chapter Three', contentKind: 'narration', paragraphCount: 35 },
  {
    id: 'section-0004',
    title: 'Chapter Four',
    subtitle: 'In Which Alice Considers a Great Many Things About Cats, Dinah, Bats and the Improbable Business of Falling',
    contentKind: 'narration',
    paragraphCount: 40,
  },
  { id: 'section-0005', title: 'Chapter Five', contentKind: 'narration', paragraphCount: 45 },
  { id: 'section-0006', title: 'Glossary', contentKind: 'reference', paragraphCount: 12 },
  { id: 'section-0007', title: 'Characters', contentKind: 'reference', paragraphCount: 6 },
  { id: 'section-0008', title: 'Front Matter', contentKind: 'opening', paragraphCount: 3 },
];

/**
 * What the mock host answers for an import preview. It is a book the importer has plenty to say about (every kind of section and three
 * character suggestions), so the review dialog is seen the way a narrator meets it. `chapterTitles` holds every heading the parser read,
 * the character list and the glossary included, exactly as the host sends it before the sections are classified.
 */
export function mockImportPreview(kind: MockImportKind = 'docx'): ManuscriptImportPreview {
  const sections = SECTIONS.map((section) => ({ ...section }));
  return {
    format: kind,
    sourceName: kind === 'markdown' ? 'Alice.md' : 'Alice.docx',
    paragraphCount: sections.reduce((total, section) => total + section.paragraphCount, 0),
    chapterTitles: sections.filter((section) => section.contentKind !== 'opening').map((section) => section.title),
    sections,
    characterCandidates: [
      { id: 'candidate-section-0007-001', name: 'Alice', description: 'A curious girl who follows a White Rabbit', sourceSectionId: 'section-0007' },
      {
        id: 'candidate-section-0007-002',
        name: 'The White Rabbit',
        description: 'Always late, and always looking at his watch',
        sourceSectionId: 'section-0007',
      },
      { id: 'candidate-section-0007-003', name: 'The Duchess', description: '', sourceSectionId: 'section-0007' },
    ],
  };
}

/** The staged import log the host writes for a preview (apps/desktop/internal/importer), worded as its Word and Markdown readers word it. */
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
      : [
          `Opening Word document ${preview.sourceName}`,
          'Reading document structure (52 KB of text)',
          `Read ${preview.paragraphCount + chapters} paragraphs, ${chapters} of them headings`,
        ];
  return [
    ...read,
    'Classifying front matter, chapters and reference sections',
    `Found ${chapters} chapters in ${sections.length} sections`,
    `Preview ready: ${preview.paragraphCount} paragraphs, ${chapters} chapters, ${suggestions} character suggestions`,
  ];
}
