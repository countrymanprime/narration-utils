package bridge

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testItem = "{AAAAAAAA-0000-4000-8000-000000000001}"
	testTake = "{AAAAAAAA-0000-4000-8000-0000000000A1}"
)

// fakeReaper plays REAPER's side of the file protocol for the navigator's tests: it reads each command the client
// writes, answers it with the lines answer returns (as navigation_test.lua pins them) and dispatches them, the way the
// host's 150 ms loop would.
type fakeReaper struct {
	mu       sync.Mutex
	received [][]string
}

func startFakeReaper(t *testing.T, client *Client, dir string, answer func(command []string) [][]string) *fakeReaper {
	t.Helper()
	fake := &fakeReaper{}
	done := make(chan struct{})
	stopped := make(chan struct{})
	t.Cleanup(func() {
		close(done)
		<-stopped
	})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(2 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				fake.tick(t, client, dir, answer)
			}
		}
	}()
	return fake
}

func (f *fakeReaper) tick(t *testing.T, client *Client, dir string, answer func([]string) [][]string) {
	names, _ := filepath.Glob(filepath.Join(dir, "commands", "*.cmd"))
	sort.Strings(names)
	for _, name := range names {
		content, err := os.ReadFile(name)
		if err != nil {
			continue
		}
		_ = os.Remove(name)
		fields, err := DecodeFields(string(content))
		if err != nil {
			t.Errorf("the client wrote a command that does not decode: %v", err)
			continue
		}
		f.mu.Lock()
		f.received = append(f.received, fields)
		f.mu.Unlock()
		appendEvents(t, dir, answer(fields)...)
	}
	_ = client.Dispatch()
}

func (f *fakeReaper) commands() [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][]string(nil), f.received...)
}

func appendEvents(t *testing.T, dir string, lines ...[]string) {
	t.Helper()
	file, err := os.OpenFile(filepath.Join(dir, "events.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	for _, line := range lines {
		if _, err := file.WriteString(EncodeFields(line) + "\n"); err != nil {
			t.Fatal(err)
		}
	}
}

func newNavigatorSession(t *testing.T) (*Navigator, *Client, string) {
	t.Helper()
	dir := t.TempDir()
	client, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	navigator := NewNavigator(client)
	navigator.SetTimeout(2 * time.Second)
	return navigator, client, dir
}

func seconds(value float64) *float64 { return &value }

// run is the run ID of a command: its first argument after the protocol version and the name.
func run(command []string) string { return command[2] }

func TestNavigateSendsTheItemTakeAndSourceTimeAndAnswersWhereREAPERWent(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"NAVIGATED", run(command), testItem, "102.500000"}}
	})

	got, err := navigator.Navigate(context.Background(), Target{ItemGUID: testItem, TakeGUID: testTake, SourceStart: seconds(12.5)})
	if err != nil {
		t.Fatal(err)
	}
	if got != (Navigated{ItemGUID: testItem, ProjectTime: 102.5}) {
		t.Fatalf("got %+v", got)
	}
	sent := fake.commands()
	if len(sent) != 1 {
		t.Fatalf("sent %v", sent)
	}
	want := []string{"1", "navigate_item", run(sent[0]), testItem, testTake, "12.500000"}
	if strings.Join(sent[0], "|") != strings.Join(want, "|") {
		t.Fatalf("sent %v, want %v", sent[0], want)
	}
}

func TestNavigateWithoutASourceTimeAsksForTheItemStart(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"NAVIGATED", run(command), testItem, "100.000000"}}
	})
	if _, err := navigator.Navigate(context.Background(), Target{ItemGUID: testItem}); err != nil {
		t.Fatal(err)
	}
	if sent := fake.commands()[0]; sent[4] != "" || sent[5] != "" {
		t.Fatalf("take and time must be empty, sent %v", sent)
	}
}

func TestAFindingWithoutAnItemGUIDIsRefusedAndNothingIsSent(t *testing.T) {
	navigator, _, dir := newNavigatorSession(t)
	_, navErr := navigator.Navigate(context.Background(), Target{SourceStart: seconds(12.5)})
	_, loopErr := navigator.Loop(context.Background(), Target{SourceStart: seconds(12.5)})
	for _, err := range []error{navErr, loopErr} {
		if !errors.Is(err, ErrNoItemIdentity) {
			t.Fatalf("got %v, want ErrNoItemIdentity: a position alone is never used to find a finding", err)
		}
	}
	if names, _ := filepath.Glob(filepath.Join(dir, "commands", "*")); len(names) != 0 {
		t.Fatalf("nothing may be sent for a finding without a GUID, found %v", names)
	}
}

func TestAStaleFindingIsReportedAsStaleWithTheReasonInPlainWords(t *testing.T) {
	cases := []struct{ reason, words string }{
		{"item", "no longer in the REAPER project"},
		{"take", "no longer has the take"},
		{"range", "no longer covers"},
	}
	for _, c := range cases {
		t.Run(c.reason, func(t *testing.T) {
			navigator, client, dir := newNavigatorSession(t)
			startFakeReaper(t, client, dir, func(command []string) [][]string {
				return [][]string{{"FINDING_STALE", run(command), testItem, c.reason}}
			})
			_, err := navigator.Navigate(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(1)})
			var stale *StaleError
			if !errors.As(err, &stale) || stale.Reason != c.reason || stale.GUID != testItem {
				t.Fatalf("got %v, want a StaleError for %s", err, c.reason)
			}
			if !errors.Is(err, ErrStale) || !strings.Contains(err.Error(), c.words) {
				t.Fatalf("%q must be ErrStale and say %q", err, c.words)
			}
		})
	}
}

func TestLoopPadsTheFindingIntoAContextWindowAndNeverBeforeTheSourceStart(t *testing.T) {
	cases := []struct {
		name       string
		target     Target
		start, end string
	}{
		{"a point", Target{ItemGUID: testItem, SourceStart: seconds(12.5)}, "10.500000", "14.500000"},
		{"a range", Target{ItemGUID: testItem, SourceStart: seconds(12.5), SourceEnd: seconds(13)}, "10.500000", "15.000000"},
		{"near the source start", Target{ItemGUID: testItem, SourceStart: seconds(1)}, "0.000000", "3.000000"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			navigator, client, dir := newNavigatorSession(t)
			fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
				return [][]string{{"LOOP_STARTED", run(command), testItem, "101.000000", "105.000000"}}
			})
			got, err := navigator.Loop(context.Background(), c.target)
			if err != nil {
				t.Fatal(err)
			}
			if got != (LoopStarted{ItemGUID: testItem, Start: 101, End: 105}) {
				t.Fatalf("got %+v", got)
			}
			sent := fake.commands()[0]
			if sent[1] != "loop_context" || sent[5] != c.start || sent[6] != c.end {
				t.Fatalf("sent %v, want window %s..%s", sent, c.start, c.end)
			}
		})
	}
}

func TestLoopNeedsASourceTime(t *testing.T) {
	navigator, _, _ := newNavigatorSession(t)
	if _, err := navigator.Loop(context.Background(), Target{ItemGUID: testItem}); !errors.Is(err, ErrNoSourceTime) {
		t.Fatalf("got %v", err)
	}
	if _, err := navigator.Loop(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(5), SourceEnd: seconds(4)}); !errors.Is(err, ErrNoSourceTime) {
		t.Fatalf("a range that runs backwards: got %v", err)
	}
}

func TestStopLoopAnswersWhatWasPutBackAndWhatTheNarratorHadChanged(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"LOOP_STOPPED", run(command), "1", "2"}}
	})
	got, err := navigator.StopLoop(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != (LoopStopped{Restored: 1, Kept: 2}) {
		t.Fatalf("got %+v", got)
	}
	if sent := fake.commands()[0]; sent[1] != "stop_loop" || len(sent) != 3 {
		t.Fatalf("sent %v", sent)
	}
}

func TestPingAnswersTheScriptVersionAndTheLoopAndPlayState(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"PONG", run(command), "1", "1", "0"}}
	})
	got, err := navigator.Ping(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != (Pong{Version: "1", Looping: true, Playing: false}) {
		t.Fatalf("got %+v", got)
	}
}

func TestAScriptOlderThanTheNavigationCommandsIsToldApart(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ERROR", run(command), "Unsupported workspace command"}}
	})
	if _, err := navigator.Ping(context.Background()); !errors.Is(err, ErrScriptOutdated) {
		t.Fatalf("got %v, want ErrScriptOutdated", err)
	}
}

func TestAnErrorFromREAPERIsReturnedWithItsMessage(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ERROR", run(command), "REAPER is recording. Stop recording first."}}
	})
	_, err := navigator.Navigate(context.Background(), Target{ItemGUID: testItem})
	if err == nil || !strings.Contains(err.Error(), "REAPER is recording") {
		t.Fatalf("got %v", err)
	}
}

// The two refusals narration_navigation.lua words itself are told apart by their exact message, so the Review page can say
// what to do (review dashboard Phase 7) without reading an error string of its own.
func TestRecordingAndANoTimeRefusalFromREAPERAreToldApart(t *testing.T) {
	for message, want := range map[string]error{
		"REAPER is recording. Stop recording first.": ErrRecording,
		"The finding has no usable time.":            ErrNoSourceTime,
	} {
		navigator, client, dir := newNavigatorSession(t)
		startFakeReaper(t, client, dir, func(command []string) [][]string {
			return [][]string{{"ERROR", run(command), message}}
		})
		if _, err := navigator.Loop(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(1)}); !errors.Is(err, want) {
			t.Fatalf("%q: got %v, want %v", message, err, want)
		}
	}
}

func TestAnAnswerThisAppCannotReadIsAnErrorNotAZeroValue(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"PONG", run(command), "1", "yes", "0"}}
	})
	_, err := navigator.Ping(context.Background())
	if err == nil || !strings.Contains(err.Error(), "could not read") {
		t.Fatalf("got %v", err)
	}
}

func TestNoAnswerInTimeIsErrNoAnswer(t *testing.T) {
	navigator, _, _ := newNavigatorSession(t)
	navigator.SetTimeout(30 * time.Millisecond)
	if _, err := navigator.Ping(context.Background()); !errors.Is(err, ErrNoAnswer) {
		t.Fatalf("got %v", err)
	}
}

func TestACancelledRequestStopsWaiting(t *testing.T) {
	navigator, _, _ := newNavigatorSession(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := navigator.Ping(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}

func TestWithoutABridgeEveryRequestIsErrUnavailable(t *testing.T) {
	navigator := NewNavigator(nil)
	if _, err := navigator.Ping(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v", err)
	}
	if _, err := navigator.Navigate(context.Background(), Target{ItemGUID: testItem}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v", err)
	}
}

func TestASessionLevelErrorFailsTheRequestInFlight(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	startFakeReaper(t, client, dir, func([]string) [][]string {
		return [][]string{{"ERROR", "", "Unsupported hub protocol"}}
	})
	_, err := navigator.Ping(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Unsupported hub protocol") {
		t.Fatalf("got %v", err)
	}
}

func TestConcurrentRequestsEachGetTheirOwnAnswer(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		if command[1] == "ping" {
			return [][]string{{"PONG", run(command), "1", "0", "1"}}
		}
		return [][]string{{"NAVIGATED", run(command), testItem, "7.000000"}}
	})
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for index := 0; index < 10; index++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			if pong, err := navigator.Ping(context.Background()); err != nil || !pong.Playing {
				errs <- errors.Join(err, errors.New("ping got the wrong answer"))
			}
		}()
		go func() {
			defer wg.Done()
			if got, err := navigator.Navigate(context.Background(), Target{ItemGUID: testItem}); err != nil || got.ProjectTime != 7 {
				errs <- errors.Join(err, errors.New("navigate got the wrong answer"))
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestALateAnswerForARequestThatTimedOutIsDroppedAndTheNextRequestStillWorks(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	navigator.SetTimeout(30 * time.Millisecond)
	if _, err := navigator.Ping(context.Background()); !errors.Is(err, ErrNoAnswer) {
		t.Fatalf("got %v", err)
	}
	names, _ := filepath.Glob(filepath.Join(dir, "commands", "*.cmd"))
	content, _ := os.ReadFile(names[0])
	stale, _ := DecodeFields(string(content))
	_ = os.Remove(names[0])
	appendEvents(t, dir, []string{"PONG", run(stale), "1", "0", "0"})
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	navigator.SetTimeout(2 * time.Second)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"PONG", run(command), "1", "1", "1"}}
	})
	if pong, err := navigator.Ping(context.Background()); err != nil || !pong.Looping {
		t.Fatalf("got %+v, %v: the late answer must not be taken for the new request", pong, err)
	}
}

func TestEveryRequestRefusesAnAnswerOfTheWrongKindAndReturnsREAPERsError(t *testing.T) {
	requests := map[string]func(*Navigator) error{
		"navigate_item": func(n *Navigator) error {
			_, err := n.Navigate(context.Background(), Target{ItemGUID: testItem})
			return err
		},
		"loop_context": func(n *Navigator) error {
			_, err := n.Loop(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(3)})
			return err
		},
		"stop_loop": func(n *Navigator) error {
			_, err := n.StopLoop(context.Background())
			return err
		},
		"ping": func(n *Navigator) error {
			_, err := n.Ping(context.Background())
			return err
		},
	}
	for name, request := range requests {
		t.Run(name+" wrong kind", func(t *testing.T) {
			navigator, client, dir := newNavigatorSession(t)
			wrong := "PONG"
			if name == "ping" {
				wrong = "LOOP_STOPPED"
			}
			startFakeReaper(t, client, dir, func(command []string) [][]string {
				if wrong == "PONG" {
					return [][]string{{"PONG", run(command), "1", "0", "0"}}
				}
				return [][]string{{"LOOP_STOPPED", run(command), "0", "0"}}
			})
			if err := request(navigator); err == nil || !strings.Contains(err.Error(), "does not expect") {
				t.Fatalf("got %v", err)
			}
		})
		t.Run(name+" error", func(t *testing.T) {
			navigator, client, dir := newNavigatorSession(t)
			startFakeReaper(t, client, dir, func(command []string) [][]string {
				return [][]string{{"ERROR", run(command), ""}}
			})
			if err := request(navigator); err == nil || err.Error() != "REAPER could not do that" {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestAStaleReasonThisHostDoesNotKnowIsStillStale(t *testing.T) {
	err := error(&StaleError{GUID: testItem, Reason: "something-new"})
	if !errors.Is(err, ErrStale) || err.Error() != ErrStale.Error() {
		t.Fatalf("got %v", err)
	}
}

func TestNavigateRefusesASourceTimeThatIsNotANumber(t *testing.T) {
	navigator, _, _ := newNavigatorSession(t)
	if _, err := navigator.Navigate(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(math.NaN())}); !errors.Is(err, ErrNoSourceTime) {
		t.Fatalf("got %v", err)
	}
}

func TestAFailedSendIsReportedWithTheCommand(t *testing.T) {
	navigator, _, dir := newNavigatorSession(t)
	if err := os.RemoveAll(filepath.Join(dir, "commands")); err != nil {
		t.Fatal(err)
	}
	if _, err := navigator.Ping(context.Background()); err == nil || !strings.Contains(err.Error(), "could not send ping") {
		t.Fatalf("got %v", err)
	}
}

func TestAnUnreadableEventWithNoRunLeavesTheRequestsInFlightAlone(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	navigator.SetTimeout(200 * time.Millisecond)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"FINDING_STALE", ""}, {"PONG", run(command), "1", "0", "0"}}
	})
	if _, err := navigator.Ping(context.Background()); err != nil {
		t.Fatalf("a malformed run-less event must not fail the request: %v", err)
	}
}
