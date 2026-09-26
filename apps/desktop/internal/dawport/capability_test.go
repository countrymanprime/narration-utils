package dawport

import (
	"reflect"
	"regexp"
	"testing"
)

func TestEveryCapabilityHasASpec(t *testing.T) {
	snake := regexp.MustCompile(`^[a-z]+(_[a-z]+)*$`)
	seen := map[Capability]bool{}
	for _, spec := range Capabilities() {
		if seen[spec.Capability] {
			t.Errorf("%s is listed twice", spec.Capability)
		}
		seen[spec.Capability] = true
		if !snake.MatchString(string(spec.Capability)) {
			t.Errorf("%q is not a snake_case wire name", spec.Capability)
		}
		if spec.Label == "" {
			t.Errorf("%s has no label for the narrator", spec.Capability)
		}
		if spec.Role == nil || spec.Role.Kind() != reflect.Interface {
			t.Errorf("%s's role type %v is not an interface", spec.Capability, spec.Role)
		}
		if got, ok := SpecOf(spec.Capability); !ok || got.Capability != spec.Capability {
			t.Errorf("SpecOf(%s) = %+v, %v", spec.Capability, got, ok)
		}
	}
	if _, ok := SpecOf("time_travel"); ok {
		t.Error("SpecOf found a capability that does not exist")
	}
}

func TestEachRoleServesOneCapability(t *testing.T) {
	// ISP: a role interface is the whole of one capability, so two capabilities never share one (a caller that asked for
	// one would then be handed the other's switch).
	owner := map[reflect.Type]Capability{}
	for _, spec := range Capabilities() {
		if other, ok := owner[spec.Role]; ok {
			t.Errorf("%s and %s share the role %v", other, spec.Capability, spec.Role)
		}
		owner[spec.Role] = spec.Capability
	}
}

func TestCapabilitiesAreReturnedInAStableOrderAndCannotBeChangedByCallers(t *testing.T) {
	a := Capabilities()
	a[0].Label = "changed"
	b := Capabilities()
	if b[0].Label == "changed" {
		t.Fatal("Capabilities() hands out its own slice")
	}
	for i := range b {
		if a[i].Capability != b[i].Capability {
			t.Fatalf("order changed at %d: %s then %s", i, a[i].Capability, b[i].Capability)
		}
	}
}

func TestLevelsAreOrderedAndNamed(t *testing.T) {
	if Unsupported >= NotYetAvailable || NotYetAvailable >= Experimental || Experimental >= Supported {
		t.Fatal("levels are ordered least to most capable, so `level >= Experimental` means the adapter has a role")
	}
	for level, want := range map[Level]string{
		Unsupported: "unsupported", NotYetAvailable: "not_yet_available", Experimental: "experimental", Supported: "supported",
		Level(99): "unsupported",
	} {
		if got := level.String(); got != want {
			t.Errorf("Level(%d).String() = %q, want %q", level, got, want)
		}
	}
}

func TestReasonsKeepTodaysWireValues(t *testing.T) {
	// The first four are already on the wire (readaloudreaper.go, bindings_navigation.go); the UI switches on them.
	for reason, want := range map[Reason]string{
		ReasonStandalone: "standalone", ReasonNotRunning: "not_running", ReasonExperimentalOff: "experimental_off",
		ReasonFailed: "failed", ReasonTurnedOff: "turned_off", ReasonNotYet: "not_yet", ReasonUnsupported: "unsupported",
	} {
		if string(reason) != want {
			t.Errorf("reason %q, want %q", reason, want)
		}
	}
}
