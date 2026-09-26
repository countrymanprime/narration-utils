package reaper

import (
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// The asynchronous roles (ADR 0302): each method writes one bridge command, named and laid out exactly as its service writes it
// today, and the answer arrives through the client's fan-out as today's event tags. Each role is its own small type, so a consumer
// holding one cannot reach another's commands.

// events is what every asynchronous role shares: the session's client, its fan-out, and the one way to write a command.
type events struct{ client *bridge.Client }

func (e events) Subscribe(sub dawport.Subscription) (unsubscribe func()) {
	return e.client.Subscribe(sub)
}

func (e events) Dispatch() error { return e.client.Dispatch() }

func (e events) send(command string, fields ...string) error {
	_, err := e.client.Send(command, fields)
	return err
}

// pickupList is internal/pickups' commands.
type pickupList struct{ events }

func (p pickupList) ImportPickups(runID, payloadPath string) error {
	return p.send("import_pickups", runID, payloadPath)
}

func (p pickupList) ExportPickups(runID, outputPath string) error {
	return p.send("export_pickups", runID, outputPath)
}

func (p pickupList) NextPickup(runID string) error { return p.send("next_pickup", runID) }

func (p pickupList) ResolvePickup(runID string, position float64) error {
	return p.send("resolve_pickup", runID, strconv.FormatFloat(position, 'f', 6, 64))
}

func (p pickupList) CountPickups(runID string) error { return p.send("count_pickups", runID) }

// lineStamper is internal/lineidentity's commands.
type lineStamper struct{ events }

func (l lineStamper) StampLines(runID, payloadPath string, overwrite bool) error {
	overwriteFlag := "0"
	if overwrite {
		overwriteFlag = "1"
	}
	return l.send("stamp_item_lines", runID, payloadPath, overwriteFlag)
}

func (l lineStamper) ReadLineIDs(runID, outputPath string) error {
	return l.send("read_line_ids", runID, outputPath)
}

// renderConfigurer is internal/renderconfig's command.
type renderConfigurer struct{ events }

func (r renderConfigurer) ConfigureChapterRender(runID, outputFolder string) error {
	return r.send("configure_chapter_render", runID, outputFolder)
}

// cleanupLauncher is internal/cleanuptools' command.
type cleanupLauncher struct{ events }

func (c cleanupLauncher) LaunchCleanupTool(runID, toolKey string, trace dawport.Trace) error {
	return c.send("launch_cleanup_tool", runID, toolKey, trace.RunID, trace.Level)
}

// retakeLanePicker is internal/retakelanes' command.
type retakeLanePicker struct{ events }

func (r retakeLanePicker) PickRetakeLane(runID, lineID, itemGUID string, trace dawport.Trace) error {
	return r.send("pick_retake_lane", runID, lineID, itemGUID, trace.RunID, trace.Level)
}

// projectStateReader is internal/projectstate's command.
type projectStateReader struct{ events }

func (p projectStateReader) RequestProjectState(runID string) error {
	return p.send("project_state", runID)
}

// takeCreator is internal/takereview's create_take command.
type takeCreator struct{ events }

func (t takeCreator) CreateTake(runID, payloadPath string) error {
	return t.send("create_take", runID, payloadPath)
}
