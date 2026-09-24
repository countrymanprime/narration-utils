package tracks

import "sort"

// RecordedSeconds is how much audio the track holds as of the .rpp's last
// save (actual-recorded-column PRD Phase 2, AR2 A): the union of the project-
// time intervals of its unmuted items, on playing lanes only for a track in
// fixed-lane mode, with overlapping and touching items merged so a retake
// stacked over another is counted once. It is project time, so an item's
// PLAYRATE and SOFFS do not change it. A track with nothing audible is 0.
func (track Track) RecordedSeconds() float64 {
	spans := make([]Span, 0, len(track.Items))
	for _, item := range track.Items {
		if item.Muted || item.Length <= 0 || (track.FixedLanes && !track.LanePlays(item.Lane)) {
			continue
		}
		spans = append(spans, Span{Start: item.Position, End: item.Position + item.Length})
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].Start < spans[j].Start })
	total := 0.0
	for i := 0; i < len(spans); {
		current := spans[i]
		for i++; i < len(spans) && spans[i].Start <= current.End; i++ {
			current.End = max(current.End, spans[i].End)
		}
		total += current.End - current.Start
	}
	return total
}
