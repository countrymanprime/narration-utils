// The Lua files a release must carry in its embedded REAPER package (integrations/reaper, top level). The installer check
// (verify-installable.mjs) requires each one; reaper-files.test.mjs fails when this list and the folder disagree, so a new
// bridge or feature file cannot be added without being required here.
export const REAPER_FILES = [
  'NarrationUtils_Launcher.lua',
  'narration_bridge_core.lua',
  'narration_compare.lua',
  'narration_line_identity.lua',
  'narration_pickups.lua',
  'narration_ui_bridge.lua',
  'reaper_common_core.lua',
  'reaper_common_process.lua',
];
