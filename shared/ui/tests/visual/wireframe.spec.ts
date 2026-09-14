import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from '@playwright/test';
import { STATE_CATALOG } from './state-catalog';
import { VIEWPORTS } from './viewports';
import { settlePage, screenshotDir } from './helpers/settle';

// Screenshots the frozen reference wireframe (tests/visual/fixtures) into the
// same {page, state, viewport} shape as app.spec.ts, so every pair can be
// diffed against the application. Driven by calling the wireframe's own top-level functions/vars
// via page.evaluate(<string>) - a classic (non-module, non-IIFE) inline
// <script> puts its top-level `function`/`let`/`const` bindings in the page's
// global lexical scope, which page.evaluate runs in directly, so bare
// identifiers like `goTo(...)` or `manuscriptFound = false` work exactly as
// if typed into the devtools console on this page.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_URL = `file://${path.resolve(__dirname, 'fixtures/narration-console-wireframe.html').replace(/\\/g, '/')}`;

type Driver = (page: Page) => Promise<void>;

const evalJs =
  (js: string): Driver =>
  async (page) => {
    await page.evaluate(js);
  };

// Some states have no known/safe driver yet (e.g. alias-typeahead, the
// settings reset-override control) or don't exist as a concept in the
// wireframe (e.g. Manuscript's collapsible chapters, a net-new deviation).
// Those are left out here on purpose - the catalog entry is simply skipped
// for this target rather than guessed at incorrectly.
const WIREFRAME_DRIVERS: Record<string, Record<string, Driver>> = {
  home: {
    default: evalJs(`goTo('home');`),
    'manuscript-not-found': evalJs(`goTo('home'); manuscriptFound=false; renderManuscriptStatus();`),
    'chapter-table-collapsed': evalJs(`goTo('home'); chapterTableOpen=false; renderTimingPanel();`),
    'chapter-table-expanded': evalJs(`goTo('home'); chapterTableOpen=true; renderTimingPanel();`),
    // #hint-chips actually lives on the Proofing/"compare" page in the
    // wireframe (line 359), not Home - the catalog name is a holdover from
    // an earlier (wrong) read of the structure. The app puts the equivalent
    // "Vocabulary hints" widget on its Proofing setup panel too, so this is
    // the correct comparison, not a placement mismatch.
    'hint-chips': evalJs(`goTo('compare'); setPhase('setup');`),
    'info-tooltip': async (page) => {
      await page.evaluate(`goTo('home');`);
      const tip = page.locator('.tip-icon, [data-tooltip]').first();
      await tip.hover();
    },
  },
  manuscript: {
    'reader-text-small': evalJs(`goTo('manuscript'); setReaderWidth('narrow');`),
    'reader-text-medium': evalJs(`goTo('manuscript'); setReaderWidth('comfortable');`),
    'reader-text-large': evalJs(`goTo('manuscript'); setReaderWidth('wide');`),
    'chapters-overlay-open': evalJs(`goTo('manuscript'); toggleChaptersOverlay(true);`),
    'detail-sidebar-note': evalJs(`goTo('manuscript'); openDetailSidebar({type:'note', text:'Sample anchored text', note: notes[0].note});`),
    'detail-sidebar-entity': evalJs(`goTo('manuscript'); openDetailSidebar({type:'entity', entity: entities[0]});`),
    'selection-popup': async (page) => {
      await page.evaluate(`goTo('manuscript');`);
      const paragraph = page.locator('#manuscript-text p').first();
      const box = await paragraph.boundingBox();
      if (!box) return;
      await page.mouse.move(box.x + 4, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + Math.min(160, box.width - 4), box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
    },
    'overlapping-highlights': evalJs(`goTo('manuscript');`),
    'sticky-header-scrolled': async (page) => {
      await page.evaluate(`goTo('manuscript');`);
      await page.evaluate(() => document.getElementById('manuscript-reader')?.scrollBy(0, 600));
    },
  },
  proofing: {
    'setup-default': evalJs(`goTo('compare'); setPhase('setup');`),
    'setup-alt-selection': evalJs(`goTo('compare'); setPhase('setup'); onModelChange('large');`),
    running: async (page) => {
      await page.evaluate(`goTo('compare'); setPhase('setup'); startCompare();`);
      await page.waitForTimeout(800);
    },
    'results-row-expanded': evalJs(`goTo('compare'); setPhase('setup'); showResults(); toggleDiscRow(0);`),
    toast: evalJs(`goTo('compare'); toast('Sample toast message');`),
  },
  storybible: {
    'category-all': async (page) => {
      await page.evaluate(`goTo('guide');`);
      await page.click('#guide-tabs .tab-btn[data-cat="all"]');
    },
    'category-character': async (page) => {
      await page.evaluate(`goTo('guide');`);
      await page.click('#guide-tabs .tab-btn[data-cat="Character"]');
    },
    'category-place': async (page) => {
      await page.evaluate(`goTo('guide');`);
      await page.click('#guide-tabs .tab-btn[data-cat="Place"]');
    },
    'category-organization': async (page) => {
      await page.evaluate(`goTo('guide');`);
      await page.click('#guide-tabs .tab-btn[data-cat="Organization"]');
    },
    'category-needs-review': async (page) => {
      await page.evaluate(`goTo('guide');`);
      await page.click('#guide-tabs .tab-btn[data-cat="Review"]');
    },
    'entity-selected': evalJs(`goTo('guide'); activeEntity=entities[0].id; renderEntityList(); renderDetail();`),
    'delete-confirm': evalJs(`goTo('guide'); deleteEntity(entities[0].id);`),
    'entry-locked': evalJs(`goTo('guide'); activeEntity=entities[0].id; entities[0].locked=true; renderEntityList(); renderDetail();`),
    'entry-unlocked': evalJs(`goTo('guide'); activeEntity=entities[0].id; entities[0].locked=false; renderEntityList(); renderDetail();`),
  },
  settings: {
    'global-general': evalJs(`goTo('settings'); settingsScope='global'; settingsCat='general'; renderSettingsNav();`),
    'global-proofing': evalJs(`goTo('settings'); settingsScope='global'; settingsCat='proofing'; renderSettingsNav();`),
    'global-storybible': evalJs(`goTo('settings'); settingsScope='global'; settingsCat='storybible'; renderSettingsNav();`),
    'global-daw': evalJs(`goTo('settings'); settingsScope='global'; settingsCat='daw'; renderSettingsNav();`),
    'global-tts': evalJs(`goTo('settings'); settingsScope='global'; settingsCat='tts'; renderSettingsNav();`),
    'project-proofing': evalJs(`goTo('settings'); settingsScope='project'; settingsCat='proofing'; renderSettingsNav();`),
    'project-storybible': evalJs(`goTo('settings'); settingsScope='project'; settingsCat='storybible'; renderSettingsNav();`),
    'dirty-footer': evalJs(`goTo('settings'); settingsScope='global'; settingsCat='general'; dirtySettings.add(scopeKey()); renderSettingsNav();`),
    'navigate-away-confirm': evalJs(
      `goTo('settings'); settingsScope='global'; settingsCat='general'; dirtySettings.add(scopeKey()); confirmSettingsNavigation(()=>{});`,
    ),
  },
  global: {
    tooltip: async (page) => {
      await page.evaluate(`goTo('home');`);
      await page.locator('[data-tooltip]').first().hover();
    },
    toast: evalJs(`goTo('home'); toast('Sample toast message');`),
    'confirm-dialog': evalJs(`goTo('home'); showConfirm('Sample confirm','Sample body','Confirm',()=>{},false);`),
  },
};

for (const entry of STATE_CATALOG) {
  const driver = WIREFRAME_DRIVERS[entry.page]?.[entry.state];
  const title = `${entry.page} / ${entry.state} [wireframe]`;
  if (!driver) {
    test.skip(title, async () => {});
    continue;
  }

  test(title, async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(FIXTURE_URL);
      await settlePage(page);
      await driver(page);
      await page.screenshot({ path: `${screenshotDir('wireframe', entry.page, entry.state)}/${viewport.name}.png` });
    }
  });
}
