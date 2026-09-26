package dawport

import (
	"errors"
	"slices"
	"testing"
)

func TestRegisterThenLookupReturnsTheFactory(t *testing.T) {
	r := NewRegistry()
	var got Env
	r.Register(KindREAPER, func(env Env) (Adapter, error) {
		got = env
		return stubAdapter{kind: KindREAPER}, nil
	})

	factory, ok := r.Lookup(KindREAPER)
	if !ok {
		t.Fatal("Lookup did not find a registered kind")
	}
	adapter, err := factory(Env{SessionDir: "session"})
	if err != nil {
		t.Fatalf("factory: %v", err)
	}
	if adapter.Kind() != KindREAPER {
		t.Errorf("the factory built a %v adapter, want %v", adapter.Kind(), KindREAPER)
	}
	if got.SessionDir != "session" {
		t.Errorf("the factory got SessionDir %q, want %q", got.SessionDir, "session")
	}
}

func TestLookupOfAnUnregisteredKindIsFalse(t *testing.T) {
	r := NewRegistry()
	r.Register(KindREAPER, func(Env) (Adapter, error) { return stubAdapter{kind: KindREAPER}, nil })
	for _, kind := range []Kind{KindAudacity, KindNone} {
		if factory, ok := r.Lookup(kind); ok || factory != nil {
			t.Errorf("Lookup(%v) = %v, %v; want nil, false", kind, factory, ok)
		}
	}
}

func TestRegisteredIsSortedAndTheCallersOwn(t *testing.T) {
	r := NewRegistry()
	build := func(Env) (Adapter, error) { return nil, errors.New("unused") }
	r.Register(KindAudacity, build)
	r.Register(KindREAPER, build)

	kinds := r.Registered()
	if want := []Kind{KindREAPER, KindAudacity}; !slices.Equal(kinds, want) {
		t.Errorf("Registered() = %v, want %v", kinds, want)
	}
	kinds[0] = KindNone
	if slices.Contains(r.Registered(), KindNone) {
		t.Error("changing Registered()'s slice changed the registry")
	}
}

func TestRegisterRefusesAProgrammingError(t *testing.T) {
	build := func(Env) (Adapter, error) { return nil, errors.New("unused") }
	for name, register := range map[string]func(r *Registry){
		"KindNone":    func(r *Registry) { r.Register(KindNone, build) },
		"nil factory": func(r *Registry) { r.Register(KindAudacity, nil) },
		"twice":       func(r *Registry) { r.Register(KindREAPER, build) },
	} {
		t.Run(name, func(t *testing.T) {
			r := NewRegistry()
			r.Register(KindREAPER, build)
			func() {
				defer func() {
					if recover() == nil {
						t.Error("Register did not panic")
					}
				}()
				register(r)
			}()
			if got := r.Registered(); !slices.Equal(got, []Kind{KindREAPER}) {
				t.Errorf("after a refused registration Registered() = %v, want only the first", got)
			}
		})
	}
}

// The package-level functions are the composition root's registry. dawport registers nothing itself: the adapter packages do, and
// their own tests check they did.
func TestThePackageRegistryStartsEmpty(t *testing.T) {
	if kinds := Registered(); len(kinds) != 0 {
		t.Errorf("Registered() = %v with no adapter package imported, want none", kinds)
	}
	if _, ok := Lookup(KindREAPER); ok {
		t.Error("Lookup(KindREAPER) found a factory with no adapter package imported")
	}
}
