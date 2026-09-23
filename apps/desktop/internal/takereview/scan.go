// Package takereview is the pickup/duplicate findings scan service (phase 4
// of take-review-pickups-duplicates-take-intelligence.prd.md): it builds
// the Q3 scan scope from the static project model (internal/tracks), runs
// the Transcript Compare sidecar's additive --find-repeats mode, adapts its
// output into findings.Finding records via internal/repeats (which stays
// independent of both the project model and the findings store so it can
// be unit-tested and reused on its own), and saves them into the
// milestone-1 findings store under repeats.AnalyzerName ("take-review").
// It intentionally has no bindings or UI: the scan dialog, real progress
// and cancellation, and the Review page's group detail are phase 5 work.
package takereview

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Scope is the Q3 scan scope: the chapter track's items and all takes of
// those items, plus at most one narrator-designated addition - a pickup
// track (every item on it, in full) or a pickup time range (every item on
// any track whose position overlaps it) - never both. ResolvePickupScope
// reads the addition from layered project settings (Q12's pattern applied
// to Q3); ChapterTrackName always names the track being scanned for this
// one scan, not a standing preference.
type Scope struct {
	ChapterTrackName string
	PickupTrackName  string
	PickupRangeStart *float64
	PickupRangeEnd   *float64
}

// Segment is one read (an item, or one take of an item) to hand the
// sidecar's --find-repeats manifest: item_index|source_file|start_offset|
// length|item_guid|take_guid (compare.py's read_repeat_segments). Length
// and StartOffset follow the same D_LENGTH*playrate / D_STARTOFFS
// convention narration_compare.lua already uses for the single-take
// manifest, so a multi-take item's alternate takes are represented the
// same way an active take already is today.
type Segment struct {
	ItemIndex   int
	SourceFile  string
	StartOffset float64
	Length      float64
	ItemGUID    string
	TakeGUID    string
}

// SidecarOptions are the optional --find-repeats sidecar knobs a caller may
// override; the zero value lets the sidecar use its own defaults.
type SidecarOptions struct {
	Model          string
	Language       string
	MinSpanOverlap float64
}

// Request is one scan's own inputs.
type Request struct {
	// Project is the already-parsed project model (tracks.Parse); the
	// scanner never reads a file itself, so it stays testable with a
	// fixture Project and reusable whether the caller read the project
	// from disk or from a live bridge session.
	Project tracks.Project
	// ProjectPath identifies where the finding came from
	// (findings.Project.Path); typically the project folder.
	ProjectPath    string
	ManuscriptPath string
	ChapterID      string
	ChapterTitle   string
	Scope          Scope
	Thresholds     repeats.Thresholds
	SidecarOptions SidecarOptions
}

// Scanner runs a pickup/duplicate scan and saves the result.
type Scanner struct {
	Runner SidecarRunner
	Store  *findings.Store
}

// minRepeatableSegments is the fewest reads a repeated-span group can ever
// have (internal/repeats.ToFindings already skips any smaller group); a
// scope with fewer segments than this cannot produce a finding, so the
// scanner skips running the sidecar at all rather than paying for
// transcription that can only ever come back empty.
const minRepeatableSegments = 2

// Scan builds the manifest from req.Project and req.Scope, runs the
// sidecar, adapts its output with req.Thresholds, and saves the fresh
// findings into the store under repeats.AnalyzerName and req.ChapterID as
// the scope (findings.Store.SaveAnalyzerFindings's own scope parameter,
// typically a chapter id). It returns the store's merged result: fresh
// findings plus any carried-forward decision history. A scope with fewer
// than two reads is not an error - it saves an empty fresh set so a stale
// prior scan's findings correctly age out as not_in_latest_run rather than
// staying stuck at their last result.
func (s *Scanner) Scan(ctx context.Context, req Request) ([]findings.Finding, error) {
	if s.Store == nil {
		return nil, fmt.Errorf("takereview: no findings store configured")
	}
	segments, err := buildManifest(req.Project, req.Scope)
	if err != nil {
		return nil, err
	}
	if len(segments) < minRepeatableSegments {
		return s.Store.SaveAnalyzerFindings(repeats.AnalyzerName, req.ChapterID, nil)
	}
	if s.Runner == nil {
		return nil, fmt.Errorf("takereview: no sidecar runner configured")
	}

	manifestPath, cleanup, err := writeManifest(segments)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	raw, err := s.Runner.FindRepeats(ctx, SidecarRequest{
		ManifestPath:   manifestPath,
		ManuscriptPath: req.ManuscriptPath,
		TrackName:      req.Scope.ChapterTrackName,
		ChapterTitle:   req.ChapterTitle,
		Model:          req.SidecarOptions.Model,
		Language:       req.SidecarOptions.Language,
		MinSpanOverlap: req.SidecarOptions.MinSpanOverlap,
	})
	if err != nil {
		return nil, err
	}

	groups, err := repeats.ParseOutput(raw)
	if err != nil {
		return nil, fmt.Errorf("takereview: could not parse the repeated-span detector's output: %w", err)
	}

	project := findings.Project{Path: req.ProjectPath}
	manuscript := findings.Manuscript{ChapterID: req.ChapterID, ChapterTitle: req.ChapterTitle}
	fresh := repeats.ToFindings(groups, project, manuscript, req.Thresholds)
	for _, f := range fresh {
		if err := f.Validate(); err != nil {
			return nil, fmt.Errorf("takereview: the repeated-span detector produced an invalid finding: %w", err)
		}
	}

	return s.Store.SaveAnalyzerFindings(repeats.AnalyzerName, req.ChapterID, fresh)
}

// buildManifest resolves scope against project into the segments to scan:
// every take of every item on the chapter track, plus every take of every
// item on the pickup track or within the pickup range, whichever scope
// carries. An item already included from the chapter track is never
// duplicated by the pickup addition (a track can be both, or a pickup
// range can overlap the chapter track's own items).
func buildManifest(project tracks.Project, scope Scope) ([]Segment, error) {
	chapterTrack, ok := trackByName(project, scope.ChapterTrackName)
	if !ok {
		return nil, fmt.Errorf("takereview: chapter track %q not found in the project", scope.ChapterTrackName)
	}

	included := map[string]bool{}
	segments := appendTrackSegments(nil, chapterTrack, included)

	switch {
	case scope.PickupTrackName != "":
		pickupTrack, ok := trackByName(project, scope.PickupTrackName)
		if !ok {
			return nil, fmt.Errorf("takereview: pickup track %q not found in the project", scope.PickupTrackName)
		}
		segments = appendTrackSegments(segments, pickupTrack, included)
	case scope.PickupRangeStart != nil && scope.PickupRangeEnd != nil:
		segments = appendRangeSegments(segments, project, *scope.PickupRangeStart, *scope.PickupRangeEnd, included)
	}

	for i := range segments {
		segments[i].ItemIndex = i
	}
	return segments, nil
}

func trackByName(project tracks.Project, name string) (tracks.Track, bool) {
	for _, t := range project.Tracks {
		if t.Name == name {
			return t, true
		}
	}
	return tracks.Track{}, false
}

func appendTrackSegments(segments []Segment, track tracks.Track, included map[string]bool) []Segment {
	for _, item := range track.Items {
		segments = appendItemSegments(segments, item, included)
	}
	return segments
}

// appendRangeSegments scans every track (the pickup range is a project
// timeline window, not confined to one track - Q3's evidence names pickups
// "recorded on a separate track or later in the timeline") for an item
// whose [Position, Position+Length) overlaps [start, end).
func appendRangeSegments(segments []Segment, project tracks.Project, start, end float64, included map[string]bool) []Segment {
	for _, track := range project.Tracks {
		for _, item := range track.Items {
			if item.Position+item.Length <= start || item.Position >= end {
				continue
			}
			segments = appendItemSegments(segments, item, included)
		}
	}
	return segments
}

func appendItemSegments(segments []Segment, item tracks.Item, included map[string]bool) []Segment {
	if item.GUID == "" || included[item.GUID] {
		return segments
	}
	included[item.GUID] = true
	for _, take := range item.Takes {
		segments = append(segments, Segment{
			SourceFile:  take.SourceFile,
			StartOffset: take.SOFFS,
			Length:      item.Length * playRateOrOne(take.PlayRate),
			ItemGUID:    item.GUID,
			TakeGUID:    take.GUID,
		})
	}
	return segments
}

// playRateOrOne guards against a zero PlayRate (an unset field on a
// hand-built fixture, or malformed source data) turning every segment's
// length into zero rather than the un-rate-adjusted item length.
func playRateOrOne(rate float64) float64 {
	if rate == 0 {
		return 1
	}
	return rate
}

// formatManifest renders segments in compare.py's read_repeat_segments
// line shape, pipe-delimited, no header.
func formatManifest(segments []Segment) string {
	var b strings.Builder
	for _, s := range segments {
		fmt.Fprintf(&b, "%d|%s|%s|%s|%s|%s\n",
			s.ItemIndex, s.SourceFile,
			strconv.FormatFloat(s.StartOffset, 'f', 6, 64),
			strconv.FormatFloat(s.Length, 'f', 6, 64),
			s.ItemGUID, s.TakeGUID)
	}
	return b.String()
}

// writeManifest writes segments to a scratch file the sidecar reads by
// path, since --manifest is a file argument, not stdin. The caller must
// call cleanup once the sidecar run has finished with it.
func writeManifest(segments []Segment) (path string, cleanup func(), err error) {
	file, err := os.CreateTemp("", "take-review-manifest-*.txt")
	if err != nil {
		return "", nil, fmt.Errorf("takereview: could not create a scan manifest file: %w", err)
	}
	cleanup = func() { _ = os.Remove(file.Name()) }
	if _, err := file.WriteString(formatManifest(segments)); err != nil {
		_ = file.Close()
		cleanup()
		return "", nil, fmt.Errorf("takereview: could not write the scan manifest: %w", err)
	}
	if err := file.Close(); err != nil {
		cleanup()
		return "", nil, fmt.Errorf("takereview: could not finish writing the scan manifest: %w", err)
	}
	return file.Name(), cleanup, nil
}
