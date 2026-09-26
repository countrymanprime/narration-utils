package main

import (
	"context"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// stagesHost is a coverage project (coverage_test.go) whose one chapter is in recording, with the Whisper model
// installed and a fake recording check that finds present of the chapter's 10 words.
func stagesHost(t *testing.T, present int) *Host {
	t.Helper()
	host := coverageHost(t, coverageProject(t), true, fakeCoverageSidecar(present))
	if _, err := host.ManuscriptSetChapterStatus("c-0001", "recording"); err != nil {
		t.Fatal(err)
	}
	return host
}

// checkRecording runs one recording check of the chapter to its end.
func checkRecording(t *testing.T, host *Host) {
	t.Helper()
	if started := decodeAnswer(t)(host.CoverageStart("c-0001")); started["status"] != "started" {
		t.Fatalf("start = %v", started)
	}
	host.services().coverage.Wait()
}

// stageChapters decodes a StageRecommendations answer.
func stageChapters(t *testing.T, host *Host) []map[string]any {
	t.Helper()
	answer := decodeAnswer(t)(host.StageRecommendations())
	raw, _ := answer["chapters"].([]any)
	chapters := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		chapters = append(chapters, item.(map[string]any))
	}
	if len(chapters) != 1 {
		t.Fatalf("answer = %v", answer)
	}
	return chapters
}

// pinStages pins a stage answer. The basis key and the fingerprint hash the ledger record ids and the saved items, which
// differ on every run, so they are fixed here like the coverage run ids; Stabilize fixes the times and record ids.
func pinStages(t *testing.T, name string, value any) {
	t.Helper()
	stable, err := contractfile.Stabilize(value)
	if err != nil {
		t.Fatal(err)
	}
	fixStageHashes(stable)
	contractfile.Check(t, name, stable)
}

func fixStageHashes(value any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			if (key == "basisKey" || key == "fingerprint") && item != "" {
				typed[key] = "0000000000000000000000000000000000000000000000000000000000000000"[:len(item.(string))]
				continue
			}
			fixStageHashes(item)
		}
	case []any:
		for _, item := range typed {
			fixStageHashes(item)
		}
	}
}

func TestStageBindingsBeforeAProjectIsOpenFail(t *testing.T) {
	host := NewHost()

	if _, err := host.StageRecommendations(); err == nil {
		t.Fatal("recommendations with no project must fail")
	}
	if _, err := host.StageConfirm("c-0001", "editing", "key"); err == nil {
		t.Fatal("a confirm with no project must fail")
	}
	if _, err := host.StageRevert("c-0001"); err == nil {
		t.Fatal("a revert with no project must fail")
	}
}

func TestAChapterNeverCheckedIsUnknownAndCannotBeConfirmed(t *testing.T) {
	host := stagesHost(t, 10)

	chapter := stageChapters(t, host)[0]
	refused := decodeAnswer(t)(host.StageConfirm("c-0001", "editing", chapter["basisKey"].(string)))

	if chapter["verdict"] != "unknown" || chapter["from"] != "recording" || chapter["target"] != "editing" {
		t.Fatalf("chapter = %v", chapter)
	}
	if causes := chapter["causes"].([]any); len(causes) != 1 || causes[0] != string(stages.CauseNeverAnalyzed) {
		t.Fatalf("causes = %v", causes)
	}
	if refused["status"] != "refused" || refused["reason"] != "not_recommended" || refused["message"] == "" {
		t.Fatalf("confirm = %v", refused)
	}
	pinStages(t, "stages-recommendations-unknown", decodeAnswer(t)(host.StageRecommendations()))
	pinStages(t, "stages-decision-refused", refused)
}

// TestAChapterInProofingIsJudgedByThePickupsRollUp is proofing-readiness-signals.prd.md Phase 1 through the host: the
// proofing provider is registered, a chapter in proofing is judged by proofing.pickups against finalized, and an open
// take review pickup for the chapter makes it not ready, listed by its finding id.
func TestAChapterInProofingIsJudgedByThePickupsRollUp(t *testing.T) {
	host := stagesHost(t, 10)
	if _, err := host.ManuscriptSetChapterStatus("c-0001", "proofing"); err != nil {
		t.Fatal(err)
	}
	chapter := stageChapters(t, host)[0]
	if chapter["from"] != "proofing" || chapter["target"] != "finalized" || chapter["verdict"] != "unknown" {
		t.Fatalf("chapter = %v", chapter)
	}
	signal := signalByID(t, chapter, proofing.PickupsSignalID)
	if signal["cause"] != string(stages.CauseNeverAnalyzed) {
		t.Fatalf("signal = %v", signal)
	}

	start, end := 1.0, 2.0
	pickup := findings.Finding{
		SchemaVersion: findings.SchemaVersion, ID: "pickup-1", Analyzer: proofing.AnalyzerTakeReview, Category: findings.CategoryPickup,
		Severity: findings.SeverityWarning, Source: findings.Source{File: "chapter-one.wav"},
		TimeRange:        &findings.TimeRange{Start: 1, End: 2, SourceStart: &start, SourceEnd: &end},
		Manuscript:       &findings.Manuscript{ChapterID: "c-0001", Expected: "It was a bright cold day"},
		ConfidenceReason: "test", Review: findings.ReviewState{Status: findings.StatusUnreviewed},
	}
	if _, err := host.services().findings.SaveAnalyzerFindings(proofing.AnalyzerTakeReview, "c-0001", []findings.Finding{pickup}); err != nil {
		t.Fatal(err)
	}
	answer := decodeAnswer(t)(host.StageRecommendations())
	chapter = answer["chapters"].([]any)[0].(map[string]any)
	signal = signalByID(t, chapter, proofing.PickupsSignalID)
	if chapter["verdict"] != "not_ready" || signal["state"] != "not_met" {
		t.Fatalf("an open pickup must make the chapter not ready: %v", chapter)
	}
	listed := false
	for _, entry := range signal["evidence"].([]any) {
		listed = listed || entry.(map[string]any)["findingId"] == "pickup-1"
	}
	if !listed {
		t.Fatalf("the open pickup is not listed by its finding id: %v", signal["evidence"])
	}
	pinStages(t, "stages-recommendations-proofing", answer)
}

// signalByID is the chapter's signal with the given id.
func signalByID(t *testing.T, chapter map[string]any, id string) map[string]any {
	t.Helper()
	for _, raw := range chapter["signals"].([]any) {
		if signal := raw.(map[string]any); signal["id"] == id {
			return signal
		}
	}
	t.Fatalf("no signal %s in %v", id, chapter["signals"])
	return nil
}

// TestEveryProofingSignalHasASetting: each id the proofing provider declares is a StageRecommendations choice field
// whose repo default is required, so the Settings page offers it and requiredStageSignals reads it.
func TestEveryProofingSignalHasASetting(t *testing.T) {
	keys := map[string]bool{}
	for _, field := range fieldSchemas["StageRecommendations"] {
		keys[field.key] = true
	}
	store := settings.New(t.TempDir(), "")
	for _, id := range proofing.NewSignalProvider(proofing.Config{}).SignalIDs() {
		if !keys[id] {
			t.Errorf("%s has no StageRecommendations field", id)
		}
		if value, _ := store.Effective("StageRecommendations", id, ""); value != "required" {
			t.Errorf("%s defaults to %q, want required", id, value)
		}
	}
	if _, ok := numberSpecs["Proofing"]["render_length_tolerance_seconds"]; !ok {
		t.Error("the render length tolerance has no number range")
	}
}

func TestRenderLengthToleranceIsUnsetUntilANumberIsSaved(t *testing.T) {
	store := settings.New(t.TempDir(), "")
	tolerance := renderLengthTolerance(store)
	if got := tolerance(); got != nil {
		t.Fatalf("default tolerance = %v, want unset", *got)
	}
	number := func(v float64) *float64 { return &v }
	for text, want := range map[string]*float64{"1.5": number(1.5), "0": number(0), "-1": nil, "abc": nil, "NaN": nil} {
		if err := store.Save("Proofing", "global", map[string]*string{"render_length_tolerance_seconds": &text}); err != nil {
			t.Fatal(err)
		}
		got := tolerance()
		if (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Fatalf("tolerance(%q) = %v, want %v", text, got, want)
		}
	}
}

// TestProofingDeliveryChecksFollowTheProfile: with the default profile (ACX) the chapter's delivery checks are required
// and unknown until a render is chosen and measured; ignoring the pickups signal and every delivery check leaves no
// required signal, which never recommends.
func TestProofingDeliveryChecksFollowTheProfile(t *testing.T) {
	host := stagesHost(t, 10)
	if _, err := host.ManuscriptSetChapterStatus("c-0001", "proofing"); err != nil {
		t.Fatal(err)
	}
	chapter := stageChapters(t, host)[0]
	ids := []string{}
	for _, raw := range chapter["signals"].([]any) {
		signal := raw.(map[string]any)
		ids = append(ids, signal["id"].(string))
		if signal["id"] != proofing.PickupsSignalID && (signal["state"] != "unknown" || signal["cause"] != string(stages.CauseNeverAnalyzed)) {
			t.Fatalf("a delivery check with no render chosen: %v", signal)
		}
	}
	want := []string{"proofing.delivery.duration_seconds", "proofing.delivery.head_room_tone_seconds", "proofing.delivery.noise_floor_dbfs", "proofing.delivery.rms_dbfs",
		"proofing.delivery.sample_peak_dbfs", "proofing.delivery.sample_rate", "proofing.delivery.tail_room_tone_seconds", proofing.PickupsSignalID}
	if !slices.Equal(ids, want) {
		t.Fatalf("required proofing signals = %v, want ACX's measured WAV rules and pickups %v", ids, want)
	}

	ignored := "ignored"
	changes := map[string]*string{}
	for _, id := range proofing.NewSignalProvider(proofing.Config{}).SignalIDs() {
		changes[id] = &ignored
	}
	if err := host.services().settings.Save("StageRecommendations", "project", changes); err != nil {
		t.Fatal(err)
	}
	if chapter = stageChapters(t, host)[0]; chapter["verdict"] != "none" || chapter["noneReason"] != string(stages.NoneNoRequiredSignals) {
		t.Fatalf("with every proofing signal ignored: %v", chapter)
	}
}

func TestTheModelNotInstalledIsAnUnknownCauseOfItsOwn(t *testing.T) {
	host := coverageHost(t, coverageProject(t), false, fakeCoverageSidecar(10))
	if _, err := host.ManuscriptSetChapterStatus("c-0001", "recording"); err != nil {
		t.Fatal(err)
	}

	chapter := stageChapters(t, host)[0]

	signal := chapter["signals"].([]any)[0].(map[string]any)
	if signal["cause"] != string(stages.CauseMeasurementUnavailable) || !strings.Contains(signal["reason"].(string), "not installed") {
		t.Fatalf("signal = %v", signal)
	}
}

func TestConfirmRevertAndDismissThroughTheHost(t *testing.T) {
	host := stagesHost(t, 10)
	checkRecording(t, host)
	recommended := stageChapters(t, host)[0]
	if recommended["verdict"] != "recommended" || recommended["target"] != "editing" {
		t.Fatalf("a complete check with every word read recommends editing: %v", recommended)
	}
	pinStages(t, "stages-recommendations-recommended", decodeAnswer(t)(host.StageRecommendations()))
	key := recommended["basisKey"].(string)

	changed := decodeAnswer(t)(host.StageConfirm("c-0001", "editing", "not-the-key"))
	if changed["reason"] != "basis_changed" || decodeChapters(t, host)[0]["status"] != "recording" {
		t.Fatalf("a stale key is refused and changes nothing: %v", changed)
	}

	confirmed := decodeAnswer(t)(host.StageConfirm("c-0001", "editing", key))
	if confirmed["status"] != "ok" || decodeChapters(t, host)[0]["status"] != "editing" {
		t.Fatalf("confirm = %v", confirmed)
	}
	chapter := confirmed["chapter"].(map[string]any)
	if confirmation, _ := chapter["confirmation"].(map[string]any); confirmation["from"] != "recording" || confirmation["evidenceChanged"] != false {
		t.Fatalf("the confirmed chapter carries its live confirmation: %v", chapter)
	}
	// Editing now has three required signals of its own (ER Phase 6): empty-space has never been checked (no editing
	// scan has run in this fixture) and clicks/breaths can never be met at all while their detector stays
	// unvalidated (Phase 4 has not run) - so the chapter's own editing evaluation reads unknown, never recommended,
	// but for a different reason than before this phase landed (there is a required set now; it just cannot be met).
	if chapter["verdict"] != "unknown" {
		t.Fatalf("chapter = %v", chapter)
	}
	causes, _ := chapter["causes"].([]any)
	wantCauses := []string{string(stages.CauseMeasurementUnavailable), string(stages.CauseNeverAnalyzed)}
	gotCauses := make([]string, len(causes))
	for i, c := range causes {
		gotCauses[i] = c.(string)
	}
	slices.Sort(gotCauses)
	if !slices.Equal(gotCauses, wantCauses) {
		t.Fatalf("causes = %v, want %v", gotCauses, wantCauses)
	}
	pinStages(t, "stages-decision-confirmed", confirmed)

	reverted := decodeAnswer(t)(host.StageRevert("c-0001"))
	if reverted["status"] != "ok" || decodeChapters(t, host)[0]["status"] != "recording" {
		t.Fatalf("revert = %v", reverted)
	}
	if again := decodeAnswer(t)(host.StageRevert("c-0001")); again["reason"] != "nothing_to_revert" {
		t.Fatalf("a second revert = %v", again)
	}

	dismissed := decodeAnswer(t)(host.StageDismiss("c-0001", "editing", key))
	if dismissed["status"] != "ok" || dismissed["chapter"].(map[string]any)["verdict"] != "dismissed" {
		t.Fatalf("dismiss = %v", dismissed)
	}
	if decodeChapters(t, host)[0]["status"] != "recording" || stageChapters(t, host)[0]["verdict"] != "dismissed" {
		t.Fatal("a dismissal keeps the status and survives a re-read")
	}
	pinStages(t, "stages-recommendations-dismissed", decodeAnswer(t)(host.StageRecommendations()))
}

func TestAFreshShortReadAfterConfirmRaisesTheNotice(t *testing.T) {
	host := stagesHost(t, 10)
	checkRecording(t, host)
	key := stageChapters(t, host)[0]["basisKey"].(string)
	if confirmed := decodeAnswer(t)(host.StageConfirm("c-0001", "editing", key)); confirmed["status"] != "ok" {
		t.Fatalf("confirm = %v", confirmed)
	}

	// The chapter is checked again and half of it is missing now: the notice, and nothing changed on its own.
	host.coverageLauncher = fakeCoverageSidecar(5)
	next := host.config
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("re-attach failed: %s", reason)
	}
	checkRecording(t, host)
	chapter := stageChapters(t, host)[0]

	contradiction, _ := chapter["contradiction"].(map[string]any)
	if contradiction == nil || contradiction["revertTo"] != "recording" || len(contradiction["signals"].([]any)) != 1 {
		t.Fatalf("chapter = %v", chapter)
	}
	if chapter["confirmation"].(map[string]any)["evidenceChanged"] != true || decodeChapters(t, host)[0]["status"] != "editing" {
		t.Fatalf("the status stays until the narrator reverts: %v", chapter)
	}
	pinStages(t, "stages-recommendations-contradiction", decodeAnswer(t)(host.StageRecommendations()))
}

func TestAProjectSwitchRebuildsTheStagesService(t *testing.T) {
	host := stagesHost(t, 10)
	before := host.services().stages
	next := host.config
	next.projectFolder = coverageProject(t)
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}

	if after := host.services().stages; after == nil || after == before {
		t.Fatal("the stages service belongs to one project and is rebuilt on a switch")
	}
	if chapter := stageChapters(t, host)[0]; chapter["from"] != "not_started" || chapter["verdict"] != "none" {
		t.Fatalf("the new project's chapter = %v", chapter)
	}
}

func TestStageRecommendationsNeverStartsACheckOrWritesAFile(t *testing.T) {
	launched := false
	project := coverageProject(t)
	host := coverageHost(t, project, true, func(context.Context, string, ...string) (coverage.Child, error) {
		launched = true
		return nil, os.ErrInvalid
	})
	if _, err := host.ManuscriptSetChapterStatus("c-0001", "recording"); err != nil {
		t.Fatal(err)
	}
	before := stageFiles(t, project)

	for range 2 {
		stageChapters(t, host)
	}

	if launched || !maps.Equal(before, stageFiles(t, project)) {
		t.Fatalf("a read launched %v or changed the project files: before %v, after %v", launched, before, stageFiles(t, project))
	}
}

// Every reason a decision can be refused with, pinned so the UI's schema lists the same words (ADR 0069).
func TestContractStageRefusalReasons(t *testing.T) {
	reasons := make([]string, 0, len(stageRefusals))
	for _, reason := range stageRefusals {
		reasons = append(reasons, string(reason))
	}
	slices.Sort(reasons)
	contractfile.Check(t, "stages-refusal-reasons", reasons)
}

// stageFiles lists every file under the project with its modified time and size, to prove a read writes nothing.
func stageFiles(t *testing.T, project string) map[string]int64 {
	t.Helper()
	files := map[string]int64{}
	err := filepath.Walk(project, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		files[path] = info.ModTime().UnixNano() ^ info.Size()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}
