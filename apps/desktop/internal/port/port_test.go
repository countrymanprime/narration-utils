package port

import (
	"errors"
	"fmt"
	"testing"
)

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

func TestNotSupportedErrorSpeaksTheNarratorsMessage(t *testing.T) {
	msg := "Punch and roll is experimental and switched off in Settings."
	var err error = &NotSupportedError{
		Capability: "punch",
		Support:    Support{Level: Experimental, Reason: ReasonExperimentalOff, Message: msg},
	}
	if err.Error() != msg {
		t.Fatalf("Error() = %q, want the Support.Message %q", err.Error(), msg)
	}
	wrapped := fmt.Errorf("punch from here: %w", err)
	if !errors.Is(wrapped, ErrNotSupported) {
		t.Fatal("errors.Is(wrapped, ErrNotSupported) = false")
	}
	var ns *NotSupportedError
	if !errors.As(wrapped, &ns) || ns.Capability != "punch" || ns.Support.Reason != ReasonExperimentalOff {
		t.Fatalf("errors.As = %+v", ns)
	}
	if errors.Is(errors.New(msg), ErrNotSupported) {
		t.Fatal("an unrelated error with the same text must not match ErrNotSupported")
	}
}
