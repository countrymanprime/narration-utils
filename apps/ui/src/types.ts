// Compatibility barrel for existing feature imports. New API work belongs in
// api/contracts by domain so a feature can depend on its own wire contract.
export * from './api/contracts/system';
export * from './api/contracts/manuscript';
export * from './api/contracts/storyBible';
export * from './api/contracts/transcript';
export * from './api/contracts/assets';
export * from './api/contracts/tts';
export * from './api/contracts/whisper';
export * from './api/contracts/project';
export * from './api/contracts/dawCatalog';
export * from './api/contracts/tracks';
export * from './api/contracts/chapterTrackMap';
export * from './api/contracts/teleprompter';
export * from './api/contracts/update';
export * from './api/contracts/credits';
export * from './api/contracts/lineidentity';
export * from './api/contracts/pickups';
export * from './api/contracts/renderconfig';
export * from './api/contracts/chaptertags';

import type { ChapterTrackMapApi } from './api/contracts/chapterTrackMap';
import type { DawCatalogApi } from './api/contracts/dawCatalog';
import type { ManuscriptApi } from './api/contracts/manuscript';
import type { ProjectApi } from './api/contracts/project';
import type { StoryBibleApi } from './api/contracts/storyBible';
import type { SystemApi } from './api/contracts/system';
import type { TeleprompterApi } from './api/contracts/teleprompter';
import type { TracksApi } from './api/contracts/tracks';
import type { TranscriptApi } from './api/contracts/transcript';
import type { AssetsApi } from './api/contracts/assets';
import type { TtsApi } from './api/contracts/tts';
import type { UpdateApi } from './api/contracts/update';
import type { WhisperApi } from './api/contracts/whisper';
import type { CreditsApi } from './api/contracts/credits';
import type { LineIdentityApi } from './api/contracts/lineidentity';
import type { PickupsApi } from './api/contracts/pickups';
import type { RenderConfigApi } from './api/contracts/renderconfig';
import type { ChapterTagsApi } from './api/contracts/chaptertags';

/** The app compatibility facade; domain interfaces remain independently testable. */
export interface NarrationApi
  extends
    SystemApi,
    ManuscriptApi,
    StoryBibleApi,
    TranscriptApi,
    TtsApi,
    WhisperApi,
    AssetsApi,
    ProjectApi,
    DawCatalogApi,
    TracksApi,
    ChapterTrackMapApi,
    TeleprompterApi,
    UpdateApi,
    CreditsApi,
    LineIdentityApi,
    PickupsApi,
    RenderConfigApi,
    ChapterTagsApi {}
