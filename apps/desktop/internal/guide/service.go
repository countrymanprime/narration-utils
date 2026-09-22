package guide

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

type Service struct {
	persist                  atomic.Pointer[persist.Reporter]
	project, python, backend string
	settings                 *settings.Store
	sidecars                 *process.Supervisor
	previewTimeout           time.Duration
	previewLocksMu           sync.Mutex
	previewLocks             map[string]*sync.Mutex
}

func New(project, python, backend string, store *settings.Store, sidecars *process.Supervisor) *Service {
	return &Service{project: project, python: python, backend: backend, settings: store, sidecars: sidecars, previewTimeout: previewTimeout}
}
func (s *Service) guidePath() string {
	return filepath.Join(s.project, "ManuscriptGuide", "manuscript_guide.json")
}
func (s *Service) manuscript() string {
	return filepath.Join(s.project, "narration-utils", "manuscript", "manuscript.json")
}

// SetPersist says where to report a Story Bible file that cannot be read (ADR 0069).
func (s *Service) SetPersist(reporter *persist.Reporter) { s.persist.Store(reporter) }

// schemaVersion is the newest Story Bible file this host reads; the Python sidecar writes it (manuscript_guide.py SCHEMA_VERSION).
const schemaVersion = 2

func (s *Service) Entities() ([]map[string]any, error) {
	// The entries carry the narrator's edits and locks, so a file that cannot be read is kept aside and the narrator told, and the
	// Story Bible starts empty. A file from a newer version is refused with a message and left exactly as it is.
	var document map[string]any
	var versionErr error
	outcome := s.persist.Load().ReadJSON(s.guidePath(), "Story Bible", persist.NarratorData, func(bytes []byte) error {
		var decoded map[string]any
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		if decoded == nil {
			return fmt.Errorf("not a JSON object")
		}
		version, _ := decoded["schema_version"].(float64)
		if versionErr = persist.CheckVersion(int(version), schemaVersion, "Story Bible"); versionErr != nil {
			return nil
		}
		document = decoded
		return nil
	})
	if versionErr != nil {
		return nil, versionErr
	}
	if outcome == persist.Unreadable {
		return nil, fmt.Errorf("the Story Bible file could not be read")
	}
	if document == nil {
		return []map[string]any{}, nil
	}
	raw, present := document["entities"]
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
	// properties is the narrator's ordered list of {key, value} facts. It is additive (a file written before it has none), so it reads as
	// an empty list, and it stays a list: the host re-marshals this map, and an object would come back with its keys sorted.
	for _, key := range []string{"aliases", "occurrences", "personality_notes", "relationships", "properties"} {
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
	return s.runContext(context.Background(), args...)
}

// runContext is Run with a caller-owned deadline: when ctx ends the supervisor
// kills the sidecar and the call returns.
func (s *Service) runContext(ctx context.Context, args ...string) (string, error) {
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
	code, out, failure, e := s.sidecars.Run(ctx, program, fullArgs...)
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

// RulesOnly is the model argument that builds without a language model: the rules-only extraction, lower quality, chosen for one build.
const RulesOnly = "rules-only"

// Build runs the Story Bible build. model is what the sidecar gives spaCy: the folder of an installed model, a model name, or RulesOnly.
func (s *Service) Build(progress, log, model string) (string, error) {
	if e := os.MkdirAll(filepath.Dir(s.guidePath()), 0755); e != nil {
		return "", e
	}
	args := []string{"build", "--manuscript", s.manuscript(), "--out", s.guidePath(), "--progress", progress, "--log", log, "--spacy-model", model}
	return s.Run(args...)
}

func (s *Service) Edit(id, field, value string) error {
	return s.EditFields(id, map[string]string{field: value})
}

// EditFields changes every field of an entity in one sidecar process. The sidecar applies them all in memory and writes the file once, so a
// field it refuses leaves the file as it was, and a Save of four fields costs one process instead of four (interaction feedback audit, phase 4).
// The fields are sent in name order, so the same edit always produces the same command.
func (s *Service) EditFields(id string, values map[string]string) error {
	if len(values) == 0 {
		return nil
	}
	_, err := s.Run(s.editArgs(id, values)...)
	return err
}
func (s *Service) editArgs(id string, values map[string]string) []string {
	fields := make([]string, 0, len(values))
	for field := range values {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	args := []string{"edit", "--guide", s.guidePath(), "--entity-id", id}
	for _, field := range fields {
		// --value=... and not "--value", "...": argparse takes a value that starts with a dash ("-brave") only in this form.
		args = append(args, "--field", field, "--value="+values[field])
	}
	if _, editsAliases := values["aliases"]; editsAliases {
		args = append(args, "--manuscript", s.manuscript())
	}
	return args
}

// Pronounce sets the pronunciation of an entity's own name (aliasIndex nil) or one of its aliases from exactly the
// named engine ("cmu" or "espeak"), and marks it as the narrator's explicit choice so a rebuild keeps it (D13, B9-B11).
// It is refused on a locked entity (ADR 0007, enforced by the sidecar) and when the chosen engine has nothing for the name.
func (s *Service) Pronounce(id string, aliasIndex *int, source string) error {
	args := []string{"pronounce", "--guide", s.guidePath(), "--entity-id", id, "--source", source}
	if aliasIndex != nil {
		args = append(args, "--alias-index", fmt.Sprint(*aliasIndex))
	}
	_, err := s.Run(args...)
	return err
}
func (s *Service) Rescan(id string) error {
	_, err := s.Run("rescan", "--guide", s.guidePath(), "--manuscript", s.manuscript(), "--entity-id", id)
	return err
}
func (s *Service) Create(name, category string, aliases []string) (string, error) {
	return s.CreateDescribed(name, category, aliases, "")
}

// Property is one labelled fact of an entity ("Codename": "Wren"). The sidecar requires a key, unique whatever its case, and takes an
// empty value; a caller with a labelled line that repeats a label merges the values before it asks for the entity.
type Property struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// CreateDescribed creates an entity that already has its description, in one sidecar process instead of a create and an edit.
func (s *Service) CreateDescribed(name, category string, aliases []string, description string) (string, error) {
	return s.CreateFull(name, category, aliases, description, nil)
}

// CreateFull creates an entity with its description and its properties in one sidecar process. The import of a manuscript's cast blocks
// uses it for the labelled facts of a character (import structure PRD, phase 3).
func (s *Service) CreateFull(name, category string, aliases []string, description string, properties []Property) (string, error) {
	out, err := s.Run(s.createArgs(name, category, aliases, description, properties)...)
	if err != nil {
		return "", err
	}
	parts := strings.Split(out, "|")
	if len(parts) < 2 || parts[0] != "CREATED" {
		return "", fmt.Errorf("could not create the entity")
	}
	return parts[1], nil
}
func (s *Service) createArgs(name, category string, aliases []string, description string, properties []Property) []string {
	args := []string{"create", "--guide", s.guidePath(), "--manuscript", s.manuscript(), "--name", name, "--category", category, "--aliases", strings.Join(aliases, ";")}
	if description != "" {
		args = append(args, "--description="+description)
	}
	if len(properties) > 0 {
		// One JSON list in the --flag=value form, which argparse takes even when the text starts with a dash.
		encoded, _ := json.Marshal(properties) // a slice of two strings cannot fail to encode
		args = append(args, "--properties="+string(encoded))
	}
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

// VocabularyCandidates returns the names Proofing's "Suggest from manuscript"
// offers: the Guide's stored vocabulary_candidates list plus every name derived
// from the current entities, one spelling per case-insensitive name (the first
// seen wins, stored list first), sorted.
//
// The stored list is only an addition. The sidecar writes it at build time, so
// create() seeds it empty and only build() ever refreshes it: choosing the
// stored list whenever it exists made Suggest return nothing on a freshly
// imported project and miss every name added after the last build.
//
// Derived names follow the sidecar's own rule (is_vocabulary_worthy, ADR 0020)
// with one relaxation: an entity the narrator locked or added by hand is always
// offered, whatever its category, because it is theirs (the sidecar checks
// Needs Review first, so it drops such an entity). Auto-extracted Needs Review
// and Draft entities stay out, and a lone word the build is not sure of still
// needs three occurrences.
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
		// Hints are joined with commas for the recognizer, so a name holding a
		// comma or a line break could not survive the round trip.
		if text == "" || strings.ContainsAny(text, ",\r\n") {
			return
		}
		if _, exists := seen[strings.ToLower(text)]; !exists {
			seen[strings.ToLower(text)] = text
		}
	}
	stored, _ := document["vocabulary_candidates"].([]any)
	for _, value := range stored {
		if text, ok := value.(string); ok {
			add(text)
		}
	}
	entities, _ := document["entities"].([]any)
	for _, item := range entities {
		entity, _ := item.(map[string]any)
		if entity == nil || !vocabularyWorthy(entity) {
			continue
		}
		if name, ok := entity["canonical_name"].(string); ok {
			add(name)
		}
		for _, alias := range entityAliasTexts(entity) {
			add(alias)
		}
	}
	values := make([]string, 0, len(seen))
	for _, value := range seen {
		values = append(values, value)
	}
	sort.Slice(values, func(left, right int) bool { return strings.ToLower(values[left]) < strings.ToLower(values[right]) })
	return values, nil
}

// minSingleWordVocabularyOccurrences mirrors MIN_SINGLE_WORD_VOCABULARY_OCCURRENCES
// in the sidecar.
const minSingleWordVocabularyOccurrences = 3

// vocabularyWorthy reports whether an entity's names are offered as vocabulary
// hints. It is the sidecar's is_vocabulary_worthy with locked and manual entities
// checked first.
func vocabularyWorthy(entity map[string]any) bool {
	if locked, _ := entity["locked"].(bool); locked {
		return true
	}
	if manual, _ := entity["manual"].(bool); manual {
		return true
	}
	if entity["category"] == "Needs Review" || entity["category"] == "Draft" {
		return false
	}
	name, _ := entity["canonical_name"].(string)
	if len(strings.Fields(name)) > 1 {
		return true
	}
	count, known := entityOccurrenceCount(entity)
	return !known || count >= minSingleWordVocabularyOccurrences
}

// entityOccurrenceCount is the entity's occurrence_count, or its own occurrences
// plus its aliases' when the guide predates that field. known is false when the
// entity carries no occurrence data at all (an old schema), so it cannot be judged.
func entityOccurrenceCount(entity map[string]any) (count int, known bool) {
	if number, ok := entity["occurrence_count"].(float64); ok {
		return int(number), true
	}
	own, hasOwn := entity["occurrences"].([]any)
	count, known = len(own), hasOwn
	aliases, _ := entity["aliases"].([]any)
	for _, raw := range aliases {
		if alias, ok := raw.(map[string]any); ok {
			if list, ok := alias["occurrences"].([]any); ok {
				count, known = count+len(list), true
			}
		}
	}
	return count, known
}

// entityAliasTexts returns the alias spellings of an entity. Guides from an
// earlier schema store an alias as a plain string; the sidecar normalizes them
// on load, but the host reads the file directly.
func entityAliasTexts(entity map[string]any) []string {
	aliases, _ := entity["aliases"].([]any)
	texts := make([]string, 0, len(aliases))
	for _, raw := range aliases {
		switch alias := raw.(type) {
		case string:
			texts = append(texts, alias)
		case map[string]any:
			if text, ok := alias["text"].(string); ok {
				texts = append(texts, text)
			}
		}
	}
	return texts
}

const (
	// previewTimeout bounds one render-audio run. A cold start of the frozen
	// sidecar loads onnxruntime and a 114 MB voice model before it speaks, so
	// this is generous; it exists so a hung sidecar cannot leave the play
	// button spinning forever.
	previewTimeout = 2 * time.Minute
	// previewCacheTag versions the cache key. Bump it when the key's inputs
	// change so files rendered under the old key are never trusted again (v1
	// ignored the voice id).
	previewCacheTag = "narration-utils-tts-preview-v2"
	// wavHeaderBytes is the size of a canonical WAV header. A file no larger
	// than that holds no samples, so it is never a usable preview.
	wavHeaderBytes = 44
)

// PreviewVoice is the voice a preview is rendered with. Every field is part of
// the cache key except Model, which is the path the sidecar loads.
type PreviewVoice struct{ ID, Model, Provider, Version string }

// previewFileName is the cache file for one voice speaking one text.
func previewFileName(voice PreviewVoice, spoken string) string {
	key := strings.Join([]string{previewCacheTag, voice.ID, voice.Provider, voice.Version, spoken}, "\x00")
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:]) + ".wav"
}

// spokenName returns the text a preview speaks: the entity's name, or one of
// its aliases when alias is set. It is empty when the entry no longer exists.
func spokenName(entities []map[string]any, id string, alias *int) string {
	for _, entity := range entities {
		if entity["id"] != id {
			continue
		}
		if alias == nil {
			spoken, _ := entity["canonical_name"].(string)
			return strings.TrimSpace(spoken)
		}
		values, _ := entity["aliases"].([]any)
		if *alias < 0 || *alias >= len(values) {
			return ""
		}
		value, _ := values[*alias].(map[string]any)
		spoken, _ := value["text"].(string)
		return strings.TrimSpace(spoken)
	}
	return ""
}

// cachedPreview returns a previously rendered WAV. A file with no samples
// (a run that failed before this check existed) is a miss, not audio.
func cachedPreview(path string) ([]byte, bool) {
	audio, err := os.ReadFile(path)
	if err != nil || len(audio) <= wavHeaderBytes {
		return nil, false
	}
	return audio, true
}

// discardPreview removes what a failed run left behind so it cannot be mistaken
// for a cached preview: the file itself when it holds no samples (a valid one is
// never deleted), and the sidecar's "<name>.<pid>.part" temp files. The temp
// files are found by listing the directory, because the project path may hold
// characters filepath.Glob treats as a pattern.
func discardPreview(path string) {
	if _, ok := cachedPreview(path); !ok {
		_ = os.Remove(path)
	}
	dir, name := filepath.Dir(path), filepath.Base(path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), name+".") && strings.HasSuffix(entry.Name(), ".part") {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}

// previewLock returns the lock for one cache file. Two clicks (or an alias and a
// voice change) can ask for the same file while the first render is running; the
// second waits and then finds the cache filled instead of racing the first
// sidecar's rename and cleanup.
func (s *Service) previewLock(name string) *sync.Mutex {
	s.previewLocksMu.Lock()
	defer s.previewLocksMu.Unlock()
	if s.previewLocks == nil {
		s.previewLocks = map[string]*sync.Mutex{}
	}
	if s.previewLocks[name] == nil {
		s.previewLocks[name] = &sync.Mutex{}
	}
	return s.previewLocks[name]
}

// sidecarReason reduces a sidecar failure to the reason it logged: the text
// after its last "ERROR: " line, without the log lines that came before it.
func sidecarReason(err error) error {
	lines := strings.Split(strings.TrimSpace(err.Error()), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if reason, found := strings.CutPrefix(strings.TrimSpace(lines[index]), "ERROR: "); found && reason != "" {
			return errors.New(reason)
		}
	}
	return err
}

// Preview returns a WAV of the voice speaking the entry's name or alias, reusing
// a cached render when one exists. A failed, empty or timed-out render leaves no
// file behind, so the next attempt always starts clean.
func (s *Service) Preview(id string, alias *int, voice PreviewVoice) ([]byte, error) {
	entities, err := s.Entities()
	if err != nil {
		return nil, err
	}
	spoken := spokenName(entities, id, alias)
	if spoken == "" {
		return nil, fmt.Errorf("the requested Story Bible name no longer exists")
	}
	name := previewFileName(voice, spoken)
	dir := filepath.Join(s.project, "ManuscriptGuide", "audio", "tts")
	out := filepath.Join(dir, name)
	lock := s.previewLock(name)
	lock.Lock()
	defer lock.Unlock()
	if audio, ok := cachedPreview(out); ok {
		return audio, nil
	}
	args := []string{"render-audio", "--guide", s.guidePath(), "--entity-id", id, "--audio-dir", dir, "--piper-model", voice.Model, "--output-name", name}
	if alias != nil {
		args = append(args, "--alias-index", fmt.Sprint(*alias))
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.previewTimeout)
	defer cancel()
	if _, err = s.runContext(ctx, args...); err != nil {
		discardPreview(out)
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("the preview took longer than %s and was stopped; try again, and restart the app if it keeps happening", s.previewTimeout.Round(time.Second))
		}
		return nil, sidecarReason(err)
	}
	audio, ok := cachedPreview(out)
	if !ok {
		discardPreview(out)
		return nil, fmt.Errorf("the preview voice produced no audio for %q", spoken)
	}
	return audio, nil
}
