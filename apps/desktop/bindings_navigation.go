package main

import (
	"context"
	"errors"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// The Review page's REAPER bindings (review-dashboard-and-findings-adoption.prd.md Phase 7): Go to, Loop and Stop on
// a finding, and whether REAPER is there to do them. They drive bridge.Navigator (Phase 6, ADR 0121,
// docs/architecture/reaper-navigation.md), which finds a finding by its item GUID and its time inside the take's
// audio, never by a project time. Each is sent only on the narrator's click (the PRD's boundary: no bridge command
// without an explicit action), and only when REAPER is listening, so a command never waits in the session folder for
// a REAPER that starts later. A refusal is an answer, not an error, so the page can say in plain words what to do.

// reaperNavigator is what these bindings need of bridge.Navigator; a test substitutes a fake.
type reaperNavigator interface {
	Navigate(ctx context.Context, target bridge.Target) (bridge.Navigated, error)
	Loop(ctx context.Context, target bridge.Target) (bridge.LoopStarted, error)
	StopLoop(ctx context.Context) (bridge.LoopStopped, error)
}

// findingNavigation is the project's navigator and what the host remembers of it: which finding a loop this app
// started is on. configureLocked replaces it with the bridge client on every project switch, so a loop started on the
// previous session is forgotten here (REAPER's script still holds it until its own Stop or its exit handler).
type findingNavigation struct {
	navigator reaperNavigator
	// standalone is true when there is no bridge at all: the app was opened on its own, not from REAPER's action.
	standalone bool
	mu         sync.Mutex // guards loopingID
	loopingID  string
}

func newFindingNavigation(client *bridge.Client) *findingNavigation {
	return &findingNavigation{navigator: bridge.NewNavigator(client), standalone: client == nil}
}

func (n *findingNavigation) looping() string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.loopingID
}

func (n *findingNavigation) setLooping(id string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.loopingID = id
}

// The connection states FindingsReaperStatus answers, and the refusal reasons FindingNavigation carries.
const (
	reaperStandalone = "standalone"
	reaperNotRunning = "not_running"
	reaperConnected  = "connected"

	refusedNoItem         = "no_item"
	refusedNoSourceTime   = "no_source_time"
	refusedStale          = "stale"
	refusedRecording      = "recording"
	refusedScriptOutdated = "script_outdated"
	refusedFailed         = "failed"
)

// The refusals in the narrator's words. Each says what happened and what to do; nothing in REAPER changed.
const (
	messageStandalone     = "REAPER is not connected to this app. To go to findings in REAPER, open this app from the Narration Utils action in REAPER."
	messageNotRunning     = "REAPER is not answering. Check that REAPER is open and the Narration Utils action is running, then try again."
	messageNoItem         = "This finding has no REAPER item to go to, because it came from an older check. Run the check again to record one."
	messageNoSourceTime   = "This finding has no time in its audio to loop. Go to it instead."
	messageRecording      = "REAPER is recording, so nothing was moved. Stop recording first."
	messageScriptOutdated = "The Narration Utils script in REAPER is older than this app. Import it again from this app's REAPER folder, then try again."
	messageStaleSuffix    = ", so nothing was moved. Run the check again to find it where it is now."
)

// ReaperStatus is whether the Review page's REAPER controls can work now: "connected" (REAPER's heartbeat is fresh),
// "not_running" (a REAPER launch whose REAPER has gone quiet) or "standalone" (no bridge at all). Message says why
// when it is not connected; LoopingFindingID is the finding a loop this app started is on, while connected.
type ReaperStatus struct {
	Connection       string `json:"connection"`
	Message          string `json:"message,omitempty"`
	LoopingFindingID string `json:"loopingFindingId,omitempty"`
}

// FindingNavigation is what Go to, Loop or Stop did: Outcome "navigated" (ProjectTime is where the edit cursor went),
// "looping" (LoopStart and LoopEnd are the window REAPER plays), "stopped" (Restored and Kept count the time
// selection, loop points and repeat put back or kept because the narrator changed them) or "refused" (Reason and
// Message say why; nothing in REAPER changed). Times are project seconds.
type FindingNavigation struct {
	Outcome     string   `json:"outcome"`
	Reason      string   `json:"reason,omitempty"`
	Message     string   `json:"message,omitempty"`
	ProjectTime *float64 `json:"projectTime,omitempty"`
	LoopStart   *float64 `json:"loopStart,omitempty"`
	LoopEnd     *float64 `json:"loopEnd,omitempty"`
	Restored    *int     `json:"restored,omitempty"`
	Kept        *int     `json:"kept,omitempty"`
}

// FindingsReaperStatus answers whether REAPER is there for Go to and Loop, without sending REAPER anything: it reads
// the heartbeat REAPER's script already broadcasts (daw.Reachability, ADR 0092), so the page can poll it.
func (h *Host) FindingsReaperStatus() (string, error) {
	return encodeBinding(reaperStatus(h.services()), nil)
}

// FindingsGoTo selects the finding's item in REAPER and puts the edit cursor on its spot (its item's start when it has
// no time in its audio).
func (h *Host) FindingsGoTo(id string) (string, error) {
	return h.navigateFinding(id, false, func(navigation *findingNavigation, target bridge.Target) FindingNavigation {
		went, err := navigation.navigator.Navigate(context.Background(), target)
		if err != nil {
			return refusal(err)
		}
		return FindingNavigation{Outcome: "navigated", ProjectTime: &went.ProjectTime}
	})
}

// FindingsLoop loops the finding's context in REAPER: the time selection and loop points around it, repeat on, and
// Play (Q6). The narrator's own selection and repeat come back with FindingsStopLoop.
func (h *Host) FindingsLoop(id string) (string, error) {
	return h.navigateFinding(id, true, func(navigation *findingNavigation, target bridge.Target) FindingNavigation {
		loop, err := navigation.navigator.Loop(context.Background(), target)
		if err != nil {
			return refusal(err)
		}
		navigation.setLooping(id)
		return FindingNavigation{Outcome: "looping", LoopStart: &loop.Start, LoopEnd: &loop.End}
	})
}

// FindingsStopLoop stops the loop and puts back the time selection, loop points and repeat the narrator had, keeping
// any they changed while it played. With no loop of this app's running it changes nothing.
func (h *Host) FindingsStopLoop() (string, error) {
	svc := h.services()
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return encodeBinding(refused(status.Connection, status.Message), nil)
	}
	stopped, err := svc.navigation.navigator.StopLoop(context.Background())
	if err != nil {
		return encodeBinding(refusal(err), nil)
	}
	svc.navigation.setLooping("")
	return encodeBinding(FindingNavigation{Outcome: "stopped", Restored: &stopped.Restored, Kept: &stopped.Kept}, nil)
}

// navigateFinding reads the finding, refuses one that cannot be placed (no item GUID; for a loop, no time in its
// audio) or a REAPER that is not listening, and only then runs send. Nothing is sent for a refusal.
func (h *Host) navigateFinding(id string, needsTime bool, send func(*findingNavigation, bridge.Target) FindingNavigation) (string, error) {
	svc := h.services()
	if svc.findings == nil {
		return "", errNoProject
	}
	finding, err := existingFinding(svc.findings, id)
	if err != nil {
		return "", err
	}
	target := navigationTarget(finding)
	if target.ItemGUID == "" {
		return encodeBinding(refusal(bridge.ErrNoItemIdentity), nil)
	}
	if needsTime && target.SourceStart == nil {
		return encodeBinding(refusal(bridge.ErrNoSourceTime), nil)
	}
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return encodeBinding(refused(status.Connection, status.Message), nil)
	}
	return encodeBinding(send(svc.navigation, target), nil)
}

var errNoProject = errors.New("no project is open")

// navigationTarget is where the finding is: its REAPER item and take, and its time inside the take's audio. Its project
// time is left out on purpose: it can point at a neighbouring item once anything moved (findings-contract.md).
func navigationTarget(finding findings.Finding) bridge.Target {
	target := bridge.Target{ItemGUID: finding.Source.ItemGUID, TakeGUID: finding.Source.TakeGUID}
	if finding.TimeRange != nil {
		target.SourceStart, target.SourceEnd = finding.TimeRange.SourceStart, finding.TimeRange.SourceEnd
	}
	return target
}

func reaperStatus(svc hostServices) ReaperStatus {
	switch {
	case svc.navigation == nil || svc.navigation.standalone:
		return ReaperStatus{Connection: reaperStandalone, Message: messageStandalone}
	case svc.reachability == nil || !svc.reachability.Reachable():
		return ReaperStatus{Connection: reaperNotRunning, Message: messageNotRunning}
	}
	return ReaperStatus{Connection: reaperConnected, LoopingFindingID: svc.navigation.looping()}
}

func refused(reason, message string) FindingNavigation {
	return FindingNavigation{Outcome: "refused", Reason: reason, Message: message}
}

// refusal turns what the navigator answered into the reason and words the page shows.
func refusal(err error) FindingNavigation {
	var stale *bridge.StaleError
	switch {
	case errors.As(err, &stale):
		return refused(refusedStale, capitalized(stale.Error())+messageStaleSuffix)
	case errors.Is(err, bridge.ErrNoItemIdentity):
		return refused(refusedNoItem, messageNoItem)
	case errors.Is(err, bridge.ErrNoSourceTime):
		return refused(refusedNoSourceTime, messageNoSourceTime)
	case errors.Is(err, bridge.ErrRecording):
		return refused(refusedRecording, messageRecording)
	case errors.Is(err, bridge.ErrScriptOutdated):
		return refused(refusedScriptOutdated, messageScriptOutdated)
	case errors.Is(err, bridge.ErrNoAnswer):
		return refused(reaperNotRunning, messageNotRunning)
	case errors.Is(err, bridge.ErrUnavailable):
		return refused(reaperStandalone, messageStandalone)
	}
	return refused(refusedFailed, "REAPER could not do that: "+err.Error()+".")
}

func capitalized(text string) string {
	if text == "" || text[0] < 'a' || text[0] > 'z' {
		return text
	}
	return string(text[0]-'a'+'A') + text[1:]
}
