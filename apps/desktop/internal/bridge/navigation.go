package bridge

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"sync"
	"time"
)

// Navigator asks REAPER to go to a finding, loop its context and stop the loop, and whether the script is listening
// (integrations/reaper/narration_navigation.lua; review-dashboard PRD Phase 6 and Q6; docs/architecture/
// reaper-navigation.md; ADR 0121). Each request is one command and waits for its one answer.
//
// A request returns only once the answer has been dispatched, and dispatching is the host's job (its 150 ms loop calls
// Client.Dispatch through transcript.Service.Drain): so a request must never be made from a Subscription's Handle,
// which runs inside Dispatch and would wait for itself until the timeout.
type Navigator struct {
	client  *Client
	mu      sync.Mutex // guards everything below
	timeout time.Duration
	pending map[string]chan answer
	next    uint64
}

// DefaultAnswerTimeout is how long a request waits for REAPER: a few of the bridge's defer ticks and the host's
// 150 ms dispatch loop, with room for a busy REAPER.
const DefaultAnswerTimeout = 3 * time.Second

// ContextPaddingSeconds is how much audio a loop plays before and after a finding, in source seconds, so the narrator
// hears the line around the spot and not only the spot. REAPER keeps the window inside the item.
const ContextPaddingSeconds = 2.0

var (
	// ErrUnavailable: there is no bridge (the app was launched on its own, not from REAPER's action).
	ErrUnavailable = errors.New("REAPER is not connected to this app: open the app from the Narration Utils action in REAPER")
	// ErrNoAnswer: the bridge did not answer in time (REAPER closed, the script stopped, or REAPER is busy).
	ErrNoAnswer = errors.New("REAPER did not answer: check that REAPER is open and the Narration Utils action is running")
	// ErrScriptOutdated: the script in REAPER predates the navigation commands.
	ErrScriptOutdated = errors.New("the Narration Utils script in REAPER is older than this app: import it again from this app's REAPER folder")
	// ErrNoItemIdentity: the finding carries no REAPER item GUID, so there is nothing safe to go to. A project time
	// alone is never used: it can point at a neighbouring item once anything moved (findings-contract.md).
	ErrNoItemIdentity = errors.New("this finding has no REAPER item to go to: run the check again to record one")
	// ErrNoSourceTime: the finding has no usable time inside its audio.
	ErrNoSourceTime = errors.New("this finding has no time in its audio to loop")
	// ErrRecording: REAPER is recording, so nothing was moved (narration_navigation.lua refuses rather than interrupt a take).
	ErrRecording = errors.New("REAPER is recording: stop recording first")
	// ErrStale is what every StaleError is: the finding's audio is no longer where it was.
	ErrStale = errors.New("this finding's audio is no longer in the REAPER project as it was")
)

// StaleError reports a finding REAPER could not resolve: GUID is the identity that failed and Reason is what failed
// ("item", "take" or "range"). Nothing was selected, moved or played.
type StaleError struct {
	GUID   string
	Reason string
}

func (e *StaleError) Error() string {
	switch e.Reason {
	case "item":
		return "this finding's item is no longer in the REAPER project"
	case "take":
		return "this finding's item no longer has the take the finding was made from"
	case "range":
		return "this finding's item no longer covers the spot the finding is about (it was trimmed or moved within)"
	}
	return ErrStale.Error()
}

func (e *StaleError) Is(target error) bool { return target == ErrStale }

// Target is where a finding is: its REAPER item (required), take (optional; empty means the active take) and its
// source-relative times (findings.TimeRange's SourceStart and SourceEnd, which follow the item when it moves).
type Target struct {
	ItemGUID    string
	TakeGUID    string
	SourceStart *float64
	SourceEnd   *float64
}

// Navigated is where REAPER put the edit cursor, in project seconds.
type Navigated struct {
	ItemGUID    string
	ProjectTime float64
}

// LoopStarted is the window REAPER loops, in project seconds, after keeping it inside the item.
type LoopStarted struct {
	ItemGUID   string
	Start, End float64
}

// LoopStopped says how many of the time selection, the loop points and repeat were put back, and how many were kept
// because the narrator changed them while the loop played. Both are 0 when no loop was running.
type LoopStopped struct {
	Restored, Kept int
}

// Pong is the script's navigation version and whether a loop it started is held and REAPER is playing.
type Pong struct {
	Version          string
	Looping, Playing bool
}

type answer struct {
	event Event
	err   error
}

// NewNavigator subscribes to the navigation answers on client. With a nil client every request is ErrUnavailable.
func NewNavigator(client *Client) *Navigator {
	n := &Navigator{client: client, timeout: DefaultAnswerTimeout, pending: map[string]chan answer{}}
	if client != nil {
		client.Subscribe(Subscription{
			Tags:    []string{"NAVIGATED", "LOOP_STARTED", "LOOP_STOPPED", "PONG", "FINDING_STALE", "ERROR"},
			Owns:    n.owns,
			Handle:  n.handle,
			Invalid: n.invalid,
		})
	}
	return n
}

// SetTimeout changes how long a request waits for its answer.
func (n *Navigator) SetTimeout(timeout time.Duration) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.timeout = timeout
}

// Navigate selects the finding's item and moves the edit cursor to its source time (or to the item's start when it
// has none). A *StaleError (errors.Is ErrStale) means REAPER changed nothing.
func (n *Navigator) Navigate(ctx context.Context, target Target) (Navigated, error) {
	if target.ItemGUID == "" {
		return Navigated{}, ErrNoItemIdentity
	}
	if target.SourceStart != nil && !finite(*target.SourceStart) {
		return Navigated{}, ErrNoSourceTime
	}
	event, err := n.request(ctx, "navigate_item", target.ItemGUID, target.TakeGUID, optionalSeconds(target.SourceStart))
	if err != nil {
		return Navigated{}, err
	}
	if event.Tag != "NAVIGATED" {
		return Navigated{}, unexpected(event)
	}
	return Navigated{ItemGUID: event.Fields[2], ProjectTime: numberAt(event.Fields, 3)}, nil
}

// Loop sets REAPER's time selection and loop points to the finding's context window (ContextPaddingSeconds either
// side of its source times), turns repeat on and plays it (Q6). The first loop remembers what the narrator had;
// StopLoop puts it back.
func (n *Navigator) Loop(ctx context.Context, target Target) (LoopStarted, error) {
	if target.ItemGUID == "" {
		return LoopStarted{}, ErrNoItemIdentity
	}
	start, end, err := contextWindow(target)
	if err != nil {
		return LoopStarted{}, err
	}
	event, err := n.request(ctx, "loop_context", target.ItemGUID, target.TakeGUID, formatSeconds(start), formatSeconds(end))
	if err != nil {
		return LoopStarted{}, err
	}
	if event.Tag != "LOOP_STARTED" {
		return LoopStarted{}, unexpected(event)
	}
	return LoopStarted{ItemGUID: event.Fields[2], Start: numberAt(event.Fields, 3), End: numberAt(event.Fields, 4)}, nil
}

// StopLoop stops the loop this app started and puts back the time selection, loop points and repeat the narrator had
// before it, keeping any of them the narrator changed meanwhile. With no loop running it changes nothing.
func (n *Navigator) StopLoop(ctx context.Context) (LoopStopped, error) {
	event, err := n.request(ctx, "stop_loop")
	if err != nil {
		return LoopStopped{}, err
	}
	if event.Tag != "LOOP_STOPPED" {
		return LoopStopped{}, unexpected(event)
	}
	return LoopStopped{Restored: int(numberAt(event.Fields, 2)), Kept: int(numberAt(event.Fields, 3))}, nil
}

// Ping asks whether the script is listening and knows the navigation commands (ErrScriptOutdated when it does not).
func (n *Navigator) Ping(ctx context.Context) (Pong, error) {
	event, err := n.request(ctx, "ping")
	if err != nil {
		return Pong{}, err
	}
	if event.Tag != "PONG" {
		return Pong{}, unexpected(event)
	}
	return Pong{Version: event.Fields[2], Looping: event.Fields[3] == "1", Playing: event.Fields[4] == "1"}, nil
}

// contextWindow pads the finding's source range into the window a loop plays; a point finding (no SourceEnd) is a
// range of zero length. The start never goes below the start of the source.
func contextWindow(target Target) (float64, float64, error) {
	if target.SourceStart == nil || !finite(*target.SourceStart) {
		return 0, 0, ErrNoSourceTime
	}
	start, end := *target.SourceStart, *target.SourceStart
	if target.SourceEnd != nil {
		if !finite(*target.SourceEnd) || *target.SourceEnd < start {
			return 0, 0, ErrNoSourceTime
		}
		end = *target.SourceEnd
	}
	return math.Max(start-ContextPaddingSeconds, 0), end + ContextPaddingSeconds, nil
}

func (n *Navigator) request(ctx context.Context, command string, args ...string) (Event, error) {
	if n.client == nil {
		return Event{}, ErrUnavailable
	}
	runID, reply, timeout := n.open()
	defer n.close(runID)
	if _, err := n.client.Send(command, append([]string{runID}, args...)); err != nil {
		return Event{}, fmt.Errorf("could not send %s to REAPER: %w", command, err)
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case got := <-reply:
		return got.event, got.err
	case <-timer.C:
		return Event{}, ErrNoAnswer
	case <-ctx.Done():
		return Event{}, ctx.Err()
	}
}

// open registers a new run and the channel its one answer arrives on.
func (n *Navigator) open() (string, chan answer, time.Duration) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.next++
	runID := fmt.Sprintf("nav%d-%d", time.Now().UnixNano(), n.next)
	reply := make(chan answer, 1)
	n.pending[runID] = reply
	return runID, reply, n.timeout
}

// close forgets a run, so a late answer (after a timeout) is dropped.
func (n *Navigator) close(runID string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	delete(n.pending, runID)
}

func (n *Navigator) owns(runID string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	_, ok := n.pending[runID]
	return ok
}

// settle hands a run its answer, once. An empty run is a session-level problem (an ERROR with no run, such as an
// unsupported protocol) and answers every request in flight.
func (n *Navigator) settle(runID string, got answer) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for id, reply := range n.pending {
		if runID != "" && id != runID {
			continue
		}
		select {
		case reply <- got:
		default: // already answered
		}
	}
}

func (n *Navigator) handle(event Event) {
	switch event.Tag {
	case "ERROR":
		n.settle(event.RunID, answer{err: errorAnswer(event)})
	case "FINDING_STALE":
		n.settle(event.RunID, answer{err: &StaleError{GUID: event.Fields[2], Reason: event.Fields[3]}})
	default:
		if event.RunID != "" {
			n.settle(event.RunID, answer{event: event})
		}
	}
}

func (n *Navigator) invalid(event Event, reason error) {
	if event.RunID == "" {
		return
	}
	n.settle(event.RunID, answer{err: fmt.Errorf("REAPER sent an answer this app could not read (%v): import the Narration Utils script from this app's REAPER folder again", reason)})
}

func errorAnswer(event Event) error {
	message := "REAPER could not do that"
	if len(event.Fields) > 2 && event.Fields[2] != "" {
		message = event.Fields[2]
	}
	// The script's own words for the refusals the host tells apart (narration_navigation.lua); anything else keeps its message.
	switch message {
	case "Unsupported workspace command":
		return ErrScriptOutdated
	case "REAPER is recording. Stop recording first.":
		return ErrRecording
	case "The finding has no usable time.":
		return ErrNoSourceTime
	}
	return errors.New(message)
}

func unexpected(event Event) error {
	return fmt.Errorf("REAPER answered %s, which this request does not expect", event.Tag)
}

func optionalSeconds(value *float64) string {
	if value == nil {
		return ""
	}
	return formatSeconds(*value)
}

// formatSeconds writes a time the way the Lua bridge does (%.6f), so both sides agree on the digits.
func formatSeconds(value float64) string { return strconv.FormatFloat(value, 'f', 6, 64) }

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

// numberAt reads a number field CheckEvent has already accepted as one (wire.go), so a parse error cannot happen here.
func numberAt(fields []string, index int) float64 {
	if index >= len(fields) {
		return 0
	}
	value, _ := strconv.ParseFloat(fields[index], 64)
	return value
}
