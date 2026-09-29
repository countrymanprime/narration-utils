package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// Apply FX to a passage (edit-and-proof-workspace.prd.md Phase 9, ADR 0234, ADR 0705): the page sends a chapter id, a
// token range and a plug-in name (or a chain name), never a GUID or a time; the host resolves the range to one
// bridge.Passage and asks the DAW port's FXManager role. Unit coverage over a hand-built AlignmentView and a stub role.

type stubFXRole struct {
	passage   bridge.Passage
	plugin    string
	track     string
	chain     string
	addErr    error
	applyErr  error
	addCalls  int
	applyCall int
}

func (s *stubFXRole) ListFXChains(context.Context) (dawport.FXChains, error) {
	return dawport.FXChains{}, nil
}
func (s *stubFXRole) ListFX(context.Context) (dawport.FXPlugins, error) {
	return dawport.FXPlugins{Names: []string{"ReaEQ (Cockos)"}}, nil
}
func (s *stubFXRole) ApplyFXChain(_ context.Context, track, chain string) (dawport.FXChainApplied, error) {
	s.applyCall++
	s.track, s.chain = track, chain
	return dawport.FXChainApplied{Chain: chain, Track: track, Added: 2}, s.applyErr
}
func (s *stubFXRole) AddTakeFX(_ context.Context, passage dawport.Passage, plugin string) (dawport.TakeFXAdded, error) {
	s.addCalls++
	s.passage, s.plugin = passage, plugin
	return dawport.TakeFXAdded{Plugin: plugin, ItemGUID: "{NEW-ITEM}", TakeGUID: "{NEW-TAKE}", Splits: 2}, s.addErr
}

func fxView() coverage.AlignmentView {
	return coverage.AlignmentView{
		Tokens: []coverage.TokenLine{heardToken(0, 0, 1, 1.5), heardToken(1, 0, 1.5, 2), heardToken(2, 1, 5, 5.5), unheardToken(3)},
		Items: []coverage.AlignmentItem{
			{Index: 0, ItemGUID: "{ITEM-1}", Live: true, TakeGUID: "{TAKE-1}"},
			{Index: 1, ItemGUID: "{ITEM-2}", Live: false, TakeGUID: "{TAKE-2}"},
		},
	}
}

func TestResolveWorkspacePassageJoinsTheRangeToOneItemsSourceTimes(t *testing.T) {
	passage, refusal := resolveWorkspacePassage(fxView(), 0, 1)
	if refusal != nil {
		t.Fatalf("refusal = %+v", refusal)
	}
	want := bridge.Passage{ItemGUID: "{ITEM-1}", TakeGUID: "{TAKE-1}", SourceStart: 1, SourceEnd: 2}
	if passage != want {
		t.Fatalf("passage = %+v, want %+v", passage, want)
	}
}

func TestResolveWorkspacePassageRefusals(t *testing.T) {
	cases := []struct {
		name        string
		first, last int
		reason      string
	}{
		{"crosses two items", 1, 2, "crosses_items"},
		{"a word nothing was heard for", 3, 3, refusedNoItem},
		{"an item no longer in the project", 2, 2, refusedStale},
		{"a range read backwards", 1, 0, "bad_range"},
		{"outside the alignment", 0, 9, "bad_range"},
		{"negative", -1, 0, "bad_range"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, refusal := resolveWorkspacePassage(fxView(), tc.first, tc.last)
			if refusal == nil || refusal.Outcome != "refused" || refusal.Reason != tc.reason || refusal.Message == "" {
				t.Fatalf("refusal = %+v, want reason %q with a message", refusal, tc.reason)
			}
		})
	}
}

func TestAddTakeFXSendsTheResolvedPassageAndAnswersTheNewPiece(t *testing.T) {
	role := &stubFXRole{}
	passage, _ := resolveWorkspacePassage(fxView(), 0, 1)
	result := addTakeFXVia(context.Background(), role, passage, "ReaEQ (Cockos)")
	if result.Outcome != "added" || result.Plugin != "ReaEQ (Cockos)" || result.ItemGUID != "{NEW-ITEM}" || result.TakeGUID != "{NEW-TAKE}" || result.Splits != 2 {
		t.Fatalf("result = %+v", result)
	}
	if role.passage != passage || role.plugin != "ReaEQ (Cockos)" {
		t.Fatalf("role saw %+v / %q", role.passage, role.plugin)
	}
}

func TestAddTakeFXRefusesWithWordsForWhatREAPERAndTheBridgeSay(t *testing.T) {
	passage := bridge.Passage{ItemGUID: "{I}", TakeGUID: "{T}", SourceStart: 1, SourceEnd: 2}
	cases := []struct {
		name   string
		err    error
		reason string
		text   string
	}{
		{"recording", bridge.ErrRecording, refusedRecording, "recording"},
		{"stale", &bridge.StaleError{GUID: "{I}", Reason: "item"}, refusedStale, "no longer"},
		{"a chain file as a plug-in", bridge.ErrBadPluginName, "bad_name", "FX chains go on a track"},
		{"not connected", bridge.ErrUnavailable, reaperStandalone, ""},
		{"an old script", bridge.ErrScriptOutdated, refusedScriptOutdated, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := addTakeFXVia(context.Background(), &stubFXRole{addErr: tc.err}, passage, "X")
			if result.Outcome != "refused" || result.Reason != tc.reason || result.Message == "" || !strings.Contains(result.Message, tc.text) {
				t.Fatalf("result = %+v", result)
			}
		})
	}
}

func TestApplyFXChainSendsTheTrackAndChainAndRefusesABadName(t *testing.T) {
	role := &stubFXRole{}
	result := applyFXChainVia(context.Background(), role, "{TRACK-1}", "Podcast Voice.RfxChain")
	if result.Outcome != "applied" || result.Chain != "Podcast Voice.RfxChain" || result.Track != "{TRACK-1}" || result.Added != 2 {
		t.Fatalf("result = %+v", result)
	}
	if role.track != "{TRACK-1}" || role.chain != "Podcast Voice.RfxChain" {
		t.Fatalf("role saw %q / %q", role.track, role.chain)
	}
	refused := applyFXChainVia(context.Background(), &stubFXRole{applyErr: bridge.ErrBadChainName}, "{TRACK-1}", "../x.RfxChain")
	if refused.Outcome != "refused" || refused.Reason != "bad_name" {
		t.Fatalf("refused = %+v", refused)
	}
	gone := applyFXChainVia(context.Background(), &stubFXRole{applyErr: &bridge.TrackStaleError{GUID: "{TRACK-1}"}}, "{TRACK-1}", "a.RfxChain")
	if gone.Outcome != "refused" || gone.Reason != refusedStale {
		t.Fatalf("gone = %+v", gone)
	}
}

func TestWorkspaceFXBindingsErrorUnavailableWithNoResolver(t *testing.T) {
	if _, err := workspaceListFXIn(context.Background(), hostServices{}); !errors.Is(err, bridge.ErrUnavailable) {
		t.Fatalf("error = %v, want bridge.ErrUnavailable", err)
	}
}

func TestWorkspaceListFXGoesThroughTheResolvedRoleAndNeverReturnsANilList(t *testing.T) {
	resolver, fake := fakeResolver(dawport.Supported)
	answer, err := workspaceListFXIn(context.Background(), hostServices{dawPortResolver: resolver})
	if err != nil {
		t.Fatal(err)
	}
	if answer.Names == nil || len(answer.Names) != 0 {
		t.Fatalf("answer = %+v", answer)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "fx_chains.ListFX" {
		t.Fatalf("calls = %v", calls)
	}
}

func TestWorkspaceFXWithNoRoleIsRefusedNotAnError(t *testing.T) {
	result := workspaceFXNoRole()
	if result.Outcome != "refused" || result.Reason != reaperStandalone {
		t.Fatalf("result = %+v", result)
	}
}

// The wire contract (CLAUDE.md): read by apps/ui/src/api/wireContracts.test.ts against its Zod schemas.
func TestWorkspaceListFXContract(t *testing.T) {
	contractfile.Check(t, "workspace-fx-plugins", workspaceFXAnswer{Names: []string{"ReaComp (Cockos)", "ReaEQ (Cockos)"}, Truncated: false})
}

func TestWorkspaceFXResultContracts(t *testing.T) {
	contractfile.Check(t, "workspace-fx-added", WorkspaceFXResult{Outcome: "added", Plugin: "ReaEQ (Cockos)", ItemGUID: "{NEW-ITEM}", TakeGUID: "{NEW-TAKE}", Splits: 2})
	contractfile.Check(t, "workspace-fx-applied", WorkspaceFXResult{Outcome: "applied", Chain: "Podcast Voice.RfxChain", Track: "{TRACK-1}", Added: 2})
	contractfile.Check(t, "workspace-fx-refused", WorkspaceFXResult{Outcome: "refused", Reason: "crosses_items", Message: "This passage crosses two REAPER items. Select words from one item at a time."})
}

func TestWorkspaceAddTakeFXAndApplyFXChainWithNoProjectAreErrors(t *testing.T) {
	host := &Host{}
	if _, err := host.WorkspaceAddTakeFX("c", 0, 0, "X"); !errors.Is(err, errNoProject) {
		t.Fatalf("add error = %v", err)
	}
	if _, err := host.WorkspaceApplyFXChain("c", "a.RfxChain"); !errors.Is(err, errNoProject) {
		t.Fatalf("apply error = %v", err)
	}
}
