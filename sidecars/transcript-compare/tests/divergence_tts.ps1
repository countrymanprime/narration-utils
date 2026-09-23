<#
.SYNOPSIS
Renders the per-take divergence cases to speech with a known onset for every word.

.DESCRIPTION
Take-review PRD Phase 9 (Q10): the manual, real-ASR half of the divergence evaluation
(docs/research/take-divergence-evaluation.md). Reads the texts written by
`divergence_harness.py --tts-plan <plan.json>` and, for each case, speaks it with a Windows
System.Speech voice into <OutDir>\<case>.wav (16 kHz, 16-bit, mono) and writes
<OutDir>\<case>.json: one {"text", "char", "start"} per word the voice reported, where "char" is
the word's character offset in the case's text and "start" its onset in seconds. The harness
turns those onsets into each said word's true time, then scores Whisper's words against them.

Offline and Windows-only; nothing is downloaded. The audio is scratch output: keep it out of the
repository.

.EXAMPLE
python sidecars/transcript-compare/tests/divergence_harness.py --tts-plan $env:TEMP\plan.json
pwsh sidecars/transcript-compare/tests/divergence_tts.ps1 -Plan $env:TEMP\plan.json -OutDir $env:TEMP\divergence-audio
#>
param(
    [Parameter(Mandatory)] [string] $Plan,
    [Parameter(Mandatory)] [string] $OutDir,
    [string] $Voice = 'Microsoft David Desktop',
    [int] $Rate = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$items = Get-Content -Raw -Encoding utf8 $Plan | ConvertFrom-Json

foreach ($item in $items) {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        $synth.SelectVoice($Voice)
        $synth.Rate = $Rate
        $events = New-Object System.Collections.ArrayList
        $synth.add_SpeakProgress([System.EventHandler[System.Speech.Synthesis.SpeakProgressEventArgs]] {
                param($source, $e)
                [void]$events.Add([ordered]@{ text = $e.Text; char = $e.CharacterPosition; start = [math]::Round($e.AudioPosition.TotalSeconds, 3) })
            })
        $synth.SetOutputToWaveFile((Join-Path $OutDir "$($item.id).wav"), $format)
        $synth.Speak([string]$item.text)
        $synth.SetOutputToNull()
        ConvertTo-Json -InputObject @($events) -Depth 3 | Set-Content -Encoding utf8 (Join-Path $OutDir "$($item.id).json")
        Write-Output "$($item.id): $($events.Count) words"
    }
    finally {
        $synth.Dispose()
    }
}
