// Package chaptersync is the host side of the DAW chapter-track auto-sync PRD
// (docs/prds/daw-chapter-track-auto-sync.prd.md). Phase 2 is here: Build, a
// pure planner that answers "what should be linked" from the manuscript's
// chapters, the saved REAPER project, the stored links and the last sync's
// snapshot, and Store, which keeps that snapshot in
// narration-utils/chapter-sync.json. Nothing here writes a link: the sync
// service (Phase 3) hands Plan.Requests to evidence.MappingStore.AutoLink once
// the narrator has consented for the project (ADR 0202).
package chaptersync

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Input is everything one sync plans against. Links are the stored links of
// both origins; Rejected are the pairs an Undo left; PreviousLinks are the
// links the document before a re-import held (evidence.MappingStore.Previous);
// Previous is the last sync's snapshot (zero for the first sync); Now stamps
// the new snapshot.
type Input struct {
	Chapters      []chaptermatch.Chapter
	Project       tracks.Project
	Links         []evidence.TrackMapping
	Rejected      []evidence.RejectedPair
	PreviousLinks []evidence.TrackMapping
	Previous      Snapshot
	Now           time.Time
}

// Reason says why a chapter was not linked automatically.
type Reason string

const (
	// ReasonAmbiguous: two or more tracks match the chapter (near) equally.
	ReasonAmbiguous Reason = "ambiguous"
	// ReasonUncertain: the best track is only a fuzzy, ambiguous-prefix, take
	// or pickup match.
	ReasonUncertain Reason = "uncertain"
	// ReasonRegion: only a region name matches; a region is offered, never
	// linked (S10).
	ReasonRegion Reason = "region"
	// ReasonRejected: the confident match is a pair the narrator undid.
	ReasonRejected Reason = "rejected"
	// ReasonNotMutual: the chapter's best track matches another chapter
	// better, so the two directions disagree (S4).
	ReasonNotMutual Reason = "not-mutual"
)

// AutoLink is one link the plan makes.
type AutoLink struct {
	TrackGUID    string             `json:"trackGuid"`
	TrackName    string             `json:"trackName"`
	ChapterID    string             `json:"chapterId"`
	ChapterTitle string             `json:"chapterTitle"`
	Match        evidence.LinkMatch `json:"match"`
}

// NeedsYou is a chapter with no link and at least one candidate track that
// the plan will not link on its own. Best is the candidate to preselect.
type NeedsYou struct {
	ChapterID    string                   `json:"chapterId"`
	ChapterTitle string                   `json:"chapterTitle"`
	Reason       Reason                   `json:"reason"`
	Best         *chaptermatch.Candidate  `json:"best"`
	Candidates   []chaptermatch.Candidate `json:"candidates"`
}

// ChapterRef names a chapter.
type ChapterRef struct {
	ChapterID    string `json:"chapterId"`
	ChapterTitle string `json:"chapterTitle"`
}

// TrackRef names a track. Marker is set for a take, pickup or credits name.
type TrackRef struct {
	GUID   string              `json:"guid"`
	Name   string              `json:"name"`
	Index  int                 `json:"index"`
	Marker chaptermatch.Marker `json:"marker"`
}

// PickupTrack is a track named as a chapter's pickup track ("Chapter 6
// (pickups)"). It is recorded, never linked (D32, D33); Phase 8 stores it.
type PickupTrack struct {
	TrackGUID    string `json:"trackGuid"`
	TrackName    string `json:"trackName"`
	ChapterID    string `json:"chapterId"`
	ChapterTitle string `json:"chapterTitle"`
}

// RenamedTrack is a track whose name changed since the last sync. Its link,
// if any, stays (links are keyed by GUID).
type RenamedTrack struct {
	GUID         string `json:"guid"`
	Name         string `json:"name"`
	PreviousName string `json:"previousName"`
}

// MissingTrack is a track the last sync saw, or a link names, that the
// project no longer has. ChapterID is set when it is linked.
type MissingTrack struct {
	TrackGUID string `json:"trackGuid"`
	Name      string `json:"name"`
	ChapterID string `json:"chapterId"`
}

// Plan is Build's answer. New, Changed, Renamed and Missing compare the
// project with Input.Previous; they are empty on the first sync (a zero
// Previous), which is the consent preview rather than a change. Snapshot is
// the state to store for the next sync.
type Plan struct {
	AutoLink     []AutoLink     `json:"autoLink"`
	NeedsYou     []NeedsYou     `json:"needsYou"`
	NoTrack      []ChapterRef   `json:"noTrack"`
	Unmatched    []TrackRef     `json:"unmatched"`
	PickupTracks []PickupTrack  `json:"pickupTracks"`
	New          []TrackRef     `json:"new"`
	Changed      []TrackRef     `json:"changed"`
	Renamed      []RenamedTrack `json:"renamed"`
	Missing      []MissingTrack `json:"missing"`
	Snapshot     Snapshot       `json:"-"`
}

// Requests is the plan's links in the shape MappingStore.AutoLink writes.
func (p Plan) Requests() []evidence.AutoLinkRequest {
	requests := make([]evidence.AutoLinkRequest, 0, len(p.AutoLink))
	for _, link := range p.AutoLink {
		requests = append(requests, evidence.AutoLinkRequest{TrackGUID: link.TrackGUID, ChapterID: link.ChapterID, ChapterTitle: link.ChapterTitle, Match: link.Match})
	}
	return requests
}

// Build plans one sync. It is pure. The rules (ADR 0202):
//   - A stored link, of either origin, is never replaced or removed; its
//     track and chapter take part in nothing else.
//   - A previous link (a re-import) comes back first when its remembered
//     chapter title confidently names a chapter of the new manuscript, the
//     track is still in the project and both are free.
//   - Otherwise a chapter is linked only when its match is confident in both
//     directions from a track name: ForChapter says matched (nothing else
//     within NearEqualMargin) and ForTrack on that track says matched to this
//     chapter. A fuzzy, ambiguous, region-only, take or pickup match never
//     links; a rejected pair never links again.
func Build(in Input) Plan {
	plan := Plan{
		AutoLink: []AutoLink{}, NeedsYou: []NeedsYou{}, NoTrack: []ChapterRef{}, Unmatched: []TrackRef{},
		PickupTracks: []PickupTrack{}, New: []TrackRef{}, Changed: []TrackRef{}, Renamed: []RenamedTrack{}, Missing: []MissingTrack{},
	}
	confirmed := map[string]string{}
	chapterLinked := map[string]bool{}
	for _, link := range in.Links {
		confirmed[link.TrackGUID] = link.ChapterID
		chapterLinked[link.ChapterID] = true
	}
	inProject := map[string]tracks.Track{}
	for _, t := range in.Project.Tracks {
		inProject[t.GUID] = t
	}
	link := func(t tracks.Track, chapter chaptermatch.Chapter, match evidence.LinkMatch) {
		plan.AutoLink = append(plan.AutoLink, AutoLink{TrackGUID: t.GUID, TrackName: t.Name, ChapterID: chapter.ID, ChapterTitle: chapter.Title, Match: match})
		confirmed[t.GUID] = chapter.ID
		chapterLinked[chapter.ID] = true
	}

	candidates := make([]evidence.ChapterCandidate, len(in.Chapters))
	for i, chapter := range in.Chapters {
		candidates[i] = evidence.ChapterCandidate{ID: chapter.ID, Title: chapter.Title}
	}
	for _, suggestion := range evidence.SuggestFromPrevious(in.PreviousLinks, candidates) {
		t, ok := inProject[suggestion.TrackGUID]
		if _, taken := confirmed[suggestion.TrackGUID]; !ok || taken || chapterLinked[suggestion.ChapterID] || rejected(in.Rejected, suggestion.TrackGUID, suggestion.ChapterTitle) {
			continue
		}
		link(t, chaptermatch.Chapter{ID: suggestion.ChapterID, Title: suggestion.ChapterTitle}, evidence.LinkMatch{Score: suggestion.Score, Kind: evidence.MatchPrevious})
	}

	for _, chapter := range in.Chapters {
		if chapterLinked[chapter.ID] {
			continue
		}
		result, err := chaptermatch.ForChapter(chapter.ID, in.Chapters, in.Project, confirmed)
		if err != nil {
			continue
		}
		if len(result.Candidates) == 0 {
			plan.NoTrack = append(plan.NoTrack, ChapterRef{ChapterID: chapter.ID, ChapterTitle: chapter.Title})
			continue
		}
		need := NeedsYou{ChapterID: chapter.ID, ChapterTitle: chapter.Title, Candidates: result.Candidates}
		best := result.Candidates[0]
		need.Best = &best
		switch result.Status {
		case chaptermatch.StatusAmbiguous:
			need.Reason = ReasonAmbiguous
		case chaptermatch.StatusMatched:
			match := *result.Track
			need.Best = &match
			switch {
			case match.Source != chaptermatch.SourceTrackName:
				need.Reason = ReasonRegion
			case !mutual(match.TrackGUID, chapter.ID, in.Chapters, in.Project, confirmed):
				need.Reason = ReasonNotMutual
			case rejected(in.Rejected, match.TrackGUID, chapter.Title):
				need.Reason = ReasonRejected
			default:
				link(inProject[match.TrackGUID], chapter, evidence.LinkMatch{Score: match.Score, Kind: kindOf(match.Score)})
				continue
			}
		default:
			need.Reason = ReasonUncertain
		}
		plan.NeedsYou = append(plan.NeedsYou, need)
	}

	titles := make([]string, len(in.Chapters))
	for i, chapter := range in.Chapters {
		titles[i] = chapter.Title
	}
	for _, t := range in.Project.Tracks {
		if _, linked := confirmed[t.GUID]; linked {
			continue
		}
		match := chaptermatch.MatchTitle(titles, t.Name)
		if match.Marker == chaptermatch.MarkerPickup && match.Index >= 0 {
			plan.PickupTracks = append(plan.PickupTracks, PickupTrack{TrackGUID: t.GUID, TrackName: t.Name, ChapterID: in.Chapters[match.Index].ID, ChapterTitle: in.Chapters[match.Index].Title})
			continue
		}
		if result, err := chaptermatch.ForTrack(t.GUID, in.Chapters, in.Project, confirmed); err == nil && len(result.Candidates) > 0 {
			continue // a candidate of some chapter: it shows under that chapter's Needs you
		}
		plan.Unmatched = append(plan.Unmatched, TrackRef{GUID: t.GUID, Name: t.Name, Index: t.Index, Marker: match.Marker})
	}

	plan.Snapshot = snapshotOf(in.Project, in.Previous, in.Now)
	compare(&plan, in)
	return plan
}

// mutual reports whether trackGUID's own best chapter, by the same rule, is
// chapterID.
func mutual(trackGUID, chapterID string, chapters []chaptermatch.Chapter, project tracks.Project, confirmed map[string]string) bool {
	result, err := chaptermatch.ForTrack(trackGUID, chapters, project, confirmed)
	return err == nil && result.Status == chaptermatch.StatusMatched && result.Chapter != nil && result.Chapter.ChapterID == chapterID && result.Chapter.Source == chaptermatch.SourceTrackName
}

func kindOf(score float64) evidence.MatchKind {
	if score >= chaptermatch.ScoreExact {
		return evidence.MatchExact
	}
	return evidence.MatchContained
}

func rejected(pairs []evidence.RejectedPair, trackGUID, chapterTitle string) bool {
	for _, pair := range pairs {
		if pair.TrackGUID == trackGUID && pair.ChapterTitle == chapterTitle {
			return true
		}
	}
	return false
}

// compare fills New, Changed, Renamed and Missing.
func compare(plan *Plan, in Input) {
	linkedChapter := map[string]string{}
	for _, link := range in.Links {
		linkedChapter[link.TrackGUID] = link.ChapterID
	}
	now := map[string]TrackState{}
	for _, state := range plan.Snapshot.Tracks {
		now[state.GUID] = state
	}
	before := map[string]TrackState{}
	for _, state := range in.Previous.Tracks {
		before[state.GUID] = state
	}
	first := in.Previous.SyncedAt.IsZero() && len(in.Previous.Tracks) == 0

	if !first {
		for _, t := range in.Project.Tracks {
			old, seen := before[t.GUID]
			switch {
			case !seen:
				plan.New = append(plan.New, TrackRef{GUID: t.GUID, Name: t.Name, Index: t.Index})
			default:
				if old.Fingerprint != now[t.GUID].Fingerprint {
					plan.Changed = append(plan.Changed, TrackRef{GUID: t.GUID, Name: t.Name, Index: t.Index})
				}
				if old.Name != t.Name {
					plan.Renamed = append(plan.Renamed, RenamedTrack{GUID: t.GUID, Name: t.Name, PreviousName: old.Name})
				}
			}
		}
	}

	missing := map[string]bool{}
	for _, state := range in.Previous.Tracks {
		if _, still := now[state.GUID]; !still && !missing[state.GUID] {
			missing[state.GUID] = true
			plan.Missing = append(plan.Missing, MissingTrack{TrackGUID: state.GUID, Name: state.Name, ChapterID: linkedChapter[state.GUID]})
		}
	}
	for _, link := range in.Links {
		if _, still := now[link.TrackGUID]; !still && !missing[link.TrackGUID] {
			missing[link.TrackGUID] = true
			plan.Missing = append(plan.Missing, MissingTrack{TrackGUID: link.TrackGUID, ChapterID: link.ChapterID})
		}
	}
}

// Snapshot is what one sync saw: each track's GUID, name and fingerprint.
type Snapshot struct {
	SyncedAt time.Time    `json:"syncedAt"`
	Tracks   []TrackState `json:"tracks"`
}

// TrackState is one track in a Snapshot. ChangedAt is the sync at which the
// track's fingerprint last changed, or it first appeared (Phase 6's "last
// changed"); nil when every sync since the first saw it the same. A rename
// alone is not a change.
type TrackState struct {
	GUID        string     `json:"guid"`
	Name        string     `json:"name"`
	Fingerprint string     `json:"fingerprint"`
	ChangedAt   *time.Time `json:"changedAt,omitempty"`
}

func snapshotOf(project tracks.Project, previous Snapshot, at time.Time) Snapshot {
	first := previous.SyncedAt.IsZero() && len(previous.Tracks) == 0
	before := map[string]TrackState{}
	for _, state := range previous.Tracks {
		before[state.GUID] = state
	}
	synced := at.UTC()
	states := make([]TrackState, 0, len(project.Tracks))
	for _, t := range project.Tracks {
		state := TrackState{GUID: t.GUID, Name: t.Name, Fingerprint: Fingerprint(t)}
		old, seen := before[t.GUID]
		switch {
		case seen && old.Fingerprint == state.Fingerprint:
			state.ChangedAt = old.ChangedAt
		case !first:
			changed := synced
			state.ChangedAt = &changed
		}
		states = append(states, state)
	}
	return Snapshot{SyncedAt: synced, Tracks: states}
}

// Fingerprint is a hash of what the saved project says a track plays: each
// item's GUID, position, length and mute, and its active take's GUID, source
// file, offset, rate and section. It is read from the parsed project alone
// (no file is opened), so it notices an item added, moved, trimmed, muted or
// switched to another take, not a source file rewritten in place; the
// recording check's own fingerprint (evidence.ComputeChapterFingerprint)
// covers that when Phase 6 computes freshness. The name is not part of it.
func Fingerprint(t tracks.Track) string {
	type takeFacts struct {
		GUID     string                 `json:"g"`
		Source   string                 `json:"s"`
		SOFFS    float64                `json:"o"`
		PlayRate float64                `json:"r"`
		Section  *tracks.SectionOffsets `json:"x"`
	}
	type itemFacts struct {
		GUID     string    `json:"g"`
		Position float64   `json:"p"`
		Length   float64   `json:"l"`
		Muted    bool      `json:"m"`
		Take     takeFacts `json:"t"`
	}
	facts := make([]itemFacts, 0, len(t.Items))
	for _, item := range t.Items {
		take := item.Active()
		facts = append(facts, itemFacts{GUID: item.GUID, Position: item.Position, Length: item.Length, Muted: item.Muted,
			Take: takeFacts{GUID: take.GUID, Source: strings.TrimSpace(take.SourceFile), SOFFS: take.SOFFS, PlayRate: take.PlayRate, Section: take.Section}})
	}
	raw, _ := json.Marshal(facts)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
