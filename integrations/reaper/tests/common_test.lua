-- The shared helper modules the launcher loads: reaper_common_core.lua and reaper_common_process.lua.

local H = require('harness')
local Fake = require('fake_reaper')

local function load_common(os_name)
  local fake = Fake.new(host)
  fake.os_name = os_name or 'Linux64'
  reaper = fake.reaper
  local core = dofile(H.join(host.reaper_dir, 'reaper_common_core.lua'))
  local process = dofile(H.join(host.reaper_dir, 'reaper_common_process.lua'))
  return core, process, fake
end

H.test('dirname returns the folder and the caller-chosen fallback without a separator', function()
  local core = load_common()
  H.eq(core.dirname('C:\\media\\a.wav', 'x'), 'C:\\media')
  H.eq(core.dirname('/media/a.wav', 'x'), '/media')
  H.eq(core.dirname('a.wav', 'fallback'), 'fallback')
end)

H.test('parse_csv_list splits on commas and keeps empty fields', function()
  local core = load_common()
  H.eq(core.parse_csv_list('a,b,,d'), { 'a', 'b', '', 'd' })
  H.eq(core.parse_csv_list(''), { '' })
end)

H.test('file helpers read, copy and report missing files', function()
  local core = load_common()
  local dir = host.tmpdir()
  local source, target = H.join(dir, 'a.txt'), H.join(dir, 'b.txt')
  H.write_file(source, 'hello')
  H.eq(core.file_exists(source), true)
  H.eq(core.file_exists(target), false)
  H.eq(core.read_file(source), 'hello')
  H.eq(core.read_file(target), '', 'a missing file reads as empty')
  H.eq(core.copy_file(source, target), true)
  H.eq(H.read_file(target), 'hello')
  H.eq(core.copy_file(H.join(dir, 'nope.txt'), target), false)
end)

H.test('get_ext falls back to the default for an unset or empty value', function()
  local core, _, fake = load_common()
  local store = { ['S|k'] = 'value', ['S|empty'] = '' }
  fake.reaper.GetExtState = function(section, key)
    return store[section .. '|' .. key]
  end
  H.eq(core.get_ext('S', 'k', 'd'), 'value')
  H.eq(core.get_ext('S', 'empty', 'd'), 'd')
  H.eq(core.get_ext('S', 'unset', 'd'), 'd')
end)

H.test('core_dir climbs two folders from the calling script to the shared core folder', function()
  local core = load_common()
  local sep = package.config:sub(1, 1)
  H.eq(core.core_dir('/tool/daws/reaper/run.lua'), '/tool/daws/reaper' .. sep .. '..' .. sep .. '..' .. sep .. 'core')
end)

H.test('split_pipe gives exactly n fields and the last absorbs the rest', function()
  local _, process = load_common()
  H.eq(process.split_pipe('a|b|c|d', 3), { 'a', 'b', 'c|d' })
  H.eq(process.split_pipe('a||c', 3), { 'a', '', 'c' })
  H.eq(process.split_pipe('only', 3), { 'only' })
end)

H.test('percent_decode reverses %XX escapes', function()
  local _, process = load_common()
  H.eq(process.percent_decode('a%20b%7Cc%C3%A9'), 'a b|cé')
end)

H.test('quote uses single quotes outside Windows and double quotes on Windows', function()
  local _, unix = load_common('Linux64')
  H.eq(unix.quote("it's"), [['it'\''s']])
  local _, windows = load_common('Win64')
  H.eq(windows.quote('say "hi"'), '"say ""hi"""')
end)

H.test('run_hidden outside Windows hands the command to ExecProcess, detached unless it waits', function()
  local _, process, fake = load_common('Linux64')
  H.truthy(process.run_hidden(host.tmpdir(), "'/app' --x", { cwd = '/work dir' }))
  H.eq(fake.calls[1].command, "cd '/work dir' && '/app' --x")
  H.eq(fake.calls[1].timeout, -1)
  process.run_hidden(host.tmpdir(), '/app', { wait = true })
  H.eq(fake.calls[2].timeout, 0)
end)
