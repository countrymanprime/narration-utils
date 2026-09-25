package chaptersync

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTheSnapshotRoundTripsAtItsDocumentedPath(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if got := store.Read(); !got.SyncedAt.IsZero() || len(got.Tracks) != 0 {
		t.Fatalf("a project with no file read %#v", got)
	}
	want := Snapshot{SyncedAt: time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC), Tracks: []TrackState{{GUID: "{1}", Name: "Chapter 1", Fingerprint: "abc"}}}
	if err := store.Write(want); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "chapter-sync.json")); err != nil {
		t.Fatal(err)
	}
	got := NewStore(project).Read()
	if !got.SyncedAt.Equal(want.SyncedAt) || len(got.Tracks) != 1 || got.Tracks[0] != want.Tracks[0] {
		t.Fatalf("Read = %#v", got)
	}
}

func TestACorruptOrNewerSnapshotReadsAsAFirstSync(t *testing.T) {
	for name, body := range map[string]string{"corrupt": "{not json", "newer": `{"schemaVersion":99,"snapshot":{"syncedAt":"2026-01-01T00:00:00Z","tracks":[{"guid":"x"}]}}`} {
		t.Run(name, func(t *testing.T) {
			project := t.TempDir()
			if err := os.MkdirAll(filepath.Dir(File(project)), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(File(project), []byte(body), 0o600); err != nil {
				t.Fatal(err)
			}
			if got := NewStore(project).Read(); !got.SyncedAt.IsZero() || len(got.Tracks) != 0 {
				t.Fatalf("Read = %#v", got)
			}
		})
	}
}

func TestTheActivityListKeepsTheNewestEntriesAndSurvivesASnapshotWrite(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if got := store.Activity(); len(got) != 0 {
		t.Fatalf("a project with no file has activity %#v", got)
	}
	base := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	for i := 0; i < ActivityLimit+3; i++ {
		entry := Activity{At: base.Add(time.Duration(i) * time.Minute), Trigger: "watch", NewTracks: []TrackRef{{GUID: "{n}", Name: "Room tone"}}}
		if err := store.Write(Snapshot{SyncedAt: entry.At}, entry); err != nil {
			t.Fatal(err)
		}
	}
	// A sync that did nothing writes its snapshot and keeps the list.
	if err := store.Write(Snapshot{SyncedAt: base.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}

	got := NewStore(project).Activity()

	if len(got) != ActivityLimit {
		t.Fatalf("kept %d entries, want %d", len(got), ActivityLimit)
	}
	if newest := base.Add(time.Duration(ActivityLimit+2) * time.Minute); !got[0].At.Equal(newest) {
		t.Fatalf("first entry is %v, want the newest %v", got[0].At, newest)
	}
	if got[0].Linked == nil || got[0].NewTracks == nil {
		t.Fatalf("lists must read as empty, never null: %#v", got[0])
	}
	if snapshot := NewStore(project).Read(); !snapshot.SyncedAt.Equal(base.Add(time.Hour)) {
		t.Fatalf("snapshot = %v", snapshot.SyncedAt)
	}
}

func TestTheFingerprintIgnoresTheNameAndFollowsTheItems(t *testing.T) {
	a := track("{1}", "Chapter 1", item("{i}", 0, 60, "one.wav"))
	renamed := track("{1}", "Chapter One", item("{i}", 0, 60, "one.wav"))
	trimmed := track("{1}", "Chapter 1", item("{i}", 0, 58, "one.wav"))
	if Fingerprint(a) != Fingerprint(renamed) {
		t.Fatal("a rename changed the fingerprint")
	}
	if Fingerprint(a) == Fingerprint(trimmed) {
		t.Fatal("a trim did not change the fingerprint")
	}
}
