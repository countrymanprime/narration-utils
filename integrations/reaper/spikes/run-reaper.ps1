# Runs one scripted REAPER session in an isolated resource directory and leaves no REAPER process of its own behind.
#
#   pwsh run-reaper.ps1 -Cfg <temp dir> -Out <temp dir> -Script <file.lua> [-Project <copy of a .rpp>] [-TimeoutSec 90]
#                       [-Done <file the script writes when it has finished>] [-ReaperDir <integrations/reaper>] [-IgnoreErrors]
#
# Safety rules (owner decision D3, docs/prds/implementation-plan.md), enforced here:
#   - -Cfg, -Out and -Project must all be under the user's temp folder, and none may be under a "REAPER Media" folder, so
#     REAPER's resource directory, this script's output and any project opened are scratch copies;
#   - REAPER starts with -cfgfile, so the owner's settings, scripts and projects are never read or written, and every
#     script asserts at start that REAPER's resource path is -Cfg and that no audio device is running;
#   - only the process this script starts is ever closed;
#   - the first-run "select an audio device" prompt is answered No, so no audio hardware is opened.
param(
  [Parameter(Mandatory)][string]$Cfg,
  [Parameter(Mandatory)][string]$Out,
  [Parameter(Mandatory)][string]$Script,
  [string]$Project = '',
  [int]$TimeoutSec = 90,
  [string]$Done = '',
  [string]$ReaperDir = (Join-Path $PSScriptRoot '..'),
  [switch]$IgnoreErrors
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\win.ps1"

$temp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
function Assert-Scratch([string]$label, [string]$path) {
  $full = [System.IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) { throw "$label ($full) must be under the temp folder $temp" }
  if ($full -match 'REAPER Media') { throw "$label ($full) must not be under a REAPER Media folder" }
  return $full
}
$Cfg = Assert-Scratch '-Cfg' $Cfg
$Out = Assert-Scratch '-Out' $Out
if ($Project) { $Project = Assert-Scratch '-Project' $Project }

$exe = 'C:\Program Files\REAPER (x64)\reaper.exe'
New-Item -ItemType Directory -Force $Cfg, $Out | Out-Null
# The scripts read these (os.getenv): the scratch folders and the bridge sources under test.
$env:NARRATION_UTILS_SPIKE_OUT = $Out
$env:NARRATION_UTILS_SPIKE_CFG = $Cfg.TrimEnd('\')
$env:NARRATION_UTILS_REAPER_DIR = (Resolve-Path $ReaperDir).Path
# One quoted string, not an array: Start-Process does not quote array elements, so a path with a space would be split
# and -cfgfile could be misread.
$argText = '-cfgfile "' + (Join-Path $Cfg 'reaper.ini') + '" -nosplash -newinst -noactivate'
if ($IgnoreErrors) { $argText += ' -ignoreerrors' }
if ($Project) { $argText += ' "' + $Project + '"' }
$argText += ' "' + (Resolve-Path $Script).Path + '"'
$p = Start-Process -FilePath $exe -ArgumentList $argText -PassThru
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$log = @()
$finished = $false
try {
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  $p.Refresh()
  if ($p.HasExited) { $log += 'exited by itself'; break }
  # The script is done: give REAPER a few more seconds to quit on its own (answering its close-time prompts) before closing it.
  if ($Done -and (Test-Path $Done) -and -not $finished) { $log += 'done marker seen'; $finished = $true; $deadline = (Get-Date).AddSeconds(12) }
  foreach ($w in (Get-ReaperWindows $p.Id)) {
    if ($w -match 'class=#32770') {
      $hwnd = [int64]($w -split ' ')[0]
      try { $text = (Get-DialogText $hwnd) -join ' | ' } catch { $text = 'UNREADABLE DIALOG' }
      if ($text -match 'audio device') { [void][W3]::PostMessage([IntPtr]$hwnd, 0x111, [IntPtr]7, [IntPtr]0); $log += 'answered No to the audio device prompt' }
      elseif ($text -match 'REAPER IS NOT FREE') { [void][W3]::PostMessage([IntPtr]$hwnd, 0x111, [IntPtr]1, [IntPtr]0); $log += 'dismissed the evaluation notice' }
      elseif ($text -match 'ReaScript Error' -or $w -match "title='ReaScript Error'") { $log += "ReaScript error dialog: $text"; [void][W3]::PostMessage([IntPtr]$hwnd, 0x111, [IntPtr]1, [IntPtr]0) }
      elseif ($text -match 'Analyzing') { $log += 'peak building dialog (ignored)' }
      elseif ($text -match 'before closing') { [void][W3]::PostMessage([IntPtr]$hwnd, 0x111, [IntPtr]7, [IntPtr]0); $log += 'answered No to a save prompt on close (the scratch copy is not kept)' }
      else { $log += "UNKNOWN DIALOG: $w :: $text" }
    }
  }
}
} finally {
$p.Refresh()
if (-not $p.HasExited) {
  $main = (Get-ReaperWindows $p.Id) | Where-Object { $_ -match 'class=REAPERwnd' } | Select-Object -First 1
  if ($main) { [void][W3]::PostMessage([IntPtr]([int64]($main -split ' ')[0]), 0x10, [IntPtr]0, [IntPtr]0) }
  $null = $p.WaitForExit(8000)
}
$p.Refresh()
if (-not $p.HasExited) { $log += 'closed by force after the timeout (a save prompt or another dialog kept it open)'; $p.Kill() }
}
$log | Select-Object -Unique
