// Browser/mock demo contract. The source material is Lewis Carroll's 1865
// public-domain Alice's Adventures in Wonderland. Multiple real-text
// paragraphs per chapter make this a useful reader and proofing demo.
import type {
  Discrepancy,
  GuideEntity,
  ManuscriptChapter,
  ManuscriptNote,
  ManuscriptParagraph,
  ReaderState,
  ScopedSettingField,
  TranscriptState,
} from '../types';

export const aliceChapterSeeds = [
  {
    title: 'Chapter 1',
    subtitle: 'Down the Rabbit-Hole',
    paragraphs: [
      [
        'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice ',
        'she had peeped into the book her sister was reading, but it had no pictures or conversations in it.',
      ].join(''),
      [
        'So she was considering in her own mind whether the pleasure of making a daisy-chain would be worth the trouble of getting ',
        'up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.',
      ].join(''),
      'There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, “Oh dear! Oh dear! I shall be late!”',
      'Burning with curiosity, she ran across the field after it, and was just in time to see it pop down a large rabbit-hole under the hedge.',
    ],
  },
  {
    title: 'Chapter 2',
    subtitle: 'The Pool of Tears',
    paragraphs: [
      '“Curiouser and curiouser!” cried Alice; she was so much surprised, that for the moment she quite forgot how to speak good English.',
      [
        'She went on growing, and growing, and very soon had to kneel down on the floor: in another minute there was not even ',
        'room for this, and she tried the effect of lying down with one elbow against the door.',
      ].join(''),
      '“I wish I hadn’t cried so much!” said Alice, as she swam about, trying to find her way out. “I shall be punished for it now, I suppose, by being drowned in my own tears!”',
      'Just then she heard something splashing about in the pool a little way off, and she swam nearer to make out what it was.',
    ],
  },
  {
    title: 'Chapter 3',
    subtitle: 'A Caucus-Race and a Long Tale',
    paragraphs: [
      'At last the Mouse, who seemed to be a person of authority among them, called out, “Sit down, all of you, and listen to me! I’ll soon make you dry enough!”',
      '“Ahem!” said the Mouse with an important air, “are you all ready? This is the driest thing I know.”',
      'The Dodo suddenly called out “The race is over!” and they all crowded round it, panting, and asking, “But who has won?”',
      'Everybody has won, and all must have prizes, the Dodo said; so Alice was soon handing round the comfits.',
    ],
  },
  {
    title: 'Chapter 4',
    subtitle: 'The Rabbit Sends in a Little Bill',
    paragraphs: [
      'It was the White Rabbit, trotting slowly back again, and looking anxiously about as it went, as if it had lost something.',
      '“Mary Ann! Mary Ann!” said the Rabbit in a voice of great surprise. “Where are you, Mary Ann? Run home this moment, and fetch me a pair of gloves and a fan!”',
      'Alice took up the fan and gloves, and, as she went on, she kept on talking to herself. “Dear, dear! How queer everything is to-day!”',
      'The poor little Lizard, Bill, was in the middle, being held up by two guinea-pigs, who were giving it something out of a bottle.',
    ],
  },
  {
    title: 'Chapter 5',
    subtitle: 'Advice from a Caterpillar',
    paragraphs: [
      'Alice looked up, and there was the Caterpillar, sitting on the top of a mushroom, with its arms folded, quietly smoking a long hookah.',
      '“Who are you?” said the Caterpillar. This was not an encouraging opening for a conversation.',
      '“I—I hardly know, sir, just at present—at least I know who I was when I got up this morning, but I think I must have been changed several times since then.”',
      '“One side will make you grow taller, and the other side will make you grow shorter,” said the Caterpillar.',
    ],
  },
  {
    title: 'Chapter 6',
    subtitle: 'Pig and Pepper',
    paragraphs: [
      'For a minute or two she stood looking at the house, and wondering what to do next, when suddenly a footman in livery came running out of the wood.',
      'The door was opened by another footman in livery, with a round face, and large eyes like a frog; and both footmen bowed low.',
      'The Duchess was sitting on a three-legged stool in the middle, nursing a baby; the cook was leaning over the fire, stirring a large cauldron which seemed to be full of soup.',
      'The Cheshire Cat only grinned when it saw Alice. It looked good-natured, she thought: still it had very long claws and a great many teeth.',
    ],
  },
  {
    title: 'Chapter 7',
    subtitle: 'A Mad Tea-Party',
    paragraphs: [
      'There was a table set out under a tree in front of the house, and the March Hare and the Hatter were having tea at it: a Dormouse was sitting between them, fast asleep.',
      '“No room! No room!” they cried out when they saw Alice coming. “There’s plenty of room!” said Alice indignantly, and she sat down in a large arm-chair at one end of the table.',
      '“Have some wine,” the March Hare said in an encouraging tone. Alice looked all round the table, but there was nothing on it but tea.',
      '“If you knew Time as well as I do,” said the Hatter, “you wouldn’t talk about wasting it. It’s him.”',
    ],
  },
  {
    title: 'Chapter 8',
    subtitle: 'The Queen’s Croquet-Ground',
    paragraphs: [
      'A large rose-tree stood near the entrance of the garden: the roses growing on it were white, but there were three gardeners at it, busily painting them red.',
      'The Queen of Hearts gave a little scream of laughter. “What is this?” she said. “I could tell you my adventures—beginning from this morning,” said Alice.',
      '“Off with their heads!” and the procession moved on, three of the soldiers remaining behind to execute the unfortunate gardeners.',
      'The players all played at once without waiting for turns, quarrelling all the while, and fighting for the hedgehogs; and in a very short time the Queen was in a furious passion.',
    ],
  },
  {
    title: 'Chapter 9',
    subtitle: 'The Mock Turtle’s Story',
    paragraphs: [
      ['“You can’t think how glad I am to see you again, you dear old thing!” said the Duchess, ', 'as she tucked her arm affectionately into Alice’s.'].join(
        '',
      ),
      'They had not gone much farther before they saw the Mock Turtle in the distance, sitting sad and lonely on a little ledge of rock.',
      '“Once,” said the Mock Turtle at last, with a deep sigh, “I was a real Turtle.”',
      'The Gryphon sat up and rubbed its eyes. “What fun!” said the Gryphon, half to itself, half to the Mock Turtle.',
    ],
  },
  {
    title: 'Chapter 10',
    subtitle: 'The Lobster Quadrille',
    paragraphs: [
      '“Will you walk a little faster?” said a whiting to a snail, “There’s a porpoise close behind us, and he’s treading on my tail.”',
      '“What is the use of repeating all that stuff?” the Mock Turtle interrupted, “if you don’t explain it as you go on? It’s by far the most confusing thing I ever heard!”',
      'So they began solemnly dancing round and round Alice, every now and then treading on her toes when they passed too close.',
      '“I’ve had enough of this!” said Alice to the Gryphon: and the Gryphon said, “Come on! It’s time for you to hear the trial.”',
    ],
  },
  {
    title: 'Chapter 11',
    subtitle: 'Who Stole the Tarts?',
    paragraphs: [
      'The King and Queen of Hearts were seated on their throne when they arrived, with a great crowd assembled about them—all sorts of little birds and beasts.',
      'The Knave of Hearts was standing before them, in chains, with a soldier on each side to guard him; and near the King was the White Rabbit, with a trumpet in one hand.',
      'The Queen of Hearts, she made some tarts, all on a summer day: the Knave of Hearts, he stole those tarts, and took them quite away.',
      '“Consider your verdict,” the King said to the jury. “Not yet, not yet!” the Rabbit hastily interrupted. “There’s a great deal to come before that!”',
    ],
  },
  {
    title: 'Chapter 12',
    subtitle: 'Alice’s Evidence',
    paragraphs: [
      '“Here!” cried Alice, quite forgetting in the flurry of the moment how large she had grown in the last few minutes, and she jumped up in such a hurry that she tipped over the jury-box.',
      '“The first witness was the Hatter,” said the King; and the Hatter came forward, carrying a teacup in one hand and a piece of bread-and-butter in the other.',
      '“Who cares for you?” said Alice. “You’re nothing but a pack of cards!”',
      'At this the whole pack rose up into the air, and came flying down upon her: she gave a little scream, half of fright and half of anger, and tried to beat them off.',
    ],
  },
] as const;

const aliceChapters = aliceChapterSeeds;

const titles = aliceChapters.map((chapter) => chapter.title);
const paragraphIndex = (chapter: number, paragraph: number) =>
  aliceChapters.slice(0, chapter).reduce((total, item) => total + item.paragraphs.length, 0) + paragraph;
const idsFor = (text: string) =>
  [
    ['Alice', 'alice'],
    ['White Rabbit', 'white-rabbit'],
    ['Rabbit', 'white-rabbit'],
    ['Queen of Hearts', 'queen-of-hearts'],
    ['Queen', 'queen-of-hearts'],
    ['Hatter', 'mad-hatter'],
    ['Caterpillar', 'caterpillar'],
    ['Cheshire Cat', 'cheshire-cat'],
    ['Duchess', 'duchess'],
    ['Mock Turtle', 'mock-turtle'],
    ['Gryphon', 'gryphon'],
    ['garden', 'queens-garden'],
  ]
    .filter(([term]) => text.includes(term))
    .map(([, id]) => id);

export const WIRE_PARAGRAPHS: ManuscriptParagraph[] = aliceChapters.flatMap((chapter, chapterIndex) =>
  chapter.paragraphs.map((text, localIndex) => {
    const index = paragraphIndex(chapterIndex, localIndex);
    return { id: `p-${index + 1}`, chapterId: `chapter-${chapterIndex + 1}`, chapter: chapter.title, index, sourceLine: 10 + index * 5, text, entityIds: Array.from(new Set(idsFor(text))) };
  }),
);
export const WIRE_CHAPTERS: ManuscriptChapter[] = aliceChapters.map((chapter, index) => ({
  id: 'chapter-' + (index + 1),
  title: chapter.title,
  subtitle: chapter.subtitle,
  index,
  wordCount: chapter.paragraphs.join(' ').split(/\s+/).length * 4,
  recordedFraction: index < 3 ? 1 : index < 6 ? 0.65 : 0,
  status: index < 3 ? 'finalized' : index < 6 ? 'recording' : index < 8 ? 'editing' : index < 10 ? 'proofing' : 'not_started',
}));

const pronunciation = (ipa: string) => ({ ipa, source: ipa ? 'Piper' : 'not generated', confidence: ipa ? 'high' : 'unknown' });
const occurrence = (chapter: number, paragraph: number) => {
  const index = paragraphIndex(chapter, paragraph);
  const row = WIRE_PARAGRAPHS[index];
  return { chapter: row.chapter, paragraph: row.index, sourceLine: row.sourceLine, excerpt: row.text };
};
export const WIRE_ENTITIES: GuideEntity[] = [
  {
    id: 'alice',
    canonical_name: 'Alice',
    category: 'Character',
    locked: false,
    review_state: 'generated',
    pronunciation: pronunciation('/ˈælɪs/'),
    description: { text: 'A curious child whose changing size and direct questions drive the story.', evidence: {} },
    personality_notes: [{ text: 'Curious, logical, and increasingly confident.', evidence: {} }],
    aliases: [],
    relationships: [
      { id: 'white-rabbit', name: 'White Rabbit', label: 'follows' },
      { id: 'queen-of-hearts', name: 'Queen of Hearts', label: 'challenges' },
    ],
    occurrences: [occurrence(0, 0), occurrence(4, 1), occurrence(11, 2)],
    occurrence_count: 3,
  },
  {
    id: 'white-rabbit',
    canonical_name: 'White Rabbit',
    category: 'Character',
    locked: false,
    review_state: 'generated',
    pronunciation: pronunciation('/waɪt ˈræbɪt/'),
    description: { text: 'The anxious, late-running rabbit who leads Alice underground.', evidence: {} },
    personality_notes: [{ text: 'Flustered and self-important.', evidence: {} }],
    aliases: [{ text: 'Rabbit', pronunciation: pronunciation('/ˈræbɪt/'), occurrences: [occurrence(0, 2), occurrence(3, 0)] }],
    relationships: [{ id: 'alice', name: 'Alice', label: 'is followed by' }],
    occurrences: [occurrence(0, 1), occurrence(3, 0)],
    occurrence_count: 4,
  },
  {
    id: 'queen-of-hearts',
    canonical_name: 'Queen of Hearts',
    category: 'Character',
    locked: true,
    review_state: 'generated',
    pronunciation: pronunciation('/kwiːn əv hɑːrts/'),
    description: { text: 'Wonderland’s volatile ruler, quick to order executions.', evidence: {} },
    personality_notes: [{ text: 'Imperious, impatient, and theatrical.', evidence: {} }],
    aliases: [{ text: 'Queen', pronunciation: pronunciation('/kwiːn/'), occurrences: [occurrence(7, 2), occurrence(10, 0)] }],
    relationships: [
      { id: 'alice', name: 'Alice', label: 'puts on trial' },
      { id: 'queens-garden', name: 'Queen’s garden', label: 'rules' },
    ],
    occurrences: [occurrence(7, 1), occurrence(7, 3)],
    occurrence_count: 4,
  },
  {
    id: 'mad-hatter',
    canonical_name: 'Hatter',
    category: 'Character',
    locked: false,
    review_state: 'generated',
    pronunciation: pronunciation('/ˈhætər/'),
    description: { text: 'A tea-party guest whose dispute with Time has stopped his clock.', evidence: {} },
    personality_notes: [{ text: 'Literal, argumentative, and delightfully evasive.', evidence: {} }],
    aliases: [{ text: 'Mad Hatter', pronunciation: pronunciation('/mæd ˈhætər/'), occurrences: [] }],
    relationships: [{ id: 'march-hare', name: 'March Hare', label: 'takes tea with' }],
    occurrences: [occurrence(6, 0), occurrence(6, 3), occurrence(11, 1)],
    occurrence_count: 3,
  },
  {
    id: 'caterpillar',
    canonical_name: 'Caterpillar',
    category: 'Character',
    locked: false,
    review_state: 'generated',
    pronunciation: pronunciation('/ˈkætərpɪlər/'),
    description: { text: 'A mushroom-seated adviser who explains the effects of each side.', evidence: {} },
    personality_notes: [{ text: 'Aloof and cryptic.', evidence: {} }],
    aliases: [],
    relationships: [{ id: 'alice', name: 'Alice', label: 'advises' }],
    occurrences: [occurrence(4, 0), occurrence(4, 1), occurrence(4, 3)],
    occurrence_count: 3,
  },
  {
    id: 'cheshire-cat',
    canonical_name: 'Cheshire Cat',
    category: 'Character',
    locked: false,
    review_state: 'generated',
    pronunciation: pronunciation('/ˈtʃɛʃər kæt/'),
    description: { text: 'A grinning cat who helps Alice navigate Wonderland.', evidence: {} },
    personality_notes: [{ text: 'Calm, mischievous, and deliberately enigmatic.', evidence: {} }],
    aliases: [{ text: 'Cat', pronunciation: pronunciation('/kæt/'), occurrences: [occurrence(5, 3)] }],
    relationships: [{ id: 'duchess', name: 'Duchess', label: 'belongs to' }],
    occurrences: [occurrence(5, 3)],
    occurrence_count: 2,
  },
  {
    id: 'queens-garden',
    canonical_name: 'Queen’s garden',
    category: 'Place',
    locked: false,
    review_state: 'generated',
    pronunciation: pronunciation('/kwiːnz ˈɡɑːrdən/'),
    description: { text: 'The chaotic croquet ground where white roses are painted red.', evidence: {} },
    personality_notes: [],
    aliases: [{ text: 'garden', pronunciation: pronunciation('/ˈɡɑːrdən/'), occurrences: [occurrence(7, 0)] }],
    relationships: [{ id: 'queen-of-hearts', name: 'Queen of Hearts', label: 'is ruled by' }],
    occurrences: [occurrence(7, 0), occurrence(7, 3)],
    occurrence_count: 2,
  },
  {
    id: 'march-hare',
    canonical_name: 'March Hare',
    category: 'Needs Review',
    locked: false,
    review_state: 'unreviewed',
    pronunciation: pronunciation(''),
    description: { text: 'A tea-party guest pending a Story Bible category review.', evidence: {} },
    personality_notes: [],
    aliases: [],
    relationships: [{ id: 'mad-hatter', name: 'Hatter', label: 'takes tea with' }],
    occurrences: [occurrence(6, 0), occurrence(6, 2)],
    occurrence_count: 2,
  },
];

export const WIRE_NOTES: ManuscriptNote[] = [
  {
    id: 'note-alice-rabbit',
    chapter: titles[0],
    paragraph: paragraphIndex(0, 3),
    text: 'Keep the curiosity bright; this is the turn that commits Alice to the adventure.',
    createdAt: '2026-01-01T00:00:00.000Z',
    anchorStart: 0,
    anchorEnd: aliceChapters[0].paragraphs[3].length,
    anchorText: aliceChapters[0].paragraphs[3],
  },
];
export const WIRE_READER_STATE: ReaderState = {
  activeChapter: titles[0],
  activeSourceLine: 10,
  expandedChapters: [titles[0]],
  bookmarks: [
    { id: 'bookmark-alice-1', kind: 'line', chapter: titles[0], paragraph: 0, sourceLine: 10, createdAt: '2026-01-01T00:00:00.000Z' },
    {
      id: 'bookmark-note-rabbit',
      kind: 'note',
      chapter: titles[0],
      paragraph: paragraphIndex(0, 3),
      noteId: 'note-alice-rabbit',
      sourceLine: 25,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};
export const WIRE_DISCREPANCIES: Discrepancy[] = [
  {
    id: 'disc-1',
    kind: 'MISREAD',
    name: 'White Rabbit',
    docText: 'White Rabbit',
    audioText: 'wide rabbit',
    projectTime: 14.2,
    itemIndex: 0,
    srcpos: 0,
    chapter: titles[0],
    paragraph: paragraphIndex(0, 1),
    sourceLine: 15,
    scriptContext: '...a White Rabbit with pink eyes ran close by her...',
    audioContext: '...a wide rabbit with pink eyes ran close by her...',
    markerState: 'pending',
  },
  {
    id: 'disc-2',
    kind: 'SKIPPED',
    name: 'Queen of Hearts',
    docText: 'Queen of Hearts',
    audioText: '(nothing heard)',
    projectTime: 41.8,
    itemIndex: 1,
    srcpos: 0,
    chapter: titles[7],
    paragraph: paragraphIndex(7, 1),
    sourceLine: 155,
    scriptContext: '...The Queen of Hearts gave a little scream of laughter...',
    audioContext: '...gave a little scream of laughter...',
    markerState: 'existing',
    existingMarkerName: "SKIPPED: 'Queen of Hearts'",
  },
];
export const WIRE_LOGS = [
  { level: 'normal', text: '[00:04] Exported take audio (Track 3)' },
  { level: 'normal', text: '[00:09] Loaded vocabulary hints (5 terms)' },
  { level: 'verbose', text: '[00:10] Validated sample rate: 48 kHz' },
  { level: 'normal', text: '[00:11] Whisper: model “small” ready' },
  { level: 'verbose', text: '[00:19] Chunk 2 queued behind worker 3' },
  { level: 'normal', text: '[00:33] Chunk 3/7 complete — 1 candidate discrepancy' },
];
export const WIRE_TRANSCRIPT: TranscriptState = {
  phase: 'idle',
  percent: 0,
  message: 'Select a track in REAPER, then start a comparison.',
  logs: [],
  chapters: [],
  rows: [],
  diff: '',
  summary: '',
  elapsed: 0,
  markerExport: { phase: 'idle', message: '', added: 0, skipped: 0 },
};

const choice = (key: string, label: string, choices: string[], value: string): ScopedSettingField => ({
  key,
  label,
  kind: 'choice',
  choices,
  value,
  isSet: true,
  effectiveValue: value,
  effectiveSource: 'repo default',
});
export const wireSettings = (): Record<string, ScopedSettingField[]> => ({
  General: [choice('log_verbosity', 'Log verbosity', ['quiet', 'normal', 'verbose'], 'normal')],
  Manuscript: [
    {
      key: 'color_note',
      label: 'Note color',
      kind: 'color',
      choices: [],
      value: 'B85C1E',
      isSet: true,
      effectiveValue: 'B85C1E',
      effectiveSource: 'repo default',
    },
  ],
  ManuscriptGuide: [
    choice('spacy_model', 'Spacy model', ['sm', 'md', 'lg'], 'sm'),
    ...[
      ['character', 'Character', '3C7A5C'],
      ['location', 'Location', '3F6EA6'],
      ['organization', 'Organization', '7A5CAE'],
      ['lore', 'Lore', '9A6B34'],
      ['item', 'Item', '42758A'],
      ['event', 'Event', '9A4E69'],
      ['needs_review', 'Needs Review', 'B5473C'],
    ].map(([key, label, value]) => ({
      key: 'color_' + key,
      label: label + ' color',
      kind: 'color' as const,
      choices: [],
      value,
      isSet: true,
      effectiveValue: value,
      effectiveSource: 'repo default',
    })),
  ],
  TranscriptCompare: [
    choice('model_size', 'Default Whisper model', ['tiny', 'small', 'medium', 'large-v3-turbo', 'large-v3'], 'small'),
    choice('chunk_seconds', 'Default chunk length', ['30', '60', '300', '600'], '60'),
    {
      key: 'color_misread',
      label: 'Misread marker color',
      kind: 'color',
      choices: [],
      value: 'B5473C',
      isSet: true,
      effectiveValue: 'B5473C',
      effectiveSource: 'repo default',
    },
    {
      key: 'color_skipped',
      label: 'Skipped marker color',
      kind: 'color',
      choices: [],
      value: 'B5871E',
      isSet: true,
      effectiveValue: 'B5871E',
      effectiveSource: 'repo default',
    },
    {
      key: 'color_extra',
      label: 'Extra marker color',
      kind: 'color',
      choices: [],
      value: '3F6EA6',
      isSet: true,
      effectiveValue: '3F6EA6',
      effectiveSource: 'repo default',
    },
  ],
  Piper: [
    choice('piper_provider', 'Provider', ['piper'], 'piper'),
    choice('piper_model', 'Voice model', ['lessac-medium', 'lessac-high', 'ryan-medium'], 'lessac-medium'),
  ],
  Daw: [],
});
export const wireClone = <T>(value: T): T => structuredClone(value);
