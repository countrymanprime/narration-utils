package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

// fakeDevices stands in for the teleprompter sidecar's --list-devices.
type fakeDevices struct {
	names   []string
	message string
	calls   int
}

func (f *fakeDevices) Devices(context.Context) ([]teleprompter.Device, string, error) {
	f.calls++
	devices := make([]teleprompter.Device, 0, len(f.names))
	for _, name := range f.names {
		devices = append(devices, teleprompter.Device{Name: name})
	}
	return devices, f.message, nil
}

var inputDevices = []string{"Microphone Array (Realtek(R) Audio)", "Microphone (Focusrite USB Audio)", "Line (Focusrite USB Audio)", "Microphone (2- Shure MV7)"}

func connectedHost() *Host {
	return &Host{reachability: liveReachability(), navigation: &findingNavigation{navigator: &fakeNavigator{}}}
}

func readInput(t *testing.T, host *Host, reader trackStateReader, lister deviceLister) teleprompterReaperInput {
	t.Helper()
	return teleprompterReaperInputIn(context.Background(), host.services(), reader, lister)
}

func TestREAPERsInputDeviceIsMatchedToAMicrophoneAndSaysWhy(t *testing.T) {
	reader := &fakeTrackStates{state: bridge.TrackState{InputDevice: "Shure MV7"}}

	input := readInput(t, connectedHost(), reader, &fakeDevices{names: inputDevices})

	if input.Status != "matched" || input.Device != "Microphone (2- Shure MV7)" || input.ReaperDevice != "Shure MV7" {
		t.Fatalf("input = %+v", input)
	}
	if !strings.Contains(input.Message, `"Shure MV7"`) || !strings.Contains(input.Message, "Microphone (2- Shure MV7)") {
		t.Fatalf("message = %q", input.Message)
	}
	if len(reader.asked) != 1 || reader.asked[0] != "" {
		t.Fatalf("asked REAPER about %v, want the transport only", reader.asked)
	}
}

func TestTwoInputsOfOneInterfaceAreUncertainAndNamed(t *testing.T) {
	input := readInput(t, connectedHost(), &fakeTrackStates{state: bridge.TrackState{InputDevice: "Focusrite USB ASIO"}}, &fakeDevices{names: inputDevices})

	if input.Status != "uncertain" || input.Device != "" || len(input.Candidates) != 2 {
		t.Fatalf("input = %+v", input)
	}
}

func TestADeviceThatMatchesNothingLeavesTheChoiceToTheNarrator(t *testing.T) {
	input := readInput(t, connectedHost(), &fakeTrackStates{state: bridge.TrackState{InputDevice: "ASIO4ALL v2"}}, &fakeDevices{names: inputDevices})

	if input.Status != "no_match" || input.Device != "" || !strings.Contains(input.Message, "Choose") {
		t.Fatalf("input = %+v", input)
	}
}

func TestWhenTheInputCannotBeKnownItSaysWhyAndListsNothing(t *testing.T) {
	cases := []struct {
		name    string
		setup   func(*Host)
		reader  *fakeTrackStates
		devices *fakeDevices
		reason  string
	}{
		{"standalone", func(h *Host) { h.navigation = &findingNavigation{standalone: true} }, &fakeTrackStates{}, &fakeDevices{}, reaperStandalone},
		{"REAPER quiet", func(h *Host) { h.reachability = nil }, &fakeTrackStates{}, &fakeDevices{}, reaperNotRunning},
		{"no answer", nil, &fakeTrackStates{err: bridge.ErrNoAnswer}, &fakeDevices{}, reaperNotRunning},
		{"experimental actions off", nil, &fakeTrackStates{err: bridge.ErrExperimentalOff}, &fakeDevices{}, readAloudExperimentalOff},
		{"anything else", nil, &fakeTrackStates{err: errors.New("disk full")}, &fakeDevices{}, refusedFailed},
		{"REAPER has no device open", nil, &fakeTrackStates{}, &fakeDevices{names: inputDevices}, inputReaperNoDevice},
		{"the microphones cannot be listed", nil, &fakeTrackStates{state: bridge.TrackState{InputDevice: "Shure MV7"}}, &fakeDevices{message: "Could not list input devices: no dshow backend"}, inputDevicesFailed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			host := connectedHost()
			if c.setup != nil {
				c.setup(host)
			}

			input := readInput(t, host, c.reader, c.devices)

			if input.Status != "unavailable" || input.Reason != c.reason || input.Message == "" || input.Device != "" {
				t.Fatalf("input = %+v, want unavailable/%s", input, c.reason)
			}
		})
	}
}

func TestNeitherASidecarNorREAPERIsAskedWithoutAHeartbeat(t *testing.T) {
	host := connectedHost()
	host.reachability = nil
	reader, devices := &fakeTrackStates{}, &fakeDevices{names: inputDevices}

	readInput(t, host, reader, devices)

	if len(reader.asked) != 0 || devices.calls != 0 {
		t.Fatalf("asked REAPER %v and listed devices %d times without a heartbeat", reader.asked, devices.calls)
	}
}

func TestTeleprompterReaperInputOnAHostWithNoBridgeIsStandalone(t *testing.T) {
	raw, err := (&Host{}).TeleprompterReaperInput()
	if err != nil || !strings.Contains(raw, `"reason":"standalone"`) {
		t.Fatalf("raw = %s, err = %v", raw, err)
	}
}

// The binding's answers, pinned for the UI's schema (ADR 0069).
func TestContractTeleprompterReaperInputs(t *testing.T) {
	answers := map[string]teleprompterReaperInput{
		"matched":          readInput(t, connectedHost(), &fakeTrackStates{state: bridge.TrackState{InputDevice: "Shure MV7"}}, &fakeDevices{names: inputDevices}),
		"uncertain":        readInput(t, connectedHost(), &fakeTrackStates{state: bridge.TrackState{InputDevice: "Focusrite USB ASIO"}}, &fakeDevices{names: inputDevices}),
		"no_match":         readInput(t, connectedHost(), &fakeTrackStates{state: bridge.TrackState{InputDevice: "ASIO4ALL v2"}}, &fakeDevices{names: inputDevices}),
		"reaper_no_device": readInput(t, connectedHost(), &fakeTrackStates{}, &fakeDevices{names: inputDevices}),
		"experimental_off": readInput(t, connectedHost(), &fakeTrackStates{err: bridge.ErrExperimentalOff}, &fakeDevices{}),
	}
	contractfile.Check(t, "teleprompter-reaper-inputs", answers)
}
