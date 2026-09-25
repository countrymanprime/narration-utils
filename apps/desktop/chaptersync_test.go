package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptersync"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// Chapter sync's consent and first sync (daw-chapter-track-auto-sync PRD Phase 3, S1, S2, S12). The chapter-match
// host is Alice's three chapters and a .rpp with a "Chapter I" track (a confident two-way match), two "Chapter II"
// tracks (ambiguous) and none for Chapter III.

type syncHost struct {
	host   *Host
	ids    []string
	mu     *sync.Mutex
	events *[]chapterSyncState
}

func newSyncHost(t *testing.T, linkDaw bool) syncHost {
	t.Helper()
	host, ids := newTestHostForChapterMatch(t)
	host.config.daw = "Standalone"
	if linkDaw {
		if _, err := linkDawFile(host.persist, host.config.projectFolder, filepath.Join(host.config.projectFolder, "Alice.rpp")); err != nil {
			t.Fatal(err)
		}
	}
	var mu sync.Mutex
	events := []chapterSyncState{}
	host.mu.Lock()
	host.chapterSyncEvents = func(state chapterSyncState) {
		mu.Lock()
		defer mu.Unlock()
		events = append(events, state)
	}
	host.mu.Unlock()
	return syncHost{host: host, ids: ids, mu: &mu, events: &events}
}

func (f syncHost) state(t *testing.T) chapterSyncState {
	t.Helper()
	state, err := f.host.chapterSyncState()
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func (f syncHost) lastEvent(t *testing.T) chapterSyncState {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(*f.events) == 0 {
		t.Fatal("no chaptersync:state event was sent")
	}
	return (*f.events)[len(*f.events)-1]
}

func (f syncHost) links(t *testing.T) map[string]string {
	t.Helper()
	listed, err := f.host.mappingList()
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(listed["mappings"])
	var mappings []struct {
		TrackGUID string `json:"trackGuid"`
		ChapterID string `json:"chapterId"`
		Origin    string `json:"origin"`
	}
	if err := json.Unmarshal(raw, &mappings); err != nil {
		t.Fatal(err)
	}
	links := map[string]string{}
	for _, mapping := range mappings {
		links[mapping.TrackGUID] = mapping.ChapterID + "/" + mapping.Origin
	}
	return links
}

func TestChapterSyncAsksOnceTheManuscriptAndTheDAWAreBothThere(t *testing.T) {
	unlinked := newSyncHost(t, false)
	if state := unlinked.state(t); state.Ask || state.Consent != consentUndecided {
		t.Fatalf("asked with no DAW project linked: %+v", state)
	}

	f := newSyncHost(t, true)
	state := f.state(t)
	if !state.Ask || state.Consent != consentUndecided || state.Project != linksProjectReady || state.LastSync != nil {
		t.Fatalf("state = %+v", state)
	}

	// A link path (the DAW link, an import, a project attach) tells the UI, and writes nothing while undecided.
	f.host.chapterSyncTrigger(syncTriggerDawLink)
	if event := f.lastEvent(t); !event.Ask || event.Batch != nil {
		t.Fatalf("event = %+v", event)
	}
	if links := f.links(t); len(links) != 0 {
		t.Fatalf("an undecided project was linked: %v", links)
	}
}

func TestThePreviewShowsThePlanAndWritesNothing(t *testing.T) {
	f := newSyncHost(t, true)

	preview, err := f.host.chapterSyncPreview()

	if err != nil {
		t.Fatal(err)
	}
	if len(preview.AutoLink) != 1 || preview.AutoLink[0].ChapterID != f.ids[0] || len(preview.NeedsYou) != 1 || preview.NeedsYou[0].Reason != chaptersync.ReasonAmbiguous || len(preview.NoTrack) != 1 {
		t.Fatalf("preview = %+v", preview)
	}
	if links := f.links(t); len(links) != 0 {
		t.Fatalf("the preview linked %v", links)
	}
	if snapshot := chaptersync.NewStore(f.host.config.projectFolder).Read(); !snapshot.SyncedAt.IsZero() {
		t.Fatal("the preview stored a snapshot")
	}
}

func TestSyncLinksTheConfidentChapterAndSaysSo(t *testing.T) {
	f := newSyncHost(t, true)

	state, err := f.host.chapterSyncSetEnabled(true)

	if err != nil {
		t.Fatal(err)
	}
	if state.Consent != consentOn || state.Ask || state.LastSync == nil || state.Batch == nil || len(state.Batch.Linked) != 1 || state.Batch.Trigger != syncTriggerConsent {
		t.Fatalf("state = %+v", state)
	}
	if got := f.links(t)[chapterITrack]; got != f.ids[0]+"/auto" {
		t.Fatalf("links = %v", f.links(t))
	}
	if state.Counts.Linked != 1 || state.Counts.NeedsYou != 1 || state.Counts.NoTrack != 1 {
		t.Fatalf("counts = %+v", state.Counts)
	}
	if event := f.lastEvent(t); event.Batch == nil || len(event.Batch.Linked) != 1 {
		t.Fatalf("event = %+v", event)
	}
	manifest, _, err := project.Load(nil, f.host.config.projectFolder)
	if err != nil || manifest.ChapterSync == nil || !manifest.ChapterSync.Enabled {
		t.Fatalf("manifest = %+v, %v", manifest, err)
	}

	// A later trigger with nothing new links nothing, and says so with no batch.
	f.host.chapterSyncTrigger(syncTriggerImport)
	if event := f.lastEvent(t); event.Batch != nil {
		t.Fatalf("a sync with nothing new sent a batch: %+v", event.Batch)
	}
}

func TestNotNowIsStoredAndNothingIsLinked(t *testing.T) {
	f := newSyncHost(t, true)

	state, err := f.host.chapterSyncSetEnabled(false)

	if err != nil {
		t.Fatal(err)
	}
	if state.Consent != consentOff || state.Ask || state.Batch != nil {
		t.Fatalf("state = %+v", state)
	}
	f.host.chapterSyncTrigger(syncTriggerDawLink)
	if links := f.links(t); len(links) != 0 {
		t.Fatalf("sync ran while off: %v", links)
	}
}

func TestSyncNeverTouchesAManualLinkAndUndoSticks(t *testing.T) {
	f := newSyncHost(t, true)
	if _, err := f.host.ChapterTrackSet(f.ids[2], "{33333333-3333-4333-8333-333333333333}"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.host.chapterSyncSetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if got := f.links(t)["{33333333-3333-4333-8333-333333333333}"]; got != f.ids[2]+"/manual" {
		t.Fatalf("the manual link changed: %v", f.links(t))
	}

	state, err := f.host.chapterSyncUndo(chapterITrack)

	if err != nil {
		t.Fatal(err)
	}
	// Chapter III's manual link took one of the two "Chapter II" tracks, so Chapter II's other track was a confident
	// match and sync linked it too: two links remain after Chapter I's is undone.
	if _, linked := f.links(t)[chapterITrack]; linked || state.Counts.Linked != 2 {
		t.Fatalf("after Undo: links %v, state %+v", f.links(t), state)
	}
	f.host.chapterSyncTrigger(syncTriggerAttach)
	if _, linked := f.links(t)[chapterITrack]; linked {
		t.Fatal("an undone link was made again")
	}
	if _, err := f.host.chapterSyncUndo("{33333333-3333-4333-8333-333333333333}"); err == nil || !strings.Contains(err.Error(), "automatic") {
		t.Fatalf("a manual link was undone: %v", err)
	}
}

func TestSyncLinksNarrationChaptersOnly(t *testing.T) {
	f := newSyncHost(t, true)
	if _, err := f.host.ManuscriptSetChapterKind(f.ids[0], "reference"); err != nil {
		t.Fatal(err)
	}

	if _, err := f.host.chapterSyncSetEnabled(true); err != nil {
		t.Fatal(err)
	}

	if _, linked := f.links(t)[chapterITrack]; linked {
		t.Fatal("a chapter removed from recording was linked")
	}
}

// ChapterSyncState's payloads, which chaptersync:state also carries (PRD Phase 3): asking for consent, and after the
// first sync with its batch; and ChapterSyncPreview's plan.
func TestContractChapterSync(t *testing.T) {
	f := newSyncHost(t, true)
	folder := f.host.config.projectFolder
	pin := func(name string, value any) {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatal(err)
		}
		stabilizeSyncTimes(payload)
		stable, err := contractfile.PortablePaths(payload, folder, "C:/Projects/Alice")
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, name, stable)
	}
	pin("chapter-sync-state-ask", f.state(t))
	preview, err := f.host.chapterSyncPreview()
	if err != nil {
		t.Fatal(err)
	}
	pin("chapter-sync-preview", preview)
	synced, err := f.host.chapterSyncSetEnabled(true)
	if err != nil {
		t.Fatal(err)
	}
	pin("chapter-sync-state-synced", synced)
}

// stabilizeSyncTimes replaces every time the sync stamps with a fixed one.
func stabilizeSyncTimes(value any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, inner := range typed {
			switch key {
			case "decidedAt", "lastSync", "at", "confirmedAt":
				if _, ok := inner.(string); ok {
					typed[key] = "2026-09-25T12:00:00Z"
				}
			default:
				stabilizeSyncTimes(inner)
			}
		}
	case []any:
		for _, inner := range typed {
			stabilizeSyncTimes(inner)
		}
	}
}

// An import in an attached project ends with job:ended and reaches chapter sync. configureLocked rebuilds the
// manuscript service per project, and the rebuilt one must keep the import-end callback.
func TestAnImportInAnAttachedProjectEndsAsAJobAndAsksToSync(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	folder := t.TempDir()
	host := NewHost()
	next := host.config
	next.projectFolder = folder
	host.mu.Lock()
	attached, reason := host.attachProjectLocked(next)
	host.mu.Unlock()
	if !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	ends := collectJobEnds(host)
	syncs := make(chan chapterSyncState, 4)
	host.mu.Lock()
	host.chapterSyncEvents = func(state chapterSyncState) { syncs <- state }
	host.mu.Unlock()

	job := host.manuscript.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := host.manuscript.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := host.manuscript.Commit(job.ID, false, manuscript.Choices{}); err != nil {
		t.Fatal(err)
	}

	if ended := nextJobEnd(t, ends); ended.Kind != "manuscript_import" || ended.Outcome != "success" {
		t.Fatalf("job:ended = %+v", ended)
	}
	select {
	case state := <-syncs:
		if !state.Manuscript || state.Consent != consentUndecided {
			t.Fatalf("chaptersync:state = %+v", state)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the import did not reach chapter sync")
	}
}
