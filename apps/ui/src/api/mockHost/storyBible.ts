// The mock host (mockApi.ts): the Story Bible.
import { parseWireJson } from '../wire/parseWire';
import { guidePropertiesSchema } from '../schemas/storyBible';
import type { GuideEntity, GuidePronunciation, GuideProperty, NarrationApi, WorkJob } from '../../types';
import { wireClone } from '../mockFixtures';
import { type MockApiSeed, type MockState, wireContext } from './state';
import { type AssetsMock, MOCK_ASSET_ROOT } from './assets';

/** What the sidecar does with the `properties` value of an edit: a JSON list of pairs, a name on every one and no name twice (whatever its case). */
function parseMockProperties(text: string): GuideProperty[] {
  const seen = new Set<string>();
  return parseWireJson(guidePropertiesSchema, text, wireContext('mock properties')).map((row, index) => {
    const key = row.key.trim();
    if (!key) throw new Error(`Property ${index + 1} has no name.`);
    if (seen.has(key.toLowerCase())) throw new Error(`There are two properties named '${key}'; give each a different name.`);
    seen.add(key.toLowerCase());
    return { key, value: row.value.trim() };
  });
}

/**
 * A real, silent 22.05 kHz mono WAV (a 44-byte header and 200 bytes of samples). The Story Bible preview hook
 * rejects an empty payload (the host never sends one), so the mock must send audio.
 */
const MOCK_PREVIEW_WAV_BASE64 =
  'UklGRuwAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YcgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

/** The Story Bible bindings: the build, the entities and their edits, and the pronunciation preview. */
export function createStoryBibleMock(
  s: MockState,
  initial: MockApiSeed,
  manuscriptReady: Promise<void>,
  {
    spacyInstalled,
    ttsInstalled,
    mockLanguageModel,
    mockVoiceIdentity,
    mockVoice,
  }: Pick<AssetsMock, 'spacyInstalled' | 'ttsInstalled' | 'mockLanguageModel' | 'mockVoiceIdentity' | 'mockVoice'>,
) {
  let storyBibleJob: WorkJob = initial.rebuildRunning
    ? {
        id: 'mock-guide-running',
        kind: 'story_bible',
        phase: 'running',
        message: 'Extracting names and terms',
        percent: 45,
        logs: ['Reading canonical manuscript', 'Read 240 paragraphs in 3 chapters', 'Extracting names and terms'],
        elapsed: 12,
      }
    : { id: null, kind: 'story_bible', phase: 'idle', message: 'Ready to build.', percent: 0, logs: [], elapsed: 0 };
  const updateEntity = (id: string, change: (entity: GuideEntity) => GuideEntity) => {
    s.entities = s.entities.map((entity) => (entity.id === id ? change(entity) : entity));
  };
  const bindings = {
    guideBuild: async (options) => {
      // The first-use gate: the selected language model is an asset, so nothing starts until the narrator chooses to download it or to
      // build without it this once.
      if (!spacyInstalled() && !options?.rulesOnly) {
        return {
          status: 'asset_required' as const,
          model: mockLanguageModel,
          installState: 'not_installed' as const,
          downloadSize: 12806118,
          diskSize: 15251718,
          installPath: MOCK_ASSET_ROOT + '/spacy/en_core_web_sm/3.8.0',
        };
      }
      if (initial.build) {
        const running: WorkJob = {
          id: 'mock-guide',
          kind: 'story_bible',
          phase: 'running',
          message: 'Extracting names and terms',
          percent: 30,
          logs: ['Reading canonical manuscript', 'Read 221 paragraphs in 5 chapters', 'Extracting names and terms'],
          elapsed: 4,
        };
        const failure = 'The language model could not be loaded: the model folder is missing its config.cfg.';
        storyBibleJob = initial.build === 'hold' ? running : { ...running, phase: 'error', message: failure, error: failure, logs: [...running.logs, failure] };
        if (initial.build === 'fails') s.endJob({ id: 'mock-guide', kind: 'story_bible', outcome: 'error', message: failure, durationMs: 4000 });
        return { status: 'started' as const, job: wireClone(running) };
      }
      const message = options?.rulesOnly
        ? 'Story Bible rebuild complete with the rules-only extraction, which is lower quality than a language model.'
        : 'Story Bible rebuild complete.';
      storyBibleJob = {
        id: 'mock-guide',
        kind: 'story_bible',
        phase: 'success',
        message,
        percent: 100,
        logs: ['Reading canonical manuscript', 'Built Story Bible with 7 entities'],
        elapsed: 1,
        result: { message: 'Story Bible rebuilt.' },
      };
      s.endJob({ id: 'mock-guide', kind: 'story_bible', outcome: 'success', message, durationMs: 1000 });
      return { status: 'started' as const, job: wireClone(storyBibleJob) };
    },
    guideBuildState: async () => wireClone(storyBibleJob),
    clearProjectData: async () => {},
    guideEntities: async () => {
      await manuscriptReady;
      return wireClone(s.entities);
    },
    guideEdit: async (id, values) => {
      // A Python process that has not answered yet: the Save button stays busy, so its look can be seen (`?mockHoldEdits=1`).
      if (initial.holdEdits) await new Promise<void>(() => {});
      return updateEntity(id, (entity) => ({
        ...entity,
        canonical_name: values.canonical_name ?? entity.canonical_name,
        category: values.category ?? entity.category,
        description: values.description === undefined ? entity.description : { text: values.description, evidence: {} },
        personality_notes: values.personality === undefined ? entity.personality_notes : values.personality ? [{ text: values.personality, evidence: {} }] : [],
        context: values.context ?? entity.context,
        properties: values.properties === undefined ? entity.properties : parseMockProperties(values.properties),
        aliases:
          values.aliases === undefined
            ? entity.aliases
            : values.aliases
                .split(';')
                .map((text) => text.trim())
                .filter(Boolean)
                .map(
                  (text) =>
                    entity.aliases.find((alias) => alias.text === text) ?? {
                      text,
                      pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' },
                      occurrences: [],
                    },
                ),
      }));
    },
    guideSetLocked: async (id, locked) => updateEntity(id, (entity) => ({ ...entity, locked })),
    guideRescan: async (id) =>
      updateEntity(id, (entity) => ({
        ...entity,
        aliases: entity.aliases.map((alias) =>
          alias.occurrences.length
            ? alias
            : {
                ...alias,
                pronunciation: { ipa: '/generated/', source: 'Piper', confidence: 'generated' },
                occurrences: [{ chapter: 'Chapter 2', paragraph: 1, sourceLine: 17, excerpt: `Found a mention of ${alias.text} while scanning Chapter 2.` }],
              },
        ),
        occurrence_count: entity.occurrences.length + entity.aliases.reduce((sum, alias) => sum + (alias.occurrences.length || 1), 0),
      })),
    guideCreate: async (name, category, aliases) => {
      const id = `new-${s.nextId++}`;
      s.entities = [
        ...s.entities,
        {
          id,
          canonical_name: name || 'New entity',
          category: category || 'Draft',
          locked: false,
          review_state: 'draft',
          pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' },
          description: { text: '', evidence: {} },
          personality_notes: [],
          properties: [],
          context: '',
          aliases: aliases.map((text) => ({ text, pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' }, occurrences: [] })),
          relationships: [],
          occurrences: [],
          occurrence_count: 0,
        },
      ];
      return id;
    },
    guideMerge: async (sourceId, targetId) => {
      const source = s.entities.find((entity) => entity.id === sourceId);
      const target = s.entities.find((entity) => entity.id === targetId);
      if (!source || !target || source.locked) return;
      const names = [{ text: source.canonical_name, pronunciation: source.pronunciation, occurrences: source.occurrences }, ...source.aliases];
      const aliases = [...target.aliases];
      names.forEach((candidate) => {
        if (
          candidate.text.toLowerCase() !== target.canonical_name.toLowerCase() &&
          !aliases.some((alias) => alias.text.toLowerCase() === candidate.text.toLowerCase())
        )
          aliases.push(candidate);
      });
      updateEntity(targetId, (entity) => ({
        ...entity,
        aliases,
        occurrences: [...entity.occurrences, ...source.occurrences],
        relationships: [...entity.relationships, ...source.relationships.filter((relationship) => relationship.id !== targetId)],
      }));
      s.entities = s.entities
        .filter((entity) => entity.id !== sourceId)
        .map((entity) => ({
          ...entity,
          relationships: entity.relationships
            .map((relationship) => (relationship.id === sourceId ? { ...relationship, id: targetId, name: target.canonical_name } : relationship))
            .filter((relationship, index, rows) => rows.findIndex((item) => item.id === relationship.id && item.label === relationship.label) === index),
        }));
    },
    guideDelete: async (id) => {
      s.entities = s.entities
        .filter((entity) => entity.id !== id)
        .map((entity) => ({ ...entity, relationships: entity.relationships.filter((relationship) => relationship.id !== id) }));
    },
    guideRelate: async (id, otherId, label) =>
      updateEntity(id, (entity) => ({
        ...entity,
        relationships: entity.relationships.some((relationship) => relationship.id === otherId && relationship.label === label)
          ? entity.relationships
          : [...entity.relationships, { id: otherId, name: s.entities.find((row) => row.id === otherId)?.canonical_name ?? otherId, label }],
      })),
    guideUnrelate: async (id, otherId, label) =>
      updateEntity(id, (entity) => ({
        ...entity,
        relationships: entity.relationships.filter((relationship) => !(relationship.id === otherId && relationship.label === label)),
      })),
    guidePreview: async () => {
      if (!ttsInstalled()) {
        return {
          status: 'asset_required' as const,
          voice: mockVoiceIdentity,
          installState: 'not_installed' as const,
          downloadSize: mockVoice.downloadSize,
          diskSize: mockVoice.downloadSize,
          installPath: MOCK_ASSET_ROOT + '/tts/piper/en_US-ljspeech-high',
        };
      }
      // The failing seam behind ?mockPreviewError=<text>, so a real host failure can be seen without a host.
      if (initial.previewError) throw new Error(initial.previewError);
      return { status: 'ready' as const, audioBase64: MOCK_PREVIEW_WAV_BASE64, mimeType: 'audio/wav' };
    },
    guidePronounce: async (id, source, aliasIndex) => {
      const entity = s.entities.find((row) => row.id === id);
      if (!entity) throw new Error('Entity not found.');
      if (entity.locked) throw new Error('This entity is locked. Unlock it before editing.');
      // The mock always succeeds; the real chain can refuse a name a given engine has nothing for (D13/B10).
      const value: GuidePronunciation =
        source === 'cmu'
          ? { ipa: '/mɒk kjuː ɛm juː/', source: 'CMU dictionary', confidence: 'medium', chosen: true }
          : { ipa: '/mɒk iː spiːk/', source: 'eSpeak NG', confidence: 'low', chosen: true };
      updateEntity(id, (row) =>
        aliasIndex === undefined
          ? { ...row, pronunciation: value }
          : { ...row, aliases: row.aliases.map((alias, index) => (index === aliasIndex ? { ...alias, pronunciation: value } : alias)) },
      );
    },
  } satisfies Partial<NarrationApi>;
  return { bindings };
}
