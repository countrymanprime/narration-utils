package main

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credits"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// The credits setup prompt's host half (credits-token-setup-and-front-matter-detection.prd.md Phase 2, ADR 0208):
// whether the project needs its credits set up, what to ask for with what prefilled, "Not now" and "Don't ask", and
// a save that only fills empty values. It keys on state (a manuscript is imported and the credits the app reads have
// unresolved tokens), not on an app or manifest version, so the first open, an upgraded project, an import and a
// Replace manuscript all ask alike.

// creditsSetupState is CreditsSetupState's payload. Needed says to show the dialog; Banner says to show the banner
// (while tokens stay unresolved, unless the narrator chose "Don't ask", CS1 C). Dismissed is "", "session" or
// "project". Fields are the unresolved tokens of the first opening and closing templates with their detected values
// (CS4 A); Candidates are every detected value for a token the project has not set (for Settings' captions).
type creditsSetupState struct {
	Needed         bool                 `json:"needed"`
	Banner         bool                 `json:"banner"`
	Dismissed      string               `json:"dismissed"`
	DismissedAt    *time.Time           `json:"dismissedAt"`
	DocumentID     string               `json:"documentId"`
	NarratorGlobal string               `json:"narratorGlobal"`
	Fields         []credits.SetupField `json:"fields"`
	Candidates     []credits.Candidate  `json:"candidates"`
}

// creditsSetupSession remembers "Not now" for this run of the app (CS2), per project folder and manuscript document,
// so a new session or a Replace manuscript asks again. The zero value is ready.
type creditsSetupSession struct {
	mu sync.Mutex
	// +checklocks:mu
	dismissed map[string]bool
}

func (s *creditsSetupSession) key(folder, documentID string) string {
	return folder + "\x00" + documentID
}

func (s *creditsSetupSession) dismiss(folder, documentID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dismissed == nil {
		s.dismissed = map[string]bool{}
	}
	s.dismissed[s.key(folder, documentID)] = true
}

func (s *creditsSetupSession) isDismissed(folder, documentID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dismissed[s.key(folder, documentID)]
}

// CreditsSetupState says whether to ask for the credits values and what to ask for. It only reads.
func (h *Host) CreditsSetupState() (string, error) { return encodeBinding(h.creditsSetupState()) }

// CreditsSetupDismiss records the narrator's answer to the prompt: "session" for "Not now" (this run of the app only)
// or "project" for "Don't ask for this project" (stored on the manifest for this manuscript). It returns the new state.
func (h *Host) CreditsSetupDismiss(scope string) (string, error) {
	return encodeBinding(h.creditsSetupDismiss(scope))
}

// CreditsSetupSave fills the project's empty credits values from the prompt's fields (Values JSON keys to values)
// and never replaces one already set, so an empty or stale prompt field cannot clear or overwrite the narrator's
// own value. It returns the new state. "Use for all my projects" saves the global narrator through the settings
// binding instead, with no narrator field here.
func (h *Host) CreditsSetupSave(fields map[string]string) (string, error) {
	return encodeBinding(h.creditsSetupSave(fields))
}

func (h *Host) creditsSetupState() (creditsSetupState, error) {
	svc := h.services()
	folder := svc.config.projectFolder
	if folder == "" {
		return creditsSetupState{}, errors.New("open a project before setting up its credits")
	}
	state := creditsSetupState{Fields: []credits.SetupField{}, Candidates: []credits.Candidate{}}
	if svc.settings != nil {
		state.NarratorGlobal, _ = svc.settings.Effective("General", "narrator_name", "")
	}
	if svc.manuscript == nil {
		return state, nil
	}
	data, err := svc.manuscript.Load()
	if err != nil {
		return state, nil // no manuscript: nothing to detect from, and Settings covers it (PRD Phase 2)
	}
	state.DocumentID, _ = data["documentId"].(string)
	manifest, ok, err := project.Load(h.persist, folder)
	if err != nil {
		return creditsSetupState{}, fmt.Errorf("could not read the project manifest: %w", err)
	}
	var values credits.Values
	if ok && manifest != nil {
		if manifest.Credits != nil {
			values = *manifest.Credits
		}
		if setup := manifest.CreditsSetup; setup != nil && setup.DismissedFor == state.DocumentID && state.DocumentID != "" {
			state.Dismissed, state.DismissedAt = "project", &setup.DismissedAt
		}
	}
	if state.Dismissed == "" && h.creditsSetupSession.isDismissed(folder, state.DocumentID) {
		state.Dismissed = "session"
	}
	templates, err := h.creditTemplates.List()
	if err != nil {
		return creditsSetupState{}, fmt.Errorf("could not read the credits templates: %w", err)
	}
	detected := credits.OpenCandidates(credits.Detect(folder), values)
	state.Candidates = detected
	state.Fields = credits.SetupFields(templates, values, state.NarratorGlobal, detected)
	unresolved := len(state.Fields) > 0
	state.Needed = unresolved && state.Dismissed == ""
	state.Banner = unresolved && state.Dismissed != "project"
	return state, nil
}

func (h *Host) creditsSetupDismiss(scope string) (creditsSetupState, error) {
	if scope != "session" && scope != "project" {
		return creditsSetupState{}, fmt.Errorf("unknown dismissal scope %q: use session or project", scope)
	}
	state, err := h.creditsSetupState()
	if err != nil {
		return creditsSetupState{}, err
	}
	if state.DocumentID == "" {
		return creditsSetupState{}, errors.New("import a manuscript before setting up its credits")
	}
	folder := h.services().config.projectFolder
	if scope == "session" {
		h.creditsSetupSession.dismiss(folder, state.DocumentID)
		return h.creditsSetupState()
	}
	manifest, err := h.loadOrNewManifest(folder)
	if err != nil {
		return creditsSetupState{}, err
	}
	manifest.CreditsSetup = &project.CreditsSetup{DismissedFor: state.DocumentID, DismissedAt: time.Now().UTC()}
	if err := manifest.Save(folder); err != nil {
		return creditsSetupState{}, fmt.Errorf("could not save the credits setup choice: %w", err)
	}
	return h.creditsSetupState()
}

func (h *Host) creditsSetupSave(fields map[string]string) (creditsSetupState, error) {
	folder := h.services().config.projectFolder
	if folder == "" {
		return creditsSetupState{}, errors.New("open a project before saving its credits values")
	}
	manifest, err := h.loadOrNewManifest(folder)
	if err != nil {
		return creditsSetupState{}, err
	}
	var values credits.Values
	if manifest.Credits != nil {
		values = *manifest.Credits
	}
	filled, changed, err := values.FillEmpty(fields)
	if err != nil {
		return creditsSetupState{}, err
	}
	if len(changed) > 0 {
		manifest.Credits = &filled
		if err := manifest.Save(folder); err != nil {
			return creditsSetupState{}, fmt.Errorf("could not save the project's credits values: %w", err)
		}
	}
	return h.creditsSetupState()
}

// loadOrNewManifest reads folder's manifest, or starts one for a project that has none yet, as
// CreditsSaveProjectValues does.
func (h *Host) loadOrNewManifest(folder string) (*project.Manifest, error) {
	manifest, ok, err := project.Load(h.persist, folder)
	if err != nil {
		return nil, fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil {
		manifest = project.New(h.services().config.projectName, time.Now())
	}
	return manifest, nil
}
