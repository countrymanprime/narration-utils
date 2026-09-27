package main

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Following REAPER while the read-aloud dialog's resume prompt shows (read-aloud-resume-from-daw PRD Phase 5, ADR 0353).
// While the UI follows a chapter, the host reads chapter_track_state (the DAW port's Track state role) about once a
// second, never while a teleprompter session runs, and tells the UI on teleprompter_resume_follow when REAPER starts
// playing or recording (RD7: the prompt goes away) or when the edit cursor settles on the chapter's recorded audio (RD6:
// the UI re-runs the locate). It is not the heartbeat: it runs only for an open prompt, and stops when the UI unfollows,
// when another follow replaces it, when REAPER plays or records, when the app quits, or after resumeFollowLifetime. It
// only reads.

// teleprompter_resume_follow reasons.
const (
	followPlaying     = "playing"
	followRecording   = "recording"
	followCursorMoved = "cursor_moved"
)

// Why TeleprompterResumeFollow is not following.
const (
	followUnavailable = "unavailable" // no Track state role: no DAW, REAPER not reachable, or the capability off
	followNoTrack     = "no_track"    // the chapter has no track to follow yet
)

// resumeFollowInterval is how often the poll reads REAPER; resumeFollowLifetime bounds one follow, so a prompt left open
// all day does not keep REAPER busy. Vars so a test can shorten them.
var (
	resumeFollowInterval = time.Second
	resumeFollowLifetime = 30 * time.Minute
)

// followCursorTolerance is how far, in seconds, the edit cursor must move to count as moved.
const followCursorTolerance = 0.01

// resumeFollowEvent is teleprompter_resume_follow's payload. EditCursor, in project seconds, is set for cursor_moved.
type resumeFollowEvent struct {
	ChapterID  string   `json:"chapterId"`
	Reason     string   `json:"reason"`
	EditCursor *float64 `json:"editCursor,omitempty"`
}

// resumeFollowAnswer is TeleprompterResumeFollow's (and TeleprompterResumeUnfollow's) answer: whether the host is now
// following, and why not when it is not.
type resumeFollowAnswer struct {
	Following bool   `json:"following"`
	Reason    string `json:"reason,omitempty"`
}

// resumeFollower turns successive reads of REAPER into what the prompt needs to hear. The first read sets the baseline
// cursor; a cursor that moves counts once it reads the same twice in a row (one poll interval, RD6's debounce, as a
// locate costs a Whisper run), and is reported only when it settled on the track's recorded audio (the RD2 rule
// liveRecordedEnd applies to the locate).
type resumeFollower struct {
	chapterID string
	saved     *tracks.Track
	span      *tracks.Span
	folder    string
	seen      bool
	baseline  float64
	pending   *float64
}

func newResumeFollower(chapterID string, saved *tracks.Track, span *tracks.Span, projectFolder string) *resumeFollower {
	return &resumeFollower{chapterID: chapterID, saved: saved, span: span, folder: projectFolder}
}

// step takes one read and answers the event to send (nil for none) and whether the poll should stop. REAPER playing
// or recording (on any track: the narrator is at REAPER) is reported at once, even on the first read, and ends the poll.
func (f *resumeFollower) step(state dawport.TrackState) (*resumeFollowEvent, bool) {
	switch {
	case state.Recording:
		return &resumeFollowEvent{ChapterID: f.chapterID, Reason: followRecording}, true
	case state.Playing:
		return &resumeFollowEvent{ChapterID: f.chapterID, Reason: followPlaying}, true
	}
	cursor := state.EditCursor
	if !f.seen {
		f.seen, f.baseline = true, cursor
		return nil, false
	}
	if nearCursor(cursor, f.baseline) {
		f.pending = nil
		return nil, false
	}
	if f.pending == nil || !nearCursor(cursor, *f.pending) {
		f.pending = &cursor
		return nil, false
	}
	f.baseline, f.pending = cursor, nil
	if _, at, ok := liveRecordedEnd(state, f.saved, f.span, f.folder); ok && at == liveAtCursor {
		return &resumeFollowEvent{ChapterID: f.chapterID, Reason: followCursorMoved, EditCursor: &cursor}, false
	}
	return nil, false
}

func nearCursor(a, b float64) bool {
	return math.Abs(a-b) < followCursorTolerance
}

// resumeFollowLoop is one follow: what to read, how often, for how long, and where the events go.
type resumeFollowLoop struct {
	reader      trackStateReader
	projectPath string
	trackGUID   string
	follower    *resumeFollower
	sessionBusy func() bool
	emit        func(resumeFollowEvent)
	interval    time.Duration
	lifetime    time.Duration
}

// run polls until ctx ends, the lifetime runs out, or the follower says stop. A tick while a session runs asks REAPER
// nothing; a read REAPER does not answer, or answers for another project, is skipped; nothing is emitted once ctx ended,
// so an unfollow is never followed by an event.
func (l resumeFollowLoop) run(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, l.lifetime)
	defer cancel()
	ticker := time.NewTicker(l.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if l.sessionBusy() {
			continue
		}
		state, ok := readLiveTrack(ctx, l.reader, l.projectPath, l.trackGUID)
		if !ok || ctx.Err() != nil {
			continue
		}
		event, stop := l.follower.step(state)
		if event != nil {
			l.emit(*event)
		}
		if stop {
			return
		}
	}
}

// TeleprompterResumeFollow starts following REAPER for chapterID's resume prompt (read-aloud-resume-from-daw PRD Phase 5,
// ADR 0353), replacing any follow already running. trackGUID is the track the prompt's locate read ("" for the chapter's
// matched track); like TeleprompterLocate, a picked track must be one of the selected project's. It answers whether it
// follows: not with no track to follow or no way to ask REAPER, which is an answer, not an error.
func (h *Host) TeleprompterResumeFollow(chapterID, trackGUID string) (string, error) {
	svc := h.services()
	emit := func(event resumeFollowEvent) { emitEvent("teleprompter_resume_follow", event) }
	return encodeBinding(h.teleprompterResumeFollowWith(svc, trackStateReaderFrom(svc), chapterID, trackGUID, emit))
}

// TeleprompterResumeUnfollow stops following REAPER (the prompt went away, or the dialog closed). It is safe to call
// with nothing followed.
func (h *Host) TeleprompterResumeUnfollow() (string, error) {
	h.stopResumeFollow()
	return encodeBinding(resumeFollowAnswer{}, nil)
}

func (h *Host) teleprompterResumeFollowWith(svc hostServices, reader trackStateReader, chapterID, trackGUID string, emit func(resumeFollowEvent)) (resumeFollowAnswer, error) {
	h.stopResumeFollow()
	if svc.teleprompter == nil {
		return resumeFollowAnswer{}, fmt.Errorf("the teleprompter service is unavailable")
	}
	match, project, err := chapterTrackMatchIn(svc, chapterID)
	if err != nil {
		return resumeFollowAnswer{}, err
	}
	candidate, err := locateTrack(match, project, trackGUID)
	if err != nil {
		return resumeFollowAnswer{}, err
	}
	if candidate == nil {
		return resumeFollowAnswer{Reason: followNoTrack}, nil
	}
	if reader == nil {
		return resumeFollowAnswer{Reason: followUnavailable}, nil
	}
	h.startResumeFollow(resumeFollowLoop{
		reader:      reader,
		projectPath: project.Path,
		trackGUID:   candidate.TrackGUID,
		follower:    newResumeFollower(chapterID, savedTrack(project, candidate.TrackGUID), candidateSpan(*candidate), svc.config.projectFolder),
		sessionBusy: svc.teleprompter.Busy,
		emit:        emit,
		interval:    resumeFollowInterval,
		lifetime:    resumeFollowLifetime,
	})
	return resumeFollowAnswer{Following: true}, nil
}

// startResumeFollow runs loop under the app's context (so quitting stops it), replacing the follow before it.
func (h *Host) startResumeFollow(loop resumeFollowLoop) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.resumeFollowCancel != nil {
		h.resumeFollowCancel()
	}
	parent := h.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	h.resumeFollowCancel = cancel
	go loop.run(ctx)
}

func (h *Host) stopResumeFollow() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.resumeFollowCancel != nil {
		h.resumeFollowCancel()
		h.resumeFollowCancel = nil
	}
}
