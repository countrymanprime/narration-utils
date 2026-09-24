package deliveryprofile

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// storeSchemaVersion is bumped when the stored shape changes in a way an older reader would misunderstand.
const storeSchemaVersion = 1

// FileName is the user-level file of custom profiles and the Global default, beside credit-templates.json.
const FileName = "delivery-profiles.json"

// maxCustomProfiles bounds the file: more than a narrator keeps, few enough that a tampered file cannot grow a binding's answer.
const maxCustomProfiles = 100

// maxNameLength bounds a custom profile's name.
const maxNameLength = 80

// storeFile is delivery-profiles.json. LegacyLimitsMoved records that the Global layer's old Delivery limits were
// moved into a profile once (ADR 0179), so a later run never moves them again.
type storeFile struct {
	SchemaVersion     int       `json:"schemaVersion"`
	Default           *Ref      `json:"defaultProfile,omitempty"`
	LegacyLimitsMoved bool      `json:"legacyLimitsMoved,omitempty"`
	Profiles          []Profile `json:"profiles"`
}

// Store is the narrator's own custom profiles and their Global default: one versioned JSON file per user, written
// through a temporary file and a rename. The built-ins are compiled in and never written here. A file that cannot be
// read is kept aside and reported (persist, ADR 0069), and the built-ins still work.
type Store struct {
	mu      sync.Mutex
	path    string
	persist atomic.Pointer[persist.Reporter]
}

// NewStore opens the store at path; nothing is read or written until it is used.
func NewStore(path string) *Store { return &Store{path: path} }

// SetPersist says where to log and, for a file that cannot be read, tell the narrator.
func (s *Store) SetPersist(reporter *persist.Reporter) { s.persist.Store(reporter) }

// Catalog is every profile the narrator can choose, built-ins first, and the Global default.
type Catalog struct {
	Profiles []Profile `json:"profiles"`
	Default  Ref       `json:"defaultProfile"`
}

// Catalog lists the built-ins and the custom profiles, and the Global default (the newest ACX when none is saved, or
// when the saved one no longer exists).
func (s *Store) Catalog() (Catalog, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Catalog{Profiles: BuiltIns(), Default: refOf(Default())}, err
	}
	profiles := append(BuiltIns(), file.Profiles...)
	return Catalog{Profiles: profiles, Default: refOf(resolveIn(file, file.Default, Default()))}, nil
}

// Resolve answers the profile a saved choice names: a built-in of that version, or a custom profile's latest revision.
// found is false when it names nothing that exists (a deleted custom profile, an unknown version).
func (s *Store) Resolve(ref Ref) (Profile, bool, error) {
	if profile, ok := BuiltIn(ref); ok {
		return profile, true, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Profile{}, false, err
	}
	profile, ok := customIn(file, ref.ID)
	return profile, ok, nil
}

// DefaultProfile answers the Global default's profile.
func (s *Store) DefaultProfile() (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Default(), err
	}
	return resolveIn(file, file.Default, Default()), nil
}

// SetDefault saves the Global default, refusing a profile that does not exist.
func (s *Store) SetDefault(ref Ref) (Ref, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Ref{}, err
	}
	profile, ok := lookupIn(file, ref)
	if !ok {
		return Ref{}, fmt.Errorf("there is no delivery profile %q", ref.ID)
	}
	chosen := refOf(profile)
	file.Default = &chosen
	return chosen, s.writeLocked(file)
}

// Duplicate copies a profile (a built-in or a custom one) into a new custom profile named "<name> copy", based on the
// built-in the original is based on.
func (s *Store) Duplicate(ref Ref) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Profile{}, err
	}
	original, ok := lookupIn(file, ref)
	if !ok {
		return Profile{}, fmt.Errorf("there is no delivery profile %q", ref.ID)
	}
	copied := newCustom(original, original.Title()+" copy", "")
	return copied, s.addLocked(&file, copied)
}

// Save replaces a custom profile's name and rules with profile's (only its numbers and on/off: the rules must be the
// same rules the saved profile holds), bumping its revision. A built-in is never written.
func (s *Store) Save(profile Profile) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Profile{}, err
	}
	for i, saved := range file.Profiles {
		if saved.ID != profile.ID {
			continue
		}
		next, err := applyEdit(saved, profile)
		if err != nil {
			return Profile{}, err
		}
		file.Profiles[i] = next
		return next, s.writeLocked(file)
	}
	if _, builtIn := BuiltIn(Ref{ID: profile.ID}); builtIn {
		return Profile{}, errors.New("a built-in profile cannot be changed; duplicate it to change its numbers")
	}
	return Profile{}, fmt.Errorf("there is no custom delivery profile %q", profile.ID)
}

// Delete removes a custom profile; a built-in cannot be deleted. When it was the Global default, the default goes back
// to the newest ACX. A project that chose it falls back to the Global default when it is next judged.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, builtIn := BuiltIn(Ref{ID: id}); builtIn {
		return errors.New("a built-in profile cannot be deleted")
	}
	file, err := s.readLocked()
	if err != nil {
		return err
	}
	kept := make([]Profile, 0, len(file.Profiles))
	for _, profile := range file.Profiles {
		if profile.ID != id {
			kept = append(kept, profile)
		}
	}
	if len(kept) == len(file.Profiles) {
		return fmt.Errorf("there is no custom delivery profile %q", id)
	}
	file.Profiles = kept
	if file.Default != nil && file.Default.ID == id {
		file.Default = nil
	}
	return s.writeLocked(file)
}

// MoveGlobalLimits moves the Global layer's old Delivery limits into a profile, once (ADR 0179, PRD P6): none set, or
// the same numbers as ACX, leave the Global default as it is; any other set becomes the custom profile "Your limits",
// made the Global default so every project that used them judges the same values the same way. It is a no-op after the
// first run. It answers the profile made, if any.
func (s *Store) MoveGlobalLimits(values map[string]string) (*Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil || file.LegacyLimitsMoved {
		return nil, err
	}
	limits, err := ParseLegacyLimits(values)
	if err != nil {
		// A hand-edited value that is not a number is reported, not guessed at: the move is left for a later run.
		return nil, err
	}
	file.LegacyLimitsMoved = true
	if limits.Set() && !limits.EqualsACX() {
		profile := limits.Profile("Your limits")
		ref := refOf(profile)
		file.Default = &ref
		if err := s.addLocked(&file, profile); err != nil {
			return nil, err
		}
		return &profile, nil
	}
	return nil, s.writeLocked(file)
}

// ChooseForLegacyLimits answers the profile a project whose own settings hold old Delivery limits is judged against
// (values are the project's effective limits, project over Global): ACX when they are ACX's numbers, the Global default
// when they are its numbers, a custom profile already holding exactly them, or else a new custom profile named
// "Your limits (<project>)".
func (s *Store) ChooseForLegacyLimits(values map[string]string, projectName string) (Ref, error) {
	limits, err := ParseLegacyLimits(values)
	if err != nil {
		return Ref{}, err
	}
	if limits.EqualsACX() || !limits.Set() {
		return refOf(Default()), nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Ref{}, err
	}
	for _, profile := range file.Profiles {
		if profile.Note == legacyNote && limits.Matches(profile) {
			return refOf(profile), nil
		}
	}
	name := "Your limits"
	if projectName != "" {
		name = fmt.Sprintf("Your limits (%s)", projectName)
	}
	profile := limits.Profile(name)
	if err := s.addLocked(&file, profile); err != nil {
		return Ref{}, err
	}
	return refOf(profile), nil
}

func (s *Store) addLocked(file *storeFile, profile Profile) error {
	if len(file.Profiles) >= maxCustomProfiles {
		return fmt.Errorf("there are already %d custom delivery profiles; delete one first", maxCustomProfiles)
	}
	file.Profiles = append(file.Profiles, profile)
	return s.writeLocked(*file)
}

// refOf is the saved choice for a profile: a built-in's id and version, a custom profile's id.
func refOf(profile Profile) Ref {
	if profile.BuiltIn {
		return Ref{ID: profile.ID, Version: profile.Version}
	}
	return Ref{ID: profile.ID}
}

func customIn(file storeFile, id string) (Profile, bool) {
	for _, profile := range file.Profiles {
		if profile.ID == id {
			return profile.Clone(), true
		}
	}
	return Profile{}, false
}

// lookupIn finds a profile by a saved choice: a built-in (any version when none is named), else a custom profile.
func lookupIn(file storeFile, ref Ref) (Profile, bool) {
	if profile, ok := BuiltIn(ref); ok {
		return profile, true
	}
	return customIn(file, ref.ID)
}

func resolveIn(file storeFile, ref *Ref, fallback Profile) Profile {
	if ref == nil {
		return fallback
	}
	if profile, ok := lookupIn(file, *ref); ok {
		return profile
	}
	return fallback
}

// newCustom copies base into a new custom profile.
func newCustom(base Profile, name, note string) Profile {
	copied := base.Clone()
	copied.ID, copied.Version, copied.Revision, copied.BuiltIn = newProfileID(), "", 1, false
	copied.Name, copied.Note, copied.Platform = name, note, base.Platform
	if base.BuiltIn {
		copied.BasedOn = base.Key()
	}
	return copied
}

// applyEdit takes the narrator's name and each rule's numbers and on/off from edited onto saved. The rules must be the
// same, in the same order: a copy cannot add, drop or re-kind a rule, and only an adjustable rule's numbers change.
func applyEdit(saved, edited Profile) (Profile, error) {
	name := strings.TrimSpace(edited.Name)
	if name == "" || len([]rune(name)) > maxNameLength {
		return Profile{}, fmt.Errorf("a profile's name must be 1 to %d characters", maxNameLength)
	}
	if len(edited.Rules) != len(saved.Rules) {
		return Profile{}, errors.New("a custom profile keeps the rules it was made with; it cannot add or drop one")
	}
	next := saved.Clone()
	next.Name, next.Revision = name, saved.Revision+1
	for i, rule := range edited.Rules {
		original := &next.Rules[i]
		if rule.ID != original.ID {
			return Profile{}, fmt.Errorf("rule %q is not rule %q of this profile", rule.ID, original.ID)
		}
		original.Off = rule.Off
		if !original.Adjustable() {
			continue
		}
		if (rule.Min == nil) != (original.Min == nil) || (rule.Max == nil) != (original.Max == nil) {
			return Profile{}, fmt.Errorf("%s: a copy can change a bound, not add or remove one", original.Label)
		}
		original.Min, original.Max = copyFloat(rule.Min), copyFloat(rule.Max)
	}
	return next, validateProfile(next)
}

// knownMetrics are the metrics a rule may name: the ones the app measures, and the ones it lists as not checked yet.
var knownMetrics = map[string]bool{
	"integrated_lufs": true, "rms_dbfs": true, "sample_peak_dbfs": true, "true_peak_dbtp": true, "noise_floor_dbfs": true,
	"duration_seconds": true, "sample_rate": true, "channels": true, "head_room_tone_seconds": true,
	"tail_room_tone_seconds": true, "mp3_format": true, "one_section_per_file": true, "credits_files": true,
	"retail_sample_seconds": true, "consistency": true,
}

// validateProfile checks a custom profile as read from the file or about to be written: an id and a name, known
// rules with unique ids, and finite bounds with the lowest not above the highest.
func validateProfile(profile Profile) error {
	if profile.ID == "" || profile.BuiltIn || strings.TrimSpace(profile.Name) == "" || profile.Revision < 1 {
		return fmt.Errorf("custom delivery profile %q has no id, no name or no revision, or claims to be built in", profile.ID)
	}
	seen := map[string]bool{}
	for _, rule := range profile.Rules {
		if rule.ID == "" || seen[rule.ID] {
			return fmt.Errorf("custom delivery profile %q has a rule with no id or a repeated id %q", profile.ID, rule.ID)
		}
		seen[rule.ID] = true
		if !knownMetrics[rule.Metric] || (rule.Scope != ScopeFile && rule.Scope != ScopeBook) {
			return fmt.Errorf("rule %s names %q, which the app does not know", rule.ID, rule.Metric)
		}
		for _, bound := range []*float64{rule.Min, rule.Max} {
			if bound != nil && (math.IsNaN(*bound) || math.IsInf(*bound, 0)) {
				return fmt.Errorf("rule %s has a bound that is not a finite number", rule.ID)
			}
		}
		if rule.Min != nil && rule.Max != nil && *rule.Min > *rule.Max {
			return fmt.Errorf("%s: the lowest (%g) is above the highest (%g)", rule.Label, *rule.Min, *rule.Max)
		}
	}
	return nil
}

func (s *Store) readLocked() (storeFile, error) {
	if s.path == "" {
		return storeFile{SchemaVersion: storeSchemaVersion, Profiles: []Profile{}}, nil
	}
	var loaded storeFile
	found := false
	outcome := s.persist.Load().ReadJSON(s.path, "delivery profiles", persist.NarratorData, func(bytes []byte) error {
		var decoded storeFile
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		if err := persist.CheckVersion(decoded.SchemaVersion, storeSchemaVersion, "delivery profiles"); err != nil {
			return err
		}
		if len(decoded.Profiles) > maxCustomProfiles {
			return fmt.Errorf("the file holds %d custom profiles, more than %d", len(decoded.Profiles), maxCustomProfiles)
		}
		for _, profile := range decoded.Profiles {
			if err := validateProfile(profile); err != nil {
				return err
			}
		}
		loaded, found = decoded, true
		return nil
	})
	if outcome == persist.Unreadable {
		return storeFile{SchemaVersion: storeSchemaVersion}, errors.New("your delivery profiles file could not be read")
	}
	if !found {
		loaded = storeFile{SchemaVersion: storeSchemaVersion}
	}
	if loaded.Profiles == nil {
		loaded.Profiles = []Profile{}
	}
	return loaded, nil
}

func (s *Store) writeLocked(file storeFile) error {
	if s.path == "" {
		return errors.New("custom delivery profiles cannot be saved here")
	}
	if err := persist.CanOverwrite(s.path, "delivery profiles"); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("could not create the delivery profiles folder: %w", err)
	}
	file.SchemaVersion = storeSchemaVersion
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write %s: %w", FileName, err)
	}
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary) // best effort: the rename's error is the one the narrator needs
		return fmt.Errorf("could not activate %s: %w", FileName, err)
	}
	return nil
}

func newProfileID() string {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("custom-%d", time.Now().UnixNano())
	}
	return "custom-" + hex.EncodeToString(bytes)
}
