<#
.SYNOPSIS
Creates every local runtime Narration Utils needs and builds its React UI.

.DESCRIPTION
Downloads a private Python runtime, creates one shared Python environment for
every first-party tool (Manuscript Guide, Transcript Compare, and the shared
server/config code), builds the React UI, and builds the two Rust
components (shared/manuscript-import and the shell/src-tauri native app).
Machine prerequisites are Node.js/npm and a Rust toolchain (rustup) with,
on Windows, the "Desktop development with C++" Visual Studio workload. All
Python runtimes, Python packages, the virtual environment, Node packages,
and Cargo build output remain inside this checkout and are excluded from
Git. Rust builds always run (cargo/npm build incrementally, so a rerun
after editing shell/ or shared/manuscript-import/ only rebuilds what
changed).

Dependency handling (the Python venv, spaCy model, npm packages, the tauri-cli
cargo subcommand) has three modes:

  (default)            Install only what's missing. An existing venv, an
                        existing node_modules, an already-downloaded spaCy
                        model, or an already-installed
                        tauri-cli are left alone untouched.
  -SkipDependencies     Skip dependency checks entirely, even for missing
                        ones. Only use this if you already know everything
                        is installed; the build steps still run.
  -UpdateDependencies   Force every dependency to be reinstalled/updated to
                        latest (pip install --upgrade, npm update, spaCy
                        model re-download, tauri-cli reinstall), even where
                        already installed.
#>
[CmdletBinding()]
param(
    [switch]$SkipDependencies,
    [switch]$UpdateDependencies,
    [Alias('BootstrapPython')]
    [string]$BootstrapPythonPath
)

if ($SkipDependencies -and $UpdateDependencies) { throw '-SkipDependencies and -UpdateDependencies cannot be used together.' }

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$embeddedPythonVersion = '3.12.10'

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
        try { & $BootstrapPythonPath --version 2>$null | Out-Null; $available = $LASTEXITCODE -eq 0 } catch { Write-Verbose "Bootstrap Python version check failed: $($_.Exception.Message)" }
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
    $environmentExisted = Test-Path -LiteralPath $pythonPath

    if (-not $environmentExisted) {
        if ($SkipDependencies) { throw "$Name environment does not exist and -SkipDependencies was passed. Run once without it first." }
        Write-Host "Creating $Name environment..."
        Invoke-Checked -CommandPath $bootstrapPythonExecutable -CommandArguments ($bootstrapPythonArguments + @('-m', 'venv', $EnvironmentPath)) | Out-Host
    }

    if ($SkipDependencies) {
        Write-Host "Skipping $Name dependency check."
    } elseif ($environmentExisted -and -not $UpdateDependencies) {
        Write-Host "$Name dependencies already installed; skipping (pass -UpdateDependencies to refresh)."
    } elseif ($UpdateDependencies) {
        Write-Host "Updating $Name dependencies..."
        Invoke-Checked $pythonPath @('-m', 'pip', 'install', '--upgrade', 'pip') | Out-Host
        Invoke-Checked $pythonPath @('-m', 'pip', 'install', '--upgrade', '-r', $RequirementsPath) | Out-Host
    } else {
        Write-Host "Installing $Name dependencies..."
        Invoke-Checked $pythonPath @('-m', 'pip', 'install', '--upgrade', 'pip') | Out-Host
        Invoke-Checked $pythonPath @('-m', 'pip', 'install', '-r', $RequirementsPath) | Out-Host
    }
    return $pythonPath
}

$bootstrapPython = Get-BootstrapPython
$bootstrapPythonExecutable = [string]$bootstrapPython.Executable
$bootstrapPythonArguments = [string[]]@($bootstrapPython.Arguments)
if ([string]::IsNullOrWhiteSpace($bootstrapPythonExecutable)) { throw 'Private Python setup did not return an executable path.' }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw 'Node.js/npm is required to build the Narration Utils UI. Install Node.js LTS, then run this script again.' }
$npmExecutable = [string]$npm.Source

$cargo = Get-Command cargo.exe -ErrorAction SilentlyContinue
if (-not $cargo) { throw 'A Rust toolchain is required to build shared/manuscript-import and the shell app. Install it via https://rustup.rs (on Windows, also install the "Desktop development with C++" Visual Studio workload), then run this script again.' }
$cargoExecutable = [string]$cargo.Source

function Install-TauriCli {
    $tauriCliInstalled = $false
    try { & $cargoExecutable 'tauri' '--version' *> $null; $tauriCliInstalled = ($LASTEXITCODE -eq 0) } catch { Write-Verbose "tauri-cli version check failed: $($_.Exception.Message)" }

    if ($SkipDependencies) {
        if (-not $tauriCliInstalled) { throw 'tauri-cli (cargo tauri) is not installed and -SkipDependencies was passed. Run once without it first.' }
        Write-Host 'Skipping tauri-cli dependency check.'
    } elseif ($tauriCliInstalled -and -not $UpdateDependencies) {
        Write-Host 'tauri-cli already installed; skipping (pass -UpdateDependencies to refresh).'
    } else {
        Write-Host $(if ($UpdateDependencies) { 'Updating tauri-cli...' } else { 'Installing tauri-cli...' })
        Invoke-Checked $cargoExecutable @('install', 'tauri-cli', '--version', '^2', '--locked') | Out-Host
    }
}

function Install-RootTooling {
    Push-Location $repoRoot
    try {
        $nodeModulesExisted = Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules')
        if ($SkipDependencies) {
            if (-not $nodeModulesExisted) { throw 'root node_modules does not exist and -SkipDependencies was passed. Run once without it first.' }
            Write-Host 'Skipping root developer-tooling install.'
        } elseif ($UpdateDependencies -and $nodeModulesExisted) {
            Write-Host 'Updating root developer tooling...'
            & $npmExecutable update
            if ($LASTEXITCODE -ne 0) { throw "npm update (root) failed ($LASTEXITCODE)." }
        } elseif (-not $nodeModulesExisted) {
            Write-Host 'Installing root developer tooling and Git hooks...'
            & $npmExecutable ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci (root) failed ($LASTEXITCODE)." }
        } else {
            Write-Host 'Root developer tooling already installed; skipping (pass -UpdateDependencies to refresh).'
        }
    } finally {
        Pop-Location
    }
}

function Install-QualityTools {
    $styluaInstalled = $false
    try { & $cargoExecutable 'stylua' '--version' *> $null; $styluaInstalled = ($LASTEXITCODE -eq 0) } catch { Write-Verbose "Stylua version check failed: $($_.Exception.Message)" }
    if ($SkipDependencies) {
        if (-not $styluaInstalled) { throw 'stylua is required for the pre-commit quality gate and -SkipDependencies was passed.' }
        Write-Host 'Skipping Stylua dependency check.'
    } elseif (-not $styluaInstalled -or $UpdateDependencies) {
        Write-Host 'Installing Stylua for Lua formatting checks...'
        Invoke-Checked $cargoExecutable @('install', 'stylua', '--version', '2.1.0', '--locked') | Out-Host
    }

    if (-not (Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue) -or $UpdateDependencies) {
        if ($SkipDependencies) { throw 'PSScriptAnalyzer is required for the pre-commit quality gate and -SkipDependencies was passed.' }
        Write-Host 'Installing PSScriptAnalyzer for PowerShell checks...'
        Install-Module PSScriptAnalyzer -Scope CurrentUser -Force
    }
}

$null = Install-RootTooling
$sharedPython = Install-Environment (Join-Path $repoRoot '.venv') (Join-Path $repoRoot 'requirements.txt') 'Narration Utils'
if ($SkipDependencies) {
    Write-Host 'Skipping dev-tooling dependency check.'
} elseif (-not $UpdateDependencies) {
    Invoke-Checked $sharedPython @('-m', 'pip', 'install', '-r', (Join-Path $repoRoot 'tools\requirements-dev.txt')) | Out-Host
} else {
    Invoke-Checked $sharedPython @('-m', 'pip', 'install', '--upgrade', '-r', (Join-Path $repoRoot 'tools\requirements-dev.txt')) | Out-Host
}

$spacyModels = @('en_core_web_sm', 'en_core_web_lg')
$missingSpacyModels = @()
if (-not $SkipDependencies) {
    foreach ($spacyModel in $spacyModels) {
        & $sharedPython '-m' 'pip' 'show' $spacyModel *> $null
        if ($LASTEXITCODE -ne 0) { $missingSpacyModels += $spacyModel }
    }
}
if ($SkipDependencies) {
    Write-Host 'Skipping spaCy language model check.'
} elseif ($missingSpacyModels.Count -eq 0 -and -not $UpdateDependencies) {
    Write-Host 'spaCy language models already installed; skipping (pass -UpdateDependencies to refresh).'
} else {
    foreach ($spacyModel in $spacyModels) {
        Write-Host "Installing the Manuscript Guide spaCy language model $spacyModel..."
        Invoke-Checked $sharedPython @('-m', 'spacy', 'download', $spacyModel)
    }
}

Push-Location (Join-Path $repoRoot 'shared\ui')
try {
    $nodeModulesExisted = Test-Path -LiteralPath (Join-Path (Get-Location) 'node_modules')
    if ($SkipDependencies) {
        if (-not $nodeModulesExisted) { throw 'shared/ui/node_modules does not exist and -SkipDependencies was passed. Run once without it first.' }
        Write-Host 'Skipping UI dependency install.'
    } elseif ($nodeModulesExisted -and -not $UpdateDependencies) {
        Write-Host 'UI dependencies already installed; skipping (pass -UpdateDependencies to refresh).'
    } elseif ($UpdateDependencies -and $nodeModulesExisted) {
        Write-Host 'Updating UI dependencies...'
        & $npmExecutable update
        if ($LASTEXITCODE -ne 0) { throw "npm update failed ($LASTEXITCODE)." }
    } else {
        Write-Host 'Installing UI dependencies...'
        & $npmExecutable ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)." }
    }
    Write-Host 'Creating the production UI bundle...'
    & $npmExecutable run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed ($LASTEXITCODE)." }
} finally {
    Pop-Location
}

Write-Host 'Building the manuscript importer (shared/manuscript-import)...'
Push-Location (Join-Path $repoRoot 'shared\manuscript-import')
try {
    Invoke-Checked $cargoExecutable @('build', '--release') | Out-Host
} finally {
    Pop-Location
}

Install-TauriCli
Install-QualityTools

Write-Host 'Building the native shell app (shell/)...'
Push-Location (Join-Path $repoRoot 'shell')
try {
    & $npmExecutable run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build (shell) failed ($LASTEXITCODE)." }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Narration Utils is ready.' -ForegroundColor Green
Write-Host 'In REAPER, load and run shared\reaper\NarrationUtils_Launcher.lua.'
