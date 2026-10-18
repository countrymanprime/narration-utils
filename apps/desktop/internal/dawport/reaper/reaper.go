// Package reaper is the DAW port's REAPER adapter. It wraps what exists and rewrites nothing: the
// synchronous roles are bridge.Navigator, bridge.Actions, bridge.LevelMatchClient and
// daw.Reachability as they are, the review session (review.go) sends the bridge commands transcript.Service sent
// before the extraction, the offline reader is tracks.Parse, and each asynchronous role writes the bridge command its service
// writes. A capability is declared Experimental when bridge.Actions gates its commands behind the "Experimental REAPER
// actions" switch (bridge's experimentalCommands), and Supported otherwise, except level matching, which is not wired to a
// caller and so starts Experimental.
//
// Importing the package registers its factory for dawport.KindREAPER.
package reaper

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"strconv"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

func init() { dawport.Register(dawport.KindREAPER, Factory) }

// ErrNoSession is returned when the launch has no REAPER session directory (NarrationStudio_Launcher.lua makes one), so there is no bridge to wrap.
var ErrNoSession = errors.New("REAPER is not connected to this app: there is no REAPER session to talk to")

// declares is the adapter's static declaration. Promoting a command once the owner's REAPER verification pass has confirmed it
// is moving its capability from Experimental to Supported here, in the same PR that takes the
// command off bridge's experimentalCommands.
var declares = map[dawport.Capability]dawport.Level{
	dawport.CapReview:       dawport.Supported,
	dawport.CapNavigate:     dawport.Supported,
	dawport.CapMarkers:      dawport.Supported,
	dawport.CapPickups:      dawport.Supported,
	dawport.CapLineIdentity: dawport.Supported,
	dawport.CapRenderConfig: dawport.Supported,
	dawport.CapCleanupTools: dawport.Supported,
	dawport.CapRetakeLanes:  dawport.Supported,
	dawport.CapProjectState: dawport.Supported,
	dawport.CapTakeCreate:   dawport.Supported,
	dawport.CapHeartbeat:    dawport.Supported,
	dawport.CapProjectRead:  dawport.Supported,
	// bridge's experimentalCommands: chapter_track_state, select_track; arm_only, record_start, record_stop; punch_to,
	// play_position, roll; create_regions; set_active_take, hide_takes; list_fx_chains, apply_fx_chain; master_chain_read;
	// delete_range; apply_fx_range, remove_fx_range, fx_range_params, fx_range_set_param, fx_range_bypass; stack_takes, unstack_takes; preview_file_range, stop_file_preview, reveal_file;
	// reduce_range_gain; repair_click; last_action, undo_last; monitor_level (declared with the edit rows below).
	dawport.CapTrackState:  dawport.Experimental,
	dawport.CapTrackSelect: dawport.Experimental,
	dawport.CapRecord:      dawport.Experimental,
	dawport.CapPunch:       dawport.Experimental,
	dawport.CapRegions:     dawport.Experimental,
	dawport.CapTakes:       dawport.Experimental,
	dawport.CapFXChains:    dawport.Experimental,
	// Built, never wired to a binding, so never gated: Experimental keeps it off until it is verified.
	dawport.CapItemGain: dawport.Experimental,
	// The mastering port's DAW row (masterrender.go): Experimental until the owner's
	// REAPER pass. master_chain_read is one of bridge.Actions' gated commands; render_with_fx answers through the fan-out, and each
	// request carries the narrator's approval for that one render, which the bridge uses up.
	dawport.CapRenderWithFX:    dawport.Experimental,
	dawport.CapMasterChainRead: dawport.Experimental,
	// macro_render is the mastering port's Audacity row: REAPER has no macro manager, so this is Unsupported,
	// not NotYetAvailable (port.go's own example is exactly this shape, the other way around: "Audacity has no punch-and-roll").
	dawport.CapMacroRender: dawport.Unsupported,
	// The edit rows (SND-3): cut_range is delete_range's (SN-D62) and fx_range apply_fx_range's and remove_fx_range's (SN-D63), both in
	// narration_range.lua, and stack_takes is stack_takes' and unstack_takes' (SN-D71, narration_takes.lua). backups is the Audacity
	// adapter's: REAPER keeps takes, but the bridge has no backup command.
	dawport.CapCutRange:   dawport.Experimental,
	dawport.CapFXRange:    dawport.Experimental,
	dawport.CapStackTakes: dawport.Experimental,
	dawport.CapBackups:    dawport.NotYetAvailable,
	// The file rows (SN-B98, narration_media_file.lua): preview_file_range, stop_file_preview and reveal_file.
	dawport.CapFilePreview: dawport.Experimental,
	dawport.CapFileReveal:  dawport.Experimental,
	// range_gain is reduce_range_gain's (SN-E100, narration_range.lua): Experimental until the QA pass (#1495) hears the stretches
	// lowered with no click at the edges.
	dawport.CapRangeGain: dawport.Experimental,
	// click_repair is repair_click's (SN-E101, narration_range.lua): Experimental until the QA pass (#1495) hears a click gone and
	// no dip in its place.
	dawport.CapClickRepair: dawport.Experimental,
	// undo_last is last_action's and undo_last's (#1711, narration_undo.lua): Experimental until the QA pass (#1495) sees one Undo
	// reverse a cut whole and Undo_CanUndo2 name the cut's label.
	dawport.CapUndoLast: dawport.Experimental,
	// monitor_level is monitor_level's (narration_levels.lua): the master track's first hardware output send. Experimental until the QA
	// pass (#1495) sees the call read and set a real send. input_level is Unsupported, not NotYetAvailable: ReaScript has no call that
	// sets an audio interface's input gain, so no later version of this app can add one.
	dawport.CapMonitorLevel: dawport.Experimental,
	dawport.CapInputLevel:   dawport.Unsupported,
}

// commandCapability is the capability each of bridge.Actions' commands belongs to. Actions asks its gate about a command by name, and
// Gate answers with that capability's Allowed, so the resolver decides and the command list stays in bridge. Every command Actions
// sends has a row, whether or not it is still Experimental: promoting one is a declaration change above, not a change here.
var commandCapability = map[string]dawport.Capability{
	"chapter_track_state": dawport.CapTrackState,
	"select_track":        dawport.CapTrackSelect,
	"arm_only":            dawport.CapRecord,
	"record_start":        dawport.CapRecord,
	"record_stop":         dawport.CapRecord,
	"punch_to":            dawport.CapPunch,
	"play_position":       dawport.CapPunch,
	"roll":                dawport.CapPunch,
	"create_regions":      dawport.CapRegions,
	"set_active_take":     dawport.CapTakes,
	"hide_takes":          dawport.CapTakes,
	"split_take":          dawport.CapTakes,
	"list_fx_chains":      dawport.CapFXChains,
	"apply_fx_chain":      dawport.CapFXChains,
	"master_chain_read":   dawport.CapMasterChainRead,
	"delete_range":        dawport.CapCutRange,
	"apply_fx_range":      dawport.CapFXRange,
	"remove_fx_range":     dawport.CapFXRange,
	"stack_takes":         dawport.CapStackTakes,
	"unstack_takes":       dawport.CapStackTakes,
	"preview_file_range":  dawport.CapFilePreview,
	"stop_file_preview":   dawport.CapFilePreview,
	"reveal_file":         dawport.CapFileReveal,
	"reduce_range_gain":   dawport.CapRangeGain,
	"repair_click":        dawport.CapClickRepair,
	"fx_range_params":     dawport.CapFXRange,
	"fx_range_set_param":  dawport.CapFXRange,
	"fx_range_bypass":     dawport.CapFXRange,
	"fx_range_compare":    dawport.CapFXRange,
	"stop_fx_compare":     dawport.CapFXRange,
	"last_action":         dawport.CapUndoLast,
	"undo_last":           dawport.CapUndoLast,
	"monitor_level":       dawport.CapMonitorLevel,
}

// Gate is bridge.Actions' gate over allowed (the resolver's Allowed): a command is sent only when its capability is allowed. A nil
// allowed refuses every command as experimental and switched off, and a command with no capability is refused as a bug.
func Gate(allowed func(dawport.Capability) error) bridge.Gate {
	return func(command string) error {
		c, ok := commandCapability[command]
		if !ok {
			return fmt.Errorf("the REAPER adapter has no capability for the command %s", command)
		}
		if allowed == nil {
			return bridge.ErrExperimentalOff
		}
		return allowed(c)
	}
}

// Declaration is REAPER's declaration with no session behind it: an adapter whose Role is always nil. It exists only so the host can
// build a resolver to gate the bridge.Actions it still makes itself, until those consumers move onto this package's roles. It is never registered and fails the conformance suite by design; Role[T] on it is a *dawport.RoleError.
func Declaration() dawport.Adapter { return declaration{} }

type declaration struct{}

func (declaration) Kind() dawport.Kind                             { return dawport.KindREAPER }
func (declaration) Declares() map[dawport.Capability]dawport.Level { return maps.Clone(declares) }
func (declaration) Role(dawport.Capability) any                    { return nil }
func (declaration) Depth(c dawport.Capability) dawport.Depth       { return depthOf(c) }
func (d declaration) Explain(c dawport.Capability, r dawport.Reason) string {
	return (*Adapter)(nil).Explain(c, r)
}

// The host's existing wording for a REAPER that is not connected or not answering (bindings_navigation.go, bridge.ErrUnavailable
// and bridge.ErrNoAnswer), as whole sentences.
const (
	messageStandalone = "REAPER is not connected to this app. Open this app from the Narration Utils action in REAPER."
	messageNotRunning = "REAPER is not answering. Check that REAPER is open and the Narration Utils action is running, then try again."
)

// Adapter is REAPER over one session's file bridge. It holds that session's bridge client and one of each of today's bridge
// consumers over it, so every role shares the client's one fan-out and command counter.
type Adapter struct {
	heartbeat *daw.Reachability
	roles     map[dawport.Capability]any
}

var (
	_ dawport.Adapter   = (*Adapter)(nil)
	_ dawport.Explainer = (*Adapter)(nil)
	_ dawport.Describer = (*Adapter)(nil)
)

// Factory is the registry's REAPER factory: it opens env.SessionDir's bridge and wraps it. A launch with no session directory has
// no REAPER to talk to, and gets ErrNoSession.
func Factory(env dawport.Env) (dawport.Adapter, error) {
	if env.SessionDir == "" {
		return nil, ErrNoSession
	}
	client, err := bridge.New(env.SessionDir)
	if err != nil {
		return nil, err
	}
	if env.Log != nil {
		client.SetLog(env.Log)
	}
	return New(client, env.Allowed)
}

// New wraps client, which must not be nil (ErrNoSession). allowed is the resolver's Allowed, asked through Gate before each of
// bridge.Actions' commands is sent; nil refuses them all as experimental and switched off.
//
// Each wrapped consumer subscribes to client here, once. Use one adapter per client.
func New(client *bridge.Client, allowed func(dawport.Capability) error) (*Adapter, error) {
	if client == nil {
		return nil, ErrNoSession
	}
	navigator := bridge.NewNavigator(client)
	actions := bridge.NewActions(client, Gate(allowed))
	heartbeat := daw.NewReachability(client)
	commands := events{client: client}
	return &Adapter{
		heartbeat: heartbeat,
		roles: map[dawport.Capability]any{
			dawport.CapReview:          review{client: client},
			dawport.CapNavigate:        navigator,
			dawport.CapMarkers:         navigator,
			dawport.CapPickups:         pickupList{commands},
			dawport.CapLineIdentity:    lineStamper{commands},
			dawport.CapRenderConfig:    renderConfigurer{commands},
			dawport.CapCleanupTools:    cleanupLauncher{commands},
			dawport.CapRetakeLanes:     retakeLanePicker{commands},
			dawport.CapProjectState:    projectStateReader{commands},
			dawport.CapTakeCreate:      takeCreator{commands},
			dawport.CapHeartbeat:       heartbeat,
			dawport.CapProjectRead:     ProjectReader{},
			dawport.CapTrackState:      actions,
			dawport.CapTrackSelect:     actions,
			dawport.CapRecord:          actions,
			dawport.CapPunch:           puncher{actions, allowed},
			dawport.CapRegions:         actions,
			dawport.CapTakes:           takeSelector{actions, allowed},
			dawport.CapFXChains:        actions,
			dawport.CapItemGain:        bridge.NewLevelMatchClient(client),
			dawport.CapRenderWithFX:    fxRenderer{commands},
			dawport.CapMasterChainRead: masterChainReader{actions},
			dawport.CapCutRange:        rangeCutter{actions, allowed},
			dawport.CapFXRange:         rangeFXApplier{actions, allowed, &appliedPieces{}},
			dawport.CapStackTakes:      takeStacker{actions, allowed},
			dawport.CapFilePreview:     actions,
			dawport.CapFileReveal:      actions,
			dawport.CapRangeGain:       rangeGainReducer{actions, allowed},
			dawport.CapClickRepair:     clickRepairer{actions, allowed},
			dawport.CapUndoLast:        lastActionUndoer{actions, allowed},
			dawport.CapMonitorLevel:    monitorLeveler{actions, allowed},
		},
	}, nil
}

func (a *Adapter) Kind() dawport.Kind { return dawport.KindREAPER }

// Declares returns a copy of the declaration, the same on every call.
func (a *Adapter) Declares() map[dawport.Capability]dawport.Level { return maps.Clone(declares) }

// Role is c's role for every capability REAPER declares, and nil for a name the port does not know.
func (a *Adapter) Role(c dawport.Capability) any {
	if declares[c] < dawport.Experimental {
		return nil
	}
	return a.roles[c]
}

// Depth is what REAPER declares about how a capability acts, the same with REAPER up or down.
func (a *Adapter) Depth(c dawport.Capability) dawport.Depth { return depthOf(c) }

// depthOf: a roll keeps the earlier audio as a take (docs/reference/daw/capabilities.md), so punch is not destructive, and REAPER makes it
// itself. That rests on the overlapping-recording setting the roll command reads and refuses without; the QA pass (#1495)
// confirms that setting keeps the audio. A cut moves the middle piece to the muted Cuts track and deletes nothing (point 2),
// so cut_range is not destructive either, and a chain on a range is take FX on a split piece, which leaves the audio as it
// was recorded and comes off again (point 3), so neither is fx_range. A stack makes later reads takes of the first read's item
// in one undo block and moves their items to the Cuts track, deleting nothing (point 4), so stack_takes is native and not
// destructive. Lowering stretches puts points on the take's volume envelope in one undo block and leaves the recorded audio as it
// was, so range_gain is native and not destructive; so is click_repair, a short dip on the same envelope.
func depthOf(c dawport.Capability) dawport.Depth {
	if c == dawport.CapPunch || c == dawport.CapCutRange || c == dawport.CapFXRange || c == dawport.CapStackTakes || c == dawport.CapRangeGain ||
		c == dawport.CapClickRepair {
		return dawport.Depth{Mode: dawport.ModeNative}
	}
	return dawport.Depth{}
}

// Runtime is the resolver's view of this session: always a bridge, answering while the heartbeat is fresh.
func (a *Adapter) Runtime() dawport.Runtime {
	return dawport.Runtime{Bridge: true, Reachable: a.heartbeat.Reachable()}
}

// Explain words a REAPER that is not connected or not answering as the host already does; every other refusal takes the
// resolver's wording.
func (a *Adapter) Explain(_ dawport.Capability, r dawport.Reason) string {
	switch r {
	case dawport.ReasonStandalone:
		return messageStandalone
	case dawport.ReasonNotRunning:
		return messageNotRunning
	default:
		return ""
	}
}

// ProjectReader reads a saved .rpp with REAPER closed. It needs no live session (project_read's Needs is NeedsNothing,
// capability.go), so it is exported: a caller that only wants the offline read (tracks.go and its neighbours) may use it directly, the same value New wires in as the resolver's role for CapProjectRead.
type ProjectReader struct{}

func (ProjectReader) ReadProject(path string) (dawport.Project, error) { return tracks.Parse(path) }

// takeSelector is the takes role: bridge.Actions' SetActiveTake as it is, and HideTakes answering a dawport.Result,
// which bridge cannot import.
type takeSelector struct {
	*bridge.Actions
	allowed func(dawport.Capability) error
}

var (
	_ dawport.TakeSelector = takeSelector{}
	_ dawport.TakeSplitter = takeSelector{}
)

// HideTakes mutes every take of itemGUID but keepTakeGUID (bridge's hide_takes). It asks allowed itself first, so a refusal is
// the capability's own sentence rather than bridge's ErrExperimentalOff.
func (t takeSelector) HideTakes(ctx context.Context, itemGUID, keepTakeGUID string) (dawport.Result, error) {
	if t.allowed != nil {
		if refused, ok := dawport.RefusedFrom(t.allowed(dawport.CapTakes)); ok {
			return refused, nil
		}
	}
	got, err := t.Actions.HideTakes(ctx, itemGUID, keepTakeGUID)
	var stale *bridge.StaleError
	switch {
	case errors.As(err, &stale) && stale.Reason == "take":
		return dawport.RefusedStale("That item no longer has the take you kept. Read the project again."), nil
	case errors.As(err, &stale):
		return dawport.RefusedStale("That passage's item is no longer in the REAPER project. Read the project again."), nil
	case errors.Is(err, bridge.ErrRecording):
		return dawport.Refused("REAPER is recording. Stop recording first."), nil
	case errors.Is(err, bridge.ErrExperimentalOff):
		return dawport.Refused(err.Error()), nil
	case err != nil:
		return dawport.Result{}, err
	}
	return dawport.OK(hiddenMessage(got), got.Changed), nil
}

// SplitTake makes takeGUID of itemGUID two takes of one item at at (bridge's split_take): the item ends at the cut and a new take
// plays the second read, in one undo step. It asks allowed for the takes capability first, as HideTakes does.
func (t takeSelector) SplitTake(ctx context.Context, itemGUID, takeGUID string, at float64) (dawport.Result, error) {
	if t.allowed != nil {
		if refused, ok := dawport.RefusedFrom(t.allowed(dawport.CapTakes)); ok {
			return refused, nil
		}
	}
	got, err := t.Actions.SplitTake(ctx, itemGUID, takeGUID, at)
	var stale *bridge.StaleError
	var refusal *bridge.RefusalError
	switch {
	case errors.As(err, &stale) && stale.Reason == "take":
		return dawport.RefusedStale("That item no longer has the take to split. Read the project again."), nil
	case errors.As(err, &stale):
		return dawport.RefusedStale("That take's item moved or changed in the REAPER project. Read the project again."), nil
	case errors.Is(err, bridge.ErrRecording):
		return dawport.Refused("REAPER is recording. Stop recording first."), nil
	case errors.As(err, &refusal):
		return dawport.Refused(refusal.Sentence), nil
	case errors.Is(err, bridge.ErrExperimentalOff):
		return dawport.Refused(err.Error()), nil
	case err != nil:
		return dawport.Result{}, err
	}
	return dawport.OK("Split the take into 2 takes in REAPER. Undo it there in one step.", true).WithUndoSteps(got.UndoPoints), nil
}

const messageRollStopped = "REAPER stopped recording for the roll but did not record again. The earlier audio is kept; press record to go on."

// puncher is the punch role: bridge.Actions' PunchTo and PlayPosition as they are, and Roll answering a dawport.Result
// which bridge cannot import.
type puncher struct {
	*bridge.Actions
	allowed func(dawport.Capability) error
}

var _ dawport.Puncher = puncher{}

// Roll records again from at on trackGUID while the app's recording runs there (bridge's roll). It asks allowed itself first,
// so a refusal is the capability's own sentence rather than bridge's ErrExperimentalOff.
func (p puncher) Roll(ctx context.Context, trackGUID string, at float64) (dawport.Result, error) {
	if p.allowed != nil {
		if refused, ok := dawport.RefusedFrom(p.allowed(dawport.CapPunch)); ok {
			return refused, nil
		}
	}
	got, err := p.Actions.Roll(ctx, trackGUID, at)
	var stale *bridge.TrackStaleError
	var refusal *bridge.RefusalError
	switch {
	case errors.As(err, &stale):
		return dawport.RefusedStale("That track is no longer in the REAPER project. Read the project again."), nil
	case errors.Is(err, bridge.ErrNotOurRecording):
		return dawport.Refused("REAPER is not recording anything this app started on that track, so there is nothing to roll."), nil
	case errors.Is(err, bridge.ErrBadRoll):
		return dawport.Refused("The roll time is not a usable number of seconds."), nil
	case errors.As(err, &refusal):
		return dawport.Refused(refusal.Sentence), nil
	case errors.Is(err, bridge.ErrExperimentalOff):
		return dawport.Refused(err.Error()), nil
	case errors.Is(err, bridge.ErrRollStopped):
		// Not a refusal: the recording has ended. Nothing was deleted and the roll added no undo point.
		return dawport.Result{Changed: true, Message: messageRollStopped}, nil
	case err != nil:
		return dawport.Result{}, err
	}
	message := fmt.Sprintf("Rolled again from %.1f seconds. The earlier audio is kept as a take.", got.At)
	return dawport.OK(message, true).WithUndoSteps(got.UndoPoints), nil
}

func hiddenMessage(got bridge.TakesHidden) string {
	switch {
	case got.Hidden == 1:
		return "Muted 1 other take in REAPER. It is still in the project."
	case got.Hidden > 1:
		return fmt.Sprintf("Muted %d other takes in REAPER. They are still in the project.", got.Hidden)
	case got.Changed:
		return "No other take to mute in REAPER; the kept take is the active one."
	default:
		return "No other take to mute in REAPER."
	}
}

// rangeCutter is the cut_range role over bridge's delete_range, answering a dawport.Result, which bridge cannot import.
type rangeCutter struct {
	actions *bridge.Actions
	allowed func(dawport.Capability) error
}

var _ dawport.RangeCutter = rangeCutter{}

// DeleteRange splits the request's item at both ends of the range and moves the middle piece to the muted Cuts track, in one
// undo step (bridge's delete_range). It asks allowed itself first, so a refusal is the capability's own sentence rather than
// bridge's ErrExperimentalOff.
func (r rangeCutter) DeleteRange(ctx context.Context, request dawport.DeleteRangeRequest) (dawport.Result, error) {
	if r.allowed != nil {
		if refused, ok := dawport.RefusedFrom(r.allowed(dawport.CapCutRange)); ok {
			return refused, nil
		}
	}
	got, err := r.actions.DeleteRange(ctx, request.ItemGUID, request.Start, request.End, bridge.CutMode(request.Mode), request.FadeMs,
		request.PadMs, request.RoomTone)
	var stale *bridge.StaleError
	var refusal *bridge.RefusalError
	switch {
	case errors.As(err, &stale):
		return dawport.RefusedStale("That passage's item is no longer in the REAPER project. Read the project again."), nil
	case errors.Is(err, bridge.ErrRecording):
		return dawport.Refused("REAPER is recording. Stop recording first."), nil
	case errors.Is(err, bridge.ErrBadRange):
		return dawport.Refused("The range to cut is not a usable pair of times."), nil
	case errors.Is(err, bridge.ErrScriptOutdated):
		return dawport.Refused(messageCutScriptOutdated), nil
	case errors.As(err, &refusal):
		return dawport.Refused(refusal.Sentence), nil
	case errors.Is(err, bridge.ErrExperimentalOff):
		return dawport.Refused(err.Error()), nil
	case err != nil:
		return dawport.Result{}, err
	}
	return dawport.OK(cutMessage(request.Words), true).WithUndoSteps(got.UndoPoints), nil
}

// messageCutScriptOutdated answers a pad or room tone sent to a script older than them, which refused and cut nothing.
const messageCutScriptOutdated = "The Narration Utils script in REAPER is older than this app and cannot pad a cut or fill it with room tone, so nothing was cut. Import the script again from this app's REAPER folder."

// cutMessage words a cut as the mock does (studio-next/src/state/daw.ts, deleteRange).
func cutMessage(words int) string {
	switch {
	case words <= 0:
		return "Deleted the words and their audio in REAPER."
	case words == 1:
		return "Deleted 1 word and their audio in REAPER."
	default:
		return fmt.Sprintf("Deleted %d words and their audio in REAPER.", words)
	}
}

// rangeGainReducer is the range_gain role over bridge's reduce_range_gain, answering a dawport.Result.
type rangeGainReducer struct {
	actions *bridge.Actions
	allowed func(dawport.Capability) error
}

var _ dawport.RangeGainReducer = rangeGainReducer{}

// ReduceRangeGain lowers the request's stretches of its take with points on the take's volume envelope, in one undo step (bridge's
// reduce_range_gain). It asks allowed itself first, so a refusal is the capability's own sentence rather than bridge's
// ErrExperimentalOff, and refuses a request out of shape before anything is sent.
func (r rangeGainReducer) ReduceRangeGain(ctx context.Context, request dawport.RangeGainRequest) (dawport.Result, error) {
	if r.allowed != nil {
		if refused, ok := dawport.RefusedFrom(r.allowed(dawport.CapRangeGain)); ok {
			return refused, nil
		}
	}
	if !request.Valid() {
		return dawport.Refused(messageGainBad), nil
	}
	got, err := r.actions.ReduceRangeGain(ctx, request.ItemGUID, request.TakeGUID, request.ReduceDB, request.Stretches)
	var stale *bridge.StaleError
	var refusal *bridge.RefusalError
	switch {
	case errors.As(err, &stale) && stale.Reason == "take":
		return dawport.RefusedStale("That item no longer has the take to lower. Read the project again."), nil
	case errors.As(err, &stale):
		return dawport.RefusedStale("That take's item moved or changed in the REAPER project. Read the project again."), nil
	case errors.Is(err, bridge.ErrRecording):
		return dawport.Refused("REAPER is recording. Stop recording first."), nil
	case errors.Is(err, bridge.ErrScriptOutdated):
		return dawport.Refused(messageGainScriptOutdated), nil
	case errors.As(err, &refusal):
		return dawport.Refused(refusal.Sentence), nil
	case errors.Is(err, bridge.ErrExperimentalOff):
		return dawport.Refused(err.Error()), nil
	case err != nil:
		return dawport.Result{}, err
	}
	return dawport.OK(gainMessage(got.Stretches, got.ReduceDB), true).WithUndoSteps(got.UndoPoints), nil
}

const (
	messageGainBad            = "The stretches to lower are not usable, so nothing was changed."
	messageGainScriptOutdated = "The Narration Utils script in REAPER is older than this app and cannot lower a stretch, so nothing was changed. Import the script again from this app's REAPER folder."
)

// gainMessage words stretches lowered by db.
func gainMessage(stretches int, db float64) string {
	what := "1 stretch"
	if stretches != 1 {
		what = fmt.Sprintf("%d stretches", stretches)
	}
	return fmt.Sprintf("Lowered %s by %s dB in REAPER. Undo it there in one step.", what, strconv.FormatFloat(db, 'f', -1, 64))
}

// clickRepairer is the click_repair role over bridge's repair_click, answering a dawport.Result.
type clickRepairer struct {
	actions *bridge.Actions
	allowed func(dawport.Capability) error
}

var _ dawport.ClickRepairer = clickRepairer{}

// RepairClick smooths the request's clicks in its take with a short dip on the take's volume envelope, in one undo step (bridge's
// repair_click). It asks allowed itself first, so a refusal is the capability's own sentence rather than bridge's
// ErrExperimentalOff, and refuses a request out of shape before anything is sent.
func (r clickRepairer) RepairClick(ctx context.Context, request dawport.ClickRepairRequest) (dawport.Result, error) {
	if r.allowed != nil {
		if refused, ok := dawport.RefusedFrom(r.allowed(dawport.CapClickRepair)); ok {
			return refused, nil
		}
	}
	if !request.Valid() {
		return dawport.Refused(messageClickBad), nil
	}
	got, err := r.actions.RepairClick(ctx, request.ItemGUID, request.TakeGUID, request.Clicks)
	var stale *bridge.StaleError
	var refusal *bridge.RefusalError
	switch {
	case errors.As(err, &stale) && stale.Reason == "take":
		return dawport.RefusedStale("That item no longer has the take to repair. Read the project again."), nil
	case errors.As(err, &stale):
		return dawport.RefusedStale("That take's item moved or changed in the REAPER project. Read the project again."), nil
	case errors.Is(err, bridge.ErrRecording):
		return dawport.Refused("REAPER is recording. Stop recording first."), nil
	case errors.Is(err, bridge.ErrScriptOutdated):
		return dawport.Refused(messageClickScriptOutdated), nil
	case errors.As(err, &refusal):
		return dawport.Refused(refusal.Sentence), nil
	case errors.Is(err, bridge.ErrExperimentalOff):
		return dawport.Refused(err.Error()), nil
	case err != nil:
		return dawport.Result{}, err
	}
	return dawport.OK(clickMessage(got.Clicks), true).WithUndoSteps(got.UndoPoints), nil
}

const (
	messageClickBad            = "The clicks to repair are not usable, so nothing was changed."
	messageClickScriptOutdated = "The Narration Utils script in REAPER is older than this app and cannot repair a click, so nothing was changed. Import the script again from this app's REAPER folder."
)

// clickMessage words clicks repaired.
func clickMessage(clicks int) string {
	what := "1 click"
	if clicks != 1 {
		what = fmt.Sprintf("%d clicks", clicks)
	}
	return fmt.Sprintf("Repaired %s in REAPER. Undo it there in one step.", what)
}

// rangeFXApplier is the fx_range role over bridge's apply_fx_range and remove_fx_range, answering a dawport.Result,
// and over fx_range_params, fx_range_set_param and fx_range_bypass as its dawport.RangeFXEditor (SN-E104). REAPER lists a chain by
// one name, its path relative to FXChains, which is both the chain's id and its name; every command sends the request's ChainName.
type rangeFXApplier struct {
	actions *bridge.Actions
	allowed func(dawport.Capability) error
	pieces  *appliedPieces
}

var (
	_ dawport.RangeFXApplier = rangeFXApplier{}
	_ dawport.RangeFXEditor  = rangeFXApplier{}
)

// appliedPieces are the piece and take each apply_fx_range this launch put a chain on, by the item, range and chain it was sent:
// the host resolves the same words to the same item and times until the chapter is checked again, while the chain is on a new
// item (the piece) that the alignment names only after that check. It is held in memory only; with no entry the edits name the
// item the words resolve to, which after a check is the piece itself, and let REAPER find the take that carries the chain.
type appliedPieces struct {
	mu sync.Mutex
	// +checklocks:mu
	pieces map[appliedKey]appliedPiece
}

type appliedKey struct {
	item       string
	start, end float64
	chain      string
}

type appliedPiece struct{ item, take string }

func keyOf(r dawport.RangeRequest, chain string) appliedKey {
	return appliedKey{item: r.ItemGUID, start: r.Start, end: r.End, chain: chain}
}

func (p *appliedPieces) put(key appliedKey, piece appliedPiece) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.pieces == nil {
		p.pieces = map[appliedKey]appliedPiece{}
	}
	p.pieces[key] = piece
}

// find is the piece and take recorded for target, or the item it resolves to and no take.
func (p *appliedPieces) find(target dawport.FXRangeTarget) appliedPiece {
	p.mu.Lock()
	defer p.mu.Unlock()
	if piece, ok := p.pieces[keyOf(target.RangeRequest, target.ChainName)]; ok {
		return piece
	}
	return appliedPiece{item: target.ItemGUID}
}

// forget drops the entries for chain whose piece is item: the chain came off it, or REAPER no longer has it.
func (p *appliedPieces) forget(item, chain string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for key, piece := range p.pieces {
		if piece.item == item && key.chain == chain {
			delete(p.pieces, key)
		}
	}
}

// ApplyFXToRange splits the request's item at both ends of the range and puts the chain on the middle piece's take, in one undo
// step (bridge's apply_fx_range). It asks allowed itself first, so a refusal is the capability's own sentence.
func (r rangeFXApplier) ApplyFXToRange(ctx context.Context, request dawport.FXRangeRequest) (dawport.Result, error) {
	if refused, ok := r.refused(); ok {
		return refused, nil
	}
	got, err := r.actions.ApplyFXRange(ctx, request.ItemGUID, request.Start, request.End, request.ChainName, request.FadeMs)
	if refused, ok, err := fxRangeRefused(err); ok || err != nil {
		return refused, err
	}
	r.pieces.put(keyOf(request.RangeRequest, request.ChainName), appliedPiece{item: got.ItemGUID, take: got.TakeGUID})
	return dawport.OK(chainAddedMessage(request.ChainName, request.Words), true).WithUndoSteps(got.UndoPoints), nil
}

// RemoveFXFromRange takes the chain off the piece and joins the piece back to its neighbours, in one undo step (bridge's
// remove_fx_range). A piece that no longer carries the chain changes nothing.
func (r rangeFXApplier) RemoveFXFromRange(ctx context.Context, itemGUID, chainName string) (dawport.Result, error) {
	if refused, ok := r.refused(); ok {
		return refused, nil
	}
	got, err := r.actions.RemoveFXRange(ctx, itemGUID, chainName)
	if refused, ok, err := fxRangeRefused(err); ok || err != nil {
		return refused, err
	}
	r.pieces.forget(itemGUID, chainName)
	if got.UndoPoints == 0 {
		return dawport.OK(chainName+" is not on that piece in REAPER, so nothing changed.", false), nil
	}
	return dawport.OK(chainName+" taken off in REAPER.", true).WithUndoSteps(got.UndoPoints), nil
}

// FXRangeParams reads the settings of the chain on the target's piece (bridge's fx_range_params). It changes nothing.
func (r rangeFXApplier) FXRangeParams(ctx context.Context, target dawport.FXRangeTarget) (dawport.FXRangeSettings, error) {
	none := func(result dawport.Result, err error) (dawport.FXRangeSettings, error) {
		return dawport.FXRangeSettings{Result: result, Settings: []dawport.FXSetting{}}, err
	}
	if refused, ok := r.refused(); ok {
		return none(refused, nil)
	}
	piece := r.pieces.find(target)
	got, err := r.actions.FXRangeParams(ctx, piece.item, piece.take, target.ChainName)
	if refused, ok, err := r.fxEditRefused(piece, target.ChainName, err); ok || err != nil {
		return none(refused, err)
	}
	settings := make([]dawport.FXSetting, len(got.Params))
	for i, p := range got.Params {
		settings[i] = dawport.FXSetting{FX: p.FX, FXName: p.FXName, Index: p.Index, Name: p.Name, Value: p.Value, Min: p.Min, Max: p.Max,
			Step: p.Step, Formatted: p.Formatted}
	}
	what := fmt.Sprintf("Read %d settings of %s in REAPER.", len(settings), target.ChainName)
	if len(settings) == 1 {
		what = fmt.Sprintf("Read 1 setting of %s in REAPER.", target.ChainName)
	}
	return dawport.FXRangeSettings{Result: dawport.OK(what, false), Settings: settings, Truncated: got.Truncated, Bypassed: got.Bypassed}, nil
}

// SetFXRangeParam sets one setting of the chain on the target's piece, in one undo step (bridge's fx_range_set_param). A setting
// that already has the value changes nothing.
func (r rangeFXApplier) SetFXRangeParam(ctx context.Context, target dawport.FXRangeTarget, fx, index int, value float64) (dawport.Result, error) {
	if refused, ok := r.refused(); ok {
		return refused, nil
	}
	piece := r.pieces.find(target)
	got, err := r.actions.SetFXRangeParam(ctx, piece.item, piece.take, target.ChainName, fx, index, value)
	if refused, ok, err := r.fxEditRefused(piece, target.ChainName, err); ok || err != nil {
		return refused, err
	}
	if got.UndoPoints == 0 {
		return dawport.OK("That setting of "+target.ChainName+" is already "+got.Formatted+" in REAPER, so nothing changed.", false), nil
	}
	return dawport.OK("Set "+target.ChainName+" to "+got.Formatted+" in REAPER. Undo it there in one step.", true).WithUndoSteps(got.UndoPoints), nil
}

// BypassFXRange bypasses every effect of the chain on the target's piece, or turns them back on, in one undo step (bridge's
// fx_range_bypass). A chain already as asked changes nothing.
func (r rangeFXApplier) BypassFXRange(ctx context.Context, target dawport.FXRangeTarget, bypass bool) (dawport.Result, error) {
	if refused, ok := r.refused(); ok {
		return refused, nil
	}
	piece := r.pieces.find(target)
	got, err := r.actions.BypassFXRange(ctx, piece.item, piece.take, target.ChainName, bypass)
	if refused, ok, err := r.fxEditRefused(piece, target.ChainName, err); ok || err != nil {
		return refused, err
	}
	state := "bypassed"
	if !bypass {
		state = "on"
	}
	if got.UndoPoints == 0 {
		return dawport.OK(target.ChainName+" is already "+state+" in REAPER, so nothing changed.", false), nil
	}
	if bypass {
		return dawport.OK(target.ChainName+" bypassed in REAPER. Undo it there in one step.", true).WithUndoSteps(got.UndoPoints), nil
	}
	return dawport.OK(target.ChainName+" turned back on in REAPER. Undo it there in one step.", true).WithUndoSteps(got.UndoPoints), nil
}

// CompareFXRange plays the target's piece in REAPER with the chain on, then bypassed, and puts it back (bridge's
// fx_range_compare). It adds no undo step.
func (r rangeFXApplier) CompareFXRange(ctx context.Context, target dawport.FXRangeTarget) (dawport.FXRangeCompare, error) {
	if refused, ok := r.refused(); ok {
		return dawport.FXRangeCompare{Result: refused}, nil
	}
	piece := r.pieces.find(target)
	got, err := r.actions.CompareFXRange(ctx, piece.item, piece.take, target.ChainName)
	if refused, ok, err := r.fxEditRefused(piece, target.ChainName, err); ok || err != nil {
		return dawport.FXRangeCompare{Result: refused}, err
	}
	message := "Playing the words in REAPER with " + target.ChainName + " on, then bypassed. It is put back as it was after."
	return dawport.FXRangeCompare{Result: dawport.OK(message, false), Pass: got.End - got.Start}, nil
}

// StopFXCompare ends a Compare REAPER is playing and puts the chain back (bridge's stop_fx_compare).
func (r rangeFXApplier) StopFXCompare(ctx context.Context) (dawport.Result, error) {
	stopped, err := r.actions.StopFXCompare(ctx)
	if refused, ok, err := fxRangeRefused(err); ok || err != nil {
		return refused, err
	}
	if !stopped {
		return dawport.OK("REAPER was not comparing an effect, so nothing changed.", false), nil
	}
	return dawport.OK("Stopped comparing in REAPER. The effect is as it was.", true).WithUndoSteps(0), nil
}

// fxEditRefused is fxRangeRefused for the three edits: a piece, take or chain REAPER no longer has is stale in the effect's words,
// and the piece is forgotten so the next request names the item the words resolve to.
func (r rangeFXApplier) fxEditRefused(piece appliedPiece, chain string, err error) (dawport.Result, bool, error) {
	var stale *bridge.StaleError
	if errors.As(err, &stale) {
		r.pieces.forget(piece.item, chain)
		return dawport.RefusedStale(messageFXGone), true, nil
	}
	if errors.Is(err, bridge.ErrScriptOutdated) {
		return dawport.Refused(messageFXScriptOutdated), true, nil
	}
	return fxRangeRefused(err)
}

const (
	messageFXGone           = "That effect is no longer on those words in REAPER. Check the chapter again so the app finds where it is."
	messageFXScriptOutdated = "The Narration Utils script in REAPER is older than this app and cannot read or change an effect on words, so nothing was changed. Import the script again from this app's REAPER folder."
)

func (r rangeFXApplier) refused() (dawport.Result, bool) {
	if r.allowed == nil {
		return dawport.Result{}, false
	}
	return dawport.RefusedFrom(r.allowed(dawport.CapFXRange))
}

// fxRangeRefused maps bridge's answers for the two commands to a refusal; ok is false, with a nil error, when err is nil.
func fxRangeRefused(err error) (dawport.Result, bool, error) {
	var stale *bridge.StaleError
	var refusal *bridge.RefusalError
	switch {
	case err == nil:
		return dawport.Result{}, false, nil
	case errors.As(err, &stale):
		return dawport.RefusedStale("That passage's item is no longer in the REAPER project. Read the project again."), true, nil
	case errors.Is(err, bridge.ErrRecording):
		return dawport.Refused("REAPER is recording. Stop recording first."), true, nil
	case errors.Is(err, bridge.ErrBadFXRange):
		return dawport.Refused("The range for the chain is not a usable pair of times."), true, nil
	case errors.Is(err, bridge.ErrBadChainName):
		return dawport.Refused("That FX chain is not in the FXChains folder REAPER lists."), true, nil
	case errors.As(err, &refusal):
		return dawport.Refused(refusal.Sentence), true, nil
	case errors.Is(err, bridge.ErrExperimentalOff):
		return dawport.Refused(err.Error()), true, nil
	}
	return dawport.Result{}, false, err
}

// chainAddedMessage words a chain on a range as the mock does (studio-next/src/state/daw.ts, applyFxToRange).
func chainAddedMessage(chain string, words int) string {
	switch {
	case words <= 0:
		return "Added " + chain + " to the words in REAPER."
	case words == 1:
		return "Added " + chain + " to 1 word in REAPER."
	default:
		return fmt.Sprintf("Added %s to %d words in REAPER.", chain, words)
	}
}

// takeStacker is the stack_takes role over bridge's stack_takes and unstack_takes, answering a dawport.Result.
type takeStacker struct {
	actions *bridge.Actions
	allowed func(dawport.Capability) error
}

var _ dawport.TakeStacker = takeStacker{}

// StackTakes makes each group's later reads takes of the first read's item, in one undo step (bridge's stack_takes). It asks
// allowed itself first, so a refusal is the capability's own sentence.
func (r takeStacker) StackTakes(ctx context.Context, request dawport.StackRequest) (dawport.Result, error) {
	if refused, ok := r.refused(); ok {
		return refused, nil
	}
	got, err := r.actions.StackTakes(ctx, stackRequest(request))
	if refused, ok, err := stackRefused(err); ok || err != nil {
		return refused, err
	}
	return dawport.OK(takesMessage("Stacked", got.Takes), true).WithUndoSteps(got.UndoPoints), nil
}

// UnstackTakes puts stacked takes back where their reads were recorded, in one undo step (bridge's unstack_takes).
func (r takeStacker) UnstackTakes(ctx context.Context, request dawport.StackRequest) (dawport.Result, error) {
	if refused, ok := r.refused(); ok {
		return refused, nil
	}
	got, err := r.actions.UnstackTakes(ctx, stackRequest(request))
	if refused, ok, err := stackRefused(err); ok || err != nil {
		return refused, err
	}
	return dawport.OK(takesMessage("Moved back", got.Takes), true).WithUndoSteps(got.UndoPoints), nil
}

func (r takeStacker) refused() (dawport.Result, bool) {
	if r.allowed == nil {
		return dawport.Result{}, false
	}
	return dawport.RefusedFrom(r.allowed(dawport.CapStackTakes))
}

// stackRequest is the port's request in bridge's terms: a group's Base is its first read's take, and a move's TakeID the later
// read's take, both as REAPER's GUIDs.
func stackRequest(request dawport.StackRequest) bridge.StackRequest {
	out := bridge.StackRequest{Shift: request.Shift}
	for _, group := range request.Groups {
		moves := make([]bridge.StackMove, 0, len(group.Moves))
		for _, move := range group.Moves {
			moves = append(moves, bridge.StackMove{TakeGUID: move.TakeID, From: move.From, To: move.To, Len: move.Len})
		}
		out.Groups = append(out.Groups, bridge.StackGroup{ItemGUID: group.ItemGUID, BaseTakeGUID: group.Base, Moves: moves})
	}
	return out
}

// stackRefused maps bridge's answers for the two commands to a refusal, in the mock's words where it has them
// (studio-next/src/fixtures/daw.ts); ok is false, with a nil error, when err is nil.
func stackRefused(err error) (dawport.Result, bool, error) {
	var stale *bridge.StaleError
	var refusal *bridge.RefusalError
	switch {
	case err == nil:
		return dawport.Result{}, false, nil
	case errors.As(err, &stale):
		return dawport.RefusedStale("That item changed in REAPER since the app read it. Nothing was changed."), true, nil
	case errors.Is(err, bridge.ErrNothingToStack):
		return dawport.Refused("There are no retries to move in REAPER."), true, nil
	case errors.Is(err, bridge.ErrRecording):
		return dawport.Refused("REAPER is recording. Stop recording first."), true, nil
	case errors.Is(err, bridge.ErrBadStack):
		return dawport.Refused("The takes to stack are not ones REAPER can read. Nothing was changed."), true, nil
	case errors.As(err, &refusal):
		return dawport.Refused(refusal.Sentence), true, nil
	case errors.Is(err, bridge.ErrExperimentalOff):
		return dawport.Refused(err.Error()), true, nil
	}
	return dawport.Result{}, false, err
}

// takesMessage words a stack or un-stack as the mock does (studio-next/src/state/daw.ts, restack).
func takesMessage(verb string, takes int) string {
	if takes == 1 {
		return verb + " 1 take in REAPER."
	}
	return fmt.Sprintf("%s %d takes in REAPER.", verb, takes)
}
