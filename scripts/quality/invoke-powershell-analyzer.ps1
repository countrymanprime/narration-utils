[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Path = @('scripts')
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue)) {
    throw 'PSScriptAnalyzer is required. Install it with: Install-Module PSScriptAnalyzer -Scope CurrentUser'
}

$excludedRules = @(
    # Quickstart is an interactive installer with established function names and
    # deliberate host-visible progress; these are not correctness concerns.
    'PSAvoidUsingWriteHost',
    'PSUseApprovedVerbs',
    'PSUseSingularNouns',
    'PSReviewUnusedParameter'
)

$results = foreach ($item in $Path) {
    Invoke-ScriptAnalyzer -Path $item -Recurse -Severity Error, Warning -ExcludeRule $excludedRules
}
if ($results) {
    $results | Format-Table -AutoSize | Out-String | Write-Error
    exit 1
}
