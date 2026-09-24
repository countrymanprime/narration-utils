// Package renderconfig is the host's end of the per-chapter render configuration command over the REAPER file
// bridge (configure_chapter_render; see docs/architecture/reaper-bridge.md and
// docs/research/reaper-spike-s5-render-details.md). It is the bridge's fourth real consumer, mirroring
// pickups.Service and lineidentity.Service.
//
// Phase 11 (reaper-automation-follow-through PRD) / Open Question 7, answered (a): configure only. This package
// never sends a command that renders anything - it only asks Lua to set RENDER_FILE, RENDER_PATTERN and
// RENDER_BOUNDSFLAG and to read RENDER_TARGETS back, so the narrator can see the resulting file names before
// pressing Render themselves in REAPER (Ctrl+Alt+R or File > Render). The S5 spike found that a render action's
// ID passed to the RENDER_STATS getter can trigger a real render, so nothing in this package, the Lua command it
// calls, or the UI it drives ever reads that key or sends a render action.
package renderconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// Config is the session path the service needs to talk to REAPER over the file bridge.
type Config struct{ SessionDir string }

// Service is the state machine for one configure run at a time, mirroring pickups.Service and lineidentity.Service.
type Service struct {
	mu      sync.RWMutex
	config  Config
	bridge  *bridge.Client
	changed func(map[string]any)
	// +checklocks:mu
	state map[string]any
}

// New builds the service and, when there is a bridge, subscribes to RENDER_CONFIGURED and ERROR events for its
// own run (or, with no run, a session-level problem). The transcript, line-identity and pickups services
// subscribe independently on the same client; Dispatch fans events out to all four.
func New(config Config, client *bridge.Client, changed func(map[string]any)) *Service {
	s := &Service{config: config, bridge: client, changed: changed, state: empty()}
	if client != nil {
		client.Subscribe(bridge.Subscription{
			Tags:    []string{"RENDER_CONFIGURED", "ERROR"},
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
		"folder": "", "targets": []string{}, "count": 0,
	}
}

// Configure asks REAPER to set the render bounds to all regions, the naming pattern to the region name, and the
// output folder to outputFolder. It never sends anything that renders: the resulting file names come back on
// RENDER_CONFIGURED (Handle), read from RENDER_TARGETS by the Lua side.
func (s *Service) Configure(outputFolder string) error {
	outputFolder = strings.TrimSpace(outputFolder)
	if outputFolder == "" {
		return fmt.Errorf("an output folder is required")
	}
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	if err := os.MkdirAll(s.config.SessionDir, 0o755); err != nil {
		return fmt.Errorf("could not prepare the REAPER session directory: %w", err)
	}
	runID := newRunID()
	s.begin(runID, "configuring", "Configuring the chapter render…")
	if _, err := s.bridge.Send("configure_chapter_render", []string{runID, outputFolder}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
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

func (s *Service) begin(runID, phase, message string) {
	s.mu.Lock()
	s.state = empty()
	s.state["runId"], s.state["phase"], s.state["message"] = runID, phase, message
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
	if s.state["phase"] != "configuring" {
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

// +checklocks:s.mu
func (s *Service) acceptsLocked(fields []string) bool {
	runID, _ := s.state["runId"].(string)
	if fields[0] == "ERROR" {
		if len(fields) < 2 {
			return false
		}
		if fields[1] == "" {
			return s.state["phase"] == "configuring"
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
	case "RENDER_CONFIGURED":
		if len(fields) >= 5 && s.state["phase"] == "configuring" {
			folder, count, targets := textAt(fields, 2), intAt(fields, 3), splitTargets(textAt(fields, 4))
			s.state["folder"], s.state["count"], s.state["targets"] = folder, count, targets
			s.state["phase"], s.state["message"] = "success", configuredSummary(count)
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

// splitTargets parses RENDER_TARGETS' semicolon-joined path list (narration_render.lua) into individual file
// paths; an empty string (no chapter regions yet) yields an empty slice, never a slice holding one empty string.
func splitTargets(value string) []string {
	if value == "" {
		return []string{}
	}
	return strings.Split(value, ";")
}

func configuredSummary(count int) string {
	if count == 0 {
		return "Render configured. No chapter regions were found yet: create them before rendering."
	}
	return fmt.Sprintf("Render configured for %d chapter file%s. Press Render in REAPER to create them.", count, plural(count))
}

func newRunID() string { return fmt.Sprintf("%d000", time.Now().UnixMilli()) }
func plural(value int) string {
	if value == 1 {
		return ""
	}
	return "s"
}
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

// SuggestedFolder is not used by Service.Configure directly (the narrator can edit it), but keeps the natural
// default - a "renders" subfolder of the project - in one place for the binding layer to offer.
func SuggestedFolder(projectFolder string) string {
	if projectFolder == "" {
		return ""
	}
	return filepath.Join(projectFolder, "renders")
}
