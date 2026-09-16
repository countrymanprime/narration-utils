[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Path = @('scripts')
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue)) {
    throw 'PSScriptAnalyzer is required. Run: npm run bootstrap'
}

$excludedRules = @(
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
