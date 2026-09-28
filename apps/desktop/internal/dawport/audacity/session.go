package audacity

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// Session is the Audacity work the PRD's phases 6 to 8 need, over one pipe client: the port's navigate and markers roles, and the
// Audacity-only operations the port has no capability for yet (import findings as labels, read them, mark one reviewed, go to one,
// export a chapter's audio, write the reviewed labels to a hand-off file). Every method is one narrator action and returns only
// when Audacity has answered, so none may be called from a dawport Subscription's Handle.
type Session struct {
	client *audacitybridge.Client
}

var (
	_ dawport.Navigator    = (*Session)(nil)
	_ dawport.MarkerWriter = (*Session)(nil)
)

// NewSession is a session over client.
func NewSession(client *audacitybridge.Client) *Session { return &Session{client: client} }

var (
	// ErrItemTarget: the target names a REAPER item. Audacity has no items, so a place made for REAPER is refused rather than read
	// as a project time it never was.
	ErrItemTarget = errors.New("this finding points at a REAPER item, not at a time in the Audacity project")
	// ErrNoTime: the target has no time to go to.
	ErrNoTime = errors.New("this finding has no time in the Audacity project to go to")
	// ErrLabelNotFound: no label in the project carries the finding's identity.
	ErrLabelNotFound = errors.New("Audacity has no label for this finding: import the findings as labels first")
	// ErrLabelAmbiguous: more than one label carries the finding's identity, so the adapter will not guess which to change.
	ErrLabelAmbiguous = errors.New("Audacity has more than one label for this finding: delete the extra one in Audacity, then try again")
	// ErrLabelLost: Audacity took AddLabel but the new label could not be found again, so it was not named.
	ErrLabelLost = errors.New("Audacity added a label but it could not be found again to name it")
)

// ContextPaddingSeconds is how much audio a loop plays before and after a finding, as REAPER's loop does (bridge.ContextPaddingSeconds).
const ContextPaddingSeconds = 2.0

// markerTolerance is how close an existing label must be to count as the same marker (bridge's add_finding_marker uses 0.15 s).
const markerTolerance = 0.15

// projectTime reads a target as Audacity understands a place: a time in the project. Audacity has no items or takes, so
// SourceStart and SourceEnd are project seconds and a target that names an item was made for REAPER (ErrItemTarget).
func projectTime(target dawport.Target) (start, end float64, err error) {
	if target.ItemGUID != "" || target.TakeGUID != "" {
		return 0, 0, ErrItemTarget
	}
	if target.SourceStart == nil || math.IsNaN(*target.SourceStart) || math.IsInf(*target.SourceStart, 0) || *target.SourceStart < 0 {
		return 0, 0, ErrNoTime
	}
	start, end = *target.SourceStart, *target.SourceStart
	if target.SourceEnd != nil && !math.IsNaN(*target.SourceEnd) && !math.IsInf(*target.SourceEnd, 0) && *target.SourceEnd > start {
		end = *target.SourceEnd
	}
	return start, end, nil
}

// Navigate puts Audacity's cursor at the target's time. It stops playback first, so the cursor is not carried on by a loop.
func (s *Session) Navigate(ctx context.Context, target dawport.Target) (dawport.Navigated, error) {
	start, _, err := projectTime(target)
	if err != nil {
		return dawport.Navigated{}, err
	}
	if err := s.client.Stop(ctx); err != nil {
		return dawport.Navigated{}, err
	}
	if err := s.client.SelectTime(ctx, start, start); err != nil {
		return dawport.Navigated{}, err
	}
	return dawport.Navigated{ProjectTime: start}, nil
}

// Loop selects the target's time with ContextPaddingSeconds either side (never before the project start) and loops it
// (SelectTime, then PlayAtSpeedLooped: stateless, unlike TogglePlayRegion).
func (s *Session) Loop(ctx context.Context, target dawport.Target) (dawport.LoopStarted, error) {
	start, end, err := projectTime(target)
	if err != nil {
		return dawport.LoopStarted{}, err
	}
	start, end = math.Max(0, start-ContextPaddingSeconds), end+ContextPaddingSeconds
	if err := s.client.Stop(ctx); err != nil {
		return dawport.LoopStarted{}, err
	}
	if err := s.client.SelectTime(ctx, start, end); err != nil {
		return dawport.LoopStarted{}, err
	}
	if err := s.client.PlayLooped(ctx); err != nil {
		return dawport.LoopStarted{}, err
	}
	return dawport.LoopStarted{Start: start, End: end}, nil
}

// StopLoop stops playback. Audacity keeps no loop state for the adapter to put back (the loop is only the selection), so nothing
// is restored or kept.
func (s *Session) StopLoop(ctx context.Context) (dawport.LoopStopped, error) {
	if err := s.client.Stop(ctx); err != nil {
		return dawport.LoopStopped{}, err
	}
	return dawport.LoopStopped{}, nil
}

// AddMarker adds one label named marker.Name at the target's start, unless a label with the same text is already within
// markerTolerance of it (Added is then false and nothing changed). Audacity labels have no colour, so marker.Color is not used.
func (s *Session) AddMarker(ctx context.Context, target dawport.Target, marker dawport.Marker) (dawport.MarkerResult, error) {
	start, _, err := projectTime(target)
	if err != nil {
		return dawport.MarkerResult{}, err
	}
	name := strings.Join(strings.Fields(audacitybridge.SanitizeText(marker.Name, maxLabelBytes)), " ")
	if name == "" {
		return dawport.MarkerResult{}, fmt.Errorf("%w: a marker with no name", audacitybridge.ErrInvalidValue)
	}
	labels, err := s.client.Labels(ctx)
	if err != nil {
		return dawport.MarkerResult{}, err
	}
	for _, l := range labels {
		if l.Text == name && math.Abs(l.Start-start) <= markerTolerance {
			return dawport.MarkerResult{Added: false, SourceTime: l.Start, Name: l.Text}, nil
		}
	}
	if err := s.addLabel(ctx, labels, start, start, name); err != nil {
		return dawport.MarkerResult{}, err
	}
	return dawport.MarkerResult{Added: true, SourceTime: start, Name: name}, nil
}

// addLabel adds a label with text at [start, end] on the LabelTrackName track, making that track when the project has none.
// Audacity's AddLabel takes no parameters: it labels the selection on the selected label track, or makes a new label track when
// none is selected. So the adapter selects its own track (or nothing), selects the time, adds, then finds the new, empty label by
// reading the labels again and names it with SetLabel. known is the label list read just before, to tell the new label apart.
func (s *Session) addLabel(ctx context.Context, known []audacitybridge.LabelInfo, start, end float64, text string) error {
	tracks, err := s.client.Tracks(ctx)
	if err != nil {
		return err
	}
	own := -1
	for _, t := range tracks {
		if t.Kind == "label" && t.Name == LabelTrackName {
			own = t.Index
			break
		}
	}
	if own >= 0 {
		err = s.client.SelectTracks(ctx, own, 1)
	} else {
		err = s.client.SelectNone(ctx)
	}
	if err != nil {
		return err
	}
	if err := s.client.SelectTime(ctx, start, end); err != nil {
		return err
	}
	if err := s.client.AddLabel(ctx); err != nil {
		return err
	}
	after, err := s.client.Labels(ctx)
	if err != nil {
		return err
	}
	added, ok := newEmptyLabel(known, after, start, own)
	if !ok {
		return ErrLabelLost
	}
	if err := s.client.SetLabel(ctx, added.Index, audacitybridge.LabelEdit{Text: &text}); err != nil {
		return err
	}
	if own < 0 {
		// AddLabel made a new label track for it: name that track so the next label joins it.
		return s.client.SetTrackName(ctx, added.Track, LabelTrackName)
	}
	return nil
}

// newEmptyLabel finds the label AddLabel just made: an empty label near start that was not in known (compared by track, text and
// time, since indexes shift when a label is inserted before others). It prefers one on track own.
func newEmptyLabel(known, after []audacitybridge.LabelInfo, start float64, own int) (audacitybridge.LabelInfo, bool) {
	before := map[[2]string]int{}
	for _, l := range known {
		before[labelKey(l)]++
	}
	var found []audacitybridge.LabelInfo
	for _, l := range after {
		k := labelKey(l)
		if before[k] > 0 {
			before[k]--
			continue
		}
		if l.Text == "" && math.Abs(l.Start-start) <= markerTolerance {
			found = append(found, l)
		}
	}
	for _, l := range found {
		if l.Track == own {
			return l, true
		}
	}
	if len(found) == 1 {
		return found[0], true
	}
	return audacitybridge.LabelInfo{}, false
}

func labelKey(l audacitybridge.LabelInfo) [2]string {
	return [2]string{fmt.Sprintf("%d|%s", l.Track, l.Text), fmt.Sprintf("%.3f", l.Start)}
}

// Finding is one finding to import as a label: its ID, its place in the project and the words the label shows.
type Finding struct {
	ID         string
	Start, End float64
	Words      string
}

// ImportResult says what an import did: the findings it added a label for, and those that already had one (by identity).
type ImportResult struct {
	Added, Skipped []string
}

// ImportFindings adds a label for each finding that has none yet, in order, and skips one that already has a label carrying its
// identity (reviewed or not), so importing the same findings twice adds nothing the second time (PRD Phase 6). Every finding is
// checked before the first label is written: an invalid ID or time refuses the whole import. The caller shows the narrator the
// preview (PreviewImport) and imports only after approval.
func (s *Session) ImportFindings(ctx context.Context, findings []Finding) (ImportResult, error) {
	texts := make([]string, len(findings))
	for i, f := range findings {
		text, err := FindingLabelText(f.ID, false, f.Words)
		if err != nil {
			return ImportResult{}, err
		}
		if f.Start < 0 || f.End < f.Start || math.IsNaN(f.Start) || math.IsInf(f.End, 0) || math.IsNaN(f.End) {
			return ImportResult{}, fmt.Errorf("%w: finding %s runs from %v to %v", audacitybridge.ErrInvalidValue, f.ID, f.Start, f.End)
		}
		texts[i] = text
	}
	labels, err := s.client.Labels(ctx)
	if err != nil {
		return ImportResult{}, err
	}
	have := map[string]bool{}
	for _, l := range labels {
		if id, _, _, ok := ParseFindingLabel(l.Text); ok {
			have[id] = true
		}
	}
	var result ImportResult
	for i, f := range findings {
		if have[f.ID] {
			result.Skipped = append(result.Skipped, f.ID)
			continue
		}
		if err := s.addLabel(ctx, labels, f.Start, f.End, texts[i]); err != nil {
			return result, fmt.Errorf("finding %s: %w", f.ID, err)
		}
		have[f.ID] = true
		result.Added = append(result.Added, f.ID)
		if labels, err = s.client.Labels(ctx); err != nil {
			return result, err
		}
	}
	return result, nil
}

// PreviewImport says, without writing anything, which findings an import would add and which already have a label.
func (s *Session) PreviewImport(ctx context.Context, findings []Finding) (ImportResult, error) {
	found, err := s.FindingLabels(ctx)
	if err != nil {
		return ImportResult{}, err
	}
	have := map[string]bool{}
	for _, l := range found {
		have[l.ID] = true
	}
	var result ImportResult
	for _, f := range findings {
		if have[f.ID] {
			result.Skipped = append(result.Skipped, f.ID)
		} else {
			result.Added = append(result.Added, f.ID)
		}
	}
	return result, nil
}

// FindingLabel is a label the adapter wrote, read back: which finding, whether reviewed, where it is now and its label number.
type FindingLabel struct {
	ID         string
	Reviewed   bool
	Start, End float64
	Words      string
	Label      audacitybridge.LabelInfo
}

// FindingLabels reads every label that carries a finding's identity, in Audacity's label order. The narrator's own labels are
// left out.
func (s *Session) FindingLabels(ctx context.Context) ([]FindingLabel, error) {
	labels, err := s.client.Labels(ctx)
	if err != nil {
		return nil, err
	}
	var out []FindingLabel
	for _, l := range labels {
		if id, reviewed, words, ok := ParseFindingLabel(l.Text); ok {
			out = append(out, FindingLabel{ID: id, Reviewed: reviewed, Start: l.Start, End: l.End, Words: words, Label: l})
		}
	}
	return out, nil
}

func (s *Session) labelFor(ctx context.Context, id string) (FindingLabel, error) {
	if !validID.MatchString(id) {
		return FindingLabel{}, fmt.Errorf("%w: finding id %q", audacitybridge.ErrInvalidValue, id)
	}
	found, err := s.FindingLabels(ctx)
	if err != nil {
		return FindingLabel{}, err
	}
	var match []FindingLabel
	for _, f := range found {
		if f.ID == id {
			match = append(match, f)
		}
	}
	switch len(match) {
	case 0:
		return FindingLabel{}, ErrLabelNotFound
	case 1:
		return match[0], nil
	default:
		return FindingLabel{}, ErrLabelAmbiguous
	}
}

// GoToFinding selects the finding's label in Audacity (its time range, or the cursor at a point label), wherever the narrator has
// moved it since the import (PRD Phase 7).
func (s *Session) GoToFinding(ctx context.Context, id string) (FindingLabel, error) {
	label, err := s.labelFor(ctx, id)
	if err != nil {
		return FindingLabel{}, err
	}
	if err := s.client.Stop(ctx); err != nil {
		return FindingLabel{}, err
	}
	return label, s.client.SelectTime(ctx, label.Start, label.End)
}

// MarkReviewed rewrites the finding's label as reviewed, in place: its time and words are kept and no label is added (PRD
// Phase 7). changed is false when it was already reviewed.
func (s *Session) MarkReviewed(ctx context.Context, id string) (changed bool, err error) {
	label, err := s.labelFor(ctx, id)
	if err != nil {
		return false, err
	}
	if label.Reviewed {
		return false, nil
	}
	text, err := FindingLabelText(id, true, label.Words)
	if err != nil {
		return false, err
	}
	if err := s.client.SetLabel(ctx, label.Label.Index, audacitybridge.LabelEdit{Text: &text}); err != nil {
		return false, err
	}
	return true, nil
}

// ExportFolder is where the adapter writes, inside the app's project folder: never beside the narrator's own files.
func ExportFolder(projectFolder string) string {
	return filepath.Join(projectFolder, "narration-utils", "audacity")
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// freshPath is folder/base-NN.ext for the first NN whose file does not exist yet, so Audacity is never asked to overwrite (it would
// ask the narrator, and the answer would be held back until the timeout).
func freshPath(folder, base, ext string) (string, error) {
	base = strings.Trim(unsafeName.ReplaceAllString(base, "-"), "-.")
	if base == "" {
		base = "chapter"
	}
	if len(base) > 60 {
		base = base[:60]
	}
	for n := 1; n < 1000; n++ {
		path := filepath.Join(folder, fmt.Sprintf("%s-%02d%s", base, n, ext))
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			return path, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("too many exports named %s in %s", base, folder)
}

// ExportChapter exports [start, end] of the project's audio to a new WAV in ExportFolder(projectFolder), named after chapter, and
// returns its path. The chapter's audio is whatever Audacity plays in that range; the adapter never changes it.
func (s *Session) ExportChapter(ctx context.Context, projectFolder, chapter string, start, end float64) (string, error) {
	if !filepath.IsAbs(projectFolder) {
		return "", fmt.Errorf("%w: the project folder %q is not absolute", audacitybridge.ErrInvalidValue, projectFolder)
	}
	if start < 0 || end <= start {
		return "", fmt.Errorf("%w: a chapter from %v to %v", audacitybridge.ErrInvalidValue, start, end)
	}
	tracks, err := s.client.Tracks(ctx)
	if err != nil {
		return "", err
	}
	channels := 0
	for _, t := range tracks {
		if t.Kind == "wave" && t.Channels > channels {
			channels = t.Channels
		}
	}
	if channels == 0 {
		return "", errors.New("the Audacity project has no audio to export")
	}
	folder := ExportFolder(projectFolder)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return "", err
	}
	path, err := freshPath(folder, chapter, ".wav")
	if err != nil {
		return "", err
	}
	if err := s.client.SelectTime(ctx, start, end); err != nil {
		return "", err
	}
	return path, s.client.Export(ctx, path, min(channels, 2))
}

// WriteReviewedLabels writes the reviewed findings' labels to a new label file in ExportFolder(projectFolder), in Audacity's
// label-file format, and returns its path and how many labels it holds (PRD Phase 8). The app writes the file itself: Audacity's
// ExportLabels opens a dialog and takes no path. It is written to a temporary file and renamed into place.
func (s *Session) WriteReviewedLabels(ctx context.Context, projectFolder string) (string, int, error) {
	if !filepath.IsAbs(projectFolder) {
		return "", 0, fmt.Errorf("%w: the project folder %q is not absolute", audacitybridge.ErrInvalidValue, projectFolder)
	}
	found, err := s.FindingLabels(ctx)
	if err != nil {
		return "", 0, err
	}
	var reviewed []audacitybridge.LabelInfo
	for _, f := range found {
		if f.Reviewed {
			reviewed = append(reviewed, f.Label)
		}
	}
	var buf bytes.Buffer
	if err := WriteLabelFile(&buf, reviewed); err != nil {
		return "", 0, err
	}
	folder := ExportFolder(projectFolder)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return "", 0, err
	}
	path, err := freshPath(folder, "reviewed-labels", ".txt")
	if err != nil {
		return "", 0, err
	}
	tmp, err := os.CreateTemp(folder, ".reviewed-labels-*.tmp")
	if err != nil {
		return "", 0, err
	}
	_, werr := tmp.Write(buf.Bytes())
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		_ = os.Remove(tmp.Name())
		return "", 0, err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		_ = os.Remove(tmp.Name())
		return "", 0, err
	}
	return path, len(reviewed), nil
}

// ProjectInfo is what the adapter can learn of the open project: its tracks, its labels and how long its audio runs. Audacity's
// scripting reports no project file path.
type ProjectInfo struct {
	Tracks   []audacitybridge.TrackInfo
	Labels   int
	Duration float64
}

// Project reads the open project's tracks and labels.
func (s *Session) Project(ctx context.Context) (ProjectInfo, error) {
	tracks, err := s.client.Tracks(ctx)
	if err != nil {
		return ProjectInfo{}, err
	}
	labels, err := s.client.Labels(ctx)
	if err != nil {
		return ProjectInfo{}, err
	}
	info := ProjectInfo{Tracks: tracks, Labels: len(labels)}
	for _, t := range tracks {
		if t.HasRange && t.End > info.Duration {
			info.Duration = t.End
		}
	}
	return info, nil
}
