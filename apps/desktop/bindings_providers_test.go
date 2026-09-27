package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// TestProviderCapabilitiesGoldenIsCurrent pins providerCapabilitiesPayload for the two platforms that answer differently today:
// Windows, where every registered provider runs (Moonshine and the dshow capture backend included), and macOS, where Moonshine and
// dshow are refused. The registry is empty here (a Host built without Startup), so no row reports an installed count.
// UPDATE_CONTRACTS=1 rewrites tests/fixtures/contracts/provider-capabilities-*.json.
func TestProviderCapabilitiesGoldenIsCurrent(t *testing.T) {
	for _, c := range []struct{ name, platform string }{
		{"provider-capabilities-windows", "windows"},
		{"provider-capabilities-darwin", "darwin"},
	} {
		t.Run(c.name, func(t *testing.T) {
			raw, err := encodeBinding(providerCapabilitiesPayload(c.platform, &assetRegistry{}), nil)
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			var decoded map[string]any
			if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
				t.Fatalf("payload %q is not JSON: %v", raw, err)
			}
			contractfile.Check(t, c.name, decoded)
		})
	}
}

type providerCapabilitiesWire struct {
	Platform string                       `json:"platform"`
	Asr      map[string]providerEntryWire `json:"asr"`
	Tts      map[string]providerEntryWire `json:"tts"`
	Capture  map[string]providerEntryWire `json:"capture"`
	Pron     map[string]providerEntryWire `json:"pronunciation"`
}

type providerEntryWire struct {
	Label     string   `json:"label"`
	Default   bool     `json:"default"`
	Platforms []string `json:"platforms"`
	Modes     []string `json:"modes"`
	Asset     *struct {
		Kind      string `json:"kind"`
		Installed *int   `json:"installed"`
	} `json:"asset"`
	Support struct {
		Level     string `json:"level"`
		Available bool   `json:"available"`
		Reason    string `json:"reason"`
		Message   string `json:"message"`
	} `json:"support"`
}

func decodeProviderCapabilities(t *testing.T, raw string) providerCapabilitiesWire {
	t.Helper()
	var decoded providerCapabilitiesWire
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatalf("payload %q is not JSON: %v", raw, err)
	}
	return decoded
}

func TestProviderCapabilitiesBindingReportsThisPlatform(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "")
	raw, err := host.ProviderCapabilities()
	if err != nil {
		t.Fatalf("ProviderCapabilities() error = %v", err)
	}
	decoded := decodeProviderCapabilities(t, raw)
	if decoded.Platform == "" {
		t.Fatal("platform is empty")
	}
	if len(decoded.Asr) == 0 || len(decoded.Tts) == 0 || len(decoded.Pron) == 0 || len(decoded.Capture) == 0 {
		t.Fatalf("every port reports its rows, got %+v", decoded)
	}
}

// TestProviderCapabilitiesRefusesAProviderOffItsPlatform: Moonshine and dshow declare Windows only (ADR 0107, captureport), so on
// macOS each answers unsupported with a whole sentence, while Whisper, Piper and both pronunciation sources run everywhere.
func TestProviderCapabilitiesRefusesAProviderOffItsPlatform(t *testing.T) {
	raw, _ := encodeBinding(providerCapabilitiesPayload("darwin", &assetRegistry{}), nil)
	decoded := decodeProviderCapabilities(t, raw)
	for name, entry := range map[string]providerEntryWire{"moonshine": decoded.Asr["moonshine"], "dshow": decoded.Capture["dshow"]} {
		s := entry.Support
		if s.Available || s.Level != "unsupported" || s.Reason != "unsupported" || s.Message == "" {
			t.Errorf("%s on darwin = %+v, want unavailable/unsupported with a message", name, s)
		}
	}
	for name, entry := range map[string]providerEntryWire{
		"whisper": decoded.Asr["whisper"], "piper": decoded.Tts["piper"], "cmu": decoded.Pron["cmu"], "espeak": decoded.Pron["espeak"],
	} {
		s := entry.Support
		if !s.Available || s.Level != "supported" || s.Reason != "" || s.Message != "" {
			t.Errorf("%s on darwin = %+v, want available/supported with no reason", name, s)
		}
	}
}

func TestProviderCapabilitiesMarksEachPortsDefault(t *testing.T) {
	raw, _ := encodeBinding(providerCapabilitiesPayload("windows", &assetRegistry{}), nil)
	decoded := decodeProviderCapabilities(t, raw)
	for port, want := range map[string]struct {
		rows map[string]providerEntryWire
		name string
	}{
		"asr": {decoded.Asr, "whisper"}, "tts": {decoded.Tts, "piper"}, "pronunciation": {decoded.Pron, "cmu"}, "capture": {decoded.Capture, "dshow"},
	} {
		for name, entry := range want.rows {
			if entry.Default != (name == want.name) {
				t.Errorf("%s/%s default = %v, want %v", port, name, entry.Default, name == want.name)
			}
		}
	}
}

// fakeAssetProvider is an asset kind with fixed install states, for counting what is installed without a real catalog.
type fakeAssetProvider struct {
	assetKind string
	states    map[string]string
}

func (p fakeAssetProvider) kind() string      { return p.assetKind }
func (p fakeAssetProvider) label() string     { return p.assetKind }
func (p fakeAssetProvider) noun() string      { return p.assetKind }
func (p fakeAssetProvider) endedKind() string { return p.assetKind }
func (p fakeAssetProvider) items() []assetItem {
	items := []assetItem{}
	for id := range p.states {
		items = append(items, assetItem{kind: p.assetKind, id: id})
	}
	return items
}
func (p fakeAssetProvider) item(id string) (assetItem, bool) {
	_, ok := p.states[id]
	return assetItem{kind: p.assetKind, id: id}, ok
}
func (p fakeAssetProvider) state(id string) string                                { return p.states[id] }
func (p fakeAssetProvider) install(context.Context, string, assets.Options) error { return nil }
func (p fakeAssetProvider) verify(string) (string, error)                         { return "", nil }
func (p fakeAssetProvider) remove(string) error                                   { return nil }

// TestProviderCapabilitiesCountsInstalledAssets: a provider whose asset kind has a catalog reports how many of its assets are
// installed (0 is a real answer, "none yet"), and one whose kind has no catalog in this launch reports no count at all.
func TestProviderCapabilitiesCountsInstalledAssets(t *testing.T) {
	registry := &assetRegistry{providers: []assetProvider{
		fakeAssetProvider{"whisper", map[string]string{"base": "installed", "small": "not_installed", "medium": "installed"}},
		fakeAssetProvider{"tts", map[string]string{"amy": "damaged"}},
	}}
	raw, _ := encodeBinding(providerCapabilitiesPayload("windows", registry), nil)
	decoded := decodeProviderCapabilities(t, raw)
	check := func(name string, entry providerEntryWire, kind string, want *int) {
		t.Helper()
		if entry.Asset == nil || entry.Asset.Kind != kind {
			t.Fatalf("%s asset = %+v, want kind %q", name, entry.Asset, kind)
		}
		switch {
		case want == nil && entry.Asset.Installed != nil:
			t.Errorf("%s installed = %d, want absent (no catalog)", name, *entry.Asset.Installed)
		case want != nil && (entry.Asset.Installed == nil || *entry.Asset.Installed != *want):
			t.Errorf("%s installed = %v, want %d", name, entry.Asset.Installed, *want)
		}
	}
	two, zero := 2, 0
	check("whisper", decoded.Asr["whisper"], "whisper", &two)
	check("piper", decoded.Tts["piper"], "tts", &zero)
	check("moonshine", decoded.Asr["moonshine"], "moonshine", nil)
	if decoded.Pron["cmu"].Asset != nil || decoded.Capture["dshow"].Asset != nil {
		t.Errorf("a provider with no asset kind reports no asset, got cmu %+v, dshow %+v", decoded.Pron["cmu"].Asset, decoded.Capture["dshow"].Asset)
	}
}
