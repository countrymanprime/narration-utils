-- TranscriptCompare - Run
--
-- Each track is treated as one chapter. This action:
-- 1. If you have specific item(s) selected, processes exactly those (in
--    position order) - handy for testing a short clip. If no items are
--    selected but a track is, processes every item on that track instead -
--    for running a whole chapter. Either way, no gluing/rendering needed,
--    even across multiple items/punch-ins.
-- 2. Lets you browse to a Word document (.docx) anywhere on disk (or, after
--    the first run in a project, reuses the cached project manuscript). A
--    config screen before transcription starts lets you confirm/change the
--    manuscript, pick the Whisper model, and set vocabulary hints - all in
--    the same window.
-- 3. Launches the Python backend in the background (so REAPER's UI never
--    blocks) and shows one persistent, centered window from the moment the
--    action starts through the final result - a progress bar plus a
--    scrolling log of every step taken, never closed and replaced by a
--    separate dialog. Has a Cancel button while running, a Close button once
--    finished. If the track name doesn't confidently match a chapter, the
--    same window instead shows a list of detected chapters to pick from.
-- 4. Imports the results as TAKE markers (so they only show on this track's
--    items, not across the whole project), colored by discrepancy kind,
--    skipping any that duplicate a marker already there from a prior run.
-- 5. Saves a single unified-diff-formatted file (manuscript vs. what was
--    actually said) into this tool's per-project metadata folder, opened
--    on demand via the Diff tab rather than automatically.

local EXT = "TranscriptCompare"

-- NARRATION_UTILS_SCRIPT_PATH is set by NarrationUtils_Launcher.lua before
-- dofile()-ing this script: reaper.get_action_context() always reports the
-- currently-running *action*'s path, which is the launcher's own path when
-- dispatched that way, not this file's - so the launcher hands over this
-- file's real path explicitly instead.
local function own_script_path()
  return NARRATION_UTILS_SCRIPT_PATH or select(2, reaper.get_action_context())
end

local function shared_reaper_dir()
  local script_dir = own_script_path():match("^(.*)[\\/]") or "."
  return script_dir .. "\\..\\..\\..\\..\\shared\\reaper"
end

local SHARED = shared_reaper_dir()
local ok_core, common = pcall(dofile, SHARED .. "\\reaper_common_core.lua")
local ok_proc, process = pcall(dofile, SHARED .. "\\reaper_common_process.lua")
local ok_pycfg, pyconfig = pcall(dofile, SHARED .. "\\reaper_common_pyconfig.lua")
if not ok_core or not ok_proc or not ok_pycfg then
  reaper.ShowMessageBox(
    "Could not load shared library from:\n" .. SHARED ..
    "\n\nThis package's folder must stay at tools\\transcript-compare\\daws\\reaper\\ relative to shared\\reaper\\ under the repo root.",
    "Transcript Compare", 0)
  return
end

-- pythonw.exe (the windowless console host) ships alongside python.exe in
-- every standard Windows CPython install/venv - used for the manuscript
-- picker so no console flashes while it's open.
local function pythonw_for(python_exe)
  local replaced, count = python_exe:gsub("[Pp]ython%.exe$", "pythonw.exe")
  if count > 0 then return replaced end
  return python_exe
end

-- reaper.GetExtState returns a single string, not (ok, value) - the old
-- `local ok, v = reaper.GetExtState(...)` here meant v was always nil, so
-- every saved setting silently fell back to its default on every read.
-- common.get_ext uses the correct single-return form, fixing that.
local function get(key, default)
  return common.get_ext(EXT, key, default)
end

local function file_exists(path)
  return common.file_exists(path)
end

local function read_whole_file(path)
  return common.read_file(path)
end

local function msg(s)
  reaper.ShowMessageBox(s, "Transcript Compare", 0)
end

local function format_mmss(seconds)
  seconds = math.max(0, math.floor(seconds or 0))
  return string.format("%02d:%02d", seconds // 60, seconds % 60)
end

local function hex_to_native_color(hex)
  local r = tonumber(hex:sub(1, 2), 16) or 0
  local g = tonumber(hex:sub(3, 4), 16) or 0
  local b = tonumber(hex:sub(5, 6), 16) or 0
  return reaper.ColorToNative(r, g, b) | 0x1000000
end

local function dirname(path)
  return common.dirname(path, path)
end

local function sanitize_filename(s)
  return (s:gsub('[<>:"/\\|?*]', "_"))
end

local function split_pipe(s, n)
  return process.split_pipe(s, n)
end

-- Best-effort screen centering: try to center relative to REAPER's own main
-- window via SWS's Win32 wrapper (exact signature unconfirmed without a
-- live REAPER instance, hence the pcall - any mismatch just falls through
-- to a fixed reasonable default instead of erroring).
local function compute_centered_position(w, h)
  local l, t, r, b = 0, 0, 1920, 1080
  pcall(function()
    if reaper.APIExists("BR_Win32_GetWindowRect") then
      local main_hwnd = reaper.GetMainHwnd()
      local retval, rl, rt, rr, rb = reaper.BR_Win32_GetWindowRect(main_hwnd)
      if retval and rr and rl and rb and rt and rr > rl and rb > rt then
        l, t, r, b = rl, rt, rr, rb
      end
    end
  end)
  local cx = l + (r - l) / 2
  local cy = t + (b - t) / 2
  return math.floor(cx - w / 2), math.floor(cy - h / 2)
end

if not reaper.APIExists("SetTakeMarker") then
  msg("This REAPER version doesn't have SetTakeMarker - please update REAPER.")
  return
end

-- ---- scratch paths (hoisted early - launch_hidden below needs scratch_dir) ----
local scratch_dir = reaper.GetResourcePath() .. "\\TranscriptCompare"
reaper.RecursiveCreateDirectory(scratch_dir, 0)

-- ---- the current project's folder (hoisted early - settings resolution
-- below needs it to pick up any project-scoped config override) ----
-- NOTE: reaper.GetProjectPath() returns the project's *recording path*
-- (e.g. "...\Project\Audio Files"), not the folder containing the .rpp
-- file - confirmed live (the manuscript landed in Audio Files instead of
-- the project root). The actual .rpp folder comes from EnumProjects(-1),
-- which returns the current project's full save-file path.
local _, proj_fn = reaper.EnumProjects(-1, "")
local project_folder = ""
if proj_fn and proj_fn ~= "" then
  project_folder = proj_fn:match("^(.*)[\\/][^\\/]-$") or ""
end

-- Launches cmdline fully detached with NO console window ever appearing -
-- unlike `start ... /B`, which still needs a console for the cmd.exe
-- process os.execute() spawns, and with /B specifically keeps the child
-- attached to (sharing) that same console for as long as it runs, which is
-- exactly what was showing the backend's real stdout in a stray, long-lived
-- window (confirmed live). WScript.Shell.Run's hidden window style (0)
-- applies even to a newly-allocated console, so it's created hidden and
-- never shown, rather than shown and then hidden. For launching an actual
-- program (the backend, or `code --diff`) - to open a document by its
-- file association instead, use open_file_with_default_app below, since
-- WScript.Shell.Run does NOT reliably resolve those for a bare path.
local function launch_hidden(cmdline)
  return process.run_hidden(scratch_dir, cmdline, {wait = false, cwd = scratch_dir})
end

-- Opens a file with whatever's associated with its extension - like
-- double-clicking it in Explorer. WScript.Shell.Run (above) launches a
-- literal command line via CreateProcess-style resolution and does NOT
-- reliably resolve file associations for a bare document path (confirmed
-- live: a .diff path passed to launch_hidden just silently did nothing).
-- Shell.Application's ShellExecute is the actual association-aware API -
-- the same one Explorer itself uses for a double-click.
local function open_file_with_default_app(path)
  return process.open_file_with_default_app(scratch_dir, path)
end

-- ---- resolve settings (with sane fallbacks if Configure was never run) ----
local CORE = common.core_dir(own_script_path())
local python_exe = get("python_exe", CORE .. [[\.venv\Scripts\python.exe]])
local compare_script = get("compare_script", CORE .. [[\compare.py]])
local pythonw_exe = pythonw_for(python_exe)
local config_cli_path = SHARED .. "\\..\\python\\config_cli.py"
local manuscript_cli_path = SHARED .. "\\..\\python\\manuscript_cli.py"

-- python-owned settings (repo default -> global -> project, all resolved by
-- config_cli.py) - Lua only reads these, never writes them except via
-- pyconfig.set_global below for the "Save as Default" model override.
local resolved = pyconfig.query(common, process, python_exe, config_cli_path, scratch_dir, EXT,
  { "model_size", "color_misread", "color_skipped", "color_extra" }, project_folder)
local model_size = NARRATION_UTILS_HUB_MODEL_SIZE or resolved.model_size or "small" -- hub overrides are per-run only

local colors = {
  MISREAD = hex_to_native_color(resolved.color_misread or "FF4040"),
  SKIPPED = hex_to_native_color(resolved.color_skipped or "FFC000"),
  EXTRA   = hex_to_native_color(resolved.color_extra or "40A0FF"),
}

if not file_exists(python_exe) then
  msg("Python executable not found at:\n" .. python_exe ..
      "\n\nRun the 'Transcript Compare - Configure' action to point at the correct path.")
  return
end
if not file_exists(compare_script) then
  msg("compare.py not found at:\n" .. compare_script ..
      "\n\nRun the 'Transcript Compare - Configure' action to point at the correct path.")
  return
end

-- ==================== window (opened immediately, before any real work) ====================

local gfx_w, gfx_h = 640, 440
local gfx_x, gfx_y = compute_centered_position(gfx_w, gfx_h)
gfx.init("Transcript Compare", gfx_w, gfx_h, 0, gfx_x, gfx_y)
gfx.setfont(1, "Arial", 15)
gfx.setfont(2, "Courier New", 13)

local start_time = reaper.time_precise()
local log_lines = {}
local MAX_LOG_LINES = 500

local function append_log(text)
  if not text or text == "" then return end
  for line in (text .. "\n"):gmatch("(.-)\n") do
    if line ~= "" then
      log_lines[#log_lines + 1] = line
      if #log_lines > MAX_LOG_LINES then
        table.remove(log_lines, 1)
      end
    end
  end
end

local run_state = "configuring" -- "configuring" | "running" | "need_chapter" | "success" | "error" | "cancelled"
local header_text = "Preparing..."
local last_pct = 0
local finished_once = false
local frozen_elapsed = nil -- set once run_state leaves "running", so the
                            -- displayed timer stops instead of counting up
                            -- while the finished window just sits there
local marker_rows = {} -- {kind, doc_text, audio_text, project_time, item} per marker, for the table
local selected_marker_row = nil -- set when a table row is clicked - used by "Add Equiv"
local view_override = nil -- nil = automatic (table on success, log otherwise);
                           -- "log"/"table" once the user clicks a tab, taking
                           -- precedence over the automatic choice from then on
local table_scroll = 0 -- 0 = showing the tail (most recent rows); increases
                        -- as the user scrolls up toward older ones
local log_scroll = 0 -- same idea as table_scroll, for the log pane
local chapter_candidates = {} -- populated when run_state == "need_chapter"
local track_name = "" -- declared here (not just where it's resolved below)
                       -- so draw() - defined before track resolution runs -
                       -- closes over this same upvalue instead of a global
local docx_path = nil -- same reasoning - shown/changeable on the config screen
local vocab_hints = "" -- ditto - loaded/edited on the config screen
local chunk_seconds = NARRATION_UTILS_HUB_CHUNK_SECONDS or 0 -- 0 = whole file (today's behavior); reset every run,
                         -- never persisted - chunking is a deliberate
                         -- per-run choice, not a sticky default like the model
local parallel_workers = NARRATION_UTILS_HUB_WORKERS or 0 -- 0 = "Auto"; only meaningful when chunk_seconds > 0
local default_saved_flash_until = 0 -- reaper.time_precise() deadline for the
                                     -- "Saved!" flash after Save as Default
local hint_extraction = nil -- {out_path, started} while a "Suggest from
                             -- manuscript" extraction is pending; nil otherwise

local function truncate(s, n)
  if #s <= n then return s end
  return s:sub(1, n - 3) .. "..."
end

local function split_words(s)
  local words = {}
  for w in s:gmatch("%S+") do words[#words + 1] = w end
  return words
end

-- Word-level diff between two short snippets (a marker's doc_text vs.
-- audio_text - already just a handful of words) via a plain LCS, the same
-- fundamental algorithm difflib uses - no protocol change needed since
-- these strings are already whitespace-tokenizable. Returns an in-order
-- list of {text, tag}, tag one of "equal"/"del"/"add".
local function word_diff(a_text, b_text)
  local a, b = split_words(a_text), split_words(b_text)
  local n, m = #a, #b
  local dp = {}
  for i = 0, n do
    dp[i] = {}
    for j = 0, m do dp[i][j] = 0 end
  end
  for i = 1, n do
    for j = 1, m do
      if a[i] == b[j] then
        dp[i][j] = dp[i - 1][j - 1] + 1
      else
        dp[i][j] = math.max(dp[i - 1][j], dp[i][j - 1])
      end
    end
  end
  local rev, i, j = {}, n, m
  while i > 0 and j > 0 do
    if a[i] == b[j] then
      rev[#rev + 1] = { text = a[i], tag = "equal" }
      i, j = i - 1, j - 1
    elseif dp[i - 1][j] >= dp[i][j - 1] then
      rev[#rev + 1] = { text = a[i], tag = "del" }
      i = i - 1
    else
      rev[#rev + 1] = { text = b[j], tag = "add" }
      j = j - 1
    end
  end
  while i > 0 do rev[#rev + 1] = { text = a[i], tag = "del" }; i = i - 1 end
  while j > 0 do rev[#rev + 1] = { text = b[j], tag = "add" }; j = j - 1 end
  local out = {}
  for k = #rev, 1, -1 do out[#out + 1] = rev[k] end
  return out
end

-- Renders the manuscript/recorded pair as two separate columns instead of
-- one interleaved stream: the Manuscript column shows every doc word
-- (shared words in white, the word(s) that should have been said in
-- green - "correct"), the Recorded column shows every transcribed word
-- (shared words in white, the word(s) actually misspoken/extra in red -
-- "incorrect"). Both columns are built from the same word_diff() token
-- list - filtering it to equal+del reconstructs the doc side in its
-- original order, filtering to equal+add reconstructs the audio side,
-- since the LCS backtrack only advances the doc index on equal/del and
-- the audio index on equal/add. Relies on gfx.drawstr's documented
-- behavior of advancing gfx.x to just past the drawn text. Clips (stops
-- drawing) once a column's cursor passes its own right edge.
local function draw_diff_columns(doc_x, audio_x, y, doc_max_x, audio_max_x, doc_text, audio_text)
  local dx, ax = doc_x, audio_x
  for _, tok in ipairs(word_diff(doc_text, audio_text)) do
    if (tok.tag == "equal" or tok.tag == "del") and dx <= doc_max_x then
      gfx.x, gfx.y = dx, y
      gfx.set(tok.tag == "del" and 0.45 or 1, 1, tok.tag == "del" and 0.45 or 1, 1)
      gfx.drawstr(tok.text)
      dx = gfx.x + 6
    end
    if (tok.tag == "equal" or tok.tag == "add") and ax <= audio_max_x then
      gfx.x, gfx.y = ax, y
      gfx.set(1, tok.tag == "add" and 0.45 or 1, tok.tag == "add" and 0.45 or 1, 1)
      gfx.drawstr(tok.text)
      ax = gfx.x + 6
    end
  end
end

local MODEL_OPTIONS = { "tiny", "base", "small", "medium", "large-v3" }

-- Tradeoff copy shown as a hover tooltip over each model chip - "small" and
-- "medium" wording pulled from the README, tiny/base/large-v3 written fresh
-- from general faster-whisper sizing (no equivalent prior art in this repo).
local MODEL_DESCRIPTIONS = {
  ["tiny"]     = "Fastest and lightest (~75MB). Noticeably less accurate -\nexpect more missed words and misspelled names. Good for a\nquick sanity check, not a final proofread.",
  ["base"]     = "Still fast, modest accuracy gain over tiny (~150MB). A\nreasonable minimum for real proofreading on a slower machine.",
  ["small"]    = "Default. Good accuracy/speed balance for most audiobook\nnarration (~500MB).",
  ["medium"]   = "Next step up from small if accuracy still isn't good enough -\nnoticeably slower, especially on CPU (~1.5GB).",
  ["large-v3"] = "Highest accuracy, best with accents/background noise/technical\nvocabulary - but by far the slowest on CPU and uses the most\nmemory (~3GB). Best paired with a GPU or run overnight.",
}

local HINTS_DESCRIPTION =
  "Comma-separated names/terms Whisper should try to spell\nconsistently. Uses faster-whisper's 'hotwords' - biases the\nspelling of specific words, not full-sentence context like\nOpenAI's 'initial_prompt'."

local SUGGEST_HINTS_DESCRIPTION =
  "Scans the manuscript for capitalized names/terms that aren't\nsentence-initial (likely invented words or proper nouns) and\npre-fills the hint editor with them for you to review."

local SAVE_DEFAULT_MODEL_DESCRIPTION =
  "Makes the currently selected model the new default for future\nruns (persisted). Picking a chip above only affects this run."

local CHUNK_OPTIONS = {
  { label = "Whole file", seconds = 0 },
  { label = "30s", seconds = 30 },
  { label = "1m", seconds = 60 },
  { label = "5m", seconds = 300 },
  { label = "15m", seconds = 900 },
  { label = "1hr", seconds = 3600 },
}

local CHUNK_DESCRIPTION =
  "Splits the audio into pieces of this length before transcribing,\ninstead of one pass over the whole file. Reduces risk on long\nrecordings and gives finer-grained progress. Final markers are\nthe same either way - diffing still happens once, at the end."

local WORKER_OPTIONS = { 1, 2, 4, 8, "Auto" }

local WORKER_DESCRIPTION =
  "How many chunks to transcribe at once, in parallel processes.\nMore workers = faster, but each needs its own copy of the model\nin memory - 'Auto' picks a safe number based on the model size."

-- Generic hover tooltip: measures each line with gfx.measurestr (needed for
-- the proportional Arial font - the "#s*8" width used for the fixed-width
-- Courier chip labels below would be wrong here), sizes a padded box to the
-- widest line, and clamps/flips so it always stays fully inside the window.
local function draw_tooltip(x, y, text)
  local lines = {}
  for line in (text .. "\n"):gmatch("(.-)\n") do
    lines[#lines + 1] = line
  end
  if #lines == 0 then return end

  gfx.setfont(1)
  local line_h, pad = 18, 8
  local max_w = 0
  for _, l in ipairs(lines) do
    local w = gfx.measurestr(l)
    if w > max_w then max_w = w end
  end
  local box_w = max_w + pad * 2
  local box_h = #lines * line_h + pad * 2

  if x + box_w > gfx_w then x = gfx_w - box_w - 4 end
  if x < 4 then x = 4 end
  if y + box_h > gfx_h then y = y - box_h - 24 end
  if y < 4 then y = 4 end

  gfx.set(0.08, 0.08, 0.1, 0.96)
  gfx.rect(x, y, box_w, box_h, true)
  gfx.set(0.5, 0.5, 0.55, 1)
  gfx.rect(x, y, box_w, box_h, false)
  gfx.set(0.95, 0.95, 0.95, 1)
  for i, l in ipairs(lines) do
    gfx.x, gfx.y = x + pad, y + pad + (i - 1) * line_h
    gfx.drawstr(l)
  end
end

-- Shared chip-row drawer/hit-builder, used for the Model row and (below)
-- the new Chunk-duration and Worker-count rows, so the three don't each
-- duplicate the same draw+hit-test loop.
local function draw_chip_row(x_start, y, row_h, options, get_label, is_selected)
  local row_hits = {}
  local x = x_start
  for _, opt in ipairs(options) do
    local label = get_label(opt)
    local w = #label * 8 + 18
    local sel = is_selected(opt)
    gfx.set(sel and 0.3 or 0.22, sel and 0.45 or 0.22, sel and 0.3 or 0.22, 1)
    gfx.rect(x, y, w, row_h, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = x + 9, y + 5
    gfx.drawstr(label)
    row_hits[#row_hits + 1] = { x = x, y = y, w = w, h = row_h, value = opt }
    x = x + w + 6
  end
  return row_hits, x
end

-- draw() returns one table of named hit-rects ({x,y,w,h}, or a list of
-- {y,h,...} row-hits) instead of a long positional list - simpler once
-- there's more than a couple of clickable things, and every addition
-- since (the Diff tab, now the config screen and Add Equiv) would have
-- kept growing that list otherwise.
local function draw()
  gfx.set(0.12, 0.12, 0.12, 1)
  gfx.rect(0, 0, gfx_w, gfx_h, true)

  gfx.setfont(1)
  gfx.set(0.92, 0.92, 0.92, 1)
  gfx.x, gfx.y = 12, 10
  gfx.drawstr(header_text)

  if run_state == "configuring" then
    gfx.set(0.7, 0.85, 1, 1)
    gfx.x, gfx.y = 12, 36
    gfx.drawstr("Ready to check '" .. track_name .. "' - confirm settings and Start:")

    gfx.setfont(2)
    local row_h = 24
    local row_y = 68

    gfx.set(0.85, 0.85, 0.85, 1)
    gfx.x, gfx.y = 18, row_y + 4
    gfx.drawstr("Manuscript: " .. truncate(docx_path or "(none)", 58))
    local chg_w, chg_h = 84, row_h
    local chg_x, chg_y = gfx_w - chg_w - 12, row_y
    gfx.set(0.22, 0.22, 0.22, 1)
    gfx.rect(chg_x, chg_y, chg_w, chg_h, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = chg_x + 10, chg_y + 5
    gfx.drawstr("Change...")

    row_y = row_y + row_h + 16
    gfx.set(0.85, 0.85, 0.85, 1)
    gfx.x, gfx.y = 18, row_y + 4
    gfx.drawstr("Model:")
    local model_chip_hits, model_end_x = draw_chip_row(
      90, row_y, row_h, MODEL_OPTIONS,
      function(o) return o end,
      function(o) return o == model_size end
    )
    local save_default_label = (reaper.time_precise() < default_saved_flash_until) and "Saved!" or "Save as Default"
    local save_default_w = #save_default_label * 8 + 18
    local save_default_x = model_end_x + 10
    gfx.set(reaper.time_precise() < default_saved_flash_until and 0.25 or 0.22,
            reaper.time_precise() < default_saved_flash_until and 0.5 or 0.22,
            reaper.time_precise() < default_saved_flash_until and 0.3 or 0.22, 1)
    gfx.rect(save_default_x, row_y, save_default_w, row_h, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = save_default_x + 9, row_y + 5
    gfx.drawstr(save_default_label)
    local save_default_hit = { x = save_default_x, y = row_y, w = save_default_w, h = row_h }

    row_y = row_y + row_h + 16
    gfx.set(0.85, 0.85, 0.85, 1)
    gfx.x, gfx.y = 18, row_y + 4
    gfx.drawstr("Chunk:")
    local chunk_chip_hits = draw_chip_row(
      90, row_y, row_h, CHUNK_OPTIONS,
      function(o) return o.label end,
      function(o) return o.seconds == chunk_seconds end
    )

    local worker_chip_hits = nil
    if chunk_seconds > 0 then
      row_y = row_y + row_h + 16
      gfx.set(0.85, 0.85, 0.85, 1)
      gfx.x, gfx.y = 18, row_y + 4
      gfx.drawstr("Workers:")
      worker_chip_hits = draw_chip_row(
        100, row_y, row_h, WORKER_OPTIONS,
        function(o) return tostring(o) end,
        function(o)
          local sel_val = (o == "Auto") and 0 or o
          return sel_val == parallel_workers
        end
      )
    end

    row_y = row_y + row_h + 16
    local hint_w, hint_h = 110, row_h
    local hint_x, hint_y = gfx_w - hint_w - 12, row_y
    local suggest_label = hint_extraction and "Extracting..." or "Suggest..."
    local suggest_w = #suggest_label * 8 + 18
    local suggest_x, suggest_y = hint_x - suggest_w - 8, row_y
    gfx.set(0.85, 0.85, 0.85, 1)
    gfx.x, gfx.y = 18, row_y + 4
    gfx.drawstr("Hints: " .. (vocab_hints ~= "" and truncate(vocab_hints, 40) or "(none set)"))
    gfx.set(hint_extraction and 0.18 or 0.22, hint_extraction and 0.18 or 0.22, hint_extraction and 0.18 or 0.22, 1)
    gfx.rect(suggest_x, suggest_y, suggest_w, hint_h, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = suggest_x + 9, suggest_y + 5
    gfx.drawstr(suggest_label)
    gfx.set(0.22, 0.22, 0.22, 1)
    gfx.rect(hint_x, hint_y, hint_w, hint_h, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = hint_x + 8, hint_y + 5
    gfx.drawstr("Set hints...")

    row_y = row_y + row_h + 20
    gfx.set(0.55, 0.55, 0.55, 1)
    gfx.x, gfx.y = 18, row_y
    gfx.drawstr("Hints are names/terms Whisper should try to spell consistently -")
    gfx.x, gfx.y = 18, row_y + 16
    gfx.drawstr("useful for invented sci-fi/fantasy vocabulary.")

    gfx.setfont(1)
    local btn_w2, btn_h2 = 100, 30
    local btn_x2, btn_y2 = gfx_w - btn_w2 - 12, gfx_h - btn_h2 - 10
    gfx.set(0.25, 0.55, 0.3, 1)
    gfx.rect(btn_x2, btn_y2, btn_w2, btn_h2, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = btn_x2 + (btn_w2 - 5 * 8) / 2, btn_y2 + 8
    gfx.drawstr("Start")

    local cancel_w2, cancel_h2 = 100, 30
    local cancel_x2, cancel_y2 = btn_x2 - cancel_w2 - 10, btn_y2
    gfx.set(0.5, 0.2, 0.2, 1)
    gfx.rect(cancel_x2, cancel_y2, cancel_w2, cancel_h2, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = cancel_x2 + (cancel_w2 - 6 * 8) / 2, cancel_y2 + 8
    gfx.drawstr("Cancel")

    return {
      button = { x = btn_x2, y = btn_y2, w = btn_w2, h = btn_h2 },
      cancel_config = { x = cancel_x2, y = cancel_y2, w = cancel_w2, h = cancel_h2 },
      change_manuscript = { x = chg_x, y = chg_y, w = chg_w, h = chg_h },
      model_chips = model_chip_hits,
      save_default_model = save_default_hit,
      chunk_chips = chunk_chip_hits,
      worker_chips = worker_chip_hits,
      set_hints = { x = hint_x, y = hint_y, w = hint_w, h = hint_h },
      suggest_hints = { x = suggest_x, y = suggest_y, w = suggest_w, h = hint_h },
    }
  end

  if run_state == "need_chapter" then
    gfx.set(0.85, 0.75, 0.4, 1)
    gfx.x, gfx.y = 12, 36
    gfx.drawstr("Couldn't confidently match the track name to a chapter - pick one:")

    local row_y, row_h = 66, 24
    local chapter_row_hits = {}
    gfx.setfont(2)
    for i, title in ipairs(chapter_candidates) do
      local ry = row_y + (i - 1) * (row_h + 4)
      gfx.set(0.18, 0.18, 0.18, 1)
      gfx.rect(12, ry, gfx_w - 24, row_h, true)
      gfx.set(0.9, 0.9, 0.9, 1)
      gfx.x, gfx.y = 20, ry + 5
      gfx.drawstr(truncate(title, 80))
      chapter_row_hits[#chapter_row_hits + 1] = { y = ry, h = row_h, title = title }
    end
    gfx.setfont(1)

    local btn_w2, btn_h2 = 100, 30
    local btn_x2, btn_y2 = gfx_w - btn_w2 - 12, gfx_h - btn_h2 - 10
    gfx.set(0.25, 0.45, 0.25, 1)
    gfx.rect(btn_x2, btn_y2, btn_w2, btn_h2, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = btn_x2 + (btn_w2 - 5 * 8) / 2, btn_y2 + 8
    gfx.drawstr("Close")

    return {
      button = { x = btn_x2, y = btn_y2, w = btn_w2, h = btn_h2 },
      chapter_rows = chapter_row_hits,
    }
  end

  local bar_x, bar_y, bar_w, bar_h = 12, 36, gfx_w - 24, 22
  local status_bottom = bar_y -- if the bar is hidden (not running), it takes up no height

  if run_state == "running" then
    gfx.set(0.3, 0.3, 0.3, 1)
    gfx.rect(bar_x, bar_y, bar_w, bar_h, true)
    local pct = math.max(0, math.min(100, last_pct))
    local fill_w = math.floor(bar_w * (pct / 100))
    gfx.set(0.25, 0.6, 0.9, 1)
    gfx.rect(bar_x, bar_y, fill_w, bar_h, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = bar_x + 8, bar_y + 3
    gfx.drawstr(pct .. "%")
    status_bottom = bar_y + bar_h
  end
  -- once finished, no bar-shaped element is drawn at all (a static "100%"-
  -- looking box left over after completion read as a stale progress bar) -
  -- the outcome shows instead as a compact label next to the elapsed time.

  local elapsed = math.floor(frozen_elapsed or (reaper.time_precise() - start_time))
  gfx.set(0.7, 0.7, 0.7, 1)
  gfx.x, gfx.y = 12, status_bottom + 8
  gfx.drawstr(string.format("Elapsed: %02d:%02d", elapsed // 60, elapsed % 60))

  if run_state ~= "running" then
    local banner_colors = {
      success = { 0.4, 0.9, 0.4 },
      error = { 1, 0.4, 0.4 },
      cancelled = { 0.9, 0.85, 0.4 },
    }
    local banner_labels = {
      success = "DONE",
      error = "ERROR",
      cancelled = "CANCELLED",
    }
    local c = banner_colors[run_state] or { 0.8, 0.8, 0.8 }
    gfx.set(c[1], c[2], c[3], 1)
    gfx.x = gfx.x + 14
    gfx.drawstr(banner_labels[run_state] or run_state)
  end

  -- Log / Table / Diff / Add Equiv tab bar, then the scrolling log pane or
  -- marker table below it
  local tab_y = status_bottom + 28
  local tab_h = 20
  local tab1_x, tab1_w = 12, 50
  local tab2_x, tab2_w = tab1_x + tab1_w + 6, 60
  local tab3_x, tab3_w = tab2_x + tab2_w + 6, 50
  local tab4_x, tab4_w = tab3_x + tab3_w + 6, 80
  local log_y = tab_y + tab_h + 6
  local btn_w, btn_h = 100, 30
  local log_h = gfx_h - log_y - btn_h - 20

  local auto_view = (run_state == "success") and "table" or "log"
  local effective_view = view_override or auto_view
  local table_row_hits = nil

  local function draw_tab(x, w, label, active)
    if active then
      gfx.set(0.3, 0.45, 0.3, 1)
    else
      gfx.set(0.18, 0.18, 0.18, 1)
    end
    gfx.rect(x, tab_y, w, tab_h, true)
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = x + 8, tab_y + 3
    gfx.drawstr(label)
  end
  draw_tab(tab1_x, tab1_w, "Log", effective_view == "log")
  draw_tab(tab2_x, tab2_w, "Table", effective_view == "table")
  draw_tab(tab3_x, tab3_w, "Diff", false) -- action buttons, not persistent views - never "active"
  draw_tab(tab4_x, tab4_w, "Add Equiv", false)

  gfx.set(0, 0, 0, 1)
  gfx.rect(12, log_y, gfx_w - 24, log_h, true)

  gfx.setfont(2)
  local line_h = 16
  local max_lines = math.floor(log_h / line_h) - 1

  if effective_view == "table" and #marker_rows > 0 then
    -- Track | Time | Type | Manuscript | Recorded, all in white - kind is
    -- still visible via the Type column text and the per-word green/red
    -- coloring in the Manuscript/Recorded columns themselves.
    local col_track, col_time, col_kind, col_doc, col_audio = 18, 88, 138, 203, 418

    gfx.set(1, 1, 1, 1)
    local ly = log_y + 4
    gfx.x, gfx.y = col_track, ly; gfx.drawstr("Track")
    gfx.x, gfx.y = col_time, ly; gfx.drawstr("Time")
    gfx.x, gfx.y = col_kind, ly; gfx.drawstr("Type")
    gfx.x, gfx.y = col_doc, ly; gfx.drawstr("Manuscript")
    gfx.x, gfx.y = col_audio, ly; gfx.drawstr("Recorded")
    ly = ly + line_h + 2

    local rows_max = math.max(0, max_lines - 1)
    local max_scroll = math.max(0, #marker_rows - rows_max)
    table_scroll = math.max(0, math.min(table_scroll, max_scroll))
    local start_idx = math.max(1, #marker_rows - rows_max + 1 - table_scroll)
    local end_idx = math.min(#marker_rows, start_idx + rows_max - 1)

    table_row_hits = {}
    for i = start_idx, end_idx do
      local row = marker_rows[i]
      if row then
        if row == selected_marker_row then
          gfx.set(0.22, 0.22, 0.3, 1)
          gfx.rect(12, ly - 1, gfx_w - 24, line_h, true)
        end
        gfx.set(1, 1, 1, 1)
        gfx.x, gfx.y = col_track, ly; gfx.drawstr(truncate(track_name, 11))
        gfx.x, gfx.y = col_time, ly; gfx.drawstr(format_mmss(row.project_time))
        gfx.x, gfx.y = col_kind, ly; gfx.drawstr(row.kind)
        draw_diff_columns(col_doc, col_audio, ly, col_audio - 8, gfx_w - 12, row.doc_text, row.audio_text)
        table_row_hits[#table_row_hits + 1] = { y = ly, h = line_h, row = row }
        ly = ly + line_h
      end
    end
  elseif effective_view == "table" then
    gfx.set(1, 1, 1, 1)
    gfx.x, gfx.y = 18, log_y + 4
    gfx.drawstr(run_state == "success" and "No discrepancies found." or "No marker data yet.")
  else
    local rows_max = math.max(0, max_lines)
    local max_log_scroll = math.max(0, #log_lines - rows_max)
    log_scroll = math.max(0, math.min(log_scroll, max_log_scroll))
    local start_idx = math.max(1, #log_lines - rows_max + 1 - log_scroll)
    local end_idx = math.min(#log_lines, start_idx + rows_max - 1)
    gfx.set(1, 1, 1, 1)
    local ly = log_y + 4
    for i = start_idx, end_idx do
      gfx.x, gfx.y = 18, ly
      gfx.drawstr(truncate(log_lines[i], 96))
      ly = ly + line_h
    end
  end
  gfx.setfont(1)

  local btn_x, btn_y = gfx_w - btn_w - 12, gfx_h - btn_h - 10
  local label = (run_state == "running") and "Cancel" or "Close"
  local btn_color = (run_state == "running") and { 0.5, 0.2, 0.2 } or { 0.25, 0.45, 0.25 }
  gfx.set(btn_color[1], btn_color[2], btn_color[3], 1)
  gfx.rect(btn_x, btn_y, btn_w, btn_h, true)
  gfx.set(1, 1, 1, 1)
  gfx.x, gfx.y = btn_x + (btn_w - #label * 8) / 2, btn_y + 8
  gfx.drawstr(label)

  return {
    button = { x = btn_x, y = btn_y, w = btn_w, h = btn_h },
    tab_log = { x = tab1_x, y = tab_y, w = tab1_w, h = tab_h },
    tab_table = { x = tab2_x, y = tab_y, w = tab2_w, h = tab_h },
    tab_diff = { x = tab3_x, y = tab_y, w = tab3_w, h = tab_h },
    tab_addequiv = { x = tab4_x, y = tab_y, w = tab4_w, h = tab_h },
    table_rows = table_row_hits,
  }
end

local function refresh(status_text)
  if status_text then header_text = status_text end
  draw()
  gfx.update()
end

refresh("Preparing...")
append_log("Starting Transcript Compare.")

-- ---- figure out which items to process ----
-- Prefer an explicit item selection (e.g. testing a short clip). Only fall
-- back to "every item on the track" when nothing is selected - REAPER
-- selects a track just by clicking an item on it, so track-selection alone
-- isn't a reliable signal that "the whole track" was intended.
refresh("Checking selected item(s)/track...")

local track = nil
local raw_items = {}
local skipped_other_track = 0

local sel_item_count = reaper.CountSelectedMediaItems(0)
if sel_item_count > 0 then
  track = reaper.GetMediaItem_Track(reaper.GetSelectedMediaItem(0, 0))
  for i = 0, sel_item_count - 1 do
    local it = reaper.GetSelectedMediaItem(0, i)
    if reaper.GetMediaItem_Track(it) == track then
      raw_items[#raw_items + 1] = { item = it, pos = reaper.GetMediaItemInfo_Value(it, "D_POSITION") }
    else
      skipped_other_track = skipped_other_track + 1
    end
  end
elseif reaper.CountSelectedTracks(0) > 0 then
  track = reaper.GetSelectedTrack(0, 0)
  local item_count = reaper.CountTrackMediaItems(track)
  for i = 0, item_count - 1 do
    local item = reaper.GetTrackMediaItem(track, i)
    raw_items[#raw_items + 1] = { item = item, pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION") }
  end
else
  gfx.quit()
  msg("Select the item(s) you want to check, or select the whole track to process every item on it, then run this action again.")
  return
end

local track_name_ok
track_name_ok, track_name = reaper.GetTrackName(track)

if #raw_items == 0 then
  gfx.quit()
  msg("The selected track ('" .. track_name .. "') has no items.")
  return
end

table.sort(raw_items, function(a, b) return a.pos < b.pos end)

-- items_by_index[manifest_index] = { item, take, pos, startoffs, playrate }
-- (manifest_index is 0-based to match what the Python side echoes back;
-- pos/startoffs/playrate let a marker's srcpos be converted to a project-
-- timeline position later, for jumping to it from the table.)
local items_by_index = {}
local manifest_lines = {}
local skipped_midi = 0
local total_selected_length = 0.0

for _, entry in ipairs(raw_items) do
  local item = entry.item
  local take = reaper.GetActiveTake(item)
  if take and not reaper.TakeIsMIDI(take) then
    local source = reaper.GetMediaItemTake_Source(take)
    local source_file = reaper.GetMediaSourceFileName(source, "")
    local start_offs = reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS")
    local playrate = reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE")
    if playrate == 0 then playrate = 1 end
    local item_len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
    local src_len = item_len * playrate

    if source_file ~= "" then
      local idx = #manifest_lines -- 0-based
      items_by_index[idx] = { item = item, take = take, pos = entry.pos, startoffs = start_offs, playrate = playrate }
      manifest_lines[#manifest_lines + 1] = string.format(
        "%d|%s|%.6f|%.6f", idx, source_file, start_offs, src_len
      )
      total_selected_length = total_selected_length + src_len
    end
  else
    skipped_midi = skipped_midi + 1
  end
end

if #manifest_lines == 0 then
  gfx.quit()
  msg("No audio items with resolvable source files were found on track '" .. track_name .. "'.")
  return
end

header_text = "Track: " .. track_name .. "  (" .. #manifest_lines .. " item(s), "
  .. format_mmss(total_selected_length) .. " selected)"
append_log(header_text)
refresh()

-- ---- resolve the project's manuscript ----
-- Selected once per project, then copied to <project folder>\Manuscript.docx
-- so it's reused automatically on later runs without prompting again. Use
-- the config screen's "Change..." button (or the shared "Select
-- Manuscript" launcher entry) to change it later. project_folder was
-- already resolved above (settings resolution needs it too).

-- Browses for a manuscript and (if the project is saved) copies it to
-- <project folder>\Manuscript.docx via the shared Python picker; returns
-- the resulting path, or nil if cancelled/failed. Shared by the initial
-- resolution below and the config screen's "Change..." button.
local function pick_new_manuscript()
  local result = pyconfig.pick_manuscript(common, process, pythonw_exe, manuscript_cli_path, scratch_dir, project_folder)
  if result == "" or result == "CANCELLED" then return nil end
  if project_folder ~= "" then
    local manuscript_path = project_folder .. "\\Manuscript.docx"
    append_log("Manuscript saved to: " .. manuscript_path)
    return manuscript_path
  else
    append_log("Using manuscript (project not saved, won't be cached): " .. result)
    return result
  end
end

if project_folder ~= "" then
  local manuscript_path = project_folder .. "\\Manuscript.docx"
  if file_exists(manuscript_path) then
    docx_path = manuscript_path
    append_log("Using project manuscript: " .. manuscript_path)
    refresh("Using cached project manuscript...")
  else
    refresh("Waiting for you to pick the project's manuscript (.docx)...")
    append_log("No cached manuscript for this project - prompting for one...")
    docx_path = pick_new_manuscript()
    if not docx_path then gfx.quit(); return end
  end
else
  refresh("Waiting for you to pick the manuscript (.docx)...")
  append_log("Project isn't saved yet, so nothing to cache - prompting for a manuscript...")
  docx_path = pick_new_manuscript()
  if not docx_path then gfx.quit(); return end
end

refresh(header_text)

-- ---- this tool's per-project metadata (diff output, custom word
-- equivalences, vocabulary hints) - derived from the manuscript's own
-- folder by convention, the same way compare.py derives it from --docx,
-- so there's no extra path to plumb through as an argument. Recomputed
-- whenever the manuscript changes (the config screen's "Change..."
-- button), since for an unsaved project that can mean a different folder
-- entirely. ----
local tc_data_dir, diffs_dir, equivalences_path, vocab_hints_path, diff_path

-- reaper.EnumerateFiles(path, index) returns the filename at that index (no
-- path), or "" once exhausted - standard but unconfirmed against a live
-- instance here; a signature surprise just yields run number 1, not a crash.
local function next_run_number(dir, prefix)
  local max_n = 0
  local i = 0
  local escaped_prefix = prefix:gsub("%p", "%%%1")
  while true do
    local ok, fn = pcall(reaper.EnumerateFiles, dir, i)
    if not ok or type(fn) ~= "string" or fn == "" then break end
    local n = tonumber(fn:match("^" .. escaped_prefix .. "_(%d+)%.diff$"))
    if n and n > max_n then max_n = n end
    i = i + 1
  end
  return max_n + 1
end

local function recompute_data_paths()
  tc_data_dir = dirname(docx_path) .. "\\TranscriptCompare"
  reaper.RecursiveCreateDirectory(tc_data_dir, 0)
  diffs_dir = tc_data_dir .. "\\diffs"
  reaper.RecursiveCreateDirectory(diffs_dir, 0)
  equivalences_path = tc_data_dir .. "\\equivalences.csv"
  vocab_hints_path = tc_data_dir .. "\\vocabulary_hints.txt"
  vocab_hints = file_exists(vocab_hints_path) and (read_whole_file(vocab_hints_path):gsub("%s+$", "")) or ""
  local safe_track_name = sanitize_filename(track_name)
  diff_path = string.format("%s\\%s_%d.diff", diffs_dir, safe_track_name, next_run_number(diffs_dir, safe_track_name))
end

recompute_data_paths()

-- Opens the native "set vocabulary hints" dialog and saves the result to
-- vocab_hints_path immediately, so compare.py (which reads that file
-- fresh on its next run) picks it up without any other plumbing. An
-- optional prefill_terms list (from "Suggest from manuscript") is merged
-- into whatever's already typed, deduped, rather than silently replacing it.
local function edit_vocab_hints(prefill_terms)
  local initial = vocab_hints
  if prefill_terms and #prefill_terms > 0 then
    local existing = {}
    for term in (vocab_hints .. ","):gmatch("(.-),") do
      local t = term:match("^%s*(.-)%s*$")
      if t ~= "" then existing[t:lower()] = true end
    end
    local merged = vocab_hints
    for _, term in ipairs(prefill_terms) do
      if not existing[term:lower()] then
        merged = (merged ~= "" and (merged .. ", ") or "") .. term
        existing[term:lower()] = true
      end
    end
    initial = merged
  end

  local ok, entered = reaper.GetUserInputs(
    "Vocabulary Hints", 1,
    "Names/terms Whisper should spell consistently (comma-separated):,extrawidth=250",
    initial
  )
  if not ok then return end
  vocab_hints = entered
  reaper.RecursiveCreateDirectory(tc_data_dir, 0)
  local f = io.open(vocab_hints_path, "w")
  if f then
    f:write(vocab_hints)
    f:close()
    append_log("Vocabulary hints saved.")
  end
end

local HINT_EXTRACTION_TIMEOUT_SECONDS = 20

-- Launches compare.py's fast, model-free --extract-hints mode detached (the
-- same launch_hidden()+poll-a-file idiom used for the real backend run) -
-- never a blocking call, since REAPER's Lua runs on the main UI thread and
-- a blocking call here would freeze all of REAPER, not just this window,
-- for however long Python startup + docx parsing takes.
local function start_hint_extraction()
  if hint_extraction or not docx_path then return end
  local out_path_hints = scratch_dir .. "\\hints_" .. tostring(reaper.time_precise()):gsub("[%.]", "") .. ".txt"
  local cmd = string.format(
    '"%s" "%s" --docx "%s" --extract-hints --hints-out "%s"',
    python_exe, compare_script, docx_path, out_path_hints
  )
  if not launch_hidden(cmd) then
    append_log("Couldn't launch manuscript hint extraction.")
    return
  end
  hint_extraction = { out_path = out_path_hints, started = reaper.time_precise() }
  append_log("Extracting hint suggestions from the manuscript...")
end

-- Polled every tick (see the main poll loop below) while a suggestion
-- request is pending.
local function poll_hint_extraction()
  if not hint_extraction then return end
  if not file_exists(hint_extraction.out_path) then
    if reaper.time_precise() - hint_extraction.started > HINT_EXTRACTION_TIMEOUT_SECONDS then
      append_log("Manuscript hint extraction timed out.")
      hint_extraction = nil
    end
    return
  end
  local content = read_whole_file(hint_extraction.out_path):gsub("%s+$", "")
  hint_extraction = nil
  local terms_csv = content:match("^OK|(.*)$")
  if not terms_csv then
    append_log("Manuscript hint extraction failed.")
    return
  end
  local terms = {}
  for term in (terms_csv .. ","):gmatch("(.-),") do
    local t = term:match("^%s*(.-)%s*$")
    if t ~= "" then terms[#terms + 1] = t end
  end
  if #terms == 0 then
    append_log("No suggested hint terms found in the manuscript.")
    return
  end
  append_log("Found " .. #terms .. " suggested hint term(s) from the manuscript.")
  edit_vocab_hints(terms)
end

-- ---- mutable per-attempt state (reassigned, not re-declared, by
-- start_backend_run below - so a chapter-reselect retry can start a fresh
-- backend run while everything else keeps seeing the updated values) ----
local run_id, manifest_path, out_path, progress_path, cancel_path, log_path
local last_stage, seen_any_progress, log_bytes_read = nil, false, 0

-- Writes the manifest, launches the backend (optionally forcing a specific
-- chapter, once the user has picked one from a NEED_CHAPTER prompt), and
-- resets the poll-loop state for a fresh attempt. Callable more than once -
-- the initial Start click and any chapter-reselect retry both go through
-- this.
local function start_backend_run(chapter_title_override)
  run_id = tostring(reaper.time_precise()):gsub("[%.]", "")
  manifest_path = scratch_dir .. "\\manifest_" .. run_id .. ".txt"
  out_path = scratch_dir .. "\\results_" .. run_id .. ".txt"
  progress_path = scratch_dir .. "\\progress_" .. run_id .. ".txt"
  cancel_path = progress_path .. ".cancel"
  log_path = scratch_dir .. "\\log_" .. run_id .. ".txt"

  local mf = io.open(manifest_path, "w")
  if not mf then
    run_state = "error"
    append_log("Couldn't write manifest file to: " .. manifest_path)
    return false
  end
  mf:write(table.concat(manifest_lines, "\n") .. "\n")
  mf:close()
  append_log("Manifest written: " .. #manifest_lines .. " item(s).")

  local extra_args = ""
  if chapter_title_override then
    extra_args = extra_args .. string.format(' --chapter-title "%s"', chapter_title_override)
  end
  if chunk_seconds > 0 then
    extra_args = extra_args .. string.format(' --chunk-seconds %d --parallel-workers %d', chunk_seconds, parallel_workers)
  end

  append_log("Launching backend (model: " .. model_size ..
    (chunk_seconds > 0 and (", chunked " .. chunk_seconds .. "s") or "") .. ")...")
  local backend_cmd = string.format(
    '"%s" "%s" --manifest "%s" --docx "%s" --track-name "%s" --out "%s" --diff-out "%s" --model %s --progress "%s" --log "%s"%s',
    python_exe, compare_script, manifest_path, docx_path, track_name, out_path, diff_path, model_size, progress_path, log_path, extra_args
  )
  if not launch_hidden(backend_cmd) then
    run_state = "error"
    append_log("Failed to launch the backend process.")
    return false
  end
  append_log("Backend launched.")

  run_state = "running"
  finished_once = false
  last_stage = nil
  seen_any_progress = false
  log_bytes_read = 0
  frozen_elapsed = nil
  table_scroll = 0
  log_scroll = 0
  start_time = reaper.time_precise()
  return true
end

-- run_state starts as "configuring" - the poll loop below renders that
-- screen and waits for a Start click before the first start_backend_run.

-- ==================== poll loop ====================

local TIMEOUT_SECONDS = 1800
local EARLY_CRASH_GRACE_SECONDS = 10

local mouse_was_down = false
local window_open = true

local function request_cancel()
  local cf = io.open(cancel_path, "w")
  if cf then cf:write("cancel") cf:close() end
end

local function read_progress()
  if not progress_path then return end -- nothing launched yet (still configuring)
  local content = read_whole_file(progress_path)
  if content == "" then return end
  local last_line = nil
  for line in content:gmatch("[^\r\n]+") do
    last_line = line
  end
  if not last_line then return end
  local stage, pct, message = last_line:match("^([A-Z_]+)|(%-?%d+)|(.*)$")
  if stage then
    last_stage = stage
    last_pct = tonumber(pct) or last_pct
    if message and message ~= "" and message ~= header_text then
      header_text = message
    end
    seen_any_progress = true
  end
end

local function tail_log()
  if not log_path then return end -- nothing launched yet (still configuring)
  local f = io.open(log_path, "r")
  if not f then return end
  f:seek("set", log_bytes_read)
  local new_content = f:read("*a") or ""
  local new_size = f:seek("end")
  f:close()
  log_bytes_read = new_size or log_bytes_read
  append_log(new_content)
end

local function peek_out_tag(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local first = f:read("*l")
  f:close()
  return first and first:match("^([A-Z_]+)|")
end

local function handle_need_chapter()
  if finished_once then return end
  finished_once = true
  local content = read_whole_file(out_path)
  local rest = content:match("^NEED_CHAPTER|(.*)$") or ""
  chapter_candidates = {}
  for title in (rest .. "|"):gmatch("(.-)|") do
    if title ~= "" then chapter_candidates[#chapter_candidates + 1] = title end
  end
  append_log("No confident chapter match - pick one from the list above.")
  run_state = "need_chapter"
end

-- Duplicate-marker detection: a take marker with the same name at
-- essentially the same position already existing (from a prior run on this
-- same track/audio) is skipped rather than re-added. Cached per-take so
-- each take's existing markers are only enumerated once per run, and built
-- from markers that existed *before* this run's own additions, so it can't
-- self-collide.
local existing_markers_cache = {}
local DUPLICATE_TOLERANCE_SECONDS = 0.15

local function get_existing_markers(take)
  local cached = existing_markers_cache[take]
  if cached then return cached end
  local list = {}
  local ok, n = pcall(reaper.GetNumTakeMarkers, take)
  if ok and n then
    for i = 0, n - 1 do
      local ok2, srcpos, name = pcall(reaper.GetTakeMarker, take, i)
      if ok2 and type(srcpos) == "number" then
        list[#list + 1] = { srcpos = srcpos, name = name }
      end
    end
  end
  existing_markers_cache[take] = list
  return list
end

local function is_duplicate_marker(take, name, srcpos)
  for _, m in ipairs(get_existing_markers(take)) do
    if m.name == name and math.abs(m.srcpos - srcpos) <= DUPLICATE_TOLERANCE_SECONDS then
      return true
    end
  end
  return false
end

local function jump_to_marker_row(row)
  if not row or not row.item then return end
  reaper.SelectAllMediaItems(0, false)
  reaper.SetMediaItemSelected(row.item, true)
  if row.project_time then
    reaper.SetEditCurPos(row.project_time, true, false)
  end
  reaper.UpdateArrange()
end

local function import_results_once()
  if finished_once then return end
  finished_once = true

  local f = io.open(out_path, "r")
  if not f then
    append_log("Backend finished but no output file was found: " .. out_path)
    return
  end

  local summary = nil
  local marker_count = 0
  local skipped_bad_index = 0
  local skipped_duplicate = 0

  for line in f:lines() do
    local tag, rest = line:match("^([A-Z_]+)|(.*)$")
    if tag == "SUMMARY" then
      summary = rest
    elseif tag == "MARKER" then
      -- item_index|srcpos|kind|name|doc_text|audio_text
      local fields = split_pipe(rest, 6)
      local item_index = tonumber(fields[1])
      local srcpos = tonumber(fields[2])
      local kind = fields[3]
      local name = fields[4]
      local doc_text = fields[5] or ""
      local audio_text = fields[6] or ""
      local entry = item_index and items_by_index[item_index]
      if entry and srcpos then
        if is_duplicate_marker(entry.take, name, srcpos) then
          skipped_duplicate = skipped_duplicate + 1
        else
          local color = colors[kind] or 0
          reaper.SetTakeMarker(entry.take, -1, name, srcpos, color)
          marker_count = marker_count + 1
          local project_time = entry.pos + (srcpos - entry.startoffs) / entry.playrate
          marker_rows[#marker_rows + 1] = {
            kind = kind, doc_text = doc_text, audio_text = audio_text,
            project_time = project_time, item = entry.item,
          }
        end
      else
        skipped_bad_index = skipped_bad_index + 1
      end
    end
  end
  f:close()

  reaper.UpdateArrange()
  reaper.Undo_OnStateChange("Transcript Compare: import take markers")

  if file_exists(diff_path) then
    append_log("Diff saved to: " .. diff_path .. " (click the Diff tab to open it)")
  end

  if summary then append_log(summary) end
  append_log(marker_count .. " take marker(s) imported.")
  if skipped_duplicate > 0 then
    append_log(skipped_duplicate .. " duplicate marker(s) already present were skipped.")
  end
  if skipped_midi > 0 then
    append_log(skipped_midi .. " MIDI item(s) on the track were skipped.")
  end
  if skipped_other_track > 0 then
    append_log(skipped_other_track .. " selected item(s) on other track(s) were ignored.")
  end
  if skipped_bad_index > 0 then
    append_log(skipped_bad_index .. " marker(s) referenced an unknown item and were skipped.")
  end
end

-- Opens the diff, on demand (the Diff tab), rather than automatically at
-- the end of every run. compare.py writes a plain manuscript/recorded
-- text-file pair alongside diff_path (same basename,
-- .manuscript.txt/.recorded.txt) - try a real interactive two-pane diff
-- view with those first (silently does nothing if the `code` CLI isn't
-- resolvable), then also open the standalone .diff file with whatever's
-- associated with it, since a standalone .diff file opened as a document
-- is only ever syntax-highlighted text, never an actual diff *view*.
local function open_diff()
  if not diff_path or not file_exists(diff_path) then
    append_log("No diff file yet - run to completion first.")
    return
  end
  local doc_txt_path = diff_path:gsub("%.diff$", ".manuscript.txt")
  local audio_txt_path = diff_path:gsub("%.diff$", ".recorded.txt")
  if file_exists(doc_txt_path) and file_exists(audio_txt_path) then
    launch_hidden(string.format('code --diff "%s" "%s"', doc_txt_path, audio_txt_path))
  end
  open_file_with_default_app(diff_path)
end

-- Appends the selected table row's doc/audio words to the per-manuscript
-- equivalence list, so this specific spelling variance is never flagged
-- again (takes effect starting with the next run). Restricted to single-
-- word MISREAD rows since the matching mechanism is per-token - a multi-
-- word phrase pair wouldn't actually match anything through compare.py's
-- per-word lookup, so silently accepting one would be a dead end.
local function add_equivalence_from_selected()
  if not selected_marker_row then
    append_log("Select a MISREAD row in the table first.")
    return
  end
  local row = selected_marker_row
  if row.kind ~= "MISREAD" or row.doc_text == "" or row.audio_text == ""
     or row.doc_text:find("%s") or row.audio_text:find("%s") then
    append_log("That row isn't a single-word substitution - add it manually to:\n" .. equivalences_path)
    return
  end
  if not file_exists(equivalences_path) then
    reaper.RecursiveCreateDirectory(tc_data_dir, 0)
    local hf = io.open(equivalences_path, "w")
    if hf then
      hf:write("# Transcript Compare - custom word equivalences\n")
      hf:write("# One line per group of words/names to always treat as identical - comma-separated.\n")
      hf:close()
    end
  end
  local f = io.open(equivalences_path, "a")
  if not f then
    append_log("Couldn't write to " .. equivalences_path)
    return
  end
  f:write(row.doc_text .. ", " .. row.audio_text .. "\n")
  f:close()
  append_log("Added equivalence: " .. row.doc_text .. " = " .. row.audio_text .. " (takes effect next run)")
end

local function tick()
  read_progress()
  tail_log()
  poll_hint_extraction()

  local hits = { button = nil }

  local function hit(rect)
    if not rect then return false end
    return gfx.mouse_x >= rect.x and gfx.mouse_x <= rect.x + rect.w
       and gfx.mouse_y >= rect.y and gfx.mouse_y <= rect.y + rect.h
  end

  if window_open then
    local char = gfx.getchar()
    if char == -1 then
      window_open = false
      if run_state == "running" then request_cancel() end
    else
      local wheel = gfx.mouse_wheel
      gfx.mouse_wheel = 0
      if wheel ~= 0 then
        local auto_view = (run_state == "success") and "table" or "log"
        local ev = view_override or auto_view
        -- Precision/trackpad wheels don't always report clean multiples of
        -- 120 - round to a whole row so the scroll offset always stays an
        -- integer. A fractional value here previously made the table's
        -- start_idx/i fractional too, so marker_rows[i] silently returned
        -- nil and the next line crashed the whole script - confirmed live
        -- as the "nil" error while scrolling/clicking the table.
        if ev == "table" then
          table_scroll = math.floor(table_scroll + wheel / 120 + 0.5)
        elseif ev == "log" then
          log_scroll = math.floor(log_scroll + wheel / 120 + 0.5)
        end
      end

      hits = draw()

      -- Hover tooltips: purely additive overlay drawn after draw()'s own
      -- content but before gfx.update() flips the frame, so it still lands
      -- in this same frame. Only the config screen has hoverable fields
      -- with descriptions worth showing.
      if run_state == "configuring" then
        local tooltip_text, tooltip_at_x, tooltip_at_y = nil, gfx.mouse_x + 16, gfx.mouse_y + 16
        if hits.model_chips then
          for _, chip in ipairs(hits.model_chips) do
            if hit(chip) then tooltip_text = MODEL_DESCRIPTIONS[chip.value] break end
          end
        end
        if not tooltip_text and hit(hits.save_default_model) then
          tooltip_text = SAVE_DEFAULT_MODEL_DESCRIPTION
        end
        if not tooltip_text and hits.chunk_chips then
          for _, chip in ipairs(hits.chunk_chips) do
            if hit(chip) then tooltip_text = CHUNK_DESCRIPTION break end
          end
        end
        if not tooltip_text and hits.worker_chips then
          for _, chip in ipairs(hits.worker_chips) do
            if hit(chip) then tooltip_text = WORKER_DESCRIPTION break end
          end
        end
        if not tooltip_text and hit(hits.set_hints) then
          tooltip_text = HINTS_DESCRIPTION
        end
        if not tooltip_text and hit(hits.suggest_hints) then
          tooltip_text = SUGGEST_HINTS_DESCRIPTION
        end
        if tooltip_text then
          draw_tooltip(tooltip_at_x, tooltip_at_y, tooltip_text)
        end
      end

      gfx.update()

      local mouse_down = (gfx.mouse_cap & 1) == 1
      if mouse_down and not mouse_was_down then
        local clicked_chapter_row = nil
        if hits.chapter_rows then
          for _, rowhit in ipairs(hits.chapter_rows) do
            if hit({ x = 12, y = rowhit.y, w = gfx_w - 24, h = rowhit.h }) then
              clicked_chapter_row = rowhit
              break
            end
          end
        end
        local clicked_table_row = nil
        if not clicked_chapter_row and hits.table_rows then
          for _, rowhit in ipairs(hits.table_rows) do
            if hit({ x = 12, y = rowhit.y, w = gfx_w - 24, h = rowhit.h }) then
              clicked_table_row = rowhit
              break
            end
          end
        end
        local clicked_model_chip = nil
        if hits.model_chips then
          for _, chip in ipairs(hits.model_chips) do
            if hit(chip) then
              clicked_model_chip = chip
              break
            end
          end
        end
        local clicked_chunk_chip = nil
        if hits.chunk_chips then
          for _, chip in ipairs(hits.chunk_chips) do
            if hit(chip) then
              clicked_chunk_chip = chip
              break
            end
          end
        end
        local clicked_worker_chip = nil
        if hits.worker_chips then
          for _, chip in ipairs(hits.worker_chips) do
            if hit(chip) then
              clicked_worker_chip = chip
              break
            end
          end
        end

        if clicked_chapter_row then
          append_log("Selected chapter: " .. clicked_chapter_row.title)
          start_backend_run(clicked_chapter_row.title)
        elseif clicked_table_row then
          selected_marker_row = clicked_table_row.row
          jump_to_marker_row(clicked_table_row.row)
        elseif clicked_model_chip then
          model_size = clicked_model_chip.value
        elseif clicked_chunk_chip then
          chunk_seconds = clicked_chunk_chip.value.seconds
          if chunk_seconds == 0 then parallel_workers = 0 end
        elseif clicked_worker_chip then
          parallel_workers = (clicked_worker_chip.value == "Auto") and 0 or clicked_worker_chip.value
        elseif hit(hits.save_default_model) then
          pyconfig.set_global(common, process, python_exe, config_cli_path, scratch_dir, EXT, "model_size", model_size)
          default_saved_flash_until = reaper.time_precise() + 1.5
          append_log("Saved '" .. model_size .. "' as the default model.")
        elseif hit(hits.cancel_config) then
          window_open = false
          gfx.quit()
          return
        elseif hit(hits.change_manuscript) then
          local new_path = pick_new_manuscript()
          if new_path then
            docx_path = new_path
            recompute_data_paths()
          end
        elseif hit(hits.set_hints) then
          edit_vocab_hints()
        elseif hit(hits.suggest_hints) then
          start_hint_extraction()
        elseif hit(hits.tab_log) then
          view_override = "log"
        elseif hit(hits.tab_table) then
          view_override = "table"
        elseif hit(hits.tab_diff) then
          open_diff()
        elseif hit(hits.tab_addequiv) then
          add_equivalence_from_selected()
        elseif hit(hits.button) then
          if run_state == "configuring" then
            start_backend_run(nil)
          elseif run_state == "running" then
            request_cancel()
            append_log("Cancel requested...")
          else
            window_open = false
            gfx.quit()
            return
          end
        end
      end
      mouse_was_down = mouse_down
    end
  else
    -- window already closed by the user - if we're still "running" in the
    -- backend's eyes, keep polling headlessly so a cancel/finish can still
    -- be acted on (markers etc.), but stop once we've handled a terminal
    -- state (or if we never even got past "configuring").
    if run_state ~= "running" then return end
  end

  local elapsed = reaper.time_precise() - start_time

  if run_state == "running" then
    if last_stage == "DONE" or file_exists(out_path) then
      local tag = file_exists(out_path) and peek_out_tag(out_path)
      if tag == "NEED_CHAPTER" then
        handle_need_chapter()
      else
        run_state = "success"
        import_results_once()
      end
    elseif last_stage == "CANCELLED" then
      run_state = "cancelled"
      append_log("Cancelled - no markers were added.")
    elseif last_stage == "ERROR" then
      run_state = "error"
      append_log("FAILED: " .. (header_text or ""))
    elseif not seen_any_progress and elapsed > EARLY_CRASH_GRACE_SECONDS and read_whole_file(log_path) ~= "" then
      run_state = "error"
      append_log("The backend didn't start correctly.")
    elseif elapsed > TIMEOUT_SECONDS then
      request_cancel()
      run_state = "error"
      append_log("Timed out after 30 minutes.")
    end

    if run_state ~= "running" and frozen_elapsed == nil then
      frozen_elapsed = elapsed
    end
  end

  if not window_open and run_state ~= "running" then
    return
  end

  reaper.defer(tick)
end

reaper.defer(tick)
