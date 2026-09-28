package bridge

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestReadMasterChainIsExperimentalAndRefusedWhileTheSettingIsOff(t *testing.T) {
	actions, client, dir := newActionsSession(t, false)
	fake := startFakeReaper(t, client, dir, func([]string) [][]string { return nil })
	if _, err := actions.ReadMasterChain(context.Background()); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("ReadMasterChain: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if len(fake.commands()) != 0 {
		t.Fatalf("commands were written: %v", fake.commands())
	}
	if !Experimental("master_chain_read") {
		t.Error("master_chain_read must stay experimental until the verification pass")
	}
}

func TestReadMasterChainGroupsEveryTracksFXAndKeepsTheMasterApart(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	const voice, room = "{00000001-0000-4000-8000-000000000001}", "{00000002-0000-4000-8000-000000000002}"
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{
			{"MASTER_CHAIN_FX", run(command), voice, "Voice", "VST: ReaEQ (Cockos)", "1"},
			{"MASTER_CHAIN_FX", run(command), voice, "Voice", "VST: ReaComp (Cockos)", "0"},
			{"MASTER_CHAIN_FX", run(command), room, "Room", "JS: Noise gate", "1"},
			{"MASTER_CHAIN_FX", run(command), "master", "MASTER", "VST: ReaLimit (Cockos)", "1"},
			{"MASTER_CHAIN_READ", run(command), "4", "0"},
		}
	})
	got, err := actions.ReadMasterChain(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := MasterChain{
		Tracks: []TrackFX{
			{TrackGUID: voice, Name: "Voice", FX: []FXSlot{{Name: "VST: ReaEQ (Cockos)", Enabled: true}, {Name: "VST: ReaComp (Cockos)"}}},
			{TrackGUID: room, Name: "Room", FX: []FXSlot{{Name: "JS: Noise gate", Enabled: true}}},
		},
		Master: []FXSlot{{Name: "VST: ReaLimit (Cockos)", Enabled: true}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if command := fake.commands()[0]; !reflect.DeepEqual(command[1:], []string{"master_chain_read", run(command)}) {
		t.Fatalf("command = %v", command)
	}
}

func TestReadMasterChainAnswersAnEmptyChainWithEmptyLists(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"MASTER_CHAIN_READ", run(command), "0", "0"}}
	})
	got, err := actions.ReadMasterChain(context.Background())
	if err != nil || got.Tracks == nil || got.Master == nil || len(got.Tracks)+len(got.Master) != 0 {
		t.Fatalf("got %+v, %v; want empty, non-nil lists", got, err)
	}
}

// The narrator approves a render after seeing its whole chain, so a list REAPER cut short is refused rather than shown in part.
func TestReadMasterChainRefusesAListREAPERCutShort(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{
			{"MASTER_CHAIN_FX", run(command), "master", "MASTER", "VST: ReaLimit (Cockos)", "1"},
			{"MASTER_CHAIN_READ", run(command), "500", "1"},
		}
	})
	if _, err := actions.ReadMasterChain(context.Background()); !errors.Is(err, ErrChainTooLong) {
		t.Fatalf("err = %v, want ErrChainTooLong", err)
	}
}

func TestReadMasterChainPassesOnREAPERsRefusal(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ERROR", run(command), "This REAPER version cannot list FX."}}
	})
	if _, err := actions.ReadMasterChain(context.Background()); err == nil || err.Error() != "This REAPER version cannot list FX." {
		t.Fatalf("err = %v", err)
	}
}
