package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/recording"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

// The built-in recorder's bindings (native-recording-suite PRD Phase 2, docs/adr/0455): the Booth records with REAPER or
// with the built-in recorder, a per-project choice that sets the engine chip. The recorder itself is internal/recording over
// the capture port's wasapi row (Experimental, ADR 0357); every state change goes out as the "recording:state" live event and
// every level report as "recording:level". The choice and the remembered device are the project settings rows
// Recording.engine and Recording.device, written only here (like Mastering.provider, bindings_mastering.go): not generic
// Settings fields, so the Settings page neither lists nor saves them. The wire schema, golden payloads, wireContracts rows and
// mock live in apps/ui/src/api (docs/architecture/wire-contracts.md).
const (
	recordingSettingsTool = "Recording"
	recordingEngineKey    = "engine"
	recordingDeviceKey    = "device"
	engineDAW             = "daw"
	engineBuiltin         = "builtin"
	// recorderDevicesTimeout bounds one `--list-devices --capture wasapi` run, like teleprompterDevicesTimeout.
	recorderDevicesTimeout = 20 * time.Second
)

// RecorderState is the "recording:state" payload and every recorder binding's answer: the project's engine choice, how far
// the recorder's capture row is supported here, and the recorder's own state (its phase, the take recording, the folder's takes).
type RecorderState struct {
	HasProject bool           `json:"hasProject"`
	Engine     string         `json:"engine"`
	Support    map[string]any `json:"support"`
	recording.State
}

// RecorderState answers the recorder's state. It changes nothing.
func (h *Host) RecorderState() (string, error) {
	return encodeBinding(h.recorderState(h.services(), nil), nil)
}

// RecorderChooseEngine saves which engine the project records with: "daw" (REAPER, the default) or "builtin". The built-in
// recorder is refused, with its sentence, where its capture row is not available; nothing changes while a take records.
func (h *Host) RecorderChooseEngine(engine string) (string, error) {
	svc := h.services()
	if svc.config.projectFolder == "" || svc.settings == nil {
		return "", errors.New("open a project before choosing how it records")
	}
	if svc.recorder != nil && svc.recorder.Busy() {
		return "", errors.New("stop the take before changing how the project records")
	}
	var value *string
	switch engine {
	case engineDAW:
	case engineBuiltin:
		if support := recorderSupport(h.recorderPlatform()); !support.Available {
			return "", &port.NotSupportedError{Capability: captureport.WASAPI, Support: support}
		}
		value = &engine
	default:
		return "", errors.New(`the engine is "daw" or "builtin"`)
	}
	if engine == engineDAW && svc.recorder != nil {
		svc.recorder.StopMeter()
	}
	if err := svc.settings.Save(recordingSettingsTool, "project", map[string]*string{recordingEngineKey: value}); err != nil {
		return "", err
	}
	return h.RecorderState()
}

// RecorderDevices lists the input devices the built-in recorder can open. Like TeleprompterDevices, a listing problem comes
// back as {"devices": [], "error": "..."}, never a rejected promise.
func (h *Host) RecorderDevices() (string, error) {
	service := h.services().recorder
	if service == nil {
		return "", errors.New("the built-in recorder is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), recorderDevicesTimeout)
	defer cancel()
	devices, message, err := service.Devices(ctx)
	if err != nil {
		return "", err
	}
	return encodeBinding(map[string]any{"devices": devices, "error": nonEmptyOrNil(message)}, nil)
}

// RecorderMeterStart shows device's level before a take (no file is written), replacing a meter already running. It is
// refused while a take records.
func (h *Host) RecorderMeterStart(device string) (string, error) {
	svc, err := h.builtinRecorder()
	if err != nil {
		return "", err
	}
	if err := svc.recorder.Meter(device); err != nil {
		return "", err
	}
	return encodeBinding(h.recorderState(svc, nil), nil)
}

// RecorderMeterStop ends the level meter; it leaves a take alone.
func (h *Host) RecorderMeterStop() (string, error) {
	svc := h.services()
	if svc.recorder != nil {
		svc.recorder.StopMeter()
	}
	return encodeBinding(h.recorderState(svc, nil), nil)
}

// RecorderStart records a new take of device into the project's Recordings folder and remembers the device for the project.
// It answers once the take has started; its end arrives as "recording:state".
func (h *Host) RecorderStart(device string) (string, error) {
	svc, err := h.builtinRecorder()
	if err != nil {
		return "", err
	}
	if err := svc.recorder.Start(device); err != nil {
		return "", err
	}
	trimmed := strings.TrimSpace(device)
	if err := svc.settings.Save(recordingSettingsTool, "project", map[string]*string{recordingDeviceKey: &trimmed}); err != nil {
		_ = h.log.Report("recording", "could not remember the recorder's device: "+err.Error())
	}
	return encodeBinding(h.recorderState(svc, nil), nil)
}

// RecorderStop asks the take (or the meter) to end and answers at once; the take's end arrives as "recording:state".
func (h *Host) RecorderStop() (string, error) {
	svc := h.services()
	if svc.recorder != nil {
		svc.recorder.Stop()
	}
	return encodeBinding(h.recorderState(svc, nil), nil)
}

// RecorderSetTakeLine assigns takeName the manuscript paragraph or chapter entityId as its line identity (Phase 3,
// ADR 0485), so it joins the review pipeline the same way a REAPER item's stamped line id does (native-recording-suite
// PRD Phase 4, "take review integration" - Phase 3 built SetTakeLine with no UI caller yet). entityId "" clears the
// assignment. The manuscript's current source checksum is read here, never sent by the caller, so a stale UI can
// never stamp a wrong one.
func (h *Host) RecorderSetTakeLine(takeName, entityId string) (string, error) {
	svc := h.services()
	if svc.recorder == nil {
		return "", errors.New("open a project before assigning a take a manuscript line")
	}
	sourceSHA256 := ""
	if entityId != "" {
		sourceSHA256 = recordingManuscriptSourceHash(svc.manuscript)
		if sourceSHA256 == "" {
			return "", errors.New("import a manuscript before assigning a take to a line")
		}
	}
	if err := svc.recorder.SetTakeLine(takeName, entityId, sourceSHA256); err != nil {
		return "", err
	}
	return encodeBinding(h.recorderState(svc, nil), nil)
}

// RecorderSetTakeKeeper marks or unmarks takeName the keeper among the takes assigned to its line (Phase 4, Q5):
// narrator-confirmed, and always undoable by marking it again with keeper false or by marking a different take of the
// same line.
func (h *Host) RecorderSetTakeKeeper(takeName string, keeper bool) (string, error) {
	svc := h.services()
	if svc.recorder == nil {
		return "", errors.New("open a project before marking a take the keeper")
	}
	if err := svc.recorder.SetTakeKeeper(takeName, keeper); err != nil {
		return "", err
	}
	return encodeBinding(h.recorderState(svc, nil), nil)
}

// recordingManuscriptSourceHash reads the manuscript's own recorded source checksum, the same field
// internal/lineidentity's own sourceSHA256 reads (that package's own helper is unexported, so this is this binding
// file's own small copy of the same lookup bindings_preview.go already makes for its own purpose, not a second
// scheme).
func recordingManuscriptSourceHash(service *manuscript.Service) string {
	if service == nil {
		return ""
	}
	data, err := service.Load()
	if err != nil {
		return ""
	}
	source, ok := data["source"].(map[string]any)
	if !ok {
		return ""
	}
	sha, _ := source["sha256"].(string)
	return sha
}

// builtinRecorder is the services snapshot when the project records with the built-in recorder, or the reason it cannot.
func (h *Host) builtinRecorder() (hostServices, error) {
	svc := h.services()
	switch {
	case svc.config.projectFolder == "" || svc.settings == nil || svc.recorder == nil:
		return svc, errors.New("open a project before recording: its takes are saved in the project folder")
	case h.recordingEngine(svc) != engineBuiltin:
		return svc, errors.New("choose the built-in recorder in the Booth before recording with it")
	}
	return svc, nil
}

// recordingEngine is the project's engine choice: "builtin" only when it chose the built-in recorder and its row is
// available here, "daw" otherwise.
func (h *Host) recordingEngine(svc hostServices) string {
	if svc.config.projectFolder == "" || svc.settings == nil {
		return engineDAW
	}
	if svc.settings.Project(recordingSettingsTool)[recordingEngineKey] == engineBuiltin && recorderSupport(h.recorderPlatform()).Available {
		return engineBuiltin
	}
	return engineDAW
}

// recorderPlatform is the GOOS the recorder answers for (h.platform, the tests' seam).
func (h *Host) recorderPlatform() string { return teleprompter.PlatformOrCurrent(h.platform) }

// recorderSupport is the wasapi capture row's answer on platform (ADR 0357: Experimental, Windows only).
func recorderSupport(platform string) port.Support {
	entry, err := captureport.Backends.Lookup(captureport.WASAPI)
	if err != nil {
		var notSupported *port.NotSupportedError
		if errors.As(err, &notSupported) {
			return notSupported.Support
		}
		return port.Support{Level: port.Unsupported, Reason: port.ReasonUnsupported, Message: err.Error()}
	}
	return providerSupport(entry.Descriptor, entry.New().Level(), platform)
}

// recorderState is the payload for svc, from state when given (an emitted change) or the recorder's snapshot.
func (h *Host) recorderState(svc hostServices, state *recording.State) RecorderState {
	payload := RecorderState{
		HasProject: svc.config.projectFolder != "",
		Engine:     h.recordingEngine(svc),
		Support:    supportPayload(recorderSupport(h.recorderPlatform())),
	}
	switch {
	case state != nil:
		payload.State = *state
	case svc.recorder != nil:
		payload.State = svc.recorder.Snapshot()
	default:
		payload.State = recording.State{Phase: recording.PhaseIdle, Takes: []recording.Take{}}
	}
	if payload.Device == "" && svc.settings != nil && payload.HasProject {
		payload.Device = svc.settings.Project(recordingSettingsTool)[recordingDeviceKey]
	}
	return payload
}

// newRecorderLocked is the project's recorder over the capture port's wasapi row, run in the teleprompter sidecar. Its events go out
// only while it is still the host's recorder, so a switched-away project's last word never reaches the UI.
func (h *Host) newRecorderLocked(sessionDir string) *recording.Service {
	var engine recording.Engine
	if entry, err := captureport.Backends.Lookup(captureport.WASAPI); err == nil {
		sidecar := recording.SidecarConfig{Program: h.config.teleprompterPython, SessionDir: sessionDir}
		if h.config.teleprompterBackend != "" {
			sidecar.Prefix = []string{h.config.teleprompterBackend}
		}
		engine = recording.NewSidecar(entry.New(), sidecar, h.sidecars)
	}
	var service *recording.Service
	service = recording.New(recording.Config{Project: h.config.projectFolder}, engine,
		func(state recording.State) { h.emitRecordingState(service, state) },
		func(level recording.Level) { h.emitRecordingLevel(service, level) })
	return service
}

func (h *Host) emitRecordingState(from *recording.Service, state recording.State) {
	svc := h.services()
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx != nil && svc.recorder == from {
		emitEvent("recording:state", h.recorderState(svc, &state))
	}
}

func (h *Host) emitRecordingLevel(from *recording.Service, level recording.Level) {
	svc := h.services()
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx != nil && svc.recorder == from {
		emitEvent("recording:level", level)
	}
}
