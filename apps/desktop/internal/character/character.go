// Package character implements Phase 3 of
// docs/prds/character-continuity-review.prd.md: listing a saved REAPER
// project's regions with identity, and letting the narrator approve or
// revoke one as a voice reference for a character (or for plain narration,
// Q9). No acoustic analysis happens here - approving a reference is the only
// gate this package enforces, and it produces no findings and never touches
// audio. Phases 4 and 5 (feature extraction, baselines and findings) build
// on this package's References; they are not built yet.
package character

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// NarrationCharacterID is the reserved character id for plain narration as a
// first-class reference subject (Q9): the narrator approves a region as
// "Narration" exactly the way they approve one for a character. It is a
// plain string, like every other character id this package handles, and
// never collides with a Story Bible entity id (ADR 0018's ids are content
// hashes, never this literal value).
const NarrationCharacterID = "narration"

// referencesSchemaVersion is the only references.json version this package
// reads or writes.
const referencesSchemaVersion = 1

// what names the file for the narrator in a persist notice.
const what = "character reference approvals"

// Dir is where this package keeps its data under a project.
// manuscript.resetDerived clears it on a re-import or an explicit Clear: a
// reference names a region of the REAPER project accompanying one specific
// manuscript, and a replaced manuscript's chapters and characters are not
// the ones a stale reference was approved against (Q7).
func Dir(project string) string {
	return filepath.Join(project, "narration-utils", "characters")
}

func referencesPath(project string) string {
	return filepath.Join(Dir(project), "references.json")
}

// RegionSnapshot is what an approval remembers of the region it names, taken
// at approval time (Q2): the region's own name and time range. A live region
// later found by the same GUID is compared against this snapshot, never
// trusted blindly, so moving, renaming or deleting the region after approval
// is visible as "changed since approval" rather than silently changing what
// a later baseline (phase 5) would be built from.
type RegionSnapshot struct {
	Name  string  `json:"name"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// Reference is one approved (or previously approved) voice reference: a
// REAPER region approved for a character id, or for NarrationCharacterID.
// CharacterID is an opaque string this package never validates against the
// Story Bible - a character deleted or merged away there does not remove or
// otherwise change an existing Reference (phase 3's own scope: "opaque
// character ids").
type Reference struct {
	ID          string         `json:"id"`
	CharacterID string         `json:"characterId"`
	RegionGUID  string         `json:"regionGuid"`
	Snapshot    RegionSnapshot `json:"snapshot"`
	ApprovedAt  time.Time      `json:"approvedAt"`
	Note        string         `json:"note,omitempty"`
}

// ApprovedReference is a stored Reference alongside whether the region it
// names still matches what was approved (Q2).
type ApprovedReference struct {
	Reference
	// ChangedSinceApproval is true when the saved project's region no longer
	// exists, or exists with a different name or time range, than the
	// snapshot taken at approval - and also when the saved project cannot be
	// read at all, since a reference that cannot be verified is never
	// reported as still valid.
	ChangedSinceApproval bool `json:"changedSinceApproval"`
}

// referencesFile is references.json: every reference this package has ever
// approved for one project. There is no separate "revoked" list - Revoke
// removes a reference outright (Q7: "revoking removes it and its derived
// features").
type referencesFile struct {
	SchemaVersion int         `json:"schemaVersion"`
	References    []Reference `json:"references"`
}

// Config is what a Service needs. ProjectFile resolves the narrator's chosen,
// saved REAPER project file, mirroring coverage.Config's field of the same
// name and purpose.
type Config struct {
	Project     string
	ProjectFile func() (string, error)
}

// Service lists a project's regions and manages its reference approvals.
type Service struct {
	config Config
	mu     sync.Mutex
	// now stands in for time.Now in tests.
	// +checklocks:mu
	now func() time.Time
	// rename is a test seam for the atomic write below; nil is os.Rename.
	rename func(oldPath, newPath string) error
}

// New returns the service for config.
func New(config Config) *Service {
	return &Service{config: config, now: time.Now}
}

// ListRegions returns the saved project's regions (Q3 option A: parsed
// directly from the saved .rpp, never a live bridge command), in file order.
func (s *Service) ListRegions() ([]tracks.Region, error) {
	project, err := s.savedProject()
	if err != nil {
		return nil, err
	}
	return project.Regions, nil
}

// savedProject resolves and parses the narrator's chosen, saved REAPER
// project file.
func (s *Service) savedProject() (tracks.Project, error) {
	if s.config.ProjectFile == nil {
		return tracks.Project{}, errors.New("no REAPER project file is chosen for this project")
	}
	path, err := s.config.ProjectFile()
	if err != nil {
		return tracks.Project{}, fmt.Errorf("choose the saved REAPER project file on the Tracks page first (%w)", err)
	}
	project, err := tracks.Parse(path)
	if err != nil {
		return tracks.Project{}, fmt.Errorf("could not read %s: %w", filepath.Base(path), err)
	}
	return project, nil
}

func findRegion(regions []tracks.Region, guid string) (tracks.Region, bool) {
	for _, region := range regions {
		if region.GUID != "" && region.GUID == guid {
			return region, true
		}
	}
	return tracks.Region{}, false
}

// referenceID derives a stable id from the character and region, so
// approving the same region for the same character twice updates one
// Reference in place instead of accumulating duplicates.
func referenceID(characterID, regionGUID string) string {
	return findings.StableID("character-reference", characterID, regionGUID)
}

// Approve approves the saved project's region named by regionGUID as a
// voice reference for characterID (a Story Bible entity id, or
// NarrationCharacterID), snapshotting the region's current name and time
// range. Approving the same character and region again refreshes the
// snapshot and note in place (the correction path for a reference the
// narrator re-approves after "changed since approval" is raised, or simply
// to update its note).
func (s *Service) Approve(characterID, regionGUID, note string) (Reference, error) {
	characterID = strings.TrimSpace(characterID)
	regionGUID = strings.TrimSpace(regionGUID)
	if characterID == "" {
		return Reference{}, errors.New("a reference needs a character")
	}
	if regionGUID == "" {
		return Reference{}, errors.New("a reference needs a region")
	}
	project, err := s.savedProject()
	if err != nil {
		return Reference{}, err
	}
	region, ok := findRegion(project.Regions, regionGUID)
	if !ok {
		return Reference{}, fmt.Errorf("region %s is not in the saved project; save the project in REAPER and try again", regionGUID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Reference{}, err
	}
	reference := Reference{
		ID:          referenceID(characterID, regionGUID),
		CharacterID: characterID,
		RegionGUID:  regionGUID,
		Snapshot:    RegionSnapshot{Name: region.Name, Start: region.Start, End: region.End},
		ApprovedAt:  s.now().UTC(),
		Note:        note,
	}
	replaced := false
	for i, existing := range file.References {
		if existing.ID == reference.ID {
			file.References[i] = reference
			replaced = true
			break
		}
	}
	if !replaced {
		file.References = append(file.References, reference)
	}
	if err := s.writeLocked(file); err != nil {
		return Reference{}, err
	}
	return reference, nil
}

// Revoke removes a reference entirely (Q7): the record and, once phases 4
// and 5 exist, everything derived from it. Revoking an id that is not (or no
// longer) stored is not an error, so a caller need not first check whether
// its own revoke already ran.
func (s *Service) Revoke(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return err
	}
	index := -1
	for i, reference := range file.References {
		if reference.ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return nil
	}
	file.References = append(file.References[:index:index], file.References[index+1:]...)
	return s.writeLocked(file)
}

// References lists every stored reference, each annotated with whether the
// region it names has changed since it was approved (Q2).
func (s *Service) References() ([]ApprovedReference, error) {
	s.mu.Lock()
	file, err := s.readLocked()
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	project, projectErr := s.savedProject()
	out := make([]ApprovedReference, 0, len(file.References))
	for _, reference := range file.References {
		changed := true
		if projectErr == nil {
			if region, ok := findRegion(project.Regions, reference.RegionGUID); ok {
				changed = region.Name != reference.Snapshot.Name ||
					region.Start != reference.Snapshot.Start ||
					region.End != reference.Snapshot.End
			}
		}
		out = append(out, ApprovedReference{Reference: reference, ChangedSinceApproval: changed})
	}
	return out, nil
}

// readLocked reads references.json; s.mu must be held.
func (s *Service) readLocked() (referencesFile, error) {
	empty := referencesFile{SchemaVersion: referencesSchemaVersion, References: []Reference{}}
	reporter := (*persist.Reporter)(nil)
	var decoded referencesFile
	newer := 0
	outcome := reporter.ReadJSON(referencesPath(s.config.Project), what, persist.NarratorData, func(raw []byte) error {
		var candidate referencesFile
		if err := json.Unmarshal(raw, &candidate); err != nil {
			return err
		}
		if candidate.SchemaVersion > referencesSchemaVersion {
			newer = candidate.SchemaVersion
			return nil
		}
		decoded = candidate
		return nil
	})
	switch outcome {
	case persist.Missing:
		return empty, nil
	case persist.Quarantined, persist.Healed:
		return referencesFile{}, fmt.Errorf("your %s file could not be read; it was kept aside and a fresh one is started", what)
	case persist.Unreadable:
		return referencesFile{}, fmt.Errorf("your %s file could not be read", what)
	}
	if err := persist.CheckVersion(newer, referencesSchemaVersion, what); err != nil {
		return referencesFile{}, err
	}
	if decoded.References == nil {
		decoded.References = []Reference{}
	}
	return decoded, nil
}

// writeLocked replaces references.json through a temporary file and a
// rename; s.mu must be held.
func (s *Service) writeLocked(file referencesFile) error {
	file.SchemaVersion = referencesSchemaVersion
	path := referencesPath(s.config.Project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's character data folder: %w", err)
	}
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the %s file: %w", what, err)
	}
	rename := os.Rename
	if s.rename != nil {
		rename = s.rename
	}
	if err := rename(temporary, path); err != nil {
		return fmt.Errorf("could not activate the %s file: %w", what, err)
	}
	return nil
}
