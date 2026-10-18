package daw

import (
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// heartbeatTimeout is how long since the last PROJECT_STATUS event still counts as "REAPER is running". It only has to outlast one missed tick of both sides: narration_ui_bridge.lua's own heartbeat interval
// (M.HEARTBEAT_INTERVAL_SECONDS in narration_ui_bridge.lua, 1.5s) and the host's poll cadence
// (transcriptLoop, 150ms). Five seconds gives generous margin for a slow tick without taking long to notice REAPER
// closing.
const heartbeatTimeout = 5 * time.Second

// Reachability tracks the last PROJECT_STATUS heartbeat a REAPER bridge session broadcast: the
// events.log line narration_ui_bridge.lua's tick loop appends periodically with an empty run ID, delivered
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
	// changeCount is REAPER's edit counter from the heartbeat's optional fourth field; hasChangeCount is false when
	// the last heartbeat did not carry one (an older script, or a REAPER without GetProjectStateChangeCount).
	// +checklocks:mu
	changeCount int
	// +checklocks:mu
	hasChangeCount bool
	// transport is the heartbeat's optional fifth and sixth fields; hasTransport is false
	// when the last heartbeat did not carry them (an older script).
	// +checklocks:mu
	transport Transport
	// +checklocks:mu
	hasTransport bool
	now          func() time.Time
}

// Transport is REAPER's transport as of the last heartbeat: GetPlayState's play and record bits and GetPlayPosition.
// Recording counts a paused recording too, since its take is still open; Playing is the play bit alone, so it is also
// true while recording. Position is in project seconds, and moves on only with each heartbeat (about 1.5s apart).
type Transport struct {
	Playing   bool
	Recording bool
	Position  float64
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
// both trailing fields are always present, and a
// fifth, the edit counter, may follow, then the transport's play state and play position.
func (r *Reachability) Record(event bridge.Event) {
	rpp, unsaved := "", false
	if len(event.Fields) > 2 {
		rpp = event.Fields[2]
	}
	if len(event.Fields) > 3 {
		unsaved = event.Fields[3] == "1"
	}
	changeCount, hasChangeCount := 0, false
	if len(event.Fields) > 4 && event.Fields[4] != "" {
		// wire.go has already checked a non-empty changeCount is a whole number.
		changeCount, _ = strconv.Atoi(event.Fields[4])
		hasChangeCount = true
	}
	transport, hasTransport := Transport{}, false
	if len(event.Fields) > 6 && event.Fields[5] != "" {
		// wire.go has already checked both are numbers.
		playState, _ := strconv.Atoi(event.Fields[5])
		position, _ := strconv.ParseFloat(event.Fields[6], 64)
		transport = Transport{Playing: playState&1 != 0, Recording: playState&4 != 0, Position: position}
		hasTransport = true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lastSeen = r.now()
	r.rpp = rpp
	r.unsaved = unsaved
	r.changeCount, r.hasChangeCount = changeCount, hasChangeCount
	r.transport, r.hasTransport = transport, hasTransport
}

// Transport returns REAPER's transport from the last heartbeat, and whether it is known: the heartbeat must be fresh and
// must have carried it. A REAPER that stopped answering is not reported as still recording.
func (r *Reachability) Transport() (Transport, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.reachableLocked() || !r.hasTransport {
		return Transport{}, false
	}
	return r.transport, true
}

// ChangeCount returns REAPER's edit counter (GetProjectStateChangeCount) from the last heartbeat, and whether it is
// known: the heartbeat must be fresh and must have carried one. The counter
// rises on every edit in REAPER, saved or not, and starts again when a project is (re)opened, so a consumer compares
// it only with a count read from the same open project.
func (r *Reachability) ChangeCount() (int, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.reachableLocked() || !r.hasChangeCount {
		return 0, false
	}
	return r.changeCount, true
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
// linkedPath: normalized and compared case-insensitively (Windows paths). An unsaved project, a stale heartbeat, or an empty linkedPath never match.
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

// HeartbeatTimeout is how old the last heartbeat may be and still count as REAPER running, for a trace that records the
// threshold beside the age it was judged against.
func HeartbeatTimeout() time.Duration { return heartbeatTimeout }

// LastSeenAge is how long ago the last heartbeat arrived, and false when none ever has (so there is no age to report).
func (r *Reachability) LastSeenAge() (time.Duration, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.lastSeen.IsZero() {
		return 0, false
	}
	return r.now().Sub(r.lastSeen), true
}

// MatchReason says why Matches answers as it does, as one word: ok, no_link (nothing is linked), stale (no fresh
// heartbeat), no_project (REAPER has no project open), unsaved or path_differs. It is for the trace; Matches stays the
// answer callers act on.
func (r *Reachability) MatchReason(linkedPath string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch {
	case linkedPath == "":
		return "no_link"
	case !r.reachableLocked():
		return "stale"
	case r.rpp == "":
		return "no_project"
	case r.unsaved:
		return "unsaved"
	case !strings.EqualFold(filepath.Clean(r.rpp), filepath.Clean(linkedPath)):
		return "path_differs"
	default:
		return "ok"
	}
}
