package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/importer"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
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
	// Diagnostics are deliberately local and best-effort.
	return encodeBinding(nil, nil)
}

func (h *Host) TtsCatalog() (string, error) {
	if h.tts == nil {
		return "", fmt.Errorf("the approved TTS catalog is unavailable")
	}
	catalog := h.tts.Catalog()
	provider, providerSource := h.settings.Effective("Piper", "tts_provider", "piper")
	voice, voiceSource := h.settings.Effective("Piper", "tts_voice_id", "en_US-ljspeech-high")
	catalog["provider"] = map[string]any{"id": provider, "effectiveSource": providerSource}
	catalog["voice"] = map[string]any{"id": voice, "effectiveSource": voiceSource}
	return encodeBinding(catalog, nil)
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
	if h.tts == nil {
		return "", fmt.Errorf("the approved TTS catalog is unavailable")
	}
	return encodeBinding(nil, h.tts.Remove(voiceID))
}

func (h *Host) WhisperCatalog() (string, error) {
	if h.whisper == nil {
		return "", fmt.Errorf("the approved Whisper catalog is unavailable")
	}
	catalog := h.whisper.Catalog()
	modelID, modelSource := h.settings.Effective("TranscriptCompare", "model_size", "small")
	catalog["model"] = map[string]any{"id": modelID, "effectiveSource": modelSource}
	return encodeBinding(catalog, nil)
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
	if h.whisper == nil {
		return "", fmt.Errorf("the approved Whisper catalog is unavailable")
	}
	return encodeBinding(nil, h.whisper.Remove(modelID))
}

func (h *Host) GuideBuild() (string, error) { return encodeBinding(h.startGuideBuild()) }
func (h *Host) GuideBuildState() (string, error) {
	return encodeBinding(h.guideBuildState(), nil)
}
func (h *Host) GuideEntities() (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	entities, err := h.guide.Entities()
	return encodeBinding(entities, err)
}
func (h *Host) GuideEdit(id string, values map[string]string) (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	for field, value := range values {
		if err := h.guide.Edit(id, field, value); err != nil {
			return "", err
		}
	}
	return encodeBinding(nil, nil)
}
func (h *Host) GuideSetLocked(id string, locked bool) (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, h.guide.Edit(id, "locked", fmt.Sprint(locked)))
}
func (h *Host) GuideRescan(id string) (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, h.guide.Rescan(id))
}
func (h *Host) GuideCreate(name, category string, aliases []string) (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	id, err := h.guide.Create(name, category, aliases)
	return encodeBinding(map[string]any{"id": id}, err)
}
func (h *Host) GuideMerge(sourceID, targetID string) (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, h.guide.Merge(sourceID, targetID))
}
func (h *Host) GuideDelete(id string) (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, h.guide.Delete(id))
}
func (h *Host) GuideRelate(id, otherID, label string) (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, h.guide.Relate(id, otherID, label))
}
func (h *Host) GuideUnrelate(id, otherID, label string) (string, error) {
	if h.guide == nil {
		return "", fmt.Errorf("the Story Bible is unavailable")
	}
	return encodeBinding(nil, h.guide.Unrelate(id, otherID, label))
}
func (h *Host) GuidePreview(id string, aliasIndex *int) (string, error) {
	if h.guide == nil || h.tts == nil {
		return "", fmt.Errorf("story Bible preview is unavailable")
	}
	voiceID, _ := h.settings.Effective("Piper", "tts_voice_id", "en_US-ljspeech-high")
	voice, knownVoice := h.tts.Voice(voiceID)
	if !knownVoice {
		return "", fmt.Errorf("the selected preview voice is not in the approved catalog")
	}
	model, _, err := h.tts.Paths(voiceID)
	if err != nil {
		return encodeBinding(map[string]any{"status": "asset_required", "voice": previewVoice(voice), "installState": h.tts.State(voice), "downloadSize": voiceDownloadSize(voice)}, nil)
	}
	audio, err := h.guide.Preview(id, aliasIndex, model, voice.Provider, voice.Version)
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
	if ctx != nil {
		if attached {
			runtime.EventsEmit(ctx, "system:attached", map[string]any{"attached": true})
		} else if reason != "" {
			runtime.EventsEmit(ctx, "system:attached", map[string]any{"attached": false, "reason": reason})
		}
	}
	return encodeBinding(map[string]any{"switched": attached, "reason": reason}, nil)
}

func (h *Host) ProjectCreate(path, name string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("a folder path is required")
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return "", fmt.Errorf("could not create the project folder: %w", err)
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
	path, err := runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{Title: "Select manuscript", Filters: []runtime.FileFilter{{DisplayName: "Manuscripts", Pattern: "*.docx;*.md;*.markdown"}}})
	if err != nil {
		return "", err
	}
	if path == "" {
		return encodeBinding(map[string]any{"selected": false}, nil)
	}
	job := h.manuscript.Begin(path)
	return encodeBinding(map[string]any{"selected": true, "jobId": job.ID}, nil)
}

// ManuscriptBeginImport starts an import for the manuscript file Bootstrap
// offered in the project folder. Only that exact file is accepted.
func (h *Host) ManuscriptBeginImport(path string) (string, error) {
	job, err := h.manuscript.BeginDetected(path)
	if err != nil {
		return "", err
	}
	return encodeBinding(map[string]any{"selected": true, "jobId": job.ID}, nil)
}
func (h *Host) ManuscriptImportState(jobID string) (string, error) {
	return encodeBinding(h.manuscript.State(jobID))
}
func (h *Host) ManuscriptImportPreview(jobID string, markdownHeadingLevel int) (string, error) {
	// Runs in the background; the UI polls ManuscriptImportState for the real
	// staged progress and log (ADR-0014).
	return encodeBinding(h.manuscript.StartPreview(jobID, markdownHeadingLevel))
}
func (h *Host) ManuscriptImportCommit(jobID string, confirmedReset bool, sectionKinds map[string]string, characterCandidateIDs []string) (string, error) {
	var post manuscript.PostCommit
	if state, err := h.manuscript.State(jobID); err == nil && state.Draft != nil && h.guide != nil {
		candidates := state.Draft.CharacterCandidates
		post = func(report func(int, string)) error {
			h.seedCharacterCandidates(candidates, characterCandidateIDs, report)
			return nil
		}
	}
	return encodeBinding(h.manuscript.StartCommit(jobID, confirmedReset, sectionKinds, post))
}

// seedCharacterCandidates writes the user's checked character suggestions
// into the Story Bible as manual entities. Calls run sequentially (never in
// parallel) because each one shells out to a Python process that rewrites
// the whole manuscript_guide.json file - concurrent writers would race. A
// failed candidate is skipped and logged, not fatal: the manuscript import
// itself has already been written by this point. Each candidate reports its
// own progress, since these Python launches are the slow part of an import.
func (h *Host) seedCharacterCandidates(candidates []importer.CharacterCandidate, selectedIDs []string, report func(percent int, message string)) {
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
		entityID, err := h.guide.Create(candidate.Name, "Character", nil)
		if err != nil {
			report(index*100/len(chosen), fmt.Sprintf("Skipped %s: %v", candidate.Name, err))
			continue
		}
		if candidate.Description != "" {
			_ = h.guide.Edit(entityID, "description", candidate.Description)
		}
	}
	if len(chosen) > 0 {
		report(100, fmt.Sprintf("Added %d Story Bible characters", len(chosen)))
	}
}
func (h *Host) ManuscriptImportCancel(jobID string) (string, error) {
	return encodeBinding(nil, h.manuscript.Cancel(jobID))
}
func (h *Host) ManuscriptClearProjectData(confirmed bool) (string, error) {
	if !confirmed {
		return "", fmt.Errorf("project data clear requires confirmation")
	}
	return encodeBinding(nil, h.manuscript.Clear())
}
func (h *Host) ManuscriptChapters() (string, error) { return encodeBinding(h.manuscript.Chapters()) }
func (h *Host) ManuscriptParagraphs(chapter string) (string, error) {
	return encodeBinding(h.manuscript.Paragraphs(chapter))
}
func (h *Host) ManuscriptReader() (string, error) { return encodeBinding(h.manuscript.Reader()) }
func (h *Host) ManuscriptSearch(query string) (string, error) {
	return encodeBinding(h.manuscript.Search(query))
}
func (h *Host) ManuscriptSetChapterStatus(chapter, status string) (string, error) {
	return encodeBinding(h.manuscript.SetChapterStatus(chapter, status))
}
func (h *Host) ManuscriptNotes(chapter string) (string, error) {
	return encodeBinding(h.manuscript.Notes(chapter), nil)
}
func (h *Host) ManuscriptCreateNote(chapterID, paragraphID, text, anchorText string, anchorStart, anchorEnd *int) (string, error) {
	return encodeBinding(h.manuscript.CreateNote(chapterID, paragraphID, text, anchorStart, anchorEnd, anchorText))
}
func (h *Host) ManuscriptDeleteNote(id string) (string, error) {
	return encodeBinding(nil, h.manuscript.DeleteNote(id))
}
func (h *Host) ManuscriptReaderState() (string, error) {
	return encodeBinding(h.manuscript.ReaderState(), nil)
}
func (h *Host) ManuscriptSaveReaderState(activeChapter string, activeSourceLine *int, expandedChapters []string) (string, error) {
	return encodeBinding(h.manuscript.SaveReaderState(activeChapter, activeSourceLine, expandedChapters, expandedChapters != nil))
}
func (h *Host) ManuscriptCreateBookmark(values map[string]any) (string, error) {
	return encodeBinding(h.manuscript.CreateBookmark(values))
}
func (h *Host) ManuscriptDeleteBookmark(id string) (string, error) {
	return encodeBinding(nil, h.manuscript.DeleteBookmark(id))
}

func (h *Host) TranscriptStart(options map[string]string) (string, error) {
	if h.transcript == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	if h.whisper == nil {
		return "", fmt.Errorf("the approved Whisper catalog is unavailable")
	}
	modelID := h.resolveWhisperModelID(options)
	model, knownModel := h.whisper.Model(modelID)
	if !knownModel {
		return "", fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	modelDir, err := h.whisper.Dir(modelID)
	if err != nil {
		return encodeBinding(map[string]any{"status": "asset_required", "model": previewModel(model), "installState": h.whisper.State(model), "downloadSize": modelDownloadSize(model)}, nil)
	}
	started := map[string]string{}
	for key, value := range options {
		started[key] = value
	}
	started["modelDir"] = modelDir
	return encodeBinding(map[string]any{"status": "started"}, h.transcript.Start(started))
}
func (h *Host) TranscriptCancel() (string, error) {
	if h.transcript != nil {
		h.transcript.Cancel()
	}
	return encodeBinding(nil, nil)
}
func (h *Host) TranscriptReset() (string, error) {
	if h.transcript == nil {
		return encodeBinding(nil, nil)
	}
	return encodeBinding(nil, h.transcript.Reset())
}
func (h *Host) TranscriptLastCompleted() (string, error) {
	if h.transcript == nil {
		return encodeBinding(nil, nil)
	}
	return encodeBinding(h.transcript.LastCompleted(), nil)
}
func (h *Host) TranscriptAddEquivalence(id string) (string, error) {
	if h.transcript == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	message, err := h.transcript.AddEquivalence(id)
	return encodeBinding(map[string]any{"message": message}, err)
}
func (h *Host) TranscriptJump(id string) (string, error) {
	if h.transcript == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	return encodeBinding(nil, h.transcript.Jump(id))
}
func (h *Host) TranscriptExportMarkers() (string, error) {
	if h.transcript == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	return encodeBinding(nil, h.transcript.Export())
}
func (h *Host) TranscriptSuggestHints() (string, error) {
	if h.guide == nil || h.transcript == nil {
		return "", fmt.Errorf("build the Story Bible before requesting vocabulary suggestions")
	}
	values, err := h.guide.VocabularyCandidates()
	if err != nil {
		return "", err
	}
	accepted := map[string]bool{}
	for _, value := range h.transcript.Hints() {
		accepted[strings.ToLower(value)] = true
	}
	suggested := []string{}
	for _, value := range values {
		if !accepted[strings.ToLower(value)] {
			suggested = append(suggested, value)
		}
	}
	return encodeBinding(map[string]any{"value": strings.Join(suggested, ", ")}, nil)
}
func (h *Host) TranscriptHints() (string, error) {
	if h.transcript == nil {
		return encodeBinding([]string{}, nil)
	}
	return encodeBinding(h.transcript.Hints(), nil)
}
func (h *Host) TranscriptSaveHints(accepted []string) (string, error) {
	if h.transcript == nil {
		return "", fmt.Errorf("the Transcript Compare service is unavailable")
	}
	return encodeBinding(nil, h.transcript.SaveHints(accepted))
}

func (h *Host) TracksDiscover() (string, error) { return encodeBinding(h.tracksDiscover()) }
func (h *Host) TracksSelect(path string) (string, error) {
	return encodeBinding(h.tracksSelect(path))
}
func (h *Host) TracksList() (string, error) { return encodeBinding(h.tracksList()) }
