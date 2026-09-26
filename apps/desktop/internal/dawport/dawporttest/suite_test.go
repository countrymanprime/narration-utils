package dawporttest

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// The fake passes the suite at every mix of levels a real adapter can declare.
func TestFakePassesTheSuite(t *testing.T) {
	for name, levels := range map[string]map[dawport.Capability]dawport.Level{
		"all supported":     Levels(dawport.Supported),
		"all experimental":  Levels(dawport.Experimental),
		"all not yet":       Levels(dawport.NotYetAvailable), // the Audacity declaration until its pipe client lands
		"nothing declared":  {},
		"a REAPER-like mix": {dawport.CapNavigate: dawport.Supported, dawport.CapPunch: dawport.Experimental, dawport.CapReview: dawport.NotYetAvailable},
	} {
		t.Run(name, func(t *testing.T) {
			Run(t, func(testing.TB) dawport.Adapter {
				f := NewFake(dawport.KindREAPER, levels)
				f.Close()
				return f
			})
		})
	}
}

func TestEveryCapabilityHasARoleCheck(t *testing.T) {
	for _, spec := range dawport.Capabilities() {
		check, ok := roleChecks[spec.Capability]
		if !ok {
			t.Errorf("%s has no role check: add it to roleChecks", spec.Capability)
			continue
		}
		if check.want != spec.Role {
			t.Errorf("%s's role check asks for %v, but the catalog documents %v", spec.Capability, check.want, spec.Role)
		}
	}
	if len(roleChecks) != len(dawport.Capabilities()) {
		t.Errorf("roleChecks has %d rows for %d capabilities", len(roleChecks), len(dawport.Capabilities()))
	}
}

// broken wraps a fake and breaks one promise.
type broken struct {
	*Fake
	declares func() map[dawport.Capability]dawport.Level
	role     func(dawport.Capability) any
	kind     func() dawport.Kind
}

func (b broken) Declares() map[dawport.Capability]dawport.Level {
	if b.declares != nil {
		return b.declares()
	}
	return b.Fake.Declares()
}

func (b broken) Role(c dawport.Capability) any {
	if b.role != nil {
		return b.role(c)
	}
	return b.Fake.Role(c)
}

func (b broken) Kind() dawport.Kind {
	if b.kind != nil {
		return b.kind()
	}
	return b.Fake.Kind()
}

type panickingPuncher struct{}

func (panickingPuncher) PunchTo(context.Context, float64, float64) (float64, error) { panic("boom") }
func (panickingPuncher) PlayPosition(context.Context) (dawport.PlayPosition, error) {
	return dawport.PlayPosition{}, nil
}

type hangingPuncher struct{ release chan struct{} }

func (h hangingPuncher) PunchTo(context.Context, float64, float64) (float64, error) {
	<-h.release // ignores its context, as a transport that never times out would
	return 0, nil
}
func (h hangingPuncher) PlayPosition(context.Context) (dawport.PlayPosition, error) {
	return dawport.PlayPosition{}, nil
}

func TestTheSuiteCatchesABrokenAdapter(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	previous := callTimeout
	callTimeout = 50 * time.Millisecond
	defer func() { callTimeout = previous }()

	punchOnly := map[dawport.Capability]dawport.Level{dawport.CapPunch: dawport.Experimental}
	calls := 0
	for _, tc := range []struct {
		name  string
		adapt func(f *Fake) dawport.Adapter
		want  string
	}{
		{"a declared capability with no role", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, role: func(dawport.Capability) any { return nil }}
		}, "punch: declared experimental but Role returned nil"},
		{"a role of the wrong type", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, role: func(dawport.Capability) any { return struct{}{} }}
		}, "punch: Role returned struct {}, which is not a dawport.Puncher"},
		{"a role for a capability it does not have", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, role: func(c dawport.Capability) any {
				if c == dawport.CapRecord {
					return f.Role(dawport.CapPunch)
				}
				return f.Role(c)
			}}
		}, "record: declared unsupported but Role returned"},
		{"an unknown capability", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, declares: func() map[dawport.Capability]dawport.Level {
				return map[dawport.Capability]dawport.Level{"time_travel": dawport.Supported}
			}}
		}, `declares "time_travel", which is not a capability`},
		{"an out-of-range level", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, declares: func() map[dawport.Capability]dawport.Level {
				return map[dawport.Capability]dawport.Level{dawport.CapPunch: dawport.Level(7)}
			}}
		}, "punch: declares level 7"},
		{"a declaration that changes", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, declares: func() map[dawport.Capability]dawport.Level {
				calls++
				if calls%2 == 0 {
					return map[dawport.Capability]dawport.Level{}
				}
				return punchOnly
			}}
		}, "Declares is not static"},
		{"a kind that changes", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, kind: func() dawport.Kind {
				calls++
				return dawport.Kind(calls % 2)
			}}
		}, "Kind is not static"},
		{"a role that panics on a closed transport", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, role: func(c dawport.Capability) any {
				if c == dawport.CapPunch {
					return panickingPuncher{}
				}
				return f.Role(c)
			}}
		}, "punch: PunchTo panicked against a closed transport: boom"},
		{"a role that hangs on a closed transport", func(f *Fake) dawport.Adapter {
			return broken{Fake: f, role: func(c dawport.Capability) any {
				if c == dawport.CapPunch {
					return hangingPuncher{release: release}
				}
				return f.Role(c)
			}}
		}, "punch: PunchTo did not return within"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			problems := Problems(t, func(testing.TB) dawport.Adapter {
				f := NewFake(dawport.KindREAPER, punchOnly)
				f.Close()
				return tc.adapt(f)
			})
			if !containsProblem(problems, tc.want) {
				t.Fatalf("problems = %q, want one containing %q", problems, tc.want)
			}
		})
	}
}

func TestANilAdapterIsAProblemNotAPanic(t *testing.T) {
	problems := Problems(t, func(testing.TB) dawport.Adapter { return nil })
	if !containsProblem(problems, "the factory returned a nil adapter") {
		t.Fatalf("problems = %q", problems)
	}
}

func containsProblem(problems []string, want string) bool {
	for _, p := range problems {
		if strings.Contains(p, want) {
			return true
		}
	}
	return false
}

func TestCallArgumentsAreUsable(t *testing.T) {
	// Every argument the suite builds is callable: a func argument is a no-op, never nil, so a role that stores a handler and
	// calls it later cannot be the thing that panics.
	var handler func(dawport.RecordEnded)
	args := callArgs(context.Background(), reflect.TypeOf(handler).In(0))
	if len(args) != 1 || args[0].Kind() != reflect.Struct {
		t.Fatalf("callArgs = %v", args)
	}
	fn := callArgs(context.Background(), reflect.TypeOf(func(func(dawport.RecordEnded)) {}).In(0))
	if fn[0].IsNil() {
		t.Fatal("a func argument is nil")
	}
	fn[0].Call([]reflect.Value{reflect.Zero(reflect.TypeFor[dawport.RecordEnded]())})
}
