package main

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The Review page's approved marker (review-dashboard-and-findings-adoption.prd.md Phase 8, Q8; ADR 0123): one take
// marker in REAPER for one finding the narrator accepted, sent only after they confirm it. It goes through the same
// navigator, the same refusals and the same "only while REAPER is listening" rule as Go to (bindings_navigation.go), and
// it is the one REAPER action from the page that changes the project, so REAPER wraps it in one undo block. The batch
// Export markers action stays on the Transcript page.

// FindingMarker is what adding the approved marker did: Outcome "added" (Name is the marker REAPER added), "existing"
// (the take already had a marker of the same kind within 0.15 s, named Name, so nothing changed) or "refused" (Reason
// and Message say why; nothing in REAPER changed). SourceTime is where the marker is, in the take's source seconds.
type FindingMarker struct {
	Outcome    string   `json:"outcome"`
	Reason     string   `json:"reason,omitempty"`
	Message    string   `json:"message,omitempty"`
	Name       string   `json:"name,omitempty"`
	SourceTime *float64 `json:"sourceTime,omitempty"`
}

const (
	refusedNotAccepted = "not_accepted"

	messageNotAccepted        = "Accept this finding first. Only a finding you accepted gets a marker in REAPER."
	messageMarkerNoItem       = "This finding has no REAPER item to mark, because it came from an older check. Run the check again to record one."
	messageMarkerNoSourceTime = "This finding has no time in its audio to put a marker at."
	messageMarkerRecording    = "REAPER is recording, so no marker was added. Stop recording first."
	messageMarkerStaleSuffix  = ", so no marker was added. Run the check again to find it where it is now."
)

// FindingsAddMarker adds one take marker in REAPER at an accepted finding's spot, on its take, named like the marker
// Transcript Compare's export adds (approvedMarker). A finding not accepted, one with no item or no time in its audio,
// and a REAPER that is not listening are refused before anything is sent.
func (h *Host) FindingsAddMarker(id string) (string, error) {
	svc := h.services()
	if svc.findings == nil {
		return "", errNoProject
	}
	finding, err := existingFinding(svc.findings, id)
	if err != nil {
		return "", err
	}
	target := navigationTarget(finding)
	switch {
	case finding.Review.Status != findings.StatusAccepted:
		return encodeBinding(markerRefused(refusedNotAccepted, messageNotAccepted), nil)
	case target.ItemGUID == "":
		return encodeBinding(markerRefused(refusedNoItem, messageMarkerNoItem), nil)
	case target.SourceStart == nil:
		return encodeBinding(markerRefused(refusedNoSourceTime, messageMarkerNoSourceTime), nil)
	}
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return encodeBinding(markerRefused(status.Connection, status.Message), nil)
	}
	result, err := svc.navigation.navigator.AddMarker(context.Background(), target, approvedMarker(finding, svc.settings))
	if err != nil {
		return encodeBinding(markerRefusal(err), nil)
	}
	outcome := "existing"
	if result.Added {
		outcome = "added"
	}
	return encodeBinding(FindingMarker{Outcome: outcome, Name: result.Name, SourceTime: &result.SourceTime}, nil)
}

func markerRefused(reason, message string) FindingMarker {
	return FindingMarker{Outcome: "refused", Reason: reason, Message: message}
}

// markerRefusal words what REAPER answered for a marker: the navigation refusals, but saying no marker was added.
func markerRefusal(err error) FindingMarker {
	var stale *bridge.StaleError
	switch {
	case errors.As(err, &stale):
		return markerRefused(refusedStale, capitalized(stale.Error())+messageMarkerStaleSuffix)
	case errors.Is(err, bridge.ErrRecording):
		return markerRefused(refusedRecording, messageMarkerRecording)
	}
	refused := refusal(err)
	return markerRefused(refused.Reason, refused.Message)
}

// markerWords is how many words of the script or the recording a marker name quotes, as compare.py's snippet does.
const markerWords = 8

var markerKindPattern = regexp.MustCompile(`^[A-Za-z_]+$`)

// markerColorSettings are the Transcript Compare colours (Settings > Transcript Compare) the export colours its markers
// with, with the same fallbacks transcript.Service.Export uses; any other kind gets REAPER's default colour.
var markerColorSettings = map[string][2]string{
	"MISREAD": {"color_misread", "FF4040"},
	"SKIPPED": {"color_skipped", "FFC000"},
	"EXTRA":   {"color_extra", "40A0FF"},
}

// approvedMarker is the take marker for an accepted finding, named and coloured like the one Transcript Compare's
// export adds for the same row ("MISREAD: 'script' as 'heard'", compare.py), so the export's duplicate rule, which
// compares the issue prefix, sees it and never doubles it. The prefix is the finding's evidence kind, or its category
// for an analyzer that records no kind.
func approvedMarker(finding findings.Finding, store *settings.Store) bridge.Marker {
	kind := strings.ToUpper(string(finding.Category))
	if value, ok := finding.Evidence["kind"].(string); ok && markerKindPattern.MatchString(value) {
		kind = strings.ToUpper(value)
	}
	var expected, recorded string
	if finding.Manuscript != nil {
		expected, recorded = markerSnippet(finding.Manuscript.Expected), markerSnippet(finding.Manuscript.Recorded)
	}
	body := "approved finding"
	switch {
	case expected != "" && recorded != "":
		body = "'" + expected + "' as '" + recorded + "'"
	case expected != "":
		body = "'" + expected + "'"
	case recorded != "":
		body = "'" + recorded + "'"
	}
	marker := bridge.Marker{Name: kind + ": " + body}
	if setting, ok := markerColorSettings[kind]; ok {
		marker.Color = setting[1]
		if store != nil {
			marker.Color, _ = store.Effective("TranscriptCompare", setting[0], setting[1])
		}
	}
	return marker
}

// markerSnippet is the text on one line, cut to markerWords words with " ..." after, as compare.py's snippet does.
func markerSnippet(text string) string {
	words := strings.Fields(text)
	if len(words) > markerWords {
		return strings.Join(words[:markerWords], " ") + " ..."
	}
	return strings.Join(words, " ")
}
