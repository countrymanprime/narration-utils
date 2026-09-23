package takereview

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// fakeBridgeClient is bridgeClient without a real REAPER session directory or event log: Send hands the run id and
// payload path it was given to respond, which decides what events (if any) Dispatch later delivers - the same
// two-step shape a real bridge.Client's file-based command-then-poll round trip has.
type fakeBridgeClient struct {
	sendErr    error
	respond    func(runID, payloadPath string) []bridge.Event
	subs       []bridge.Subscription
	pending    []bridge.Event
	sends      int
	lastRunID  string
	lastPath   string
	dispatched int
}

func (f *fakeBridgeClient) Send(action string, fields []string) (string, error) {
	f.sends++
	if f.sendErr != nil {
		return "", f.sendErr
	}
	if len(fields) >= 2 {
		f.lastRunID, f.lastPath = fields[0], fields[1]
	}
	if f.respond != nil && len(fields) >= 2 {
		f.pending = append(f.pending, f.respond(fields[0], fields[1])...)
	}
	return "", nil
}

func (f *fakeBridgeClient) Subscribe(sub bridge.Subscription) func() {
	f.subs = append(f.subs, sub)
	index := len(f.subs) - 1
	return func() { f.subs[index] = bridge.Subscription{} }
}

func (f *fakeBridgeClient) Dispatch() error {
	f.dispatched++
	events := f.pending
	f.pending = nil
	for _, event := range events {
		for _, sub := range f.subs {
			if sub.Handle == nil {
				continue
			}
			matched := false
			for _, tag := range sub.Tags {
				if tag == event.Tag {
					matched = true
					break
				}
			}
			if matched && (sub.Owns == nil || sub.Owns(event.RunID)) {
				sub.Handle(event)
			}
		}
	}
	return nil
}

func validRequest(t *testing.T, sessionDir string) CreateTakeRequest {
	t.Helper()
	source := filepath.Join(sessionDir, "candidate.wav")
	if err := os.WriteFile(source, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	return CreateTakeRequest{
		FindingID:        "finding-1",
		TargetItemGUID:   "{AAAAAAAA-0000-4000-8000-000000000001}",
		SourceFile:       source,
		SourceRangeStart: 1.5,
		SourceRangeEnd:   4.5,
	}
}

func newEvent(fields ...string) bridge.Event {
	event := bridge.Event{Tag: fields[0], Fields: fields}
	if len(fields) > 1 {
		event.RunID = fields[1]
	}
	return event
}

func TestCreateTakeWithNoBridgeClientReportsReaperIsNotConnected(t *testing.T) {
	_, err := CreateTake(context.Background(), nil, t.TempDir(), CreateTakeRequest{})
	if err == nil || !strings.Contains(err.Error(), "REAPER is not connected") {
		t.Fatalf("err = %v, want a REAPER-not-connected message", err)
	}
}

func TestCreateTakeRequiresATargetItem(t *testing.T) {
	fake := &fakeBridgeClient{}
	_, err := CreateTake(context.Background(), fake, t.TempDir(), CreateTakeRequest{SourceFile: "a.wav"})
	if err == nil || !strings.Contains(err.Error(), "target item") {
		t.Fatalf("err = %v, want a target-item message", err)
	}
	if fake.sends != 0 {
		t.Fatalf("sends = %d, want 0 (nothing sent before validation)", fake.sends)
	}
}

func TestCreateTakeRequiresASourceFile(t *testing.T) {
	fake := &fakeBridgeClient{}
	_, err := CreateTake(context.Background(), fake, t.TempDir(), CreateTakeRequest{TargetItemGUID: "{A}"})
	if err == nil || !strings.Contains(err.Error(), "source file") {
		t.Fatalf("err = %v, want a source-file message", err)
	}
	if fake.sends != 0 {
		t.Fatalf("sends = %d, want 0", fake.sends)
	}
}

func TestCreateTakeSendsOneRowPayloadAndReturnsTheResultFromTakeCreated(t *testing.T) {
	dir := t.TempDir()
	req := validRequest(t, dir)
	req.CandidateItemGUID = "{BBBBBBBB-0000-4000-8000-000000000002}"
	var payloadAtSendTime string
	fake := &fakeBridgeClient{
		respond: func(runID, payloadPath string) []bridge.Event {
			raw, err := os.ReadFile(payloadPath)
			if err != nil {
				t.Fatal(err)
			}
			payloadAtSendTime = string(raw)
			return []bridge.Event{newEvent("TAKE_CREATED", runID, req.TargetItemGUID, "{CCCCCCCC-0000-4000-8000-000000000003}")}
		},
	}

	result, err := CreateTake(context.Background(), fake, dir, req)
	if err != nil {
		t.Fatalf("CreateTake: %v", err)
	}
	if result.TargetItemGUID != req.TargetItemGUID || result.NewTakeGUID != "{CCCCCCCC-0000-4000-8000-000000000003}" {
		t.Fatalf("result = %+v", result)
	}

	wantRow := strings.Join([]string{req.TargetItemGUID, req.CandidateItemGUID, "1.5", "4.5", req.FindingID, req.SourceFile}, "|") + "\n"
	if payloadAtSendTime != wantRow {
		t.Fatalf("payload row = %q, want %q", payloadAtSendTime, wantRow)
	}
	if _, err := os.Stat(fake.lastPath); !os.IsNotExist(err) {
		t.Fatalf("the request payload file should be removed after CreateTake returns, stat err = %v", err)
	}
}

func TestCreateTakeReportsAStaleGUIDByName(t *testing.T) {
	dir := t.TempDir()
	req := validRequest(t, dir)
	fake := &fakeBridgeClient{
		respond: func(runID, _ string) []bridge.Event {
			return []bridge.Event{newEvent("TAKE_STALE", runID, req.TargetItemGUID)}
		},
	}
	_, err := CreateTake(context.Background(), fake, dir, req)
	if err == nil || !strings.Contains(err.Error(), req.TargetItemGUID) {
		t.Fatalf("err = %v, want it to name the stale GUID %s", err, req.TargetItemGUID)
	}
}

func TestCreateTakeReportsTheErrorMessageFromReaper(t *testing.T) {
	dir := t.TempDir()
	req := validRequest(t, dir)
	fake := &fakeBridgeClient{
		respond: func(runID, _ string) []bridge.Event {
			return []bridge.Event{newEvent("ERROR", runID, "This REAPER version cannot add takes.")}
		},
	}
	_, err := CreateTake(context.Background(), fake, dir, req)
	if err == nil || err.Error() != "This REAPER version cannot add takes." {
		t.Fatalf("err = %v", err)
	}
}

func TestCreateTakeTimesOutWhenReaperNeverResponds(t *testing.T) {
	original, originalPoll := createTakeTimeout, createTakePollInterval
	createTakeTimeout, createTakePollInterval = 30*time.Millisecond, 5*time.Millisecond
	defer func() { createTakeTimeout, createTakePollInterval = original, originalPoll }()

	dir := t.TempDir()
	req := validRequest(t, dir)
	fake := &fakeBridgeClient{}
	_, err := CreateTake(context.Background(), fake, dir, req)
	if err == nil || !strings.Contains(err.Error(), "did not respond") {
		t.Fatalf("err = %v, want a timeout message", err)
	}
}

func TestCreateTakeStopsWhenTheContextIsCancelled(t *testing.T) {
	dir := t.TempDir()
	req := validRequest(t, dir)
	fake := &fakeBridgeClient{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := CreateTake(ctx, fake, dir, req)
	if err == nil {
		t.Fatal("expected an error from the cancelled context")
	}
}

func TestCreateTakeNeedsASessionDirectory(t *testing.T) {
	fake := &fakeBridgeClient{}
	_, err := CreateTake(context.Background(), fake, "", CreateTakeRequest{TargetItemGUID: "{A}", SourceFile: "a.wav"})
	if err == nil || !strings.Contains(err.Error(), "session directory") {
		t.Fatalf("err = %v, want a session-directory message", err)
	}
}
