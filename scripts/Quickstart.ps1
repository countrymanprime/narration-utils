<#
.SYNOPSIS
Creates every local runtime Narration Utils needs, builds its React UI, and
publishes its .NET desktop host.

.DESCRIPTION
Downloads a private Python runtime, creates the Manuscript Guide and Transcript
Compare tool environments, builds the React UI, and publishes the compiled
desktop host (shared/hub) that opens it. Machine prerequisites are Node.js/npm
and the .NET SDK. All Python runtimes, Python packages, virtual environments,
Node packages, and .NET build output remain inside this checkout and are
excluded from Git.
#>
[CmdletBinding()]
param(
    [switch]$SkipSpacyModel,
    [Alias('BootstrapPython')]
    [string]$BootstrapPythonPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$embeddedPythonVersion = '3.12.10'
$piperVoice = 'en_US-lessac-medium'
$piperVoiceBaseUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium'

function Get-EmbeddedPython {
    $runtimeRoot = Join-Path $repoRoot 'shared\python\.runtime'
    $pythonPath = Join-Path $runtimeRoot 'python.exe'
    $venvModule = Join-Path $runtimeRoot 'Lib\venv\__init__.py'
    if ((Test-Path -LiteralPath $pythonPath) -and (Test-Path -LiteralPath $venvModule)) {
        return [pscustomobject]@{ Executable = $pythonPath; Arguments = @() }
    }

    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Narration Utils automatic Python setup currently requires 64-bit Windows.'
    }

    $bootstrapRoot = Join-Path $repoRoot 'shared\python\.bootstrap'
    $installerPath = Join-Path $bootstrapRoot "python-$embeddedPythonVersion-amd64.exe"
    New-Item -ItemType Directory -Force -Path $bootstrapRoot | Out-Null

    if (-not (Test-Path -LiteralPath $installerPath)) {
        Write-Host "Downloading private Python $embeddedPythonVersion runtime..."
        Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$embeddedPythonVersion/python-$embeddedPythonVersion-amd64.exe" -OutFile $installerPath
    }

    # A previous embedded-runtime attempt is not usable because it lacks venv.
    # This directory is created exclusively by quickstart and is gitignored.
    if (Test-Path -LiteralPath $runtimeRoot) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force }
    Write-Host 'Installing the private Python runtime...'
    $installer = Start-Process -FilePath $installerPath -ArgumentList @(
        '/quiet', 'InstallAllUsers=0', "TargetDir=$runtimeRoot", 'PrependPath=0',
        'Include_pip=1', 'Include_launcher=0', 'AssociateFiles=0', 'Shortcuts=0',
        'Include_doc=0', 'Include_test=0'
    ) -PassThru -Wait
    if ($installer.ExitCode -ne 0) { throw "Private Python setup failed ($($installer.ExitCode))." }
    if (-not (Test-Path -LiteralPath $venvModule)) { throw 'Private Python setup completed without the venv module.' }
    return [pscustomobject]@{ Executable = $pythonPath; Arguments = @() }
}

function Get-BootstrapPython {
    if ($BootstrapPythonPath) {
        if (-not (Test-Path -LiteralPath $BootstrapPythonPath)) { throw "Bootstrap Python was not found: $BootstrapPythonPath" }
        $available = $false
        try { & $BootstrapPythonPath --version 2>$null | Out-Null; $available = $LASTEXITCODE -eq 0 } catch { }
        if ($available) { return [pscustomobject]@{ Executable = [string]$BootstrapPythonPath; Arguments = @() } }
        throw "Bootstrap Python could not run: $BootstrapPythonPath"
    }
    return Get-EmbeddedPython
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$CommandPath,
        [Parameter(Mandatory)][string[]]$CommandArguments
    )
    & $CommandPath @CommandArguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $CommandPath $($CommandArguments -join ' ')" }
}

function Install-Environment([string]$EnvironmentPath, [string]$RequirementsPath, [string]$Name) {
    $pythonPath = Join-Path $EnvironmentPath 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        Write-Host "Creating $Name environment..."
        Invoke-Checked -CommandPath $bootstrapPythonExecutable -CommandArguments ($bootstrapPythonArguments + @('-m', 'venv', $EnvironmentPath)) | Out-Host
    }
    Write-Host "Installing $Name dependencies..."
    Invoke-Checked $pythonPath @('-m', 'pip', 'install', '--upgrade', 'pip') | Out-Host
    Invoke-Checked $pythonPath @('-m', 'pip', 'install', '-r', $RequirementsPath) | Out-Host
    return $pythonPath
}

function Seed-PiperSettings([string]$PiperExe, [string]$VoiceModel) {
    $settingsRoot = if ($env:APPDATA) { Join-Path $env:APPDATA 'narration-utils' } else { Join-Path $env:USERPROFILE 'AppData\Roaming\narration-utils' }
    $settingsPath = Join-Path $settingsRoot 'global-settings.json'
    New-Item -ItemType Directory -Force -Path $settingsRoot | Out-Null
    $settings = @{}
    if (Test-Path -LiteralPath $settingsPath) {
        $existing = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        foreach ($section in $existing.PSObject.Properties) {
            $values = @{}
            foreach ($entry in $section.Value.PSObject.Properties) { $values[$entry.Name] = $entry.Value }
            $settings[$section.Name] = $values
        }
    }
    if (-not $settings.ContainsKey('ManuscriptGuide')) { $settings['ManuscriptGuide'] = @{} }
    if (-not $settings['ManuscriptGuide'].ContainsKey('piper_exe')) { $settings['ManuscriptGuide']['piper_exe'] = $PiperExe }
    if (-not $settings['ManuscriptGuide'].ContainsKey('piper_model')) { $settings['ManuscriptGuide']['piper_model'] = $VoiceModel }
    $temporary = "$settingsPath.tmp"
    $settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $settingsPath -Force
}

function Install-PiperAssets([string]$GuidePython) {
    $piperExe = Join-Path (Split-Path -Parent $GuidePython) 'piper.exe'
    if (-not (Test-Path -LiteralPath $piperExe)) { throw "The local Piper executable was not installed: $piperExe" }
    $piperRoot = Join-Path $repoRoot 'shared\python\.piper'
    $voicesRoot = Join-Path $piperRoot 'voices'
    $modelPath = Join-Path $voicesRoot "$piperVoice.onnx"
    $configPath = "$modelPath.json"
    New-Item -ItemType Directory -Force -Path $voicesRoot | Out-Null
    if (-not (Test-Path -LiteralPath $modelPath)) {
        Write-Host "Downloading local Piper voice $piperVoice..."
        Invoke-WebRequest -Uri "$piperVoiceBaseUrl/$piperVoice.onnx" -OutFile $modelPath
    }
    if (-not (Test-Path -LiteralPath $configPath)) {
        Invoke-WebRequest -Uri "$piperVoiceBaseUrl/$piperVoice.onnx.json" -OutFile $configPath
    }
    Seed-PiperSettings $piperExe $modelPath
    Write-Host "Piper preview runtime is ready: $piperVoice"
}

$bootstrapPython = Get-BootstrapPython
$bootstrapPythonExecutable = [string]$bootstrapPython.Executable
$bootstrapPythonArguments = [string[]]@($bootstrapPython.Arguments)
if ([string]::IsNullOrWhiteSpace($bootstrapPythonExecutable)) { throw 'Private Python setup did not return an executable path.' }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw 'Node.js/npm is required to build the Narration Utils UI. Install Node.js LTS, then run this script again.' }
$npmExecutable = [string]$npm.Source
$dotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
if (-not $dotnet) { throw 'The .NET SDK is required to build the Narration Utils desktop host. Install the .NET SDK, then run this script again.' }
$dotnetExecutable = [string]$dotnet.Source

$guidePython = Install-Environment (Join-Path $repoRoot 'tools\manuscript-guide\core\.venv') (Join-Path $repoRoot 'tools\manuscript-guide\core\requirements.txt') 'Manuscript Guide'
$comparePython = Install-Environment (Join-Path $repoRoot 'tools\transcript-compare\core\.venv') (Join-Path $repoRoot 'tools\transcript-compare\core\requirements.txt') 'Transcript Compare'
Install-PiperAssets $guidePython

if (-not $SkipSpacyModel) {
    Write-Host 'Installing the Manuscript Guide spaCy language model...'
    Invoke-Checked $guidePython @('-m', 'spacy', 'download', 'en_core_web_sm')
}

Push-Location (Join-Path $repoRoot 'shared\ui')
try {
    Write-Host 'Installing UI dependencies and creating the production bundle...'
    & $npmExecutable ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)." }
    & $npmExecutable run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed ($LASTEXITCODE)." }
} finally {
    Pop-Location
}

Write-Host 'Publishing the Narration Utils desktop host...'
& $dotnetExecutable publish (Join-Path $repoRoot 'shared\hub\NarrationUtilsHub.csproj') -c Release
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)." }

Write-Host ''
Write-Host 'Narration Utils is ready.' -ForegroundColor Green
Write-Host 'In REAPER, load and run shared\reaper\NarrationUtils_Launcher.lua.'
