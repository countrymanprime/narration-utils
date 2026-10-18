-- Deprecated name of NarrationStudio_Launcher.lua (#1816). Narrators who loaded this file into REAPER's action list before the
-- rename keep a working action: it runs the new launcher beside it. Delete this file, and its entries in the release and smoke
-- lists, when the NarrationUtils name is retired.
local _, path = reaper.get_action_context()
local dir = path:match('^(.*)[\\/]') or '.'
return dofile(dir .. package.config:sub(1, 1) .. 'NarrationStudio_Launcher.lua')
