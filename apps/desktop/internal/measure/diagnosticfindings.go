package measure

import (
	"fmt"
	"math"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// diagnosticsAnalyzer names the windowed analyzers in their findings.
const diagnosticsAnalyzer = "diagnostics"

// The kinds of diagnostic finding, in evidence["kind"].
const (
	kindClipping       = "clipping"
	kindLevelShift     = "level_shift"
	kindRoomToneChange = "room_tone_change"
	kindLongPause      = "long_pause"
)

// Findings turns the diagnostics into findings for review: audio_quality
// for clipping, level shifts and room-tone changes, and pacing for long
// pauses, which exist only when transcript timing does. Every finding
// carries the thresholds that raised it and the source kind.
//
// Times are in the source file: the range start (if any) is added back.
// A file measured on its own has no project timeline, so time_range's
// start and end are those same source seconds; a caller that knows where
// the audio sits in a project re-bases them.
//
// An id is the file, the kind and the source time the finding starts at
// (to the millisecond), so the same event keeps its id whether the whole
// file or a range around it was measured, and whatever the thresholds.
func (d Diagnostics) Findings() []findings.Finding {
	out := []findings.Finding{}
	for _, region := range d.Clipping.Regions {
		out = append(out, d.clipFinding(region))
	}
	for _, shift := range d.LevelShifts {
		out = append(out, d.levelShiftFinding(shift))
	}
	for i := 1; i < len(d.RoomTone); i++ {
		out = append(out, d.roomToneFinding(d.RoomTone[i-1], d.RoomTone[i]))
	}
	if d.Pacing.Status == StatusMeasured && d.Pacing.PauseSummary != nil {
		for _, pause := range d.Pacing.LongPauses {
			out = append(out, d.longPauseFinding(pause))
		}
	}
	return out
}

func (d Diagnostics) clipFinding(region ClipRegion) findings.Finding {
	evidence := d.evidence(kindClipping)
	evidence["ceiling_dbfs"] = d.Options.ClipCeilingdBFS
	evidence["min_run_samples"] = minClipRunSamples
	evidence["channels"] = region.Channels
	evidence["longest_run_samples"] = region.LongestRunSamples
	confidence := 1.0
	reason := fmt.Sprintf("deterministic: runs of %d or more samples at or above the ceiling in the decoded audio of a %s", minClipRunSamples, d.SourceKind.label())
	return d.newFinding(kindClipping, findings.CategoryAudioQuality, findings.SeverityWarning, region.StartSeconds, region.EndSeconds, &confidence, reason, evidence)
}

func (d Diagnostics) levelShiftFinding(shift LevelShift) findings.Finding {
	evidence := d.evidence(kindLevelShift)
	evidence["before_lufs"] = shift.BeforeLUFS
	evidence["after_lufs"] = shift.AfterLUFS
	evidence["delta_lu"] = shift.DeltaLU
	evidence["level_shift_lu"] = d.Options.LevelShiftLU
	evidence["context_seconds"] = float64(levelShiftContextPoints * shortTermHopBlocks * subBlockSeconds)
	reason := fmt.Sprintf("a candidate from the mean short-term loudness of the read either side, in a %s; a deliberate change in delivery moves it too, so listen before acting", d.SourceKind.label())
	return d.newFinding(kindLevelShift, findings.CategoryAudioQuality, findings.SeverityWarning, shift.StartSeconds, shift.EndSeconds, nil, reason, evidence)
}

// roomToneFinding reports the change between two room-tone segments,
// ranged over the read between the last silence of one and the first of
// the next. A raw recording's room changing mid-session is a warning; a
// render's room tone may have been changed on purpose, so it is info.
func (d Diagnostics) roomToneFinding(before, after RoomToneSegment) findings.Finding {
	evidence := d.evidence(kindRoomToneChange)
	evidence["before_dbfs"] = before.LeveldBFS
	evidence["after_dbfs"] = after.LeveldBFS
	evidence["delta_db"] = after.LeveldBFS - before.LeveldBFS
	evidence["room_tone_step_db"] = d.Options.RoomToneStepDB
	evidence["silence_floor_dbfs"] = d.Options.SilenceFloordBFS
	evidence["min_silence_seconds"] = d.Options.MinSilenceSeconds
	severity := findings.SeverityWarning
	if d.SourceKind == SourceProcessedRender {
		severity = findings.SeverityInfo
	}
	reason := fmt.Sprintf("a candidate from the RMS of the silences either side, in a %s; a pickup session, a noise gate or noise reduction also changes it", d.SourceKind.label())
	return d.newFinding(kindRoomToneChange, findings.CategoryAudioQuality, severity, before.EndSeconds, after.StartSeconds, nil, reason, evidence)
}

// longPauseFinding is information, never a defect: a pause is only long
// against the narrator's threshold, and many are intended.
func (d Diagnostics) longPauseFinding(pause Pause) findings.Finding {
	evidence := d.evidence(kindLongPause)
	evidence["duration_seconds"] = pause.DurationSeconds
	evidence["long_pause_seconds"] = d.Pacing.LongPauseSeconds
	evidence["min_pause_seconds"] = d.Pacing.MinPauseSeconds
	reason := fmt.Sprintf("timed from the transcript's word timing, which speech recognition places only approximately, in a %s", d.SourceKind.label())
	return d.newFinding(kindLongPause, findings.CategoryPacing, findings.SeverityInfo, pause.StartSeconds, pause.StartSeconds+pause.DurationSeconds, nil, reason, evidence)
}

func (d Diagnostics) evidence(kind string) map[string]any {
	return map[string]any{"kind": kind, "source_kind": d.SourceKind}
}

func (d Diagnostics) newFinding(kind string, category findings.Category, severity findings.Severity, start, end float64, confidence *float64, reason string, evidence map[string]any) findings.Finding {
	offset := 0.0
	if d.Range != nil {
		offset = d.Range.StartSeconds
	}
	sourceStart, sourceEnd := offset+start, offset+end
	return findings.Finding{
		SchemaVersion: findings.SchemaVersion,
		ID:            findings.StableID(diagnosticsAnalyzer, d.File, kind, fmt.Sprint(math.Round(sourceStart*1000))),
		Analyzer:      diagnosticsAnalyzer,
		Source:        findings.Source{File: d.File},
		TimeRange: &findings.TimeRange{
			Start: sourceStart, End: sourceEnd,
			SourceStart: &sourceStart, SourceEnd: &sourceEnd,
		},
		Category:         category,
		Severity:         severity,
		Confidence:       confidence,
		ConfidenceReason: reason,
		Evidence:         evidence,
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}
