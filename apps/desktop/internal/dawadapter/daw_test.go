package dawadapter

import (
	"errors"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// --daw is a free-form launch label (the REAPER launcher passes "REAPER", ProjectSwitch sets "Standalone"); only the two DAWs
// the suite knows change what the host does, and neither the launcher's casing nor stray spaces may decide which.
func TestClassifyKnowsReaperAndAudacityAndNothingElse(t *testing.T) {
	cases := map[string]Kind{
		"REAPER": KindREAPER, "reaper": KindREAPER, " Reaper ": KindREAPER,
		"Audacity": KindAudacity, "audacity": KindAudacity, "AUDACITY": KindAudacity,
		"": KindNone, "Standalone": KindNone, "Pro Tools": KindNone, "Audacity2": KindNone,
	}
	for label, want := range cases {
		if got := Classify(label); got != want {
			t.Errorf("Classify(%q) = %v, want %v", label, got, want)
		}
	}
}

// Until the Audacity pipe client exists (audacity-integration PRD Phase 4, gated on spike S-A1), an Audacity launch still gets
// a review adapter, one that refuses every request with a sentence the narrator can read, so the review workflow fails the run
// with that sentence instead of taking the "no DAW" path or writing REAPER bridge commands.
func TestAnAudacityLaunchGetsAnAdapterThatRefusesEveryReviewRequest(t *testing.T) {
	review := ReviewForDAW("Audacity", nil)
	if review == nil {
		t.Fatal("an Audacity launch must get an adapter, not the standalone nil")
	}
	requests := map[string]error{
		"PrepareReview":     review.PrepareReview("run-1"),
		"InspectFindings":   review.InspectFindings("run-1", "findings.json"),
		"NavigateToFinding": review.NavigateToFinding("run-1", "row-1"),
		"ExportFindings":    review.ExportFindings("run-1", "findings.json", MarkerColors{}),
	}
	for name, err := range requests {
		if !errors.Is(err, ErrAudacityNotAvailable) {
			t.Errorf("%s error = %v, want ErrAudacityNotAvailable", name, err)
		}
	}
	if !strings.HasPrefix(ErrAudacityNotAvailable.Error(), "Audacity support is not available yet.") {
		t.Errorf("message = %q, want it to open with what the narrator needs to know", ErrAudacityNotAvailable)
	}
	unsubscribe := review.Subscribe(Subscription{Tags: []string{"COMPARE_PREPARED"}, Handle: func(Event) { t.Fatal("no events") }})
	if unsubscribe == nil {
		t.Fatal("Subscribe must return a callable unsubscribe")
	}
	unsubscribe()
	if err := review.Dispatch(); err != nil {
		t.Fatalf("Dispatch() = %v, want nil: there is nothing to deliver", err)
	}
}

// An Audacity launch never speaks REAPER's file protocol, even when a session directory was passed along with it.
func TestAnAudacityLaunchIgnoresAReaperBridgeClient(t *testing.T) {
	client, err := bridge.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, isReaper := ReviewForDAW("audacity", client).(*Reaper); isReaper {
		t.Fatal("an Audacity launch must not review through the REAPER bridge")
	}
}

// Every other label keeps Phase 3's behaviour exactly: the REAPER adapter over the bridge when there is one, nil when not.
func TestEveryOtherLaunchKeepsTheReaperAdapterOrNone(t *testing.T) {
	client, err := bridge.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, label := range []string{"REAPER", "", "Standalone", "something else"} {
		if _, isReaper := ReviewForDAW(label, client).(*Reaper); !isReaper {
			t.Errorf("ReviewForDAW(%q, client) is not the REAPER adapter", label)
		}
		if review := ReviewForDAW(label, nil); review != nil {
			t.Errorf("ReviewForDAW(%q, nil) = %v, want nil", label, review)
		}
	}
}
