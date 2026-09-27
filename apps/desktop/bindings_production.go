package main

import (
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/production"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// Production plan bindings (production-tracking.prd.md Phase 3, Q3 A, Q5 A): the book's deadline, contracted amount
// and milestones, stored on the project manifest beside Credits so they survive Replace manuscript and Clear derived
// data. Each answers the whole plan (production.Plan), so the page never merges a partial answer into what it holds.

// ProductionPlan reads this project's deadline, contracted amount and milestones. A project that has set none answers
// an empty plan: no deadline, no amount, no milestones.
func (h *Host) ProductionPlan() (string, error) {
	projectFolder := h.services().config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before reading its deadline and milestones")
	}
	manifest, _, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	return encodeBinding(production.PlanOf(manifest), nil)
}

// ProductionSetDeadline sets the book's delivery date ("YYYY-MM-DD"; empty clears it) and contracted amount (a number
// of zero or more in the narrator's own currency; nil clears it). An invalid date or amount is refused and nothing is
// written.
func (h *Host) ProductionSetDeadline(deadline string, contractedAmount *float64) (string, error) {
	if deadline != "" {
		checked, err := production.CheckDate(deadline)
		if err != nil {
			return "", fmt.Errorf("the deadline: %w", err)
		}
		deadline = checked
	}
	if err := production.CheckAmount(contractedAmount); err != nil {
		return "", err
	}
	return h.saveProductionPlan("the deadline", func(manifest *project.Manifest) {
		manifest.Deadline = deadline
		manifest.ContractedAmount = nil
		if contractedAmount != nil {
			amount := *contractedAmount
			manifest.ContractedAmount = &amount
		}
	})
}

// ProductionSaveMilestones replaces the book's milestones with milestones, in the narrator's order. Each needs a name
// and a real date ("YYYY-MM-DD"); a note is optional. A list with any invalid milestone is refused whole and nothing
// is written.
func (h *Host) ProductionSaveMilestones(milestones []project.Milestone) (string, error) {
	cleaned, err := production.CleanMilestones(milestones)
	if err != nil {
		return "", err
	}
	return h.saveProductionPlan("the milestones", func(manifest *project.Manifest) {
		manifest.Milestones = cleaned
		if len(cleaned) == 0 {
			manifest.Milestones = nil
		}
	})
}

// saveProductionPlan loads the manifest (a fresh one for a project that has none yet), applies change, saves it and
// answers the whole plan.
func (h *Host) saveProductionPlan(what string, change func(*project.Manifest)) (string, error) {
	svc := h.services()
	projectFolder := svc.config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before setting %s", what)
	}
	manifest, ok, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil {
		manifest = project.New(svc.config.projectName, time.Now())
	}
	change(manifest)
	if err := manifest.Save(projectFolder); err != nil {
		return "", fmt.Errorf("could not save %s: %w", what, err)
	}
	return encodeBinding(production.PlanOf(manifest), nil)
}
