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
	return clone
}

func (s *Service) Begin(source string) ImportJob {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := &ImportJob{ID: newID(), Kind: "manuscript_import", Phase: "preparing", Message: "Manuscript selected. Choose import options to continue.", Percent: 0, Logs: []string{}, Source: source}
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

func (s *Service) Preview(id string, heading int) (ImportJob, error) {
	s.mu.Lock()
	job := s.jobs[id]
	s.mu.Unlock()
	if job == nil {
		return ImportJob{}, fmt.Errorf("unknown manuscript import")
	}
	draft, err := importer.BuildDraft(job.Source, heading)
	if err != nil {
		s.mu.Lock()
		job.Phase = "error"
		job.Error = err.Error()
		job.Message = job.Error
		s.mu.Unlock()
		return copyJob(job), nil
	}
	preview := map[string]any{"format": draft.Format, "sourceName": draft.SourceName, "paragraphCount": len(draft.Paragraphs), "chapterTitles": draft.ChapterTitles, "sections": draft.Sections, "characterCandidates": draft.CharacterCandidates}
	s.mu.Lock()
	job.Draft = &draft
	job.Preview = preview
	job.Phase = "ready"
	job.Message = "Review the import preview before activating it."
	job.Percent = 100
	s.mu.Unlock()
	return copyJob(job), nil
}

func (s *Service) Commit(id string, confirmedReset bool, kinds map[string]string) (ImportJob, error) {
	s.mu.Lock()
	job := s.jobs[id]
	project := s.project
	s.mu.Unlock()
	if job == nil {
		return ImportJob{}, fmt.Errorf("unknown manuscript import")
	}
	if job.Draft == nil {
		return ImportJob{}, fmt.Errorf("preview the manuscript before committing it")
	}
	if project == "" {
		return ImportJob{}, fmt.Errorf("save the REAPER project before importing a manuscript")
	}
	target := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if _, err := os.Stat(target); err == nil && !confirmedReset {
		s.mu.Lock()
		job.RequiresReset = true
		job.Message = "Replacing a manuscript clears its derived review data. Confirm to continue."
		s.mu.Unlock()
		return copyJob(job), nil
	}
	s.mu.Lock()
	job.Phase = "committing"
	job.Message = "Copying the source and activating the canonical manuscript…"
	job.Percent = 10
	s.mu.Unlock()
	if confirmedReset {
		if err := resetDerived(project); err != nil {
			return ImportJob{}, err
		}
	}
	canonical, err := commit(project, job.Source, *job.Draft, kinds)
	if err != nil {
		s.mu.Lock()
		job.Phase = "error"
		job.Error = err.Error()
		job.Message = job.Error
		s.mu.Unlock()
		return copyJob(job), nil
	}
	s.mu.Lock()
	job.Phase = "success"
	job.Percent = 100
	job.Message = "Manuscript imported."
	job.Result = map[string]any{"id": canonical["documentId"], "format": job.Draft.Format, "sourceName": job.Draft.SourceName, "importedAt": canonical["importedAt"]}
	s.mu.Unlock()
	return copyJob(job), nil
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

func commit(project, source string, draft importer.Draft, kinds map[string]string) (map[string]any, error) {
	name := filepath.Base(source)
	sourceDir := filepath.Join(project, "narration-utils", "manuscript", "sources", newID())
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		return nil, fmt.Errorf("could not create manuscript storage: %w", err)
	}
	stored := filepath.Join(sourceDir, name)
	input, err := os.Open(source)
	if err != nil {
		return nil, fmt.Errorf("could not open the selected manuscript: %w", err)
	}
	defer input.Close()
	output, err := os.OpenFile(stored, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("could not store the selected manuscript: %w", err)
	}
	digest := sha256.New()
	if _, err = io.Copy(io.MultiWriter(output, digest), input); err != nil {
		output.Close()
		return nil, fmt.Errorf("could not store the selected manuscript: %w", err)
	}
	if err = output.Close(); err != nil {
		return nil, fmt.Errorf("could not store the selected manuscript: %w", err)
	}
	relative, err := filepath.Rel(project, stored)
	if err != nil {
		return nil, fmt.Errorf("could not locate project-owned manuscript storage: %w", err)
	}
	canonical, err := canonicalize(draft, name, filepath.ToSlash(relative), hex.EncodeToString(digest.Sum(nil)), kinds)
	if err != nil {
		return nil, err
	}
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
		paragraphs = append(paragraphs, map[string]any{"id": fmt.Sprintf("p-%06d", len(paragraphs)+1), "index": len(paragraphs), "chapterId": chapterID, "chapterTitle": source.Chapter, "sectionId": sectionID, "text": source.Text, "sourceIndex": source.SourceIndex})
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
