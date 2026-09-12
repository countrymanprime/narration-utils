-- Manuscript Guide - Run (independent ReaScript package)
-- Deliberately shares only <project folder>\Manuscript.docx with other tools.

local EXT = "ManuscriptGuide"

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
    "\n\nThis package's folder must stay at tools\\manuscript-guide\\daws\\reaper\\ relative to shared\\reaper\\ under the repo root.",
    "Manuscript Guide", 0)
  return
end

local function get(k, d) return common.get_ext(EXT, k, d) end
local function exists(p) return common.file_exists(p) end
local function read(p) return common.read_file(p) end
local function msg(v) reaper.ShowMessageBox(v, "Manuscript Guide", 0) end
local function q(v) return process.quote(v) end
local function dirname(p) return common.dirname(p, "") end

-- pythonw.exe (the windowless console host) ships alongside python.exe in
-- every standard Windows CPython install/venv - used for the manuscript
-- picker so no console flashes while it's open.
local function pythonw_for(python_exe)
  local replaced, count = python_exe:gsub("[Pp]ython%.exe$", "pythonw.exe")
  if count > 0 then return replaced end
  return python_exe
end

local _, rpp = reaper.EnumProjects(-1, "")
local root = rpp and dirname(rpp) or ""
if root == "" then msg("Save this REAPER project first."); return end
local CORE = common.core_dir(own_script_path())
local python = get("python_exe", CORE .. [[\.venv\Scripts\python.exe]])
local backend = get("backend", CORE .. [[\manuscript_guide.py]])
if not exists(python) or not exists(backend) then msg("Run 'Manuscript Guide - Configure' first."); return end

local config_cli_path = SHARED .. "\\..\\python\\config_cli.py"
local manuscript_cli_path = SHARED .. "\\..\\python\\manuscript_cli.py"
local manuscript, data = root .. "\\Manuscript.docx", root .. "\\ManuscriptGuide"
reaper.RecursiveCreateDirectory(data, 0)

-- python-owned settings (repo default -> global -> project, resolved by
-- config_cli.py).
local resolved = pyconfig.query(common, process, python, config_cli_path, data, EXT,
  { "spacy_model", "espeak_library", "piper_exe", "piper_model" }, root)
local model, espeak = resolved.spacy_model or "en_core_web_sm", resolved.espeak_library or ""
local piper, voice = resolved.piper_exe or "", resolved.piper_model or ""

local guide, index_file, status_file = data .. "\\manuscript_guide.json", data .. "\\index.txt", data .. "\\status.txt"
local audio = data .. "\\audio"
reaper.RecursiveCreateDirectory(audio, 0)

-- A hidden synchronous launcher avoids leaving a Python console window open.
local function run(command) return process.run_hidden(data, command, {wait = true}) end
local function command(args) return q(python) .. " " .. q(backend) .. " " .. args end
local function select_manuscript()
  local result = pyconfig.pick_manuscript(common, process, pythonw_for(python), manuscript_cli_path, data, root)
  return result ~= "" and result ~= "CANCELLED"
end
if not exists(manuscript) then
  if reaper.ShowMessageBox("No shared Manuscript.docx exists. Select one now?","Manuscript Guide",4) ~= 6 or not select_manuscript() then return end
end
local function status()
  os.remove(status_file)
  run(command("status --docx "..q(manuscript).." --guide "..q(guide).." --out "..q(status_file)))
  return read(status_file):match("STATUS|([A-Z]+)") or "MISSING"
end
local function build()
  local args="build --docx "..q(manuscript).." --out "..q(guide).." --progress "..q(data.."\\progress.txt").." --spacy-model "..q(model)
  if espeak ~= "" then args=args.." --espeak-library "..q(espeak) end
  msg("Building a local guide from the shared Manuscript.docx. Large books can take a moment.")
  if not run(command(args)) or not exists(guide) then msg("Build failed. Check independent plugin paths and:\n"..data.."\\progress.txt"); return false end
  return true
end
local stale=status()
if stale ~= "CURRENT" then
  local prompt=(stale == "STALE") and "The shared manuscript changed. Rebuild only Manuscript Guide data now?" or "No guide exists. Build it now?"
  if reaper.ShowMessageBox(prompt,"Manuscript Guide",4) ~= 6 or not build() then return end
end

local function decode(s) return process.percent_decode(s) end
local function fields(s) return process.split_pipe(s, 12) end
local entities={}
local function reload()
  os.remove(index_file); run(command("index --guide "..q(guide).." --out "..q(index_file)))
  entities={}
  for line in read(index_file):gmatch("[^\r\n]+") do
    local f=fields(line)
    if f[1] == "ENTITY" then entities[#entities+1]={id=decode(f[2]or""), category=decode(f[3]or""), name=decode(f[4]or""), say=decode(f[5]or""), ipa=decode(f[6]or""), count=decode(f[7]or"0"), locks=decode(f[8]or""), description=decode(f[9]or""), traits=decode(f[10]or""), chapter=decode(f[11]or""), evidence=decode(f[12]or"")} end
  end
end
reload()
local function update(entity, field, value, locked)
  run(command("edit --guide "..q(guide).." --entity-id "..q(entity.id).." --field "..q(field).." --value "..q(value).." --lock "..locked))
end
local function edit(entity)
  local labels="Name,Category,Say it as,IPA,Description,Personality note,Lock fields (;),extrawidth=280"
  local defaults=table.concat({entity.name:gsub(",",";"),entity.category,entity.say:gsub(",",";"),entity.ipa:gsub(",",";"),entity.description:gsub(",",";"),entity.traits:gsub(",",";"),entity.locks},",")
  local ok,csv=reaper.GetUserInputs("Edit / lock "..entity.name,7,labels,defaults); if not ok then return end
  local values=common.parse_csv_list(csv)
  local locks={}; for value in ((values[7]or"")..";"):gmatch("(.-);") do locks[value:lower()]=true end
  local edits={{"canonical_name",values[1]},{"category",values[2]},{"say_as",values[3]},{"ipa",values[4]},{"description",values[5]},{"personality",values[6]}}
  for _, item in ipairs(edits) do update(entity,item[1],item[2]or"",locks[item[1]:lower()] and "on" or "off") end
  reload()
end
local function export_hotwords()
  local out=data.."\\whisper_hotwords.txt"
  if run(command("export-hotwords --guide "..q(guide).." --out "..q(out))) then msg("Exported independent hotword reference:\n"..out.."\n\nIt does not modify Transcript Compare.") else msg("Could not export hotwords.") end
end
local function preview(entity)
  if piper == "" or voice == "" then msg("Set Piper executable and voice model in Manuscript Guide settings."); return end
  local wav=audio.."\\"..entity.id..".wav"
  local args="render-audio --guide "..q(guide).." --entity-id "..q(entity.id).." --audio-dir "..q(audio).." --piper-exe "..q(piper).." --piper-model "..q(voice)
  if not run(command(args)) or not exists(wav) then msg("Could not generate preview. Check Piper settings."); return end
  process.open_file_with_default_app(data, wav)
end

-- Compact searchable guide window: click a row; controls affect only this package.
local W,H=1050,650; gfx.init("Manuscript Guide",W,H); local query,focus,selected,last_mouse="",false,1,0
local function matches()
  local out,needle={},query:lower(); for _,e in ipairs(entities) do if needle=="" or e.name:lower():find(needle,1,true) or e.category:lower():find(needle,1,true) then out[#out+1]=e end end; return out
end
local function txt(v,x,y,r,g,b) gfx.set(r,g,b,1); gfx.x,gfx.y=x,y; gfx.drawstr(v or "") end
local function clip(v,n) v=v or ""; return #v>n and v:sub(1,n-1).."…" or v end
local function btn(v,x,y,w) gfx.set(.16,.21,.29,1); gfx.rect(x,y,w,27,1); txt(v,x+8,y+7,.9,.94,1) end
local function wrap(v,x,y,max,limit)
  local line,row="",0; for word in (v or ""):gmatch("%S+") do local trial=line=="" and word or line.." "..word; if gfx.measurestr(trial)>max and line~="" then txt(line,x,y+row*18,.82,.86,.92); row=row+1; line=word; if row>=limit then return end else line=trial end end; if line~="" and row<limit then txt(line,x,y+row*18,.82,.86,.92) end
end
local function draw()
  gfx.set(.05,.06,.08,1); gfx.rect(0,0,W,H,1); gfx.setfont(1,"Arial",20); txt("Manuscript Guide",18,14,.96,.97,1); gfx.setfont(1,"Arial",13); txt("Shared input: "..manuscript,18,42,.55,.65,.76)
  gfx.set(.11,.13,.18,1); gfx.rect(18,67,450,28,1); txt((focus and "> " or "").."Search: "..query,25,75,.9,.94,1); btn("Rebuild",480,67,75); btn("Export all",565,67,94); btn("Refresh",669,67,75)
  local rows=matches(); if selected>#rows then selected=#rows end; if selected<1 then selected=1 end
  for i,e in ipairs(rows) do local y=108+(i-1)*26; if y<495 then if i==selected then gfx.set(.16,.29,.42,1); gfx.rect(18,y,726,23,1) end; txt(clip(e.category,16),25,y+5,.54,.76,.98); txt(clip(e.name,32),175,y+5,.96,.96,.99); txt(e.count.." hits",505,y+5,.62,.69,.77); txt(clip(e.say,19),590,y+5,.72,.9,.72) end end
  gfx.set(.11,.13,.18,1); gfx.rect(758,67,275,560,1); local e=rows[selected]
  if e then gfx.setfont(1,"Arial",19); txt(e.name,775,86,.98,.98,1); gfx.setfont(1,"Arial",13); txt(e.category.." · "..e.count.." occurrence(s)",775,115,.54,.76,.98); txt("Say it as: "..e.say,775,146,.72,.92,.72); txt("IPA: "..(e.ipa~="" and e.ipa or "not generated"),775,169,.88,.84,.69); btn("Edit / lock",775,198,102); btn("Play preview",887,198,124); txt("Description",775,246,.56,.70,.9); wrap(e.description~="" and e.description or "No generated description. Add an evidence-linked note in Edit.",775,267,240,4); txt("Personality notes",775,353,.56,.70,.9); wrap(e.traits~="" and e.traits or "No supported trait note found.",775,374,240,4); txt("Evidence · "..e.chapter,775,460,.56,.70,.9); wrap(e.evidence,775,481,240,6); txt("Locked: "..(e.locks~="" and e.locks or "none"),775,604,.62,.69,.77) else txt("No matching entities.",775,86,.82,.86,.92) end
  txt("Click a row · type to search · Esc clears",18,625,.50,.58,.68)
end
local function loop()
  local c=gfx.getchar(); if c<0 then gfx.quit(); return end; local rows=matches()
  if focus then if c==8 then query=query:sub(1,-2) elseif c==13 then focus=false elseif c>=32 and c<=126 then query=query..string.char(c) end elseif c==27 then query="" elseif c==40 then selected=math.min(#rows,selected+1) elseif c==38 then selected=math.max(1,selected-1) elseif c>=32 and c<=126 then focus=true; query=string.char(c) end
  local mouse=gfx.mouse_cap; if mouse==1 and last_mouse==0 then local x,y=gfx.mouse_x,gfx.mouse_y; if y>=67 and y<=95 and x>=18 and x<=468 then focus=true elseif y>=67 and y<=95 and x>=480 and x<=555 then if build() then reload(); selected=1 end elseif y>=67 and y<=95 and x>=565 and x<=659 then export_hotwords() elseif y>=67 and y<=95 and x>=669 and x<=744 then reload(); selected=1 elseif x>=18 and x<=744 and y>=108 and y<495 then local n=math.floor((y-108)/26)+1; if rows[n] then selected=n end elseif x>=775 and x<=877 and y>=198 and y<=225 and rows[selected] then edit(rows[selected]) elseif x>=887 and x<=1011 and y>=198 and y<=225 and rows[selected] then preview(rows[selected]) end end
  last_mouse=mouse; draw(); reaper.defer(loop)
end
loop()
