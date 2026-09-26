package dawporttest

import (
	"context"
	"errors"
	"maps"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// ErrClosed is every fake role call's answer once the fake is closed: the transport is gone, and the call must fail rather than
// hang or panic.
var ErrClosed = errors.New("dawporttest: the fake's transport is closed")

// Fake is an in-memory adapter with a role for every capability. It declares what its caller says, hands out a role for each
// capability declared Experimental or Supported, records every role call as "<capability>.<Method>", and fails every call with
// ErrClosed once closed. Tests of the resolver and of consumers use it in place of an engine, and the suite runs against it so it
// is exercised before any real adapter exists.
type Fake struct {
	kind   dawport.Kind
	levels map[dawport.Capability]dawport.Level
	roles  map[dawport.Capability]any

	mu sync.Mutex // guards everything below
	// +checklocks:mu
	closed bool
	// +checklocks:mu
	calls []string
}

var _ dawport.Adapter = (*Fake)(nil)

// Levels declares every capability at level, for a fake that has (or lacks) everything.
func Levels(level dawport.Level) map[dawport.Capability]dawport.Level {
	all := map[dawport.Capability]dawport.Level{}
	for _, spec := range dawport.Capabilities() {
		all[spec.Capability] = level
	}
	return all
}

// NewFake is a fake of kind declaring levels (copied; a capability left out is Unsupported).
func NewFake(kind dawport.Kind, levels map[dawport.Capability]dawport.Level) *Fake {
	f := &Fake{kind: kind, levels: maps.Clone(levels)}
	if f.levels == nil {
		f.levels = map[dawport.Capability]dawport.Level{}
	}
	r := func(c dawport.Capability) role { return role{f: f, c: c} }
	f.roles = map[dawport.Capability]any{
		dawport.CapReview:       reviewRole{r(dawport.CapReview)},
		dawport.CapNavigate:     navigateRole{r(dawport.CapNavigate)},
		dawport.CapMarkers:      markersRole{r(dawport.CapMarkers)},
		dawport.CapPickups:      pickupsRole{r(dawport.CapPickups)},
		dawport.CapLineIdentity: lineIdentityRole{r(dawport.CapLineIdentity)},
		dawport.CapRenderConfig: renderConfigRole{r(dawport.CapRenderConfig)},
		dawport.CapCleanupTools: cleanupToolsRole{r(dawport.CapCleanupTools)},
		dawport.CapRetakeLanes:  retakeLanesRole{r(dawport.CapRetakeLanes)},
		dawport.CapProjectState: projectStateRole{r(dawport.CapProjectState)},
		dawport.CapTakeCreate:   takeCreateRole{r(dawport.CapTakeCreate)},
		dawport.CapHeartbeat:    heartbeatRole{r(dawport.CapHeartbeat)},
		dawport.CapProjectRead:  projectReadRole{r(dawport.CapProjectRead)},
		dawport.CapTrackState:   trackStateRole{r(dawport.CapTrackState)},
		dawport.CapRecord:       recordRole{r(dawport.CapRecord)},
		dawport.CapPunch:        punchRole{r(dawport.CapPunch)},
		dawport.CapRegions:      regionsRole{r(dawport.CapRegions)},
		dawport.CapTakes:        takesRole{r(dawport.CapTakes)},
		dawport.CapFXChains:     fxChainsRole{r(dawport.CapFXChains)},
		dawport.CapSilenceTrim:  silenceTrimRole{r(dawport.CapSilenceTrim)},
		dawport.CapItemGain:     itemGainRole{r(dawport.CapItemGain)},
	}
	return f
}

func (f *Fake) Kind() dawport.Kind { return f.kind }

// Declares returns a copy of the fake's declaration, the same on every call.
func (f *Fake) Declares() map[dawport.Capability]dawport.Level { return maps.Clone(f.levels) }

func (f *Fake) Role(c dawport.Capability) any {
	if f.levels[c] < dawport.Experimental {
		return nil
	}
	return f.roles[c]
}

// Close closes the fake's transport: every role call from now on fails with ErrClosed.
func (f *Fake) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
}

// Calls is every role call so far, in order, as "<capability>.<Method>".
func (f *Fake) Calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

func (f *Fake) call(c dawport.Capability, method string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, string(c)+"."+method)
	if f.closed {
		return ErrClosed
	}
	return nil
}

// role is what every fake role shares: the fake it records on, its capability, and the Events half the asynchronous roles embed.
// A fake never has an event to deliver.
type role struct {
	f *Fake
	c dawport.Capability
}

func (r role) do(method string) error { return r.f.call(r.c, method) }

func (r role) Subscribe(dawport.Subscription) (unsubscribe func()) {
	_ = r.do("Subscribe")
	return func() {}
}

func (r role) Dispatch() error { return r.do("Dispatch") }

type reviewRole struct{ role }

func (r reviewRole) PrepareReview(string, string) error   { return r.do("PrepareReview") }
func (r reviewRole) InspectFindings(string, string) error { return r.do("InspectFindings") }
func (r reviewRole) NavigateToFinding(string, string) error {
	return r.do("NavigateToFinding")
}
func (r reviewRole) ExportFindings(string, string, dawport.MarkerColors) error {
	return r.do("ExportFindings")
}

type navigateRole struct{ role }

func (r navigateRole) Navigate(context.Context, dawport.Target) (dawport.Navigated, error) {
	return dawport.Navigated{}, r.do("Navigate")
}
func (r navigateRole) Loop(context.Context, dawport.Target) (dawport.LoopStarted, error) {
	return dawport.LoopStarted{}, r.do("Loop")
}
func (r navigateRole) StopLoop(context.Context) (dawport.LoopStopped, error) {
	return dawport.LoopStopped{}, r.do("StopLoop")
}

type markersRole struct{ role }

func (r markersRole) AddMarker(context.Context, dawport.Target, dawport.Marker) (dawport.MarkerResult, error) {
	return dawport.MarkerResult{}, r.do("AddMarker")
}

type pickupsRole struct{ role }

func (r pickupsRole) ImportPickups(string, string) error  { return r.do("ImportPickups") }
func (r pickupsRole) ExportPickups(string, string) error  { return r.do("ExportPickups") }
func (r pickupsRole) NextPickup(string) error             { return r.do("NextPickup") }
func (r pickupsRole) ResolvePickup(string, float64) error { return r.do("ResolvePickup") }
func (r pickupsRole) CountPickups(string) error           { return r.do("CountPickups") }

type lineIdentityRole struct{ role }

func (r lineIdentityRole) StampLines(string, string, bool) error { return r.do("StampLines") }
func (r lineIdentityRole) ReadLineIDs(string, string) error      { return r.do("ReadLineIDs") }

type renderConfigRole struct{ role }

func (r renderConfigRole) ConfigureChapterRender(string, string) error {
	return r.do("ConfigureChapterRender")
}

type cleanupToolsRole struct{ role }

func (r cleanupToolsRole) LaunchCleanupTool(string, string, dawport.Trace) error {
	return r.do("LaunchCleanupTool")
}

type retakeLanesRole struct{ role }

func (r retakeLanesRole) PickRetakeLane(string, string, string, dawport.Trace) error {
	return r.do("PickRetakeLane")
}

type projectStateRole struct{ role }

func (r projectStateRole) RequestProjectState(string) error { return r.do("RequestProjectState") }

type takeCreateRole struct{ role }

func (r takeCreateRole) CreateTake(string, string) error { return r.do("CreateTake") }

// heartbeatRole reports a quiet engine with no project: the heartbeat reads, so it has no error to return.
type heartbeatRole struct{ role }

func (r heartbeatRole) Reachable() bool {
	_ = r.do("Reachable")
	return false
}
func (r heartbeatRole) CurrentProject() (string, bool) {
	_ = r.do("CurrentProject")
	return "", false
}
func (r heartbeatRole) Matches(string) bool {
	_ = r.do("Matches")
	return false
}
func (r heartbeatRole) ChangeCount() (int, bool) {
	_ = r.do("ChangeCount")
	return 0, false
}

type projectReadRole struct{ role }

func (r projectReadRole) ReadProject(string) (dawport.Project, error) {
	return dawport.Project{}, r.do("ReadProject")
}

type trackStateRole struct{ role }

func (r trackStateRole) ChapterTrackState(context.Context, string) (dawport.TrackState, error) {
	return dawport.TrackState{}, r.do("ChapterTrackState")
}

type recordRole struct{ role }

func (r recordRole) ArmOnly(context.Context, string) (dawport.Armed, error) {
	return dawport.Armed{}, r.do("ArmOnly")
}
func (r recordRole) RecordStart(context.Context, string) (dawport.RecordStarted, error) {
	return dawport.RecordStarted{}, r.do("RecordStart")
}
func (r recordRole) RecordStop(context.Context) (dawport.RecordStopped, error) {
	return dawport.RecordStopped{}, r.do("RecordStop")
}
func (r recordRole) OnRecordEnded(func(dawport.RecordEnded)) { _ = r.do("OnRecordEnded") }

type punchRole struct{ role }

func (r punchRole) PunchTo(context.Context, float64, float64) (float64, error) {
	return 0, r.do("PunchTo")
}
func (r punchRole) PlayPosition(context.Context) (dawport.PlayPosition, error) {
	return dawport.PlayPosition{}, r.do("PlayPosition")
}

type regionsRole struct{ role }

func (r regionsRole) CreateRegions(context.Context, []dawport.Region, string, bool) (dawport.RegionsCreated, error) {
	return dawport.RegionsCreated{}, r.do("CreateRegions")
}

type takesRole struct{ role }

func (r takesRole) SetActiveTake(context.Context, string, string) (dawport.ActiveTakeSet, error) {
	return dawport.ActiveTakeSet{}, r.do("SetActiveTake")
}

type fxChainsRole struct{ role }

func (r fxChainsRole) ListFXChains(context.Context) (dawport.FXChains, error) {
	return dawport.FXChains{}, r.do("ListFXChains")
}
func (r fxChainsRole) ApplyFXChain(context.Context, string, string) (dawport.FXChainApplied, error) {
	return dawport.FXChainApplied{}, r.do("ApplyFXChain")
}
func (r fxChainsRole) ListFX(context.Context) (dawport.FXPlugins, error) {
	return dawport.FXPlugins{}, r.do("ListFX")
}
func (r fxChainsRole) AddTakeFX(context.Context, dawport.Passage, string) (dawport.TakeFXAdded, error) {
	return dawport.TakeFXAdded{}, r.do("AddTakeFX")
}

type silenceTrimRole struct{ role }

func (r silenceTrimRole) Preview(context.Context, []dawport.CleanupCandidate) (dawport.PreviewResult, error) {
	return dawport.PreviewResult{}, r.do("Preview")
}
func (r silenceTrimRole) Apply(context.Context, []dawport.CleanupCandidate) (dawport.ApplyResult, error) {
	return dawport.ApplyResult{}, r.do("Apply")
}

type itemGainRole struct{ role }

func (r itemGainRole) Apply(context.Context, []dawport.GainCandidate) (dawport.ApplyGainResult, error) {
	return dawport.ApplyGainResult{}, r.do("Apply")
}
