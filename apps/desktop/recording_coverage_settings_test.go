package main

import (
	"context"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
)

// The recording check's four settings (docs/utilities/recording-coverage.md Q3, ADR 0131) are exactly the keys
// coverage.ResolveSettings reads: a field it did not read would change nothing.
func TestTheRecordingCoverageFieldsAreTheCoverageSettings(t *testing.T) {
	var fields []string
	for _, schema := range fieldSchemas[coverage.SettingsTool] {
		if schema.kind != "number" {
			t.Errorf("%s is %q, want a number", schema.key, schema.kind)
		}
		fields = append(fields, schema.key)
	}
	keys := []string{coverage.SettingMinParagraphPresent, coverage.SettingMaxMissingRun, coverage.SettingMaxMisreadRun, coverage.SettingMinAnchorRun}
	sort.Strings(fields)
	sort.Strings(keys)
	if strings.Join(fields, ",") != strings.Join(keys, ",") {
		t.Fatalf("%s fields = %v, want %v", coverage.SettingsTool, fields, keys)
	}
}

// With nothing set, the effective settings are the shipped defaults (ADR 0132: 0.8, 3, 8, 3), and every
// default passes its own field's range.
func TestTheRecordingCoverageDefaultsAreTheShippedValues(t *testing.T) {
	host := newTestHostForDeliverySettings(t, t.TempDir())
	if got := coverageSettings(host.settings); got != coverage.DefaultSettings {
		t.Fatalf("coverageSettings = %+v, want %+v", got, coverage.DefaultSettings)
	}
	for key, value := range effectiveValues(host, coverage.SettingsTool) {
		if err := validateNumberSetting(key, numberSpecs[coverage.SettingsTool][key], value); err != nil {
			t.Errorf("the default %s = %q fails its own range: %v", key, value, err)
		}
	}
}

func TestARecordingCoverageSettingOutsideItsRangeIsRefused(t *testing.T) {
	host := newTestHostForDeliverySettings(t, t.TempDir())
	for key, value := range map[string]string{
		coverage.SettingMinParagraphPresent: "1.5",
		coverage.SettingMaxMissingRun:       "2.5",
		coverage.SettingMaxMisreadRun:       "-1",
		coverage.SettingMinAnchorRun:        "0",
	} {
		if err := host.saveSettings(coverage.SettingsTool, "global", map[string]*string{key: ptr(value)}); err == nil {
			t.Errorf("%s = %q was saved", key, value)
		}
	}
	if err := host.saveSettings(coverage.SettingsTool, "project", map[string]*string{coverage.SettingMinParagraphPresent: ptr("0.9")}); err != nil {
		t.Fatal(err)
	}
	if got := coverageSettings(host.settings).Thresholds.MinParagraphPresent; got != 0.9 {
		t.Fatalf("min_paragraph_present = %v, want the project's 0.9", got)
	}
}

// Phase 5 started and read every check with the default alignment; now both take it from the settings, so they cannot
// disagree, and changing it makes the stored result stale (Q13 B) rather than silently re-judged.
func TestAChecksStartAndItsReadBothUseTheAlignmentSettings(t *testing.T) {
	var mu sync.Mutex
	var launches [][]string
	fake := fakeCoverageSidecar(10)
	recording := func(ctx context.Context, program string, args ...string) (coverage.Child, error) {
		mu.Lock()
		launches = append(launches, args)
		mu.Unlock()
		return fake(ctx, program, args...)
	}
	host := coverageHost(t, coverageProject(t), true, recording)
	if err := host.saveSettings(coverage.SettingsTool, "project", map[string]*string{coverage.SettingMinAnchorRun: ptr("5"), coverage.SettingMaxMisreadRun: ptr("6")}); err != nil {
		t.Fatal(err)
	}

	if started := decodeAnswer(t)(host.CoverageStart("c-0001")); started["status"] != "started" {
		t.Fatalf("answer = %v", started)
	}
	host.services().coverage.Wait()

	mu.Lock()
	args := launches[0]
	mu.Unlock()
	if !hasFlag(args, "--min-anchor-run", "5") || !hasFlag(args, "--max-misread-run", "6") {
		t.Fatalf("the check was not started with the settings' alignment: %v", args)
	}
	if result := decodeAnswer(t)(host.CoverageResult("c-0001")); result["state"] != "current" || result["recordedFraction"] != 1.0 {
		t.Fatalf("the read must use the same alignment as the start: %v", result)
	}

	if err := host.saveSettings(coverage.SettingsTool, "project", map[string]*string{coverage.SettingMinAnchorRun: ptr("4")}); err != nil {
		t.Fatal(err)
	}
	result := decodeAnswer(t)(host.CoverageResult("c-0001"))
	reasons, _ := result["reasons"].([]any)
	if result["state"] != "stale" || !slices.Contains(reasons, any("params_changed")) {
		t.Fatalf("a changed alignment must make the result stale: %v", result)
	}
	if _, measured := decodeChapters(t, host)[0]["recordedFraction"]; measured {
		t.Fatal("a stale result must not fill recordedFraction")
	}

	// A threshold is judged on read: changing one leaves the result current.
	if err := host.saveSettings(coverage.SettingsTool, "project", map[string]*string{coverage.SettingMinAnchorRun: ptr("5"), coverage.SettingMaxMissingRun: ptr("10")}); err != nil {
		t.Fatal(err)
	}
	if result := decodeAnswer(t)(host.CoverageResult("c-0001")); result["state"] != "current" {
		t.Fatalf("a threshold change must not make the result stale: %v", result)
	}
}

func hasFlag(args []string, flag, value string) bool {
	index := slices.Index(args, flag)
	return index >= 0 && index+1 < len(args) && args[index+1] == value
}
