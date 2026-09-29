package main

import (
	"strings"
	"testing"
)

// The Takes panel's bindings (edit-and-proof-workspace.prd.md Phase 6, ADR 0700). What they answer is
// internal/passagetakes' own (its tests pin the candidates, the choices and the outcomes, and write the goldens the UI
// checks); these cover the host's wiring: no project, a token range the alignment does not have, and a read of a
// chapter whose item has only one take.

func TestWorkspaceTakesBindingsWithNoProjectAreAnError(t *testing.T) {
	host := NewHost()
	if _, err := host.WorkspaceTakes("c-0001", 0, 0); err == nil {
		t.Error("WorkspaceTakes: no error")
	}
	if _, err := host.WorkspaceTakesCompareStart("c-0001", 0, 0); err == nil {
		t.Error("WorkspaceTakesCompareStart: no error")
	}
	if _, err := host.WorkspaceUseTake("c-0001", 0, 0, "take:x:y"); err == nil {
		t.Error("WorkspaceUseTake: no error")
	}
}

func TestWorkspaceTakesOfAOneTakeItemOffersNoAlternates(t *testing.T) {
	host := coverageHost(t, coverageProject(t), true, fakeAlignedCoverageSidecarWithSkip())
	if _, err := host.CoverageStart("c-0001", nil); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	answer := decodeAnswer(t)(host.WorkspaceTakes("c-0001", 0, 0))

	if answer["itemGuid"] != "{ITEM-1}" || answer["passageId"] == "" {
		t.Fatalf("answer = %v", answer)
	}
	if candidates, _ := answer["candidates"].([]any); len(candidates) != 0 {
		t.Fatalf("candidates = %v", candidates)
	}
}

func TestWorkspaceTakesOutsideTheAlignmentIsTheCallersError(t *testing.T) {
	host := coverageHost(t, coverageProject(t), true, fakeAlignedCoverageSidecarWithSkip())
	if _, err := host.CoverageStart("c-0001", nil); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	if _, err := host.WorkspaceTakes("c-0001", 0, 9); err == nil || !strings.Contains(err.Error(), "not in this chapter's alignment") {
		t.Fatalf("got %v", err)
	}
}

func TestWorkspaceUseTakeRefusesATakeItDidNotOffer(t *testing.T) {
	host := coverageHost(t, coverageProject(t), true, fakeAlignedCoverageSidecarWithSkip())
	if _, err := host.CoverageStart("c-0001", nil); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	answer := decodeAnswer(t)(host.WorkspaceUseTake("c-0001", 0, 0, "take:{NOT-OFFERED}:{TAKE}"))

	if answer["outcome"] != "refused" || answer["reason"] != "not_offered" || answer["changed"] != false {
		t.Fatalf("answer = %v", answer)
	}
}
