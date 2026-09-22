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

	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/importer"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
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
	next.projectFolder, next.projectName, next.daw = path, name, "Standalone"
	attached, reason := h.attachProjectLocked(next)
	h.mu.Unlock()
	if attached && h.recents != nil {
		// Best-effort: a recents-write hiccup must not fail the switch itself.
		_ = h.recents.Touch(path, name)
	}
	return reportAttach(ctx, attached, reason)
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
func (h *Host) ManuscriptImportCommit(jobID string, confirmedReset bool, sectionKinds map[string]string, characterCandidateIDs []string) (string, error) {
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
	return encodeBinding(svc.manuscript.StartCommit(jobID, confirmedReset, sectionKinds, post))
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
// chapter. Like TranscriptStart it stops at the first-use gate when the Whisper
// model is not installed and reports it as asset_required; once running, the
// sidecar's events arrive as "teleprompter:event" and phase changes as
// "teleprompter:state".
func (h *Host) TeleprompterStart(options map[string]string) (string, error) {
	svc := h.services()
	if svc.teleprompter == nil {
		return "", fmt.Errorf("the teleprompter service is unavailable")
	}
	models := h.registry().whisper
	if models == nil {
		return "", h.registry().catalogUnavailable("Whisper")
	}
	modelID := resolveTeleprompterModelID(options)
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
	started["model"], started["modelDir"] = modelID, modelDir
	return encodeBinding(map[string]any{"status": "started"}, svc.teleprompter.Start(started))
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

func (h *Host) TracksDiscover() (string, error) { return encodeBinding(h.tracksDiscover()) }
func (h *Host) TracksSelect(path string) (string, error) {
	return encodeBinding(h.tracksSelect(path))
}
func (h *Host) TracksList() (string, error) { return encodeBinding(h.tracksList()) }

// TakeReviewScan runs one pickup/duplicate scan of chapterTrackName (take-review
// phase 5's scan-and-review surface) and saves the fresh findings into the
// project's findings store, returning the merged result.
func (h *Host) TakeReviewScan(chapterTrackName string) (string, error) {
	return encodeBinding(h.takeReviewScan(chapterTrackName))
}

// TakeReviewFindings reads the take-review analyzer's saved findings for
// chapterTrackName (every chapter when empty) without running a new scan.
func (h *Host) TakeReviewFindings(chapterTrackName string) (string, error) {
	return encodeBinding(h.takeReviewFindings(chapterTrackName))
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
