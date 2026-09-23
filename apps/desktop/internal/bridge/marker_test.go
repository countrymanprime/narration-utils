package bridge

import (
	"context"
	"errors"
	"math"
	"reflect"
	"testing"
)

// AddMarker against a fake REAPER that answers as integrations/reaper/tests/finding_marker_test.lua pins add_finding_marker.

func TestAddMarkerSendsTheItemTakeTimeColourAndNameAndAnswersWhatREAPERAdded(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"FINDING_MARKER", run(command), "added", testTake, "12.500000", command[7]}}
	})

	got, err := navigator.AddMarker(context.Background(), Target{ItemGUID: testItem, TakeGUID: testTake, SourceStart: seconds(12.5)}, Marker{Name: "MISREAD: 'a' as 'b'", Color: "FF4040"})
	if err != nil {
		t.Fatal(err)
	}
	want := MarkerResult{Added: true, TakeGUID: testTake, SourceTime: 12.5, Name: "MISREAD: 'a' as 'b'"}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	sent := fake.commands()[0]
	if !reflect.DeepEqual(sent[1:], []string{"add_finding_marker", sent[2], testItem, testTake, "12.500000", "FF4040", "MISREAD: 'a' as 'b'"}) {
		t.Fatalf("sent %q", sent)
	}
}

func TestAddMarkerReportsAMarkerTheTakeAlreadyHasAsExisting(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"FINDING_MARKER", run(command), "existing", testTake, "12.500000", "MISREAD: exported earlier"}}
	})

	got, err := navigator.AddMarker(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(12.5)}, Marker{Name: "MISREAD: x"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Added || got.Name != "MISREAD: exported earlier" || got.TakeGUID != testTake {
		t.Fatalf("got %+v", got)
	}
}

// Nothing is sent for a marker that cannot be placed or named: a project time is never a fallback (ADR 0121).
func TestAddMarkerRefusesBeforeSendingWithoutAnItemATimeOrAName(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string { return nil })

	for _, check := range []struct {
		name   string
		target Target
		marker Marker
		want   error
	}{
		{"no item", Target{SourceStart: seconds(1)}, Marker{Name: "MISREAD: x"}, ErrNoItemIdentity},
		{"no time", Target{ItemGUID: testItem}, Marker{Name: "MISREAD: x"}, ErrNoSourceTime},
		{"not a number", Target{ItemGUID: testItem, SourceStart: seconds(math.NaN())}, Marker{Name: "MISREAD: x"}, ErrNoSourceTime},
		{"no name", Target{ItemGUID: testItem, SourceStart: seconds(1)}, Marker{Name: "  "}, ErrNoMarkerName},
	} {
		if _, err := navigator.AddMarker(context.Background(), check.target, check.marker); !errors.Is(err, check.want) {
			t.Fatalf("%s: got %v, want %v", check.name, err, check.want)
		}
	}
	if sent := fake.commands(); len(sent) != 0 {
		t.Fatalf("sent %q", sent)
	}
}

func TestAddMarkerPassesOnAStaleFindingRecordingAndAnOlderScript(t *testing.T) {
	for _, check := range []struct {
		answer []string
		want   error
	}{
		{[]string{"FINDING_STALE", "", testItem, "range"}, ErrStale},
		{[]string{"ERROR", "", "REAPER is recording. Stop recording first."}, ErrRecording},
		{[]string{"ERROR", "", "Unsupported workspace command"}, ErrScriptOutdated},
	} {
		navigator, client, dir := newNavigatorSession(t)
		startFakeReaper(t, client, dir, func(command []string) [][]string {
			answer := append([]string(nil), check.answer...)
			answer[1] = run(command)
			return [][]string{answer}
		})
		if _, err := navigator.AddMarker(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(1)}, Marker{Name: "MISREAD: x"}); !errors.Is(err, check.want) {
			t.Fatalf("%v: got %v", check.answer, err)
		}
	}
}

func TestAddMarkerWithAnAnswerOfTheWrongKindIsAnError(t *testing.T) {
	navigator, client, dir := newNavigatorSession(t)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"NAVIGATED", run(command), testItem, "1.000000"}}
	})
	if _, err := navigator.AddMarker(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(1)}, Marker{Name: "MISREAD: x"}); err == nil {
		t.Fatal("a NAVIGATED answer was taken for a marker")
	}
}

func TestAddMarkerWithoutABridgeIsUnavailable(t *testing.T) {
	if _, err := NewNavigator(nil).AddMarker(context.Background(), Target{ItemGUID: testItem, SourceStart: seconds(1)}, Marker{Name: "MISREAD: x"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v", err)
	}
}
