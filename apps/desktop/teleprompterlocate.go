package main

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// teleprompterLocateTimeout bounds one tail-audio locate: a model load and a decode of at most
// teleprompter.MaxTailSeconds of audio, which the tiny model does in a few seconds on a CPU and the largest in about
// a minute.
const teleprompterLocateTimeout = 3 * time.Minute

// Locate statuses (TeleprompterLocate's `status`, teleprompter-manuscript-integration PRD Phase 9, ADR 0111). Only
// found and low_confidence carry a resume word; every other one says why there is none, so the resume card (Phase 10)
// can offer the right next step. asset_required is modelAssetRequired's own shape.
const (
	locateFound             = "found"
	locateLowConfidence     = "low_confidence"
	locateNotFound          = "not_found"
	locateNoTrack           = "no_track"
	locateNoRecording       = "no_recording"
	locateSourceMissing     = "source_missing"
	locateSourceUnsupported = "source_unsupported"
)

// tailRange is the stretch of the source file the locate transcribed, in seconds of that file.
type tailRange struct {
	From float64 `json:"from"`
	To   float64 `json:"to"`
}

// teleprompterLocate is TeleprompterLocate's payload. Match is the chapter's track match as ChapterTrackMatch reports
// it (the picker and the "as of last save" time come from it); Track and RecordedEnd are the track that was read,
// which is the narrator's pick when they made one; Tail and Located are set once the sidecar ran. LastReading is
// where the prompter last stopped in the chapter (ADR 0205), and Verdict reconciles it with Located
// (read-aloud-resume-from-daw PRD Phase 3): it is set on every status, so a chapter with no track still offers its
// last reading.
type teleprompterLocate struct {
	Status      string                     `json:"status"`
	Match       chapterTrackMatch          `json:"match"`
	Track       *trackOption               `json:"track"`
	RecordedEnd *tracks.RecordedEnd        `json:"recordedEnd"`
	Tail        *tailRange                 `json:"tail"`
	Located     *teleprompter.Located      `json:"located"`
	LastReading *teleprompter.Reading      `json:"lastReading"`
	Verdict     teleprompter.ResumeVerdict `json:"verdict"`
}

// TeleprompterLocate finds where to resume reading chapterID from what is already recorded (teleprompter-manuscript-
// integration PRD Phase 9, ADR 0111): the chapter's track (the matcher's confident track, or trackGUID when the
// narrator picked one), where its audio ends as of the .rpp's last save (Phase 8), and the last
// teleprompter.DefaultTailSeconds before that end transcribed and placed in the chapter by the sidecar. model is the
// Whisper model id ("" for the teleprompter's default); like TeleprompterStart it answers asset_required instead of
// downloading one, but only once there is audio to read. Every other answer carries the prompter's last reading and the
// reconciled verdict (PRD Phase 3). It only reads: nothing is recorded, moved or linked.
func (h *Host) TeleprompterLocate(chapterID, trackGUID, model string) (string, error) {
	return encodeBinding(h.teleprompterLocate(chapterID, trackGUID, model))
}

func (h *Host) teleprompterLocate(chapterID, trackGUID, model string) (any, error) {
	svc := h.services()
	if svc.teleprompter == nil {
		return nil, fmt.Errorf("the teleprompter service is unavailable")
	}
	match, project, err := chapterTrackMatchIn(svc, chapterID)
	if err != nil {
		return nil, err
	}
	result, err := h.locateTail(svc, chapterID, trackGUID, model, match, project)
	if err != nil {
		return nil, err
	}
	if located, ok := result.(teleprompterLocate); ok {
		return withResumeVerdict(svc.config.projectFolder, chapterID, located), nil
	}
	return result, nil // asset_required: the model gate is answered first
}

// withResumeVerdict adds the chapter's last reading and the reconciled verdict to a locate result. A reading that
// cannot be read is treated as absent: it only ever narrows what is offered.
func withResumeVerdict(projectFolder, chapterID string, result teleprompterLocate) teleprompterLocate {
	script, ok := teleprompter.LoadChapterScript(projectFolder, chapterID)
	if !ok {
		result.Verdict = teleprompter.ResumeVerdict{Kind: teleprompter.VerdictNone}
		return result
	}
	reading, err := teleprompter.LoadReading(projectFolder, chapterID)
	if err != nil {
		reading = nil
	}
	result.LastReading = reading
	result.Verdict = teleprompter.Reconcile(result.Located, reading, script, teleprompter.ResumeTolerance)
	return result
}

// locateTail reads the chapter's track and places its recorded tail: a teleprompterLocate, or the model gate's
// asset_required answer.
func (h *Host) locateTail(svc hostServices, chapterID, trackGUID, model string, match chapterTrackMatch, project tracks.Project) (any, error) {
	result := teleprompterLocate{Match: match}
	candidate, err := locateTrack(match, project, trackGUID)
	if err != nil {
		return nil, err
	}
	if candidate == nil {
		result.Status = locateNoTrack
		return result, nil
	}
	result.Track = &trackOption{GUID: candidate.TrackGUID, Name: candidate.TrackName, Index: candidate.TrackIndex}
	end, ok := chaptermatch.RecordedEnd(project, *candidate)
	if !ok {
		result.Status = locateNoRecording
		return result, nil
	}
	result.RecordedEnd = &end
	switch {
	case !end.SourceAvailable:
		result.Status = locateSourceMissing
		return result, nil
	case !end.Supported:
		result.Status = locateSourceUnsupported
		return result, nil
	}
	modelID, modelDir, required, err := h.teleprompterModel(model)
	if err != nil {
		return nil, err
	}
	if required != nil {
		return required, nil
	}
	tail := tailRange{From: math.Max(end.SourceStart, end.SourceTime-teleprompter.DefaultTailSeconds), To: end.SourceTime}
	result.Tail = &tail
	ctx, cancel := context.WithTimeout(context.Background(), teleprompterLocateTimeout)
	defer cancel()
	run := h.runLog.Begin("teleprompter_locate", "chapter_id", chapterID)
	located, err := svc.teleprompter.Locate(runlog.WithRun(ctx, run), teleprompter.LocateRequest{
		Chapter: chapterID, Audio: end.SourceFile, From: tail.From, To: tail.To, Model: modelID, ModelDir: modelDir,
	})
	if err != nil {
		run.End("error")
		return nil, err
	}
	run.End("ok")
	result.Located = &located
	result.Status = locatedStatus(located)
	return result, nil
}

// locateTrack is the track to read: the narrator's pick (which must be a track of the selected project; a candidate
// the matcher found keeps its region), else the match's own track, which is set only for a confirmed or confident
// match (an uncertain guess never yields a resume point). nil means there is no track to read yet.
func locateTrack(match chapterTrackMatch, project tracks.Project, trackGUID string) (*chaptermatch.Candidate, error) {
	if trackGUID == "" || (match.Track != nil && match.Track.TrackGUID == trackGUID) {
		return match.Track, nil
	}
	for _, candidate := range match.Candidates {
		if candidate.TrackGUID == trackGUID {
			picked := candidate
			return &picked, nil
		}
	}
	for _, track := range project.Tracks {
		if track.GUID == trackGUID {
			return &chaptermatch.Candidate{TrackGUID: track.GUID, TrackName: track.Name, TrackIndex: track.Index}, nil
		}
	}
	return nil, fmt.Errorf("that track is not in the selected REAPER project")
}

func locatedStatus(located teleprompter.Located) string {
	switch {
	case located.Word == nil:
		return locateNotFound
	case located.Confident:
		return locateFound
	default:
		return locateLowConfidence
	}
}
