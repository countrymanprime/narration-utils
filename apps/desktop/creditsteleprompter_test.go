package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/credits"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The credits on the teleprompter (audiobook-credits-templates.prd.md Phase 4, ADR 0150): the host renders the text with
// the one renderer (credits.Render) from the template ADR 0093 picks, and a token with no value warns but never blocks.

func hostWithCredits(t *testing.T) *Host {
	t.Helper()
	t.Setenv("APPDATA", t.TempDir())
	folder := t.TempDir()
	host := NewHost()
	host.config.projectFolder = folder
	host.config.projectName = "Alice"
	host.settings = settings.New(layout.FindRoot("."), folder)
	return host
}

func TestCreditsScriptRendersTheFirstTemplateOfTheKindWithTheProjectValues(t *testing.T) {
	host := hostWithCredits(t)
	if _, err := host.CreditsSaveProjectValues("Alice", "", "Lewis Carroll", "", "", "", "", "", "", "Ada Finch"); err != nil {
		t.Fatal(err)
	}

	script, err := host.creditsScript("closing")
	if err != nil {
		t.Fatal(err)
	}

	want := "You have been listening to Alice, written by Lewis Carroll, narrated by Ada Finch. The End."
	if script.ID != "credits-closing" || script.Title != "Closing credits" || script.Text != want {
		t.Fatalf("script = %+v, want the first closing template rendered (%q)", script, want)
	}
}

func TestCreditsScriptEqualsWhatThePreviewShows(t *testing.T) {
	host := hostWithCredits(t)
	if _, err := host.CreditsSaveProjectValues("Alice", "", "Lewis Carroll", "", "", "", "", "", "", ""); err != nil {
		t.Fatal(err)
	}
	templates, err := host.creditTemplates.List()
	if err != nil {
		t.Fatal(err)
	}

	script, err := host.creditsScript("opening")
	if err != nil {
		t.Fatal(err)
	}

	preview := credits.Render(templates[0].Body, credits.Values{Title: "Alice", Author: "Lewis Carroll"}.Resolve(""))
	if script.Text != preview.Text {
		t.Fatalf("teleprompter text %q differs from the preview %q", script.Text, preview.Text)
	}
}

func TestCreditsScriptKeepsAnUnresolvedTokenVisibleRatherThanRefusing(t *testing.T) {
	host := hostWithCredits(t)

	script, err := host.creditsScript("opening")
	if err != nil {
		t.Fatalf("an unresolved token warns in the UI but must not block Start (C6): %v", err)
	}
	if !strings.Contains(script.Text, "[Narrator]") {
		t.Fatalf("text = %q, want the unresolved placeholder left in place", script.Text)
	}
}

func TestCreditsScriptRejectsAKindThatIsNotOpeningOrClosing(t *testing.T) {
	host := hostWithCredits(t)
	for _, kind := range []string{"chapter_announcement", "", "../opening"} {
		if _, err := host.creditsScript(kind); err == nil {
			t.Errorf("kind %q should be rejected", kind)
		}
	}
}

func TestCreditsScriptExplainsWhereToAddAMissingTemplate(t *testing.T) {
	host := hostWithCredits(t)
	templates, err := host.creditTemplates.List()
	if err != nil {
		t.Fatal(err)
	}
	for _, template := range templates {
		if template.Kind == "closing" {
			if err := host.creditTemplates.Delete(template.ID); err != nil {
				t.Fatal(err)
			}
		}
	}

	_, err = host.creditsScript("closing")

	if err == nil || !strings.Contains(err.Error(), "Settings") {
		t.Fatalf("err = %v, want it to point at Settings > Credits", err)
	}
}

// Past the model gate a credits request goes to the service as a script, not a chapter: with the service's bare Config the
// first thing it reports is the missing sidecar, not the missing REAPER project a chapter request would hit first.
func TestTeleprompterStartSendsCreditsToTheServiceAsAScript(t *testing.T) {
	host, closeServer := hostForTeleprompterStart(t)
	defer closeServer()
	t.Setenv("APPDATA", t.TempDir())
	host.creditTemplates = credits.NewTemplateStore(filepath.Join(t.TempDir(), "credit-templates.json"))
	if err := host.registry().whisper.Install(context.Background(), "tiny"); err != nil {
		t.Fatal(err)
	}

	_, err := host.TeleprompterStart(map[string]string{"model": "tiny", "credits": "opening", "device": "Mic"})

	if err == nil || !strings.Contains(err.Error(), "teleprompter executable") {
		t.Fatalf("expected the script path's sidecar error, got %v", err)
	}
}

func TestTeleprompterStartRejectsAnUnknownCreditsKind(t *testing.T) {
	host, closeServer := hostForTeleprompterStart(t)
	defer closeServer()
	host.creditTemplates = credits.NewTemplateStore(filepath.Join(t.TempDir(), "credit-templates.json"))
	if err := host.registry().whisper.Install(context.Background(), "tiny"); err != nil {
		t.Fatal(err)
	}

	if _, err := host.TeleprompterStart(map[string]string{"model": "tiny", "credits": "chapter_announcement", "device": "Mic"}); err == nil {
		t.Fatal("expected an unknown credits kind to be rejected")
	}
}
