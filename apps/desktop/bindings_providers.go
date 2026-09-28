package main

import (
	"fmt"
	"runtime"

	"github.com/countrymanprime/narration-utils/shell/internal/asrport"
	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationport"
	"github.com/countrymanprime/narration-utils/shell/internal/ttsport"
)

// ProviderCapabilities (provider-ports PRD P14, ADR 0301) is the UI's one picture of the providers this build can hand its sidecars:
// every row of the speech recognition, voice, pronunciation and capture registries, whether it runs on this platform, and, for a
// provider whose models or voices come from the asset catalog, how many of them are installed. It reads the registries only (never a
// concrete engine) and changes nothing. No screen reads it yet; a later PRD may use it to explain a disabled choice (Moonshine off
// Windows) the way DawCapabilities explains a disabled control. The wire schema, golden payloads, wireContracts row and mock live in
// apps/ui/src/api (docs/architecture/wire-contracts.md). The Encoder and Packager registries (encodeport, a Could) are empty and
// are left off until a row lands.

// ProviderCapabilities answers, for each provider port, every registered provider's label, platforms, modes, asset kind (with
// the installed count when its catalog is present) and whether it is supported on this platform.
func (h *Host) ProviderCapabilities() (string, error) {
	return encodeBinding(providerCapabilitiesPayload(runtime.GOOS, h.registry()), nil)
}

// providerCapabilitiesPayload is ProviderCapabilities' shape for platform (a GOOS value): {platform, asr, tts, pronunciation,
// capture: {<name>: {label, default, platforms, modes, asset?: {kind, installed?}, support}}} (apps/ui/src/api/schemas/providers.ts).
// support is the DAW port's Support shape (apps/ui/src/api/schemas/daw.ts): a provider declared for platform is supported and
// available; any other is unsupported, with the reason and a sentence for the narrator.
func providerCapabilitiesPayload(platform string, assets *assetRegistry) map[string]any {
	installed := installedCounter(assets)
	asr := map[string]any{}
	for i, e := range asrport.Engines.Entries() {
		asr[e.Name] = providerEntry(e.Descriptor, port.Supported, platform, i == 0, e.New().AssetKind(), installed)
	}
	tts := map[string]any{}
	for i, e := range ttsport.Engines.Entries() {
		tts[e.Name] = providerEntry(e.Descriptor, port.Supported, platform, i == 0, e.New().AssetKind(), installed)
	}
	pronunciation := map[string]any{}
	for i, e := range pronunciationport.Sources.Entries() {
		pronunciation[e.Name] = providerEntry(e.Descriptor, port.Supported, platform, i == 0, "", installed)
	}
	capture := map[string]any{}
	// The capture default is per platform (captureport.For): the first row declared for it, not the first row registered.
	defaultBackend := ""
	if e, err := captureport.For(platform); err == nil {
		defaultBackend = e.Name
	}
	for _, e := range captureport.Backends.Entries() {
		capture[e.Name] = providerEntry(e.Descriptor, e.New().Level(), platform, e.Name == defaultBackend, "", installed)
	}
	return map[string]any{
		"platform":      platform,
		"asr":           asr,
		"tts":           tts,
		"pronunciation": pronunciation,
		"capture":       capture,
	}
}

// providerEntry is one registry row on the wire. level is how far the row is supported where it runs (only a capture row declares
// one; every other port's rows are Supported); isDefault is the row the port falls back to when no setting names one; assetKind
// is empty for a provider that installs nothing.
func providerEntry(d port.Descriptor, level port.Level, platform string, isDefault bool, assetKind string, installed func(kind string) (int, bool)) map[string]any {
	entry := map[string]any{
		"label":     d.Label,
		"default":   isDefault,
		"platforms": nonNil(d.Platforms),
		"modes":     nonNil(d.Modes),
		"support":   supportPayload(providerSupport(d, level, platform)),
	}
	if assetKind != "" {
		asset := map[string]any{"kind": assetKind}
		if count, ok := installed(assetKind); ok {
			asset["installed"] = count
		}
		entry["asset"] = asset
	}
	return entry
}

// providerSupport is a row's answer on platform: its level, and available, where its descriptor runs; Unsupported elsewhere. Only
// the capture port's wasapi row is Experimental today (docs/adr/0357). It is still available: no narrator switch gates a provider
// row yet, and the Booth that first uses it (native-recording-suite Phase 2) decides how an Experimental engine is offered.
func providerSupport(d port.Descriptor, level port.Level, platform string) port.Support {
	if d.RunsOn(platform) {
		return port.Support{Level: level, Available: true}
	}
	return port.Support{
		Level:   port.Unsupported,
		Reason:  port.ReasonUnsupported,
		Message: fmt.Sprintf("%s is not available on %s.", d.Label, platformLabel(platform)),
	}
}

// supportPayload is a port.Support as DawCapabilities sends it: reason and message only when unavailable.
func supportPayload(s port.Support) map[string]any {
	payload := map[string]any{"level": s.Level.String(), "available": s.Available}
	if s.Reason != "" {
		payload["reason"] = string(s.Reason)
	}
	if s.Message != "" {
		payload["message"] = s.Message
	}
	return payload
}

// installedCounter counts, per asset kind, the assets the registry reports installed. ok is false for a kind with no catalog in
// this launch (the registry could not be built, or the kind's catalog is unreadable), which is not the same answer as "none yet".
func installedCounter(assets *assetRegistry) func(kind string) (int, bool) {
	return func(kind string) (int, bool) {
		provider, err := assets.provider(kind)
		if err != nil {
			return 0, false
		}
		count := 0
		for _, item := range provider.items() {
			if provider.state(item.id) == "installed" {
				count++
			}
		}
		return count, true
	}
}

// platformLabel is a GOOS value in the words a narrator reads.
func platformLabel(platform string) string {
	switch platform {
	case "windows":
		return "Windows"
	case "darwin":
		return "macOS"
	case "linux":
		return "Linux"
	default:
		return platform
	}
}

// nonNil keeps an empty list a list on the wire ([] rather than null).
func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
