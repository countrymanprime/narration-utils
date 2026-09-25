package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// The credits setup prompt's host half (credits-token-setup-and-front-matter-detection PRD Phase 2, CS1, CS2, CS4,
// CS7): whether to ask, what to ask for with what prefilled, "Not now" and "Don't ask", and a save that only fills.

// hostWithImportedBook is hostWithCredits with the owner's book imported (tests/fixtures/after-the-applause.md) and
// no credits values saved: a project that predates credits, which is the upgrade case the prompt catches.
func hostWithImportedBook(t *testing.T) *Host {
	t.Helper()
	host := hostWithCredits(t)
	host.manuscript = manuscript.New(host.config.projectFolder)
	importFixture(t, host, "after-the-applause.md")
	return host
}

func importFixture(t *testing.T, host *Host, name string) {
	t.Helper()
	job := host.manuscript.Begin(layout.RepoFile(layout.FixturesDir + "/" + name))
	if _, err := host.manuscript.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := host.manuscript.Commit(job.ID, true, manuscript.Choices{}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 500; i++ {
		state, _ := host.manuscript.State(job.ID)
		if state.Phase == "success" {
			return
		}
		if state.Phase == "error" {
			t.Fatalf("import failed: %+v", state)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the import did not finish")
}

type setupState struct {
	Needed         bool   `json:"needed"`
	Banner         bool   `json:"banner"`
	Dismissed      string `json:"dismissed"`
	DocumentID     string `json:"documentId"`
	NarratorGlobal string `json:"narratorGlobal"`
	Fields         []struct {
		Token     string `json:"token"`
		Field     string `json:"field"`
		Candidate *struct {
			Value  string `json:"value"`
			Source string `json:"source"`
		} `json:"candidate"`
	} `json:"fields"`
	Candidates []struct {
		Token string `json:"token"`
	} `json:"candidates"`
}

func readSetupState(t *testing.T, host *Host) setupState {
	t.Helper()
	raw, err := host.CreditsSetupState()
	if err != nil {
		t.Fatal(err)
	}
	var state setupState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestAPreCreditsProjectWithAManuscriptIsAskedWithTheBookPrefilled(t *testing.T) {
	host := hostWithImportedBook(t)

	state := readSetupState(t, host)

	if !state.Needed || !state.Banner || state.Dismissed != "" || state.DocumentID == "" {
		t.Fatalf("state = %+v", state)
	}
	byToken := map[string]string{}
	for _, field := range state.Fields {
		value := ""
		if field.Candidate != nil {
			value = field.Candidate.Value
		}
		byToken[field.Token] = value
	}
	// The default templates read [Title], [Author] and [Narrator]; nothing names the narrator (CS7).
	if byToken["Title"] != "After the Applause" || byToken["Author"] != "Adrian Crow" || byToken["Narrator"] != "" || len(state.Fields) != 3 {
		t.Fatalf("fields = %+v", state.Fields)
	}
}

func TestNothingAsksWithoutAManuscriptOrOnceEveryTokenResolves(t *testing.T) {
	bare := hostWithCredits(t)
	bare.manuscript = manuscript.New(bare.config.projectFolder)
	if state := readSetupState(t, bare); state.Needed || state.Banner {
		t.Fatalf("a project with no manuscript was asked: %+v", state)
	}

	host := hostWithImportedBook(t)
	raw, err := host.CreditsSetupSave(map[string]string{"title": "After the Applause", "author": "Adrian Crow", "narrator": "Ada Finch"})
	if err != nil {
		t.Fatal(err)
	}
	var saved setupState
	if err := json.Unmarshal([]byte(raw), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Needed || saved.Banner || len(saved.Fields) != 0 {
		t.Fatalf("after Save = %+v", saved)
	}
}

func TestTheSetupSaveOnlyFillsEmptyValues(t *testing.T) {
	host := hostWithImportedBook(t)
	if _, err := host.CreditsSaveProjectValues("My Own Title", "", "", "", "", "", "", "", "", ""); err != nil {
		t.Fatal(err)
	}

	if _, err := host.CreditsSetupSave(map[string]string{"title": "After the Applause", "author": "Adrian Crow"}); err != nil {
		t.Fatal(err)
	}

	manifest, _, err := project.Load(nil, host.config.projectFolder)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Credits.Title != "My Own Title" || manifest.Credits.Author != "Adrian Crow" {
		t.Fatalf("credits = %+v", manifest.Credits)
	}
	if _, err := host.CreditsSetupSave(map[string]string{"isbn": "x"}); err == nil {
		t.Fatal("an unknown field was saved")
	}
}

func TestNotNowLastsTheSessionAndDontAskLastsUntilTheManuscriptIsReplaced(t *testing.T) {
	host := hostWithImportedBook(t)

	if _, err := host.CreditsSetupDismiss("session"); err != nil {
		t.Fatal(err)
	}
	notNow := readSetupState(t, host)
	if notNow.Needed || !notNow.Banner || notNow.Dismissed != "session" {
		t.Fatalf("after Not now = %+v", notNow)
	}
	// A new session (a fresh host on the same project) asks again.
	fresh := hostWithCredits(t)
	fresh.config = host.config
	fresh.manuscript = host.manuscript
	if state := readSetupState(t, fresh); !state.Needed {
		t.Fatalf("a new session was not asked: %+v", state)
	}

	if _, err := host.CreditsSetupDismiss("project"); err != nil {
		t.Fatal(err)
	}
	dontAsk := readSetupState(t, fresh)
	if dontAsk.Needed || dontAsk.Banner || dontAsk.Dismissed != "project" {
		t.Fatalf("after Don't ask = %+v", dontAsk)
	}

	// Replace manuscript: a new document id, so it asks again.
	importFixture(t, host, "after-the-applause.md")
	if again := readSetupState(t, host); !again.Needed || again.Dismissed != "" {
		t.Fatalf("after Replace manuscript = %+v", again)
	}
	if _, err := host.CreditsSetupDismiss("forever"); err == nil || !strings.Contains(err.Error(), "scope") {
		t.Fatalf("err = %v", err)
	}
}

// CreditsSetupState's payloads (PRD Phase 2): asked with the owner's book prefilled, and after "Don't ask".
func TestContractCreditsSetupState(t *testing.T) {
	host := hostWithImportedBook(t)
	check := func(name string) {
		raw, err := host.CreditsSetupState()
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			t.Fatal(err)
		}
		payload["documentId"] = "doc-after-the-applause"
		if dismissed, ok := payload["dismissedAt"].(string); ok && dismissed != "" {
			payload["dismissedAt"] = "2026-09-25T12:00:00Z"
		}
		contractfile.Check(t, name, payload)
	}
	check("credits-setup-state-needed")
	if _, err := host.CreditsSetupDismiss("project"); err != nil {
		t.Fatal(err)
	}
	check("credits-setup-state-dismissed")
	if _, err := os.Stat(project.Path(host.config.projectFolder)); err != nil {
		t.Fatal("Don't ask was not stored on the manifest")
	}
}
