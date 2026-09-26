package dawport

import "reflect"

// Capability is one thing an engine can do for the host, named as it appears on the wire and in the settings key
// DAW.capability.<name>. Each has exactly one role interface (Spec.Role).
type Capability string

const (
	CapReview       Capability = "review"
	CapNavigate     Capability = "navigate"
	CapMarkers      Capability = "markers"
	CapPickups      Capability = "pickups"
	CapLineIdentity Capability = "line_identity"
	CapRenderConfig Capability = "render_config"
	CapCleanupTools Capability = "cleanup_tools"
	CapRetakeLanes  Capability = "retake_lanes"
	CapProjectState Capability = "project_state"
	CapTakeCreate   Capability = "take_create"
	CapHeartbeat    Capability = "heartbeat"
	CapProjectRead  Capability = "project_read"
	CapTrackState   Capability = "track_state"
	CapRecord       Capability = "record"
	CapPunch        Capability = "punch"
	CapRegions      Capability = "regions"
	CapTakes        Capability = "takes"
	CapFXChains     Capability = "fx_chains"
	CapSilenceTrim  Capability = "silence_trim"
	CapItemGain     Capability = "item_gain"
)

// Needs is what a capability needs from the running engine before it can be used.
type Needs int

const (
	// NeedsRunning: a bridge whose engine is answering (almost everything).
	NeedsRunning Needs = iota
	// NeedsBridge: a bridge, answering or not. Only the heartbeat, which is what says whether the engine is answering.
	NeedsBridge
	// NeedsNothing: works offline, with the engine closed or absent (reading a saved project file).
	NeedsNothing
)

// Spec is the static description of a capability: its narrator label, what it needs at runtime, and the role interface an adapter
// returns for it.
type Spec struct {
	Capability Capability
	Label      string
	Needs      Needs
	Role       reflect.Type
}

// specs is the catalog, in the order the UI lists capabilities. Adding a capability is a row here, a role interface in roles.go and
// a conformance case; it is a normal change under ADR 0300.
var specs = []Spec{
	{CapReview, "Compare the recording with the manuscript", NeedsRunning, reflect.TypeFor[ReviewSession]()},
	{CapNavigate, "Go to and loop findings", NeedsRunning, reflect.TypeFor[Navigator]()},
	{CapMarkers, "Add markers", NeedsRunning, reflect.TypeFor[MarkerWriter]()},
	{CapPickups, "Pickup list", NeedsRunning, reflect.TypeFor[PickupList]()},
	{CapLineIdentity, "Line identity", NeedsRunning, reflect.TypeFor[LineStamper]()},
	{CapRenderConfig, "Chapter render setup", NeedsRunning, reflect.TypeFor[RenderConfigurer]()},
	{CapCleanupTools, "Cleanup tools", NeedsRunning, reflect.TypeFor[CleanupLauncher]()},
	{CapRetakeLanes, "Retake lanes", NeedsRunning, reflect.TypeFor[RetakeLanePicker]()},
	{CapProjectState, "Project change check", NeedsRunning, reflect.TypeFor[ProjectStateReader]()},
	{CapTakeCreate, "Create takes", NeedsRunning, reflect.TypeFor[TakeCreator]()},
	{CapHeartbeat, "Connection status", NeedsBridge, reflect.TypeFor[Heartbeat]()},
	{CapProjectRead, "Read the saved project", NeedsNothing, reflect.TypeFor[ProjectReader]()},
	{CapTrackState, "Read track arm state", NeedsRunning, reflect.TypeFor[TrackStateReader]()},
	{CapRecord, "Record", NeedsRunning, reflect.TypeFor[Recorder]()},
	{CapPunch, "Punch and roll", NeedsRunning, reflect.TypeFor[Puncher]()},
	{CapRegions, "Chapter regions", NeedsRunning, reflect.TypeFor[RegionWriter]()},
	{CapTakes, "Choose the active take", NeedsRunning, reflect.TypeFor[TakeSelector]()},
	{CapFXChains, "FX chains", NeedsRunning, reflect.TypeFor[FXManager]()},
	{CapSilenceTrim, "Silence trim", NeedsRunning, reflect.TypeFor[SilenceTrimmer]()},
	{CapItemGain, "Level matching", NeedsRunning, reflect.TypeFor[GainAdjuster]()},
}

// Capabilities returns every capability's spec, in catalog order. The slice is the caller's own.
func Capabilities() []Spec {
	return append([]Spec(nil), specs...)
}

// SpecOf returns c's spec, or false for a name this build does not know.
func SpecOf(c Capability) (Spec, bool) {
	for _, s := range specs {
		if s.Capability == c {
			return s, true
		}
	}
	return Spec{}, false
}
