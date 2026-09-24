package daw

import (
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// heartbeatTimeout is how long since the last PROJECT_STATUS event still counts as "REAPER is running" (Phase 7,
// W10). It only has to outlast one missed tick of both sides: narration_ui_bridge.lua's own heartbeat interval
// (heartbeatIntervalSeconds in narration_ui_bridge.lua, currently 1.5s) and the host's poll cadence
// (transcriptLoop, 150ms). Five seconds gives generous margin for a slow tick without taking long to notice REAPER
// closing.
const heartbeatTimeout = 5 * time.Second

// Reachability tracks the last PROJECT_STATUS heartbeat a REAPER bridge session broadcast (ADR 0092, W10): the
// events.log line narration_ui_bridge.lua's tick loop now appends periodically with an empty run ID, delivered
// through events.go's existing fan-out (a run-less event reaches every subscriber) rather than a second polled
// file. It answers the three Bootstrap facts dawfacts.go needs: whether REAPER is reachable at all, and whether
// its open project matches a linked file.
type Reachability struct {
	mu       sync.Mutex
	lastSeen time.Time
	// +checklocks:mu
	rpp string
	// +checklocks:mu
	unsaved bool
	now     func() time.Time
}

// NewReachability subscribes to client's PROJECT_STATUS broadcasts. client may be nil (no live bridge for this
// project, for example before a session directory exists); the returned tracker then always reports unreachable.
func NewReachability(client *bridge.Client) *Reachability {
	reach := &Reachability{now: time.Now}
	if client != nil {
		client.Subscribe(bridge.Subscription{
			Tags:   []string{"PROJECT_STATUS"},
			Handle: reach.Record,
		})
	}
	return reach
}

// Record is the Subscription.Handle callback (exported so a test can deliver an event directly, without a real
// bridge.Client): event.Fields is [tag, run, rpp, unsaved] once it has passed wire.go's table (CheckEvent), so
// both trailing fields are always present.
func (r *Reachability) Record(event bridge.Event) {
	rpp, unsaved := "", false
	if len(event.Fields) > 2 {
		rpp = event.Fields[2]
	}
	if len(event.Fields) > 3 {
		unsaved = event.Fields[3] == "1"
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lastSeen = r.now()
	r.rpp = rpp
	r.unsaved = unsaved
}

// Reachable reports whether a heartbeat arrived recently enough to trust: REAPER is running and the bridge tick
// loop is live.
func (r *Reachability) Reachable() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reachableLocked()
}

func (r *Reachability) reachableLocked() bool {
	return !r.lastSeen.IsZero() && r.now().Sub(r.lastSeen) <= heartbeatTimeout
}

// CurrentProject returns the open project's path and whether it is unsaved, as of the last heartbeat. Both are
// zero values when no heartbeat has ever arrived.
func (r *Reachability) CurrentProject() (rpp string, unsaved bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.rpp, r.unsaved
}

// Matches reports whether the project REAPER has open right now (per the last, still-fresh heartbeat) is
// linkedPath: normalized and compared case-insensitively (Windows paths), per the PRD's "Mismatch detection"
// success metric. An unsaved project, a stale heartbeat, or an empty linkedPath never match.
func (r *Reachability) Matches(linkedPath string) bool {
	if linkedPath == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.reachableLocked() || r.unsaved || r.rpp == "" {
		return false
	}
	return strings.EqualFold(filepath.Clean(r.rpp), filepath.Clean(linkedPath))
}
