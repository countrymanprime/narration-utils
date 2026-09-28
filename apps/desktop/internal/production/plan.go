package production

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// This file is Phase 3 of the production tracking PRD (delivered and deleted; ADR 0028): the book's
// deadline, contracted amount and milestones (Q3 A, Q5 A), kept on the
// project manifest so they survive a manuscript replace, and checked here
// before they are saved. Dates are calendar dates, "YYYY-MM-DD" (ADR 0323).

const (
	dateLayout = "2006-01-02"
	// maxMilestones, maxMilestoneName and maxMilestoneNote bound what one save
	// can put on the manifest.
	maxMilestones    = 100
	maxMilestoneName = 200
	maxMilestoneNote = 2000
)

// Plan is the book's deadline, contracted amount and milestones as the
// bindings answer them. Deadline and ContractedAmount are nil when unset;
// Milestones is never nil.
type Plan struct {
	Deadline         *string             `json:"deadline"`
	ContractedAmount *float64            `json:"contractedAmount"`
	Milestones       []project.Milestone `json:"milestones"`
}

// PlanOf reads manifest's plan fields into a Plan that shares nothing with
// it. A nil manifest (a project that has none yet) is an empty plan.
func PlanOf(manifest *project.Manifest) Plan {
	plan := Plan{Milestones: []project.Milestone{}}
	if manifest == nil {
		return plan
	}
	if manifest.Deadline != "" {
		deadline := manifest.Deadline
		plan.Deadline = &deadline
	}
	if manifest.ContractedAmount != nil {
		amount := *manifest.ContractedAmount
		plan.ContractedAmount = &amount
	}
	plan.Milestones = append(plan.Milestones, manifest.Milestones...)
	return plan
}

// CheckDate returns value, trimmed, when it is a real calendar date written
// "YYYY-MM-DD", and an error otherwise.
func CheckDate(value string) (string, error) {
	value = strings.TrimSpace(value)
	if _, err := time.Parse(dateLayout, value); err != nil {
		return "", fmt.Errorf("%q is not a date written YYYY-MM-DD", value)
	}
	return value, nil
}

// CheckAmount accepts no amount (nil clears it) or a finite, non-negative
// number. The amount is the narrator's own currency; nothing converts it.
func CheckAmount(amount *float64) error {
	if amount != nil && !measured(*amount) {
		return errors.New("the contracted amount must be a number of zero or more")
	}
	return nil
}

// CleanMilestones trims every milestone's fields and refuses the list when
// any milestone has no name, has no real date, or is too long, or when there
// are too many. Their order is the narrator's own. Nothing else about a
// milestone is validated (Q5 A): the ACX 15-minute checkpoint is a name like
// any other.
func CleanMilestones(milestones []project.Milestone) ([]project.Milestone, error) {
	if len(milestones) > maxMilestones {
		return nil, fmt.Errorf("a book can have at most %d milestones", maxMilestones)
	}
	out := make([]project.Milestone, 0, len(milestones))
	for index, milestone := range milestones {
		name := strings.TrimSpace(milestone.Name)
		note := strings.TrimSpace(milestone.Note)
		switch {
		case name == "":
			return nil, fmt.Errorf("milestone %d needs a name", index+1)
		case utf8.RuneCountInString(name) > maxMilestoneName:
			return nil, fmt.Errorf("milestone %d's name is longer than %d characters", index+1, maxMilestoneName)
		case utf8.RuneCountInString(note) > maxMilestoneNote:
			return nil, fmt.Errorf("milestone %d's note is longer than %d characters", index+1, maxMilestoneNote)
		}
		due, err := CheckDate(milestone.DueDate)
		if err != nil {
			return nil, fmt.Errorf("milestone %d (%s): %w", index+1, name, err)
		}
		out = append(out, project.Milestone{Name: name, DueDate: due, Note: note})
	}
	return out, nil
}
