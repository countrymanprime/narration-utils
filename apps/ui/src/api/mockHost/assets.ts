// The mock host (mockApi.ts): downloaded assets.
import type { NarrationApi } from '../../types';
import { createTeleprompterMock } from '../teleprompterMock';
import { createInstallMock, installSeedFor, LOCAL_ASSETS_SEEDS } from '../assetInstallMock';
import type { AssetInstallState } from '../contracts/assets';
import { MOCK_DICTIONARY, MOCK_DICTIONARY_DISK_SIZE, MOCK_DICTIONARY_DOWNLOAD_SIZE } from '../dictionaryMock';
import type { MockApiSeed } from './state';

type AssetFactsSource = {
  id: string;
  displayName: string;
  version: string;
  publisher: string;
  license: string;
  licenseUrl: string;
  modelCardUrl: string;
  provenanceUrl: string;
  attribution: string;
  downloadSize: number;
};

/** Where the mock says downloaded assets are kept. */
export const MOCK_ASSET_ROOT = 'C:/Users/narrator/AppData/Local/narration-utils/assets';

/** The asset bindings: the preview voice, the Whisper and Moonshine models, the language model and the dictionary. */
export function createAssetsMock(initial: MockApiSeed) {
  let ttsInstalled = false;
  // What the host says about a voice that is not installed yet (Go's previewVoice); the install state and download size are separate keys.
  const mockVoiceIdentity = {
    id: 'en_US-ljspeech-high',
    provider: 'piper',
    displayName: 'LJ Speech (U.S. English)',
    locale: 'en_US',
    version: '1.0.0',
    publisher: 'rhasspy',
    license: 'Public domain training data; Piper Voices repository MIT',
    licenseUrl: 'https://keithito.com/LJ-Speech-Dataset/',
    modelCardUrl: 'https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/en/en_US/ljspeech/high/MODEL_CARD',
    provenanceUrl: 'https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/en/en_US/ljspeech/high',
    attribution: 'LJ Speech Dataset (public domain); Piper voice model by rhasspy contributors.',
  };
  const mockVoice = { ...mockVoiceIdentity, downloadSize: 114203981, installState: 'not_installed' as const };
  // Whisper defaults to already installed so existing setup/run flows are not
  // gated in every test; a dedicated scenario calls whisperRemove first to
  // exercise the asset_required prompt.
  // A download seed boots without the model, so a page that needs it asks to download it.
  // The seeds for the Local assets page (installing, checking, damaged) keep it installed, so the page shows a mix of states.
  const localAssetsSeed = initial.assets !== undefined && LOCAL_ASSETS_SEEDS.includes(initial.assets);
  let whisperInstalled = initial.assets === undefined || localAssetsSeed;
  // Damaged: the files are there but no longer match, which is what `verification_failed` (Needs repair) says. A repair or a removal ends it.
  let whisperDamaged = initial.assets === 'damaged';
  const whisperState = (): AssetInstallState => (!whisperInstalled ? 'not_installed' : whisperDamaged ? 'verification_failed' : 'installed');
  // The Story Bible language model is installed by default for the same reason; a download seed boots without it, so the build asks first.
  let spacyInstalled = initial.assets === undefined || localAssetsSeed;
  const mockWhisperIdentity = {
    id: 'small',
    provider: 'faster-whisper',
    displayName: 'Small',
    version: '536b0662742c02347bc0e980a01041f333bce120',
    publisher: 'Systran',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    modelCardUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    provenanceUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    attribution: 'CTranslate2 conversion of OpenAI Whisper small, published by Systran.',
  };
  const voiceInstall = createInstallMock({
    total: 114203981,
    noun: 'voice',
    extra: { kind: 'tts', assetId: 'en_US-ljspeech-high' },
    seed: installSeedFor(initial.assets),
    onInstalled: () => {
      ttsInstalled = true;
    },
  });
  // A page opened while the voice downloads follows the job through the list's `activeJobId` (the Local assets page, `?mockAssets=installing|checking`).
  if (initial.assets === 'installing' || initial.assets === 'checking') void voiceInstall.start();
  const modelInstall = createInstallMock({
    total: 483546902 + 2370 + 2203239 + 459861,
    noun: 'Whisper model',
    extra: { kind: 'whisper', assetId: 'small' },
    // The Local assets seeds hold the voice download and nothing else: the Whisper model is repaired and reinstalled to the end.
    seed: localAssetsSeed ? undefined : initial.assets,
    onInstalled: () => {
      whisperInstalled = true;
      whisperDamaged = false;
    },
  });
  const mockLanguageModel = {
    id: 'en_core_web_sm',
    provider: 'spacy',
    displayName: 'English, small (fast)',
    description: 'The default: a small download that runs on any computer.',
    version: '3.8.0',
    publisher: 'Explosion',
    license: 'MIT',
    licenseUrl: 'https://spacy.io/models/en#en_core_web_sm',
    modelCardUrl: 'https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0',
    provenanceUrl: 'https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0',
    attribution: 'spaCy English pipeline by Explosion (MIT). Trained on OntoNotes 5, the ClearNLP dependency conversion and WordNet 3.0.',
  };
  const languageModelInstall = createInstallMock({
    total: 12806118,
    noun: 'language model',
    extra: { kind: 'spacy', assetId: 'en_core_web_sm' },
    seed: localAssetsSeed ? undefined : initial.assets,
    onInstalled: () => {
      spacyInstalled = true;
    },
  });
  // The Teleprompter's second live engine (teleprompter-engines-and-input-devices.prd.md phase 7): the real catalog's tiny model
  // (config/moonshine-assets.json), installed or not on the same seeds as the Whisper model.
  let moonshineInstalled = initial.assets === undefined || localAssetsSeed;
  const MOONSHINE_TINY_BYTES = 77748675;
  const mockMoonshineIdentity = {
    id: 'tiny',
    provider: 'moonshine',
    displayName: 'Tiny',
    version: 'quantized_26_08_21',
    publisher: 'Moonshine AI',
    license: 'MIT',
    licenseUrl: 'https://github.com/moonshine-ai/moonshine/blob/main/LICENSE',
    modelCardUrl: 'https://github.com/moonshine-ai/moonshine',
    provenanceUrl: 'https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21',
    attribution: 'Moonshine tiny-streaming-en, published by Moonshine AI (Useful Sensors), MIT licensed.',
  };
  const moonshineInstall = createInstallMock({
    total: MOONSHINE_TINY_BYTES,
    noun: 'Moonshine model',
    extra: { kind: 'moonshine', assetId: 'tiny' },
    seed: localAssetsSeed ? undefined : initial.assets,
    onInstalled: () => {
      moonshineInstalled = true;
    },
  });
  // The dictionary is installed by default like the language model, and a download seed boots without it; `damaged` is an index that fails its check.
  let dictionaryState: AssetInstallState =
    initial.dictionary === 'damaged'
      ? 'verification_failed'
      : initial.dictionary === 'missing' || (initial.assets !== undefined && !localAssetsSeed)
        ? 'not_installed'
        : 'installed';
  const dictionaryInstall = createInstallMock({
    total: MOCK_DICTIONARY_DOWNLOAD_SIZE,
    noun: 'dictionary',
    extra: { kind: 'dictionary', assetId: MOCK_DICTIONARY.id },
    seed: localAssetsSeed ? undefined : initial.assets,
    onInstalled: () => {
      dictionaryState = 'installed';
    },
  });
  const installMockFor = (jobId: string) =>
    jobId.startsWith('mock-voice')
      ? voiceInstall
      : jobId.startsWith('mock-language')
        ? languageModelInstall
        : jobId.startsWith('mock-Moonshine')
          ? moonshineInstall
          : jobId.startsWith('mock-dictionary')
            ? dictionaryInstall
            : modelInstall;
  const mockWhisperModel = { ...mockWhisperIdentity, downloadSize: 483546902 + 2370 + 2203239 + 459861, installState: 'not_installed' as const };
  // The first-use gate every Whisper start has (teleprompter, recording coverage): undefined once the model is installed.
  const whisperAssetRequired = () =>
    whisperInstalled
      ? undefined
      : {
          status: 'asset_required' as const,
          model: mockWhisperIdentity,
          installState: 'not_installed' as const,
          downloadSize: mockWhisperModel.downloadSize,
          diskSize: mockWhisperModel.downloadSize,
          installPath: MOCK_ASSET_ROOT + '/whisper/faster-whisper/small',
        };
  // The Teleprompter's first-use gate, for either live engine.
  const teleprompterAssetRequired: TeleprompterAssetRequired = (engine) => {
    if (engine === 'moonshine') {
      return moonshineInstalled
        ? undefined
        : {
            status: 'asset_required',
            engine,
            model: mockMoonshineIdentity,
            installState: 'not_installed',
            downloadSize: MOONSHINE_TINY_BYTES,
            diskSize: MOONSHINE_TINY_BYTES,
            installPath: MOCK_ASSET_ROOT + '/moonshine/moonshine/tiny/quantized_26_08_21',
          };
    }
    return whisperInstalled
      ? undefined
      : {
          status: 'asset_required',
          engine,
          model: mockWhisperIdentity,
          installState: 'not_installed',
          downloadSize: mockWhisperModel.downloadSize,
          diskSize: mockWhisperModel.downloadSize,
          installPath: MOCK_ASSET_ROOT + '/whisper/faster-whisper/small',
        };
  };
  const bindings = {
    ttsCatalog: async () => ({
      catalogVersion: 1,
      provider: { id: 'piper', effectiveSource: 'repo_default' },
      voice: { id: mockVoice.id, effectiveSource: 'repo_default' },
      voices: [{ ...mockVoice, installState: ttsInstalled ? 'installed' : 'not_installed' }],
    }),
    ttsInstall: async (voiceId) => {
      if (voiceId !== mockVoice.id) throw new Error('Unknown approved TTS voice.');
      return { ...(await voiceInstall.start()), voiceId };
    },
    ttsInstallState: async (jobId) => ({ ...(await voiceInstall.state(jobId)), voiceId: mockVoice.id }),
    ttsInstallCancel: async (jobId) => ({ ...(await voiceInstall.cancel(jobId)), voiceId: mockVoice.id }),
    ttsRemove: async (voiceId) => {
      if (voiceId === mockVoice.id) ttsInstalled = false;
    },
    whisperCatalog: async () => ({
      catalogVersion: 1,
      model: { id: mockWhisperModel.id, effectiveSource: 'repo_default' },
      models: [{ ...mockWhisperModel, installState: whisperState() }],
    }),
    whisperInstall: async (modelId) => {
      if (modelId !== mockWhisperModel.id) throw new Error('Unknown approved Whisper model.');
      return { ...(await modelInstall.start()), modelId };
    },
    whisperInstallState: async (jobId) => ({ ...(await modelInstall.state(jobId)), modelId: mockWhisperModel.id }),
    whisperInstallCancel: async (jobId) => ({ ...(await modelInstall.cancel(jobId)), modelId: mockWhisperModel.id }),
    whisperRemove: async (modelId) => {
      if (modelId === mockWhisperModel.id) {
        whisperInstalled = false;
        whisperDamaged = false;
      }
    },
    assetsList: async () => {
      const item = (kind: string, kindLabel: string, model: AssetFactsSource, installState: AssetInstallState, activeJobId: string) => ({
        kind,
        kindLabel,
        id: model.id,
        displayName: model.displayName,
        version: model.version,
        publisher: model.publisher,
        license: model.license,
        licenseUrl: model.licenseUrl,
        modelCardUrl: model.modelCardUrl,
        provenanceUrl: model.provenanceUrl,
        attribution: model.attribution,
        downloadSize: model.downloadSize,
        installState,
        diskSize: kind === 'spacy' ? 15251718 : model.downloadSize,
        path: `${MOCK_ASSET_ROOT}/${kind}/${model.id}`,
        installedAt: installState === 'not_installed' ? '' : '2026-09-20T09:30:00Z',
        verifiedAt: installState === 'installed' ? '2026-09-20T09:30:00Z' : '',
        activeJobId,
      });
      const voice = item('tts', 'Preview voice', mockVoice, ttsInstalled ? 'installed' : 'not_installed', voiceInstall.activeId());
      const language = item(
        'spacy',
        'Story Bible language model',
        { ...mockLanguageModel, downloadSize: 12806118 },
        spacyInstalled ? 'installed' : 'not_installed',
        languageModelInstall.activeId(),
      );
      const model = item('whisper', 'Whisper model', mockWhisperModel, whisperState(), modelInstall.activeId());
      const dictionary = {
        ...item('dictionary', 'Dictionary', { ...MOCK_DICTIONARY, downloadSize: MOCK_DICTIONARY_DOWNLOAD_SIZE }, dictionaryState, dictionaryInstall.activeId()),
        diskSize: MOCK_DICTIONARY_DISK_SIZE,
      };
      return {
        cacheRoot: MOCK_ASSET_ROOT,
        // Only what verifies counts: a damaged asset is not one the app can use.
        totalInstalledBytes:
          (ttsInstalled ? voice.diskSize : 0) +
          (whisperInstalled && !whisperDamaged ? model.diskSize : 0) +
          (spacyInstalled ? language.diskSize : 0) +
          (dictionaryState === 'installed' ? dictionary.diskSize : 0),
        assets: [voice, model, language, dictionary],
      };
    },
    assetsInstall: async (kind, id) => {
      if (kind === 'tts' && id === mockVoice.id) return voiceInstall.start();
      if (kind === 'whisper' && id === mockWhisperModel.id) return modelInstall.start();
      if (kind === 'spacy' && id === mockLanguageModel.id) return languageModelInstall.start();
      if (kind === 'moonshine' && id === mockMoonshineIdentity.id) return moonshineInstall.start();
      if (kind === 'dictionary' && id === MOCK_DICTIONARY.id) return dictionaryInstall.start();
      throw new Error(`"${id}" is not in the approved catalog of ${kind}`);
    },
    assetsInstallState: async (jobId) => installMockFor(jobId).state(jobId),
    assetsInstallCancel: async (jobId) => installMockFor(jobId).cancel(jobId),
    assetsVerify: async (kind, id) => {
      if (kind === 'dictionary') return { kind, id, installState: dictionaryState };
      const installed = kind === 'tts' ? ttsInstalled : kind === 'spacy' ? spacyInstalled : kind === 'moonshine' ? moonshineInstalled : whisperInstalled;
      if (kind === 'whisper' && whisperDamaged) return { kind, id, installState: 'verification_failed' as const };
      return { kind, id, installState: installed ? ('installed' as const) : ('not_installed' as const) };
    },
    assetsRemove: async (kind) => {
      if (kind === 'tts') ttsInstalled = false;
      else if (kind === 'spacy') spacyInstalled = false;
      else if (kind === 'moonshine') moonshineInstalled = false;
      else if (kind === 'dictionary') dictionaryState = 'not_installed';
      else {
        whisperInstalled = false;
        whisperDamaged = false;
      }
    },
  } satisfies Partial<NarrationApi>;
  return {
    bindings,
    ttsInstalled: () => ttsInstalled,
    spacyInstalled: () => spacyInstalled,
    whisperInstalled: () => whisperInstalled,
    dictionaryState: () => dictionaryState,
    whisperAssetRequired,
    teleprompterAssetRequired,
    mockVoiceIdentity,
    mockVoice,
    mockWhisperIdentity,
    mockWhisperModel,
    mockLanguageModel,
  };
}

export type AssetsMock = ReturnType<typeof createAssetsMock>;
type TeleprompterAssetRequired = Parameters<typeof createTeleprompterMock>[0]['assetRequired'];
