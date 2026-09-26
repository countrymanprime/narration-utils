package bridge

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func newLevelMatchSession(t *testing.T) (*LevelMatchClient, *Client, string) {
	t.Helper()
	dir := t.TempDir()
	client, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	levelMatch := NewLevelMatchClient(client)
	levelMatch.SetTimeout(2 * time.Second)
	return levelMatch, client, dir
}

func oneGainCandidate() []GainCandidate {
	return []GainCandidate{{ItemGUID: testItem, DeltaDB: 6.0206, FindingID: "f-1"}}
}

func TestApplyGainWritesThePayloadAndAnswersWhatChanged(t *testing.T) {
	levelMatch, client, dir := newLevelMatchSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		id := run(command)
		return [][]string{
			{"GAIN_ITEM", id, testItem, "1.000000", "2.000000"},
			{"GAIN_APPLIED", id, "1"},
		}
	})

	got, err := levelMatch.Apply(context.Background(), oneGainCandidate())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Changed) != 1 || got.Changed[0] != (GainChange{ItemGUID: testItem, BeforeVolume: 1, AfterVolume: 2}) || len(got.Stale) != 0 {
		t.Fatalf("got %+v", got)
	}
	sent := fake.commands()
	if len(sent) != 1 || sent[0][1] != "apply_item_gain" {
		t.Fatalf("sent %v", sent)
	}
	payload, err := os.ReadFile(sent[0][3])
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{testItem, "6.020600", "f-1"}, "|") + "\n"
	if string(payload) != want {
		t.Fatalf("payload = %q, want %q", payload, want)
	}
}

func TestApplyGainCollectsStaleCandidatesAlongsideWhatChanged(t *testing.T) {
	levelMatch, client, dir := newLevelMatchSession(t)
	candidates := []GainCandidate{
		{ItemGUID: "{missing}", DeltaDB: 3, FindingID: "f-1"},
		{ItemGUID: testItem, DeltaDB: 6.0206, FindingID: "f-2"},
	}
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		id := run(command)
		return [][]string{
			{"GAIN_STALE", id, "f-1", "{missing}", "item"},
			{"GAIN_ITEM", id, testItem, "1.000000", "2.000000"},
			{"GAIN_APPLIED", id, "1"},
		}
	})

	got, err := levelMatch.Apply(context.Background(), candidates)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Changed) != 1 || len(got.Stale) != 1 || got.Stale[0] != (StaleGainCandidate{FindingID: "f-1", GUID: "{missing}", Reason: "item"}) {
		t.Fatalf("got %+v", got)
	}
}

func TestApplyGainRefusesAnEmptyBatchAndSendsNothing(t *testing.T) {
	levelMatch, client, dir := newLevelMatchSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string { return nil })
	if _, err := levelMatch.Apply(context.Background(), nil); err == nil {
		t.Fatal("want an error for an empty batch")
	}
	if len(fake.commands()) != 0 {
		t.Fatalf("nothing should be sent for an empty batch, sent %v", fake.commands())
	}
}

func TestApplyGainNeedsAnItemAndAFindingID(t *testing.T) {
	levelMatch, client, dir := newLevelMatchSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string { return nil })
	bad := []GainCandidate{{DeltaDB: 3, FindingID: "f-1"}}
	if _, err := levelMatch.Apply(context.Background(), bad); err == nil {
		t.Fatal("want an error for a candidate with no item GUID")
	}
	if len(fake.commands()) != 0 {
		t.Fatalf("a bad candidate must never reach REAPER, sent %v", fake.commands())
	}
}

func TestApplyGainWithNoClientIsUnavailable(t *testing.T) {
	levelMatch := NewLevelMatchClient(nil)
	if _, err := levelMatch.Apply(context.Background(), oneGainCandidate()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v, want ErrUnavailable", err)
	}
}

func TestApplyGainTranslatesAWholeSessionError(t *testing.T) {
	levelMatch, client, dir := newLevelMatchSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ERROR", "", "REAPER is recording. Stop recording first."}}
	})
	if _, err := levelMatch.Apply(context.Background(), oneGainCandidate()); !errors.Is(err, ErrRecording) {
		t.Fatalf("got %v, want ErrRecording", err)
	}
}
