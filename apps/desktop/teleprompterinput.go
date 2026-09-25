package main

import (
	"context"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

// Which microphone REAPER uses, for the teleprompter's microphone picker (teleprompter-manuscript-integration PRD Phase
// 11, ADR 0250): REAPER's open input device, from chapter_track_state's device read, matched against the names the
// teleprompter's capture opens. The picker preselects Device only when Status is matched, with Message as the reason;
// every other answer leaves the full list and the narrator's own choice as they are.

// The reasons that go with unavailable, beside the connection ones (reaperStandalone, reaperNotRunning,
// readAloudExperimentalOff, refusedFailed).
const (
	inputReaperNoDevice = "reaper_no_device"
	inputDevicesFailed  = "devices_failed"
)

// teleprompterReaperInput is the answer: Status is daw.InputMatched, daw.InputUncertain, daw.InputNoMatch or
// "unavailable" (with a Reason). ReaperDevice is what REAPER named, Device the microphone to preselect (matched only),
// Candidates the microphones that fit equally well (uncertain only).
type teleprompterReaperInput struct {
	Status       string   `json:"status"`
	Reason       string   `json:"reason,omitempty"`
	Message      string   `json:"message"`
	ReaperDevice string   `json:"reaperDevice,omitempty"`
	Device       string   `json:"device,omitempty"`
	Candidates   []string `json:"candidates"`
}

// deviceLister is the teleprompter service's microphone listing (a fake in tests).
type deviceLister interface {
	Devices(ctx context.Context) ([]teleprompter.Device, string, error)
}

// TeleprompterReaperInput answers which of the teleprompter's microphones REAPER records from, so the picker can
// preselect it with a reason (teleprompter-manuscript-integration.prd.md Phase 11). It asks REAPER once, read-only,
// and never on a timer; a REAPER that is not there or cannot say is an answer, and the picker then keeps its list.
func (h *Host) TeleprompterReaperInput() (string, error) {
	svc := h.services()
	var reader trackStateReader
	if svc.actions != nil {
		reader = svc.actions
	}
	var lister deviceLister
	if svc.teleprompter != nil {
		lister = svc.teleprompter
	}
	return encodeBinding(teleprompterReaperInputIn(context.Background(), svc, reader, lister), nil)
}

func teleprompterReaperInputIn(ctx context.Context, svc hostServices, reader trackStateReader, lister deviceLister) teleprompterReaperInput {
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return inputUnavailable(status.Connection, readAloudConnectionMessage(status.Connection))
	}
	if reader == nil {
		return inputUnavailable(reaperStandalone, messageReaperOff)
	}
	state, err := reader.ChapterTrackState(ctx, "")
	if err != nil {
		refusal := readAloudRefusal(err, "", "")
		return inputUnavailable(refusal.Reason, refusal.Message)
	}
	if state.InputDevice == "" {
		return inputUnavailable(inputReaperNoDevice, "REAPER did not say which input device it has open. Choose the microphone yourself.")
	}
	if lister == nil {
		return inputUnavailable(inputDevicesFailed, "The microphones on this computer could not be listed.")
	}
	listCtx, cancel := context.WithTimeout(ctx, teleprompterDevicesTimeout)
	defer cancel()
	devices, message, err := lister.Devices(listCtx)
	if err == nil && message != "" {
		err = fmt.Errorf("%s", message)
	}
	if err != nil {
		answer := inputUnavailable(inputDevicesFailed, err.Error())
		answer.ReaperDevice = state.InputDevice
		return answer
	}
	names := make([]string, 0, len(devices))
	for _, device := range devices {
		names = append(names, device.Name)
	}
	match := daw.MatchInputDevice(state.InputDevice, names)
	answer := teleprompterReaperInput{Status: match.Status, ReaperDevice: state.InputDevice, Device: match.Device, Candidates: []string{}}
	switch match.Status {
	case daw.InputMatched:
		answer.Message = fmt.Sprintf("REAPER records from %q, so %q is selected.", state.InputDevice, match.Device)
	case daw.InputUncertain:
		answer.Candidates = match.Candidates
		answer.Message = fmt.Sprintf("REAPER records from %q, which could be any of %d microphones here. Choose the one REAPER uses.", state.InputDevice, len(match.Candidates))
	default:
		answer.Message = fmt.Sprintf("REAPER records from %q, which does not match a microphone here. Choose the microphone yourself.", state.InputDevice)
	}
	return answer
}

func inputUnavailable(reason, message string) teleprompterReaperInput {
	return teleprompterReaperInput{Status: "unavailable", Reason: reason, Message: message, Candidates: []string{}}
}
