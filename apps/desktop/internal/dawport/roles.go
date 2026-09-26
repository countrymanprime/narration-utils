package dawport

import (
	"context"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawadapter"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// The values the roles exchange. They are aliases of the types the REAPER bridge and the .rpp reader already use, so the REAPER
// adapter wraps today's code without converting anything and a consumer moved onto a role keeps its types (the P5 migrations change
// constructors, not bodies). A caller names them through this package; when a second engine needs a neutral shape, the alias
// becomes a type here and no caller changes.
type (
	Event        = dawadapter.Event
	Subscription = dawadapter.Subscription
	MarkerColors = dawadapter.MarkerColors

	Target       = bridge.Target
	Navigated    = bridge.Navigated
	LoopStarted  = bridge.LoopStarted
	LoopStopped  = bridge.LoopStopped
	Marker       = bridge.Marker
	MarkerResult = bridge.MarkerResult

	TrackState    = bridge.TrackState
	Armed         = bridge.Armed
	RecordStarted = bridge.RecordStarted
	RecordStopped = bridge.RecordStopped
	RecordEnded   = bridge.RecordEnded
	PlayPosition  = bridge.PlayPosition

	Region         = bridge.Region
	RegionsCreated = bridge.RegionsCreated
	ActiveTakeSet  = bridge.ActiveTakeSet

	FXChains       = bridge.FXChains
	FXChainApplied = bridge.FXChainApplied
	FXPlugins      = bridge.FXPlugins
	Passage        = bridge.Passage
	TakeFXAdded    = bridge.TakeFXAdded

	CleanupCandidate = bridge.CleanupCandidate
	PreviewResult    = bridge.PreviewResult
	ApplyResult      = bridge.ApplyResult
	GainCandidate    = bridge.GainCandidate
	ApplyGainResult  = bridge.ApplyGainResult

	Project = tracks.Project
)

// Trace ties a request to the host's run log (runlog.Run's ID and Level), for the commands whose script logs under the host's run.
type Trace struct{ RunID, Level string }

// Events is how a role that answers later reports back: consumers subscribe for the tags they own, and Dispatch delivers what the
// engine has reported since the last call, in order, once. The event vocabulary is part of the contract (ADR 0143): another engine
// reports the same tags and fields.
type Events = dawadapter.Events

// Asynchronous roles: each request method only asks, returns an error only when the request could not be handed to the engine, and
// the answer arrives through Events tagged with runID. They mirror the commands their services send today, one method per command.

// ReviewSession is the review workflow's role (ADR 0143's dawadapter.Review): prepare, inspect, navigate to and export findings.
type ReviewSession = dawadapter.Review

// PickupList imports, exports, walks and resolves the pickup list (PICKUPS_* and PICKUP_* events).
type PickupList interface {
	Events
	ImportPickups(runID, payloadPath string) error
	ExportPickups(runID, outputPath string) error
	NextPickup(runID string) error
	ResolvePickup(runID string, position float64) error
	CountPickups(runID string) error
}

// LineStamper writes the manuscript's line identity onto recorded items and reads it back (LINES_* events).
type LineStamper interface {
	Events
	StampLines(runID, payloadPath string, overwrite bool) error
	ReadLineIDs(runID, outputPath string) error
}

// RenderConfigurer sets the engine's render settings for chapter files (RENDER_CONFIGURED).
type RenderConfigurer interface {
	Events
	ConfigureChapterRender(runID, outputFolder string) error
}

// CleanupLauncher opens one of the engine's own allow-listed cleanup dialogs on the selected items (CLEANUP_LAUNCHED).
type CleanupLauncher interface {
	Events
	LaunchCleanupTool(runID, toolKey string, trace Trace) error
}

// RetakeLanePicker plays one retake on a fixed-lane track (RETAKE_LANE_PICKED).
type RetakeLanePicker interface {
	Events
	PickRetakeLane(runID, lineID, itemGUID string, trace Trace) error
}

// ProjectStateReader asks for the live change count and the current project's saved file (PROJECT_STATE).
type ProjectStateReader interface {
	Events
	RequestProjectState(runID string) error
}

// TakeCreator creates a take from a request payload file (TAKE_CREATED or TAKE_STALE).
type TakeCreator interface {
	Events
	CreateTake(runID, payloadPath string) error
}

// Synchronous roles: a call returns once the engine has answered (bridge.Actions, bridge.Navigator), so it must never be made from a
// Subscription's Handle. The method sets are exactly the concrete types' so the REAPER adapter hands those types out as they are.

// Navigator moves the engine's cursor to a place, and loops or stops looping it.
type Navigator interface {
	Navigate(ctx context.Context, target Target) (Navigated, error)
	Loop(ctx context.Context, target Target) (LoopStarted, error)
	StopLoop(ctx context.Context) (LoopStopped, error)
}

// MarkerWriter adds one marker at a place.
type MarkerWriter interface {
	AddMarker(ctx context.Context, target Target, marker Marker) (MarkerResult, error)
}

// Heartbeat is what the host knows of the engine without asking it: whether it is answering, which project it has open, and that
// project's change count. It reads; a request that waits for an answer is ProjectStateReader.
type Heartbeat interface {
	Reachable() bool
	CurrentProject() (path string, unsaved bool)
	Matches(linkedPath string) bool
	ChangeCount() (count int, ok bool)
}

// ProjectReader reads a saved project file offline, with the engine closed.
type ProjectReader interface {
	ReadProject(path string) (Project, error)
}

// TrackStateReader reads one track's arm and record state.
type TrackStateReader interface {
	ChapterTrackState(ctx context.Context, trackGUID string) (TrackState, error)
}

// Recorder arms a track, starts and stops recording, and reports a recording the narrator stopped in the engine.
type Recorder interface {
	ArmOnly(ctx context.Context, trackGUID string) (Armed, error)
	RecordStart(ctx context.Context, trackGUID string) (RecordStarted, error)
	RecordStop(ctx context.Context) (RecordStopped, error)
	OnRecordEnded(handler func(RecordEnded))
}

// Puncher punches in at a word and reads the play position.
type Puncher interface {
	PunchTo(ctx context.Context, wordTime, preRoll float64) (float64, error)
	PlayPosition(ctx context.Context) (PlayPosition, error)
}

// RegionWriter creates (or updates) chapter regions.
type RegionWriter interface {
	CreateRegions(ctx context.Context, rows []Region, colour string, update bool) (RegionsCreated, error)
}

// TakeSelector makes one take of an item the active one.
type TakeSelector interface {
	SetActiveTake(ctx context.Context, itemGUID, takeGUID string) (ActiveTakeSet, error)
}

// FXManager lists and applies FX chains and adds a plugin to a passage's take.
type FXManager interface {
	ListFXChains(ctx context.Context) (FXChains, error)
	ApplyFXChain(ctx context.Context, track, chain string) (FXChainApplied, error)
	ListFX(ctx context.Context) (FXPlugins, error)
	AddTakeFX(ctx context.Context, passage Passage, plugin string) (TakeFXAdded, error)
}

// SilenceTrimmer previews and applies silence trims.
type SilenceTrimmer interface {
	Preview(ctx context.Context, candidates []CleanupCandidate) (PreviewResult, error)
	Apply(ctx context.Context, candidates []CleanupCandidate) (ApplyResult, error)
}

// GainAdjuster applies per-item gain to match levels.
type GainAdjuster interface {
	Apply(ctx context.Context, candidates []GainCandidate) (ApplyGainResult, error)
}
