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
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
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

// Service is the state machine for one launch at a time. Silence trim and level matching (DAW port PRD Phase
// 5b) are a second, synchronous pair of roles on the same service: built in P2 and never wired to anything
// (diagnostics-delivery-and-cleanup-tools PRD Phases 10 and 11 built the Lua and Go client but left "a
// narrator-facing trigger" for later work), they take their SilenceTrimmer and GainAdjuster roles here so a
// binding can call PreviewSilenceTrim, ApplySilenceTrim and ApplyGain once one exists.
type Service struct {
	mu             sync.RWMutex
	config         Config
	launcher       dawport.CleanupLauncher
	silenceTrimmer dawport.SilenceTrimmer
	gainAdjuster   dawport.GainAdjuster
	changed        func(map[string]any)
	// +checklocks:mu
	state map[string]any
}

// New builds the service over launcher, silenceTrimmer and gainAdjuster (DAW port PRD Phase 5b: cleanup tools
// depend on the roles they use, never a concrete bridge client). When there is a launcher it subscribes to
// CLEANUP_LAUNCHED and ERROR events for its own run (or, with no run, a session-level problem while a launch is
// in flight); silenceTrimmer and gainAdjuster are synchronous roles (roles.go) and need no subscription of
// their own.
func New(config Config, launcher dawport.CleanupLauncher, silenceTrimmer dawport.SilenceTrimmer, gainAdjuster dawport.GainAdjuster, changed func(map[string]any)) *Service {
	s := &Service{config: config, launcher: launcher, silenceTrimmer: silenceTrimmer, gainAdjuster: gainAdjuster, changed: changed, state: Idle()}
	if launcher != nil {
		launcher.Subscribe(dawport.Subscription{
			Tags:    []string{"CLEANUP_LAUNCHED", "ERROR"},
			Owns:    s.ownsRun,
			Handle:  func(event dawport.Event) { s.Handle(event.Fields) },
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
	if s.launcher == nil {
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
	if err := s.launcher.LaunchCleanupTool(runID, tool.Key, dawport.Trace{RunID: run.ID(), Level: run.Level()}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// PreviewSilenceTrim previews the candidates' silence trims (dawport.SilenceTrimmer.Preview) without changing
// anything: which take markers preview_cleanup_markers would add, and which candidates are stale.
func (s *Service) PreviewSilenceTrim(ctx context.Context, candidates []dawport.CleanupCandidate) (dawport.PreviewResult, error) {
	if s.silenceTrimmer == nil {
		return dawport.PreviewResult{}, fmt.Errorf("the REAPER bridge is unavailable")
	}
	return s.silenceTrimmer.Preview(ctx, candidates)
}

// ApplySilenceTrim applies the candidates' silence trims (dawport.SilenceTrimmer.Apply): a split at each end of
// the cut, the middle piece removed, all in one undo block.
func (s *Service) ApplySilenceTrim(ctx context.Context, candidates []dawport.CleanupCandidate) (dawport.ApplyResult, error) {
	if s.silenceTrimmer == nil {
		return dawport.ApplyResult{}, fmt.Errorf("the REAPER bridge is unavailable")
	}
	return s.silenceTrimmer.Apply(ctx, candidates)
}

// ApplyGain applies per-item gain to match levels (dawport.GainAdjuster.Apply).
func (s *Service) ApplyGain(ctx context.Context, candidates []dawport.GainCandidate) (dawport.ApplyGainResult, error) {
	if s.gainAdjuster == nil {
		return dawport.ApplyGainResult{}, fmt.Errorf("the REAPER bridge is unavailable")
	}
	return s.gainAdjuster.Apply(ctx, candidates)
}

// Drain delivers the events REAPER has appended since the last call, to this service and every other consumer.
func (s *Service) Drain() error {
	if s.launcher == nil {
		return nil
	}
	return s.launcher.Dispatch()
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

func (s *Service) handleInvalid(_ dawport.Event, reason error) {
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
