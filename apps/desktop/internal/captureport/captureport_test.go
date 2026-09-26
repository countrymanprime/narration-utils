package captureport_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/captureport/captureporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func TestEveryRegisteredBackendPassesTheSuite(t *testing.T) {
	entries := captureport.Backends.Entries()
	if len(entries) == 0 {
		t.Fatal("no capture backend is registered")
	}
	for _, entry := range entries {
		t.Run(entry.Name, func(t *testing.T) { captureporttest.Run(t, entry) })
	}
}

func TestOnlyWindowsHasABackendToday(t *testing.T) {
	// The teleprompter sidecar lists and opens microphones through FFmpeg's dshow (devices.py); off Windows it has none.
	for platform, want := range map[string][]string{
		"windows": {"dshow"},
		"darwin":  {},
		"linux":   {},
	} {
		if got := captureport.Backends.Names(platform); !reflect.DeepEqual(got, want) {
			t.Errorf("Backends.Names(%q) = %v, want %v", platform, got, want)
		}
	}
}

func TestForWindowsIsDshow(t *testing.T) {
	entry, err := captureport.For("windows")
	if err != nil {
		t.Fatalf("For(windows): %v", err)
	}
	if entry.Name != captureport.DShow || entry.New().Name() != "dshow" {
		t.Fatalf("For(windows) = %q, want dshow", entry.Name)
	}
}

func TestAPlatformWithoutABackendIsRefusedWithANotSupportedError(t *testing.T) {
	for _, platform := range []string{"darwin", "linux"} {
		_, err := captureport.For(platform)
		var refusal *port.NotSupportedError
		if !errors.As(err, &refusal) || !errors.Is(err, port.ErrNotSupported) {
			t.Fatalf("For(%q) = %v, want a *port.NotSupportedError", platform, err)
		}
		if refusal.Capability != "capture" || refusal.Support.Level != port.Unsupported || refusal.Support.Reason != port.ReasonUnsupported {
			t.Errorf("For(%q) refusal = %+v, want capture, unsupported", platform, refusal)
		}
		if want := `There is no capture backend for ` + platform + `.`; err.Error() != want {
			t.Errorf("message = %q, want %q", err.Error(), want)
		}
	}
}

func TestAnUnknownBackendIsRefusedWithANotSupportedError(t *testing.T) {
	_, err := captureport.Backends.Lookup("wasapi")
	if !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("Lookup(wasapi) = %v, want a *port.NotSupportedError", err)
	}
	if want := `There is no capture backend called "wasapi".`; err.Error() != want {
		t.Fatalf("message = %q, want %q", err.Error(), want)
	}
}

func TestANewBackendIsOneRowAndPassesTheSuiteWithNoOtherEdit(t *testing.T) {
	backends := captureport.NewRegistry()
	for _, row := range []struct{ name, label, platform string }{
		{"coreaudio", "Core Audio", "darwin"},
		{"wasapi", "WASAPI", "windows"},
	} {
		name := row.name
		backends.Register(port.Entry[captureport.Backend]{
			Name:       name,
			Descriptor: port.Descriptor{Label: row.label, Platforms: []string{row.platform}},
			New:        func() captureport.Backend { return captureporttest.NewFake(name) },
		})
	}
	for _, entry := range backends.Entries() {
		t.Run(entry.Name, func(t *testing.T) { captureporttest.Run(t, entry) })
	}
	if entry, err := captureport.ForIn(backends, "darwin"); err != nil || entry.Name != "coreaudio" {
		t.Errorf("ForIn(darwin) = %q, %v; want coreaudio", entry.Name, err)
	}
	if entry, err := captureport.ForIn(backends, "windows"); err != nil || entry.Name != "dshow" {
		t.Errorf("a later row must not displace the default: ForIn(windows) = %q, %v; want dshow", entry.Name, err)
	}
	if _, err := captureport.For("darwin"); err == nil {
		t.Error("registering on a new registry changed the program's")
	}
}
