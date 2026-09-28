# The verification pass, Part A, in one command (docs/operations/reaper-verification-pass.md):
#
#   pwsh integrations/reaper/spikes/run-pass-part-a.ps1
#
# Runs two isolated REAPER sessions through run-reaper.ps1, each with its own scratch -cfgfile and its own scratch
# project built from make_media.py's tones: spike_ep0_workspace.lua (rows A6-A8b), then pass_part_a.lua (every other
# Part A row, merging the first session's report). It opens no project of the owner's and never records. The results
# (paths removed) land in <work>\main\pass-part-a-results.md and are copied to integrations\reaper\spikes\results\.
#
#   -Work        the scratch folder for this run; must be under the temp folder (default: a fresh one under $env:TEMP)
#   -TimeoutSec  how long each REAPER session may take before it is closed (default 300)
param(
  [string]$Work = (Join-Path $env:TEMP ('narration-pass-a-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))),
  [int]$TimeoutSec = 300
)
$ErrorActionPreference = 'Stop'

# The same rule run-reaper.ps1 enforces, checked before anything is written (owner decision D3).
$temp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$Work = [System.IO.Path]::GetFullPath($Work)
if (-not $Work.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) { throw "-Work ($Work) must be under the temp folder $temp" }
if ($Work -match 'REAPER Media') { throw "-Work ($Work) must not be under a REAPER Media folder" }
if (Test-Path $Work) { throw "-Work ($Work) already exists: use a fresh folder per run" }

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$rev = (& git -C $repo rev-parse --short HEAD 2>$null)
if (-not $rev) { $rev = 'unknown' }
$started = Get-Date
$ep0 = Join-Path $Work 'ep0'
$main = Join-Path $Work 'main'
foreach ($dir in $ep0, $main) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  & python (Join-Path $PSScriptRoot 'make_media.py') (Join-Path $dir 'media')
  if ($LASTEXITCODE -ne 0) { throw 'make_media.py failed' }
}
$runReaper = Join-Path $PSScriptRoot 'run-reaper.ps1'

Write-Host 'Part A 1/2: rows A6-A8b (spike_ep0_workspace.lua)'
$ep0Report = Join-Path $ep0 'ep0-workspace-report.txt'
& $runReaper -Cfg (Join-Path $Work 'cfg-ep0') -Out $ep0 -Script (Join-Path $PSScriptRoot 'spike_ep0_workspace.lua') -Done $ep0Report -TimeoutSec $TimeoutSec

Write-Host 'Part A 2/2: every other row (pass_part_a.lua)'
$env:NARRATION_UTILS_PASS_EP0_REPORT = $ep0Report
$env:NARRATION_UTILS_PASS_REV = $rev
$done = Join-Path $main 'pass-part-a-done.txt'
& $runReaper -Cfg (Join-Path $Work 'cfg-main') -Out $main -Script (Join-Path $PSScriptRoot 'pass_part_a.lua') -Done $done -TimeoutSec $TimeoutSec

$results = Join-Path $main 'pass-part-a-results.md'
if (-not (Test-Path $results)) { throw "no results were written ($results): see the REAPER log lines above" }
$kept = Join-Path $PSScriptRoot 'results'
Copy-Item $results (Join-Path $kept 'pass-part-a-results.md') -Force
Copy-Item (Join-Path $main 'pass-part-a-log.txt') (Join-Path $kept 'pass-part-a-log.txt') -Force
Write-Host ''
Get-Content $results | Select-String -Pattern 'rows pass' | ForEach-Object { Write-Host $_.Line }
Write-Host ("Took {0:N0} s. Results: {1} (copied to {2}). Paste the results file into #510." -f ((Get-Date) - $started).TotalSeconds, $results, $kept)
