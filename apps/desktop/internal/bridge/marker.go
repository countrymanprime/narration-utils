package bridge

import (
	"context"
	"errors"
	"strings"
)

// ErrNoMarkerName: the marker to add has no name, so there is no issue prefix for REAPER's duplicate rule to compare.
var ErrNoMarkerName = errors.New("the marker has no name")

// Marker is the take marker to add for a finding the narrator accepted: its name (an issue prefix such as "MISREAD:"
// first, which is what REAPER's duplicate rule compares) and its colour as RRGGBB hex (empty for REAPER's default).
type Marker struct {
	Name  string
	Color string
}

// MarkerResult is what REAPER did: Added is true when it added the marker, false when the take already had one of the
// same kind within 0.15 s (Name is then that marker's name, and nothing changed). TakeGUID is the take it is on and
// SourceTime where, in the take's source seconds.
type MarkerResult struct {
	Added      bool
	TakeGUID   string
	SourceTime float64
	Name       string
}

// AddMarker asks REAPER to add one take marker at the finding's source time, on its take (the active one when the
// target names none), in one undo block (add_finding_marker in integrations/reaper/narration_navigation.lua;
// review-dashboard PRD Phase 8, ADR 0123). It is found and refused the way Navigate is: a *StaleError when the item,
// take or spot is gone, ErrRecording while REAPER records, and nothing is sent for a target with no item GUID or
// source time, or a marker with no name.
func (n *Navigator) AddMarker(ctx context.Context, target Target, marker Marker) (MarkerResult, error) {
	switch {
	case target.ItemGUID == "":
		return MarkerResult{}, ErrNoItemIdentity
	case target.SourceStart == nil || !finite(*target.SourceStart):
		return MarkerResult{}, ErrNoSourceTime
	case strings.TrimSpace(marker.Name) == "":
		return MarkerResult{}, ErrNoMarkerName
	}
	event, err := n.request(ctx, "add_finding_marker", target.ItemGUID, target.TakeGUID, formatSeconds(*target.SourceStart), marker.Color, marker.Name)
	if err != nil {
		return MarkerResult{}, err
	}
	if event.Tag != "FINDING_MARKER" {
		return MarkerResult{}, unexpected(event)
	}
	return MarkerResult{Added: event.Fields[2] == "added", TakeGUID: event.Fields[3], SourceTime: numberAt(event.Fields, 4), Name: event.Fields[5]}, nil
}
