package main

import (
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credits"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// Credits bindings (PRD audiobook-credits-templates.prd.md, Phase 1): the
// user-level template library (h.creditTemplates, set once in NewHost, never
// swapped by a project switch, like h.recents), the current project's own
// token values (project.Manifest.Credits, read/written the same way
// dawlink.go reads/writes DawProjectFile), the global narrator default
// (General.narrator_name), suggestions from the imported manuscript, and one
// shared preview render so every surface renders the same way (credits.Render).

// CreditsTemplates lists the narrator's credit template library, seeding the
// shipped defaults on first use.
func (h *Host) CreditsTemplates() (string, error) {
	return encodeBinding(h.creditTemplates.List())
}

// CreditsSaveTemplate creates a template (id empty) or updates one in place
// (id set). kind is "opening", "closing" or "chapter_announcement" (C8).
func (h *Host) CreditsSaveTemplate(id, kind, name, body string) (string, error) {
	if kind != "opening" && kind != "closing" && kind != "chapter_announcement" {
		return "", fmt.Errorf("unsupported credit template kind %q", kind)
	}
	return encodeBinding(h.creditTemplates.Save(credits.Template{ID: id, Kind: kind, Name: name, Body: body}))
}

// CreditsDuplicateTemplate copies an existing template (including a shipped
// default) as a new, editable entry.
func (h *Host) CreditsDuplicateTemplate(id string) (string, error) {
	return encodeBinding(h.creditTemplates.Duplicate(id))
}

// CreditsDeleteTemplate removes a template from the library. The narrator
// owns this library, so a shipped default may be deleted like any other.
func (h *Host) CreditsDeleteTemplate(id string) (string, error) {
	return encodeBinding(nil, h.creditTemplates.Delete(id))
}

// CreditsProjectValues returns the current project's own credit token
// values, the global narrator default, and suggestions seeded from the
// imported manuscript's cover lines and docProps (C3) for any field the
// project has not set yet. It never writes anything: suggestions are for the
// narrator to accept or ignore.
func (h *Host) CreditsProjectValues() (string, error) {
	svc := h.services()
	projectFolder := svc.config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before editing its credits values")
	}
	manifest, ok, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	var values credits.Values
	if ok && manifest != nil && manifest.Credits != nil {
		values = *manifest.Credits
	}
	narratorGlobal, _ := svc.settings.Effective("General", "narrator_name", "")
	return encodeBinding(map[string]any{
		"values":         values,
		"narratorGlobal": narratorGlobal,
		"suggestions":    credits.SuggestFromManuscript(projectFolder),
	}, nil)
}

// CreditsSaveProjectValues saves this project's own credit token values onto
// the project manifest (C12: the manifest directly, now that it exists).
func (h *Host) CreditsSaveProjectValues(title, subtitle, author, series, bookNumber, copyrightText, year, copyrightHolder, publisher, narrator string) (string, error) {
	svc := h.services()
	projectFolder := svc.config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before saving its credits values")
	}
	manifest, ok, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil {
		manifest = project.New(svc.config.projectName, time.Now())
	}
	manifest.Credits = &credits.Values{
		Title: title, Subtitle: subtitle, Author: author, Series: series, BookNumber: bookNumber,
		Copyright: copyrightText, Year: year, CopyrightHolder: copyrightHolder, Publisher: publisher, Narrator: narrator,
	}
	if err := manifest.Save(projectFolder); err != nil {
		return "", fmt.Errorf("could not save the project's credits values: %w", err)
	}
	return encodeBinding(manifest.Credits, nil)
}

// CreditsPreview renders text (a template body, or an unsaved draft the
// narrator is still editing) with this project's own credit values, falling
// back to the global narrator default for [Narrator] (C2), exactly as the
// estimate and the teleprompter will render it in later phases (one
// renderer, PRD "Technical Approach").
func (h *Host) CreditsPreview(body string) (string, error) {
	svc := h.services()
	projectFolder := svc.config.projectFolder
	var values credits.Values
	if projectFolder != "" {
		if manifest, ok, err := project.Load(h.persist, projectFolder); err == nil && ok && manifest != nil && manifest.Credits != nil {
			values = *manifest.Credits
		}
	}
	narratorGlobal, _ := svc.settings.Effective("General", "narrator_name", "")
	return encodeBinding(credits.Render(body, values.Resolve(narratorGlobal)), nil)
}
