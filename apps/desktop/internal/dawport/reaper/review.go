package reaper

import (
	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// review is the REAPER adapter's ReviewSession (ADR 0143's dawadapter.Review before DAW port PRD P8 retired that package): each
// operation is one bridge command, named as integrations/reaper/narration_ui_bridge.lua dispatches it, and events come from the
// client's shared fan-out.
type review struct{ client *bridge.Client }

var _ dawport.ReviewSession = review{}

func (r review) Subscribe(sub dawport.Subscription) (unsubscribe func()) {
	return r.client.Subscribe(sub)
}

func (r review) Dispatch() error { return r.client.Dispatch() }

func (r review) PrepareReview(runID, projectFolder string) error {
	if projectFolder == "" {
		return r.send("prepare_compare", runID)
	}
	return r.send("prepare_compare", runID, projectFolder)
}

func (r review) InspectFindings(runID, findingsPath string) error {
	return r.send("inspect_compare_results", runID, findingsPath)
}

func (r review) NavigateToFinding(runID, findingID string) error {
	return r.send("jump_to_compare_marker", runID, findingID)
}

func (r review) ExportFindings(runID, findingsPath string, colors dawport.MarkerColors) error {
	return r.send("export_compare_markers", runID, findingsPath, colors.Misread, colors.Skipped, colors.Extra)
}

func (r review) send(action string, fields ...string) error {
	_, err := r.client.Send(action, fields)
	return err
}

// ReviewFor returns the REAPER review session over client, or nil when there is no bridge (a standalone launch). It never
// returns a non-nil interface wrapping a nil client, because callers decide "no DAW" by comparing the session with nil.
func ReviewFor(client *bridge.Client) dawport.ReviewSession {
	if client == nil {
		return nil
	}
	return review{client: client}
}
