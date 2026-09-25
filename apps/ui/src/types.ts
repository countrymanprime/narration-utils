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
export * from './api/contracts/cleanuptools';
export * from './api/contracts/projectstate';
export * from './api/contracts/retakelanes';
export * from './api/contracts/chaptertags';
export * from './api/contracts/takeReview';
export * from './api/contracts/coverage';
export * from './api/contracts/stages';
export * from './api/contracts/dictionary';
export * from './api/contracts/findings';
export * from './api/contracts/measure';
export * from './api/contracts/deliveryProfiles';
export * from './api/contracts/diagnostics';

import type { ChapterTrackMapApi } from './api/contracts/chapterTrackMap';
import type { DawCatalogApi } from './api/contracts/dawCatalog';
import type { FindingsApi } from './api/contracts/findings';
import type { ManuscriptApi } from './api/contracts/manuscript';
import type { ProjectApi } from './api/contracts/project';
import type { StoryBibleApi } from './api/contracts/storyBible';
import type { SystemApi } from './api/contracts/system';
import type { TakeReviewApi } from './api/contracts/takeReview';
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
import type { CleanupToolsApi } from './api/contracts/cleanuptools';
import type { ProjectStateApi } from './api/contracts/projectstate';
import type { RetakeLanesApi } from './api/contracts/retakelanes';
import type { ChapterTagsApi } from './api/contracts/chaptertags';
import type { CoverageApi } from './api/contracts/coverage';
import type { StagesApi } from './api/contracts/stages';
import type { DictionaryApi } from './api/contracts/dictionary';
import type { MeasureApi } from './api/contracts/measure';
import type { DeliveryProfilesApi } from './api/contracts/deliveryProfiles';
import type { DiagnosticsApi } from './api/contracts/diagnostics';

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
    CleanupToolsApi,
    ProjectStateApi,
    RetakeLanesApi,
    ChapterTagsApi,
    TakeReviewApi,
    CoverageApi,
    StagesApi,
    DictionaryApi,
    FindingsApi,
    MeasureApi,
    DeliveryProfilesApi,
    DiagnosticsApi {}
