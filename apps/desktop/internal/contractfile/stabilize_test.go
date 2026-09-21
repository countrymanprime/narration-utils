package contractfile

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestStabilizeNamesRandomIDsInOrderAndKeepsReferences(t *testing.T) {
	first, second := "0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210"
	got, err := Stabilize(map[string]any{
		"notes":    []any{map[string]any{"id": second, "chapterId": "c1"}, map[string]any{"id": first, "noteId": second}},
		"bookmark": map[string]any{"noteId": first},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Keys are visited in sorted order (bookmark before notes), so the first id met is `first`.
	want := map[string]any{
		"notes":    []any{map[string]any{"id": "id-2", "chapterId": "c1"}, map[string]any{"id": "id-1", "noteId": "id-2"}},
		"bookmark": map[string]any{"noteId": "id-1"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Stabilize = %#v, want %#v", got, want)
	}
}

func TestStabilizeFixesTimestampsAndLeavesStableValuesAlone(t *testing.T) {
	got, err := Stabilize(map[string]any{"at": "2026-09-01T09:30:12.123456789Z", "on": "2026-09-01T09:30:12Z", "local": "2026-09-21T03:18:08.6142165-04:00", "title": "Chapter 1", "n": 2.5, "ok": true, "none": nil})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"at": FixedTime, "on": FixedTime, "local": FixedTime, "title": "Chapter 1", "n": 2.5, "ok": true, "none": nil}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Stabilize = %#v, want %#v", got, want)
	}
}

func TestStabilizeRoundTripsThroughJSONSoTheValueIsWhatTheUIReceives(t *testing.T) {
	type record struct {
		Name string `json:"name"`
		Skip string `json:"-"`
		Time int    `json:"n,omitempty"`
	}
	got, err := Stabilize([]record{{Name: "a", Skip: "x"}})
	if err != nil {
		t.Fatal(err)
	}
	if want := []any{map[string]any{"name": "a"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Stabilize = %#v, want %#v", got, want)
	}
}

func TestStabilizeReportsAValueThatCannotBeEncoded(t *testing.T) {
	if _, err := Stabilize(make(chan int)); err == nil {
		t.Fatal("expected an error")
	}
}

func TestPortablePathsReplacesTheFolderAndUsesForwardSlashes(t *testing.T) {
	folder := filepath.Join(t.TempDir(), "Alice")
	got, err := PortablePaths(map[string]any{
		"selected":   filepath.Join(folder, "Novel.rpp"),
		"candidates": []string{filepath.Join(folder, "Novel.rpp"), filepath.Join(folder, "Sub", "Alt.rpp")},
		"name":       "unchanged",
	}, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"selected":   "C:/Projects/Alice/Novel.rpp",
		"candidates": []any{"C:/Projects/Alice/Novel.rpp", "C:/Projects/Alice/Sub/Alt.rpp"},
		"name":       "unchanged",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("PortablePaths = %#v, want %#v", got, want)
	}
}

func TestPortablePathsReportsAValueThatCannotBeEncoded(t *testing.T) {
	if _, err := PortablePaths(make(chan int), "x", "y"); err == nil {
		t.Fatal("expected an error")
	}
}
