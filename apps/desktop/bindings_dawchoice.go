package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// The project's DAW choice (projectdaw.go): DawChoice answers what the project records with, why, and every engine the narrator
// can choose with its honest state; DawChoose saves the narrator's choice in the project's own Recording.engine row (the row
// RecorderChooseEngine writes too); DawLinkFound links the one REAPER project file the host found in the folder. The page sends
// only an engine name, which dawport.Classify reads, and never a path (docs/architecture/threat-model.md, rows 6f and 6zc). The wire
// schema, golden payloads, wireContracts rows and mock live in apps/ui/src/api (docs/architecture/wire-contracts.md).

// DawChoiceOption is one engine Settings > Recording lists.
type DawChoiceOption struct {
	// Daw is the engine's name as the capability report words it: "REAPER", "Audacity" or "Built-in".
	Daw string `json:"daw"`
	// Installed is whether the app found the engine on this computer; null when it cannot tell (no detector for it).
	Installed *bool `json:"installed"`
	// Record is the record capability as the resolver answers it for this engine: its level and, when it is not available now,
	// the reason and sentence.
	Record map[string]any `json:"record"`
}

// DawChoice is the DawChoice, DawChoose and DawLinkFound payload.
type DawChoice struct {
	HasProject bool `json:"hasProject"`
	// Daw is the engine the project records with now: "REAPER", "Audacity", "Built-in" or "none".
	Daw string `json:"daw"`
	// Source is why (dawport.Source): "launch", "chosen", "linked", "found" or "default".
	Source string `json:"source"`
	// Chosen is the narrator's saved choice, null when none; it differs from Daw only while a launch's --daw overrides it.
	Chosen *string `json:"chosen"`
	// State is the project's DAW as the Booth's chip words it: "connected", "not_running", "linked", "not_linked", "app" (the
	// built-in recorder) or "none".
	State     string `json:"state"`
	Reachable bool   `json:"reachable"`
	// LinkedFile is the linked REAPER project file's name, null when none is linked.
	LinkedFile *string `json:"linkedFile"`
	// FoundFiles names the REAPER project files directly in the project folder.
	FoundFiles []string `json:"foundFiles"`
	// LauncherAutoStart is DAW.auto_start_launcher: whether Start REAPER also runs the launcher that connects the bridge.
	LauncherAutoStart bool `json:"launcherAutoStart"`
	// Experimental is DAW.experimental_reaper_actions, the global switch Experimental capabilities wait on.
	Experimental bool              `json:"experimental"`
	Options      []DawChoiceOption `json:"options"`
}

// DawChoice answers the project's DAW choice. It changes nothing.
func (h *Host) DawChoice() (string, error) {
	return encodeBinding(h.dawChoice(h.services()), nil)
}

// DawChoose saves which engine the project records with: "REAPER", "Audacity" or "Built-in". The built-in recorder is refused
// where its capture row is not available; nothing changes while a take records. The choice takes effect at once (the capability
// report and the record path read it per call); a launch whose --daw names another DAW keeps that DAW until the app is opened
// another way, which the answer's source and chosen say.
func (h *Host) DawChoose(engine string) (string, error) {
	kind := dawport.Classify(engine)
	if kind.SavedValue() == "" {
		return "", errors.New(`the engine is "REAPER", "Audacity" or "Built-in"`)
	}
	if err := h.chooseProjectDaw(kind); err != nil {
		return "", err
	}
	return encodeBinding(h.dawChoice(h.services()), nil)
}

// DawLinkFound links the one REAPER project file in the project folder and chooses REAPER for the project. It refuses when the
// folder holds none or several (the narrator picks one with ProjectLinkDawFile).
func (h *Host) DawLinkFound() (string, error) {
	svc := h.services()
	if svc.config.projectFolder == "" {
		return "", errors.New("open a project before linking a REAPER project file")
	}
	found := scanRppFiles(svc.config.projectFolder)
	switch len(found) {
	case 0:
		return "", errors.New("this project's folder holds no REAPER project file (.rpp): save one there from REAPER, or choose one")
	case 1:
	default:
		return "", fmt.Errorf("this project's folder holds %d REAPER project files: choose the one to link", len(found))
	}
	result, err := h.linkPickedDawFile(filepath.Join(svc.config.projectFolder, found[0]))
	if err != nil {
		return "", err
	}
	if linked, _ := result["linked"].(bool); !linked {
		message, _ := result["message"].(string)
		return "", errors.New(message)
	}
	return encodeBinding(h.dawChoice(h.services()), nil)
}

// chooseProjectDaw saves kind as the project's Recording.engine row. When the choice moves the project onto or off Audacity, whose
// review session and backups the project's services are built with (configureLocked), the project is attached again so the
// switch needs no restart; when the host is busy it says so instead.
func (h *Host) chooseProjectDaw(kind dawport.Kind) error {
	svc := h.services()
	if svc.config.projectFolder == "" || svc.settings == nil {
		return errors.New("open a project before choosing how it records")
	}
	if svc.recorder != nil && svc.recorder.Busy() {
		return errors.New("stop the take before changing how the project records")
	}
	if kind.RecordsInApp() {
		if support := recorderSupport(h.recorderPlatform()); !support.Available {
			return errors.New(support.Message)
		}
	} else if svc.recorder != nil {
		svc.recorder.StopMeter()
	}
	before := h.projectDaw(svc).kind
	value := kind.SavedValue()
	if err := svc.settings.Save(recordingSettingsTool, "project", map[string]*string{recordingEngineKey: &value}); err != nil {
		return err
	}
	after := h.projectDaw(h.services()).kind
	if dawport.RebuildsServices(before, after) {
		h.mu.Lock()
		reattached := h.canAttachLocked()
		if reattached {
			h.configureLocked(h.config)
		}
		h.mu.Unlock()
		if !reattached {
			return errors.New("the choice is saved, and takes effect when the project is opened again: " + strings.TrimSuffix(attachBusyReason, "."))
		}
	}
	h.pollDawCapabilities()
	return nil
}

// dawChoice is the DawChoice payload for svc.
func (h *Host) dawChoice(svc hostServices) DawChoice {
	project := h.projectDaw(svc)
	_, runtime := dawResolverOver(svc, project.kind, true)
	choice := DawChoice{
		HasProject: svc.config.projectFolder != "",
		Daw:        project.kind.String(),
		Source:     string(project.source),
		State:      dawChoiceState(project, svc.bridge != nil, runtime.Reachable),
		Reachable:  runtime.Reachable,
		FoundFiles: project.folder.found,
		Options:    []DawChoiceOption{},
	}
	if svc.settings != nil {
		if choice.HasProject {
			if saved := dawport.Classify(svc.settings.Project(recordingSettingsTool)[recordingEngineKey]); saved.SavedValue() != "" {
				name := saved.String()
				choice.Chosen = &name
			}
		}
		autoStart, _ := svc.settings.Effective(dawport.SettingsTool, "auto_start_launcher", "false")
		choice.LauncherAutoStart = autoStart == "true"
		choice.Experimental = dawport.SettingsExperimental(svc.settings.Effective)()
	}
	if project.folder.linkedPath != "" {
		name := filepath.Base(project.folder.linkedPath)
		choice.LinkedFile = &name
	}
	h.logDawState(choice, svc.bridge != nil)
	for _, kind := range dawport.Choosable() {
		optionResolver, _ := dawResolverOver(svc, kind, kind == project.kind)
		choice.Options = append(choice.Options, DawChoiceOption{
			Daw:       kind.String(),
			Installed: h.dawInstalled(svc, kind),
			Record:    supportPayload(optionResolver.Support(dawport.CapRecord)),
		})
	}
	return choice
}

// dawChoiceState words the project's DAW for the Booth's chip. A REAPER project is linked when the manifest links its file (or
// REAPER's launcher started the app with it); its bridge exists only when REAPER's launcher ran, so a linked project with no bridge
// is "linked" (Start REAPER connects it) and one whose bridge stopped answering is "not_running".
func dawChoiceState(project projectDaw, bridge, reachable bool) string {
	switch {
	case project.kind.RecordsInApp():
		return "app"
	case !project.kind.IsDAW():
		return "none"
	case reachable:
		return "connected"
	case !project.kind.LinksProjectFile():
		return "not_running"
	case bridge:
		return "not_running"
	case project.folder.linkedPath != "" || project.source == dawport.SourceLaunch:
		return "linked"
	default:
		return "not_linked"
	}
}

// dawInstalled is whether kind was found on this computer: REAPER through the DAW.reaper_path override or the Windows registry
// (daw.Resolve), Audacity through the same registry list (daw.LocateAudacityExecutable), and the built-in recorder
// always (it is part of the app). null is an engine the app has no way to look for.
func (h *Host) dawInstalled(svc hostServices, kind dawport.Kind) *bool {
	found := true
	switch {
	case kind.RecordsInApp():
	case kind.LinksProjectFile():
		override := ""
		if svc.settings != nil {
			override, _ = svc.settings.Effective(dawport.SettingsTool, "reaper_path", "")
		}
		locate := h.reaperLocate
		if locate == nil {
			locate = daw.LocateReaperExecutable
		}
		_, _, err := daw.Resolve(override, locate)
		found = err == nil
	case kind.IsDAW():
		locate := h.audacityLocate
		if locate == nil {
			locate = daw.LocateAudacityExecutable
		}
		_, _, err := locate()
		found = err == nil
	default:
		return nil
	}
	return &found
}
