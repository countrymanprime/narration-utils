// This file is Phase 2 of docs/prds/proofing-readiness-signals.prd.md: a
// Transcript Compare run's chapter identity and currency (Q4, Q5). When a
// comparison finishes, ComparisonRecorder writes one analysis evidence ledger
// record from the run's own manifest_<run>.txt (source file, start offset and
// played length per compared item, as narration_compare.lua writes them), the
// chapter resolved from the run's chapter title, the manuscript's documentId,
// the model, and the saved project file's time. ComparisonJudge then reads
// that record against the chapter as the saved project has it now. No Lua,
// Python or marker-protocol change: everything here is derived from files the
// comparison already writes.
package proofing

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// ComparisonAnalyzerVersion versions the record this file writes, not
// compare.py: it changes when the payload or the currency rule changes meaning.
const ComparisonAnalyzerVersion = "1"

// A run's outcome as the transcript service reports it. Anything else (a
// cancelled run) writes no record (Phase 2 scope: "no record on cancel").
const (
	OutcomeComplete = "complete"
	OutcomeFailed   = "failed"
)

// How a run's chapter title resolved against the manuscript (Q5).
const (
	ResolutionResolved = "resolved"
	// ResolutionAmbiguous: more than one chapter has the title. The record is
	// written with no chapter id, so no chapter can count it, and each chapter
	// with that title reads unknown until its titles are distinct (Q5).
	ResolutionAmbiguous = "ambiguous"
)

// matchTolerance is how far a compared item's start offset or played length
// may differ from the saved project's and still be the same item: the manifest
// writes %.6f, the .rpp more digits, so a millisecond is far above rounding and
// far below any audible edit.
const matchTolerance = 0.001

// ComparedItem is one manifest line: the source file, its identity when it
// could be read at record time (Path, Size and PartialHash under EL's hash
// policy, never ModTime), and the played range in source seconds.
type ComparedItem struct {
	Path     string  `json:"path"`
	Identity string  `json:"identity,omitempty"`
	Start    float64 `json:"start"`
	Length   float64 `json:"length"`
}

// ComparisonPayload is the ledger record's payload for a comparison.
type ComparisonPayload struct {
	RunID        string         `json:"runId,omitempty"`
	ChapterTitle string         `json:"chapterTitle"`
	Resolution   string         `json:"resolution"`
	Model        string         `json:"model,omitempty"`
	Compared     []ComparedItem `json:"compared"`
}

// ComparisonRun is what the transcript service knows when a run ends.
// ChapterTitle is the chapter the run matched (compare.py's MATCH summary or
// the rows' chapter), or the narrator's chosen chapter for a failed run; empty
// when unknown, and then nothing can be recorded.
type ComparisonRun struct {
	RunID        string
	Outcome      string
	ManifestPath string
	ChapterTitle string
	Model        string
	TrackGUID    string
	FindingCount int
	StartedAt    time.Time
	CompletedAt  time.Time
}

// ChapterResolver resolves a chapter title to its id (manuscript.Service's
// ChapterIDByTitle): ambiguous when more than one chapter has it.
type ChapterResolver interface {
	ChapterIDByTitle(title string) (id string, ambiguous, ok bool)
}

// ComparisonRecorder writes a finished run's ledger record.
type ComparisonRecorder struct {
	Ledger        *evidence.LedgerStore
	Lookup        ChapterResolver
	DocumentID    func() string
	ProjectFolder string
	// ProjectFile is the saved project the narrator chose, with its modified
	// time now (at completion).
	ProjectFile func() (evidence.LedgerProjectFile, error)
}

// Record writes one ledger record for run: complete with the compared set, or
// failed. It writes nothing for a cancelled run, a run with no chapter title,
// a title no chapter has, or before a manuscript is imported. A complete run
// whose manifest cannot be read is an error and is not recorded (a complete
// record with no compared set could never be current, and would hide the
// previous record's coverage).
func (r *ComparisonRecorder) Record(run ComparisonRun) error {
	if run.Outcome != OutcomeComplete && run.Outcome != OutcomeFailed {
		return nil
	}
	title := strings.TrimSpace(run.ChapterTitle)
	if r == nil || r.Ledger == nil || r.Lookup == nil || r.DocumentID == nil || title == "" {
		return nil
	}
	documentID := r.DocumentID()
	if documentID == "" {
		return nil
	}
	chapterID, ambiguous, ok := r.Lookup.ChapterIDByTitle(title)
	if !ok {
		return nil
	}
	payload := ComparisonPayload{RunID: run.RunID, ChapterTitle: title, Resolution: ResolutionResolved, Model: run.Model, Compared: []ComparedItem{}}
	scope := evidence.LedgerScope{DocumentID: documentID, ChapterID: chapterID, TrackGUID: run.TrackGUID}
	if ambiguous {
		payload.Resolution, scope.ChapterID = ResolutionAmbiguous, ""
	}
	outcome := evidence.LedgerFailed
	if run.Outcome == OutcomeComplete {
		outcome = evidence.LedgerComplete
		compared, err := ParseManifest(run.ManifestPath)
		if err != nil {
			return err
		}
		for i := range compared {
			if identity, err := evidence.Identify(compared[i].Path, r.ProjectFolder); err == nil {
				compared[i].Identity = identityKey(identity)
			}
		}
		payload.Compared = compared
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var projectFile evidence.LedgerProjectFile
	if r.ProjectFile != nil {
		projectFile, _ = r.ProjectFile()
	}
	_, err = r.Ledger.Write(evidence.LedgerRecord{
		AnalyzerID: AnalyzerTranscriptCompare, AnalyzerVersion: ComparisonAnalyzerVersion,
		Scope: scope, ProjectFile: projectFile, StartedAt: run.StartedAt.UTC(), CompletedAt: run.CompletedAt.UTC(), Outcome: outcome,
		Counts:  map[string]int{"items": len(payload.Compared), "findings": run.FindingCount},
		Payload: encoded,
	})
	return err
}

// ParseManifest reads manifest_<run>.txt: index|source_file|startoffs|length,
// one line per compared item (narration_compare.lua's prepare_compare). The
// last two fields are numbers, so a source path containing "|" survives. A
// line that does not parse is skipped.
func ParseManifest(path string) ([]ComparedItem, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("could not read the comparison's manifest: %w", err)
	}
	defer func() { _ = file.Close() }()
	items := []ComparedItem{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		fields := strings.Split(strings.TrimRight(scanner.Text(), "\r"), "|")
		if len(fields) < 4 {
			continue
		}
		if _, err := strconv.Atoi(fields[0]); err != nil {
			continue
		}
		start, errStart := strconv.ParseFloat(fields[len(fields)-2], 64)
		length, errLength := strconv.ParseFloat(fields[len(fields)-1], 64)
		if errStart != nil || errLength != nil || !finite(start) || !finite(length) || length < 0 {
			continue
		}
		items = append(items, ComparedItem{Path: strings.Join(fields[1:len(fields)-2], "|"), Start: start, Length: length})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("could not read the comparison's manifest: %w", err)
	}
	return items, nil
}

// ComparisonJudge is Transcript Compare's RunJudge (Q4 option A): current only
// when the chapter's latest run is complete, attributable to this chapter, the
// saved project is newer than the run, and every played item of the chapter's
// confirmed track was in the compared set (extra compared items, such as muted
// ones, do not invalidate it). Covers reads the latest complete run.
func ComparisonJudge(_ context.Context, chapter stages.ChapterContext, view stages.EvidenceView) (RunJudgement, error) {
	if view.Ledger == nil {
		return RunJudgement{Status: RunStatus{State: RunNever}}, nil
	}
	records, err := view.Ledger.List(AnalyzerTranscriptCompare, chapter.ChapterID)
	if err != nil {
		return RunJudgement{}, err
	}
	ambiguous, err := latestAmbiguous(view.Ledger, chapter)
	if err != nil {
		return RunJudgement{}, err
	}
	judgement := RunJudgement{}
	for _, record := range records {
		if record.Outcome == evidence.LedgerComplete {
			if payload, ok := decodeComparison(record); ok {
				judgement.Covers = coverage(payload)
			}
			break
		}
	}
	if ambiguous != nil && (len(records) == 0 || ambiguous.StartedAt.After(records[0].StartedAt)) {
		judgement.Status = unknownRun(stages.CauseIncompleteRun, []string{ambiguous.ID},
			fmt.Sprintf("The last comparison matched “%s”, which is the title of more than one chapter, so it cannot be counted for this one. Give the chapters distinct titles, then run Transcript Compare again.", chapter.Title))
		return judgement, nil
	}
	if len(records) == 0 {
		judgement.Status = RunStatus{State: RunNever}
		return judgement, nil
	}
	judgement.Status = judgeRecord(records[0], chapter, view)
	return judgement, nil
}

func judgeRecord(record evidence.LedgerRecord, chapter stages.ChapterContext, view stages.EvidenceView) RunStatus {
	ids := []string{record.ID}
	if record.Outcome != evidence.LedgerComplete {
		return unknownRun(stages.CauseIncompleteRun, ids, "The last comparison of this chapter did not finish. Run Transcript Compare again.")
	}
	track, problem := chapterTrack(chapter, view)
	if problem != nil {
		status := *problem
		status.RecordIDs = ids
		return status
	}
	payload, ok := decodeComparison(record)
	if !ok {
		return unknownRun(stages.CauseStale, ids, "The record of the last comparison could not be read. Run Transcript Compare again.")
	}
	if record.Scope.DocumentID != "" && record.Scope.DocumentID != chapter.DocumentID {
		return unknownRun(stages.CauseStale, ids, "The last comparison was of an earlier import of the manuscript. Run Transcript Compare again.")
	}
	if record.ProjectFile.Path != "" && view.ProjectFile.Path != "" && !samePath(record.ProjectFile.Path, view.ProjectFile.Path) {
		return unknownRun(stages.CauseStale, ids, "The last comparison was made with a different REAPER project file. Run Transcript Compare again.")
	}
	if !view.ProjectFile.ModTime.After(record.CompletedAt) {
		return unknownRun(stages.CauseStale, ids, fmt.Sprintf("Save the project in REAPER, then check again: the saved project (modified %s) is not newer than the last comparison (%s), so it cannot show that the compared audio is what is saved.",
			view.ProjectFile.ModTime.UTC().Format(time.RFC3339), record.CompletedAt.UTC().Format(time.RFC3339)))
	}
	played := playedItems(track)
	if len(played) == 0 {
		return unknownRun(stages.CauseMeasurementUnavailable, ids, "The chapter's track has no played audio in the saved project.")
	}
	missing, changed, unreadable := matchPlayed(played, payload.Compared, view.ProjectFolder)
	switch {
	case unreadable > 0:
		return unknownRun(stages.CauseStale, ids, fmt.Sprintf("%d audio file(s) on the chapter's track could not be read. Check the files, then run Transcript Compare again.", unreadable))
	case missing > 0 && changed:
		return unknownRun(stages.CauseStale, ids, fmt.Sprintf("The chapter's audio changed since the last comparison (%d of %d played items differ). Run Transcript Compare again.", missing, len(played)))
	case missing > 0:
		return unknownRun(stages.CauseIncompleteRun, ids, fmt.Sprintf("The last comparison did not include %d of the chapter's %d played items. Compare every item on the chapter's track.", missing, len(played)))
	}
	return RunStatus{State: RunCurrent, RecordIDs: ids, Fingerprint: comparedFingerprint(payload.Compared), At: record.CompletedAt}
}

// matchPlayed matches every played item to an unused compared item with the
// same source identity, start offset and played length (a multiset: identical
// copies need one compared line each). missing counts played items with no
// match; changed says a compared line was left over, which means the audio was
// edited rather than left out; unreadable counts played sources that could not
// be identified. The start offset compared is the take's SOFFS, what the
// bridge reads as D_STARTOFFS.
func matchPlayed(played []tracks.Item, compared []ComparedItem, projectFolder string) (missing int, changed bool, unreadable int) {
	used := make([]bool, len(compared))
	for _, item := range played {
		take := item.Active()
		identity, err := evidence.Identify(take.SourceFile, projectFolder)
		if err != nil {
			unreadable++
			continue
		}
		key, length := identityKey(identity), item.Length*take.Rate()
		found := false
		for i, c := range compared {
			if used[i] || c.Identity == "" || c.Identity != key {
				continue
			}
			if math.Abs(c.Start-take.SOFFS) <= matchTolerance && math.Abs(c.Length-length) <= matchTolerance {
				used[i], found = true, true
				break
			}
		}
		if !found {
			missing++
		}
	}
	return missing, slices.Contains(used, false), unreadable
}

// coverage says whether a finding's audio was in a run's compared set: the
// same source file and a source-relative start inside a compared item's
// played range.
func coverage(payload ComparisonPayload) func(findings.Finding) bool {
	return func(f findings.Finding) bool {
		if f.TimeRange == nil || f.TimeRange.SourceStart == nil || f.Source.File == "" {
			return false
		}
		at := *f.TimeRange.SourceStart
		for _, c := range payload.Compared {
			if samePath(c.Path, f.Source.File) && at >= c.Start-matchTolerance && at <= c.Start+c.Length+matchTolerance {
				return true
			}
		}
		return false
	}
}

// latestAmbiguous is the newest record of a run whose title matched more than
// one chapter, when that title is this chapter's.
func latestAmbiguous(ledger *evidence.LedgerStore, chapter stages.ChapterContext) (*evidence.LedgerRecord, error) {
	records, err := ledger.List(AnalyzerTranscriptCompare, "")
	if err != nil {
		return nil, err
	}
	for _, record := range records {
		if record.Scope.ChapterID != "" || record.Scope.DocumentID != chapter.DocumentID {
			continue
		}
		if payload, ok := decodeComparison(record); ok && payload.Resolution == ResolutionAmbiguous && payload.ChapterTitle == strings.TrimSpace(chapter.Title) {
			return &record, nil
		}
	}
	return nil, nil
}

func decodeComparison(record evidence.LedgerRecord) (ComparisonPayload, bool) {
	var payload ComparisonPayload
	if len(record.Payload) == 0 || json.Unmarshal(record.Payload, &payload) != nil {
		return ComparisonPayload{}, false
	}
	return payload, true
}

func unknownRun(cause stages.UnknownCause, ids []string, reason string) RunStatus {
	return RunStatus{State: RunUnknown, Cause: cause, Reason: reason, RecordIDs: ids}
}

// identityKey hashes a source identity's Path, Size and PartialHash, never
// ModTime (a touched file is not a changed one), like EL's own summary.
func identityKey(identity evidence.SourceIdentity) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d:%s|%d|%s", len(identity.Path), identity.Path, identity.Size, identity.PartialHash)))
	return hex.EncodeToString(sum[:])
}

func comparedFingerprint(compared []ComparedItem) string {
	lines := make([]string, 0, len(compared))
	for _, c := range compared {
		lines = append(lines, fmt.Sprintf("%s|%.6f|%.6f", c.Identity, c.Start, c.Length))
	}
	slices.Sort(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(sum[:])
}

// samePath compares two file paths the way a Windows-first app must: cleaned,
// with either separator, and without regard to case.
func samePath(a, b string) bool {
	clean := func(p string) string { return filepath.Clean(strings.ReplaceAll(p, "\\", "/")) }
	return strings.EqualFold(clean(a), clean(b))
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
