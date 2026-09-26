package dawport

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// stubAdapter declares what a test says and hands back the roles it was given. The conformance suite's fake (dawporttest)
// is the full one; this is only enough to drive the resolver.
type stubAdapter struct {
	kind     Kind
	declares map[Capability]Level
	roles    map[Capability]any
	explain  map[Reason]string
}

func (s stubAdapter) Kind() Kind                            { return s.kind }
func (s stubAdapter) Declares() map[Capability]Level        { return s.declares }
func (s stubAdapter) Role(c Capability) any                 { return s.roles[c] }
func (s stubAdapter) Explain(_ Capability, r Reason) string { return s.explain[r] }

// plainAdapter is a stubAdapter without Explain, so the resolver's own wording is used.
type plainAdapter struct{ stubAdapter }

func (p plainAdapter) Explain() {} // shadows the method with a different signature, so plainAdapter is not an Explainer

type punch struct{}

func (punch) PunchTo(context.Context, float64, float64) (float64, error) { return 0, nil }
func (punch) PlayPosition(context.Context) (PlayPosition, error)         { return PlayPosition{}, nil }

func togglesOf(m map[Capability]Toggle) func(Capability) Toggle {
	return func(c Capability) Toggle { return m[c] }
}

func TestSupportCombinesDeclarationSettingsAndRuntime(t *testing.T) {
	connected := Runtime{Bridge: true, Reachable: true}
	cases := []struct {
		name         string
		level        Level
		toggle       Toggle
		experimental bool
		runtime      Runtime
		available    bool
		reason       Reason
	}{
		{"supported on auto is available", Supported, ToggleAuto, false, connected, true, ""},
		{"supported switched on is available", Supported, ToggleOn, false, connected, true, ""},
		{"supported switched off is turned off", Supported, ToggleOff, false, connected, false, ReasonTurnedOff},
		{"experimental on auto is off while the old switch is off", Experimental, ToggleAuto, false, connected, false, ReasonExperimentalOff},
		{"experimental on auto follows the old switch", Experimental, ToggleAuto, true, connected, true, ""},
		{"experimental switched on needs no old switch", Experimental, ToggleOn, false, connected, true, ""},
		{"experimental switched off beats the old switch", Experimental, ToggleOff, true, connected, false, ReasonTurnedOff},
		{"not yet available ignores a toggle", NotYetAvailable, ToggleOn, true, connected, false, ReasonNotYet},
		{"unsupported ignores a toggle", Unsupported, ToggleOn, true, connected, false, ReasonUnsupported},
		{"a setting refusal comes before runtime, like Actions.allowed", Experimental, ToggleAuto, false, Runtime{}, false, ReasonExperimentalOff},
		{"no bridge is standalone", Supported, ToggleAuto, false, Runtime{}, false, ReasonStandalone},
		{"a quiet DAW is not running", Supported, ToggleAuto, false, Runtime{Bridge: true}, false, ReasonNotRunning},
		{"an unknown toggle value counts as auto", Supported, Toggle("sometimes"), false, connected, true, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := NewResolver(ResolverConfig{
				Adapter:      plainAdapter{stubAdapter{kind: KindREAPER, declares: map[Capability]Level{CapPunch: tc.level}}},
				Runtime:      func() Runtime { return tc.runtime },
				Toggle:       togglesOf(map[Capability]Toggle{CapPunch: tc.toggle}),
				Experimental: func() bool { return tc.experimental },
			})
			got := r.Support(CapPunch)
			if got.Level != tc.level || got.Available != tc.available || got.Reason != tc.reason {
				t.Fatalf("Support(punch) = %+v, want level %v available %v reason %q", got, tc.level, tc.available, tc.reason)
			}
			if tc.available != (got.Message == "") {
				t.Fatalf("Support(punch).Message = %q: an available capability has no message and a refused one always has one", got.Message)
			}
		})
	}
}

func TestSupportRuntimeDependsOnWhatTheCapabilityNeeds(t *testing.T) {
	declares := map[Capability]Level{CapHeartbeat: Supported, CapProjectRead: Supported, CapNavigate: Supported}
	for _, tc := range []struct {
		name    string
		runtime Runtime
		want    map[Capability]Reason // "" means available
	}{
		{"standalone", Runtime{}, map[Capability]Reason{CapHeartbeat: ReasonStandalone, CapProjectRead: "", CapNavigate: ReasonStandalone}},
		{"bridge but quiet", Runtime{Bridge: true}, map[Capability]Reason{CapHeartbeat: "", CapProjectRead: "", CapNavigate: ReasonNotRunning}},
		{"connected", Runtime{Bridge: true, Reachable: true}, map[Capability]Reason{CapHeartbeat: "", CapProjectRead: "", CapNavigate: ""}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := NewResolver(ResolverConfig{
				Adapter: plainAdapter{stubAdapter{kind: KindREAPER, declares: declares}},
				Runtime: func() Runtime { return tc.runtime },
			})
			for c, reason := range tc.want {
				if got := r.Support(c); got.Reason != reason || got.Available != (reason == "") {
					t.Errorf("Support(%s) = %+v, want reason %q", c, got, reason)
				}
			}
		})
	}
}

func TestSupportWithNoAdapterIsStandaloneForEveryCapability(t *testing.T) {
	r := NewResolver(ResolverConfig{})
	all := r.All()
	if len(all) != len(Capabilities()) {
		t.Fatalf("All() has %d entries, want one per capability (%d)", len(all), len(Capabilities()))
	}
	for c, s := range all {
		if s.Available || s.Reason != ReasonStandalone || s.Level != Unsupported || s.Message == "" {
			t.Errorf("Support(%s) with no adapter = %+v, want unavailable, standalone, with a message", c, s)
		}
	}
	if r.Kind() != KindNone {
		t.Fatalf("Kind() with no adapter = %v, want none", r.Kind())
	}
}

func TestSupportOfAnUndeclaredOrUnknownCapabilityIsUnsupported(t *testing.T) {
	r := NewResolver(ResolverConfig{
		Adapter: plainAdapter{stubAdapter{kind: KindAudacity, declares: map[Capability]Level{}}},
		Runtime: func() Runtime { return Runtime{Bridge: true, Reachable: true} },
	})
	for _, c := range []Capability{CapPunch, Capability("time_travel")} {
		got := r.Support(c)
		if got.Available || got.Level != Unsupported || got.Reason != ReasonUnsupported {
			t.Errorf("Support(%s) = %+v, want unsupported", c, got)
		}
		if !strings.Contains(got.Message, "Audacity") {
			t.Errorf("Support(%s).Message = %q, want it to name the DAW", c, got.Message)
		}
	}
}

func TestSupportMessagesUseTheAdaptersWordingWhenItHasOne(t *testing.T) {
	sentence := "Audacity support is not available yet."
	r := NewResolver(ResolverConfig{
		Adapter: stubAdapter{kind: KindAudacity, declares: map[Capability]Level{CapPunch: NotYetAvailable},
			explain: map[Reason]string{ReasonNotYet: sentence}},
		Runtime: func() Runtime { return Runtime{Bridge: true, Reachable: true} },
	})
	if got := r.Support(CapPunch).Message; got != sentence {
		t.Fatalf("Message = %q, want the adapter's %q", got, sentence)
	}
	// A reason the adapter has no wording for falls back to the resolver's.
	r2 := NewResolver(ResolverConfig{
		Adapter: stubAdapter{kind: KindAudacity, declares: map[Capability]Level{CapPunch: Supported}},
		Toggle:  togglesOf(map[Capability]Toggle{CapPunch: ToggleOff}),
	})
	if got := r2.Support(CapPunch).Message; got != messageTurnedOff {
		t.Fatalf("Message = %q, want the resolver's %q", got, messageTurnedOff)
	}
}

func TestSupportReadsItsInputsOnEveryCall(t *testing.T) {
	rt := Runtime{Bridge: true}
	r := NewResolver(ResolverConfig{
		Adapter: plainAdapter{stubAdapter{kind: KindREAPER, declares: map[Capability]Level{CapNavigate: Supported}}},
		Runtime: func() Runtime { return rt },
	})
	if r.Support(CapNavigate).Available {
		t.Fatal("available before the heartbeat")
	}
	rt.Reachable = true
	if !r.Support(CapNavigate).Available {
		t.Fatal("still unavailable after the heartbeat: the resolver must not cache runtime state")
	}
}

func TestRoleReturnsTheAdaptersRoleWhenAvailable(t *testing.T) {
	r := NewResolver(ResolverConfig{
		Adapter: plainAdapter{stubAdapter{kind: KindREAPER,
			declares: map[Capability]Level{CapPunch: Experimental},
			roles:    map[Capability]any{CapPunch: punch{}}}},
		Runtime: func() Runtime { return Runtime{Bridge: true, Reachable: true} },
		Toggle:  togglesOf(map[Capability]Toggle{CapPunch: ToggleOn}),
	})
	p, err := Role[Puncher](r, CapPunch)
	if err != nil || p == nil {
		t.Fatalf("Role[Puncher] = %v, %v; want the role", p, err)
	}
}

func TestRoleRefusesWithNotSupportedError(t *testing.T) {
	r := NewResolver(ResolverConfig{
		Adapter: plainAdapter{stubAdapter{kind: KindREAPER,
			declares: map[Capability]Level{CapPunch: Experimental},
			roles:    map[Capability]any{CapPunch: punch{}}}},
		Runtime: func() Runtime { return Runtime{Bridge: true, Reachable: true} },
	})
	p, err := Role[Puncher](r, CapPunch)
	if p != nil {
		t.Fatalf("Role returned %v with an error", p)
	}
	var ns *NotSupportedError
	if !errors.As(err, &ns) {
		t.Fatalf("err = %v (%T), want *NotSupportedError", err, err)
	}
	if ns.Capability != CapPunch || ns.Support.Reason != ReasonExperimentalOff || ns.Error() != ns.Support.Message {
		t.Fatalf("NotSupportedError = %+v", ns)
	}
	if !errors.Is(err, ErrNotSupported) {
		t.Fatal("errors.Is(err, ErrNotSupported) = false")
	}
	if !errors.Is(err, bridge.ErrExperimentalOff) {
		t.Fatal("an experimental_off refusal must still match bridge.ErrExperimentalOff, which today's consumers check")
	}
}

func TestRoleFailsLoudlyWhenAnAdapterBreaksItsDeclaration(t *testing.T) {
	for _, tc := range []struct {
		name string
		role any
	}{
		{"missing role", nil},
		{"wrong type", struct{}{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := NewResolver(ResolverConfig{
				Adapter: plainAdapter{stubAdapter{kind: KindREAPER,
					declares: map[Capability]Level{CapPunch: Supported},
					roles:    map[Capability]any{CapPunch: tc.role}}},
				Runtime: func() Runtime { return Runtime{Bridge: true, Reachable: true} },
			})
			_, err := Role[Puncher](r, CapPunch)
			var bad *RoleError
			if !errors.As(err, &bad) || bad.Capability != CapPunch {
				t.Fatalf("err = %v (%T), want *RoleError for punch", err, err)
			}
			if errors.Is(err, ErrNotSupported) {
				t.Fatal("a broken adapter is a bug, not a refusal for the narrator")
			}
		})
	}
}

func TestRoleOfTheWrongInterfaceIsARoleError(t *testing.T) {
	r := NewResolver(ResolverConfig{
		Adapter: plainAdapter{stubAdapter{kind: KindREAPER,
			declares: map[Capability]Level{CapPunch: Supported},
			roles:    map[Capability]any{CapPunch: punch{}}}},
		Runtime: func() Runtime { return Runtime{Bridge: true, Reachable: true} },
	})
	var bad *RoleError
	if _, err := Role[Recorder](r, CapPunch); !errors.As(err, &bad) {
		t.Fatalf("Role[Recorder](punch) err = %v, want *RoleError", err)
	}
}
