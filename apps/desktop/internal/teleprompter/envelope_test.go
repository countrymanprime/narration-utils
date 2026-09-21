package teleprompter

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
)

type logRecorder struct {
	mu      sync.Mutex
	entries []string
}

func (l *logRecorder) report(kind, message string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, kind+" "+message)
}

func (l *logRecorder) all() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.entries...)
}

func newEnvelopeService(t *testing.T) (*Service, *[]json.RawMessage, *logRecorder) {
	t.Helper()
	var relayed []json.RawMessage
	service := New(Config{}, nil, func(raw json.RawMessage) { relayed = append(relayed, raw) }, nil)
	recorder := &logRecorder{}
	service.SetLog(recorder.report)
	return service, &relayed, recorder
}

func TestAnEventWithATypeIsRelayedUnchanged(t *testing.T) {
	service, relayed, log := newEnvelopeService(t)
	line := `{"type":"position","read":1,"committed":0,"status":"listening","jump":null,"skipped":null}`
	service.onLine(line)
	if len(*relayed) != 1 || string((*relayed)[0]) != line {
		t.Fatalf("relayed = %v", *relayed)
	}
	if len(log.all()) != 0 {
		t.Fatalf("a good event was logged: %v", log.all())
	}
}

func TestALineThatIsNotAnEventEnvelopeIsDroppedCountedAndLogged(t *testing.T) {
	service, relayed, log := newEnvelopeService(t)
	for _, line := range []string{`42`, `"a string"`, `null`, `[1,2]`, `{}`, `{"type":7}`, `{"type":""}`, `{"kind":"position"}`} {
		service.onLine(line)
	}
	if len(*relayed) != 0 {
		t.Fatalf("relayed %v, want nothing", *relayed)
	}
	if got := service.Dropped(); got != 8 {
		t.Fatalf("Dropped() = %d, want 8", got)
	}
	entries := log.all()
	if len(entries) != 3 || !strings.HasPrefix(entries[0], "sidecar_line_dropped ") {
		t.Fatalf("log = %v, want the first three drops only", entries)
	}
	if !strings.Contains(entries[0], "1") {
		t.Fatalf("the entry does not carry the count: %q", entries[0])
	}
}

func TestADroppedLineNeverPutsItsContentInTheLog(t *testing.T) {
	service, _, log := newEnvelopeService(t)
	service.onLine(`{"type":7,"words":"CHAPTER ONE TEXT"}`)
	if entry := log.all()[0]; strings.Contains(entry, "CHAPTER") {
		t.Fatalf("the log carries content: %q", entry)
	}
}

func TestDropLoggingIsThrottledForAStreamThatIsWrongThroughout(t *testing.T) {
	service, _, log := newEnvelopeService(t)
	for i := 0; i < 250; i++ {
		service.onLine(fmt.Sprint(i))
	}
	// The first three, then the 100th and the 200th.
	if got := len(log.all()); got != 5 {
		t.Fatalf("log entries = %d, want 5", got)
	}
}

func TestStrayTextIsStillDroppedSilently(t *testing.T) {
	service, relayed, log := newEnvelopeService(t)
	service.onLine("loading the model...")
	if len(*relayed) != 0 || len(log.all()) != 0 || service.Dropped() != 0 {
		t.Fatal("a library print is stray output, not a broken event: it is neither logged nor counted")
	}
}

func TestAServiceWithoutALogStillDrops(t *testing.T) {
	service := New(Config{}, nil, nil, nil)
	service.onLine(`42`)
	if service.Dropped() != 1 {
		t.Fatal("the drop must be counted even with no log to write to")
	}
}
