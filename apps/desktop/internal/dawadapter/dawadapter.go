// Package dawadapter is the boundary the review workflow calls a DAW through (audacity-integration PRD, Phase 3). Before it,
// transcript.Service wrote REAPER bridge commands by name; now it holds a Review and the REAPER bridge is that interface's first
// implementation (Reaper). A second DAW (the planned Audacity pipe client) implements the same interface instead of adding
// `if daw == "REAPER"` branches to the host or the UI. See docs/architecture/daw-integration.md, "The DAWAdapter seam".
//
// The extraction is behaviour-preserving: Reaper puts exactly the lines on the bridge that the service used to, and events keep
// flowing through the bridge client's one fan-out, so REAPER-only consumers that still hold *bridge.Client (pickups, line identity,
// project state, render config, take creation, reachability) share its cursor with the review workflow as before.
package dawadapter

import "github.com/countrymanprime/narration-utils/shell/internal/bridge"

// Event and Subscription are the bridge's event fan-out types, aliased rather than copied so a subscription made through an adapter
// and one made on the raw client are the same value, checked by the same table (bridge/wire.go). The event vocabulary the review
// workflow understands (the COMPARE_* family and ERROR, documented in docs/architecture/reaper-bridge.md) is part of this contract:
// another DAW's adapter reports its results as the same tags and fields.
type (
	Event        = bridge.Event
	Subscription = bridge.Subscription
)

// Events is the half of an adapter that reports what the DAW did: consumers subscribe for the tags they own, and Dispatch delivers
// whatever the DAW has reported since the last call, in order, once.
type Events interface {
	Subscribe(sub Subscription) (unsubscribe func())
	Dispatch() error
}

// MarkerColors are the colours, as RRGGBB hex, the host resolves from the layered settings and passes with an export, so the DAW
// never reads the settings files itself.
type MarkerColors struct{ Misread, Skipped, Extra string }

// Review is what the review workflow needs from a DAW. Each call only asks: the DAW answers later through Events, tagged with the
// runID passed here. Every method returns an error only when the request could not be handed to the DAW at all.
//
// Take management (take creation, pickups, line identity, render setup) is deliberately not here: it has no Audacity equivalent
// (docs/architecture/daw-integration.md, "Audacity boundary"), so those services stay on the REAPER bridge client.
type Review interface {
	Events
	// PrepareReview asks the DAW for the audio the narrator selected, to compare against the manuscript (COMPARE_PREPARED).
	PrepareReview(runID string) error
	// InspectFindings asks the DAW which of the findings in findingsPath it already carries as a marker or label, which is how a
	// finding that was reviewed earlier is recognised (COMPARE_MARKER per finding, then COMPARE_INSPECTED).
	InspectFindings(runID, findingsPath string) error
	// NavigateToFinding moves the DAW's cursor or selection to one finding of the run.
	NavigateToFinding(runID, findingID string) error
	// ExportFindings writes the run's pending findings into the DAW as markers or labels, skipping any it already has
	// (COMPARE_EXPORT_MARKER per finding, then COMPARE_EXPORTED).
	ExportFindings(runID, findingsPath string, colors MarkerColors) error
}

// ReviewFor returns the REAPER adapter over client, or nil when there is no bridge (a standalone launch). It never returns a non-nil
// interface wrapping a nil client, because callers decide "no DAW" by comparing the Review with nil.
func ReviewFor(client *bridge.Client) Review {
	if client == nil {
		return nil
	}
	return NewReaper(client)
}
