package passagetakes

import (
	"context"
	"errors"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/takereview"
)

// What Use answers.
const (
	OutcomeDone    = "done"
	OutcomeStarted = "started"
	OutcomeRefused = "refused"

	ReasonNotOffered      = "not_offered"
	ReasonUnusable        = "unusable"
	ReasonStale           = "stale"
	ReasonRecording       = "recording"
	ReasonScriptOutdated  = "script_outdated"
	ReasonStandalone      = "standalone"
	ReasonNotRunning      = "not_running"
	ReasonExperimentalOff = "experimental_off"
	ReasonFailed          = "failed"
)

// Actors are the REAPER requests Use may make, each nil when the DAW cannot do it (standalone, or no such role).
type Actors struct {
	// SetActiveTake is set_active_take: one undo step, reporting whether the active take changed.
	SetActiveTake func(ctx context.Context, itemGUID, takeGUID string) (changed bool, err error)
	// CreateTake is create_take: a read's range as a new take on the target item.
	CreateTake func(ctx context.Context, req takereview.CreateTakeRequest) (takereview.CreateTakeResult, error)
	// PickLane is pick_retake_lane: it starts the pick, whose end REAPER reports on its own event.
	PickLane func(lineID, itemGUID string) error
}

// Outcome is what choosing a take did, in the narrator's words.
type Outcome struct {
	Outcome string `json:"outcome"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message"`
	Changed bool   `json:"changed"`
}

const saveNote = " Save the project in REAPER to bring the check up to date."

func refused(reason, message string) Outcome {
	return Outcome{Outcome: OutcomeRefused, Reason: reason, Message: message}
}

// Use carries out choice, one of the candidates Resolve offered, and never anything else: the item, take, line and
// range it acts on are the choice's own, read from the saved project and the findings store (EP7). A take that cannot
// be heard is refused before anything is sent; REAPER's own refusals are worded and never reported as a change.
func Use(ctx context.Context, actors Actors, choice Choice) Outcome {
	candidate := choice.Candidate
	if !candidate.Usable {
		return refused(ReasonUnusable, candidate.Reason)
	}
	if candidate.Active {
		return Outcome{Outcome: OutcomeDone, Message: "That take is already the one playing, so nothing changed."}
	}
	switch candidate.Action {
	case ActionMakeActive:
		return makeActive(ctx, actors, choice.TargetItemGUID, candidate.TakeGUID, "Made that take active in REAPER, in one undo step: Undo in REAPER puts the previous take back.")
	case ActionPickLane:
		if actors.PickLane == nil {
			return refuse(bridge.ErrUnavailable)
		}
		if err := actors.PickLane(choice.LineID, candidate.ItemGUID); err != nil {
			return refuse(err)
		}
		return Outcome{Outcome: OutcomeStarted, Message: "Asking REAPER to play this retake…"}
	case ActionAddAndActivate:
		return addAndActivate(ctx, actors, choice)
	}
	return refused(ReasonFailed, "That take can't be chosen from here.")
}

func makeActive(ctx context.Context, actors Actors, itemGUID, takeGUID, done string) Outcome {
	if actors.SetActiveTake == nil {
		return refuse(bridge.ErrUnavailable)
	}
	changed, err := actors.SetActiveTake(ctx, itemGUID, takeGUID)
	if err != nil {
		return refuse(err)
	}
	if !changed {
		return Outcome{Outcome: OutcomeDone, Message: "That take was already active in REAPER, so nothing changed."}
	}
	return Outcome{Outcome: OutcomeDone, Changed: true, Message: done + saveNote}
}

// addAndActivate is the one two-step choice: the read becomes a new take on the passage's item, then that take is made
// active. If the second step fails the first stands, and the narrator is told so.
func addAndActivate(ctx context.Context, actors Actors, choice Choice) Outcome {
	if actors.CreateTake == nil || actors.SetActiveTake == nil {
		return refuse(bridge.ErrUnavailable)
	}
	created, err := actors.CreateTake(ctx, takereview.CreateTakeRequest{
		FindingID: choice.FindingID, TargetItemGUID: choice.TargetItemGUID, CandidateItemGUID: choice.Candidate.ItemGUID,
		SourceFile: choice.SourceFile, SourceRangeStart: choice.RangeStart, SourceRangeEnd: choice.RangeEnd,
	})
	if err != nil {
		return refuse(err)
	}
	outcome := makeActive(ctx, actors, choice.TargetItemGUID, created.NewTakeGUID, "Added the read as a new take and made it active in REAPER (two undo steps).")
	if outcome.Outcome == OutcomeRefused {
		outcome.Message = "The read was added as a new take on the item, but it is not the active one: " + outcome.Message + " Undo in REAPER removes the added take."
		outcome.Changed = true
	}
	return outcome
}

// refuse words what REAPER (or the DAW port) answered. Nothing in REAPER changed for a refusal.
func refuse(err error) Outcome {
	var stale *bridge.StaleError
	switch {
	case errors.As(err, &stale):
		what := "the item or take"
		switch stale.Reason {
		case "item":
			what = "this take's item"
		case "take":
			what = "this take"
		}
		return refused(ReasonStale, fmt.Sprintf("%s is no longer in the REAPER project, so nothing was changed. Run the check again to find the takes where they are now.", capitalize(what)))
	case errors.Is(err, bridge.ErrRecording):
		return refused(ReasonRecording, "REAPER is recording, so nothing was changed. Stop recording first.")
	case errors.Is(err, bridge.ErrScriptOutdated):
		return refused(ReasonScriptOutdated, "The Narration Utils script in REAPER is older than this app. Import it again from this app's REAPER folder, then try again.")
	case errors.Is(err, bridge.ErrNoAnswer):
		return refused(ReasonNotRunning, "REAPER is not answering. Check that REAPER is open and the Narration Utils action is running, then try again.")
	case errors.Is(err, bridge.ErrUnavailable):
		return refused(ReasonStandalone, "REAPER is not connected to this app. To choose a take, open this app from the Narration Utils action in REAPER.")
	case errors.Is(err, bridge.ErrExperimentalOff):
		return refused(ReasonExperimentalOff, "Choosing a take is an Experimental REAPER action and it is switched off: turn on Experimental REAPER actions in Settings.")
	}
	return refused(ReasonFailed, "REAPER could not do that: "+err.Error()+".")
}

func capitalize(text string) string {
	if text == "" || text[0] < 'a' || text[0] > 'z' {
		return text
	}
	return string(text[0]-'a'+'A') + text[1:]
}
