package tracks

// Span is a project-time range in seconds, such as a chapter region.
type Span struct {
	Start float64
	End   float64
}

// RecordedEnd is where a track's recorded audio ends (teleprompter-manuscript-
// integration PRD Phase 8, the resume pipeline's step 2), as of the .rpp's
// last save: in project time, and in the source file the last item plays, so
// a later step can cut the audio just before it.
type RecordedEnd struct {
	// ProjectTime is the latest item end (POSITION + LENGTH).
	ProjectTime float64 `json:"projectTime"`
	// ItemGUID and TakeGUID name the item ending last and its active take.
	ItemGUID string `json:"itemGuid"`
	TakeGUID string `json:"takeGuid"`
	// SourceFile is that take's resolved source; SourceTime is where in it the
	// item ends: the SECTION start (when the source is a trimmed section) +
	// SOFFS + LENGTH * PLAYRATE. SourceStart is where in it the item starts
	// (the SECTION start + SOFFS), so a tail cut before SourceTime never
	// reaches audio the narrator trimmed off the item (Phase 9).
	SourceFile      string  `json:"sourceFile"`
	SourceStart     float64 `json:"sourceStart"`
	SourceTime      float64 `json:"sourceTime"`
	SourceAvailable bool    `json:"sourceAvailable"`
	Supported       bool    `json:"supported"`
	// Approximate is set when SourceTime cannot be exact from the file alone:
	// the take has stretch markers (which bend time within the item), or it
	// plays past the end of its section (which loops).
	Approximate bool `json:"approximate"`
}

// RecordedEnd finds the unmuted item that ends last on the track and where
// its active take's source audio ends. With within set, only items that
// overlap that span count (a chapter region on a track holding several
// chapters). It reports false when no unmuted item qualifies: a chapter with
// nothing recorded yet is a state, not an error.
func (track Track) RecordedEnd(within *Span) (RecordedEnd, bool) {
	var last *Item
	for i := range track.Items {
		item := &track.Items[i]
		if item.Muted || (within != nil && !overlaps(*item, *within)) {
			continue
		}
		if last == nil || item.Position+item.Length > last.Position+last.Length {
			last = item
		}
	}
	if last == nil {
		return RecordedEnd{}, false
	}
	take := last.Active()
	rate := take.PlayRate
	if rate <= 0 {
		rate = 1 // no PLAYRATE line: REAPER's default rate
	}
	played := take.SOFFS + last.Length*rate
	sourceStart, sourceTime, approximate := take.SOFFS, played, take.StretchMarkerCount > 0
	if take.Section != nil {
		sourceStart += take.Section.StartPos
		sourceTime += take.Section.StartPos
		if take.Section.Length > 0 && played > take.Section.Length {
			approximate = true
		}
	}
	return RecordedEnd{
		ProjectTime:     last.Position + last.Length,
		ItemGUID:        last.GUID,
		TakeGUID:        take.GUID,
		SourceFile:      take.SourceFile,
		SourceStart:     sourceStart,
		SourceTime:      sourceTime,
		SourceAvailable: take.SourceAvailable,
		Supported:       take.Supported,
		Approximate:     approximate,
	}, true
}

// overlaps reports whether item plays at any time inside span (touching its
// edges does not count).
func overlaps(item Item, span Span) bool {
	return item.Position < span.End && item.Position+item.Length > span.Start
}
