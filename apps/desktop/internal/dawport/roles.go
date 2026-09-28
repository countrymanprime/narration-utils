package dawport

import (
	"context"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// The values the roles exchange. They are aliases of the types the REAPER bridge and the .rpp reader already use, so the REAPER
// adapter wraps today's code without converting anything and a consumer moved onto a role keeps its types (the P5 migrations change
// constructors, not bodies). A caller names them through this package; when a second engine needs a neutral shape, the alias
// becomes a type here and no caller changes.
type (
	Event        = bridge.Event
	Subscription = bridge.Subscription

	Target       = bridge.Target
	Navigated    = bridge.Navigated
	LoopStarted  = bridge.LoopStarted
	LoopStopped  = bridge.LoopStopped
	Marker       = bridge.Marker
	MarkerResult = bridge.MarkerResult

	TrackState    = bridge.TrackState
	TrackItem     = bridge.TrackItem
	SelectedTrack = bridge.SelectedTrack
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

	Transport = daw.Transport
)

// The mastering port's DAW row (ADR 0306) exchanges values the bridge has no command for yet, so they are dawport's own types rather
// than aliases: the REAPER phase that builds render_with_fx and master_chain_read gives the bridge matching shapes.

// FXRender asks the engine to render regions through the project's track and master FX, as a render from the engine's own
// dialog would, into a folder the host chose.
type FXRender struct {
	// Regions names the regions to render, one file each, by the region names the host wrote (CreateRegions).
	Regions []string
	// OutputFolder is where the files go: a folder the host made inside the app's project folder for this run, empty, and never
	// the recording's own folder. The engine writes nothing outside it.
	OutputFolder string
	// Approval is the narrator's yes for this one render, from the UI's confirm naming the regions, the chain and the folder. The
	// host sends only an approval it was just given; an adapter refuses a request without one.
	Approval string
}

// FXRendered is what a render wrote: one file per region, in the order asked.
type FXRendered struct {
	Files []FXRenderedFile
}

// FXRenderedFile is one region's rendered file, a path inside FXRender.OutputFolder.
type FXRenderedFile struct {
	Region string
	Path   string
}

// MasterChain is the FX a render runs, in chain order: every track's FX, then the master track's.
type MasterChain struct {
	Tracks []TrackFX
	Master []FXSlot
}

// TrackFX is one track's FX chain.
type TrackFX struct {
	TrackGUID string
	Name      string
	FX        []FXSlot
}

// FXSlot is one plugin in a chain, as the engine names it, and whether it is switched on.
type FXSlot struct {
	Name    string
	Enabled bool
}

// Trace ties a request to the host's run log (runlog.Run's ID and Level), for the commands whose script logs under the host's run.
type Trace struct{ RunID, Level string }

// Events is how a role that answers later reports back: consumers subscribe for the tags they own, and Dispatch delivers what the
// engine has reported since the last call, in order, once. The event vocabulary is part of the contract (ADR 0143): another engine
// reports the same tags and fields.
type Events interface {
	Subscribe(sub Subscription) (unsubscribe func())
	Dispatch() error
}

// MarkerColors are the colours, as RRGGBB hex, the host resolves from the layered settings and passes with an export, so the DAW
// never reads the settings files itself.
type MarkerColors struct{ Misread, Skipped, Extra string }

// Asynchronous roles: each request method only asks, returns an error only when the request could not be handed to the engine, and
// the answer arrives through Events tagged with runID. They mirror the commands their services send today, one method per command.

// ReviewSession is the review workflow's role (ADR 0143's original dawadapter.Review): prepare, inspect, navigate to and export
// findings.
//
// Take management (take creation, pickups, line identity, render setup) is deliberately not here: it has no Audacity equivalent
// (docs/architecture/daw-integration.md, "Audacity boundary"), so those services take their own roles instead.
type ReviewSession interface {
	Events
	// PrepareReview asks the engine for the audio the narrator selected, to compare against the manuscript (COMPARE_PREPARED).
	// projectFolder is the app's project folder, where the manuscript is read and the diffs are written, which need not be the
	// engine's own project file's folder (project-workspace PRD Phase 5, W4); empty means the engine project file's folder.
	PrepareReview(runID, projectFolder string) error
	// InspectFindings asks the engine which of the findings in findingsPath it already carries as a marker or label, which is how
	// a finding that was reviewed earlier is recognised (COMPARE_MARKER per finding, then COMPARE_INSPECTED).
	InspectFindings(runID, findingsPath string) error
	// NavigateToFinding moves the engine's cursor or selection to one finding of the run.
	NavigateToFinding(runID, findingID string) error
	// ExportFindings writes the run's pending findings into the engine as markers or labels, skipping any it already has
	// (COMPARE_EXPORT_MARKER per finding, then COMPARE_EXPORTED).
	ExportFindings(runID, findingsPath string, colors MarkerColors) error
}

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

// FXRenderer renders regions through the project's own FX into a folder the host chose (the mastering port's DAW row, ADR 0306).
// It is the one role that makes the engine render: each request carries the narrator's approval and runs only on their action.
// The answer arrives through Events tagged with runID (a FXRendered).
type FXRenderer interface {
	Events
	RenderWithFX(runID string, render FXRender) error
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

// Heartbeat is what the host knows of the engine without asking it: whether it is answering, which project it has open, that
// project's change count, and whether the engine is playing or recording (DAW port PRD Phase 9, ADR 0305). It reads; a request that
// waits for an answer is ProjectStateReader. Transport's ok is false when the engine is not answering or does not report it.
type Heartbeat interface {
	Reachable() bool
	CurrentProject() (path string, unsaved bool)
	Matches(linkedPath string) bool
	ChangeCount() (count int, ok bool)
	Transport() (transport Transport, ok bool)
}

// ProjectReader reads a saved project file offline, with the engine closed.
type ProjectReader interface {
	ReadProject(path string) (Project, error)
}

// TrackStateReader reads one track's arm and record state.
type TrackStateReader interface {
	ChapterTrackState(ctx context.Context, trackGUID string) (TrackState, error)
}

// TrackSelector selects one track in REAPER ("Select in REAPER", chapter-track-link-control PRD Phase 4), deselecting
// every other one. It changes nothing else.
type TrackSelector interface {
	SelectTrack(ctx context.Context, trackGUID string) (SelectedTrack, error)
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

// MasterChainReader lists the FX a render with FX would run, so the UI can show the narrator the chain before they approve it. It
// reads and changes nothing.
type MasterChainReader interface {
	ReadMasterChain(ctx context.Context) (MasterChain, error)
}
