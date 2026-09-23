// Browser/mock demo contract. The source material is Lewis Carroll's 1865
// public-domain Alice's Adventures in Wonderland. Multiple real-text
// paragraphs per chapter make this a useful reader and proofing demo.
import type {
  ChapterTagsEmbedResult,
  ChapterTagsPreview,
  Discrepancy,
  GuideEntity,
  LineIdentityLine,
  LineIdentityState,
  ManuscriptChapter,
  ManuscriptNote,
  ManuscriptParagraph,
  PickupsState,
  ReaderState,
  RenderConfigState,
  ScopedSettingField,
  TeleprompterDevice,
  TextSpan,
  TracksProject,
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

const plainParagraphs: ManuscriptParagraph[] = aliceChapters.flatMap((chapter, chapterIndex) =>
  chapter.paragraphs.map((text, localIndex) => {
    const index = paragraphIndex(chapterIndex, localIndex);
    return {
      id: `p-${index + 1}`,
      chapterId: `chapter-${chapterIndex + 1}`,
      chapter: chapter.title,
      index,
      sourceLine: 10 + index * 5,
      text,
      entityIds: Array.from(new Set(idsFor(text))),
    };
  }),
);

// Two paragraphs carry what the importer now preserves - a line break inside a
// paragraph ("\n") and bold/italic/underline spans (ADR-0013/0014) - so the
// visual suite and the user guide can show them. Spans are located by phrase so
// they stay correct if the seed prose is edited.
const spanFor = (text: string, phrase: string, style: TextSpan['style']): TextSpan[] => {
  const start = text.indexOf(phrase);
  return start < 0 ? [] : [{ start, end: start + phrase.length, style }];
};
export const withFormatting = (paragraph: ManuscriptParagraph): ManuscriptParagraph => {
  if (paragraph.index === 4) {
    const text = paragraph.text.replace(' and then dipped', '\nand then dipped');
    return {
      ...paragraph,
      text,
      spans: [...spanFor(text, 'tunnel', 'underline'), ...spanFor(text, 'suddenly down', 'italic'), ...spanFor(text, 'a very deep well', 'bold')],
    };
  }
  if (paragraph.index === 6) {
    return { ...paragraph, spans: [...spanFor(paragraph.text, 'thought Alice to herself', 'italic'), ...spanFor(paragraph.text, 'nothing', 'bold')] };
  }
  return paragraph;
};
export const WIRE_PARAGRAPHS: ManuscriptParagraph[] = plainParagraphs.map(withFormatting);
export const WIRE_CHAPTERS: ManuscriptChapter[] = aliceChapters.map((chapter, index) => ({
  id: 'chapter-' + (index + 1),
  title: chapter.title,
  subtitle: chapter.subtitle,
  index,
  paragraphIds: WIRE_PARAGRAPHS.filter((paragraph) => paragraph.chapterId === `chapter-${index + 1}`).map(({ id, index: paragraphIndex }) => ({
    id,
    index: paragraphIndex,
  })),
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
    properties: [
      { key: 'Age', value: 'Seven' },
      { key: 'Home', value: 'Oxford' },
    ],
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
    properties: [],
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
    properties: [{ key: 'Title', value: 'Queen of Hearts' }],
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
    properties: [],
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
    properties: [],
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
    properties: [],
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
    properties: [],
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
    properties: [],
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
  {
    id: 'disc-3',
    kind: 'EXTRA',
    name: 'oh dear',
    docText: '(nothing written)',
    audioText: 'oh dear, oh dear',
    projectTime: 9.6,
    itemIndex: 2,
    srcpos: 0,
    chapter: titles[0],
    paragraph: paragraphIndex(0, 2),
    sourceLine: 18,
    scriptContext: "...Oh dear! I shall be late!' (when she thought it over afterwards...",
    audioContext: "...Oh dear, oh dear, I shall be late!' (when she thought it over afterwards...",
    // 'exported' (not 'pending') so this addition doesn't change the pending
    // marker count Transcript.test.tsx asserts against for disc-1/disc-2.
    markerState: 'exported',
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

// Two devices, one with the kind of parenthesised driver suffix real `dshow` names carry, so the picker's option
// labels are exercised against realistic text (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 1 finding).
export const WIRE_TELEPROMPTER_DEVICES: TeleprompterDevice[] = [
  { name: 'Microphone Array (Realtek(R) Audio)' },
  { name: 'Headset Microphone (USB Audio Device)' },
];

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
const bool = (key: string, label: string, value: 'true' | 'false'): ScopedSettingField => ({
  key,
  label,
  kind: 'bool',
  choices: [],
  value,
  isSet: true,
  effectiveValue: value,
  effectiveSource: 'repo default',
});
export const wireSettings = (): Record<string, ScopedSettingField[]> => ({
  General: [
    choice('log_verbosity', 'Log verbosity', ['quiet', 'normal', 'verbose'], 'normal'),
    bool('notifications', "Notify me when a long task finishes while I'm away", 'true'),
    {
      key: 'narrator_name',
      label: 'Narrator name (default for credits)',
      kind: 'text',
      choices: [],
      value: '',
      isSet: false,
      effectiveValue: '',
      effectiveSource: 'hardcoded',
    },
  ],
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
    choice('spacy_model', 'spaCy model', ['en_core_web_sm', 'en_core_web_lg'], 'en_core_web_sm'),
    bool('build_after_import', 'Build the Story Bible after import', 'true'),
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
  Piper: [choice('tts_provider', 'TTS provider', ['piper'], 'piper'), choice('tts_voice_id', 'Preview voice', ['en_US-ljspeech-high'], 'en_US-ljspeech-high')],
  // Global-scope machine facts (docs/prds/teleprompter-engines-and-input-devices.prd.md, "Where the device, engine and
  // model choices are stored"): the device is unset until the narrator picks one, so the mock starts it empty like the
  // host does. Engine and model carry the repo defaults (whisper, tiny): the engine choice stays limited to "whisper"
  // until Phase 7 wires Moonshine end to end, and the model choice is Whisper tiny and small only (only tiny has
  // measured live-lag data).
  Teleprompter: [
    { key: 'input_device', label: 'Microphone', kind: 'text', choices: [], value: '', isSet: false, effectiveValue: '', effectiveSource: 'hardcoded' },
    {
      key: 'engine',
      label: 'Live engine',
      kind: 'choice',
      choices: ['whisper'],
      value: '',
      isSet: false,
      effectiveValue: 'whisper',
      effectiveSource: 'repo default',
    },
    {
      key: 'model',
      label: 'Model',
      kind: 'choice',
      choices: ['tiny', 'small'],
      value: '',
      isSet: false,
      effectiveValue: 'tiny',
      effectiveSource: 'repo default',
    },
  ],
  Updates: [
    {
      key: 'check_on_startup',
      label: 'Check for updates on startup',
      kind: 'bool',
      choices: [],
      value: 'true',
      isSet: true,
      effectiveValue: 'true',
      effectiveSource: 'repo default',
    },
    choice('channel', 'Update channel', ['candidates', 'stable'], 'candidates'),
  ],
  // DAW.reaper_path/auto_start_launcher (Phase 8): keyed "DAW" to match apps/desktop/app.go's fieldSchemas, not
  // the "Daw" Settings category key (which is a UI label, not the settings tool name).
  DAW: [
    {
      key: 'reaper_path',
      label: 'REAPER executable (override)',
      kind: 'text',
      choices: [],
      value: '',
      isSet: false,
      effectiveValue: '',
      effectiveSource: 'hardcoded',
    },
    {
      key: 'auto_start_launcher',
      label: 'Start the launcher script automatically',
      kind: 'bool',
      choices: [],
      value: '',
      isSet: false,
      effectiveValue: 'false',
      effectiveSource: 'repo default',
    },
  ],
});
export const WIRE_TRACKS_PROJECT: TracksProject = {
  path: 'C:/Projects/Alice-in-Wonderland/Alice.rpp',
  tracks: [
    {
      guid: '{0E4D1D7F-D039-674D-87E6-719376DE95EC}',
      index: 0,
      name: 'Chapter 1',
      color: '#3F6EA6',
      muted: false,
      soloed: false,
      items: [
        {
          guid: '{7A6B5C4D-3E2F-4190-8A1B-2C3D4E5F6071}',
          position: 0,
          length: 612.4,
          name: 'ch1_take3.wav',
          sourceKind: 'WAVE',
          sourceFile: 'C:/Projects/Alice-in-Wonderland/media/ch1_take3.wav',
          sourceAvailable: true,
          supported: true,
        },
      ],
    },
    {
      guid: '{DA2D209F-D10F-5E46-93E7-098D96499ED0}',
      index: 1,
      name: 'Chapter 2',
      color: '',
      muted: false,
      soloed: false,
      items: [
        {
          guid: '{8B7C6D5E-4F30-42A1-9B2C-3D4E5F607182}',
          position: 0,
          length: 548.9,
          name: 'ch2_take1.wav',
          sourceKind: 'WAVE',
          sourceFile: 'C:/Projects/Alice-in-Wonderland/media/ch2_take1.wav',
          sourceAvailable: false,
          supported: true,
        },
      ],
    },
    {
      guid: '{C33A3BE7-8F84-7940-9610-65C6ED6CED7A}',
      index: 2,
      name: 'Click Track',
      color: '',
      muted: true,
      soloed: false,
      items: [
        {
          guid: '{9C8D7E6F-5041-43B2-AC3D-4E5F60718293}',
          position: 0,
          length: 4,
          name: 'click',
          sourceKind: 'MIDI',
          sourceFile: '',
          sourceAvailable: false,
          supported: false,
        },
      ],
    },
  ],
};

const idleLineIdentityStamp: LineIdentityState['stamp'] = { applied: 0, unchanged: 0, missingCount: 0, conflictsCount: 0, missing: [], conflicts: [] };

/** The Go host's LineIdentityState answer before any Stamp or Read has run (mirrors tests/fixtures/contracts/line-identity-idle.json). */
export const WIRE_LINE_IDENTITY_IDLE: LineIdentityState = {
  phase: 'idle',
  message: '',
  stamp: { ...idleLineIdentityStamp },
  lines: [],
  linesRead: 0,
};

/** One row of every status the classifier produces, keyed to WIRE_TRACKS_PROJECT's own chapter track item GUIDs where it helps a screenshot read naturally (mirrors tests/fixtures/contracts/line-identity-read-success.json). */
export const WIRE_LINE_IDENTITY_LINES: LineIdentityLine[] = [
  {
    itemGuid: '{7A6B5C4D-3E2F-4190-8A1B-2C3D4E5F6071}',
    lineId: 'c-0001@a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f809',
    entityId: 'c-0001',
    position: 0,
    length: 612.4,
    text: 'Down the Rabbit-Hole',
    status: 'ok',
  },
  {
    itemGuid: '{8B7C6D5E-4F30-42A1-9B2C-3D4E5F607182}',
    lineId: 'c-0002@a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f809',
    entityId: 'c-0002',
    position: 0,
    length: 548.9,
    text: 'The Pool of Tears (revised)',
    status: 'drift',
    currentText: 'The Pool of Tears',
  },
  {
    itemGuid: '{9C8D7E6F-5041-43B2-AC3D-4E5F60718293}',
    lineId: 'c-0004@old0000000000000000000000000000000000000000000000000000000',
    entityId: 'c-0004',
    position: 0,
    length: 4,
    text: 'The Rabbit Sends in a Little Bill',
    status: 'stale-source',
  },
  {
    itemGuid: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
    lineId: 'c-0099@a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f809',
    entityId: 'c-0099',
    position: 0,
    length: 12,
    text: 'A chapter that no longer exists in the manuscript',
    status: 'removed',
  },
  {
    itemGuid: '{BBBBBBBB-CCCC-DDDD-EEEE-FFFFFFFFFFFF}',
    lineId: 'line-000004',
    entityId: '',
    position: 0,
    length: 9,
    text: 'An identity from an older stamp scheme',
    status: 'unrecognized',
  },
];

/** A completed Read, with every status a narrator can hit shown at once, so the states are reviewable without stepping through a run. */
export const WIRE_LINE_IDENTITY_READ_SUCCESS: LineIdentityState = {
  runId: '1790000000000000',
  phase: 'success',
  message: `Read ${WIRE_LINE_IDENTITY_LINES.length} stamped lines.`,
  stamp: { ...idleLineIdentityStamp },
  lines: WIRE_LINE_IDENTITY_LINES,
  linesRead: WIRE_LINE_IDENTITY_LINES.length,
};

/** A completed Stamp with a conflict and a stale item, so "Link chapters" can show them without a real REAPER. */
export const WIRE_LINE_IDENTITY_STAMP_CONFLICT: LineIdentityState = {
  runId: '1790000000000001',
  phase: 'success',
  message: 'Stamped 1 line, 1 stale item, 1 conflict.',
  stamp: {
    applied: 1,
    unchanged: 0,
    missingCount: 1,
    conflictsCount: 1,
    missing: ['{9C8D7E6F-5041-43B2-AC3D-4E5F60718293}'],
    conflicts: ['{8B7C6D5E-4F30-42A1-9B2C-3D4E5F607182}'],
  },
  lines: [],
  linesRead: 0,
};

/** REAPER reported a problem stamping or reading (a session-level ERROR event, e.g. the script not imported yet). */
export const WIRE_LINE_IDENTITY_ERROR: LineIdentityState = {
  runId: '1790000000000002',
  phase: 'error',
  message:
    'The Narration Utils script in REAPER sent a message this app could not read. Import the script from this app’s REAPER folder again, then try again.',
  stamp: { ...idleLineIdentityStamp },
  lines: [],
  linesRead: 0,
};

/** The Go host's PickupsState answer before any run (mirrors tests/fixtures/contracts/pickups-idle.json). */
export const WIRE_PICKUPS_IDLE: PickupsState = {
  phase: 'idle',
  message: '',
  remaining: 0,
  total: 0,
  csv: '',
};

/** A completed Import (mirrors tests/fixtures/contracts/pickups-import-success.json). */
export const WIRE_PICKUPS_IMPORT_SUCCESS: PickupsState = {
  runId: '1790000000000000',
  phase: 'success',
  message: 'Imported 2 pickups.',
  remaining: 2,
  total: 2,
  importReport: { added: 2, existing: 0, invalid: 0 },
  csv: '',
};

/** A completed Next, so the "jump to the next pickup" state can be seen without a real REAPER. */
export const WIRE_PICKUPS_NEXT_SUCCESS: PickupsState = {
  runId: '1790000000000001',
  phase: 'success',
  message: 'Jumped to the next pickup.',
  remaining: 2,
  total: 2,
  next: { position: 9.25, tag: 'narrator', note: 'Mispronounced "labyrinthine"' },
  csv: '',
};

/** A completed Export, with CSV text ready to offer as a download. */
export const WIRE_PICKUPS_EXPORT_SUCCESS: PickupsState = {
  runId: '1790000000000002',
  phase: 'success',
  message: 'Exported 2 pickups.',
  remaining: 2,
  total: 2,
  csv: 'start,note,tag\n9.250000,Mispronounced "labyrinthine",narrator\n42.000000,Dog barked in the background,\n',
};

/** REAPER reported a problem importing, exporting, jumping, resolving or counting pickups. */
export const WIRE_PICKUPS_ERROR: PickupsState = {
  runId: '1790000000000003',
  phase: 'error',
  message:
    'The Narration Utils script in REAPER sent a message this app could not read. Import the script from this app’s REAPER folder again, then try again.',
  remaining: 0,
  total: 0,
  csv: '',
};

/** The Go host's RenderConfigState answer before any run (mirrors tests/fixtures/contracts/render-config-idle.json). */
export const WIRE_RENDER_CONFIG_IDLE: RenderConfigState = {
  phase: 'idle',
  message: '',
  folder: '',
  targets: [],
  count: 0,
};

/** A completed configure with two chapter regions (mirrors tests/fixtures/contracts/render-config-success.json). */
export const WIRE_RENDER_CONFIG_SUCCESS: RenderConfigState = {
  runId: '1790000000000000',
  phase: 'success',
  message: 'Render configured for 2 chapter files. Press Render in REAPER to create them.',
  folder: 'C:\\Books\\Alice\\renders',
  targets: ['C:\\Books\\Alice\\renders\\Chapter 1.wav', 'C:\\Books\\Alice\\renders\\Chapter 2.wav'],
  count: 2,
};

/** A completed configure with no chapter regions yet, so the "create them first" message can be reviewed. */
export const WIRE_RENDER_CONFIG_NO_REGIONS: RenderConfigState = {
  runId: '1790000000000001',
  phase: 'success',
  message: 'Render configured. No chapter regions were found yet: create them before rendering.',
  folder: 'C:\\Books\\Alice\\renders',
  targets: [],
  count: 0,
};

/** REAPER reported a problem configuring the render. */
export const WIRE_RENDER_CONFIG_ERROR: RenderConfigState = {
  runId: '1790000000000002',
  phase: 'error',
  message: 'This REAPER version cannot configure render settings.',
  folder: '',
  targets: [],
  count: 0,
};

/** No chapter render has been configured yet (mirrors tests/fixtures/contracts/chapter-tags-preview-idle.json). */
export const WIRE_CHAPTER_TAGS_PREVIEW_IDLE: ChapterTagsPreview = { chapters: [], ready: false };

/** Two chapters, both rendered - ready to embed (mirrors tests/fixtures/contracts/chapter-tags-preview-ready.json). */
export const WIRE_CHAPTER_TAGS_PREVIEW_READY: ChapterTagsPreview = {
  chapters: [
    { title: 'Chapter 1', path: 'C:\\Books\\Alice\\renders\\Chapter 1.mp3', rendered: true },
    { title: 'Chapter 2', path: 'C:\\Books\\Alice\\renders\\Chapter 2.mp3', rendered: true },
  ],
  ready: true,
};

/** Chapters are configured but the narrator has not pressed Render yet, so the second file does not exist. */
export const WIRE_CHAPTER_TAGS_PREVIEW_NOT_RENDERED: ChapterTagsPreview = {
  chapters: [
    { title: 'Chapter 1', path: 'C:\\Books\\Alice\\renders\\Chapter 1.mp3', rendered: true },
    { title: 'Chapter 2', path: 'C:\\Books\\Alice\\renders\\Chapter 2.mp3', rendered: false },
  ],
  ready: false,
};

/** A successful embed (mirrors tests/fixtures/contracts/chapter-tags-embed-success.json). */
export const WIRE_CHAPTER_TAGS_EMBED_SUCCESS: ChapterTagsEmbedResult = {
  outputPath: 'C:\\Books\\Alice\\renders\\Alice in Wonderland.chapters.mp3',
};

export const wireClone = <T>(value: T): T => structuredClone(value);
