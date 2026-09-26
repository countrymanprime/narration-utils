package main

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

const resumeWatchTestInterval = 5 * time.Millisecond

// concurrentFakeTrackStates is fakeTrackStates (readaloudreaper_test.go) made safe for a state the test flips while
// the poll goroutine is reading it.
type concurrentFakeTrackStates struct {
	mu    sync.Mutex
	state bridge.TrackState
	err   error
	asked atomic.Int32
}

func (f *concurrentFakeTrackStates) ChapterTrackState(_ context.Context, guid string) (bridge.TrackState, error) {
	f.asked.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	state := f.state
	state.TrackGUID = guid
	return state, f.err
}

func (f *concurrentFakeTrackStates) setPlaying() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.state.Playing = true
}

func waitForCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition never became true")
}

func TestResumeWatchDismissesOncePlayingOrRecordingIsSeen(t *testing.T) {
	reader := &concurrentFakeTrackStates{}
	var dismissed atomic.Int32
	w := &resumeWatch{interval: resumeWatchTestInterval}

	w.start(reader, reaperConnected, "{guid}", func() { dismissed.Add(1) })
	defer w.stop()
	if dismissed.Load() != 0 {
		t.Fatal("dismissed before REAPER ever played or recorded")
	}

	reader.setPlaying()

	waitForCondition(t, func() bool { return dismissed.Load() == 1 })
	time.Sleep(20 * time.Millisecond)
	if dismissed.Load() != 1 {
		t.Fatalf("dismissed %d times, want exactly one (the poll stops itself after the first)", dismissed.Load())
	}
}

func TestResumeWatchToleratesTransientRefusals(t *testing.T) {
	reader := &concurrentFakeTrackStates{err: bridge.ErrNoAnswer}
	var dismissed atomic.Int32
	w := &resumeWatch{interval: resumeWatchTestInterval}

	w.start(reader, reaperConnected, "{guid}", func() { dismissed.Add(1) })
	defer w.stop()

	waitForCondition(t, func() bool { return reader.asked.Load() >= 3 })
	if dismissed.Load() != 0 {
		t.Fatal("a refusal must never be treated as playing or recording")
	}
}

func TestResumeWatchNeverPollsWithoutALiveAnswerToTrust(t *testing.T) {
	for _, c := range []struct {
		name       string
		reader     trackStateReader
		connection string
		trackGUID  string
	}{
		{"no reader", nil, reaperConnected, "{guid}"},
		{"not connected", &fakeTrackStates{}, reaperNotRunning, "{guid}"},
		{"no track", &fakeTrackStates{}, reaperConnected, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			w := &resumeWatch{interval: resumeWatchTestInterval}
			w.start(c.reader, c.connection, c.trackGUID, func() { t.Fatal("must never dismiss") })
			defer w.stop()
			time.Sleep(20 * time.Millisecond)
			if fake, ok := c.reader.(*fakeTrackStates); ok && len(fake.asked) != 0 {
				t.Fatalf("asked = %v, want no live ask", fake.asked)
			}
		})
	}
}

func TestResumeWatchStopCancelsThePoll(t *testing.T) {
	reader := &concurrentFakeTrackStates{}
	w := &resumeWatch{interval: resumeWatchTestInterval}
	w.start(reader, reaperConnected, "{guid}", nil)
	waitForCondition(t, func() bool { return reader.asked.Load() >= 1 })

	w.stop()
	asked := reader.asked.Load()
	time.Sleep(30 * time.Millisecond)
	if reader.asked.Load() != asked {
		t.Fatalf("the poll kept asking after stop: %d then %d", asked, reader.asked.Load())
	}
}

func TestResumeWatchStartReplacesAnyRunningWatch(t *testing.T) {
	first := &concurrentFakeTrackStates{}
	second := &concurrentFakeTrackStates{}
	w := &resumeWatch{interval: resumeWatchTestInterval}

	w.start(first, reaperConnected, "{first}", nil)
	waitForCondition(t, func() bool { return first.asked.Load() >= 1 })
	w.start(second, reaperConnected, "{second}", nil)
	waitForCondition(t, func() bool { return second.asked.Load() >= 1 })
	defer w.stop()

	asked := first.asked.Load()
	time.Sleep(30 * time.Millisecond)
	if first.asked.Load() != asked {
		t.Fatalf("the first watch kept polling after being replaced: %d then %d", asked, first.asked.Load())
	}
}
