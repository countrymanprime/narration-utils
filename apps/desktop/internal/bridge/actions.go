package bridge

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Actions sends the REAPER bridge commands of stack S28 (docs/research/reaper-api-for-planned-commands.md) and waits for
// their answers. Every command it sends is on experimentalCommands until the owner and Claude have run the REAPER
// verification pass for it (docs/operations/reaper-verification-pass.md, owner decision D38), and an experimental
// command is refused before anything is written while the "Experimental REAPER actions" setting is off.
//
// Like Navigator, a request returns once its answer has been dispatched by the host's loop (Client.Dispatch), so a
// request must never be made from a Subscription's Handle.
type Actions struct {
	client  *Client
	enabled func() bool
	mu      sync.Mutex // guards everything below
	// +checklocks:mu
	timeout time.Duration
	// +checklocks:mu
	pending map[string]*actionRun
	// +checklocks:mu
	next uint64
	// recordingRun is the run of the recording record_start started, so its RECORD_ENDED (the narrator stopped it in
	// REAPER) reaches onRecordEnded after the request itself has returned.
	// +checklocks:mu
	recordingRun string
	// +checklocks:mu
	onRecordEnded func(RecordEnded)
}

// The setting that switches the experimental commands on: DAW.experimental_reaper_actions, a bool that defaults off
// (config/defaults.json). The host reads it and passes it to NewActions.
const (
	ExperimentalSettingTool = "DAW"
	ExperimentalSettingKey  = "experimental_reaper_actions"
)

// experimentalCommands are the commands that stay behind the setting until the verification pass has confirmed them in
// a real REAPER. A command leaves this list in the PR that records its pass.
var experimentalCommands = map[string]bool{
	"chapter_track_state": true,
	"arm_only":            true,
	"record_start":        true,
	"record_stop":         true,
}

// actionTags are the events Actions consumes: every answer of every command it sends, and ERROR.
var actionTags = []string{"TRACK_STATE", "TRACK_ITEM", "TRACK_STATE_END", "TRACK_STALE", "ARMED", "RECORD_STARTED", "RECORD_STOPPED", "RECORD_ENDED", "RECORD_NOT_OURS", "ERROR"}

// ErrExperimentalOff: the command is experimental and the setting is off, so nothing was sent to REAPER.
var ErrExperimentalOff = errors.New("this REAPER action is experimental and switched off: turn on Experimental REAPER actions in Settings")

// actionRun collects the events of one request until one of its closing tags (or an ERROR) arrives.
type actionRun struct {
	closing map[string]bool
	events  []Event
	done    chan answerSet
}

type answerSet struct {
	events []Event
	err    error
}

// NewActions subscribes to the answers of the S28 commands on client. enabled reports the setting and is asked on
// every request; nil means off. With a nil client every request is ErrUnavailable.
func NewActions(client *Client, enabled func() bool) *Actions {
	a := &Actions{client: client, enabled: enabled, timeout: DefaultAnswerTimeout, pending: map[string]*actionRun{}}
	if client != nil {
		client.Subscribe(Subscription{Tags: actionTags, Owns: a.owns, Handle: a.handle, Invalid: a.invalid})
	}
	return a
}

// SetTimeout changes how long a request waits for its answer.
func (a *Actions) SetTimeout(timeout time.Duration) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.timeout = timeout
}

// Experimental reports whether command still needs the setting.
func Experimental(command string) bool { return experimentalCommands[command] }

// request sends command with a new run ID and returns every event of that run up to and including the first one whose
// tag is in closing. An ERROR for the run ends it with its message.
func (a *Actions) request(ctx context.Context, command string, closing []string, args ...string) ([]Event, error) {
	if experimentalCommands[command] && (a.enabled == nil || !a.enabled()) {
		return nil, ErrExperimentalOff
	}
	if a.client == nil {
		return nil, ErrUnavailable
	}
	runID, run, timeout := a.open(closing)
	defer a.close(runID)
	if _, err := a.client.Send(command, append([]string{runID}, args...)); err != nil {
		return nil, fmt.Errorf("could not send %s to REAPER: %w", command, err)
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case got := <-run.done:
		return got.events, got.err
	case <-timer.C:
		return nil, ErrNoAnswer
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (a *Actions) open(closing []string) (string, *actionRun, time.Duration) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.next++
	runID := fmt.Sprintf("act%d-%d", time.Now().UnixNano(), a.next)
	run := &actionRun{closing: map[string]bool{}, done: make(chan answerSet, 1)}
	for _, tag := range closing {
		run.closing[tag] = true
	}
	a.pending[runID] = run
	return runID, run, a.timeout
}

func (a *Actions) close(runID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.pending, runID)
}

func (a *Actions) owns(runID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, ok := a.pending[runID]
	return ok || (runID != "" && runID == a.recordingRun)
}

func (a *Actions) handle(event Event) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if event.RunID == "" {
		// A session-level ERROR (an unsupported protocol) answers every request in flight.
		if event.Tag == "ERROR" {
			for _, run := range a.pending {
				finish(run, answerSet{err: actionError(event)})
			}
		}
		return
	}
	if event.Tag == "RECORD_ENDED" && event.RunID == a.recordingRun {
		a.recordingRun = ""
		if a.onRecordEnded != nil {
			ended := RecordEnded{Restored: int(numberAt(event.Fields, 2)), Kept: int(numberAt(event.Fields, 3))}
			// Handle runs inside Dispatch: the callback must be quick and must not make a request.
			go a.onRecordEnded(ended)
		}
		return
	}
	run, ok := a.pending[event.RunID]
	if !ok {
		return
	}
	switch {
	case event.Tag == "ERROR":
		finish(run, answerSet{err: actionError(event)})
	case run.closing[event.Tag]:
		run.events = append(run.events, event)
		finish(run, answerSet{events: run.events})
	default:
		run.events = append(run.events, event)
	}
}

func (a *Actions) invalid(event Event, reason error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if run, ok := a.pending[event.RunID]; ok {
		finish(run, answerSet{err: fmt.Errorf("REAPER sent an answer this app could not read (%v): import the Narration Utils script from this app's REAPER folder again", reason)})
	}
}

// finish hands a run its answer once; a later event for the same run is dropped.
func finish(run *actionRun, got answerSet) {
	select {
	case run.done <- got:
	default:
	}
}

func actionError(event Event) error {
	message := "REAPER could not do that"
	if len(event.Fields) > 2 && event.Fields[2] != "" {
		message = event.Fields[2]
	}
	switch message {
	case "Unsupported workspace command":
		return ErrScriptOutdated
	case "REAPER is recording. Stop recording first.":
		return ErrRecording
	}
	if known, ok := refusals[message]; ok {
		return known
	}
	return errors.New(message)
}

// normalizeGUID writes a GUID the way the Lua bridge compares it: upper case in braces, so the host can match an answer
// against what it asked for.
func normalizeGUID(guid string) string {
	bare := strings.ToUpper(strings.Trim(strings.TrimSpace(guid), "{}"))
	if bare == "" {
		return ""
	}
	return "{" + bare + "}"
}
