// Package reaper is the DAW port's REAPER adapter (ADR 0300, DAW port PRD P2). It wraps what exists and rewrites nothing: the
// synchronous roles are today's bridge.Navigator, bridge.Actions, bridge.CleanupClient, bridge.LevelMatchClient, daw.Reachability
// and dawadapter.Reaper as they are, the offline reader is tracks.Parse, and each asynchronous role writes exactly the bridge
// command its service writes today. Its declaration is today's behaviour: a capability is Experimental when bridge.Actions gates
// its commands behind the "Experimental REAPER actions" switch (bridge's experimentalCommands), and Supported otherwise, except
// silence trim and level matching, which were built but never wired and so start Experimental.
//
// Importing the package registers its factory for dawport.KindREAPER.
package reaper

import (
	"errors"
	"fmt"
	"maps"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/dawadapter"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

func init() { dawport.Register(dawport.KindREAPER, Factory) }

// ErrNoSession: the launch has no REAPER session directory (NarrationUtils_Launcher.lua makes one), so there is no bridge to wrap.
var ErrNoSession = errors.New("REAPER is not connected to this app: there is no REAPER session to talk to")

// declares is the adapter's static declaration. Promoting a command once the owner's REAPER verification pass has confirmed it
// (booth actions enablement PRD) is moving its capability from Experimental to Supported here, in the same PR that takes the
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
	// bridge's experimentalCommands: chapter_track_state; arm_only, record_start, record_stop; punch_to, play_position;
	// create_regions; set_active_take; list_fx_chains, apply_fx_chain, list_fx, add_take_fx.
	dawport.CapTrackState: dawport.Experimental,
	dawport.CapRecord:     dawport.Experimental,
	dawport.CapPunch:      dawport.Experimental,
	dawport.CapRegions:    dawport.Experimental,
	dawport.CapTakes:      dawport.Experimental,
	dawport.CapFXChains:   dawport.Experimental,
	// Built, never wired to a binding, so never gated: Experimental keeps them off until they are verified.
	dawport.CapSilenceTrim: dawport.Experimental,
	dawport.CapItemGain:    dawport.Experimental,
}

// commandCapability is the capability each of bridge.Actions' commands belongs to. Actions asks its gate about a command by name, and
// Gate answers with that capability's Allowed, so the resolver decides and the command list stays in bridge. Every command Actions
// sends has a row, whether or not it is still Experimental: promoting one is a declaration change above, not a change here.
var commandCapability = map[string]dawport.Capability{
	"chapter_track_state": dawport.CapTrackState,
	"arm_only":            dawport.CapRecord,
	"record_start":        dawport.CapRecord,
	"record_stop":         dawport.CapRecord,
	"punch_to":            dawport.CapPunch,
	"play_position":       dawport.CapPunch,
	"create_regions":      dawport.CapRegions,
	"set_active_take":     dawport.CapTakes,
	"list_fx_chains":      dawport.CapFXChains,
	"apply_fx_chain":      dawport.CapFXChains,
	"list_fx":             dawport.CapFXChains,
	"add_take_fx":         dawport.CapFXChains,
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
// build a resolver to gate the bridge.Actions it still makes itself, until the DAW port PRD's P5a moves those consumers onto this
// package's roles. It is never registered and fails the conformance suite by design; Role[T] on it is a *dawport.RoleError.
func Declaration() dawport.Adapter { return declaration{} }

type declaration struct{}

func (declaration) Kind() dawport.Kind                             { return dawport.KindREAPER }
func (declaration) Declares() map[dawport.Capability]dawport.Level { return maps.Clone(declares) }
func (declaration) Role(dawport.Capability) any                    { return nil }
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
			dawport.CapReview:       dawadapter.NewReaper(client),
			dawport.CapNavigate:     navigator,
			dawport.CapMarkers:      navigator,
			dawport.CapPickups:      pickupList{commands},
			dawport.CapLineIdentity: lineStamper{commands},
			dawport.CapRenderConfig: renderConfigurer{commands},
			dawport.CapCleanupTools: cleanupLauncher{commands},
			dawport.CapRetakeLanes:  retakeLanePicker{commands},
			dawport.CapProjectState: projectStateReader{commands},
			dawport.CapTakeCreate:   takeCreator{commands},
			dawport.CapHeartbeat:    heartbeat,
			dawport.CapProjectRead:  projectReader{},
			dawport.CapTrackState:   actions,
			dawport.CapRecord:       actions,
			dawport.CapPunch:        actions,
			dawport.CapRegions:      actions,
			dawport.CapTakes:        actions,
			dawport.CapFXChains:     actions,
			dawport.CapSilenceTrim:  bridge.NewCleanupClient(client),
			dawport.CapItemGain:     bridge.NewLevelMatchClient(client),
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

// projectReader reads a saved .rpp with REAPER closed.
type projectReader struct{}

func (projectReader) ReadProject(path string) (dawport.Project, error) { return tracks.Parse(path) }
