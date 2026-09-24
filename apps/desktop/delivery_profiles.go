package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// Delivery profiles (delivery-platform-profiles.prd.md Phase 2, ADR 0179): the built-in profiles are compiled into
// internal/deliveryprofile; the narrator's custom profiles and the Global default are the user-level
// delivery-profiles.json (h.deliveryProfiles, set once in NewHost like the credit templates); a project's own choice is
// on its manifest. The old Delivery limits settings are read once more, to move them into a profile, and never again.

// deliverySettingsTool is the settings section that held the narrator's old delivery limits (ADR 0155).
const deliverySettingsTool = "Delivery"

// deliveryProfilesPath resolves the per-user delivery-profiles.json, beside credit-templates.json.
func deliveryProfilesPath() string {
	if value := os.Getenv("APPDATA"); value != "" {
		return filepath.Join(value, "narration-utils", deliveryprofile.FileName)
	}
	if value := os.Getenv("USERPROFILE"); value != "" {
		return filepath.Join(value, "AppData", "Roaming", "narration-utils", deliveryprofile.FileName)
	}
	return filepath.Join("AppData", "Roaming", "narration-utils", deliveryprofile.FileName)
}

// DeliveryProfilesState is what the Delivery page and Settings read: every profile the narrator can choose (built-ins
// first), the Global default, the current project's own choice (nil: the Global default; absent without a project),
// the key of the profile it is judged against, and a notice when a choice could not be used.
type DeliveryProfilesState struct {
	Profiles       []deliveryprofile.Profile `json:"profiles"`
	GlobalDefault  deliveryprofile.Ref       `json:"globalDefault"`
	HasProject     bool                      `json:"hasProject"`
	ProjectChoice  *deliveryprofile.Ref      `json:"projectChoice"`
	ProjectProfile string                    `json:"projectProfile"`
	Notice         string                    `json:"notice,omitempty"`
}

// profileStore answers the host's profile store; a host built without one (a test) judges against the built-ins only.
func (h *Host) profileStore() *deliveryprofile.Store {
	if h.deliveryProfiles != nil {
		return h.deliveryProfiles
	}
	return deliveryprofile.NewStore("")
}

// selectedDeliveryProfile answers the profile the current project is judged against: the project's own choice, else the
// Global default (the newest ACX until the narrator picks another), with a notice when a choice could not be used. It
// first moves any old Delivery limits into a profile (once for the Global layer; for a project whose own settings hold
// limits and that has no choice yet, by saving the choice on its manifest), so a project judges the same values the
// same way it did before profiles.
func (h *Host) selectedDeliveryProfile(svc hostServices) (deliveryprofile.Profile, *deliveryprofile.Ref, string) {
	store := h.profileStore()
	notices := []string{}
	if svc.settings != nil && h.deliveryProfiles != nil {
		if _, err := store.MoveGlobalLimits(svc.settings.Global(deliverySettingsTool)); err != nil {
			notices = append(notices, "Your old Global delivery limits could not be moved into a profile: "+err.Error()+".")
		}
	}
	choice, problem := h.projectDeliveryChoice(svc, store)
	if problem != "" {
		notices = append(notices, problem)
	}
	if choice != nil {
		profile, found, err := store.Resolve(*choice)
		if found {
			return profile, choice, joinNotices(notices)
		}
		if err != nil {
			notices = append(notices, "Your custom delivery profiles could not be read ("+err.Error()+").")
		}
		notices = append(notices, "The delivery profile this project chose is no longer there, so it is judged against the Global default.")
	}
	profile, err := store.DefaultProfile()
	if err != nil {
		notices = append(notices, "Your custom delivery profiles could not be read ("+err.Error()+"); the built-in profiles still work.")
	}
	return profile, choice, joinNotices(notices)
}

func joinNotices(notices []string) string {
	kept := []string{}
	for _, notice := range notices {
		if notice != "" {
			kept = append(kept, notice)
		}
	}
	return strings.Join(kept, " ")
}

// projectDeliveryChoice reads the project's own choice from its manifest, first moving the project's own old limits
// into one when it has none.
func (h *Host) projectDeliveryChoice(svc hostServices, store *deliveryprofile.Store) (*deliveryprofile.Ref, string) {
	folder := svc.config.projectFolder
	if folder == "" {
		return nil, ""
	}
	manifest, ok, err := project.Load(h.persist, folder)
	if err != nil {
		return nil, "The project manifest could not be read, so the Global default profile judges it: " + err.Error() + "."
	}
	if ok && manifest != nil && manifest.DeliveryProfile != nil {
		return &deliveryprofile.Ref{ID: manifest.DeliveryProfile.ID, Version: manifest.DeliveryProfile.Version}, ""
	}
	if svc.settings == nil || h.deliveryProfiles == nil || !hasLegacyLimits(svc.settings.Project(deliverySettingsTool)) {
		return nil, ""
	}
	values := map[string]string{}
	for _, key := range deliveryprofile.LegacyKeys {
		values[key], _ = svc.settings.Effective(deliverySettingsTool, key, "")
	}
	ref, err := store.ChooseForLegacyLimits(values, svc.config.projectName)
	if err != nil {
		return nil, "This project's old delivery limits could not be moved into a profile: " + err.Error() + "."
	}
	if !ok || manifest == nil {
		manifest = project.New(svc.config.projectName, time.Now())
	}
	manifest.DeliveryProfile = &project.DeliveryProfileRef{ID: ref.ID, Version: ref.Version}
	if err := manifest.Save(folder); err != nil {
		return &ref, "This project's choice of profile could not be saved: " + err.Error() + "."
	}
	return &ref, ""
}

func hasLegacyLimits(values map[string]string) bool {
	for _, key := range deliveryprofile.LegacyKeys {
		if values[key] != "" {
			return true
		}
	}
	return false
}

// deliveryProfilesState gathers what DeliveryProfiles answers.
func (h *Host) deliveryProfilesState() (DeliveryProfilesState, error) {
	svc := h.services()
	profile, choice, notice := h.selectedDeliveryProfile(svc)
	catalog, err := h.profileStore().Catalog()
	if err != nil {
		notice = joinNotices([]string{notice, "Your custom delivery profiles could not be read (" + err.Error() + "); the built-in profiles still work."})
	}
	return DeliveryProfilesState{
		Profiles: catalog.Profiles, GlobalDefault: catalog.Default, HasProject: svc.config.projectFolder != "",
		ProjectChoice: choice, ProjectProfile: profile.Key(), Notice: notice,
	}, nil
}

// selectDeliveryProfile saves a choice: scope "global" sets the Global default; scope "project" sets the current
// project's own choice on its manifest, and an empty id clears it (the Global default then judges the project).
func (h *Host) selectDeliveryProfile(scope, id, version string) (DeliveryProfilesState, error) {
	store := h.profileStore()
	ref := deliveryprofile.Ref{ID: id, Version: version}
	switch scope {
	case "global":
		if _, err := store.SetDefault(ref); err != nil {
			return DeliveryProfilesState{}, err
		}
	case "project":
		folder := h.services().config.projectFolder
		if folder == "" {
			return DeliveryProfilesState{}, errors.New("open a project before choosing its delivery profile")
		}
		var chosen *project.DeliveryProfileRef
		if id != "" {
			profile, found, err := store.Resolve(ref)
			if err != nil {
				return DeliveryProfilesState{}, err
			}
			if !found {
				return DeliveryProfilesState{}, fmt.Errorf("there is no delivery profile %q", id)
			}
			if profile.BuiltIn {
				chosen = &project.DeliveryProfileRef{ID: profile.ID, Version: profile.Version}
			} else {
				chosen = &project.DeliveryProfileRef{ID: profile.ID}
			}
		}
		manifest, ok, err := project.Load(h.persist, folder)
		if err != nil {
			return DeliveryProfilesState{}, fmt.Errorf("could not read the project manifest: %w", err)
		}
		if !ok || manifest == nil {
			manifest = project.New(h.services().config.projectName, time.Now())
		}
		manifest.DeliveryProfile = chosen
		if err := manifest.Save(folder); err != nil {
			return DeliveryProfilesState{}, fmt.Errorf("could not save the project's delivery profile: %w", err)
		}
	default:
		return DeliveryProfilesState{}, fmt.Errorf("unsupported scope %q: choose global or project", scope)
	}
	return h.deliveryProfilesState()
}

// ruleEdit is one rule of a custom profile as the editor sends it: its id, whether it is off, and its bounds.
type ruleEdit struct {
	ID  string   `json:"id"`
	Off bool     `json:"off"`
	Min *float64 `json:"min"`
	Max *float64 `json:"max"`
}

// profileEdit is a custom profile as the editor sends it.
type profileEdit struct {
	ID    string     `json:"id"`
	Name  string     `json:"name"`
	Rules []ruleEdit `json:"rules"`
}

// maxProfileEditBytes bounds what the editor may send: a profile's name and a few dozen rules.
const maxProfileEditBytes = 64 << 10

// saveDeliveryProfile saves a custom profile's name, numbers and rules turned off (Phase 4); the store refuses a
// built-in, a new rule, a dropped rule or a changed kind of bound.
func (h *Host) saveDeliveryProfile(edit string) (deliveryprofile.Profile, error) {
	if len(edit) > maxProfileEditBytes {
		return deliveryprofile.Profile{}, errors.New("the profile sent is too large")
	}
	var decoded profileEdit
	if err := json.Unmarshal([]byte(edit), &decoded); err != nil {
		return deliveryprofile.Profile{}, fmt.Errorf("the profile sent could not be read: %w", err)
	}
	profile := deliveryprofile.Profile{ID: decoded.ID, Name: decoded.Name, Rules: make([]deliveryprofile.Rule, len(decoded.Rules))}
	for i, rule := range decoded.Rules {
		profile.Rules[i] = deliveryprofile.Rule{ID: rule.ID, Off: rule.Off, Min: rule.Min, Max: rule.Max}
	}
	return h.profileStore().Save(profile)
}
