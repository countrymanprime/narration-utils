package main

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/chaptersync"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// Chapter sync's consent and first sync (daw-chapter-track-auto-sync.prd.md Phase 3, ADR 0209). The narrator is asked
// once per project, when it has both a manuscript and a linked DAW project (S1); the answer lives on the manifest
// (S2). With consent, every link path (the answer itself, a DAW link, an import, a project attach) runs one sync:
// chaptersync.Build over the narration chapters and the saved .rpp, MappingStore.AutoLink for the confident two-way
// matches (ADR 0202), and the snapshot stored for the next sync. Each run tells the UI through chaptersync:state.
// Watching the .rpp for changes is Phase 4.

const chapterSyncEvent = "chaptersync:state"

// Consent states.
const (
	consentUndecided = "undecided"
	consentOn        = "on"
	consentOff       = "off"
)

// Sync triggers: what made a sync run (or the state be sent).
const (
	syncTriggerConsent = "consent"
	syncTriggerDawLink = "daw-link"
	syncTriggerImport  = "import"
	syncTriggerAttach  = "attach"
	syncTriggerUndo    = "undo"
)

// chapterSyncCounts is the last plan in numbers: links the narration chapters hold (either origin), chapters that need
// the narrator, chapters with no candidate track, tracks that are no chapter's, and pickup tracks.
type chapterSyncCounts struct {
	Linked       int `json:"linked"`
	NeedsYou     int `json:"needsYou"`
	NoTrack      int `json:"noTrack"`
	Unmatched    int `json:"unmatched"`
	PickupTracks int `json:"pickupTracks"`
}

// chapterSyncBatch is what one sync just did, for the toast (S12): the links it made (each undoable with
// ChapterSyncUndo) and the tracks new since the last sync that match no chapter (listed quietly, never toasted).
type chapterSyncBatch struct {
	At        time.Time               `json:"at"`
	Trigger   string                  `json:"trigger"`
	Linked    []evidence.TrackMapping `json:"linked"`
	NewTracks []chaptersync.TrackRef  `json:"newTracks"`
}

// chapterSyncState is ChapterSyncState's payload and what chaptersync:state carries. Ask says to show the consent
// dialog. Project is the saved .rpp's state (ready, none, choose, error) with its file and save time. LastSync is the
// last stored snapshot's time (null before the first sync). Batch is set only on the answer or event of a sync that
// linked something or found a new unmatched track.
type chapterSyncState struct {
	Consent     string            `json:"consent"`
	DecidedAt   *time.Time        `json:"decidedAt"`
	Ask         bool              `json:"ask"`
	Manuscript  bool              `json:"manuscript"`
	DawLinked   bool              `json:"dawLinked"`
	Project     linksProjectState `json:"project"`
	Message     string            `json:"message"`
	ProjectFile string            `json:"projectFile"`
	SavedAt     string            `json:"savedAt"`
	LastSync    *time.Time        `json:"lastSync"`
	Counts      chapterSyncCounts `json:"counts"`
	Batch       *chapterSyncBatch `json:"batch"`
}

// chapterSyncPreview is ChapterSyncPreview's payload: the plan a sync would carry out now, and the links it keeps.
type chapterSyncPreview struct {
	Project     linksProjectState       `json:"project"`
	Message     string                  `json:"message"`
	ProjectFile string                  `json:"projectFile"`
	SavedAt     string                  `json:"savedAt"`
	Kept        []evidence.TrackMapping `json:"kept"`
	chaptersync.Plan
}

// chapterSyncRuns serialises syncs: two link paths firing together must not plan against the same snapshot twice.
type chapterSyncRuns struct{ mu sync.Mutex }

// ChapterSyncState reads the consent, whether to ask, and the last sync. It only reads.
func (h *Host) ChapterSyncState() (string, error) { return encodeBinding(h.chapterSyncState()) }

// ChapterSyncPreview plans a sync without writing anything: the consent dialog's preview.
func (h *Host) ChapterSyncPreview() (string, error) { return encodeBinding(h.chapterSyncPreview()) }

// ChapterSyncSetEnabled stores the narrator's answer (Sync is true, Not now is false, and the Tracks page's toggle
// uses the same call) and, when on, runs the first sync. It returns the new state with the sync's batch.
func (h *Host) ChapterSyncSetEnabled(on bool) (string, error) {
	return encodeBinding(h.chapterSyncSetEnabled(on))
}

// ChapterSyncUndo removes one automatic link and remembers the pair so no later sync makes it again (ADR 0203). A
// manual link is refused. It returns the new state.
func (h *Host) ChapterSyncUndo(trackGUID string) (string, error) {
	return encodeBinding(h.chapterSyncUndo(trackGUID))
}

// chapterSyncInputs is what a plan and the state read, from one services snapshot.
type chapterSyncInputs struct {
	svc         hostServices
	documentID  string
	store       *evidence.MappingStore
	chapters    []chaptermatch.Chapter
	manifest    *project.Manifest
	dawLinked   bool
	project     linksProjectState
	message     string
	projectFile string
	savedAt     string
	parsed      bool
}

// readChapterSyncInputs reads the manifest, the manuscript's narration chapters (sync links only those, ADR 0207) and
// the saved .rpp. A project with no manuscript is not an error: Manuscript is then false and nothing is asked.
func (h *Host) readChapterSyncInputs() (chapterSyncInputs, error) {
	svc := h.services()
	folder := svc.config.projectFolder
	if folder == "" {
		return chapterSyncInputs{}, errors.New("open a project before syncing chapters to tracks")
	}
	in := chapterSyncInputs{svc: svc}
	manifest, ok, err := project.Load(h.persist, folder)
	if err != nil {
		return chapterSyncInputs{}, fmt.Errorf("could not read the project manifest: %w", err)
	}
	if ok {
		in.manifest = manifest
	}
	in.dawLinked, _, _ = dawLinkFacts(h.persist, folder, svc.config.daw, nil)
	if documentID, store, err := mappingContext(svc); err == nil {
		in.documentID, in.store = documentID, store
		raw, err := svc.manuscript.ChaptersUnmeasured()
		if err != nil {
			return chapterSyncInputs{}, err
		}
		for _, chapter := range raw {
			if kind, _ := chapter["contentKind"].(string); kind != "" && kind != "narration" {
				continue
			}
			id, _ := chapter["id"].(string)
			title, _ := chapter["title"].(string)
			in.chapters = append(in.chapters, chaptermatch.Chapter{ID: id, Title: title})
		}
	}
	return in, nil
}

func consentOf(manifest *project.Manifest) (string, *time.Time) {
	if manifest == nil || manifest.ChapterSync == nil {
		return consentUndecided, nil
	}
	decided := manifest.ChapterSync.DecidedAt
	if manifest.ChapterSync.Enabled {
		return consentOn, &decided
	}
	return consentOff, &decided
}

// plan builds the sync plan for in, reading the .rpp once. It returns ok false when there is no manuscript or no
// readable project, with in's project state saying why.
func (in *chapterSyncInputs) plan(now time.Time) (chaptersync.Plan, []evidence.TrackMapping, bool, error) {
	parsed, state, message := readLinksProject(in.svc)
	in.project, in.message = state, message
	if state == linksProjectReady {
		in.projectFile, in.savedAt, in.parsed = parsed.Path, savedAt(parsed.Path), true
	}
	if in.store == nil || state != linksProjectReady {
		return chaptersync.Plan{}, nil, false, nil
	}
	links, err := in.store.List(in.documentID)
	if err != nil {
		return chaptersync.Plan{}, nil, false, err
	}
	rejected, err := in.store.Rejected(in.documentID)
	if err != nil {
		return chaptersync.Plan{}, nil, false, err
	}
	previous, err := in.store.Previous(in.documentID)
	if err != nil {
		return chaptersync.Plan{}, nil, false, err
	}
	narration := make(map[string]bool, len(in.chapters))
	for _, chapter := range in.chapters {
		narration[chapter.ID] = true
	}
	kept := []evidence.TrackMapping{}
	for _, link := range links {
		if narration[link.ChapterID] {
			kept = append(kept, link)
		}
	}
	plan := chaptersync.Build(chaptersync.Input{
		Chapters: in.chapters, Project: parsed, Links: links, Rejected: rejected, PreviousLinks: previous,
		Previous: chaptersync.NewStore(in.svc.config.projectFolder).Read(), Now: now,
	})
	return plan, kept, true, nil
}

// stateOf is the state for in with plan's counts (when there is one) and the stored snapshot's time.
func (in chapterSyncInputs) stateOf(plan chaptersync.Plan, kept []evidence.TrackMapping, planned bool) chapterSyncState {
	consent, decided := consentOf(in.manifest)
	state := chapterSyncState{
		Consent: consent, DecidedAt: decided, Manuscript: in.store != nil, DawLinked: in.dawLinked,
		Project: in.project, Message: in.message, ProjectFile: in.projectFile, SavedAt: in.savedAt,
	}
	state.Ask = consent == consentUndecided && state.Manuscript && state.DawLinked
	if snapshot := chaptersync.NewStore(in.svc.config.projectFolder).Read(); !snapshot.SyncedAt.IsZero() {
		synced := snapshot.SyncedAt
		state.LastSync = &synced
	}
	if planned {
		state.Counts = chapterSyncCounts{
			Linked: len(kept) + len(plan.AutoLink), NeedsYou: len(plan.NeedsYou), NoTrack: len(plan.NoTrack),
			Unmatched: len(plan.Unmatched), PickupTracks: len(plan.PickupTracks),
		}
	}
	return state
}

func (h *Host) chapterSyncState() (chapterSyncState, error) {
	in, err := h.readChapterSyncInputs()
	if err != nil {
		return chapterSyncState{}, err
	}
	plan, kept, planned, err := in.plan(time.Now())
	if err != nil {
		return chapterSyncState{}, err
	}
	return in.stateOf(plan, kept, planned), nil
}

func (h *Host) chapterSyncPreview() (chapterSyncPreview, error) {
	in, err := h.readChapterSyncInputs()
	if err != nil {
		return chapterSyncPreview{}, err
	}
	if in.store == nil {
		return chapterSyncPreview{}, errors.New("import a manuscript before syncing chapters to tracks")
	}
	plan, kept, planned, err := in.plan(time.Now())
	if err != nil {
		return chapterSyncPreview{}, err
	}
	preview := chapterSyncPreview{Project: in.project, Message: in.message, ProjectFile: in.projectFile, SavedAt: in.savedAt, Kept: kept, Plan: plan}
	if !planned {
		preview.Plan = chaptersync.Build(chaptersync.Input{})
	}
	return preview, nil
}

func (h *Host) chapterSyncSetEnabled(on bool) (chapterSyncState, error) {
	folder := h.services().config.projectFolder
	if folder == "" {
		return chapterSyncState{}, errors.New("open a project before syncing chapters to tracks")
	}
	manifest, err := h.loadOrNewManifest(folder)
	if err != nil {
		return chapterSyncState{}, err
	}
	manifest.ChapterSync = &project.ChapterSync{Enabled: on, DecidedAt: time.Now().UTC()}
	if err := manifest.Save(folder); err != nil {
		return chapterSyncState{}, fmt.Errorf("could not save the chapter sync choice: %w", err)
	}
	return h.runChapterSync(syncTriggerConsent)
}

func (h *Host) chapterSyncUndo(trackGUID string) (chapterSyncState, error) {
	in, err := h.readChapterSyncInputs()
	if err != nil {
		return chapterSyncState{}, err
	}
	if in.store == nil {
		return chapterSyncState{}, errors.New("import a manuscript before undoing a link")
	}
	if _, err := in.store.Undo(in.documentID, trackGUID); err != nil {
		return chapterSyncState{}, err
	}
	state, err := h.chapterSyncState()
	if err != nil {
		return chapterSyncState{}, err
	}
	h.emitChapterSync(state)
	return state, nil
}

// chapterSyncTrigger is a link path's call (a DAW link, an import, a project attach): it runs a sync when the
// narrator consented, and otherwise only tells the UI, which asks when the state says so. It never fails the path
// that called it: a sync that cannot run is logged.
func (h *Host) chapterSyncTrigger(trigger string) {
	if _, err := h.runChapterSync(trigger); err != nil && h.log != nil {
		_ = h.log.Report("chapter_sync_failed", trigger+": "+err.Error())
	}
}

// runChapterSync runs one sync for trigger when consent is on, a manuscript is imported, no import is running and the
// .rpp is readable; otherwise it reads the state. Either way it sends chaptersync:state and returns it.
func (h *Host) runChapterSync(trigger string) (chapterSyncState, error) {
	h.chapterSyncRuns.mu.Lock()
	defer h.chapterSyncRuns.mu.Unlock()
	in, err := h.readChapterSyncInputs()
	if err != nil {
		return chapterSyncState{}, err
	}
	now := time.Now()
	plan, kept, planned, err := in.plan(now)
	if err != nil {
		return chapterSyncState{}, err
	}
	consent, _ := consentOf(in.manifest)
	importing := in.svc.manuscript != nil && !in.svc.manuscript.CanSwitchProject()
	if consent != consentOn || !planned || importing {
		state := in.stateOf(plan, kept, planned)
		h.emitChapterSync(state)
		return state, nil
	}
	written, err := in.store.AutoLink(in.documentID, plan.Requests())
	if err != nil {
		return chapterSyncState{}, err
	}
	if err := chaptersync.NewStore(in.svc.config.projectFolder).Write(plan.Snapshot); err != nil {
		return chapterSyncState{}, err
	}
	state := in.stateOf(plan, kept, planned)
	state.Counts.Linked = len(kept) + len(written)
	newUnmatched := []chaptersync.TrackRef{}
	unmatched := map[string]bool{}
	for _, track := range plan.Unmatched {
		unmatched[track.GUID] = true
	}
	for _, track := range plan.New {
		if unmatched[track.GUID] {
			newUnmatched = append(newUnmatched, track)
		}
	}
	if len(written) > 0 || len(newUnmatched) > 0 {
		if written == nil {
			written = []evidence.TrackMapping{}
		}
		state.Batch = &chapterSyncBatch{At: now.UTC(), Trigger: trigger, Linked: written, NewTracks: newUnmatched}
	}
	h.emitChapterSync(state)
	return state, nil
}

// emitChapterSync sends chaptersync:state, or hands it to a test's sink.
func (h *Host) emitChapterSync(state chapterSyncState) {
	h.mu.RLock()
	ctx, sink := h.ctx, h.chapterSyncEvents
	h.mu.RUnlock()
	if sink != nil {
		sink(state)
		return
	}
	if ctx != nil {
		emitEvent(chapterSyncEvent, state)
	}
}
