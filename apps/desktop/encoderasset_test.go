package main

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/ffmpeg"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

// The FFmpeg build the MP3 encoder runs (ADR 0342) is one more kind in the asset registry: the generic bindings list, install, verify
// and remove it with no binding of its own, and Settings > Local assets shows it with its licence.
func TestTheEncoderIsOneMoreAssetKindTheGenericBindingsServe(t *testing.T) {
	f := newInstallFixture(t, false)
	builds, err := ffmpeg.NewFor(layout.RepoFile(layout.EncoderCatalogFile), filepath.Join(t.TempDir(), "encoder"), "windows")
	if err != nil {
		t.Fatal(err)
	}
	f.host.assets.registerEncoders(builds)

	encoder := listedAsset(t, answer(t)(f.host.AssetsList()), installKindEncoder, "ffmpeg-7.1-essentials-win64")
	if encoder["installState"] != "not_installed" || encoder["license"] != "GPL-3.0-or-later" || encoder["kindLabel"] != "Encoder" {
		t.Fatalf("encoder = %v, want it listed, not installed, with its GPL licence", encoder)
	}
	if encoder["downloadSize"] != float64(31246824) || encoder["diskSize"] != float64(87638016) {
		t.Fatalf("sizes = %v download, %v on disk; want the wheel, and the one executable kept from it", encoder["downloadSize"], encoder["diskSize"])
	}
	if attribution, _ := encoder["attribution"].(string); !strings.Contains(attribution, "Source:") {
		t.Fatalf("attribution = %q, want where the GPL build's source is", attribution)
	}
	if _, err := f.host.AssetsInstall(installKindEncoder, "ffmpeg-latest"); err == nil || !strings.Contains(err.Error(), "not in the approved catalog") {
		t.Fatalf("installing an unapproved build = %v, want it refused", err)
	}
}

func TestNoEncoderIsOfferedWhereTheCatalogHasNoBuild(t *testing.T) {
	f := newInstallFixture(t, false)
	builds, err := ffmpeg.NewFor(layout.RepoFile(layout.EncoderCatalogFile), t.TempDir(), "darwin")
	if err != nil {
		t.Fatal(err)
	}
	f.host.assets.registerEncoders(builds)
	for _, entry := range answer(t)(f.host.AssetsList())["assets"].([]any) {
		if entry.(map[string]any)["kind"] == installKindEncoder {
			t.Fatalf("macOS is offered %v: the catalogued build is a Windows executable", entry)
		}
	}
}
