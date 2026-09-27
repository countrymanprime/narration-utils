import type { GuideEntity, ManuscriptParagraph } from '../../types';

// The shape Character Continuity Review's own dialogue-cue extractor writes
// (sidecars/manuscript-guide/core/manuscript_guide.py, `extract_dialogue_cues`/`merge_dialogue_cues`,
// character-continuity-review.prd.md Phase 2): one entry per quoted span. That extractor is not yet exposed
// through any binding (that PRD's own Phase 6 - see PR #770's description), so the reader below builds
// against a recorded fixture of this same shape instead of a second extractor (prep-depth.prd.md Phase 4,
// Q1 option C, "What We're NOT Building"). Swapping to the real output later is only a change to where the
// `DialogueCue[]` comes from, never to `speakerLabelForParagraph` or the components that call it.
export type DialogueCueSpeakerSource = 'tag' | 'continuation' | 'unknown' | 'correction';

export type DialogueCue = {
  id: string;
  chapterId: string;
  paragraphId: string;
  quote_start: number;
  quote_end: number;
  quote_text: string;
  speaker_entity_id: string | null;
  speaker_source: DialogueCueSpeakerSource;
  evidence: { chapterId: string; paragraphId: string; excerpt: string; tag: string };
  corrected: boolean;
};

/** The speaker chip's label for one paragraph: the first cue on it whose speaker resolves to a known entity,
 * or `undefined` for no cue, an `unknown` cue, or one naming an entity id this reader does not have - never a
 * placeholder name (prep-depth.prd.md Success Metrics, "unknown renders as unattributed, never a fabricated
 * name"). */
export function speakerLabelForParagraph(
  paragraph: Pick<ManuscriptParagraph, 'id'>,
  cues: DialogueCue[],
  entitiesById: Map<string, GuideEntity>,
): string | undefined {
  const cue = cues.find((item) => item.paragraphId === paragraph.id && item.speaker_entity_id);
  if (!cue?.speaker_entity_id) return undefined;
  return entitiesById.get(cue.speaker_entity_id)?.canonical_name;
}

// A recorded fixture (prep-depth.prd.md Phase 4, Q1 option C), not a second extractor: it has no tag-parsing
// or continuation logic of its own, only a fixed table of exact quotes from the built-in Alice in Wonderland
// demo text (apps/ui/src/api/fixtures/alice-in-wonderland.txt, Chapter 3, "A Caucus-Race and a Long Tale"),
// matched by substring against whichever paragraphs are currently loaded, naming only an entity the demo data
// already carries (`alice` - apps/ui/src/api/mockFixtures.ts WIRE_ENTITIES). Chapter 3 is picked deliberately:
// its other speakers (the Mouse, the Dodo, the Lory, the Duck) are not Story Bible entities at all, and unlike
// most of the rest of the book it never mentions a registered entity whose own alias is a substring of another
// registered entity's canonical name (White Rabbit/Rabbit, Queen of Hearts/Queen, Cheshire Cat/Cat,
// Caterpillar/Cat), so it does not also reproduce the reader's own pre-existing overlapping-highlight bug
// (#155, tests/visual/axe-debt.ts) the way nearly every other chapter does. A narrator's own manuscript never
// contains this exact wording, so this recorded set attaches to nothing outside the demo.
const RECORDED_DEMO_CUES: { quoteSnippet: string; speakerEntityId: string | null; speakerSource: DialogueCueSpeakerSource }[] = [
  // "'Mine is a long and a sad tale!' said the Mouse, turning to Alice, and sighing." - the Mouse is not a
  // Story Bible Character entity, so this stays unattributed.
  { quoteSnippet: 'Mine is a long and a sad tale', speakerEntityId: null, speakerSource: 'unknown' },
  // "'I beg your pardon,' said Alice very humbly: 'you had got to the fifth bend, I think?'" - a direct tag.
  { quoteSnippet: 'you had got to the fifth bend', speakerEntityId: 'alice', speakerSource: 'tag' },
  // "'You promised to tell me your history, you know,' said Alice, 'and why it is you hate--C and D,' she
  // added in a whisper..." - the second quote continues Alice's own speech with only a pronoun, no name tag.
  { quoteSnippet: 'why it is you hate', speakerEntityId: 'alice', speakerSource: 'continuation' },
];

export function recordedDemoDialogueCues(paragraphs: Pick<ManuscriptParagraph, 'id' | 'chapterId' | 'text'>[]): DialogueCue[] {
  return RECORDED_DEMO_CUES.flatMap((row) => {
    const paragraph = paragraphs.find((item) => item.text.includes(row.quoteSnippet));
    if (!paragraph) return [];
    const quote_start = paragraph.text.indexOf(row.quoteSnippet);
    const quote_end = quote_start + row.quoteSnippet.length;
    const cue: DialogueCue = {
      id: `demo-cue-${paragraph.id}`,
      chapterId: paragraph.chapterId,
      paragraphId: paragraph.id,
      quote_start,
      quote_end,
      quote_text: row.quoteSnippet,
      speaker_entity_id: row.speakerEntityId,
      speaker_source: row.speakerSource,
      evidence: { chapterId: paragraph.chapterId, paragraphId: paragraph.id, excerpt: row.quoteSnippet, tag: '' },
      corrected: false,
    };
    return [cue];
  });
}
