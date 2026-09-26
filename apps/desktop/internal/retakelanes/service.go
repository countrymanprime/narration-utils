package retakelanes

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// itemGUIDPattern is a REAPER item GUID as the saved project writes it (IGUID {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}).
var itemGUIDPattern = regexp.MustCompile(`^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$`)

// Config is the session path the service needs to talk to REAPER over the file bridge.
type Config struct{ SessionDir string }

// Service is the state machine for one pick at a time, the way cleanuptools.Service is for one launch.
type Service struct {
	mu      sync.RWMutex
	config  Config
	bridge  *bridge.Client
	changed func(map[string]any)
	state   map[string]any
}

// New builds the service and, when there is a bridge, subscribes to RETAKE_LANE_PICKED and ERROR events for its own
// run (or, with no run, a session-level problem while a pick is in flight).
func New(config Config, client *bridge.Client, changed func(map[string]any)) *Service {
	s := &Service{config: config, bridge: client, changed: changed, state: Idle()}
	if client != nil {
		client.Subscribe(bridge.Subscription{
			Tags:    []string{"RETAKE_LANE_PICKED", "ERROR"},
			Owns:    s.ownsRun,
			Handle:  func(event bridge.Event) { s.Handle(event.Fields) },
			Invalid: s.handleInvalid,
		})
	}
	return s
}

// Idle is the state before any pick; the binding answers it when there is no service.
func Idle() map[string]any {
	return map[string]any{"runId": nil, "phase": "idle", "message": "", "lineId": "", "itemGuid": "", "trackName": "", "lane": nil}
}

// Pick asks REAPER to make the named retake's lane the only one playing on its track. The retake must be one the
// saved project lists (Lines), so only a retake the narrator was shown can be picked. The result comes back on
// RETAKE_LANE_PICKED or ERROR (Handle).
func (s *Service) Pick(project tracks.Project, lineID, itemGUID string, run *runlog.Run) error {
	if strings.TrimSpace(lineID) == "" || !itemGUIDPattern.MatchString(itemGUID) {
		return fmt.Errorf("choose a retake to play")
	}
	line, _, ok := Lines(project).Find(lineID, itemGUID)
	if !ok {
		return fmt.Errorf("that retake is not on a fixed-lane track in the saved project; save the project in REAPER and open the list again")
	}
	run.Decision("lane.chosen", "chose the retake's lane to play", "track_name", line.TrackName, "candidate_count", len(line.Retakes), "item_guid", itemGUID)
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	if err := os.MkdirAll(s.config.SessionDir, 0o755); err != nil {
		return fmt.Errorf("could not prepare the REAPER session directory: %w", err)
	}
	runID := newRunID()
	s.mu.Lock()
	s.state = Idle()
	s.state["runId"], s.state["phase"] = runID, "picking"
	s.state["lineId"], s.state["itemGuid"], s.state["trackName"] = lineID, itemGUID, line.TrackName
	s.state["message"] = fmt.Sprintf("Asking REAPER to play this retake on %s…", line.TrackName)
	s.mu.Unlock()
	if _, err := s.bridge.Send("pick_retake_lane", []string{runID, lineID, itemGUID, run.ID(), run.Level()}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Drain delivers the events REAPER has appended since the last call, to this service and every other consumer.
func (s *Service) Drain() error {
	if s.bridge == nil {
		return nil
	}
	return s.bridge.Dispatch()
}

func (s *Service) Snapshot() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return clone(s.state)
}

func (s *Service) notify() {
	if s.changed != nil {
		s.changed(s.Snapshot())
	}
}

func (s *Service) fail(message string) {
	s.mu.Lock()
	s.state["phase"], s.state["message"] = "error", message
	s.mu.Unlock()
	s.notify()
}

func (s *Service) ownsRun(runID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current, _ := s.state["runId"].(string)
	return runID != "" && runID == current
}

func (s *Service) handleInvalid(_ bridge.Event, reason error) {
	message := fmt.Sprintf("The Narration Utils script in REAPER sent a message this app could not read (%v). Import the script from this app's REAPER folder again, then try again.", reason)
	s.mu.Lock()
	if s.state["phase"] != "picking" {
		s.mu.Unlock()
		return
	}
	s.state["phase"], s.state["message"] = "error", message
	snapshot := clone(s.state)
	s.mu.Unlock()
	if s.changed != nil {
		s.changed(snapshot)
	}
}

// acceptsLocked keeps only this run's events while a pick is in flight; a run-less ERROR is a session-level problem
// and fails the pick in flight.
func (s *Service) acceptsLocked(fields []string) bool {
	if s.state["phase"] != "picking" || len(fields) < 2 {
		return false
	}
	runID, _ := s.state["runId"].(string)
	if fields[0] == "ERROR" && fields[1] == "" {
		return true
	}
	return fields[1] == runID
}

// pickedLocked applies RETAKE_LANE_PICKED|run|line|guid|lane when it names the retake this run asked for.
func (s *Service) pickedLocked(fields []string) bool {
	itemGUID, _ := s.state["itemGuid"].(string)
	if len(fields) < 5 || fields[2] != s.state["lineId"] || !strings.EqualFold(fields[3], itemGUID) {
		return false
	}
	lane, err := strconv.Atoi(fields[4])
	if err != nil || lane < 0 {
		return false
	}
	s.state["phase"], s.state["lane"] = "picked", lane
	s.state["message"] = fmt.Sprintf("Lane %d is now the only lane playing on %s. To go back, use Undo in REAPER: it restores what played before.", lane+1, s.state["trackName"])
	return true
}

func (s *Service) Handle(fields []string) {
	if len(fields) == 0 {
		return
	}
	s.mu.Lock()
	if !s.acceptsLocked(fields) {
		s.mu.Unlock()
		return
	}
	changed := false
	switch fields[0] {
	case "RETAKE_LANE_PICKED":
		changed = s.pickedLocked(fields)
	case "ERROR":
		message := "REAPER integration failed."
		if len(fields) > 2 && fields[2] != "" {
			message = fields[2]
		}
		s.state["phase"], s.state["message"] = "error", message
		changed = true
	}
	snapshot := clone(s.state)
	s.mu.Unlock()
	if changed && s.changed != nil {
		s.changed(snapshot)
	}
}

func newRunID() string { return fmt.Sprintf("%d000", time.Now().UnixMilli()) }

func clone(value map[string]any) map[string]any {
	bytes, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(bytes, &result)
	return result
}
