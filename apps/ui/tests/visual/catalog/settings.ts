// The `settings` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { REFLOW, KEEPS_DESKTOP_SCROLL } from './shared';

export const settingsStates: StateEntry[] = [
  // Settings
  { page: 'settings', state: 'global-general', description: 'Settings, Global scope / General category', ...REFLOW },
  { page: 'settings', state: 'global-appearance', description: 'Settings, Global scope / Appearance category (theme switcher)', ...REFLOW },
  {
    page: 'settings',
    state: 'global-recording-check',
    description:
      'Settings, Global scope / Recording check category (ADR 0131): the four number settings at their defaults (0.8, 3, 8, 3 words; ADR 0132), under a summary that labels them uncalibrated and states the rule they make',
    ...REFLOW,
  },
  { page: 'settings', state: 'global-proofing', description: 'Settings, Global scope / Proofing category', ...REFLOW },
  { page: 'settings', state: 'global-storybible', description: 'Settings, Global scope / Story Bible category', ...REFLOW },
  {
    page: 'settings',
    state: 'global-delivery',
    description:
      'Settings, Global scope / Delivery category (ADR 0179): the default delivery profile every project without its own choice is judged against (ACX), and the profiles, the built-in one read-only with Duplicate',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'delivery-profile-editor',
    description:
      "Settings / Delivery, a duplicate of ACX open in the profile editor (mockup 06): its name, each file rule on or off, the numbers of a rule with a range beside ACX's, a changed peak marked Changed, and a fixed rule that can only be turned off",
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'global-daw',
    description:
      'Settings, Global scope / DAW Integration category, with the DAW catalog panel showing REAPER detected and a REAPER project already linked, so only the "Check again" action shows (docs/architecture/daw-integration.md)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'global-daw-not-detected',
    description:
      'Settings, Global scope / DAW Integration category with REAPER not detected (?mockDawNotDetected=1, docs/architecture/daw-integration.md): the not-detected dot and the "Get REAPER" button that opens the vendor\'s download page',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'global-daw-handoff',
    description:
      'Settings, Global scope / DAW Integration category with REAPER detected but no REAPER project linked yet (?mockNoDaw=1, docs/architecture/daw-integration.md): the "Link a REAPER project file" handoff button next to the detected entry, and the "Check again" action below it',
    ...REFLOW,
  },
  { page: 'settings', state: 'global-manuscript', description: 'Settings, Global scope / Manuscript category (note color picker)', ...REFLOW },
  {
    page: 'settings',
    state: 'global-stage-recommendations',
    description:
      'Settings, Global scope / Stage suggestions category (chapter-stage-recommendations PRD Phase 6, Q8): the master switch and the recording signal choice (required/ignored)',
    ...REFLOW,
  },
  { page: 'settings', state: 'global-tts', description: 'Settings, Global scope / TTS category', ...REFLOW },
  {
    page: 'settings',
    state: 'global-teleprompter',
    description: 'Settings, Global scope / Teleprompter category (microphone, live engine and model choice)',
    ...REFLOW,
  },
  { page: 'settings', state: 'global-about', description: 'Settings, Global scope / About and updates category (the version, nothing checked yet)', ...REFLOW },
  {
    page: 'settings',
    state: 'about-update-available',
    description: 'Settings, About and updates with a newer release found (the mock seam ?mockUpdate=available)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-check-failed',
    description: 'Settings, About and updates after a check that could not reach GitHub (?mockUpdate=failed)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-download-confirm',
    description: 'Settings, About and updates: the confirm before an update is downloaded (?mockUpdate=available)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-download-progress',
    description: 'Settings, About and updates: the update download dialog with real bytes, 40 percent and Cancel (?mockUpdate=downloading)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-download-failed',
    description: 'Settings, About and updates: the update download dialog after the checksum check failed (?mockUpdate=download-fails)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-update-ready',
    description: 'Settings, About and updates with the update downloaded and checked, ready to install (?mockUpdate=ready)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-install-confirm',
    description: 'Settings, About and updates: the confirm before the app replaces itself and restarts (?mockUpdate=ready)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-installing',
    description:
      'Settings, About and updates: the blocking dialog while the app installs the update and restarts, with the cannot-be-cancelled notice (?mockUpdate=ready)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-install-refused',
    description: 'Settings, About and updates after an install was refused because work is running (?mockUpdate=install-refused)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-install-blocked',
    description:
      'Settings, About and updates where the app may not replace itself: why, and Show the downloaded file (?mockUpdate=install-blocked, after a download)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-development-build',
    description: 'Settings, About and updates in a development build, which has no release to compare with (?mockUpdate=development)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets',
    description:
      'Settings, Global scope / Local assets category: every voice and model with its sizes, licence and state, the folder and the total on disk (the voice is not installed, the others are)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-downloading',
    description:
      'Settings, Local assets with a download that was already running when the page opened, followed through activeJobId: real bytes, 39 percent and Cancel (?mockAssets=installing)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-verifying',
    description: 'Settings, Local assets with a download at its check: a busy button, no Cancel (?mockAssets=checking)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-needs-repair',
    description: 'Settings, Local assets with a model that failed its verification: Needs repair, with Repair and Remove (?mockAssets=damaged)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-failed',
    description: 'Settings, Local assets after a download failed: the reason is written in the row and Download stays (?mockAssets=download-fails)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-remove-confirm',
    description: 'Settings, Local assets: the danger confirm before a model is removed, with what it frees and what asks again',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-recording-check',
    description:
      'Settings, Project scope / Recording check category: every setting unset in the project and inheriting its default, with the note that a blank project value uses the Global one',
    ...REFLOW,
  },
  { page: 'settings', state: 'project-proofing', description: 'Settings, Project scope / Proofing category', ...REFLOW },
  { page: 'settings', state: 'project-storybible', description: 'Settings, Project scope / Story Bible category', ...REFLOW },
  {
    page: 'settings',
    state: 'project-delivery',
    description:
      'Settings, Project scope / Delivery category (?mockDeliveryProfile=custom, mockup 05): the profile this project is judged against, and the profiles, ACX built in and a custom copy with its numbers changed and rules off, Duplicate, Edit and Delete',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-daw',
    description:
      'Settings, Project scope / DAW Integration category (PRD project-workspace-and-daw-link.prd.md W19, new: previously global-only): "REAPER project linked" and Change linked project file',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-daw-not-linked',
    description:
      'Settings, Project scope / DAW Integration category with no linked REAPER project file (?mockNoDaw=1): "No REAPER project linked" and Link a REAPER project file',
    ...REFLOW,
  },
  { page: 'settings', state: 'project-data', description: 'Settings, Project scope / Project data category (clear derived project data)', ...REFLOW },
  {
    page: 'settings',
    state: 'project-credits',
    description:
      'Settings, Project scope / Credits category (PRD audiobook-credits-templates.prd.md, Phase 1): template library, live preview and project credit values',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-credits-detected',
    description:
      'Settings, Project scope / Credits, every empty field with a manuscript-detected candidate captioned with its source (?mockCredits=detected): Title and Author from the title page, Year and Copyright holder from the copyright line, and a low-confidence Publisher marked "(check this)" (credits-token-setup-and-front-matter-detection.prd.md Phase 1)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-credits-chapter-announcement',
    description:
      'Settings, Project scope / Credits, a chapter announcement template selected (Phase 5): its body "[Chapter]{: [Chapter Title]}." previews as "Chapter 1: Down the Rabbit-Hole." with "Shown for Chapter 1, one of 12 chapters", and the kind hint names [Chapter] and [Chapter Title]',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-credits-retail-sample',
    description:
      'Settings, Project scope / Credits scrolled to Retail sample (Phase 5, C10): the saved sample "Chapter 3, line 1 to Chapter 3, line 3" with its words and length, the start and end pickers, Save sample and Clear sample',
    ...REFLOW,
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'settings',
    state: 'project-credits-retail-sample-refused',
    description:
      'Settings, Project scope / Credits, Retail sample: a range from Chapter 1 to Chapter 12 refused with "a retail sample can be at most 5 minutes; this range is ... words, about ..." and nothing saved',
    ...REFLOW,
    ...KEEPS_DESKTOP_SCROLL,
  },
  { page: 'settings', state: 'dirty-footer', description: 'Settings, unsaved-changes footer visible', ...REFLOW, ...KEEPS_DESKTOP_SCROLL },
  { page: 'settings', state: 'navigate-away-confirm', description: 'Settings, navigate-away-while-dirty confirm dialog', ...REFLOW },
  {
    page: 'settings',
    state: 'reset-override',
    description: 'Settings, reset/clear-override control on a field',
    pointer: 'keep',
    ...REFLOW,
    ...KEEPS_DESKTOP_SCROLL,
  },
];
