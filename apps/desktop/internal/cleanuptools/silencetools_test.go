package cleanuptools

import (
	"context"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/dawporttest"
)

// fakeRoles is a fake REAPER adapter declaring every capability Experimental, so its SilenceTrimmer and
// GainAdjuster roles (built but never wired before DAW port PRD Phase 5b) are available to type-assert, the
// same way the composition root gets them from the real adapter (apps/desktop/app.go).
func fakeRoles(t *testing.T) (*dawporttest.Fake, dawport.SilenceTrimmer, dawport.GainAdjuster) {
	t.Helper()
	fake := dawporttest.NewFake(dawport.KindREAPER, dawporttest.Levels(dawport.Experimental))
	trimmer, ok := fake.Role(dawport.CapSilenceTrim).(dawport.SilenceTrimmer)
	if !ok {
		t.Fatal("the fake adapter did not return a SilenceTrimmer role")
	}
	adjuster, ok := fake.Role(dawport.CapItemGain).(dawport.GainAdjuster)
	if !ok {
		t.Fatal("the fake adapter did not return a GainAdjuster role")
	}
	return fake, trimmer, adjuster
}

func TestPreviewSilenceTrimDelegatesToTheRole(t *testing.T) {
	fake, trimmer, _ := fakeRoles(t)
	service := New(Config{SessionDir: t.TempDir()}, nil, trimmer, nil, nil)
	candidates := []dawport.CleanupCandidate{{ItemGUID: "{GUID-A}", CutStartSeconds: 1, CutEndSeconds: 2}}
	if _, err := service.PreviewSilenceTrim(context.Background(), candidates); err != nil {
		t.Fatal(err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "silence_trim.Preview" {
		t.Fatalf("calls = %v", calls)
	}
}

func TestApplySilenceTrimDelegatesToTheRole(t *testing.T) {
	fake, trimmer, _ := fakeRoles(t)
	service := New(Config{SessionDir: t.TempDir()}, nil, trimmer, nil, nil)
	candidates := []dawport.CleanupCandidate{{ItemGUID: "{GUID-A}", CutStartSeconds: 1, CutEndSeconds: 2}}
	if _, err := service.ApplySilenceTrim(context.Background(), candidates); err != nil {
		t.Fatal(err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "silence_trim.Apply" {
		t.Fatalf("calls = %v", calls)
	}
}

func TestApplyGainDelegatesToTheRole(t *testing.T) {
	fake, _, adjuster := fakeRoles(t)
	service := New(Config{SessionDir: t.TempDir()}, nil, nil, adjuster, nil)
	candidates := []dawport.GainCandidate{{ItemGUID: "{GUID-A}"}}
	if _, err := service.ApplyGain(context.Background(), candidates); err != nil {
		t.Fatal(err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "item_gain.Apply" {
		t.Fatalf("calls = %v", calls)
	}
}

func TestPreviewSilenceTrimWithoutARoleFails(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil, nil, nil)
	if _, err := service.PreviewSilenceTrim(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestApplySilenceTrimWithoutARoleFails(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil, nil, nil)
	if _, err := service.ApplySilenceTrim(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestApplyGainWithoutARoleFails(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil, nil, nil)
	if _, err := service.ApplyGain(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}
