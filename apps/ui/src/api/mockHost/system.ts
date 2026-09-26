// The mock host (mockApi.ts): the system bindings.
import { parseWire } from '../wire/parseWire';
import { chaptersSchema } from '../schemas/manuscript';
import { guideEntitiesSchema } from '../schemas/storyBible';
import { bootstrapSchema } from '../schemas/system';
import type { NarrationApi, TranscriptState } from '../../types';
import { DESKTOP_HOST_API_VERSION } from '../../hostApi';
import { wireClone } from '../mockFixtures';
import type { AssetInstallState } from '../contracts/assets';
import { mockDictionaryLookup } from '../dictionaryMock';
import { type MockApiSeed, type MockState, wireContext } from './state';
import type { ProjectMock } from './project';

const MOCK_AUDIO_SECONDS = 600;
let mockAudioUrl: string | undefined;

/**
 * Browser mock mode has no /media route, so play, skip, and the time readout
 * would have nothing to act on. This serves a real, silent WAV from memory
 * instead. It's built lazily and only where object URLs exist (not jsdom).
 */
function mockAudioSource(): string | undefined {
  if (typeof URL.createObjectURL !== 'function') return undefined;
  if (!mockAudioUrl) {
    const sampleRate = 8000;
    const dataBytes = sampleRate * MOCK_AUDIO_SECONDS;
    const wav = new Uint8Array(44 + dataBytes).fill(128); // unsigned 8-bit silence
    const view = new DataView(wav.buffer);
    const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, dataBytes, true);
    mockAudioUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  }
  return mockAudioUrl;
}

export /** Answers that go through the real `parseWire` with a payload of the wrong shape, so the failure screens can be seen without a host. */
function invalidPayloadOverrides(which: 'bootstrap' | 'manuscript' | 'storybible', base: NarrationApi): Partial<NarrationApi> {
  switch (which) {
    case 'bootstrap':
      return { bootstrap: async () => parseWire(bootstrapSchema, { ...(await base.bootstrap()), projectName: null }, wireContext('Bootstrap')) };
    case 'manuscript':
      return {
        manuscriptChapters: async () => parseWire(chaptersSchema, [{ id: 'c-0001', title: 'Chapter One', index: 'first' }], wireContext('ManuscriptChapters')),
      };
    case 'storybible':
      return { guideEntities: async () => parseWire(guideEntitiesSchema, [{ id: 7, canonical_name: 'Alice' }], wireContext('GuideEntities')) };
  }
}

/** The system bindings: the handshake, bootstrap, notices and job ends, diagnostics and media. */
export function createSystemMock(
  s: MockState,
  initial: MockApiSeed,
  {
    version,
    project,
    transcript,
    dictionaryState,
  }: { version: () => string; project: ProjectMock; transcript: () => TranscriptState; dictionaryState: () => AssetInstallState },
) {
  const bindings = {
    ready: async () => ({ apiVersion: DESKTOP_HOST_API_VERSION, diagnosticId: 'mock' }),
    bootstrap: async () => ({
      apiVersion: DESKTOP_HOST_API_VERSION,
      diagnosticId: 'mock',
      version: version(),
      projectFolder: project.projectFolder(),
      projectName: project.projectName(),
      daw: project.daw(),
      // Its own mutable state, not derived from `daw` (PRD W13): the real host computes this from the project's
      // manifest link, independent of the DAW label. reachable/matches stay false/unknown until Phase 6 (W14).
      dawFileLinked: project.dawFileLinked(),
      dawReachable: false,
      dawProjectMatches: false,
      manuscript:
        initial.noManuscript || initial.manuscriptCandidate
          ? null
          : {
              id: 'alice',
              format: 'docx',
              sourceName: 'Alice.docx',
              importedAt: '2026-01-01T00:00:00Z',
              narratableWordCount: 2672,
              narratableChapterCount: 3,
            },
      manuscriptCandidate: initial.manuscriptCandidate ?? null,
      runtime: {},
      transcript: wireClone(transcript()),
    }),
    reportClientDiagnostic: async () => {},
    systemNotify: async () => {},
    systemLookup: async (word) => mockDictionaryLookup(word, dictionaryState()),
    systemOpenLogFolder: async () => {},
    systemCopyDiagnostics: async () => ({ path: 'C:/Users/narrator/Documents/diagnostics-20260926T120000.jsonl' }),
    subscribeNotices: (onNotice) => {
      const text = initial.notice;
      if (!text) return () => {};
      const timer = setTimeout(() => onNotice(text), 0);
      return () => clearTimeout(timer);
    },
    subscribeJobEnded: (onEnded) => {
      s.jobEndListeners.add(onEnded);
      return () => void s.jobEndListeners.delete(onEnded);
    },
    subscribeLiveUpdateHealth: (onDegraded) => {
      if (!initial.liveUpdatesDegraded) return () => {};
      const timer = setTimeout(onDegraded, 0);
      return () => clearTimeout(timer);
    },
    mediaUrl: (sourceFile) => mockAudioSource() ?? sourceFile,
  } satisfies Partial<NarrationApi>;
  return { bindings };
}
