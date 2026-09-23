package teleprompter

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// trackerWait mirrors the tracker's WAIT_SECONDS (script_tracker.py): the auto-stop delay must be longer, so a
// narrator who pauses and then re-reads the last line cancels it before it fires.
const trackerWait = 1500 * time.Millisecond

// fakeClock stands in for time.AfterFunc: it records every timer and fires one only when the test says so, so these
// tests never sleep through a real delay.
type fakeClock struct {
	mu     sync.Mutex
	timers []*fakeTimer
}

type fakeTimer struct {
	delay   time.Duration
	fn      func()
	mu      sync.Mutex
	stopped bool
}

func (t *fakeTimer) Stop() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	wasPending := !t.stopped
	t.stopped = true
	return wasPending
}

func (c *fakeClock) afterFunc(delay time.Duration, fn func()) stoppable {
	timer := &fakeTimer{delay: delay, fn: fn}
	c.mu.Lock()
	c.timers = append(c.timers, timer)
	c.mu.Unlock()
	return timer
}

func (c *fakeClock) all() []*fakeTimer {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]*fakeTimer(nil), c.timers...)
}

func (c *fakeClock) pending() []*fakeTimer {
	var result []*fakeTimer
	for _, timer := range c.all() {
		timer.mu.Lock()
		if !timer.stopped {
			result = append(result, timer)
		}
		timer.mu.Unlock()
	}
	return result
}

// fire runs a timer's callback the way time.AfterFunc would once its delay passed, whether or not it was stopped: a
// real timer can fire at the same instant it is being stopped, and the service must ignore a stale callback.
func (t *fakeTimer) fire() { t.fn() }

func newAutoStopFixture(t *testing.T, mode string) (*fixture, *fakeClock) {
	t.Helper()
	f := newFixture(t, mode)
	clock := &fakeClock{}
	f.service.afterFunc = clock.afterFunc
	return f, clock
}

func message(s *Service) string {
	value, _ := s.Snapshot()["message"].(string)
	return value
}

const (
	donePosition      = `{"type":"position","read":4,"committed":4,"status":"done","jump":null,"skipped":null}`
	doneAgainPosition = `{"type":"position","read":4,"committed":3,"status":"done","jump":null,"skipped":null}`
	rereadPosition    = `{"type":"position","read":2,"committed":2,"status":"listening","jump":"restart","skipped":null}`
)

func startAndWaitForPosition(t *testing.T, f *fixture) {
	t.Helper()
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })
}

func TestTheAutoStopDelayIsLongerThanTheTrackersPauseTimeout(t *testing.T) {
	if autoStopDelay <= trackerWait {
		t.Fatalf("autoStopDelay = %v, want more than the tracker's %v so a re-read of the last line can cancel it", autoStopDelay, trackerWait)
	}
}

func TestADonePositionFromTheSidecarStopsTheSessionAfterTheDelay(t *testing.T) {
	f, clock := newAutoStopFixture(t, "done")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the auto-stop timer", func() bool { return len(clock.pending()) == 1 })

	timer := clock.pending()[0]
	if timer.delay != autoStopDelay {
		t.Fatalf("delay = %v, want %v", timer.delay, autoStopDelay)
	}
	if phase(f.service) != "running" || !strings.Contains(message(f.service), "end of the chapter") {
		t.Fatalf("while the timer is pending the session keeps running and says why: phase=%s message=%q", phase(f.service), message(f.service))
	}

	timer.fire()

	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })
	if got := message(f.service); got != "Stopped at the end of the chapter." {
		t.Fatalf("message = %q", got)
	}
	if f.recorder.firstEvent("segment_end") == nil {
		t.Fatalf("auto-stop must use the cooperative stop so the sidecar flushes, events = %v", f.recorder.eventTypes())
	}
}

func TestAnAutoStoppedSessionKeepsItsScriptAndLastPosition(t *testing.T) {
	f, clock := newAutoStopFixture(t, "done")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the auto-stop timer", func() bool { return len(clock.pending()) == 1 })

	clock.pending()[0].fire()
	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })

	snapshot := f.service.Snapshot()
	script, _ := snapshot["script"].(map[string]any)
	position, _ := snapshot["position"].(map[string]any)
	if script["tokens"] != float64(4) || position["status"] != "done" {
		t.Fatalf("the session's state must survive an auto-stop (flags are persisted from it later), snapshot = %v", snapshot)
	}
}

func TestALaterPositionThatIsNotDoneCancelsThePendingAutoStop(t *testing.T) {
	f, clock := newAutoStopFixture(t, "stream")
	startAndWaitForPosition(t, f)

	f.service.onLine(donePosition)
	if len(clock.pending()) != 1 {
		t.Fatalf("a done position should arm one timer, pending = %d", len(clock.pending()))
	}
	f.service.onLine(rereadPosition)

	if len(clock.pending()) != 0 {
		t.Fatal("a later position that is not done must cancel the timer")
	}
	if got := message(f.service); got != "Listening…" {
		t.Fatalf("message = %q, want Listening… once the narrator reads on", got)
	}
	clock.all()[0].fire() // a callback already on its way when the timer was stopped
	if phase(f.service) != "running" {
		t.Fatalf("a cancelled auto-stop must not stop the session, phase = %s", phase(f.service))
	}
}

func TestRepeatedDonePositionsDoNotRestartTheDelay(t *testing.T) {
	f, clock := newAutoStopFixture(t, "stream")
	startAndWaitForPosition(t, f)

	f.service.onLine(donePosition)
	f.service.onLine(doneAgainPosition)

	if got := len(clock.all()); got != 1 {
		t.Fatalf("timers armed = %d, want 1: the delay runs from the first done position", got)
	}
}

func TestADoneAfterACancelledAutoStopArmsItAgain(t *testing.T) {
	f, clock := newAutoStopFixture(t, "stream")
	startAndWaitForPosition(t, f)

	f.service.onLine(donePosition)
	f.service.onLine(rereadPosition)
	f.service.onLine(donePosition)

	pending := clock.pending()
	if len(pending) != 1 {
		t.Fatalf("pending timers = %d, want 1", len(pending))
	}
	pending[0].fire()
	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })
}

func TestAManualStopWhileTheAutoStopIsPendingIsAPlainStop(t *testing.T) {
	f, clock := newAutoStopFixture(t, "stream")
	startAndWaitForPosition(t, f)
	f.service.onLine(donePosition)

	f.service.Stop()

	if len(clock.pending()) != 0 {
		t.Fatal("Stop must cancel a pending auto-stop")
	}
	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })
	if got := message(f.service); got != "Stopped." {
		t.Fatalf("message = %q", got)
	}
}

func TestASidecarThatCrashesAfterDoneStillReportsAnError(t *testing.T) {
	f, clock := newAutoStopFixture(t, "done-crash")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}

	waitFor(t, "the error phase", func() bool { return phase(f.service) == "error" })

	if got := message(f.service); !strings.Contains(got, "the model file is corrupt") {
		t.Fatalf("message = %q", got)
	}
	if len(clock.pending()) != 0 {
		t.Fatal("a session that ended must not leave an auto-stop pending")
	}
}

func TestAnAutoStopFromAnEarlierSessionDoesNotStopTheNextOne(t *testing.T) {
	f, clock := newAutoStopFixture(t, "stream")
	startAndWaitForPosition(t, f)
	f.service.onLine(donePosition)
	stale := clock.pending()[0]
	f.service.Stop()
	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the running phase", func() bool { return phase(f.service) == "running" })

	stale.fire()

	if phase(f.service) != "running" {
		t.Fatalf("phase = %s: a stale timer must not stop a new session", phase(f.service))
	}
}

func TestADonePositionWithNoSessionRunningArmsNothing(t *testing.T) {
	clock := &fakeClock{}
	service := New(Config{}, nil, nil, nil)
	service.afterFunc = clock.afterFunc

	service.onLine(donePosition)

	if len(clock.all()) != 0 {
		t.Fatal("only a running session can auto-stop")
	}
}
