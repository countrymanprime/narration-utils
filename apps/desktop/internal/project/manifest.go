// Package project owns a project's own manifest, project.json: the narrator's own
// project name, creation date and DAW project (.rpp) file link. It also holds the
// Go-side projects-directory helpers (PRD project-workspace-and-daw-link.prd.md,
// Phase 1 and Open Questions W1-W3, W7). It knows nothing about REAPER's file
// format or the settings store; callers pass in whatever migration source
// (Tracks.selectedRpp) they already have.
package project

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credits"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// Marker is the manifest's "this is a Narration Utils project" field (W1): its
// presence and value, not just the file's existence, is what a later projects-
// directory scan (Phase 2) checks before listing a folder as a project.
const Marker = "narration-utils-project"

const fileName = "project.json"

// Manifest is project.json's content: the project's own name, when it was
// created, and its linked DAW project file, if any.
type Manifest struct {
	Marker         string    `json:"marker"`
	Name           string    `json:"name"`
	CreatedAt      time.Time `json:"createdAt"`
	DawProjectFile *DawLink  `json:"dawProjectFile,omitempty"`
	// Credits is this project's own audiobook credit token values (title,
	// author, copyright, ...), added additively (PRD
	// audiobook-credits-templates.prd.md, Open Question C12: use the project
	// manifest directly now that it exists, rather than a separate file). Nil
	// on a project that has never had its credit values saved.
	Credits *credits.Values `json:"credits,omitempty"`
	// RetailSample is the range the narrator picked as the retail sample (audiobook-credits-templates.prd.md, C10,
	// ADR 0152), additive like Credits. Nil when none is picked.
	RetailSample *credits.RetailSample `json:"retailSample,omitempty"`
}

// New returns a fresh manifest for a project named name, created at now.
func New(name string, now time.Time) *Manifest {
	return &Manifest{Marker: Marker, Name: name, CreatedAt: now}
}

// Path is where projectFolder's manifest lives, alongside the project's other
// narration-utils sidecar files (settings.json, manuscript-notes.json, ...).
func Path(projectFolder string) string {
	return filepath.Join(projectFolder, "narration-utils", fileName)
}

// Load reads projectFolder's manifest. A project that has none yet (never
// migrated, never created through the new-project flow) is not an error: ok is
// false and err is nil. reporter may be nil (a test, a caller that does not yet
// have one); project.json is the narrator's own data, so a file that cannot be
// decoded is kept aside and reported rather than silently discarded (ADR 0069),
// matching every other narrator-data file in this codebase (settings, notes).
func Load(reporter *persist.Reporter, projectFolder string) (*Manifest, bool, error) {
	var loaded *Manifest
	outcome := reporter.ReadJSON(Path(projectFolder), "project", persist.NarratorData, func(bytes []byte) error {
		var decoded Manifest
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		loaded = &decoded
		return nil
	})
	if outcome == persist.Missing {
		return nil, false, nil
	}
	if loaded == nil {
		// Healed, Quarantined or Unreadable: persist already logged and, for
		// narrator data, told the narrator and kept the original aside. The
		// caller treats this exactly like "no manifest yet" rather than failing.
		return nil, false, nil
	}
	return loaded, true, nil
}

// Save atomically writes the manifest to projectFolder's project.json, creating
// the narration-utils sidecar folder if needed. It follows the same
// write-to-temp-then-rename pattern as settings.Store.Save and the manuscript
// notes writer, so a crash mid-write never leaves a half-written manifest.
func (m *Manifest) Save(projectFolder string) error {
	path := Path(projectFolder)
	if err := persist.CanOverwrite(path, "project"); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's narration-utils folder: %w", err)
	}
	bytes, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write project.json: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("could not activate project.json: %w", err)
	}
	return nil
}
