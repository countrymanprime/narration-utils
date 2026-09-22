// Package projectstate is the host's end of the REAPER live "project changed" indicator (the project_state
// bridge command; see docs/prds/reaper-automation-follow-through.prd.md Phase 13, "Change-driven re-compare
// indicator", and docs/prds/analysis-evidence-ledger.prd.md Open Question 12, answered (B)). It is a Could-tier,
// coarse hint: REAPER's own edit counter (GetProjectStateChangeCount), read only while REAPER is open from this
// app, alongside the saved .rpp file's modification time (stat'd here - Lua has no portable file-stat call, and
// the host already reads paths like this one elsewhere).
//
// This package makes no staleness decision by itself: Check reports the live count and the saved file's mtime,
// and ChangedSince compares a later count to a baseline a caller captured earlier. Any consumer that already has
// a saved-file-mtime-based staleness check (for example, a future evaluator under apps/desktop/internal/evidence)
// treats this only as an additional, optional live hint on top of its existing basis, never a replacement for it:
// this package has no opinion on what "stale" means for another feature.
package projectstate

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// Config is the session path the service needs to talk to REAPER over the file bridge.
type Config struct{ SessionDir string }

// Service is the state machine for one check at a time, mirroring renderconfig.Service and pickups.Service.
type Service struct {
	mu      sync.RWMutex
	config  Config
	bridge  *bridge.Client
	changed func(map[string]any)
	state   map[string]any
}

// New builds the service and, when there is a bridge, subscribes to PROJECT_STATE and ERROR events for its own
// run (or, with no run, a session-level problem). The transcript, line-identity, pickups and render-config
// services subscribe independently on the same client; Dispatch fans events out to all of them.
func New(config Config, client *bridge.Client, changed func(map[string]any)) *Service {
	s := &Service{config: config, bridge: client, changed: changed, state: empty()}
	if client != nil {
		client.Subscribe(bridge.Subscription{
			Tags:    []string{"PROJECT_STATE", "ERROR"},
			Owns:    s.ownsRun,
			Handle:  func(event bridge.Event) { s.Handle(event.Fields) },
			Invalid: s.handleInvalid,
		})
	}
	return s
}

func empty() map[string]any {
	return map[string]any{
		"runId": nil, "phase": "idle", "message": "",
		"changeCount": nil, "projectFile": "", "savedModifiedAt": nil,
	}
}

// Check asks REAPER for its live change count and the current project's saved-file path. Snapshot's changeCount,
// projectFile and savedModifiedAt update once REAPER answers (Handle); until then phase stays "checking". With
// no bridge (a standalone launch, or REAPER not opened from this app) it fails immediately.
func (s *Service) Check() error {
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	runID := newRunID()
	s.begin(runID)
	if _, err := s.bridge.Send("project_state", []string{runID}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// ChangedSince reports whether current differs from a baseline captured earlier. REAPER's counter only ever
// increases while a project stays open, so any difference means at least one edit happened since the baseline
// was read; it is deliberately coarse (Phase 13's own scope: a label, never an automatic re-run) and says
// nothing about what changed or how much.
func ChangedSince(current, baseline int) bool {
	return current != baseline
}

// Drain delivers the events REAPER has appended since the last call, to this service and to every other
// consumer subscribed to the same bridge.
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

func (s *Service) begin(runID string) {
	s.mu.Lock()
	s.state = empty()
	s.state["runId"], s.state["phase"], s.state["message"] = runID, "checking", "Checking REAPER's project state…"
	s.mu.Unlock()
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

func (s *Service) handleInvalid(event bridge.Event, reason error) {
	message := fmt.Sprintf("The Narration Utils script in REAPER sent a message this app could not read (%v). Import the script from this app's REAPER folder again, then try again.", reason)
	s.mu.Lock()
	if s.state["phase"] != "checking" {
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

func (s *Service) acceptsLocked(fields []string) bool {
	runID, _ := s.state["runId"].(string)
	if fields[0] == "ERROR" {
		if len(fields) < 2 {
			return false
		}
		if fields[1] == "" {
			return s.state["phase"] == "checking"
		}
		return fields[1] == runID
	}
	return len(fields) <= 1 || fields[1] == runID
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
	case "PROJECT_STATE":
		if len(fields) >= 4 && s.state["phase"] == "checking" {
			count, path := intAt(fields, 2), textAt(fields, 3)
			s.state["changeCount"], s.state["projectFile"] = count, path
			s.state["savedModifiedAt"] = savedModifiedAt(path)
			s.state["phase"], s.state["message"] = "success", "Checked REAPER's project state."
			changed = true
		}
	case "ERROR":
		message := "REAPER integration failed."
		if len(fields) > 2 {
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

// savedModifiedAt stats path (the saved .rpp REAPER named) and answers its modification time as Unix
// milliseconds, or nil when the project has never been saved (path is empty) or the file cannot be read (a
// standalone .rpp move, a permissions problem): a caller falls back to whatever saved-file basis it already has.
func savedModifiedAt(path string) any {
	if path == "" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	return info.ModTime().UnixMilli()
}

func newRunID() string { return fmt.Sprintf("%d000", time.Now().UnixMilli()) }
func textAt(values []string, index int) string {
	if index < len(values) {
		return values[index]
	}
	return ""
}
func intAt(values []string, index int) int {
	result, _ := strconv.Atoi(textAt(values, index))
	return result
}
func clone(value map[string]any) map[string]any {
	bytes, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(bytes, &result)
	return result
}
