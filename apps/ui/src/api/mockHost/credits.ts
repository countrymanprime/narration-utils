// The mock host (mockApi.ts): audiobook credits.
import type {
  CreditTemplate,
  CreditValues,
  CreditsAnnouncement,
  CreditsRenderResult,
  CreditsSetupField,
  CreditsSetupState,
  CreditsStatuses,
  DetectedCandidate,
  ManuscriptParagraph,
  NarrationApi,
  RetailSampleAnswer,
} from '../../types';
import { wireClone } from '../mockFixtures';
import { type MockApiSeed, mockDocumentId, type MockState } from './state';
import type { MockSettings } from './settings';

// A JS mirror of apps/desktop/internal/credits.Render: `[Token]` placeholders resolved from `values`, and `{...}`
// optional segments dropped whole (their own punctuation with them) when any token inside is unresolved (PRD
// audiobook-credits-templates.prd.md, Open Questions C5/C6). Kept deliberately close to the Go renderer so the mock's
// preview behaves like the real one; it does not need to be the same implementation, only the same behavior.
function renderMockCredits(template: string, values: Record<string, string>): CreditsRenderResult {
  const unresolved: string[] = [];
  const noteUnresolved = (name: string) => {
    if (!unresolved.includes(name)) unresolved.push(name);
  };
  const renderTokens = (fragment: string, onUnresolved?: (name: string) => void) =>
    fragment.replace(/\[([^[\]{}]+)]/g, (match, name: string) => {
      const value = values[name];
      if (value) return value;
      onUnresolved?.(name);
      return match;
    });
  let text = '';
  let remaining = template;
  for (;;) {
    const open = remaining.indexOf('{');
    if (open === -1) {
      text += renderTokens(remaining, noteUnresolved);
      break;
    }
    const closeIndex = remaining.indexOf('}', open);
    if (closeIndex === -1) {
      text += renderTokens(remaining, noteUnresolved);
      break;
    }
    text += renderTokens(remaining.slice(0, open), noteUnresolved);
    const segment = remaining.slice(open + 1, closeIndex);
    let complete = true;
    const resolvedSegment = renderTokens(segment, () => {
      complete = false;
    });
    if (complete) text += resolvedSegment;
    remaining = remaining.slice(closeIndex + 1);
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  return { text, words, unresolved };
}

// The host's credits.setupTokenFields: each render token a narrator can set, and the CreditValues key it fills.
const SETUP_TOKEN_FIELDS: Record<string, keyof CreditValues> = {
  Title: 'title',
  Subtitle: 'subtitle',
  Author: 'author',
  Series: 'series',
  'Book Number': 'bookNumber',
  Copyright: 'copyright',
  Year: 'year',
  'Copyright Holder': 'copyrightHolder',
  Publisher: 'publisher',
  Narrator: 'narrator',
};
const SETUP_FIELDS: ReadonlyArray<keyof CreditValues> = Object.values(SETUP_TOKEN_FIELDS);
const isSetupField = (key: string): key is keyof CreditValues => SETUP_FIELDS.some((field) => field === key);

/** A detected candidate's token ("CopyrightHolder") as the CreditValues key it fills ("copyrightHolder"), if it is one. */
const setupFieldOf = (token: string): keyof CreditValues | undefined => {
  const key = token.charAt(0).toLowerCase() + token.slice(1);
  return isSetupField(key) ? key : undefined;
};

function resolveMockCreditValues(values: CreditValues, narratorGlobal: string): Record<string, string> {
  return {
    Title: values.title ?? '',
    Subtitle: values.subtitle ?? '',
    Author: values.author ?? '',
    Series: values.series ?? '',
    'Book Number': values.bookNumber ?? '',
    Copyright: values.copyright ?? '',
    Year: values.year ?? '',
    'Copyright Holder': values.copyrightHolder ?? '',
    Publisher: values.publisher ?? '',
    Narrator: values.narrator || narratorGlobal,
  };
}

// A JS mirror of apps/desktop/internal/credits.MeasureSample (Phase 5, ADR 0152): the range start..end of the paragraphs in
// book order, its lines within each chapter, and its length at 9,300 words per finished hour, refused over 5 minutes.
const MOCK_WORDS_PER_FINISHED_HOUR = 9300;
const MOCK_MAX_RETAIL_SAMPLE_SECONDS = 300;
function measureMockRetailSample(paragraphs: ManuscriptParagraph[], startId: string, endId: string): RetailSampleAnswer['sample'] {
  const perChapter = new Map<string, number>();
  const lines = paragraphs.map((paragraph) => {
    const line = (perChapter.get(paragraph.chapterId) ?? 0) + 1;
    perChapter.set(paragraph.chapterId, line);
    return line;
  });
  const start = paragraphs.findIndex((paragraph) => paragraph.id === startId);
  const end = paragraphs.findIndex((paragraph) => paragraph.id === endId);
  if (start === -1 || end === -1) throw new Error("the retail sample's lines are not in this manuscript; pick the range again");
  if (end < start) throw new Error('the retail sample ends before it starts');
  const words = paragraphs.slice(start, end + 1).reduce((total, paragraph) => total + paragraph.text.split(/\s+/).filter(Boolean).length, 0);
  const seconds = (words * 3600) / MOCK_WORDS_PER_FINISHED_HOUR;
  if (words * 3600 > MOCK_MAX_RETAIL_SAMPLE_SECONDS * MOCK_WORDS_PER_FINISHED_HOUR) {
    const whole = Math.round(seconds);
    const about =
      whole >= 3600
        ? `${Math.floor(whole / 3600)}h ${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}m`
        : `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
    throw new Error(`a retail sample can be at most 5 minutes; this range is ${words} words, about ${about}`);
  }
  return {
    startParagraphId: startId,
    endParagraphId: endId,
    startChapterId: paragraphs[start].chapterId,
    startLine: lines[start],
    endChapterId: paragraphs[end].chapterId,
    endLine: lines[end],
    words,
    seconds,
  };
}

/** The credits bindings: the template library, the project's values, the setup prompt and the retail sample. */
export function createCreditsMock(
  s: MockState,
  initial: MockApiSeed,
  { settings, manuscriptReady }: { settings: MockSettings; manuscriptReady: Promise<void> },
) {
  // Mirrors apps/desktop/internal/credits' shipped defaults (PRD audiobook-credits-templates.prd.md, Phase 1) so a
  // mock session shows the same starting library as the real host.
  let creditTemplates: CreditTemplate[] = [
    {
      id: 'default-opening-acx-minimum',
      kind: 'opening',
      name: 'ACX minimum (opening)',
      body: '[Title], written by [Author], narrated by [Narrator].',
      builtIn: true,
    },
    {
      id: 'default-closing-acx-best-practice',
      kind: 'closing',
      name: 'ACX best practice (closing)',
      body: 'You have been listening to [Title], written by [Author], narrated by [Narrator]. The End.',
      builtIn: true,
    },
    {
      id: 'default-with-copyright',
      kind: 'closing',
      name: 'With copyright (contractual)',
      body: '[Title]. Written by [Author]. Read by [Narrator]. Copyright by [Copyright].',
      builtIn: true,
    },
  ];
  if (initial.creditsMissingClosing) creditTemplates = creditTemplates.filter((template) => template.kind !== 'closing');
  if (initial.chapterAnnouncement !== undefined)
    creditTemplates.push({ id: 'mock-chapter-announcement', kind: 'chapter_announcement', name: 'Chapter announcement', body: initial.chapterAnnouncement });
  let nextCreditTemplateId = 1;
  let creditValues: CreditValues = wireClone(initial.creditValues ?? {});
  let creditsStatuses: CreditsStatuses = {};
  let retailSample: { startParagraphId: string; endParagraphId: string } | undefined;
  let seededSample = initial.retailSample;
  const readRetailSample = (): RetailSampleAnswer => {
    if (seededSample) {
      const ids = 'chapterIndex' in seededSample ? (s.chapters[seededSample.chapterIndex]?.paragraphIds ?? []) : [];
      retailSample =
        'chapterIndex' in seededSample
          ? { startParagraphId: ids[seededSample.startLine - 1]?.id ?? '', endParagraphId: ids[seededSample.endLine - 1]?.id ?? '' }
          : { ...seededSample };
      seededSample = undefined;
    }
    if (!retailSample) return { sample: null, problem: '' };
    try {
      return { sample: measureMockRetailSample(s.paragraphs, retailSample.startParagraphId, retailSample.endParagraphId), problem: '' };
    } catch (error) {
      return { sample: null, problem: error instanceof Error ? error.message : String(error) };
    }
  };
  const mockNarratorGlobal = () => settings.global.General.find((field) => field.key === 'narrator_name')?.effectiveValue ?? '';
  const mockDetectedCandidates = (): DetectedCandidate[] =>
    initial.creditsDetected || initial.creditsSetup
      ? [
          {
            token: 'Title',
            value: 'Alice’s Adventures in Wonderland',
            source: 'the title page',
            confidence: 'high',
            lines: ['ALICE’S ADVENTURES', 'IN WONDERLAND'],
          },
          { token: 'Author', value: 'Lewis Carroll', source: 'the byline and the copyright line', confidence: 'high', lines: ['Lewis Carroll'] },
          { token: 'Year', value: '1865', source: 'the copyright line', confidence: 'high' },
          { token: 'CopyrightHolder', value: 'Lewis Carroll', source: 'the copyright line', confidence: 'high' },
          { token: 'Publisher', value: 'Macmillan', source: 'a line ending in "Publishers"', confidence: 'low' },
        ]
      : [
          { token: 'Title', value: 'Alice’s Adventures in Wonderland', source: 'the title page', confidence: 'high' },
          { token: 'Author', value: 'Lewis Carroll', source: 'the byline', confidence: 'high' },
        ];
  // The credits setup prompt's dismissal (the host keeps "Not now" in memory and "Don't ask" on the manifest).
  let creditsSetupDismissed: CreditsSetupState['dismissed'] = initial.creditsSetup ? '' : 'project';
  // The host's credits.SetupFields over the mock's library, values and detected candidates (apps/desktop/creditsetup.go).
  const mockCreditsSetupState = (): CreditsSetupState => {
    const detected = mockDetectedCandidates().filter((candidate) => {
      const field = setupFieldOf(candidate.token);
      return field !== undefined && !creditValues[field];
    });
    const tokens = resolveMockCreditValues(creditValues, mockNarratorGlobal());
    const fields: CreditsSetupField[] = [];
    for (const kind of ['opening', 'closing'] as const) {
      const template = creditTemplates.find((item) => item.kind === kind);
      for (const token of template ? renderMockCredits(template.body, tokens).unresolved : []) {
        const field = SETUP_TOKEN_FIELDS[token];
        if (!field || fields.some((known) => known.token === token)) continue;
        fields.push({ token, field, candidate: detected.find((candidate) => setupFieldOf(candidate.token) === field) ?? null });
      }
    }
    const unresolved = fields.length > 0;
    return {
      needed: unresolved && creditsSetupDismissed === '',
      banner: unresolved && creditsSetupDismissed !== 'project',
      dismissed: creditsSetupDismissed,
      dismissedAt: creditsSetupDismissed === 'project' ? '2026-09-25T12:00:00Z' : null,
      documentId: mockDocumentId,
      narratorGlobal: mockNarratorGlobal(),
      fields,
      candidates: detected,
    };
  };
  // The credits text a teleprompter session reads (Phase 4, ADR 0150): the first template of the kind (ADR 0093), rendered
  // as `creditsPreview` renders it, as the host's creditsScript does.
  const mockCreditsText = (kind: 'opening' | 'closing') => {
    const template = creditTemplates.find((item) => item.kind === kind);
    return template ? renderMockCredits(template.body, resolveMockCreditValues(creditValues, mockNarratorGlobal())).text : undefined;
  };
  const bindings = {
    creditsTemplates: async () => wireClone(creditTemplates),
    saveCreditsTemplate: async (id, kind, name, body) => {
      if (id) {
        const index = creditTemplates.findIndex((template) => template.id === id);
        const updated: CreditTemplate = { id, kind, name, body, builtIn: index >= 0 ? creditTemplates[index].builtIn : false };
        if (index >= 0) creditTemplates[index] = updated;
        else creditTemplates.push(updated);
        return wireClone(updated);
      }
      const created: CreditTemplate = { id: `mock-credit-template-${nextCreditTemplateId++}`, kind, name, body, builtIn: false };
      creditTemplates.push(created);
      return wireClone(created);
    },
    duplicateCreditsTemplate: async (id) => {
      const original = creditTemplates.find((template) => template.id === id);
      if (!original) throw new Error(`No credit template with id "${id}"`);
      const duplicate: CreditTemplate = {
        id: `mock-credit-template-${nextCreditTemplateId++}`,
        kind: original.kind,
        name: `${original.name} copy`,
        body: original.body,
        builtIn: false,
      };
      creditTemplates.push(duplicate);
      return wireClone(duplicate);
    },
    deleteCreditsTemplate: async (id) => {
      creditTemplates = creditTemplates.filter((template) => template.id !== id);
    },
    creditsProjectValues: async () => ({
      values: wireClone(creditValues),
      narratorGlobal: settings.global.General.find((field) => field.key === 'narrator_name')?.effectiveValue ?? '',
      suggestions: { Title: 'Alice’s Adventures in Wonderland', Author: 'Lewis Carroll' },
      detected: mockDetectedCandidates(),
    }),
    creditsSetupState: async () => wireClone(mockCreditsSetupState()),
    creditsSetupDismiss: async (scope) => {
      if (scope !== 'session' && scope !== 'project') throw new Error(`unknown dismissal scope "${String(scope)}": use session or project`);
      creditsSetupDismissed = scope;
      return wireClone(mockCreditsSetupState());
    },
    // The host fills only empty values and never replaces a set one (CreditsSetupSave).
    creditsSetupSave: async (values) => {
      const next: CreditValues = { ...creditValues };
      for (const [field, value] of Object.entries(values)) {
        if (!isSetupField(field)) throw new Error(`unknown credits field "${field}"`);
        if (typeof value === 'string' && value.trim() !== '' && !next[field]) next[field] = value.trim();
      }
      creditValues = next;
      return wireClone(mockCreditsSetupState());
    },
    saveCreditsProjectValues: async (values) => {
      creditValues = wireClone(values);
      return wireClone(creditValues);
    },
    creditsPreview: async (body) => renderMockCredits(body, resolveMockCreditValues(creditValues, mockNarratorGlobal())),
    creditsChapterAnnouncements: async (body) => {
      await manuscriptReady;
      const tokens = resolveMockCreditValues(creditValues, mockNarratorGlobal());
      return s.chapters
        .filter((chapter) => (chapter.contentKind ?? 'narration') === 'narration')
        .map((chapter): CreditsAnnouncement => ({
          chapterId: chapter.id,
          chapter: chapter.title,
          result: renderMockCredits(body, { ...tokens, Chapter: chapter.title, 'Chapter Title': chapter.subtitle ?? '' }),
        }));
    },
    creditsRetailSample: async () => {
      await manuscriptReady;
      return readRetailSample();
    },
    saveCreditsRetailSample: async (startParagraphId, endParagraphId) => {
      await manuscriptReady;
      readRetailSample();
      if (!startParagraphId && !endParagraphId) {
        retailSample = undefined;
        return { sample: null, problem: '' };
      }
      const sample = measureMockRetailSample(s.paragraphs, startParagraphId, endParagraphId);
      retailSample = { startParagraphId, endParagraphId };
      return { sample, problem: '' };
    },
    creditsStatuses: async () => wireClone(creditsStatuses),
    setCreditsStatus: async (kind, status) => {
      creditsStatuses = { ...creditsStatuses, [kind]: status };
      return wireClone(creditsStatuses);
    },
  } satisfies Partial<NarrationApi>;
  return { bindings, mockCreditsText };
}
