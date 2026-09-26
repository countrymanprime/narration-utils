package bridge

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func newCleanupSession(t *testing.T) (*CleanupClient, *Client, string) {
	t.Helper()
	dir := t.TempDir()
	client, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	cleanup := NewCleanupClient(client)
	cleanup.SetTimeout(2 * time.Second)
	return cleanup, client, dir
}

func oneCandidate() []CleanupCandidate {
	return []CleanupCandidate{{ItemGUID: testItem, TakeGUID: testTake, Class: "silence", CutStartSeconds: 12.5, CutEndSeconds: 15.5, FindingID: "f-1"}}
}

func TestPreviewWritesThePayloadAndAnswersAddedAndExisting(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"CLEANUP_PREVIEWED", run(command), "2", "0"}}
	})

	got, err := cleanup.Preview(context.Background(), oneCandidate())
	if err != nil {
		t.Fatal(err)
	}
	if got.Added != 2 || got.Existing != 0 || len(got.Stale) != 0 {
		t.Fatalf("got %+v", got)
	}
	sent := fake.commands()
	if len(sent) != 1 || sent[0][1] != "preview_cleanup_markers" {
		t.Fatalf("sent %v", sent)
	}
	payload, err := os.ReadFile(sent[0][3])
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{testItem, testTake, "silence", "12.500000", "15.500000", "f-1"}, "|") + "\n"
	if string(payload) != want {
		t.Fatalf("payload = %q, want %q", payload, want)
	}
}

func TestApplyAnswersHowManyWereApplied(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"CLEANUP_APPLIED", run(command), "1"}}
	})

	got, err := cleanup.Apply(context.Background(), oneCandidate())
	if err != nil {
		t.Fatal(err)
	}
	if got.Applied != 1 || len(got.Stale) != 0 {
		t.Fatalf("got %+v", got)
	}
}

func TestPreviewCollectsEveryStaleCandidateBeforeItsSummary(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	candidates := []CleanupCandidate{
		{ItemGUID: "{missing}", Class: "silence", CutStartSeconds: 1, CutEndSeconds: 2, FindingID: "f-1"},
		{ItemGUID: testItem, TakeGUID: testTake, Class: "breath", CutStartSeconds: 3, CutEndSeconds: 4, FindingID: "f-2"},
	}
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		id := run(command)
		return [][]string{
			{"CLEANUP_STALE", id, "f-1", "{missing}", "item"},
			{"CLEANUP_PREVIEWED", id, "1", "0"},
		}
	})

	got, err := cleanup.Preview(context.Background(), candidates)
	if err != nil {
		t.Fatal(err)
	}
	if got.Added != 1 || len(got.Stale) != 1 || got.Stale[0] != (StaleCandidate{FindingID: "f-1", GUID: "{missing}", Reason: "item"}) {
		t.Fatalf("got %+v", got)
	}
}

func TestApplyReportsEveryStaleCandidateAcrossABiggerBatch(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	candidates := []CleanupCandidate{
		{ItemGUID: "{a}", Class: "silence", CutStartSeconds: 1, CutEndSeconds: 2, FindingID: "f-1"},
		{ItemGUID: "{b}", TakeGUID: "{missing-take}", Class: "silence", CutStartSeconds: 1, CutEndSeconds: 2, FindingID: "f-2"},
		{ItemGUID: testItem, TakeGUID: testTake, Class: "click", CutStartSeconds: 5, CutEndSeconds: 6, FindingID: "f-3"},
	}
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		id := run(command)
		return [][]string{
			{"CLEANUP_STALE", id, "f-1", "{a}", "item"},
			{"CLEANUP_STALE", id, "f-2", "{missing-take}", "take"},
			{"CLEANUP_APPLIED", id, "1"},
		}
	})

	got, err := cleanup.Apply(context.Background(), candidates)
	if err != nil {
		t.Fatal(err)
	}
	if got.Applied != 1 || len(got.Stale) != 2 {
		t.Fatalf("got %+v", got)
	}
}

func TestPreviewAndApplyRefuseAnEmptyBatchAndSendNothing(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string { return nil })
	if _, err := cleanup.Preview(context.Background(), nil); err == nil {
		t.Fatal("want an error for an empty batch")
	}
	if _, err := cleanup.Apply(context.Background(), nil); err == nil {
		t.Fatal("want an error for an empty batch")
	}
	if len(fake.commands()) != 0 {
		t.Fatalf("nothing should be sent for an empty batch, sent %v", fake.commands())
	}
}

func TestPreviewNeedsAnItemAndAFindingID(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string { return nil })
	bad := []CleanupCandidate{{TakeGUID: testTake, CutStartSeconds: 1, CutEndSeconds: 2, FindingID: "f-1"}}
	if _, err := cleanup.Preview(context.Background(), bad); err == nil {
		t.Fatal("want an error for a candidate with no item GUID")
	}
	if len(fake.commands()) != 0 {
		t.Fatalf("a bad candidate must never reach REAPER, sent %v", fake.commands())
	}
}

func TestPreviewNeedsAUsableCutRange(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string { return nil })
	backwards := []CleanupCandidate{{ItemGUID: testItem, CutStartSeconds: 5, CutEndSeconds: 5, FindingID: "f-1"}}
	if _, err := cleanup.Preview(context.Background(), backwards); err == nil {
		t.Fatal("want an error for a cut range that is not positive")
	}
	if len(fake.commands()) != 0 {
		t.Fatalf("sent %v", fake.commands())
	}
}

func TestApplyWithNoClientIsUnavailable(t *testing.T) {
	cleanup := NewCleanupClient(nil)
	if _, err := cleanup.Apply(context.Background(), oneCandidate()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v, want ErrUnavailable", err)
	}
}

func TestPreviewTranslatesAWholeSessionErrorForEveryRequestInFlight(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		// An empty run ID: a session-level problem, not this run's own answer.
		return [][]string{{"ERROR", "", "Unsupported workspace command"}}
	})
	if _, err := cleanup.Preview(context.Background(), oneCandidate()); !errors.Is(err, ErrScriptOutdated) {
		t.Fatalf("got %v, want ErrScriptOutdated", err)
	}
}

func TestApplyFailsTheRequestWhenItsOwnAnswerIsMalformed(t *testing.T) {
	cleanup, client, dir := newCleanupSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		// CLEANUP_APPLIED requires a run and a count; this run's own answer is missing the count.
		return [][]string{{"CLEANUP_APPLIED", run(command)}}
	})
	_, err := cleanup.Apply(context.Background(), oneCandidate())
	if err == nil || !strings.Contains(err.Error(), "could not read") {
		t.Fatalf("got %v, want a could-not-read error", err)
	}
}
