package teleprompter

import (
	"encoding/json"
	"fmt"
	"time"
)

// autoStopDelay is how long a session keeps listening after the tracker first reports that the narrator reached the
// end of the chapter (a `done` position) before the service stops it. It is longer than the tracker's 1.5 s pause
// timeout (WAIT_SECONDS in script_tracker.py) and leaves room for the recognizer's lag, so a narrator who re-reads the
// last line produces a later non-done position that cancels the stop first (ADR 0106). There is no setting for it yet.
const autoStopDelay = 5 * time.Second

const (
	listeningMessage     = "Listening…"
	stoppedMessage       = "Stopped."
	autoStoppingMessage  = "Reached the end of the chapter. Stopping…"
	autoStoppedMessage   = "Stopped at the end of the chapter."
	positionDoneStatus   = "done"
	positionEventType    = "position"
	autoStopArmedMessage = "Reached the end of the chapter. Stopping in %d seconds unless you keep reading."
)

// stoppable is the part of *time.Timer the auto-stop needs; tests swap in a fake clock through Service.afterFunc.
type stoppable interface{ Stop() bool }

func realAfterFunc(delay time.Duration, fn func()) stoppable { return time.AfterFunc(delay, fn) }

// positionStatus reads the tracker status out of a position event; anything unreadable counts as not done.
func positionStatus(raw json.RawMessage) string {
	var position struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(raw, &position); err != nil {
		return ""
	}
	return position.Status
}

// trackAutoStopLocked arms the auto-stop on the first `done` position of a running session and cancels it on any later
// position that is not `done`. It reports whether the state message changed, so the caller can notify once unlocked.
// Repeated `done` positions keep the timer that is already running: the delay counts from the first one.
func (s *Service) trackAutoStopLocked(done bool) bool {
	if !done {
		if s.autoStop == nil {
			return false
		}
		s.cancelAutoStopLocked()
		s.state["message"] = listeningMessage
		return true
	}
	// The phase, not s.child, says a session is live: the sidecar can print before StartStream has returned the child.
	if phase, _ := s.state["phase"].(string); s.autoStop != nil || s.stopping || (phase != "starting" && phase != "running") {
		return false
	}
	s.autoStopRound++
	round := s.autoStopRound
	s.autoStop = s.afterFunc(autoStopDelay, func() { s.fireAutoStop(round) })
	s.state["message"] = fmt.Sprintf(autoStopArmedMessage, int(autoStopDelay/time.Second))
	return true
}

func (s *Service) cancelAutoStopLocked() {
	if s.autoStop != nil {
		s.autoStop.Stop()
		s.autoStop = nil
	}
}

// fireAutoStop runs when the delay passes. A timer that was cancelled, or that belongs to an earlier session, can
// still fire at the moment it is stopped; round tells the two apart, and such a stale callback does nothing.
func (s *Service) fireAutoStop(round int) {
	s.mu.Lock()
	if s.autoStop == nil || round != s.autoStopRound {
		s.mu.Unlock()
		return
	}
	s.autoStop = nil
	s.mu.Unlock()
	s.stop(autoStoppingMessage, true)
}
