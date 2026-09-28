package production

import (
	"math"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// This file is Phase 2 of the production tracking PRD (delivered and deleted; ADR 0028): PFH (hours
// worked per finished hour) and the effective hourly rate, computed only from
// hours the narrator logged and audio the app measured (ADR 0320). Nothing
// here falls back to the word-count estimate (Q4): a figure with no honest
// input is undefined, returned as ok == false, never 0 and never a guess.

// Recorded is the port through which the host hands this package each
// chapter's measured recorded seconds: tracks.Track.RecordedSeconds of the
// chapter's one confirmed track (the actual-recorded-column path). A chapter
// that is absent has no measurement; a measured chapter with nothing audible
// is present with 0.
type Recorded func() (map[string]float64, error)

// LoggedHours is the time logged by every stopped session. A running timer
// has logged nothing yet.
func LoggedHours(sessions []Session) float64 {
	return hoursWhere(sessions, func(Session) bool { return true })
}

// ChapterHours is the time logged by the stopped sessions on chapterID, every
// stage together.
func ChapterHours(sessions []Session, chapterID string) float64 {
	return hoursWhere(sessions, func(session Session) bool { return session.ChapterID == chapterID })
}

// HoursByStage is the time logged by the stopped sessions, per stage. A stage
// with no logged time is absent.
func HoursByStage(sessions []Session) map[stages.Stage]float64 {
	out := map[stages.Stage]float64{}
	for _, session := range sessions {
		if !session.Running() {
			out[session.Stage] += session.Duration().Hours()
		}
	}
	return out
}

// ChapterPFH is chapterID's hours logged, every stage together, divided by
// its measured recorded hours. It is undefined for a chapter with no
// measurement, with nothing recorded yet, or with no logged time.
func ChapterPFH(sessions []Session, recorded map[string]float64, chapterID string) (float64, bool) {
	seconds, ok := recorded[chapterID]
	if !ok || !measured(seconds) || seconds == 0 {
		return 0, false
	}
	return perFinishedHour(ChapterHours(sessions, chapterID), seconds)
}

// BookPFH is every hour logged on the book divided by every measured recorded
// hour so far (Q4 A). A chapter with no measurement, or measured at 0,
// adds nothing to the recorded total, but its logged hours still count: the
// hours were worked on the book. It is undefined until some audio is
// measured and some time is logged.
func BookPFH(sessions []Session, recorded map[string]float64) (float64, bool) {
	total := 0.0
	for _, seconds := range recorded {
		if measured(seconds) {
			total += seconds
		}
	}
	return perFinishedHour(LoggedHours(sessions), total)
}

// EffectiveRate is the book's contracted amount divided by every hour logged
// on it. It is undefined with no amount set, an amount that is not a finite,
// non-negative number, or no logged time. The amount is a bare number in the
// narrator's own currency: nothing here converts or formats it.
func EffectiveRate(amount *float64, sessions []Session) (float64, bool) {
	if amount == nil || !measured(*amount) {
		return 0, false
	}
	hours := LoggedHours(sessions)
	if hours <= 0 {
		return 0, false
	}
	return *amount / hours, true
}

// PFH is ChapterPFH over the project's own log and the Recorded port.
func (s *Service) PFH(chapterID string) (float64, bool, error) {
	sessions, recorded, err := s.pfhInputs()
	if err != nil {
		return 0, false, err
	}
	value, ok := ChapterPFH(sessions, recorded, chapterID)
	return value, ok, nil
}

// BookPFH is BookPFH over the project's own log and the Recorded port.
func (s *Service) BookPFH() (float64, bool, error) {
	sessions, recorded, err := s.pfhInputs()
	if err != nil {
		return 0, false, err
	}
	value, ok := BookPFH(sessions, recorded)
	return value, ok, nil
}

func (s *Service) pfhInputs() ([]Session, map[string]float64, error) {
	sessions, err := s.Sessions()
	if err != nil {
		return nil, nil, err
	}
	if s.config.Recorded == nil {
		return sessions, nil, nil
	}
	recorded, err := s.config.Recorded()
	if err != nil {
		return nil, nil, err
	}
	return sessions, recorded, nil
}

func perFinishedHour(hours, recordedSeconds float64) (float64, bool) {
	if hours <= 0 || recordedSeconds <= 0 {
		return 0, false
	}
	return hours / (recordedSeconds / 3600), true
}

func hoursWhere(sessions []Session, keep func(Session) bool) float64 {
	total := 0.0
	for _, session := range sessions {
		if !session.Running() && keep(session) {
			total += session.Duration().Hours()
		}
	}
	return total
}

// measured reports whether value is a finite, non-negative number: anything
// else is not a measurement and is ignored rather than propagated.
func measured(value float64) bool {
	return value >= 0 && !math.IsInf(value, 0) && !math.IsNaN(value)
}
