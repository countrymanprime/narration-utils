package encodeport_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport/encodeporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func TestEveryRegisteredEncoderPassesTheSuite(t *testing.T) {
	// Empty today (render goes through REAPER); the loop is here so the first row cannot skip the suite.
	for _, entry := range encodeport.Encoders.Entries() {
		t.Run(entry.Name, func(t *testing.T) { encodeporttest.RunEncoder(t, entry) })
	}
}

func TestEveryRegisteredPackagerPassesTheSuite(t *testing.T) {
	for _, entry := range encodeport.Packagers.Entries() {
		t.Run(entry.Name, func(t *testing.T) { encodeporttest.RunPackager(t, entry, nil) })
	}
}

func TestTheRegistriesAreDeclaredEmpty(t *testing.T) {
	// Provider-ports P13 declares the ports only; the render-encode-master PRD adds the first rows.
	for _, platform := range port.Platforms {
		if got := encodeport.Encoders.Names(platform); !reflect.DeepEqual(got, []string{}) {
			t.Errorf("Encoders.Names(%q) = %v, want none", platform, got)
		}
		if got := encodeport.Packagers.Names(platform); !reflect.DeepEqual(got, []string{}) {
			t.Errorf("Packagers.Names(%q) = %v, want none", platform, got)
		}
	}
}

func TestAnUnknownEncoderOrPackagerIsRefusedWithANotSupportedError(t *testing.T) {
	_, err := encodeport.Encoders.Lookup("lame")
	if !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("Encoders.Lookup(lame) = %v, want a *port.NotSupportedError", err)
	}
	if want := `There is no encoder called "lame".`; err.Error() != want {
		t.Errorf("message = %q, want %q", err.Error(), want)
	}
	_, err = encodeport.Packagers.Lookup("chaptertags")
	if !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("Packagers.Lookup(chaptertags) = %v, want a *port.NotSupportedError", err)
	}
	if want := `There is no packager called "chaptertags".`; err.Error() != want {
		t.Errorf("message = %q, want %q", err.Error(), want)
	}
}

func TestFormatNotSupportedSaysWhichFormat(t *testing.T) {
	err := encodeport.FormatNotSupported("encoder", "lame", "flac")
	var refusal *port.NotSupportedError
	if !errors.As(err, &refusal) || !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("FormatNotSupported = %v, want a *port.NotSupportedError", err)
	}
	if refusal.Capability != "flac" || refusal.Support.Level != port.Unsupported || refusal.Support.Reason != port.ReasonUnsupported {
		t.Errorf("refusal = %+v, want flac, unsupported", refusal)
	}
	if want := `The encoder "lame" cannot write flac files.`; err.Error() != want {
		t.Errorf("message = %q, want %q", err.Error(), want)
	}
}

func TestANewEncoderAndPackagerAreOneRowAndPassTheSuiteWithNoOtherEdit(t *testing.T) {
	encoders := encodeport.NewEncoders()
	encoders.Register(port.Entry[encodeport.Encoder]{
		Name:       "fake-mp3",
		Descriptor: port.Descriptor{Label: "Fake MP3", Modes: []string{"mp3", "m4b"}},
		New:        func() encodeport.Encoder { return encodeporttest.NewFakeEncoder("fake-mp3", "mp3", "m4b") },
	})
	for _, entry := range encoders.Entries() {
		t.Run(entry.Name, func(t *testing.T) { encodeporttest.RunEncoder(t, entry) })
	}

	packagers := encodeport.NewPackagers()
	packagers.Register(port.Entry[encodeport.Packager]{
		Name:       "fake-id3",
		Descriptor: port.Descriptor{Label: "Fake ID3", Modes: []string{"mp3"}},
		New:        func() encodeport.Packager { return encodeporttest.NewFakePackager("fake-id3", "mp3") },
	})
	samples := encodeporttest.FakeSamples(t, "mp3")
	for _, entry := range packagers.Entries() {
		t.Run(entry.Name, func(t *testing.T) { encodeporttest.RunPackager(t, entry, samples) })
	}

	if len(encodeport.Encoders.Entries()) != 0 || len(encodeport.Packagers.Entries()) != 0 {
		t.Error("registering on a new registry changed the program's")
	}
}
