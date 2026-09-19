package guide

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

type Service struct {
	project, python, backend string
	settings                 *settings.Store
	sidecars                 *process.Supervisor
}

func New(project, python, backend string, store *settings.Store, sidecars *process.Supervisor) *Service {
	return &Service{project: project, python: python, backend: backend, settings: store, sidecars: sidecars}
}
func (s *Service) guidePath() string {
	return filepath.Join(s.project, "ManuscriptGuide", "manuscript_guide.json")
}
func (s *Service) manuscript() string {
	return filepath.Join(s.project, "narration-utils", "manuscript", "manuscript.json")
}
func (s *Service) Entities() ([]map[string]any, error) {
	b, e := os.ReadFile(s.guidePath())
	if e != nil {
		if os.IsNotExist(e) {
			return []map[string]any{}, nil
		}
		return nil, fmt.Errorf("could not read the Story Bible: %w", e)
	}
	var v map[string]any
	if json.Unmarshal(b, &v) != nil || v == nil {
		return nil, fmt.Errorf("the Story Bible data could not be read")
	}
	raw, present := v["entities"]
	if !present || raw == nil {
		return []map[string]any{}, nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("the Story Bible entities data is invalid")
	}
	out := []map[string]any{}
	for _, x := range items {
		if m, ok := x.(map[string]any); ok {
			if err := normalizeEntity(m); err != nil {
				return nil, err
			}
			out = append(out, m)
		} else {
			return nil, fmt.Errorf("the Story Bible entity data is invalid")
		}
	}
	return out, nil
}

// normalizeEntity guarantees the shape the UI renders against. The guide file is
// written by a Python sidecar across several schema generations, so any of
// these can be absent; a missing object must read as empty, never crash the
// Story Bible page after a rebuild.
func normalizeEntity(entity map[string]any) error {
	if _, ok := entity["pronunciation"].(map[string]any); !ok {
		entity["pronunciation"] = map[string]any{}
	}
	if description, ok := entity["description"].(map[string]any); !ok {
		entity["description"] = map[string]any{"text": "", "evidence": map[string]any{}}
	} else if description["evidence"] == nil {
		description["evidence"] = map[string]any{}
	}
	for _, key := range []string{"aliases", "occurrences", "personality_notes", "relationships"} {
		if entity[key] == nil {
			entity[key] = []any{}
			continue
		}
		if _, ok := entity[key].([]any); !ok {
			return fmt.Errorf("the Story Bible %s data is invalid", key)
		}
	}
	if aliases, ok := entity["aliases"].([]any); ok {
		for _, raw := range aliases {
			alias, ok := raw.(map[string]any)
			if !ok {
				return fmt.Errorf("the Story Bible alias data is invalid")
			}
			if _, ok := alias["pronunciation"].(map[string]any); !ok {
				alias["pronunciation"] = map[string]any{}
			}
			if alias["occurrences"] == nil {
				alias["occurrences"] = []any{}
			} else if _, ok := alias["occurrences"].([]any); !ok {
				return fmt.Errorf("the Story Bible alias occurrences data is invalid")
			}
		}
	}
	return nil
}
func (s *Service) Run(args ...string) (string, error) {
	if s.project == "" {
		return "", fmt.Errorf("save the REAPER project and import a manuscript first")
	}
	if s.sidecars == nil {
		return "", fmt.Errorf("the sidecar supervisor is unavailable")
	}
	program, fullArgs, err := s.command(args)
	if err != nil {
		return "", err
	}
	code, out, failure, e := s.sidecars.Run(context.Background(), program, fullArgs...)
	if e != nil {
		return "", e
	}
	if code != 0 {
		message := strings.TrimSpace(failure)
		if message == "" {
			message = strings.TrimSpace(out)
		}
		if message == "" {
			message = "Story Bible sidecar failed"
		}
		return "", fmt.Errorf("%s", message)
	}
	return strings.TrimSpace(string(out)), nil
}

// command supports both development (Python plus an explicit script) and a
// frozen release sidecar (one executable with no backend argument). Requiring
// a script path in the latter mode would make every packaged Story Bible
// operation fail before the sidecar starts.
func (s *Service) command(args []string) (string, []string, error) {
	if _, err := os.Stat(s.python); err != nil {
		return "", nil, fmt.Errorf("configure the Manuscript Guide executable before continuing")
	}
	if s.backend == "" {
		return s.python, args, nil
	}
	if _, err := os.Stat(s.backend); err != nil {
		return "", nil, fmt.Errorf("configure the Manuscript Guide backend before continuing")
	}
	return s.python, append([]string{s.backend}, args...), nil
}
func (s *Service) Build(progress, log string) (string, error) {
	if e := os.MkdirAll(filepath.Dir(s.guidePath()), 0755); e != nil {
		return "", e
	}
	model, _ := s.settings.Effective("ManuscriptGuide", "spacy_model", "en_core_web_sm")
	args := []string{"build", "--manuscript", s.manuscript(), "--out", s.guidePath(), "--progress", progress, "--log", log, "--spacy-model", model}
	return s.Run(args...)
}

func (s *Service) Edit(id, field, value string) error {
	_, err := s.Run(s.editArgs(id, field, value)...)
	return err
}
func (s *Service) editArgs(id, field, value string) []string {
	args := []string{"edit", "--guide", s.guidePath(), "--entity-id", id, "--field", field, "--value", value}
	if field == "aliases" {
		args = append(args, "--manuscript", s.manuscript())
	}
	return args
}
func (s *Service) Rescan(id string) error {
	_, err := s.Run("rescan", "--guide", s.guidePath(), "--manuscript", s.manuscript(), "--entity-id", id)
	return err
}
func (s *Service) Create(name, category string, aliases []string) (string, error) {
	out, err := s.Run(s.createArgs(name, category, aliases)...)
	if err != nil {
		return "", err
	}
	parts := strings.Split(out, "|")
	if len(parts) < 2 || parts[0] != "CREATED" {
		return "", fmt.Errorf("could not create the entity")
	}
	return parts[1], nil
}
func (s *Service) createArgs(name, category string, aliases []string) []string {
	args := []string{"create", "--guide", s.guidePath(), "--manuscript", s.manuscript(), "--name", name, "--category", category, "--aliases", strings.Join(aliases, ";")}
	return args
}
func (s *Service) Merge(source, target string) error {
	_, err := s.Run("merge", "--guide", s.guidePath(), "--source-id", source, "--target-id", target)
	return err
}
func (s *Service) Delete(id string) error {
	_, err := s.Run("delete", "--guide", s.guidePath(), "--entity-id", id)
	return err
}
func (s *Service) Relate(id, other, label string) error {
	_, err := s.Run("relate", "--guide", s.guidePath(), "--entity-id", id, "--other-id", other, "--label", label)
	return err
}
func (s *Service) Unrelate(id, other, label string) error {
	_, err := s.Run("unrelate", "--guide", s.guidePath(), "--entity-id", id, "--other-id", other, "--label", label)
	return err
}

// VocabularyCandidates mirrors the Python Guide's reviewed vocabulary
// suggestions. It preserves the first spelling of each case-insensitive name.
func (s *Service) VocabularyCandidates() ([]string, error) {
	b, err := os.ReadFile(s.guidePath())
	if err != nil {
		return nil, fmt.Errorf("build the Story Bible before requesting vocabulary suggestions")
	}
	var document map[string]any
	if err := json.Unmarshal(b, &document); err != nil {
		return nil, fmt.Errorf("could not read the Story Bible: %w", err)
	}
	seen := map[string]string{}
	add := func(text string) {
		text = strings.TrimSpace(text)
		if text == "" {
			return
		}
		if _, exists := seen[strings.ToLower(text)]; !exists {
			seen[strings.ToLower(text)] = text
		}
	}
	if raw, ok := document["vocabulary_candidates"].([]any); ok {
		for _, value := range raw {
			if text, ok := value.(string); ok {
				add(text)
			}
		}
	} else if entities, ok := document["entities"].([]any); ok {
		// A guide built before the sidecar wrote vocabulary_candidates would
		// otherwise return nothing and make "Suggest from manuscript" look dead;
		// derive the list from the reviewed entities instead. Needs Review
		// entries are excluded, matching the sidecar's own list.
		for _, item := range entities {
			entity, _ := item.(map[string]any)
			if entity == nil || entity["category"] == "Needs Review" || entity["category"] == "Draft" {
				continue
			}
			if name, ok := entity["canonical_name"].(string); ok {
				add(name)
			}
			aliases, _ := entity["aliases"].([]any)
			for _, raw := range aliases {
				if alias, ok := raw.(map[string]any); ok {
					if text, ok := alias["text"].(string); ok {
						add(text)
					}
				}
			}
		}
	}
	values := make([]string, 0, len(seen))
	for _, value := range seen {
		values = append(values, value)
	}
	sort.Slice(values, func(left, right int) bool { return strings.ToLower(values[left]) < strings.ToLower(values[right]) })
	return values, nil
}
func (s *Service) Preview(id string, alias *int, model, provider, version string) ([]byte, error) {
	entities, err := s.Entities()
	if err != nil {
		return nil, err
	}
	var spoken string
	for _, entity := range entities {
		if entity["id"] == id {
			if alias == nil {
				spoken, _ = entity["canonical_name"].(string)
			} else if values, ok := entity["aliases"].([]any); ok && *alias >= 0 && *alias < len(values) {
				if value, ok := values[*alias].(map[string]any); ok {
					spoken, _ = value["text"].(string)
				}
			}
		}
	}
	if strings.TrimSpace(spoken) == "" {
		return nil, fmt.Errorf("the requested Story Bible name no longer exists")
	}
	hash := sha256.Sum256([]byte("narration-utils-tts-preview-v1\x00" + provider + "\x00" + version + "\x00" + spoken))
	name := hex.EncodeToString(hash[:]) + ".wav"
	dir := filepath.Join(s.project, "ManuscriptGuide", "audio", "tts")
	out := filepath.Join(dir, name)
	if _, err := os.Stat(out); err != nil {
		args := []string{"render-audio", "--guide", s.guidePath(), "--entity-id", id, "--audio-dir", dir, "--piper-model", model, "--output-name", name}
		if alias != nil {
			args = append(args, "--alias-index", fmt.Sprint(*alias))
		}
		if _, err = s.Run(args...); err != nil {
			return nil, err
		}
	}
	return os.ReadFile(out)
}
