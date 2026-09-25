package bridge

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestTheWorkspaceAndRegionCommandsAreExperimentalAndRefusedWhileTheSettingIsOff(t *testing.T) {
	actions, client, dir := newActionsSession(t, false)
	fake := startFakeReaper(t, client, dir, func([]string) [][]string { return nil })
	ctx := context.Background()
	if _, err := actions.SetActiveTake(ctx, testItem, testTake); !errors.Is(err, ErrExperimentalOff) {
		t.Errorf("SetActiveTake: %v", err)
	}
	if _, err := actions.ListFXChains(ctx); !errors.Is(err, ErrExperimentalOff) {
		t.Errorf("ListFXChains: %v", err)
	}
	if _, err := actions.ApplyFXChain(ctx, Passage{ItemGUID: testItem, TakeGUID: testTake, SourceStart: 1, SourceEnd: 2}, "A.RfxChain"); !errors.Is(err, ErrExperimentalOff) {
		t.Errorf("ApplyFXChain: %v", err)
	}
	if _, err := actions.CreateRegions(ctx, []Region{{Start: 0, End: 30, Title: "Chapter 1"}}, "", false); !errors.Is(err, ErrExperimentalOff) {
		t.Errorf("CreateRegions: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if len(fake.commands()) != 0 {
		t.Fatalf("commands were written: %v", fake.commands())
	}
	for _, command := range []string{"set_active_take", "list_fx_chains", "apply_fx_chain", "create_regions"} {
		if !Experimental(command) {
			t.Errorf("%s must stay experimental until the verification pass", command)
		}
	}
}

func TestSetActiveTakeSendsTheItemAndTakeAndSaysWhetherItChanged(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ACTIVE_TAKE_SET", run(command), testItem, testTake, "1"}}
	})
	got, err := actions.SetActiveTake(context.Background(), testItem, testTake)
	if err != nil || got != (ActiveTakeSet{ItemGUID: testItem, TakeGUID: testTake, Changed: true}) {
		t.Fatalf("got %+v, %v", got, err)
	}
	if command := fake.commands()[0]; command[1] != "set_active_take" || command[3] != testItem || command[4] != testTake {
		t.Fatalf("command = %v", command)
	}
}

func TestSetActiveTakeReportsAStaleItemOrTakeAndRefusesAnswersForOthers(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	var answer func([]string) [][]string
	startFakeReaper(t, client, dir, func(command []string) [][]string { return answer(command) })
	answer = func(command []string) [][]string { return [][]string{{"ITEM_STALE", run(command), testTake, "take"}} }
	_, err := actions.SetActiveTake(context.Background(), testItem, testTake)
	var stale *StaleError
	if !errors.As(err, &stale) || stale.Reason != "take" || !errors.Is(err, ErrStale) {
		t.Fatalf("err = %v, want a take StaleError", err)
	}
	answer = func(command []string) [][]string {
		return [][]string{{"ACTIVE_TAKE_SET", run(command), testItem, "{00000009-0000-4000-8000-000000000009}", "1"}}
	}
	if _, err := actions.SetActiveTake(context.Background(), testItem, testTake); err == nil {
		t.Fatal("an answer for another take must be an error")
	}
	if _, err := actions.SetActiveTake(context.Background(), "", testTake); !errors.Is(err, ErrNoItemIdentity) {
		t.Fatalf("err = %v, want ErrNoItemIdentity before anything is sent", err)
	}
}

func TestListFXChainsReadsTheNamesAndWhetherTheListWasCut(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{
			{"FX_CHAIN", run(command), "Breath.rfxchain"},
			{"FX_CHAIN", run(command), "Voice/Test EQ.RfxChain"},
			{"FX_CHAINS_LISTED", run(command), "2", "1"},
		}
	})
	got, err := actions.ListFXChains(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := FXChains{Names: []string{"Breath.rfxchain", "Voice/Test EQ.RfxChain"}, Truncated: true}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestApplyFXChainSendsThePassageAndReadsWhatChanged(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"FX_CHAIN_APPLIED", run(command), command[7], "{BBBBBBBB-0000-4000-8000-000000000002}", "{BBBBBBBB-0000-4000-8000-0000000000B2}", "2", "1"}}
	})
	got, err := actions.ApplyFXChain(context.Background(), Passage{ItemGUID: testItem, TakeGUID: testTake, SourceStart: 3, SourceEnd: 4.25}, "Voice/Test EQ.RfxChain")
	if err != nil {
		t.Fatal(err)
	}
	want := FXChainApplied{Chain: "Voice/Test EQ.RfxChain", ItemGUID: "{BBBBBBBB-0000-4000-8000-000000000002}", TakeGUID: "{BBBBBBBB-0000-4000-8000-0000000000B2}", Splits: 2, Added: 1}
	if got != want {
		t.Fatalf("got %+v", got)
	}
	command := fake.commands()[0]
	if !reflect.DeepEqual(command[1:], []string{"apply_fx_chain", run(command), testItem, testTake, "3.000000", "4.250000", "Voice/Test EQ.RfxChain"}) {
		t.Fatalf("command = %v", command)
	}
}

func TestApplyFXChainRefusesBeforeSendingWhatREAPERWouldRefuse(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func([]string) [][]string { return nil })
	ok := Passage{ItemGUID: testItem, TakeGUID: testTake, SourceStart: 1, SourceEnd: 2}
	for _, c := range []struct {
		passage Passage
		chain   string
	}{
		{Passage{TakeGUID: testTake, SourceStart: 1, SourceEnd: 2}, "A.RfxChain"},
		{Passage{ItemGUID: testItem, SourceStart: 1, SourceEnd: 2}, "A.RfxChain"},
		{Passage{ItemGUID: testItem, TakeGUID: testTake, SourceStart: 2, SourceEnd: 2}, "A.RfxChain"},
		{ok, "../reaper.ini"},
		{ok, `C:\x.RfxChain`},
		{ok, "/abs/x.RfxChain"},
		{ok, "Voice/../A.RfxChain"},
		{ok, "A.txt"},
		{ok, ""},
	} {
		if _, err := actions.ApplyFXChain(context.Background(), c.passage, c.chain); err == nil {
			t.Errorf("%+v %q was accepted", c.passage, c.chain)
		}
	}
	time.Sleep(20 * time.Millisecond)
	if len(fake.commands()) != 0 {
		t.Fatalf("a refused request wrote a command: %v", fake.commands())
	}
}

func TestApplyFXChainPassesREAPERsRefusalOn(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ERROR", run(command), "REAPER did not load the FX chain. The item was split: press Undo in REAPER to rejoin it."}}
	})
	_, err := actions.ApplyFXChain(context.Background(), Passage{ItemGUID: testItem, TakeGUID: testTake, SourceStart: 1, SourceEnd: 2}, "A.RfxChain")
	if err == nil || !strings.Contains(err.Error(), "press Undo") {
		t.Fatalf("err = %v", err)
	}
}

func TestCreateRegionsWritesThePayloadAndReadsTheCounts(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	var payload string
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		content, err := os.ReadFile(command[3])
		if err != nil {
			t.Errorf("the payload file is not there: %v", err)
		}
		payload = string(content)
		return [][]string{{"REGIONS_CREATED", run(command), "2", "1", "0", "1", "0", "0"}}
	})
	rows := []Region{{Start: 0, End: 12, Title: "Opening Credits"}, {Start: 12, End: 600.5, Title: "Chapter 1 — The Start | Part"}, {Start: 600.5, End: 615, Title: "Closing Credits"}}
	got, err := actions.CreateRegions(context.Background(), rows, "FF8800", true)
	if err != nil {
		t.Fatal(err)
	}
	if got != (RegionsCreated{Created: 2, Existing: 1, Updated: 1}) {
		t.Fatalf("got %+v", got)
	}
	want := "0.000000|12.000000|Opening Credits\n12.000000|600.500000|Chapter 1 — The Start | Part\n600.500000|615.000000|Closing Credits\n"
	if payload != want {
		t.Fatalf("payload = %q\nwant      %q", payload, want)
	}
	command := fake.commands()[0]
	if command[1] != "create_regions" || command[4] != "FF8800" || command[5] != "1" {
		t.Fatalf("command = %v", command)
	}
	if _, err := os.Stat(command[3]); !os.IsNotExist(err) {
		t.Fatalf("the payload file is left behind: %v", err)
	}
}

func TestCreateRegionsReadsAnOlderScriptsThreeCounts(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"REGIONS_CREATED", run(command), "1", "0", "0"}}
	})
	got, err := actions.CreateRegions(context.Background(), []Region{{Start: 0, End: 1, Title: "A"}}, "", false)
	if err != nil || got != (RegionsCreated{Created: 1}) {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestCreateRegionsRefusesRowsREAPERWouldCountInvalidBeforeSending(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func([]string) [][]string { return nil })
	for _, rows := range [][]Region{
		nil,
		{{Start: -1, End: 5, Title: "A"}},
		{{Start: 5, End: 5, Title: "A"}},
		{{Start: 0, End: 5, Title: " "}},
		{{Start: 0, End: 5, Title: "Two\nlines"}},
	} {
		if _, err := actions.CreateRegions(context.Background(), rows, "", false); err == nil {
			t.Errorf("%+v was accepted", rows)
		}
	}
	if _, err := actions.CreateRegions(context.Background(), []Region{{Start: 0, End: 5, Title: "A"}}, "orange", false); err == nil {
		t.Error("a colour that is not RRGGBB was accepted")
	}
	time.Sleep(20 * time.Millisecond)
	if len(fake.commands()) != 0 {
		t.Fatalf("a refused request wrote a command: %v", fake.commands())
	}
}

func TestCreateRegionsWithNoBridgeIsUnavailable(t *testing.T) {
	actions := NewActions(nil, func() bool { return true })
	if _, err := actions.CreateRegions(context.Background(), []Region{{Start: 0, End: 1, Title: "A"}}, "", false); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}
