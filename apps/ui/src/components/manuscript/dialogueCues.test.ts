import { describe, expect, it } from 'vitest';
import type { GuideEntity, ManuscriptParagraph } from '../../types';
import { dialogueCueSchema, recordedDemoDialogueCues, speakerLabelForParagraph, type DialogueCue } from './dialogueCues';

const entity = (id: string, canonical_name: string): GuideEntity => ({ id, canonical_name, aliases: [], category: 'Character' }) as unknown as GuideEntity;
const entitiesById = new Map([
  ['alice', entity('alice', 'Alice')],
  ['queen-of-hearts', entity('queen-of-hearts', 'Queen of Hearts')],
]);

// A cue in the exact shape Character Continuity Review's own extractor writes (manuscript_guide.py's
// `extract_cues_from_text`, PR #770): every field this test builds by hand mirrors that shape 1:1, since Phase 4's
// own contract test (below) checks a fixture cue and this "real" shape validate against the same schema.
const realShapedCue: DialogueCue = {
  id: 'cue-abc123def456',
  chapterId: 'chapter-8',
  paragraphId: 'p-42',
  quote_start: 10,
  quote_end: 24,
  quote_text: 'Off with her head!',
  speaker_entity_id: 'queen-of-hearts',
  speaker_source: 'tag',
  evidence: { chapterId: 'chapter-8', paragraphId: 'p-42', excerpt: '... "Off with her head!" the Queen shouted ...', tag: 'the Queen shouted' },
  corrected: false,
};

describe('dialogueCueSchema', () => {
  it('accepts the real extractor shape and a recorded fixture shape alike (Phase 4 contract test)', () => {
    expect(() => dialogueCueSchema.parse(realShapedCue)).not.toThrow();
    const [fixtureCue] = recordedDemoDialogueCues([{ id: 'p-1', chapterId: 'chapter-3', text: 'Mine is a long and a sad tale, said the Mouse.' }]);
    expect(() => dialogueCueSchema.parse(fixtureCue)).not.toThrow();
  });
});

describe('speakerLabelForParagraph', () => {
  const paragraph = { id: 'p-42' };

  it('single-speaker: a cue tagged to a known entity shows that entity’s name', () => {
    const cues: DialogueCue[] = [{ ...realShapedCue, speaker_source: 'tag', speaker_entity_id: 'alice' }];
    expect(speakerLabelForParagraph(paragraph, cues, entitiesById)).toBe('Alice');
  });

  it('ambiguous-cue: a cue resolved only by scene continuation still shows the resolved speaker', () => {
    const cues: DialogueCue[] = [{ ...realShapedCue, speaker_source: 'continuation', speaker_entity_id: 'queen-of-hearts' }];
    expect(speakerLabelForParagraph(paragraph, cues, entitiesById)).toBe('Queen of Hearts');
  });

  it('unknown: a cue with no resolved speaker renders unattributed, never a placeholder name', () => {
    const cues: DialogueCue[] = [{ ...realShapedCue, speaker_source: 'unknown', speaker_entity_id: null }];
    expect(speakerLabelForParagraph(paragraph, cues, entitiesById)).toBeUndefined();
  });

  it('never fabricates a name for a speaker id the reader does not have', () => {
    const cues: DialogueCue[] = [{ ...realShapedCue, speaker_entity_id: 'entity-not-in-guide' }];
    expect(speakerLabelForParagraph(paragraph, cues, entitiesById)).toBeUndefined();
  });

  it('ignores cues on other paragraphs', () => {
    const cues: DialogueCue[] = [{ ...realShapedCue, paragraphId: 'p-99', speaker_entity_id: 'alice' }];
    expect(speakerLabelForParagraph(paragraph, cues, entitiesById)).toBeUndefined();
  });
});

describe('recordedDemoDialogueCues', () => {
  const paragraphs: Pick<ManuscriptParagraph, 'id' | 'chapterId' | 'text'>[] = [
    { id: 'p-1', chapterId: 'chapter-3', text: '‘Mine is a long and a sad tale!’ said the Mouse, turning to Alice, and sighing.' },
    { id: 'p-2', chapterId: 'chapter-3', text: '‘I beg your pardon,’ said Alice very humbly: ‘you had got to the fifth bend, I think?’' },
    {
      id: 'p-3',
      chapterId: 'chapter-3',
      text: '‘You promised to tell me your history, you know,’ said Alice, ‘and why it is you hate--C and D,’ she added in a whisper.',
    },
    { id: 'p-4', chapterId: 'chapter-1', text: 'Alice was beginning to get very tired of sitting by her sister on the bank.' },
  ];

  it('attaches each recorded cue to the paragraph that actually contains its quote, with correct offsets', () => {
    const cues = recordedDemoDialogueCues(paragraphs);

    expect(cues).toHaveLength(3);
    const byParagraph = new Map(cues.map((cue) => [cue.paragraphId, cue]));
    expect(byParagraph.get('p-1')).toMatchObject({ speaker_entity_id: null, speaker_source: 'unknown' });
    expect(byParagraph.get('p-2')).toMatchObject({ speaker_entity_id: 'alice', speaker_source: 'tag' });
    expect(byParagraph.get('p-3')).toMatchObject({ speaker_entity_id: 'alice', speaker_source: 'continuation' });
    const cue = byParagraph.get('p-2')!;
    expect(paragraphs[1].text.slice(cue.quote_start, cue.quote_end)).toBe(cue.quote_text);
  });

  it('finds nothing in a manuscript that never contains the recorded quotes', () => {
    expect(recordedDemoDialogueCues([{ id: 'p-1', chapterId: 'chapter-1', text: 'An entirely different book.' }])).toEqual([]);
  });
});
