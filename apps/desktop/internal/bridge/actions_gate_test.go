package bridge

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

// switchGate is the old single switch as a Gate: every command allowed while it is on, ErrExperimentalOff while it is off.
func switchGate(on bool) Gate {
	return func(string) error {
		if !on {
			return ErrExperimentalOff
		}
		return nil
	}
}

func newGatedSession(t *testing.T) (*Client, string) {
	t.Helper()
	dir := t.TempDir()
	client, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	return client, dir
}

// Actions asks its gate about every command, by name, before anything is written (DAW port PRD P3): the gate, which the host
// builds over the DAW port's resolver, is the only thing that decides whether an experimental command may be sent.
func TestActionsAskTheGateAboutEachCommandByName(t *testing.T) {
	var asked []string
	actions := NewActions(nil, func(command string) error {
		asked = append(asked, command)
		return nil
	})
	ctx := context.Background()
	_, _ = actions.ChapterTrackState(ctx, testTrack)
	_, _ = actions.PlayPosition(ctx)
	_, _ = actions.ListFXChains(ctx)
	want := []string{"chapter_track_state", "play_position", "list_fx_chains"}
	if fmt.Sprint(asked) != fmt.Sprint(want) {
		t.Fatalf("the gate was asked about %v, want %v", asked, want)
	}
}

// A refusal that means "experimental and switched off" reaches the caller as ErrExperimentalOff itself, whatever type the gate
// wrapped it in, so every consumer's reason mapping (readaloudreaper.go and the rest) is untouched.
type wrappedOff struct{}

func (wrappedOff) Error() string        { return "Experimental: switched off in Settings." }
func (wrappedOff) Is(target error) bool { return target == ErrExperimentalOff }

func TestAGateRefusalMeaningExperimentalOffIsErrExperimentalOff(t *testing.T) {
	client, dir := newGatedSession(t)
	actions := NewActions(client, func(string) error { return wrappedOff{} })
	fake := startFakeReaper(t, client, dir, trackStateAnswer)
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); err != ErrExperimentalOff { //nolint:errorlint // the value itself, not a match
		t.Fatalf("err = %#v, want the ErrExperimentalOff value", err)
	}
	time.Sleep(20 * time.Millisecond)
	if got := fake.commands(); len(got) != 0 {
		t.Fatalf("a refused command was written: %v", got)
	}
}

// Any other refusal (the narrator turned the capability off, say) is passed on as it is, and nothing is written.
func TestAnotherGateRefusalIsPassedOn(t *testing.T) {
	turnedOff := errors.New("Turned off in Settings.")
	client, dir := newGatedSession(t)
	actions := NewActions(client, func(string) error { return turnedOff })
	fake := startFakeReaper(t, client, dir, trackStateAnswer)
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); !errors.Is(err, turnedOff) || errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("err = %v, want the gate's own refusal", err)
	}
	time.Sleep(20 * time.Millisecond)
	if got := fake.commands(); len(got) != 0 {
		t.Fatalf("a refused command was written: %v", got)
	}
}

// The gate is asked before the connection, as the old switch was: with no bridge and the gate refusing, the refusal wins.
func TestTheGateIsAskedBeforeTheConnection(t *testing.T) {
	actions := NewActions(nil, switchGate(false))
	if _, err := actions.CreateRegions(context.Background(), []Region{{Start: 0, End: 1, Title: "A"}}, "", false); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("err = %v, want ErrExperimentalOff before ErrUnavailable", err)
	}
}
