# Runs one scripted REAPER session in an isolated resource directory and leaves no REAPER process of its own behind.
#
#   pwsh run-reaper.ps1 -Cfg <temp dir> -Out <temp dir> -Script <file.lua> [-Project <copy of a .rpp>] [-TimeoutSec 90]
#                       [-Done <file the script writes when it has finished>] [-ReaperDir <integrations/reaper>] [-IgnoreErrors]
#
# Safety rules (owner decision D3, docs/prds/implementation-plan.md): REAPER starts with -cfgfile, so its resource
# directory is -Cfg (a temp folder) and the owner's settings, scripts and projects are never read or written; -Project
# must be a COPY in a temp folder; nothing under the owner's REAPER folders is touched. Only the process this script
# starts is ever closed. No audio hardware is used (the first-run "select an audio device" prompt is answered No).
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
. "$PSScriptRoot\win.ps1"
$exe = 'C:\Program Files\REAPER (x64)\reaper.exe'
New-Item -ItemType Directory -Force $Cfg, $Out | Out-Null
# The scripts read these (os.getenv): the scratch folder and the bridge sources under test.
$env:NARRATION_UTILS_SPIKE_OUT = (Resolve-Path $Out).Path
$env:NARRATION_UTILS_REAPER_DIR = (Resolve-Path $ReaperDir).Path
$argList = @('-cfgfile', "$Cfg\reaper.ini", '-nosplash', '-newinst', '-noactivate')
if ($IgnoreErrors) { $argList += '-ignoreerrors' }
if ($Project) { $argList += $Project }
$argList += $Script
$p = Start-Process -FilePath $exe -ArgumentList $argList -PassThru
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$log = @()
$finished = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  $p.Refresh()
  if ($p.HasExited) { $log += 'exited by itself'; break }
  # The script is done: give REAPER a few more seconds to quit on its own (answering its close-time prompts) before closing it.
  if ($Done -and (Test-Path $Done) -and -not $finished) { $log += 'done marker seen'; $finished = $true; $deadline = (Get-Date).AddSeconds(12) }
  foreach ($w in (Get-ReaperWindows $p.Id)) {
    if ($w -match 'class=#32770') {
      $hwnd = [int64]($w -split ' ')[0]
      $text = (Get-DialogText $hwnd) -join ' | '
      if ($text -match 'audio device') { [void][W3]::PostMessage([IntPtr]$hwnd, 0x111, [IntPtr]7, [IntPtr]0); $log += 'answered No to the audio device prompt' }
      elseif ($text -match 'REAPER IS NOT FREE') { [void][W3]::PostMessage([IntPtr]$hwnd, 0x111, [IntPtr]1, [IntPtr]0); $log += 'dismissed the evaluation notice' }
      elseif ($text -match 'ReaScript Error') { $log += "ReaScript error dialog: $text"; [void][W3]::PostMessage([IntPtr]$hwnd, 0x111, [IntPtr]1, [IntPtr]0) }
      elseif ($text -match 'Analyzing') { $log += 'peak building dialog (ignored)' }
      elseif ($text -match 'before closing') { [void][W3]::PostMessage([IntPtr]$hwnd, 0x111, [IntPtr]7, [IntPtr]0); $log += 'answered No to a save prompt on close (the scratch copy is not kept)' }
      else { $log += "UNKNOWN DIALOG: $w :: $text" }
    }
  }
}
$p.Refresh()
if (-not $p.HasExited) {
  $main = (Get-ReaperWindows $p.Id) | Where-Object { $_ -match 'class=REAPERwnd' } | Select-Object -First 1
  if ($main) { [void][W3]::PostMessage([IntPtr]([int64]($main -split ' ')[0]), 0x10, [IntPtr]0, [IntPtr]0) }
  $null = $p.WaitForExit(8000)
}
$p.Refresh()
if (-not $p.HasExited) { $log += 'closed by force after the timeout (a save prompt or another dialog kept it open)'; $p.Kill() }
$log | Select-Object -Unique
