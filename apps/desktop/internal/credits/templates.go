package credits

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// templatesSchemaVersion is bumped whenever the stored shape of a template
// changes in a way an older reader would misunderstand (persist.CheckVersion).
const templatesSchemaVersion = 1

// Template is one named opening/closing/chapter-announcement credit template
// (PRD Open Question C8). BuiltIn marks a shipped default: the narrator may
// still edit or delete it (this is their library), so BuiltIn is informational
// only, not a lock.
type Template struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"` // "opening" | "closing" | "chapter_announcement"
	Name    string `json:"name"`
	Body    string `json:"body"`
	BuiltIn bool   `json:"builtIn,omitempty"`
}

// defaultTemplates are the shipped starting points from the PRD's "Default
// templates" table: an ACX-minimum opening, an ACX-best-practice closing, and
// a with-copyright variant labelled as a contractual option, not an ACX
// requirement (PRD Evidence, ACX conventions).
var defaultTemplates = []Template{
	{ID: "default-opening-acx-minimum", Kind: "opening", Name: "ACX minimum (opening)", Body: "[Title], written by [Author], narrated by [Narrator].", BuiltIn: true},
	{ID: "default-closing-acx-best-practice", Kind: "closing", Name: "ACX best practice (closing)", Body: "You have been listening to [Title], written by [Author], narrated by [Narrator]. The End.", BuiltIn: true},
	{ID: "default-with-copyright", Kind: "closing", Name: "With copyright (contractual)", Body: "[Title]. Written by [Author]. Read by [Narrator]. Copyright by [Copyright].", BuiltIn: true},
}

type templatesFile struct {
	SchemaVersion int        `json:"schemaVersion"`
	Templates     []Template `json:"templates"`
}

// TemplateStore is the narrator's own credit-template library: a single
// versioned JSON file, one per user (PRD Open Question C7), written with the
// same write-to-temp-then-rename pattern as project.Manifest.Save and
// settings.Store.Save so a crash mid-write never corrupts it.
type TemplateStore struct {
	mu      sync.Mutex
	path    string
	persist atomic.Pointer[persist.Reporter]
}

func NewTemplateStore(path string) *TemplateStore { return &TemplateStore{path: path} }

// SetPersist says where to log and, for a corrupt file, tell the narrator
// (ADR 0069). Template bodies are the narrator's own text, so a file that
// cannot be decoded is kept aside rather than silently discarded.
func (s *TemplateStore) SetPersist(reporter *persist.Reporter) { s.persist.Store(reporter) }

// List returns every template, seeding the shipped defaults on first use (no
// file yet) so a fresh install still offers a starting point.
func (s *TemplateStore) List() ([]Template, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, existed, err := s.readLocked()
	if err != nil {
		return nil, err
	}
	if !existed {
		file.Templates = append([]Template{}, defaultTemplates...)
		if err := s.writeLocked(file); err != nil {
			return nil, err
		}
	}
	return file.Templates, nil
}

// Save creates a new template (empty ID) or updates an existing one in place
// (an ID that already exists), keeping its position. A new template is never
// marked BuiltIn, even when it happens to reuse a shipped ID text - the caller
// only ever passes an ID it read back from List or a previous Save.
func (s *TemplateStore) Save(template Template) (Template, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, _, err := s.readLocked()
	if err != nil {
		return Template{}, err
	}
	if file.Templates == nil {
		file.Templates = append([]Template{}, defaultTemplates...)
	}
	if template.ID == "" {
		template.ID = newTemplateID()
		template.BuiltIn = false
		file.Templates = append(file.Templates, template)
	} else {
		found := false
		for index, existing := range file.Templates {
			if existing.ID == template.ID {
				file.Templates[index] = template
				found = true
				break
			}
		}
		if !found {
			file.Templates = append(file.Templates, template)
		}
	}
	if err := s.writeLocked(file); err != nil {
		return Template{}, err
	}
	return template, nil
}

// Duplicate copies template id as a new, always-editable (never BuiltIn)
// entry named "<original name> copy", so duplicating a shipped default is how
// the narrator starts their own contractual variant without losing the
// original (PRD Proposed Solution, item 1: "duplicate, edit and add to").
func (s *TemplateStore) Duplicate(id string) (Template, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, _, err := s.readLocked()
	if err != nil {
		return Template{}, err
	}
	var original *Template
	for index := range file.Templates {
		if file.Templates[index].ID == id {
			original = &file.Templates[index]
			break
		}
	}
	if original == nil {
		return Template{}, fmt.Errorf("no credit template with id %q", id)
	}
	duplicate := Template{ID: newTemplateID(), Kind: original.Kind, Name: original.Name + " copy", Body: original.Body, BuiltIn: false}
	file.Templates = append(file.Templates, duplicate)
	if err := s.writeLocked(file); err != nil {
		return Template{}, err
	}
	return duplicate, nil
}

// Delete removes template id. The narrator owns this library (PRD "add,
// duplicate, edit and delete"), so a shipped default may be deleted like any
// other entry; deleting an id that is not present is not an error.
func (s *TemplateStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, _, err := s.readLocked()
	if err != nil {
		return err
	}
	next := make([]Template, 0, len(file.Templates))
	for _, existing := range file.Templates {
		if existing.ID != id {
			next = append(next, existing)
		}
	}
	file.Templates = next
	return s.writeLocked(file)
}

func (s *TemplateStore) readLocked() (templatesFile, bool, error) {
	var loaded templatesFile
	found := false
	outcome := s.persist.Load().ReadJSON(s.path, "credit templates", persist.NarratorData, func(bytes []byte) error {
		var decoded templatesFile
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		if err := persist.CheckVersion(decoded.SchemaVersion, templatesSchemaVersion, "credit templates"); err != nil {
			return err
		}
		loaded = decoded
		found = true
		return nil
	})
	if outcome == persist.Unreadable {
		return templatesFile{}, false, fmt.Errorf("your credit templates file could not be read")
	}
	if !found {
		loaded = templatesFile{SchemaVersion: templatesSchemaVersion}
	}
	return loaded, found, nil
}

func (s *TemplateStore) writeLocked(file templatesFile) error {
	if err := persist.CanOverwrite(s.path, "credit templates"); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("could not create the credit templates folder: %w", err)
	}
	file.SchemaVersion = templatesSchemaVersion
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write credit-templates.json: %w", err)
	}
	if err := os.Rename(temporary, s.path); err != nil {
		return fmt.Errorf("could not activate credit-templates.json: %w", err)
	}
	return nil
}

func newTemplateID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("t-%d", time.Now().UnixNano())
	}
	return "t-" + hex.EncodeToString(bytes)
}
