package main

import (
	"errors"
	"fmt"
	"runtime"

	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// The mastering chain a project masters with (ADR 0306, owner decision D86): a row of masteringport.Rows, chosen per project.
// The choice is the project settings row Mastering.provider, written only by MasteringChooseProvider, which checks it against
// the registry; it is not a generic Settings field, so the Settings page neither lists nor saves it, and no global or repo
// default exists: a project with no choice masters with the registry's default row (builtin). Master & QC (stage navigation
// Phase 8) reads it to draw the chain. The wire schema, golden payloads, wireContracts row and mock live in apps/ui/src/api.
const (
	masteringSettingsTool = "Mastering"
	masteringProviderKey  = "provider"
)

// MasteringProvidersState is what MasteringProviders answers: every mastering row with what it needs and whether it can be chosen
// now, the project's own choice (nil when it has none, and always without a project), the row it masters with, and a notice when
// its choice could not be used.
type MasteringProvidersState struct {
	HasProject bool                `json:"hasProject"`
	Choice     *string             `json:"choice"`
	Effective  string              `json:"effective"`
	Providers  []MasteringProvider `json:"providers"`
	Notice     string              `json:"notice,omitempty"`
}

// MasteringProvider is one row of masteringport.Rows on the wire. Support is the DAW port's Support shape (supportPayload).
type MasteringProvider struct {
	Name          string         `json:"name"`
	Label         string         `json:"label"`
	Default       bool           `json:"default"`
	Modes         []string       `json:"modes"`
	NeedsApproval bool           `json:"needsApproval"`
	Needs         []string       `json:"needs"`
	Support       map[string]any `json:"support"`
	// Chain is the row's own fixed chain, for Master & QC to draw before anything is mastered; empty when the chain is not the
	// app's (the DAW row).
	Chain []MasteringStep `json:"chain"`
}

// MasteringStep is one step of a row's declared chain (masteringport.Step) on the wire.
type MasteringStep struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
}

// MasteringProviders answers the mastering rows and the current project's choice. It changes nothing.
func (h *Host) MasteringProviders() (string, error) {
	return encodeBinding(h.masteringProvidersState(), nil)
}

// MasteringChooseProvider saves the current project's mastering row and answers the rows again. An empty name clears the choice,
// so the project masters with the default row. A row that is not registered, or not available on this computer yet, is refused
// with its sentence, and nothing is saved.
func (h *Host) MasteringChooseProvider(name string) (string, error) {
	return encodeBinding(h.chooseMasteringProvider(name))
}

func (h *Host) masteringProvidersState() MasteringProvidersState {
	svc := h.services()
	hasProject := svc.config.projectFolder != "" && svc.settings != nil
	choice := ""
	if hasProject {
		choice = svc.settings.Project(masteringSettingsTool)[masteringProviderKey]
	}
	return masteringProvidersPayload(masteringport.Rows, runtime.GOOS, hasProject, choice)
}

// masteringProvidersPayload is MasteringProviders' answer over rows on platform, for a project (hasProject) whose stored choice is
// choice ("" for none).
func masteringProvidersPayload(rows *port.Registry[masteringport.Mastering], platform string, hasProject bool, choice string) MasteringProvidersState {
	state := MasteringProvidersState{HasProject: hasProject, Providers: []MasteringProvider{}}
	fallback, ok := masteringport.Default(rows)
	if ok {
		state.Effective = fallback.Name
	}
	for _, entry := range rows.Entries() {
		caps := entry.New().Capabilities()
		needs := make([]string, 0, len(caps.Needs))
		for _, c := range caps.Needs {
			needs = append(needs, string(c))
		}
		chain := make([]MasteringStep, 0, len(caps.Chain))
		for _, step := range caps.Chain {
			chain = append(chain, MasteringStep{Name: step.Name, Detail: step.Detail})
		}
		state.Providers = append(state.Providers, MasteringProvider{
			Name: entry.Name, Label: entry.Descriptor.Label, Default: entry.Name == fallback.Name, Modes: nonNil(entry.Descriptor.Modes),
			NeedsApproval: caps.NeedsApproval, Needs: needs, Support: supportPayload(masteringport.Support(entry, platform)), Chain: chain,
		})
	}
	if choice == "" {
		return state
	}
	state.Choice = &choice
	entry, err := rows.Lookup(choice)
	if err != nil {
		state.Notice = fmt.Sprintf("This project chose a mastering chain this version does not have (%q). It masters with the default, %s.",
			choice, fallback.Descriptor.Label)
		return state
	}
	if support := masteringport.Support(entry, platform); !support.Available {
		state.Notice = fmt.Sprintf("%s This project masters with the default, %s, until then.", support.Message, fallback.Descriptor.Label)
		return state
	}
	state.Effective = entry.Name
	return state
}

func (h *Host) chooseMasteringProvider(name string) (MasteringProvidersState, error) {
	svc := h.services()
	if svc.config.projectFolder == "" || svc.settings == nil {
		return MasteringProvidersState{}, errors.New("open a project before choosing how it is mastered")
	}
	var value *string
	if name != "" {
		entry, err := masteringport.Rows.Lookup(name)
		if err != nil {
			return MasteringProvidersState{}, err
		}
		if support := masteringport.Support(entry, runtime.GOOS); !support.Available {
			return MasteringProvidersState{}, &port.NotSupportedError{Capability: name, Support: support}
		}
		value = &name
	}
	if err := svc.settings.Save(masteringSettingsTool, "project", map[string]*string{masteringProviderKey: value}); err != nil {
		return MasteringProvidersState{}, err
	}
	return h.masteringProvidersState(), nil
}
