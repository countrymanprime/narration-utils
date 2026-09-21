package bridge

import (
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// logWriter appends raw text to a session's events.log, the way REAPER's Lua does.
type logWriter struct {
	t    *testing.T
	path string
}

func newSession(t *testing.T) (*Client, logWriter) {
	t.Helper()
	dir := t.TempDir()
	client, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	return client, logWriter{t: t, path: filepath.Join(dir, "events.log")}
}

func (w logWriter) append(text string) {
	w.t.Helper()
	// Error, not Fatal: the concurrent test appends from a goroutine.
	file, err := os.OpenFile(w.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		w.t.Error(err)
		return
	}
	defer func() { _ = file.Close() }()
	if _, err := file.WriteString(text); err != nil {
		w.t.Error(err)
	}
}

// recorder is a consumer that keeps every event it is given.
type recorder struct {
	mu     sync.Mutex
	events []Event
}

func (r *recorder) handle(event Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event)
}

func (r *recorder) tags() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	tags := []string{}
	for _, event := range r.events {
		tags = append(tags, event.Tag)
	}
	return tags
}

func (r *recorder) tagsAndRuns() [][2]string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := [][2]string{}
	for _, event := range r.events {
		out = append(out, [2]string{event.Tag, event.RunID})
	}
	return out
}

func owns(runs ...string) func(string) bool {
	return func(runID string) bool {
		for _, run := range runs {
			if run == runID {
				return true
			}
		}
		return false
	}
}

func TestTwoConsumersEachGetTheirOwnEventsWithInterleavedRuns(t *testing.T) {
	client, log := newSession(t)
	compare, lines := &recorder{}, &recorder{}
	client.Subscribe(Subscription{Tags: []string{"COMPARE_*", "ERROR"}, Owns: owns("c1"), Handle: compare.handle})
	client.Subscribe(Subscription{Tags: []string{"LINES_*", "REGIONS_CREATED", "ERROR"}, Owns: owns("l1", "l2"), Handle: lines.handle})
	log.append("COMPARE_PREPARED|c1|m|n|t|d|3\n" +
		"LINES_STAMPED|l1|2|0|0|0\n" +
		"COMPARE_EXPORT_MARKER|c1|row|exported\n" +
		"LINES_STALE|l2|%7BAAA%7D\n" +
		"REGIONS_CREATED|l1|1|0|0\n" +
		"COMPARE_INSPECTED|c1|1 discrepancy|1|0\n")

	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}

	wantCompare := [][2]string{{"COMPARE_PREPARED", "c1"}, {"COMPARE_EXPORT_MARKER", "c1"}, {"COMPARE_INSPECTED", "c1"}}
	wantLines := [][2]string{{"LINES_STAMPED", "l1"}, {"LINES_STALE", "l2"}, {"REGIONS_CREATED", "l1"}}
	if got := compare.tagsAndRuns(); !reflect.DeepEqual(got, wantCompare) {
		t.Fatalf("compare consumer got %v, want %v", got, wantCompare)
	}
	if got := lines.tagsAndRuns(); !reflect.DeepEqual(got, wantLines) {
		t.Fatalf("line consumer got %v, want %v", got, wantLines)
	}
	if client.Undelivered() != 0 {
		t.Fatalf("undelivered = %d, want 0", client.Undelivered())
	}
}

func TestAConsumerNeverStealsAnotherConsumersEventsAcrossDispatches(t *testing.T) {
	client, log := newSession(t)
	first, second := &recorder{}, &recorder{}
	client.Subscribe(Subscription{Tags: []string{"COMPARE_*"}, Handle: first.handle})
	client.Subscribe(Subscription{Tags: []string{"COMPARE_*"}, Handle: second.handle})
	for round := 0; round < 3; round++ {
		log.append("COMPARE_EXPORT_MARKER|c1|row|exported\n")
		if err := client.Dispatch(); err != nil {
			t.Fatal(err)
		}
	}
	if len(first.events) != 3 || len(second.events) != 3 {
		t.Fatalf("both consumers must see all three events, got %d and %d", len(first.events), len(second.events))
	}
}

func TestErrorsGoToTheRunThatOwnsThemAndUnattributedOnesToEveryone(t *testing.T) {
	client, log := newSession(t)
	compare, lines := &recorder{}, &recorder{}
	client.Subscribe(Subscription{Tags: []string{"ERROR"}, Owns: owns("c1"), Handle: compare.handle})
	client.Subscribe(Subscription{Tags: []string{"ERROR"}, Owns: owns("l1"), Handle: lines.handle})
	log.append("ERROR|l1|The%20manuscript%20line%20list%20was%20not%20found.\n" +
		"ERROR|c1|Transcript%20results%20were%20not%20found.\n" +
		"ERROR||Unsupported%20hub%20protocol\n" +
		"ERROR|nobody|Owned%20by%20no%20one\n")

	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}

	if got, want := compare.tagsAndRuns(), [][2]string{{"ERROR", "c1"}, {"ERROR", ""}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("compare consumer got %v, want %v", got, want)
	}
	if got, want := lines.tagsAndRuns(), [][2]string{{"ERROR", "l1"}, {"ERROR", ""}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("line consumer got %v, want %v", got, want)
	}
	if client.Undelivered() != 1 {
		t.Fatalf("the error for run 'nobody' should be counted undelivered, got %d", client.Undelivered())
	}
}

func TestEventFieldsAreDecodedAndTheRunIDIsTheFirstArgument(t *testing.T) {
	client, log := newSession(t)
	recorded := &recorder{}
	client.Subscribe(Subscription{Tags: []string{"LINES_READ"}, Handle: recorded.handle})
	log.append("LINES_READ|run%7C1|C%3A%5Ctemp%5Cout.txt|4\n")

	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}

	want := Event{Tag: "LINES_READ", RunID: "run|1", Fields: []string{"LINES_READ", "run|1", `C:\temp\out.txt`, "4"}}
	if len(recorded.events) != 1 || !reflect.DeepEqual(recorded.events[0], want) {
		t.Fatalf("event = %#v, want %#v", recorded.events, want)
	}
}

func TestWindowsLineEndingsAndABlankLineAreTolerated(t *testing.T) {
	client, log := newSession(t)
	recorded := &recorder{}
	client.Subscribe(Subscription{Tags: []string{"*"}, Handle: recorded.handle})
	log.append("LINES_STAMPED|l1|1|0|0|0\r\n\r\nREGIONS_CREATED|l1|1|0|0\r\n")

	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}

	if got, want := recorded.tagsAndRuns(), [][2]string{{"LINES_STAMPED", "l1"}, {"REGIONS_CREATED", "l1"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestALineREAPERIsStillWritingWaitsForItsNewline(t *testing.T) {
	client, log := newSession(t)
	recorded := &recorder{}
	client.Subscribe(Subscription{Tags: []string{"*"}, Handle: recorded.handle})
	log.append("LINES_STAMPED|l1|1|0|0|0\nLINES_READ|l1|pa")
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if len(recorded.events) != 1 {
		t.Fatalf("only the whole line may be delivered, got %v", recorded.tagsAndRuns())
	}

	log.append("th|2\n")
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if len(recorded.events) != 2 || recorded.events[1].Fields[2] != "path" {
		t.Fatalf("the finished line must arrive intact, got %#v", recorded.events)
	}
}

func TestMalformedLinesAreCountedAndSkipped(t *testing.T) {
	client, log := newSession(t)
	recorded := &recorder{}
	client.Subscribe(Subscription{Tags: []string{"*"}, Handle: recorded.handle})
	log.append("LINES_STAMPED|l1|1|0|0|0\nBROKEN|%ZZ\nREGIONS_CREATED|l1|1|0|0\n")

	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}

	if len(recorded.events) != 2 || client.Malformed() != 1 {
		t.Fatalf("events = %v, malformed = %d", recorded.tagsAndRuns(), client.Malformed())
	}
}

func TestUnsubscribeStopsDelivery(t *testing.T) {
	client, log := newSession(t)
	recorded := &recorder{}
	unsubscribe := client.Subscribe(Subscription{Tags: []string{"*"}, Handle: recorded.handle})
	log.append("LINES_STAMPED|l1|1|0|0|0\n")
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	unsubscribe()
	log.append("LINES_STAMPED|l1|2|0|0|0\n")
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if len(recorded.events) != 1 || client.Undelivered() != 1 {
		t.Fatalf("events = %d, undelivered = %d", len(recorded.events), client.Undelivered())
	}
}

func TestATagPrefixMatchesOnlyItsFamily(t *testing.T) {
	client, log := newSession(t)
	recorded := &recorder{}
	client.Subscribe(Subscription{Tags: []string{"COMPARE_*"}, Handle: recorded.handle})
	log.append("COMPARE_EXPORTED|c1|1|0\nCOMPARE|c1\nLINES_READ|c1|p|0\n")

	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}

	if got, want := recorded.tagsAndRuns(), [][2]string{{"COMPARE_EXPORTED", "c1"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestDispatchWithoutALogOrAHandlerIsHarmless(t *testing.T) {
	client, log := newSession(t)
	if err := client.Dispatch(); err != nil {
		t.Fatalf("no log yet: %v", err)
	}
	client.Subscribe(Subscription{Tags: []string{"LINES_*"}})
	log.append("LINES_STAMPED|l1|1|0|0|0\n")
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if client.Undelivered() != 1 {
		t.Fatalf("a subscription with no handler receives nothing, got undelivered %d", client.Undelivered())
	}
}
func TestConcurrentDispatchWhileREAPERWritesDeliversEachEventExactlyOnceInOrder(t *testing.T) {
	client, log := newSession(t)
	recorded := &recorder{}
	client.Subscribe(Subscription{Tags: []string{"COMPARE_EXPORT_MARKER"}, Handle: recorded.handle})
	const total = 300

	var writing, dispatching sync.WaitGroup
	writing.Add(1)
	go func() {
		defer writing.Done()
		for index := 0; index < total; index++ {
			log.append("COMPARE_EXPORT_MARKER|c1|row-" + strconv.Itoa(index) + "|exported\n")
		}
	}()
	stop := make(chan struct{})
	for worker := 0; worker < 6; worker++ {
		dispatching.Add(1)
		go func() {
			defer dispatching.Done()
			for {
				select {
				case <-stop:
					return
				default:
					if err := client.Dispatch(); err != nil {
						t.Error(err)
						return
					}
				}
			}
		}()
	}
	writing.Wait()
	close(stop)
	dispatching.Wait()
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}

	if len(recorded.events) != total {
		t.Fatalf("delivered %d events, want %d", len(recorded.events), total)
	}
	for index, event := range recorded.events {
		if want := "row-" + strconv.Itoa(index); event.Fields[2] != want {
			t.Fatalf("event %d = %q, want %q (lost, duplicated or out of order)", index, event.Fields[2], want)
		}
	}
	if client.Malformed() != 0 {
		t.Fatalf("a line was cut in two: %d malformed", client.Malformed())
	}
}

func TestAReplacedShorterLogIsReadFromItsStart(t *testing.T) {
	client, log := newSession(t)
	recorded := &recorder{}
	client.Subscribe(Subscription{Tags: []string{"*"}, Handle: recorded.handle})
	log.append("LINES_STAMPED|l1|1|0|0|0\nLINES_STAMPED|l1|2|0|0|0\nLINES_STAMPED|l1|3|0|0|0\n")
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(log.path, []byte("REGIONS_CREATED|l2|1|0|0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if got, want := recorded.tagsAndRuns()[3], [2]string{"REGIONS_CREATED", "l2"}; got != want {
		t.Fatalf("the replacement log's event = %v, want %v", got, want)
	}
}

func TestAnEventThatFailsItsTableIsReportedToTheOwnerLoggedAndNeverDeliveredAsData(t *testing.T) {
	client, log := newSession(t)
	var delivered, invalid recorder
	var reasons []string
	var logged []string
	client.SetLog(func(kind, message string) { logged = append(logged, kind+" "+message) })
	client.Subscribe(Subscription{
		Tags:   []string{"COMPARE_*"},
		Owns:   func(run string) bool { return run == "r1" },
		Handle: delivered.handle,
		Invalid: func(event Event, reason error) {
			invalid.handle(event)
			reasons = append(reasons, reason.Error())
		},
	})
	var otherOwner recorder
	client.Subscribe(Subscription{Tags: []string{"COMPARE_*"}, Owns: func(run string) bool { return run == "other" }, Invalid: func(event Event, _ error) { otherOwner.handle(event) }})

	// A marker cut after the audio text, then a good one.
	log.append("COMPARE_MARKER|r1|0%4012.5|MISREAD|n|d|SECRET WORDS\n")
	log.append("COMPARE_EXPORTED|r1|2|1\n")
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}

	if got := delivered.tags(); !reflect.DeepEqual(got, []string{"COMPARE_EXPORTED"}) {
		t.Fatalf("delivered %v: the truncated marker must not reach Handle", got)
	}
	if got := invalid.tags(); !reflect.DeepEqual(got, []string{"COMPARE_MARKER"}) {
		t.Fatalf("invalid %v", got)
	}
	if len(otherOwner.events) != 0 {
		t.Fatal("a consumer that does not own the run is not told")
	}
	if len(reasons) != 1 || !strings.Contains(reasons[0], "COMPARE_MARKER") {
		t.Fatalf("reasons = %v", reasons)
	}
	if client.Invalid() != 1 || len(logged) != 1 || !strings.HasPrefix(logged[0], "reaper_event_invalid ") || strings.Contains(logged[0], "SECRET") {
		t.Fatalf("invalid %d, logged %v", client.Invalid(), logged)
	}
}

func TestAnInvalidEventWithNoOneToTellIsStillCountedAndLogged(t *testing.T) {
	client, log := newSession(t)
	var logged []string
	client.SetLog(func(kind, message string) { logged = append(logged, kind) })
	log.append("REGIONS_CREATED|t1|4|0|many\n")
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if client.Invalid() != 1 || len(logged) != 1 {
		t.Fatalf("invalid %d, logged %v", client.Invalid(), logged)
	}
}

func TestInvalidEventLoggingIsThrottled(t *testing.T) {
	client, log := newSession(t)
	var logged int
	client.SetLog(func(string, string) { logged++ })
	for i := 0; i < 250; i++ {
		log.append("REGIONS_CREATED|t1|x|0|0\n")
	}
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	// The first three, then the 100th and the 200th.
	if client.Invalid() != 250 || logged != 5 {
		t.Fatalf("invalid %d, logged %d, want 250 and 5", client.Invalid(), logged)
	}
}
