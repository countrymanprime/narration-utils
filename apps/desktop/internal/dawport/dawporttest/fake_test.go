package dawporttest

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

func TestFakeHandsOutARoleOnlyForWhatItDeclaresUsable(t *testing.T) {
	f := NewFake(dawport.KindAudacity, map[dawport.Capability]dawport.Level{
		dawport.CapPunch: dawport.Supported, dawport.CapRecord: dawport.NotYetAvailable,
	})
	if f.Kind() != dawport.KindAudacity {
		t.Fatalf("Kind() = %v", f.Kind())
	}
	if _, ok := f.Role(dawport.CapPunch).(dawport.Puncher); !ok {
		t.Fatal("no Puncher for a Supported punch")
	}
	if r := f.Role(dawport.CapRecord); r != nil {
		t.Fatalf("Role(record) = %v for a NotYetAvailable capability", r)
	}
}

func TestFakeDeclarationIsTheCallersCopy(t *testing.T) {
	levels := map[dawport.Capability]dawport.Level{dawport.CapPunch: dawport.Supported}
	f := NewFake(dawport.KindREAPER, levels)
	levels[dawport.CapPunch] = dawport.Unsupported
	f.Declares()[dawport.CapPunch] = dawport.Unsupported
	if got := f.Declares()[dawport.CapPunch]; got != dawport.Supported {
		t.Fatalf("Declares()[punch] = %v: the fake must not share its map", got)
	}
}

func TestFakeRecordsCallsAndFailsOnceClosed(t *testing.T) {
	f := NewFake(dawport.KindREAPER, Levels(dawport.Supported))
	p := f.Role(dawport.CapPunch).(dawport.Puncher)
	if _, err := p.PunchTo(context.Background(), 1, 2); err != nil {
		t.Fatalf("PunchTo on an open fake = %v", err)
	}
	pickups := f.Role(dawport.CapPickups).(dawport.PickupList)
	if err := pickups.ImportPickups("run-1", "payload.txt"); err != nil {
		t.Fatalf("ImportPickups on an open fake = %v", err)
	}
	f.Close()
	if _, err := p.PunchTo(context.Background(), 1, 2); !errors.Is(err, ErrClosed) {
		t.Fatalf("PunchTo on a closed fake = %v, want ErrClosed", err)
	}
	want := []string{"punch.PunchTo", "pickups.ImportPickups", "punch.PunchTo"}
	if got := f.Calls(); !slices.Equal(got, want) {
		t.Fatalf("Calls() = %q, want %q", got, want)
	}
}

func TestFakeRolesSatisfyEveryRoleInterface(t *testing.T) {
	f := NewFake(dawport.KindREAPER, Levels(dawport.Supported))
	for _, spec := range dawport.Capabilities() {
		role := f.Role(spec.Capability)
		if role == nil || !reflect.TypeOf(role).Implements(spec.Role) {
			t.Errorf("Role(%s) = %T, want a %v", spec.Capability, role, spec.Role)
		}
	}
}

func TestFakeWorksThroughTheResolver(t *testing.T) {
	f := NewFake(dawport.KindREAPER, map[dawport.Capability]dawport.Level{dawport.CapPunch: dawport.Experimental})
	r := dawport.NewResolver(dawport.ResolverConfig{
		Adapter:      f,
		Runtime:      func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} },
		Experimental: func() bool { return true },
	})
	p, err := dawport.Role[dawport.Puncher](r, dawport.CapPunch)
	if err != nil {
		t.Fatalf("Role[Puncher] = %v", err)
	}
	if _, err := p.PlayPosition(context.Background()); err != nil {
		t.Fatalf("PlayPosition = %v", err)
	}
	if got := f.Calls(); !slices.Equal(got, []string{"punch.PlayPosition"}) {
		t.Fatalf("Calls() = %q", got)
	}
}
