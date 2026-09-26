package dawport

import (
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func TestTheVocabularyIsPortsOwn(t *testing.T) {
	// Aliases, not copies: a port.Support is a dawport.Support, so the provider ports and the DAW port hand the UI one shape.
	for _, pair := range [][2]reflect.Type{
		{reflect.TypeFor[Level](), reflect.TypeFor[port.Level]()},
		{reflect.TypeFor[Reason](), reflect.TypeFor[port.Reason]()},
		{reflect.TypeFor[Support](), reflect.TypeFor[port.Support]()},
	} {
		if pair[0] != pair[1] {
			t.Errorf("%v is not %v", pair[0], pair[1])
		}
	}
	if ErrNotSupported != port.ErrNotSupported {
		t.Fatal("dawport.ErrNotSupported must be port.ErrNotSupported, so a caller can check either")
	}
}

func TestARefusalReadsAsPortsRefusal(t *testing.T) {
	support := Support{Level: Experimental, Reason: ReasonExperimentalOff, Message: "Punch and roll is switched off in Settings."}
	err := fmt.Errorf("punch: %w", &NotSupportedError{Capability: CapPunch, Support: support})

	var ns *port.NotSupportedError
	if !errors.As(err, &ns) || ns.Capability != string(CapPunch) || ns.Support != support || ns.Error() != support.Message {
		t.Fatalf("errors.As(*port.NotSupportedError) = %+v", ns)
	}
	if !errors.Is(err, port.ErrNotSupported) || !errors.Is(err, bridge.ErrExperimentalOff) {
		t.Fatal("an experimental_off refusal matches both port.ErrNotSupported and bridge.ErrExperimentalOff")
	}

	turnedOff := &NotSupportedError{Capability: CapPunch, Support: Support{Level: Experimental, Reason: ReasonTurnedOff, Message: "Off."}}
	if errors.Is(turnedOff, bridge.ErrExperimentalOff) {
		t.Fatal("only an experimental_off refusal matches bridge.ErrExperimentalOff")
	}
	if !errors.Is(turnedOff, ErrNotSupported) {
		t.Fatal("every refusal matches ErrNotSupported")
	}
}
