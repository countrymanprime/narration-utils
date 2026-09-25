package dawadapter

import "github.com/countrymanprime/narration-utils/shell/internal/bridge"

// Reaper is the Review implementation over the REAPER file bridge: each operation is one bridge command, named as
// integrations/reaper/narration_ui_bridge.lua dispatches it, and events come from the client's shared fan-out.
type Reaper struct{ client *bridge.Client }

var _ Review = (*Reaper)(nil)

// NewReaper wraps a bridge client. client must not be nil; use ReviewFor when it may be.
func NewReaper(client *bridge.Client) *Reaper { return &Reaper{client: client} }

func (r *Reaper) Subscribe(sub Subscription) (unsubscribe func()) { return r.client.Subscribe(sub) }

func (r *Reaper) Dispatch() error { return r.client.Dispatch() }

func (r *Reaper) PrepareReview(runID, projectFolder string) error {
	if projectFolder == "" {
		return r.send("prepare_compare", runID)
	}
	return r.send("prepare_compare", runID, projectFolder)
}

func (r *Reaper) InspectFindings(runID, findingsPath string) error {
	return r.send("inspect_compare_results", runID, findingsPath)
}

func (r *Reaper) NavigateToFinding(runID, findingID string) error {
	return r.send("jump_to_compare_marker", runID, findingID)
}

func (r *Reaper) ExportFindings(runID, findingsPath string, colors MarkerColors) error {
	return r.send("export_compare_markers", runID, findingsPath, colors.Misread, colors.Skipped, colors.Extra)
}

func (r *Reaper) send(action string, fields ...string) error {
	_, err := r.client.Send(action, fields)
	return err
}
