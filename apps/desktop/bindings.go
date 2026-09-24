package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/dawadapter"
	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/importer"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/moonshine"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/takereview"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Each exported method is a concrete Wails binding. Keep this boundary
// operation-specific: unlike the retired HTTP host, the frontend cannot send
// an arbitrary method name to a generic dispatcher.
func encodeBinding(value any, err error) (string, error) {
	if err != nil {
		return "", err
	}
	bytes, err := json.Marshal(value)
	return string(bytes), err
}

func (h *Host) SystemSettingsForScope(scope string) (string, error) {
	return encodeBinding(h.settingsForScope(scope))
}
func (h *Host) SystemSaveSettings(tool, scope string, values map[string]*string) (string, error) {
	if err := h.saveSettings(tool, scope, values); err != nil {
		return "", err
	}
	return encodeBinding(h.Bootstrap(), nil)
}
func (h *Host) SystemReportDiagnostic(kind, message string) (string, error) {
	// Diagnostics are deliberately local and best-effort (ADR 0032, ADR 0069): the UI reports a payload that did not
	// match its schema (`wire_invalid`: boundary, payload and failing paths, never values) and its own errors, and a
	// write that fails must not become a binding error the client would report again.
	_ = h.log.Report(kind, message)
	return encodeBinding(nil, nil)
}

func (h *Host) TtsCatalog() (string, error) {
	return encodeBinding(ttsCatalogPayload(h.registry(), h.services().settings))
}

// ttsCatalogPayload is the approved voices plus which provider and voice are selected and where that choice comes from.
func ttsCatalogPayload(registry *assetRegistry, store *settings.Store) (map[string]any, error) {
	if registry.tts == nil {
		return nil, registry.catalogUnavailable("TTS")
	}
	catalog := registry.tts.Catalog()
	provider, providerSource := store.Effective("Piper", "tts_provider", "piper")
	voice, voiceSource := store.Effective("Piper", "tts_voice_id", "en_US-ljspeech-high")
	catalog["provider"] = map[string]any{"id": provider, "effectiveSource": providerSource}
	catalog["voice"] = map[string]any{"id": voice, "effectiveSource": voiceSource}
	return catalog, nil
}
func (h *Host) TtsInstall(voiceID string) (string, error) {
	return encodeBinding(h.startTtsInstall(voiceID))
}
func (h *Host) TtsInstallState(jobID string) (string, error) {
	return encodeBinding(h.ttsInstallState(jobID))
}
func (h *Host) TtsInstallCancel(jobID string) (string, error) {
	return encodeBinding(h.cancelTtsInstall(jobID))
}
func (h *Host) TtsRemove(voiceID string) (string, error) {
	registry := h.registry()
	if registry.tts == nil {
		return "", registry.catalogUnavailable("TTS")
	}
	return encodeBinding(nil, h.removeAsset(installKindTts, voiceID))
}

func (h *Host) WhisperCatalog() (string, error) {
	return encodeBinding(whisperCatalogPayload(h.registry(), h.services().settings))
}

// whisperCatalogPayload is the approved models plus which one is selected and where that choice comes from.
func whisperCatalogPayload(registry *assetRegistry, store *settings.Store) (map[string]any, error) {
	if registry.whisper == nil {
		return nil, registry.catalogUnavailable("Whisper")
	}
	catalog := registry.whisper.Catalog()
	modelID, modelSource := store.Effective("TranscriptCompare", "model_size", "small")
	catalog["model"] = map[string]any{"id": modelID, "effectiveSource": modelSource}
	return catalog, nil
}
func (h *Host) WhisperInstall(modelID string) (string, error) {
	return encodeBinding(h.startWhisperInstall(modelID))
}
func (h *Host) WhisperInstallState(jobID string) (string, error) {
	return encodeBinding(h.whisperInstallState(jobID))
}
func (h *Host) WhisperInstallCancel(jobID string) (string, error) {
	return encodeBinding(h.cancelWhisperInstall(jobID))
}
func (h *Host) WhisperRemove(modelID string) (string, error) {
	registry := h.registry()
	if registry.whisper == nil {
		return "", registry.catalogUnavailable("Whisper")
	}
	return encodeBinding(nil, h.removeAsset(installKindWhisper, modelID))
}

// GuideBuild starts the Story Bible build, or asks for the language model it needs first (see startGuideBuild). rulesOnly builds without one
// for this run.
func (h *Host) GuideBuild(rulesOnly bool) (string, error) {
	return encodeBinding(h.startGuideBuild(rulesOnly))
}
func (h *Host) GuideBuildState() (string, error) {
	return encodeBinding(h.guideBuildState(), nil)
}
func (h *Host) GuideEntities() (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	entities, err := service.Entities()
	return encodeBinding(entities, err)
}
func (h *Host) GuideEdit(id string, values map[string]string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	// One sidecar process for the whole edit, and all of it or none of it: a field the sidecar refuses leaves the file as it was.
	if err := service.EditFields(id, values); err != nil {
		return "", err
	}
	return encodeBinding(nil, nil)
}
func (h *Host) GuideSetLocked(id string, locked bool) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, service.Edit(id, "locked", fmt.Sprint(locked)))
}
func (h *Host) GuideRescan(id string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, service.Rescan(id))
}
func (h *Host) GuidePronounce(id string, aliasIndex *int, source string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, service.Pronounce(id, aliasIndex, source))
}
func (h *Host) GuideCreate(name, category string, aliases []string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	id, err := service.Create(name, category, aliases)
	return encodeBinding(map[string]any{"id": id}, err)
}
func (h *Host) GuideMerge(sourceID, targetID string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, service.Merge(sourceID, targetID))
}
func (h *Host) GuideDelete(id string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, service.Delete(id))
}
func (h *Host) GuideRelate(id, otherID, label string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, service.Relate(id, otherID, label))
}
func (h *Host) GuideUnrelate(id, otherID, label string) (string, error) {
	service := h.services().guide
	if service == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, service.Unrelate(id, otherID, label))
}
func (h *Host) GuidePreview(id string, aliasIndex *int) (string, error) {
	svc := h.services()
	voices := h.registry().tts
	if svc.guide == nil || voices == nil {
		return "", fmt.Errorf("story Bible preview is unavailable")
	}
	voiceID, _ := svc.settings.Effective("Piper", "tts_voice_id", "en_US-ljspeech-high")
	voice, knownVoice := voices.Voice(voiceID)
	if !knownVoice {
		return "", fmt.Errorf("the selected preview voice is not in the approved catalog")
	}
	model, _, err := voices.Paths(voiceID)
	if err != nil {
		return encodeBinding(voiceAssetRequired(voice, voices.State(voice), voices.InstallDir(voice.ID)), nil)
	}
	audio, err := svc.guide.Preview(id, aliasIndex, guide.PreviewVoice{ID: voiceID, Model: model, Provider: voice.Provider, Version: voice.Version})
	return encodeBinding(map[string]any{"status": "ready", "audioBase64": base64.StdEncoding.EncodeToString(audio), "mimeType": "audio/wav"}, err)
}

func (h *Host) ProjectSelectFolder() (string, error) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx == nil {
		return "", fmt.Errorf("the desktop host is not ready")
	}
	path, err := runtime.OpenDirectoryDialog(ctx, runtime.OpenDialogOptions{Title: "Choose a project folder", CanCreateDirectories: true})
	if err != nil {
		return "", err
	}
	if path == "" {
		return encodeBinding(map[string]any{"selected": false}, nil)
	}
	return encodeBinding(map[string]any{"selected": true, "path": path}, nil)
}

// ProjectSwitch is the single choke point for attaching a picker-chosen
// project: both "open recent" and post-browse/create-new flows call this, so
// system:attached emission and recents-touching happen in exactly one place.
func (h *Host) ProjectSwitch(path, name string) (string, error) {
	if name == "" {
		name = filepath.Base(path)
	}
	h.mu.Lock()
	ctx := h.ctx
	next := h.config
	next.projectFolder, next.projectName, next.daw = path, name, pickerSwitchDAW(h.config.daw)
	attached, reason := h.attachProjectLocked(next)
	h.mu.Unlock()
	if attached && h.recents != nil {
		// Best-effort: a recents-write hiccup must not fail the switch itself.
		_ = h.recents.Touch(path, name)
	}
	return reportAttach(ctx, attached, reason)
}

// pickerSwitchDAW is the `daw` a picker switch attaches with. An Audacity launch (the installer's "Narration Utils for Audacity"
// shortcut starts the app with `--daw Audacity` and no folder, audacity-integration PRD Phase 10) stays one: the narrator's DAW is
// still Audacity whichever folder they pick, and no bridge is tied to a project. Any other launch becomes "Standalone", a REAPER
// one included, because the picked project is not the one REAPER has open.
func pickerSwitchDAW(launched string) string {
	if dawadapter.Classify(launched) == dawadapter.KindAudacity {
		return launched
	}
	return "Standalone"
}

// reportAttach tells the window how an attach ended (the system:attached event)
// and returns the binding's result. ctx is nil before Startup.
func reportAttach(ctx context.Context, attached bool, reason string) (string, error) {
	if ctx != nil {
		if attached {
			runtime.EventsEmit(ctx, "system:attached", map[string]any{"attached": true})
		} else if reason != "" {
			runtime.EventsEmit(ctx, "system:attached", map[string]any{"attached": false, "reason": reason})
		}
	}
	return attachResult(attached, reason)
}

// attachResult is what ProjectSwitch and ProjectCreateIn answer: whether the project was attached and, when it was not, why.
func attachResult(attached bool, reason string) (string, error) {
	return encodeBinding(map[string]any{"switched": attached, "reason": reason}, nil)
}

// ProjectCreateIn makes a new project.json-manifested folder named name under
// parent (the PRD's "Visual Studio model": a name plus a location) and
// attaches it, replacing the old full-path ProjectCreate (PRD W9). An empty
// parent defaults to the Phase 1 projects directory (project.ResolveDir), so
// the picker's default "Create new" needs only a name. name is validated
// (project.ValidateName: non-empty, no illegal or control characters, not a
// Windows reserved device name) before parent is even resolved, and the busy
// check comes before any MkdirAll, so a refused or invalid create leaves no
// folder behind; the check is a pre-check only, ProjectSwitch asks again
// under the write lock, so a lost race at worst leaves an empty folder.
func (h *Host) ProjectCreateIn(parent, name string) (string, error) {
	if err := project.ValidateName(name); err != nil {
		return "", err
	}
	name = strings.TrimSpace(name)
	if parent == "" {
		resolved, err := project.ResolveDir("")
		if err != nil {
			return "", fmt.Errorf("could not resolve the projects directory: %w", err)
		}
		parent = resolved
	}
	if !filepath.IsAbs(parent) {
		return "", fmt.Errorf("the project location must be an absolute path")
	}
	path := filepath.Join(parent, name)
	if !h.canAttach() {
		h.mu.RLock()
		ctx := h.ctx
		h.mu.RUnlock()
		return reportAttach(ctx, false, attachBusyReason)
	}
	if _, err := os.Stat(path); err == nil {
		return "", fmt.Errorf("a project named %q already exists in that location", name)
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("could not check the project location: %w", err)
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return "", fmt.Errorf("could not create the project folder: %w", err)
	}
	if err := project.New(name, time.Now()).Save(path); err != nil {
		return "", fmt.Errorf("could not write the project manifest: %w", err)
	}
	return h.ProjectSwitch(path, name)
}

func (h *Host) ProjectRecents() (string, error) {
	if h.recents == nil {
		return encodeBinding([]any{}, nil)
	}
	entries, err := h.recents.List()
	return encodeBinding(entries, err)
}

// ProjectRemoveRecent drops path from the recent-projects list and returns
// the updated list, so the caller can re-render from the response instead of
// making a second round trip.
func (h *Host) ProjectRemoveRecent(path string) (string, error) {
	if h.recents == nil {
		return encodeBinding([]any{}, nil)
	}
	if err := h.recents.Remove(path); err != nil {
		return "", err
	}
	entries, err := h.recents.List()
	return encodeBinding(entries, err)
}

func (h *Host) ManuscriptSelectFile() (string, error) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx == nil {
		return "", fmt.Errorf("the desktop host is not ready")
	}
	path, err := runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{Title: "Select manuscript", Filters: []runtime.FileFilter{{DisplayName: "Manuscripts", Pattern: importer.PickerPattern()}}})
	if err != nil {
		return "", err
	}
	if path == "" {
		return encodeBinding(map[string]any{"selected": false}, nil)
	}
	// Read the manuscript service after the dialog returns: the user can take
	// their time in the picker, and the import belongs to the project that is
	// open when a file was chosen.
	job := h.services().manuscript.Begin(path)
	return encodeBinding(map[string]any{"selected": true, "jobId": job.ID}, nil)
}

// ManuscriptBeginImport starts an import for the manuscript file Bootstrap
// offered in the project folder. Only that exact file is accepted.
func (h *Host) ManuscriptBeginImport(path string) (string, error) {
	job, err := h.services().manuscript.BeginDetected(path)
	if err != nil {
		return "", err
	}
	return encodeBinding(map[string]any{"selected": true, "jobId": job.ID}, nil)
}
func (h *Host) ManuscriptImportState(jobID string) (string, error) {
	return encodeBinding(h.services().manuscript.State(jobID))
}
func (h *Host) ManuscriptImportPreview(jobID string, markdownHeadingLevel int) (string, error) {
	// Runs in the background; the UI polls ManuscriptImportState for the real
	// staged progress and log (ADR-0015).
	return encodeBinding(h.services().manuscript.StartPreview(jobID, markdownHeadingLevel))
}

// ManuscriptImportCommit writes the previewed manuscript with the narrator's review choices: each section's kind, the character
// suggestions to seed, and, for a section with a subtitle, whether it is one (subtitleOverrides, keyed by section id; false joins
// the line to the title or returns it to the body, story-bible-and-import-ux-briefs PRD, Phase 5).
func (h *Host) ManuscriptImportCommit(jobID string, confirmedReset bool, sectionKinds map[string]string, characterCandidateIDs []string, subtitleOverrides map[string]bool) (string, error) {
	svc := h.services()
	var post manuscript.PostCommit
	if state, err := svc.manuscript.State(jobID); err == nil && state.Draft != nil && svc.guide != nil {
		candidates, seeding := state.Draft.CharacterCandidates, svc.guide
		// The commit runs in the background; seed the Story Bible of the project
		// the import belongs to, even if the user switches projects meanwhile.
		post = func(report func(int, string)) error {
			seedCharacterCandidates(seeding, candidates, characterCandidateIDs, report)
			return nil
		}
	}
	choices := manuscript.Choices{SectionKinds: sectionKinds, SubtitleOverrides: subtitleOverrides}
	return encodeBinding(svc.manuscript.StartCommit(jobID, confirmedReset, choices, post))
}

// seedCharacterCandidates writes the user's checked character suggestions
// into the Story Bible as manual entities. Calls run sequentially (never in
// parallel) because each one shells out to a Python process that rewrites
// the whole manuscript_guide.json file - concurrent writers would race. A
// failed candidate is skipped and logged, not fatal: the manuscript import
// itself has already been written by this point. Each candidate reports its
// own progress, since these Python launches are the slow part of an import.
func seedCharacterCandidates(service *guide.Service, candidates []importer.CharacterCandidate, selectedIDs []string, report func(percent int, message string)) {
	selected := make(map[string]bool, len(selectedIDs))
	for _, id := range selectedIDs {
		selected[id] = true
	}
	chosen := make([]importer.CharacterCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if selected[candidate.ID] {
			chosen = append(chosen, candidate)
		}
	}
	for index, candidate := range chosen {
		report(index*100/len(chosen), fmt.Sprintf("Adding Story Bible character %d of %d: %s", index+1, len(chosen), candidate.Name))
		// The description and any labelled properties (import-structure-toc-and-characters PRD, Phase 3) go in with the create:
		// one sidecar process per candidate instead of two or three.
		if _, err := service.CreateFull(candidate.Name, "Character", nil, candidate.Description, toGuideProperties(candidate.Properties)); err != nil {
			report(index*100/len(chosen), fmt.Sprintf("Skipped %s: %v", candidate.Name, err))
		}
	}
	if len(chosen) > 0 {
		report(100, fmt.Sprintf("Added %d Story Bible characters", len(chosen)))
	}
}

// toGuideProperties converts a character candidate's labelled facts to the guide package's own Property type. The two are
// structurally identical ({Key, Value string}), but Go has no structural typing across packages, so the boundary needs an
// explicit copy; nil in, nil out keeps createArgs's "only send --properties when there are any" check working unchanged.
func toGuideProperties(properties []importer.Property) []guide.Property {
	if len(properties) == 0 {
		return nil
	}
	converted := make([]guide.Property, len(properties))
	for index, property := range properties {
		converted[index] = guide.Property{Key: property.Key, Value: property.Value}
	}
	return converted
}
func (h *Host) ManuscriptImportCancel(jobID string) (string, error) {
	return encodeBinding(nil, h.services().manuscript.Cancel(jobID))
}
func (h *Host) ManuscriptClearProjectData(confirmed bool) (string, error) {
	if !confirmed {
		return "", fmt.Errorf("project data clear requires confirmation")
	}
	return encodeBinding(nil, h.services().manuscript.Clear())
}
func (h *Host) ManuscriptChapters() (string, error) {
	return encodeBinding(h.services().manuscript.Chapters())
}
func (h *Host) ManuscriptParagraphs(chapter string) (string, error) {
	return encodeBinding(h.services().manuscript.Paragraphs(chapter))
}
func (h *Host) ManuscriptReader() (string, error) {
	return encodeBinding(h.services().manuscript.Reader())
}
func (h *Host) ManuscriptSearch(query string) (string, error) {
	return encodeBinding(h.services().manuscript.Search(query))
}
func (h *Host) ManuscriptSetChapterStatus(chapter, status string) (string, error) {
	return encodeBinding(h.services().manuscript.SetChapterStatus(chapter, status))
}
func (h *Host) ManuscriptNotes(chapter string) (string, error) {
	return encodeBinding(h.services().manuscript.Notes(chapter), nil)
}
func (h *Host) ManuscriptCreateNote(chapterID, paragraphID, text, anchorText string, anchorStart, anchorEnd *int) (string, error) {
	return encodeBinding(h.services().manuscript.CreateNote(chapterID, paragraphID, text, anchorStart, anchorEnd, anchorText))
}
func (h *Host) ManuscriptDeleteNote(id string) (string, error) {
	return encodeBinding(nil, h.services().manuscript.DeleteNote(id))
}
func (h *Host) ManuscriptReaderState() (string, error) {
	return encodeBinding(h.services().manuscript.ReaderState(), nil)
}
func (h *Host) ManuscriptSaveReaderState(activeChapter string, activeSourceLine *int, expandedChapters []string) (string, error) {
	return encodeBinding(h.services().manuscript.SaveReaderState(activeChapter, activeSourceLine, expandedChapters, expandedChapters != nil))
}
func (h *Host) ManuscriptCreateBookmark(values map[string]any) (string, error) {
	return encodeBinding(h.services().manuscript.CreateBookmark(values))
}
func (h *Host) ManuscriptDeleteBookmark(id string) (string, error) {
	return encodeBinding(nil, h.services().manuscript.DeleteBookmark(id))
}

func (h *Host) TranscriptStart(options map[string]string) (string, error) {
	svc := h.services()
	if svc.transcript == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	models := h.registry().whisper
	if models == nil {
		return "", h.registry().catalogUnavailable("Whisper")
	}
	modelID := resolveWhisperModelID(svc.settings, options)
	model, knownModel := models.Model(modelID)
	if !knownModel {
		return "", fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	modelDir, err := models.Dir(modelID)
	if err != nil {
		return encodeBinding(modelAssetRequired(model, models.State(model), models.InstallDir(model.ID)), nil)
	}
	started := map[string]string{}
	for key, value := range options {
		started[key] = value
	}
	started["modelDir"] = modelDir
	return encodeBinding(map[string]any{"status": "started"}, svc.transcript.Start(started))
}

// TeleprompterStart begins a live teleprompter session for one manuscript
// chapter with the engine the request names (Whisper when it names none). Like
// TranscriptStart it stops at the first-use gate when that engine's model is not
// installed and reports it as asset_required, tagged with the engine so the UI
// installs it through the right asset kind; once running, the sidecar's events
// arrive as "teleprompter:event" and phase changes as "teleprompter:state".
func (h *Host) TeleprompterStart(options map[string]string) (string, error) {
	svc := h.services()
	if svc.teleprompter == nil {
		return "", fmt.Errorf("the teleprompter service is unavailable")
	}
	engine := resolveTeleprompterEngine(options)
	if !teleprompter.SupportsEngine(teleprompter.PlatformOrCurrent(h.platform), engine) {
		return "", fmt.Errorf("the %s engine is not available on this computer", engine)
	}
	modelID := resolveTeleprompterModelID(options)
	modelDir, required, err := h.liveModelDir(engine, modelID)
	if err != nil || required != nil {
		return encodeBinding(required, err)
	}
	started := map[string]string{}
	for key, value := range options {
		started[key] = value
	}
	started["engine"], started["model"], started["modelDir"] = engine, modelID, modelDir
	// `credits` ("opening" or "closing") reads the credits instead of a chapter (audiobook-credits-templates.prd.md
	// Phase 4, ADR 0150): the host renders the text itself, so the UI names only which credits, never the text.
	if kind := strings.TrimSpace(options["credits"]); kind != "" {
		script, err := h.creditsScript(kind)
		if err != nil {
			return "", err
		}
		delete(started, "credits")
		delete(started, "chapter")
		return encodeBinding(map[string]any{"status": "started"}, svc.teleprompter.StartScript(script, started))
	}
	return encodeBinding(map[string]any{"status": "started"}, svc.teleprompter.Start(started))
}

// liveModelDir is the verified install directory of a live engine's model, or the first-use gate's answer when it is
// not installed (a non-nil asset_required result), or an error for a model outside the engine's approved catalog.
func (h *Host) liveModelDir(engine, modelID string) (string, map[string]any, error) {
	if engine == teleprompter.EngineMoonshine {
		models := h.registry().moonshine
		if models == nil {
			return "", nil, h.registry().catalogUnavailable("Moonshine")
		}
		model, known := models.Model(modelID)
		if !known {
			return "", nil, fmt.Errorf("the selected Moonshine model is not in the approved catalog")
		}
		dir, err := models.Dir(modelID)
		if err != nil {
			return "", liveAssetRequired(engine, previewMoonshineModel(model), moonshineDownloadSize(model), models.State(model), models.InstallDir(model.ID)), nil
		}
		return dir, nil, nil
	}
	models := h.registry().whisper
	if models == nil {
		return "", nil, h.registry().catalogUnavailable("Whisper")
	}
	model, known := models.Model(modelID)
	if !known {
		return "", nil, fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	dir, err := models.Dir(modelID)
	if err != nil {
		return "", liveAssetRequired(engine, previewModel(model), modelDownloadSize(model), models.State(model), models.InstallDir(model.ID)), nil
	}
	return dir, nil, nil
}

// teleprompterModel resolves the Whisper model a tail-audio locate uses (a live session goes through liveModelDir) from
// the approved catalog: its id and verified install directory, or, when it is not installed yet, the asset_required
// answer the first-use gate shows. The UI's own model directory is never used; the host computes it.
func (h *Host) teleprompterModel(requested string) (id, dir string, required map[string]any, err error) {
	models := h.registry().whisper
	if models == nil {
		return "", "", nil, h.registry().catalogUnavailable("Whisper")
	}
	id = resolveTeleprompterModelID(map[string]string{"model": requested})
	model, known := models.Model(id)
	if !known {
		return "", "", nil, fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	dir, err = models.Dir(id)
	if err != nil {
		return id, "", modelAssetRequired(model, models.State(model), models.InstallDir(model.ID)), nil
	}
	return id, dir, nil, nil
}
func (h *Host) TeleprompterStop() (string, error) {
	if service := h.services().teleprompter; service != nil {
		service.Stop()
	}
	return encodeBinding(nil, nil)
}

// TeleprompterSeek moves a running session's tracker straight to script word `word` (the read-aloud modal's "Start
// here"/"Go back to here", teleprompter-manuscript-integration.prd.md Phase 3): one line appended to the session's
// control file, the sentinel-file pattern service.Seek documents. Errors (no service, no running session, a write
// failure) come back as a rejected promise, the same shape as every other teleprompter binding failure.
func (h *Host) TeleprompterSeek(word int) (string, error) {
	service := h.services().teleprompter
	if service == nil {
		return "", fmt.Errorf("the teleprompter service is unavailable")
	}
	return encodeBinding(nil, service.Seek(word))
}

// teleprompterDevicesTimeout bounds one `--list-devices` sidecar run: it prints one JSON line and exits, so this only
// needs to cover process start-up and dshow's own listing time, not anything as slow as a model load.
const teleprompterDevicesTimeout = 10 * time.Second

// TeleprompterDevices lists the input devices the teleprompter's capture path can open, by the name it opens them
// under (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 1). It never fails Start-style: a listing
// problem comes back as `{"devices": [], "error": "..."}`, not a rejected promise, so a caller can always still try
// to start with a device the narrator picked before.
func (h *Host) TeleprompterDevices() (string, error) {
	service := h.services().teleprompter
	if service == nil {
		return "", fmt.Errorf("the teleprompter service is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), teleprompterDevicesTimeout)
	defer cancel()
	devices, message, err := service.Devices(ctx)
	if err != nil {
		return "", err
	}
	if devices == nil {
		devices = []teleprompter.Device{}
	}
	return encodeBinding(map[string]any{"devices": devices, "error": nonEmptyOrNil(message)}, nil)
}

// nonEmptyOrNil turns "" into a JSON null instead of an empty string, matching the sidecar's own {"error": null} shape.
func nonEmptyOrNil(message string) *string {
	if message == "" {
		return nil
	}
	return &message
}
func (h *Host) TeleprompterState() (string, error) {
	if service := h.services().teleprompter; service != nil {
		return encodeBinding(service.Snapshot(), nil)
	}
	return encodeBinding(map[string]any{"phase": "idle", "script": nil, "position": nil}, nil)
}
func (h *Host) TranscriptCancel() (string, error) {
	if service := h.services().transcript; service != nil {
		service.Cancel()
	}
	return encodeBinding(nil, nil)
}
func (h *Host) TranscriptReset() (string, error) {
	service := h.services().transcript
	if service == nil {
		return encodeBinding(nil, nil)
	}
	return encodeBinding(nil, service.Reset())
}
func (h *Host) TranscriptLastCompleted() (string, error) {
	service := h.services().transcript
	if service == nil {
		return encodeBinding(nil, nil)
	}
	return encodeBinding(service.LastCompleted(), nil)
}
func (h *Host) TranscriptAddEquivalence(id string) (string, error) {
	service := h.services().transcript
	if service == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	message, err := service.AddEquivalence(id)
	return encodeBinding(map[string]any{"message": message}, err)
}
func (h *Host) TranscriptJump(id string) (string, error) {
	service := h.services().transcript
	if service == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	return encodeBinding(nil, service.Jump(id))
}
func (h *Host) TranscriptExportMarkers() (string, error) {
	service := h.services().transcript
	if service == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	return encodeBinding(nil, service.Export())
}
func (h *Host) TranscriptSuggestHints() (string, error) {
	svc := h.services()
	if svc.guide == nil || svc.transcript == nil {
		return "", fmt.Errorf("build the Story Bible before requesting vocabulary suggestions")
	}
	values, err := svc.guide.VocabularyCandidates()
	if err != nil {
		return "", err
	}
	// A saved-hints file that cannot be read must not stop Suggest; TranscriptHints
	// reports that error when the page loads the hints.
	accepted := map[string]bool{}
	for _, value := range svc.transcript.Hints() {
		accepted[strings.ToLower(value)] = true
	}
	terms := []string{}
	for _, value := range values {
		if !accepted[strings.ToLower(value)] {
			terms = append(terms, value)
		}
	}
	// found counts every name the Story Bible offers, so the page can tell "nothing
	// found" from "everything found is already accepted".
	return encodeBinding(map[string]any{"terms": terms, "found": len(values)}, nil)
}
func (h *Host) TranscriptHints() (string, error) {
	service := h.services().transcript
	if service == nil {
		return encodeBinding([]string{}, nil)
	}
	return encodeBinding(service.LoadHints())
}
func (h *Host) TranscriptSaveHints(accepted []string) (string, error) {
	service := h.services().transcript
	if service == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	return encodeBinding(nil, service.SaveHints(accepted))
}

// ChapterTrackMapList, ChapterTrackMapConfirm and ChapterTrackMapClear are
// the narrator-confirmed chapter-track mapping's bindings (analysis
// evidence ledger PRD, Phase 5, Q6/Q7): the mapping-confirm UI itself is
// Phase 7 (not built here), but the store it will call is bound now.
func (h *Host) ChapterTrackMapList() (string, error) { return encodeBinding(h.mappingList()) }
func (h *Host) ChapterTrackMapConfirm(trackGUID, chapterID string) (string, error) {
	return encodeBinding(h.mappingConfirm(trackGUID, chapterID))
}
func (h *Host) ChapterTrackMapClear(trackGUID string) (string, error) {
	return encodeBinding(h.mappingClear(trackGUID))
}

// ChapterTrackSet, ChapterTrackUnlink and ChapterTrackLinks are the chapter
// track link control's host half (chapter-track-link-control PRD Phase 1): Set
// makes a track the chapter's one link, replacing its old one and saying which
// chapter the track was taken from; Unlink clears every link a chapter holds;
// Links reads every narration chapter's link state and track facts from one
// parse of the saved .rpp.
func (h *Host) ChapterTrackSet(chapterID, trackGUID string) (string, error) {
	return encodeBinding(h.chapterTrackSet(chapterID, trackGUID))
}
func (h *Host) ChapterTrackUnlink(chapterID string) (string, error) {
	return encodeBinding(h.chapterTrackUnlink(chapterID))
}
func (h *Host) ChapterTrackLinks() (string, error) { return encodeBinding(h.chapterTrackLinks()) }

func (h *Host) TracksDiscover() (string, error) { return encodeBinding(h.tracksDiscover()) }
func (h *Host) TracksSelect(path string) (string, error) {
	return encodeBinding(h.tracksSelect(path))
}
func (h *Host) TracksList() (string, error) { return encodeBinding(h.tracksList()) }

// ChapterTrackMatch finds the track holding chapterID and where its recorded
// audio ends (teleprompter-manuscript-integration PRD Phase 8, ADR 0110): a
// confirmed link first, then the shared chapter-to-track matcher over track
// and region names. It only reads; it never creates a track or a link.
func (h *Host) ChapterTrackMatch(chapterID string) (string, error) {
	return encodeBinding(h.chapterTrackMatchFor(chapterID))
}

// ChapterSuggestion suggests the chapter the narrator is recording from the
// selected .rpp's record-armed (else selected) track as of its last save
// (teleprompter-engines-and-input-devices PRD Phase 11, ADR 0113): the matcher's
// other direction, track to chapter, with the same statuses. Read-only.
func (h *Host) ChapterSuggestion() (string, error) {
	return encodeBinding(h.chapterSuggestionFor())
}

// TakeReviewScanStart starts a pickup and duplicate scan of scope as a job (take-review phase 5): the chapter track's
// items and takes, plus at most one pickup track or time range (Q3). It answers the job; TakeReviewScanState reports
// its real progress (ADR 0015) and TakeReviewScanCancel stops it. The findings it saves are read and decided through
// the Review page's generic findings bindings (ADR 0120), like every other analyzer's.
func (h *Host) TakeReviewScanStart(scope TakeReviewScanScope) (string, error) {
	return encodeBinding(h.startTakeReviewScan(scope))
}

// TakeReviewScanState answers the scan job: idle (with the project's saved pickup scope to offer), running, or how it
// ended.
func (h *Host) TakeReviewScanState() (string, error) {
	return encodeBinding(h.takeReviewScanState(), nil)
}

// TakeReviewScanCancel stops a running scan; nothing it found is saved. With no scan running it changes nothing.
func (h *Host) TakeReviewScanCancel() (string, error) {
	return encodeBinding(h.cancelTakeReviewScan(), nil)
}

// TakeComparisonStart compares the takes of one take-review group as a job (take-review phase 10, ADR 0165): findingID
// names the group; the reads, their audio and the manuscript span all come from the store and the saved project. It
// answers the job; TakeComparisonState reports its real progress and TakeComparisonCancel stops it. The comparison is a
// take_comparison finding, read and decided through the generic findings bindings.
func (h *Host) TakeComparisonStart(findingID string) (string, error) {
	return encodeBinding(h.startTakeComparison(findingID))
}

// TakeComparisonState answers the comparison job: idle, running, or how it ended (with the comparison's finding id).
func (h *Host) TakeComparisonState() (string, error) {
	return encodeBinding(h.takeComparisonState(), nil)
}

// TakeComparisonCancel stops a running comparison; nothing is saved. With none running it changes nothing.
func (h *Host) TakeComparisonCancel() (string, error) {
	return encodeBinding(h.cancelTakeComparison(), nil)
}

// TakeReviewCreateTake adds a narrator-approved candidate's source range as a
// new take on the target item (take-review phase 6): findingID is the
// finding this candidate came from (provenance, ADR 0098); targetItemGUID
// is the item the narrator explicitly chose (never preselected);
// candidateItemGUID is the candidate's own item GUID when it has one (empty
// skips that extra staleness check); sourceFile, sourceRangeStart and
// sourceRangeEnd (seconds, source-file-relative) locate the candidate's
// matched span within its own source. The previously active take and the
// item's length are never touched (the phase 1 spike).
func (h *Host) TakeReviewCreateTake(findingID, targetItemGUID, candidateItemGUID, sourceFile string, sourceRangeStart, sourceRangeEnd float64) (string, error) {
	return encodeBinding(h.takeReviewCreateTake(takereview.CreateTakeRequest{
		FindingID:         findingID,
		TargetItemGUID:    targetItemGUID,
		CandidateItemGUID: candidateItemGUID,
		SourceFile:        sourceFile,
		SourceRangeStart:  sourceRangeStart,
		SourceRangeEnd:    sourceRangeEnd,
	}))
}

// voiceAssetRequired is the answer to a preview that needs a voice that is not installed yet: which voice, its state and its
// download size, so the UI can offer to install it. The UI validates it as `GuidePreview` (ADR 0069).
func voiceAssetRequired(voice tts.Voice, installState, installPath string) map[string]any {
	size := voiceDownloadSize(voice)
	return map[string]any{"status": "asset_required", "voice": previewVoice(voice), "installState": installState, "downloadSize": size, "diskSize": size, "installPath": installPath}
}

// modelAssetRequired is the answer to a start that needs a Whisper model that is not installed yet, as TranscriptStart and
// TeleprompterStart give it (the first-use gate). The UI validates it as `TranscriptStartResult` (ADR 0069).
func modelAssetRequired(model whisper.Model, installState, installPath string) map[string]any {
	size := modelDownloadSize(model)
	return map[string]any{"status": "asset_required", "model": previewModel(model), "installState": installState, "downloadSize": size, "diskSize": size, "installPath": installPath}
}

// liveAssetRequired is TeleprompterStart's first-use gate answer: the same shape as modelAssetRequired plus the live engine the model
// belongs to, which is also the asset kind the UI installs it as (installKindWhisper, installKindMoonshine). The UI validates it as
// `TeleprompterStartResult` (ADR 0069).
func liveAssetRequired(engine string, model map[string]any, size int64, installState, installPath string) map[string]any {
	return map[string]any{"status": "asset_required", "engine": engine, "model": model, "installState": installState, "downloadSize": size, "diskSize": size, "installPath": installPath}
}

// previewMoonshineModel is previewModel for a Moonshine catalog entry.
func previewMoonshineModel(model moonshine.Model) map[string]any {
	return map[string]any{"id": model.ID, "provider": model.Provider, "displayName": model.DisplayName, "version": model.Version, "publisher": model.Publisher, "license": model.License, "licenseUrl": model.LicenseURL, "modelCardUrl": model.ModelCardURL, "provenanceUrl": model.ProvenanceURL, "attribution": model.Attribution}
}

func moonshineDownloadSize(model moonshine.Model) int64 {
	var total int64
	for _, file := range model.Files {
		total += file.Size
	}
	return total
}
