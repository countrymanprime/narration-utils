package audacity

import (
	"errors"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	abt "github.com/countrymanprime/narration-utils/shell/internal/audacitybridge/audacitybridgetest"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/dawporttest"
)

// closedAdapter is the adapter over a pipe that is not there: Audacity closed, scripting off, or Audacity 4.0.
func closedAdapter(tb testing.TB) *Adapter {
	server := abt.NewServer()
	server.SetDown(true)
	return New(audacitybridge.New(server.Transport(), audacitybridge.Options{Timeout: time.Second}))
}

func TestConformance(t *testing.T) {
	dawporttest.Run(t, func(tb testing.TB) dawport.Adapter { return closedAdapter(tb) })
}

// Exactly what is built is Experimental (ADR 0355): navigate and markers. Everything else is NotYetAvailable with no role, until
// the owner's pass promotes a capability or a later phase builds one.
func TestTheDeclarationIsWhatIsBuilt(t *testing.T) {
	adapter := closedAdapter(t)
	declared := adapter.Declares()
	if len(declared) != len(dawport.Capabilities()) {
		t.Errorf("declares %d capabilities, want every one of the catalog's %d", len(declared), len(dawport.Capabilities()))
	}
	for _, spec := range dawport.Capabilities() {
		c := spec.Capability
		want := dawport.NotYetAvailable
		if c == dawport.CapNavigate || c == dawport.CapMarkers || c == dawport.CapMacroRender {
			want = dawport.Experimental
		}
		if got := declared[c]; got != want {
			t.Errorf("%s is declared %v, want %v", c, got, want)
		}
		if role := adapter.Role(c); (role != nil) != (want == dawport.Experimental) {
			t.Errorf("%s has role %T", c, role)
		}
	}
	for _, d := range []dawport.Adapter{adapter, Declaration()} {
		for c, level := range d.Declares() {
			if level == dawport.Supported {
				t.Errorf("%T declares %s Supported before the owner's pass", d, c)
			}
		}
	}
}

func resolverFor(adapter dawport.Adapter, rt dawport.Runtime, toggle dawport.Toggle) *dawport.Resolver {
	return dawport.NewResolver(dawport.ResolverConfig{
		Adapter: adapter,
		Runtime: func() dawport.Runtime { return rt },
		Toggle:  func(dawport.Capability) dawport.Toggle { return toggle },
	})
}

// What is not built still refuses with ADR 0144's sentence, whatever the runtime and settings say.
func TestWhatIsNotBuiltKeepsADR0144sSentence(t *testing.T) {
	for _, adapter := range []dawport.Adapter{closedAdapter(t), Declaration()} {
		for _, rt := range []dawport.Runtime{{}, {Bridge: true}, {Bridge: true, Reachable: true}} {
			resolver := resolverFor(adapter, rt, dawport.ToggleOn)
			for c, s := range resolver.All() {
				if c == dawport.CapNavigate || c == dawport.CapMarkers || c == dawport.CapMacroRender {
					continue
				}
				if s.Available || s.Reason != dawport.ReasonNotYet || s.Message != string(ErrNotAvailable) {
					t.Errorf("%T %+v: %s = %+v, want not_yet with ADR 0144's sentence", adapter, rt, c, s)
				}
			}
			_, err := dawport.Role[dawport.ReviewSession](resolver, dawport.CapReview)
			if !errors.Is(err, dawport.ErrNotSupported) || err.Error() != string(ErrNotAvailable) {
				t.Errorf("Role(review) = %v, want the not-yet refusal", err)
			}
		}
	}
}

func TestExperimentalCapabilitiesAreOffUntilTurnedOnAndThenNeedAudacity(t *testing.T) {
	cases := []struct {
		name    string
		adapter dawport.Adapter
		rt      dawport.Runtime
		toggle  dawport.Toggle
		reason  dawport.Reason
		message string
	}{
		{"off by default", closedAdapter(t), dawport.Runtime{Bridge: true, Reachable: true}, dawport.ToggleAuto, dawport.ReasonExperimentalOff, ""},
		{"on, Audacity not answering", closedAdapter(t), dawport.Runtime{Bridge: true}, dawport.ToggleOn, dawport.ReasonNotRunning, messageNotReachable},
		{"on, no pipe opened by the host", Declaration(), dawport.Runtime{}, dawport.ToggleOn, dawport.ReasonStandalone, messageNotConnected},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := resolverFor(tc.adapter, tc.rt, tc.toggle).Support(dawport.CapNavigate)
			if s.Available || s.Reason != tc.reason || (tc.message != "" && s.Message != tc.message) {
				t.Errorf("navigate = %+v, want %s %q", s, tc.reason, tc.message)
			}
		})
	}
	s := resolverFor(closedAdapter(t), dawport.Runtime{Bridge: true, Reachable: true}, dawport.ToggleOn).Support(dawport.CapMarkers)
	if !s.Available {
		t.Errorf("markers, turned on with Audacity answering = %+v, want available", s)
	}
}

func TestRuntimeFollowsThePipe(t *testing.T) {
	server := abt.NewServer()
	client := audacitybridge.New(server.Transport(), audacitybridge.Options{Timeout: time.Second})
	adapter := New(client)
	if rt := adapter.Runtime(); !rt.Bridge || rt.Reachable {
		t.Errorf("before any request: %+v", rt)
	}
	if err := client.Ping(t.Context()); err != nil {
		t.Fatal(err)
	}
	if rt := adapter.Runtime(); !rt.Reachable {
		t.Errorf("after a reply: %+v", rt)
	}
	if adapter.Session() == nil || adapter.Kind() != dawport.KindAudacity {
		t.Error("the adapter must expose its session and kind")
	}
}

func TestTheFactoryIsRegisteredForAudacity(t *testing.T) {
	factory, ok := dawport.Lookup(dawport.KindAudacity)
	if !ok {
		t.Fatal("no factory registered for Audacity")
	}
	// An Audacity launch never opens REAPER's session directory, even when one is passed (audacity-integration PRD P5).
	adapter, err := factory(dawport.Env{SessionDir: t.TempDir()})
	if err != nil {
		t.Fatalf("factory: %v", err)
	}
	if adapter.Kind() != dawport.KindAudacity {
		t.Errorf("Kind() = %v, want Audacity", adapter.Kind())
	}
}

// The review workflow's session on an Audacity launch refuses every request with a sentence the narrator can read, so it fails
// the run with that sentence instead of taking the "no DAW" path or writing REAPER bridge commands.
func TestUnavailableReviewRefusesEveryRequest(t *testing.T) {
	review := UnavailableReview()
	if review == nil {
		t.Fatal("an Audacity launch must get a review session, not the standalone nil")
	}
	requests := map[string]error{
		"PrepareReview":     review.PrepareReview("run-1", ""),
		"InspectFindings":   review.InspectFindings("run-1", "findings.json"),
		"NavigateToFinding": review.NavigateToFinding("run-1", "row-1"),
		"ExportFindings":    review.ExportFindings("run-1", "findings.json", dawport.MarkerColors{}),
	}
	for name, err := range requests {
		if !errors.Is(err, ErrNotAvailable) {
			t.Errorf("%s error = %v, want ErrNotAvailable", name, err)
		}
	}
	unsubscribe := review.Subscribe(dawport.Subscription{Tags: []string{"COMPARE_PREPARED"}, Handle: func(dawport.Event) { t.Fatal("no events") }})
	unsubscribe()
	if err := review.Dispatch(); err != nil {
		t.Fatalf("Dispatch() = %v, want nil", err)
	}
}
