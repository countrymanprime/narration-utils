package audacity

import (
	"errors"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/dawporttest"
)

func TestConformance(t *testing.T) {
	dawporttest.Run(t, func(testing.TB) dawport.Adapter { return New() })
}

// Until the Audacity pipe client lands (audacity-integration PRD P4), Audacity can do nothing through this app yet.
func TestEveryCapabilityIsNotYetAvailableWithNoRole(t *testing.T) {
	adapter := New()
	declared := adapter.Declares()
	if len(declared) != len(dawport.Capabilities()) {
		t.Errorf("declares %d capabilities, want every one of the catalog's %d", len(declared), len(dawport.Capabilities()))
	}
	for _, spec := range dawport.Capabilities() {
		if got := declared[spec.Capability]; got != dawport.NotYetAvailable {
			t.Errorf("%s is declared %v, want NotYetAvailable", spec.Capability, got)
		}
		if role := adapter.Role(spec.Capability); role != nil {
			t.Errorf("%s has a role (%T), want nil", spec.Capability, role)
		}
	}
}

// Every refusal is ADR 0144's sentence, whatever the runtime and settings say, so the narrator reads what the review workflow
// already shows on an Audacity launch.
func TestEveryRefusalIsADR0144sSentence(t *testing.T) {
	for _, rt := range []dawport.Runtime{{}, {Bridge: true}, {Bridge: true, Reachable: true}} {
		resolver := dawport.NewResolver(dawport.ResolverConfig{
			Adapter: New(),
			Runtime: func() dawport.Runtime { return rt },
			Toggle:  func(dawport.Capability) dawport.Toggle { return dawport.ToggleOn },
		})
		for c, s := range resolver.All() {
			if s.Available || s.Reason != dawport.ReasonNotYet || s.Message != string(ErrNotAvailable) {
				t.Errorf("%+v: %s = %+v, want not_yet with ADR 0144's sentence", rt, c, s)
			}
		}
		_, err := dawport.Role[dawport.ReviewSession](resolver, dawport.CapReview)
		if !errors.Is(err, dawport.ErrNotSupported) || err.Error() != string(ErrNotAvailable) {
			t.Errorf("Role(review) = %v, want the not-yet refusal", err)
		}
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

// Until the Audacity pipe client exists (audacity-integration PRD Phase 4, gated on spike S-A1), an Audacity launch's review
// workflow still gets a session, one that refuses every request with a sentence the narrator can read, so it fails the run with
// that sentence instead of taking the "no DAW" path or writing REAPER bridge commands.
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
	if unsubscribe == nil {
		t.Fatal("Subscribe must return a callable unsubscribe")
	}
	unsubscribe()
	if err := review.Dispatch(); err != nil {
		t.Fatalf("Dispatch() = %v, want nil: there is nothing to deliver", err)
	}
}
