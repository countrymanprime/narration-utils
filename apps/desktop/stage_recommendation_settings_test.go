package main

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// Phase 6 of docs/prds/chapter-stage-recommendations.prd.md (Q8): the narrator's StageRecommendations settings choose
// which declared signals are required, and an optional master switch. These tests exercise that wiring end to end
// through the host, over the one signal wired so far (the recording signal, coverage.RecordingSignalID).

// TestIgnoringTheOnlyRequiredSignalDisablesTheSuggestion: setting the recording signal to "ignored" empties the
// recording stage's required set, which the engine's own invariant (an empty required set never recommends) turns
// into "none", even though the underlying check still reads as met.
func TestIgnoringTheOnlyRequiredSignalDisablesTheSuggestion(t *testing.T) {
	host := stagesHost(t, 10)
	checkRecording(t, host)
	if chapter := stageChapters(t, host)[0]; chapter["verdict"] != "recommended" {
		t.Fatalf("before ignoring the signal: chapter = %v", chapter)
	}

	if err := host.saveSettings("StageRecommendations", "global", map[string]*string{coverage.RecordingSignalID: ptr("ignored")}); err != nil {
		t.Fatal(err)
	}

	chapter := stageChapters(t, host)[0]
	if chapter["verdict"] != "none" || chapter["noneReason"] != string(stages.NoneNoRequiredSignals) {
		t.Fatalf("ignoring the chapter's only required signal: chapter = %v", chapter)
	}
}

// TestTheMasterSwitchDisablesEverySuggestion: turning suggestions_enabled off empties every stage's required set,
// regardless of any per-signal choice, so a chapter that would otherwise be recommended reads "none" instead.
func TestTheMasterSwitchDisablesEverySuggestion(t *testing.T) {
	host := stagesHost(t, 10)
	checkRecording(t, host)

	if err := host.saveSettings("StageRecommendations", "global", map[string]*string{"suggestions_enabled": ptr("false")}); err != nil {
		t.Fatal(err)
	}

	chapter := stageChapters(t, host)[0]
	if chapter["verdict"] != "none" || chapter["noneReason"] != string(stages.NoneNoRequiredSignals) {
		t.Fatalf("the master switch off: chapter = %v", chapter)
	}
}

// TestARequiredCheckSettingIsProjectScoped: a project-scope choice overrides the global one for the same signal, the
// same layered precedence every other settings tool follows (settings.Store.Effective).
func TestARequiredCheckSettingIsProjectScoped(t *testing.T) {
	host := stagesHost(t, 10)
	checkRecording(t, host)

	if err := host.saveSettings("StageRecommendations", "global", map[string]*string{coverage.RecordingSignalID: ptr("ignored")}); err != nil {
		t.Fatal(err)
	}
	if chapter := stageChapters(t, host)[0]; chapter["verdict"] != "none" {
		t.Fatalf("ignored globally: chapter = %v", chapter)
	}

	if err := host.saveSettings("StageRecommendations", "project", map[string]*string{coverage.RecordingSignalID: ptr("required")}); err != nil {
		t.Fatal(err)
	}
	if chapter := stageChapters(t, host)[0]; chapter["verdict"] != "recommended" {
		t.Fatalf("the project override wins over the global choice: chapter = %v", chapter)
	}
}

// TestARequiredCheckSettingRejectsAnUnknownChoice: the field is a choice like any other, so saveSettings validates it
// against its declared choices (required, ignored) rather than accepting anything.
func TestARequiredCheckSettingRejectsAnUnknownChoice(t *testing.T) {
	host := stagesHost(t, 10)
	if err := host.saveSettings("StageRecommendations", "global", map[string]*string{coverage.RecordingSignalID: ptr("sometimes")}); err == nil {
		t.Fatal("an unsupported choice value must be refused")
	}
}
