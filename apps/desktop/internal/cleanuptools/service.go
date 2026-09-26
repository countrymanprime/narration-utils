// Package cleanuptools is the host's end of the cleanup launchers over the REAPER file bridge (launch_cleanup_tool in
// integrations/reaper/narration_cleanup.lua; reaper-automation-follow-through PRD Phase 23, ADR 0146). It asks REAPER
// to open its own Repair Pops/Clicks dialog, or the narrator's installed Magnolius DeClick script, on the items the
// narrator has selected. It mirrors renderconfig.Service: one run at a time, reported by phase.
//
// The app changes nothing itself. The only thing sent is an allow-listed tool key (Tools): never an action ID or
// name, so the bridge cannot be asked to run any other REAPER action. The Lua side keeps the same allow-list and
// finds the action by its action-list name.
package cleanuptools

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

// Tool is one allow-listed cleanup tool: the key the bridge carries and the name the narrator sees.
type Tool struct {
	Key   string
	Label string
}

// Tools is the allow-list, in the order the UI offers them. narration_cleanup.lua's TOOLS holds the same keys.
var Tools = []Tool{
	{Key: "repair_pops_clicks", Label: "Repair Pops/Clicks"},
	{Key: "magnolius_declick", Label: "Magnolius DeClick"},
}

func lookup(key string) (Tool, bool) {
	for _, tool := range Tools {
		if tool.Key == key {
			return tool, true
		}
	}
	return Tool{}, false
}

// Config is the session path the service needs to talk to REAPER over the file bridge.
type Config struct{ SessionDir string }

// Service is the state machine for one launch at a time.
type Service struct {
	mu      sync.RWMutex
	config  Config
	bridge  *bridge.Client
	changed func(map[string]any)
	// +checklocks:mu
	state map[string]any
}

// New builds the service and, when there is a bridge, subscribes to CLEANUP_LAUNCHED and ERROR events for its own
// run (or, with no run, a session-level problem while a launch is in flight).
func New(config Config, client *bridge.Client, changed func(map[string]any)) *Service {
	s := &Service{config: config, bridge: client, changed: changed, state: Idle()}
	if client != nil {
		client.Subscribe(bridge.Subscription{
			Tags:    []string{"CLEANUP_LAUNCHED", "ERROR"},
			Owns:    s.ownsRun,
			Handle:  func(event bridge.Event) { s.Handle(event.Fields) },
			Invalid: s.handleInvalid,
		})
	}
	return s
}

// Idle is the state before any launch; the binding answers it when there is no service.
func Idle() map[string]any {
	return map[string]any{"runId": nil, "phase": "idle", "message": "", "tool": "", "action": ""}
}

// Launch asks REAPER to open the allow-listed tool's dialog on the selected items. The result comes back on
// CLEANUP_LAUNCHED or ERROR (Handle).
func (s *Service) Launch(key string, run *runlog.Run) error {
	tool, ok := lookup(key)
	if !ok {
		return fmt.Errorf("unknown cleanup tool %q", key)
	}
	run.Decision("tool.matched", "matched an allow-listed cleanup tool", "tool_key", tool.Key)
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	if err := os.MkdirAll(s.config.SessionDir, 0o755); err != nil {
		return fmt.Errorf("could not prepare the REAPER session directory: %w", err)
	}
	runID := newRunID()
	s.mu.Lock()
	s.state = Idle()
	s.state["runId"], s.state["phase"], s.state["tool"] = runID, "launching", tool.Key
	s.state["message"] = fmt.Sprintf("Opening %s in REAPER…", tool.Label)
	s.mu.Unlock()
	if _, err := s.bridge.Send("launch_cleanup_tool", []string{runID, tool.Key}); err != nil {
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
	if s.state["phase"] != "launching" {
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

// acceptsLocked keeps only this run's events while a launch is in flight; a run-less ERROR is a session-level
// problem and fails the launch in flight.
// +checklocks:s.mu
func (s *Service) acceptsLocked(fields []string) bool {
	if s.state["phase"] != "launching" || len(fields) < 2 {
		return false
	}
	runID, _ := s.state["runId"].(string)
	if fields[0] == "ERROR" && fields[1] == "" {
		return true
	}
	return fields[1] == runID
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
	case "CLEANUP_LAUNCHED":
		if len(fields) >= 4 && fields[2] == s.state["tool"] {
			tool, _ := lookup(fields[2])
			s.state["phase"], s.state["action"] = "launched", fields[3]
			s.state["message"] = fmt.Sprintf("%s is open in REAPER. Nothing has changed yet: the repair happens only when you apply it there.", tool.Label)
			changed = true
		}
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
