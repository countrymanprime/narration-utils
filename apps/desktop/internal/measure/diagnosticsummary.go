package measure

// DiagnosticSummary is what the windowed analyzers found in one file, as
// counts, for a view that lists files before their findings (the
// Diagnostics view, diagnostics PRD Phase 6). It carries no series: the
// short-term loudness and the silence map stay in Diagnostics.
type DiagnosticSummary struct {
	DurationSeconds float64 `json:"duration_seconds"`
	SampleRate      int     `json:"sample_rate"`
	Channels        int     `json:"channels"`
	// ClipRegions counts every clip region, including those past the
	// listed maximum.
	ClipRegions      int     `json:"clip_regions"`
	LevelShifts      int     `json:"level_shifts"`
	Silences         int     `json:"silences"`
	SilenceSeconds   float64 `json:"silence_seconds"`
	RoomToneSegments int     `json:"room_tone_segments"`
	// Pacing says whether transcript timing profiled the pauses, or why
	// not; WordsPerMinute is set only when it did.
	Pacing         Evidence `json:"pacing"`
	WordsPerMinute *float64 `json:"words_per_minute"`
}

// Summary counts what the analyzers found. The speaking rate is the timed
// words over the measured audio, and exists only with transcript timing:
// it is never estimated from the silence map.
func (d Diagnostics) Summary() DiagnosticSummary {
	summary := DiagnosticSummary{
		DurationSeconds:  d.DurationSeconds,
		SampleRate:       d.SampleRate,
		Channels:         d.Channels,
		ClipRegions:      d.Clipping.RegionCount,
		LevelShifts:      len(d.LevelShifts),
		Silences:         len(d.Silences),
		RoomToneSegments: len(d.RoomTone),
		Pacing:           d.Pacing.Evidence,
	}
	for _, region := range d.Silences {
		summary.SilenceSeconds += region.EndSeconds - region.StartSeconds
	}
	if d.Pacing.Status == StatusMeasured && d.words > 0 && d.DurationSeconds > 0 {
		rate := float64(d.words) / (d.DurationSeconds / 60)
		summary.WordsPerMinute = &rate
	}
	return summary
}
