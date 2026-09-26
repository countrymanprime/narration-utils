package daw

import (
	"reflect"
	"testing"
)

// The input detection of teleprompter-manuscript-integration PRD Phase 11 (ADR 0250): REAPER's open input device, as
// GetAudioDeviceInfo("IDENT_IN") names it, against the names the teleprompter's dshow capture opens.
func TestMatchInputDevice(t *testing.T) {
	realtek := "Microphone Array (Realtek(R) Audio)"
	focusriteMic := "Microphone (Focusrite USB Audio)"
	focusriteLine := "Line (Focusrite USB Audio)"
	shure := "Microphone (2- Shure MV7)"
	cases := []struct {
		name       string
		reaper     string
		devices    []string
		status     string
		device     string
		candidates []string
	}{
		{"the same name under WASAPI", "Microphone Array (Realtek(R) Audio)", []string{shure, realtek}, InputMatched, realtek, nil},
		{"case and spacing do not matter", "  microphone array (realtek(r) audio) ", []string{realtek}, InputMatched, realtek, nil},
		{"an ASIO driver's brand names one device", "Focusrite USB ASIO", []string{realtek, focusriteMic}, InputMatched, focusriteMic, nil},
		{"Windows' duplicate number is not a word", "Shure MV7", []string{realtek, shure}, InputMatched, shure, nil},
		{"two inputs of the same interface are uncertain", "Focusrite USB ASIO", []string{focusriteMic, realtek, focusriteLine}, InputUncertain, "", []string{focusriteMic, focusriteLine}},
		{"nothing in common", "ASIO4ALL v2", []string{realtek, shure}, InputNoMatch, "", nil},
		{"only generic words", "USB Audio ASIO Driver", []string{focusriteMic, realtek}, InputNoMatch, "", nil},
		{"REAPER names no device", "", []string{realtek}, InputNoMatch, "", nil},
		{"no devices to match", "Focusrite USB ASIO", nil, InputNoMatch, "", nil},
		{"half the brand words is too little", "Focusrite Scarlett 2i2", []string{"Microphone (Scarlett Solo USB)"}, InputNoMatch, "", nil},
		{"most of the brand words is enough", "Scarlett 2i2 USB", []string{"Microphone (Scarlett 2i2 USB)"}, InputMatched, "Microphone (Scarlett 2i2 USB)", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := MatchInputDevice(c.reaper, c.devices)

			if got.Status != c.status || got.Device != c.device || !reflect.DeepEqual(got.Candidates, c.candidates) {
				t.Fatalf("MatchInputDevice(%q) = %+v, want %s %q %v", c.reaper, got, c.status, c.device, c.candidates)
			}
		})
	}
}
