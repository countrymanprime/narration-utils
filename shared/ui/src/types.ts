// Compatibility barrel for existing feature imports. New API work belongs in
// api/contracts by domain so a feature can depend on its own wire contract.
export * from './api/contracts/system';
export * from './api/contracts/manuscript';
export * from './api/contracts/storyBible';
export * from './api/contracts/transcript';
export * from './api/contracts/tts';
export * from './api/contracts/whisper';
export * from './api/contracts/project';

import type { ManuscriptApi } from './api/contracts/manuscript';
import type { ProjectApi } from './api/contracts/project';
import type { StoryBibleApi } from './api/contracts/storyBible';
import type { SystemApi } from './api/contracts/system';
import type { TranscriptApi } from './api/contracts/transcript';
import type { TtsApi } from './api/contracts/tts';
import type { WhisperApi } from './api/contracts/whisper';

/** The app compatibility facade; domain interfaces remain independently testable. */
export interface NarrationApi extends SystemApi, ManuscriptApi, StoryBibleApi, TranscriptApi, TtsApi, WhisperApi, ProjectApi {}
