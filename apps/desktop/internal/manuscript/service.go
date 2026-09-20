package manuscript

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/importer"
)

type ImportJob struct {
	ID            string          `json:"id"`
	Kind          string          `json:"kind"`
	Phase         string          `json:"phase"`
	Message       string          `json:"message"`
	Percent       int             `json:"percent"`
	Logs          []string        `json:"logs"`
	Elapsed       float64         `json:"elapsed"`
	Preview       map[string]any  `json:"preview,omitempty"`
	RequiresReset bool            `json:"requiresReset,omitempty"`
	Result        map[string]any  `json:"result,omitempty"`
	Error         string          `json:"error,omitempty"`
	Source        string          `json:"-"`
	Draft         *importer.Draft `json:"-"`
	started       time.Time
	ended         time.Time
	busy          bool
}

type Service struct {
	mu      sync.Mutex
	notesMu sync.Mutex
	project string
	jobs    map[string]*ImportJob
}

func New(project string) *Service            { return &Service{project: project, jobs: map[string]*ImportJob{}} }
func (s *Service) SetProject(project string) { s.mu.Lock(); defer s.mu.Unlock(); s.project = project }

// CanSwitchProject is deliberately conservative. A prepared preview is
// meaningful user work even though it has no child process, so a second
// REAPER launch must not replace it underneath the current window.
func (s *Service) CanSwitchProject() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, job := range s.jobs {
		switch job.Phase {
		case "success", "error", "cancelled":
			continue
		default:
			return false
		}
	}
	return true
}

func newID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes)
}
func copyJob(job *ImportJob) ImportJob {
	clone := *job
	clone.Logs = append([]string{}, job.Logs...)
	switch {
	case job.started.IsZero():
	case job.ended.IsZero():
		clone.Elapsed = time.Since(job.started).Seconds()
	default:
		clone.Elapsed = job.ended.Sub(job.started).Seconds()
	}
	return clone
}

// report records a real stage of an import: it moves the progress bar and adds
// a line to the activity log in one step, so the two can never disagree
// (ADR-0015). Progress never moves backwards within a job.
func (s *Service) report(job *ImportJob, percent int, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if percent > job.Percent {
		job.Percent = percent
	}
	job.Message = message
	job.Logs = append(job.Logs, message)
}

func (s *Service) fail(job *ImportJob, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job.Phase, job.Error, job.Message = "error", err.Error(), err.Error()
	job.Logs = append(job.Logs, "Failed: "+err.Error())
	job.ended = time.Now()
}

func (s *Service) Begin(source string) ImportJob {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := &ImportJob{ID: newID(), Kind: "manuscript_import", Phase: "preparing", Message: "Manuscript selected. Choose import options to continue.", Percent: 0, Logs: []string{}, Source: source, started: time.Now()}
	s.jobs[job.ID] = job
	return copyJob(job)
}

func (s *Service) State(id string) (ImportJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	if job == nil {
		return ImportJob{}, fmt.Errorf("unknown manuscript import")
	}
	return copyJob(job), nil
}

// beginPreview claims the job for a preview run. A second request while one is
// running (for example a heading-level change) is refused rather than racing.
func (s *Service) beginPreview(id string) (*ImportJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	if job == nil {
		return nil, fmt.Errorf("unknown manuscript import")
	}
	if job.busy {
		return nil, fmt.Errorf("this manuscript import is still working")
	}
	job.busy, job.Phase, job.Error, job.RequiresReset = true, "preparing", "", false
	job.Draft, job.Preview, job.Percent = nil, nil, 0
	job.ended = time.Time{}
	return job, nil
}

// Preview parses the source and blocks until the preview is ready. The desktop
// host uses StartPreview so the UI can show progress while this runs.
func (s *Service) Preview(id string, heading int) (ImportJob, error) {
	job, err := s.beginPreview(id)
	if err != nil {
		return ImportJob{}, err
	}
	s.runPreview(job, heading)
	return s.State(id)
}

// StartPreview runs the preview in the background and returns at once; callers
// poll State for the staged progress and log.
func (s *Service) StartPreview(id string, heading int) (ImportJob, error) {
	job, err := s.beginPreview(id)
	if err != nil {
		return ImportJob{}, err
	}
	go s.runPreview(job, heading)
	return s.State(id)
}

func (s *Service) runPreview(job *ImportJob, heading int) {
	defer func() {
		s.mu.Lock()
		job.busy = false
		s.mu.Unlock()
	}()
	s.report(job, 2, fmt.Sprintf("Selected %s", filepath.Base(job.Source)))
	draft, err := importer.BuildDraftProgress(job.Source, heading, func(percent int, message string) { s.report(job, percent, message) })
	if err != nil {
		s.fail(job, err)
		return
	}
	preview := map[string]any{"format": draft.Format, "sourceName": draft.SourceName, "paragraphCount": len(draft.Paragraphs), "chapterTitles": draft.ChapterTitles, "sections": draft.Sections, "characterCandidates": draft.CharacterCandidates}
	s.report(job, 99, fmt.Sprintf("Preview ready: %d paragraphs, %d chapters, %d character suggestions", len(draft.Paragraphs), len(draft.ChapterTitles), len(draft.CharacterCandidates)))
	s.mu.Lock()
	job.Draft = &draft
	job.Preview = preview
	job.Phase = "ready"
	job.Message = "Review the import preview before activating it."
	job.Percent = 100
	s.mu.Unlock()
}

// PostCommit runs after the canonical manuscript is written and before the job
// reports success (the host seeds the checked character suggestions here). It
// reports its own 0-100 progress and log lines through report.
type PostCommit func(report func(percent int, message string)) error

// Commit activates the previewed manuscript and blocks until it finishes.
func (s *Service) Commit(id string, confirmedReset bool, kinds map[string]string) (ImportJob, error) {
	job, err := s.beginCommit(id, confirmedReset)
	if err != nil || job == nil {
		return s.settled(id, err)
	}
	s.runCommit(job, confirmedReset, kinds, nil)
	return s.State(id)
}

// StartCommit validates synchronously, then activates the manuscript in the
// background so the UI can poll real progress instead of guessing.
func (s *Service) StartCommit(id string, confirmedReset bool, kinds map[string]string, post PostCommit) (ImportJob, error) {
	job, err := s.beginCommit(id, confirmedReset)
	if err != nil || job == nil {
		return s.settled(id, err)
	}
	go s.runCommit(job, confirmedReset, kinds, post)
	return s.State(id)
}

// settled is the return path when there is nothing to run: a validation error,
// or a job that needs the user to confirm a reset first.
func (s *Service) settled(id string, err error) (ImportJob, error) {
	if err != nil {
		return ImportJob{}, err
	}
	return s.State(id)
}

func (s *Service) beginCommit(id string, confirmedReset bool) (*ImportJob, error) {
	s.mu.Lock()
	job := s.jobs[id]
	project := s.project
	s.mu.Unlock()
	if job == nil {
		return nil, fmt.Errorf("unknown manuscript import")
	}
	if job.Draft == nil {
		return nil, fmt.Errorf("preview the manuscript before committing it")
	}
	if project == "" {
		return nil, fmt.Errorf("save the REAPER project before importing a manuscript")
	}
	target := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	s.mu.Lock()
	defer s.mu.Unlock()
	if job.busy {
		return nil, fmt.Errorf("this manuscript import is still working")
	}
	if _, err := os.Stat(target); err == nil && !confirmedReset {
		job.RequiresReset = true
		job.Message = "Replacing a manuscript clears its derived review data. Confirm to continue."
		return nil, nil
	}
	job.busy, job.Phase, job.Percent, job.Error = true, "committing", 0, ""
	job.started, job.ended = time.Now(), time.Time{}
	return job, nil
}

func (s *Service) runCommit(job *ImportJob, confirmedReset bool, kinds map[string]string, post PostCommit) {
	defer func() {
		s.mu.Lock()
		job.busy = false
		s.mu.Unlock()
	}()
	s.mu.Lock()
	project := s.project
	s.mu.Unlock()
	s.report(job, 3, "Preparing the project's manuscript folder")
	if confirmedReset {
		s.report(job, 8, "Clearing derived data: Story Bible, notes, bookmarks, chapter statuses and proofing results")
		if err := resetDerived(project); err != nil {
			s.fail(job, err)
			return
		}
	}
	report := func(percent int, message string) { s.report(job, percent, message) }
	canonical, err := commit(project, job.Source, *job.Draft, kinds, report)
	if err != nil {
		s.fail(job, err)
		return
	}
	if post != nil {
		if err := post(func(percent int, message string) { s.report(job, 85+percent*14/100, message) }); err != nil {
			s.fail(job, err)
			return
		}
	}
	s.report(job, 100, "Manuscript imported")
	s.mu.Lock()
	job.Phase = "success"
	job.Message = "Manuscript imported."
	job.Result = map[string]any{"id": canonical["documentId"], "format": job.Draft.Format, "sourceName": job.Draft.SourceName, "importedAt": canonical["importedAt"]}
	job.ended = time.Now()
	s.mu.Unlock()
}

func (s *Service) Cancel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	if job == nil {
		return fmt.Errorf("unknown manuscript import")
	}
	job.Phase = "cancelled"
	job.Message = "Manuscript import cancelled."
	return nil
}

func (s *Service) Load() (map[string]any, error) {
	s.mu.Lock()
	project := s.project
	s.mu.Unlock()
	if project == "" {
		return nil, fmt.Errorf("save the REAPER project and import a manuscript first")
	}
	bytes, err := os.ReadFile(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"))
	if err != nil {
		return nil, fmt.Errorf("import a manuscript first")
	}
	var data map[string]any
	if err := json.Unmarshal(bytes, &data); err != nil {
		return nil, fmt.Errorf("the canonical manuscript data could not be read")
	}
	if data["schemaVersion"] != float64(1) {
		return nil, fmt.Errorf("this manuscript data uses an unsupported schema version")
	}
	return data, nil
}

func commit(project, source string, draft importer.Draft, kinds map[string]string, report func(percent int, message string)) (map[string]any, error) {
	if report == nil {
		report = func(int, string) {}
	}
	name := filepath.Base(source)
	if info, err := os.Stat(source); err == nil {
		report(15, fmt.Sprintf("Copying %s (%d KB) into the project and computing its checksum", name, info.Size()/1024))
	}
	sourceDir := filepath.Join(project, "narration-utils", "manuscript", "sources", newID())
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		return nil, fmt.Errorf("could not create manuscript storage: %w", err)
	}
	stored := filepath.Join(sourceDir, name)
	input, err := os.Open(source)
	if err != nil {
		return nil, fmt.Errorf("could not open the selected manuscript: %w", err)
	}
	defer func() { _ = input.Close() }() // read-only source
	output, err := os.OpenFile(stored, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("could not store the selected manuscript: %w", err)
	}
	digest := sha256.New()
	if _, err = io.Copy(io.MultiWriter(output, digest), input); err != nil {
		_ = output.Close() // the copy already failed; report that error
		return nil, fmt.Errorf("could not store the selected manuscript: %w", err)
	}
	if err = output.Close(); err != nil {
		return nil, fmt.Errorf("could not store the selected manuscript: %w", err)
	}
	relative, err := filepath.Rel(project, stored)
	if err != nil {
		return nil, fmt.Errorf("could not locate project-owned manuscript storage: %w", err)
	}
	checksum := hex.EncodeToString(digest.Sum(nil))
	report(40, fmt.Sprintf("Stored the original file (sha256 %s…)", checksum[:12]))
	report(50, fmt.Sprintf("Building the canonical manuscript: %d paragraphs", len(draft.Paragraphs)))
	canonical, err := canonicalize(draft, name, filepath.ToSlash(relative), checksum, kinds)
	if err != nil {
		return nil, err
	}
	report(70, "Writing manuscript.json")
	target := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return nil, err
	}
	encoded, err := json.MarshalIndent(canonical, "", "  ")
	if err != nil {
		return nil, err
	}
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, encoded, 0o600); err != nil {
		return nil, err
	}
	if err := os.Rename(temporary, target); err != nil {
		return nil, err
	}
	return canonical, nil
}

func canonicalize(draft importer.Draft, name, storedPath, sha string, kinds map[string]string) (map[string]any, error) {
	kindByTitle := map[string]string{}
	for _, section := range draft.Sections {
		kind := section.ContentKind
		if value, ok := kinds[section.ID]; ok {
			kind = value
		}
		if kind != "narration" && kind != "opening" && kind != "reference" {
			return nil, fmt.Errorf("the selected manuscript section classification is invalid")
		}
		kindByTitle[section.Title] = kind
	}
	chapters := []map[string]any{}
	chapterIndexes := map[string]int{}
	paragraphs := []map[string]any{}
	for _, source := range draft.Paragraphs {
		index, ok := chapterIndexes[source.Chapter]
		if !ok {
			index = len(chapters)
			chapterIndexes[source.Chapter] = index
			chapters = append(chapters, map[string]any{"id": fmt.Sprintf("c-%04d", index+1), "title": source.Chapter, "subtitle": source.ChapterSubtitle, "index": index, "wordCount": 0, "contentKind": kindByTitle[source.Chapter], "sections": []any{}})
		}
		chapter := chapters[index]
		chapter["wordCount"] = chapter["wordCount"].(int) + len(strings.Fields(source.Text))
		chapterID := chapter["id"].(string)
		var sectionID any = nil
		if source.Section != nil && *source.Section != "" {
			sections := chapter["sections"].([]any)
			found := ""
			for _, raw := range sections {
				item := raw.(map[string]any)
				if item["title"] == *source.Section {
					found = item["id"].(string)
				}
			}
			if found == "" {
				found = fmt.Sprintf("%s-s-%03d", chapterID, len(sections)+1)
				sections = append(sections, map[string]any{"id": found, "title": *source.Section})
				chapter["sections"] = sections
			}
			sectionID = found
		}
		paragraph := map[string]any{"id": fmt.Sprintf("p-%06d", len(paragraphs)+1), "index": len(paragraphs), "chapterId": chapterID, "chapterTitle": source.Chapter, "sectionId": sectionID, "text": source.Text, "sourceIndex": source.SourceIndex}
		if len(source.Spans) > 0 {
			paragraph["spans"] = source.Spans
		}
		paragraphs = append(paragraphs, paragraph)
	}
	return map[string]any{"schemaVersion": 1, "documentId": newID(), "importedAt": time.Now().UTC().Format(time.RFC3339Nano), "importer": map[string]any{"format": draft.Format, "version": 1}, "source": map[string]any{"fileName": name, "sha256": sha, "storedPath": storedPath}, "chapters": chapters, "paragraphs": paragraphs}, nil
}

func resetDerived(project string) error {
	for _, path := range []string{filepath.Join(project, "ManuscriptGuide"), filepath.Join(project, "TranscriptCompare"), filepath.Join(project, "narration-utils", "manuscript-notes.json"), filepath.Join(project, ".narration-last-comparison.json")} {
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("could not clear project data: %w", err)
		}
	}
	return nil
}
func (s *Service) Clear() error {
	s.mu.Lock()
	project := s.project
	s.mu.Unlock()
	if project == "" {
		return fmt.Errorf("save the REAPER project first")
	}
	if err := resetDerived(project); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(project, "narration-utils", "manuscript"))
}
