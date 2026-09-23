package main

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
)

const (
	readItemA = "{11111111-0000-4000-8000-000000000001}"
	readTakeA = "{22222222-0000-4000-8000-000000000001}"
	readItemB = "{11111111-0000-4000-8000-000000000002}"
	readTakeB = "{22222222-0000-4000-8000-000000000002}"
)

// newReadsHost is a navigation host whose store also holds one take-review group the way internal/repeats writes it:
// read 0 and read 1 each with their own item, take and range inside their own source, and read 2 with no item GUID
// (a read the project model could not identify).
func newReadsHost(t *testing.T, fake *fakeNavigator) (*Host, string) {
	t.Helper()
	host := newNavigationHost(t, fake)
	group := repeats.Group{FirstUnit: 3, LastUnit: 7, Members: []repeats.Member{
		{ItemIndex: 0, ItemGUID: readItemA, TakeGUID: readTakeA, SourceFile: "a.wav", StartOffset: 0, Length: 4.5, Coverage: 1, Quality: 0.62},
		{ItemIndex: 1, ItemGUID: readItemB, TakeGUID: readTakeB, SourceFile: "b.wav", StartOffset: 10, Length: 3.1, Coverage: 0.7, Quality: 0.58},
		{ItemIndex: 2, SourceFile: "c.wav", StartOffset: 0, Length: 2, Coverage: 1, Quality: 0.5},
	}}
	fresh := repeats.ToFindings([]repeats.Group{group}, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "chapter-1"}, repeats.DefaultThresholds())
	saved, err := host.findings.SaveAnalyzerFindings(repeats.AnalyzerName, "chapter-1", fresh)
	if err != nil {
		t.Fatal(err)
	}
	return host, saved[0].ID
}

func TestGoToReadSendsThatReadsOwnItemTakeAndSourceRange(t *testing.T) {
	fake := &fakeNavigator{navigate: bridge.Navigated{ItemGUID: readItemB, ProjectTime: 40}}
	host, id := newReadsHost(t, fake)

	got := bindingAnswer[FindingNavigation](t)(host.FindingsGoToRead(id, 1))

	if got.Outcome != "navigated" || *got.ProjectTime != 40 {
		t.Fatalf("got %+v", got)
	}
	target := fake.targets[0]
	if target.ItemGUID != readItemB || target.TakeGUID != readTakeB || *target.SourceStart != 10 || *target.SourceEnd != 13.1 {
		t.Fatalf("sent %+v, want read 1's item, take and 10 to 13.1 s of its source", target)
	}
}

func TestLoopReadLoopsThatReadAndTheStatusNamesTheFinding(t *testing.T) {
	fake := &fakeNavigator{loop: bridge.LoopStarted{ItemGUID: readItemA, Start: 0, End: 6.5}}
	host, id := newReadsHost(t, fake)

	got := bindingAnswer[FindingNavigation](t)(host.FindingsLoopRead(id, 0))

	if got.Outcome != "looping" || *got.LoopEnd != 6.5 {
		t.Fatalf("got %+v", got)
	}
	if target := fake.targets[0]; target.ItemGUID != readItemA || *target.SourceStart != 0 || *target.SourceEnd != 4.5 {
		t.Fatalf("sent %+v, want read 0's own range", target)
	}
	if status := bindingAnswer[ReaperStatus](t)(host.FindingsReaperStatus()); status.LoopingFindingID != id {
		t.Fatalf("status %+v, want the looping finding named", status)
	}
}

func TestAReadWithoutAnItemIsRefusedAndNothingIsSent(t *testing.T) {
	fake := &fakeNavigator{}
	host, id := newReadsHost(t, fake)

	for name, payload := range map[string]func() (string, error){
		"go to": func() (string, error) { return host.FindingsGoToRead(id, 2) },
		"loop":  func() (string, error) { return host.FindingsLoopRead(id, 2) },
	} {
		got := bindingAnswer[FindingNavigation](t)(payload())
		if got.Outcome != "refused" || got.Reason != refusedNoItem {
			t.Errorf("%s: got %+v, want the no-item refusal", name, got)
		}
	}
	if sent := fake.sent(); len(sent) != 0 {
		t.Fatalf("sent %v, want nothing", sent)
	}
}

func TestAReadTheFindingDoesNotHaveIsAnError(t *testing.T) {
	fake := &fakeNavigator{}
	host, id := newReadsHost(t, fake)

	for _, read := range []int{-1, 3} {
		if _, err := host.FindingsGoToRead(id, read); err == nil || !strings.Contains(err.Error(), "no read") {
			t.Errorf("read %d: err = %v, want a no-such-read error", read, err)
		}
	}
	// A finding with no reads at all (a transcript difference) has none to go to either.
	if _, err := host.FindingsLoopRead("with-item", 0); err == nil || !strings.Contains(err.Error(), "no read") {
		t.Fatalf("err = %v, want a no-such-read error for a finding without reads", err)
	}
	if sent := fake.sent(); len(sent) != 0 {
		t.Fatalf("sent %v, want nothing", sent)
	}
}

func TestGoToReadWithoutAListeningREAPERIsRefused(t *testing.T) {
	fake := &fakeNavigator{}
	host, id := newReadsHost(t, fake)
	host.navigation.standalone = true

	got := bindingAnswer[FindingNavigation](t)(host.FindingsGoToRead(id, 0))

	if got.Outcome != "refused" || got.Reason != reaperStandalone {
		t.Fatalf("got %+v, want the standalone refusal", got)
	}
	if sent := fake.sent(); len(sent) != 0 {
		t.Fatalf("sent %v, want nothing", sent)
	}
}
