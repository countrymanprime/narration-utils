package main

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// Appearance.zoom (app-navigation-and-zoom-controls.prd.md Phase 3, Q4 A): the remembered webview zoom level, global
// scope only - it belongs to this computer's window, not a project. No fieldSchemas entry exists for it (Q4 C was
// not taken), so it is saved and read through bindings_window.go's own saveZoom/startupZoom, not the generic
// saveSettings path; these tests mirror keymap_settings_test.go's shape for that reason.
func newTestHostForZoomSettings(t *testing.T, projectFolder string) *Host {
	t.Helper()
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	host := &Host{settings: settings.New(t.TempDir(), projectFolder)}
	host.config.projectFolder = projectFolder
	return host
}

func TestSaveZoomPersistsAtGlobalScope(t *testing.T) {
	host := newTestHostForZoomSettings(t, "")

	if err := host.saveZoom(1.25, "global"); err != nil {
		t.Fatalf("saveZoom() = %v, want the level to be accepted", err)
	}

	effective, source := host.settings.Effective(appearanceTool, appearanceZoomKey, "")
	if effective != "1.25" || source != "global" {
		t.Fatalf("Effective() = (%q, %q), want (%q, %q)", effective, source, "1.25", "global")
	}
}

func TestSaveZoomRejectsAProjectScopedSave(t *testing.T) {
	host := newTestHostForZoomSettings(t, t.TempDir())

	err := host.saveZoom(1.5, "project")
	if err == nil || !strings.Contains(err.Error(), "global") {
		t.Fatalf("saveZoom() = %v, want a rejection naming the setting as global-only", err)
	}
	// Nothing was written: a project-scoped attempt leaves the store at its default.
	effective, source := host.settings.Effective(appearanceTool, appearanceZoomKey, "")
	if effective != "" || source != "hardcoded" {
		t.Fatalf("Effective() = (%q, %q), want nothing saved", effective, source)
	}
}

func TestWindowSaveZoomBindingSavesAtGlobalScope(t *testing.T) {
	host := newTestHostForZoomSettings(t, "")

	if _, err := host.WindowSaveZoom(1.5); err != nil {
		t.Fatalf("WindowSaveZoom() = %v, want it accepted", err)
	}
	effective, source := host.settings.Effective(appearanceTool, appearanceZoomKey, "")
	if effective != "1.5" || source != "global" {
		t.Fatalf("Effective() = (%q, %q), want (%q, %q)", effective, source, "1.5", "global")
	}
}

func TestStartupZoomReadsTheSavedLevel(t *testing.T) {
	host := newTestHostForZoomSettings(t, "")
	if err := host.saveZoom(1.75, "global"); err != nil {
		t.Fatal(err)
	}
	if got := host.startupZoom(); got != 1.75 {
		t.Errorf("startupZoom() = %v, want 1.75", got)
	}
}

func TestStartupZoomWithNothingSavedAnswersTheWebView2DefaultSentinel(t *testing.T) {
	host := newTestHostForZoomSettings(t, "")
	if got := host.startupZoom(); got != 0 {
		t.Errorf("startupZoom() = %v, want 0 (WebView2's own default, unset)", got)
	}
}

// clampedStartupZoom is startupZoom's pure body: a stored value the range has since narrowed past (ADR 0201), or a
// hand-edited file, must not reach WebView2's PutZoomFactor unclamped (bindings_window.go: unlike the runtime
// SetZoom/ZoomOut, the startup Zoom option has no floor or ceiling of its own).
func TestClampedStartupZoom(t *testing.T) {
	tests := []struct {
		name   string
		stored string
		want   float64
	}{
		{"unset reads as the WebView2 default sentinel", "", 0},
		{"garbage reads as the WebView2 default sentinel", "not-a-number", 0},
		{"an explicit zero reads as the WebView2 default sentinel", "0", 0},
		{"a value inside the range is kept exactly", "1.5", 1.5},
		{"a value below zoomMin is clamped up to it", "0.5", zoomMin},
		{"a value above zoomMax is clamped down to it", "4.0", zoomMax},
		{"a negative value is clamped up to zoomMin", "-1.25", zoomMin},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := clampedStartupZoom(tt.stored); got != tt.want {
				t.Errorf("clampedStartupZoom(%q) = %v, want %v", tt.stored, got, tt.want)
			}
		})
	}
}
