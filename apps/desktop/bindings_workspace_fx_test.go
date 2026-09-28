package main

import (
	"context"
	"errors"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// WorkspaceListFXChains (edit-and-proof-workspace.prd.md Phase 8, ADR 0234): a read-only list of the narrator's FX
// chains, over the DAW port's FXManager role, exactly as silenceTrimmerFrom/CleanupPreview are tested
// (bindings_cleanup_test.go) - fakeResolver is defined there and reused here.

func TestFxManagerFromComesFromTheResolver(t *testing.T) {
	resolver, fake := fakeResolver(dawport.Supported)
	role := fxManagerFrom(hostServices{dawPortResolver: resolver})
	if role == nil {
		t.Fatal("no role from a resolver with a live adapter")
	}
	if _, err := role.ListFXChains(context.Background()); err != nil {
		t.Fatalf("ListFXChains: %v", err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "fx_chains.ListFXChains" {
		t.Fatalf("the role did not come from the resolver: calls = %v", calls)
	}
}

func TestFxManagerFromIsNilWithoutAResolver(t *testing.T) {
	if role := fxManagerFrom(hostServices{}); role != nil {
		t.Fatalf("role = %v, want nil with no resolver", role)
	}
}

func TestWorkspaceListFXChainsErrorsUnavailableWithNoResolver(t *testing.T) {
	if _, err := workspaceListFXChainsIn(context.Background(), hostServices{}); !errors.Is(err, bridge.ErrUnavailable) {
		t.Fatalf("error = %v, want bridge.ErrUnavailable", err)
	}
}

func TestWorkspaceListFXChainsGoesThroughTheResolvedRoleAndNeverReturnsANilNamesList(t *testing.T) {
	resolver, fake := fakeResolver(dawport.Supported)
	svc := hostServices{dawPortResolver: resolver}

	answer, err := workspaceListFXChainsIn(context.Background(), svc)
	if err != nil {
		t.Fatal(err)
	}
	if answer.Names == nil || len(answer.Names) != 0 || answer.Truncated {
		t.Fatalf("answer = %+v, want an empty (never nil) names list from the fake's zero-value answer", answer)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "fx_chains.ListFXChains" {
		t.Fatalf("calls = %v, want ListFXChains through the resolved role", calls)
	}
}

// The wire contract (CLAUDE.md): the answer shape WorkspaceListFXChains sends, read by
// apps/ui/src/api/wireContracts.test.ts against its Zod schema.
func TestWorkspaceListFXChainsContract(t *testing.T) {
	contractfile.Check(t, "workspace-fx-chains", workspaceFXChainsAnswer{
		Names:     []string{"Podcast Voice.RfxChain", "Vocal Chain/Warmth.RfxChain"},
		Truncated: false,
	})
}
