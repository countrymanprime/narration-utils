package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
)

// Unit coverage of resolveWorkspaceTarget over a hand-built coverage.AlignmentView: the shape WorkspaceGoTo and
// WorkspaceLoop resolve tokens against, without needing a running coverage service for every edge case.

func heardToken(index, item int, start, end float64) coverage.TokenLine {
	return coverage.TokenLine{Index: index, Item: &item, Start: &start, End: &end, Status: "read"}
}

func unheardToken(index int) coverage.TokenLine {
	return coverage.TokenLine{Index: index, Status: "skip"}
}

func TestResolveWorkspaceTargetJoinsTheTokensItemAndTakeFromTheAlignedItem(t *testing.T) {
	view := coverage.AlignmentView{
		Tokens: []coverage.TokenLine{heardToken(0, 0, 1, 1.5), heardToken(1, 0, 1.5, 2)},
		Items:  []coverage.AlignmentItem{{Index: 0, ItemGUID: "{ITEM-1}", Live: true, TakeGUID: "{TAKE-1}"}},
	}

	target, err := resolveWorkspaceTarget(view, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if target.ItemGUID != "{ITEM-1}" || target.TakeGUID != "{TAKE-1}" || *target.SourceStart != 1 || *target.SourceEnd != 1.5 {
		t.Fatalf("go to target = %+v", target)
	}

	looped, err := resolveWorkspaceTarget(view, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if *looped.SourceStart != 1 || *looped.SourceEnd != 2 {
		t.Fatalf("loop target = %+v", looped)
	}
}

func TestResolveWorkspaceTargetOfATokenNothingWasHeardForHasNoItemGUID(t *testing.T) {
	view := coverage.AlignmentView{
		Tokens: []coverage.TokenLine{unheardToken(0)},
		Items:  []coverage.AlignmentItem{{Index: 0, ItemGUID: "{ITEM-1}", Live: true}},
	}

	target, err := resolveWorkspaceTarget(view, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if target.ItemGUID != "" {
		t.Fatalf("target = %+v", target)
	}
}

func TestResolveWorkspaceTargetOfAPassageCrossingTwoItemsIsAnError(t *testing.T) {
	view := coverage.AlignmentView{
		Tokens: []coverage.TokenLine{heardToken(0, 0, 1, 1.5), heardToken(1, 1, 2, 2.5)},
		Items: []coverage.AlignmentItem{
			{Index: 0, ItemGUID: "{ITEM-1}", Live: true},
			{Index: 1, ItemGUID: "{ITEM-2}", Live: true},
		},
	}

	if _, err := resolveWorkspaceTarget(view, 0, 1); err == nil || !strings.Contains(err.Error(), "crosses two") {
		t.Fatalf("got %v", err)
	}
}

func TestResolveWorkspaceTargetOfAnOutOfRangeTokenIsAnError(t *testing.T) {
	view := coverage.AlignmentView{Tokens: []coverage.TokenLine{heardToken(0, 0, 1, 1.5)}}

	if _, err := resolveWorkspaceTarget(view, 5, 5); err == nil || !strings.Contains(err.Error(), "not in this chapter's alignment") {
		t.Fatalf("got %v", err)
	}
}

// Binding-level coverage, over a real coverage service and saved project (coverageProject, bindings_coverage_test.go)
// with a fake navigator standing in for REAPER, mirroring bindings_navigation_test.go's pattern for the Review page.

// fakeAlignedCoverageSidecarWithSkip is fakeAlignedCoverageSidecar (bindings_workspace_test.go) plus a second,
// unheard token: coverageProject's one item, one paragraph, and two tokens ("Alice." read, "there." never heard).
func fakeAlignedCoverageSidecarWithSkip() coverage.Launcher {
	return func(_ context.Context, _ string, args ...string) (coverage.Child, error) {
		values := map[string]string{}
		for i := 0; i+1 < len(args); i++ {
			if strings.HasPrefix(args[i], "--") {
				values[args[i]] = args[i+1]
			}
		}
		child := &coverageChild{}
		go func() {
			results := fmt.Sprintf(`COVERAGE|{"schemaVersion":1,"chapterId":%q,"bodyTokens":2,"presentTokens":1,"missingTokens":1,"extraTokens":0,"longestMissingRun":1,"alignment":{"maxMisreadRun":8,"minAnchorRun":3},"items":{"analyzed":1,"muted":0,"playedSeconds":4,"transcribed":1,"reused":0},"analysis":{"model":"small","language":null,"equivalencesHash":null}}`+"\n", values["--chapter-id"])
			results += `COVERAGE_ITEM|{"index":0,"itemGuid":"{ITEM-1}","status":"analyzed","words":"transcribed","playedSeconds":4,"wordCount":1,"model":"small","language":null}` + "\n"
			results += `COVERAGE_PARAGRAPH|{"id":"p-000001","tokens":2,"present":1,"longestMissingRun":1}` + "\n"
			results += `COVERAGE_TOKEN|{"i":0,"p":"p-000001","w":0,"text":"Alice.","status":"read","heard":null,"item":0,"start":1.0,"end":1.5}` + "\n"
			results += `COVERAGE_TOKEN|{"i":1,"p":"p-000001","w":1,"text":"there.","status":"skip","heard":null,"item":null,"start":null,"end":null}` + "\n"
			code := 0
			if err := os.WriteFile(values["--out"], []byte(results), 0o600); err != nil {
				code = 1
			}
			_ = os.WriteFile(values["--progress"], []byte("DONE|100|Finished\n"), 0o600)
			child.mu.Lock()
			child.code = &code
			child.mu.Unlock()
		}()
		return child, nil
	}
}

// workspaceNavigationHost is a coverage-backed host (one chapter, one item "{ITEM-1}" live in the saved project, two
// stored tokens) with fake REAPER attached, as newNavigationHost (bindings_navigation_test.go) builds one for
// findings.
func workspaceNavigationHost(t *testing.T, fake *fakeNavigator) *Host {
	t.Helper()
	host := coverageHost(t, coverageProject(t), true, fakeAlignedCoverageSidecarWithSkip())
	if _, err := host.CoverageStart("c-0001"); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()
	// coverageHost attaches a real project, whose background chapter-sync watcher reads host.services() (h.mu.RLock)
	// as soon as it is attached: swapping navigation/reachability must go under h.mu.Lock too, unlike
	// newNavigationHost (bindings_navigation_test.go), whose bare *Host{...} has no such goroutine racing it yet.
	host.mu.Lock()
	host.navigation = &findingNavigation{navigator: fake}
	host.reachability = liveReachability()
	host.mu.Unlock()
	return host
}

func TestWorkspaceGoToSendsTheTokensItemTakeAndSourceTimeAndAnswersWhereREAPERWent(t *testing.T) {
	fake := &fakeNavigator{navigate: bridge.Navigated{ItemGUID: "{ITEM-1}", ProjectTime: 5.5}}
	host := workspaceNavigationHost(t, fake)

	got := bindingAnswer[FindingNavigation](t)(host.WorkspaceGoTo("c-0001", 0))

	if got.Outcome != "navigated" || got.ProjectTime == nil || *got.ProjectTime != 5.5 {
		t.Fatalf("got %+v", got)
	}
	target := fake.targets[0]
	if target.ItemGUID != "{ITEM-1}" || *target.SourceStart != 1 || *target.SourceEnd != 1.5 {
		t.Fatalf("sent %+v", target)
	}
}

func TestWorkspaceLoopAnswersTheWindowAndStopLoopStopsIt(t *testing.T) {
	fake := &fakeNavigator{loop: bridge.LoopStarted{ItemGUID: "{ITEM-1}", Start: 0, End: 1.5}, stop: bridge.LoopStopped{Restored: 1, Kept: 0}}
	host := workspaceNavigationHost(t, fake)

	looping := bindingAnswer[FindingNavigation](t)(host.WorkspaceLoop("c-0001", 0, 0))
	if looping.Outcome != "looping" || *looping.LoopStart != 0 || *looping.LoopEnd != 1.5 {
		t.Fatalf("loop: %+v", looping)
	}
	if status := bindingAnswer[ReaperStatus](t)(host.FindingsReaperStatus()); status.LoopingFindingID != "workspace:c-0001:0-0" {
		t.Fatalf("status while looping: %+v", status)
	}

	stopped := bindingAnswer[FindingNavigation](t)(host.FindingsStopLoop())
	if stopped.Outcome != "stopped" || *stopped.Restored != 1 {
		t.Fatalf("stop: %+v", stopped)
	}
}

func TestWorkspaceGoToAndLoopOfAnUnheardTokenAreRefusedAndNothingIsSent(t *testing.T) {
	fake := &fakeNavigator{}
	host := workspaceNavigationHost(t, fake)

	for _, check := range []struct {
		name string
		call func() (string, error)
	}{
		{"go to", func() (string, error) { return host.WorkspaceGoTo("c-0001", 1) }},
		{"loop", func() (string, error) { return host.WorkspaceLoop("c-0001", 1, 1) }},
	} {
		got := bindingAnswer[FindingNavigation](t)(check.call())
		if got.Outcome != "refused" || got.Reason != "no_item" || got.Message == "" {
			t.Fatalf("%s: got %+v", check.name, got)
		}
	}
	if sent := fake.sent(); len(sent) != 0 {
		t.Fatalf("sent %v for a token nothing was heard for", sent)
	}
}

// With no REAPER listening the request is refused before it is written, exactly as bindings_navigation_test.go's
// TestWithoutAListeningREAPERNothingIsSentAndTheRefusalSaysWhy proves for a finding.
func TestWorkspaceWithoutAListeningREAPERNothingIsSentAndTheRefusalSaysWhy(t *testing.T) {
	fake := &fakeNavigator{}
	host := workspaceNavigationHost(t, fake)
	host.mu.Lock()
	host.navigation = &findingNavigation{navigator: fake, standalone: true}
	host.reachability = nil
	host.mu.Unlock()

	got := bindingAnswer[FindingNavigation](t)(host.WorkspaceGoTo("c-0001", 0))
	if got.Outcome != "refused" || got.Reason != "standalone" {
		t.Fatalf("got %+v", got)
	}
}

func TestWorkspaceGoToOfAnUnknownChapterIsAnError(t *testing.T) {
	host := workspaceNavigationHost(t, &fakeNavigator{})

	if _, err := host.WorkspaceGoTo("no-such-chapter", 0); err == nil {
		t.Fatal("want an error for a chapter with no stored alignment")
	}
}

func TestWorkspaceGoToWithNoProjectIsAnError(t *testing.T) {
	if _, err := (&Host{}).WorkspaceGoTo("c-0001", 0); !errors.Is(err, errNoProject) {
		t.Fatalf("got %v", err)
	}
}
