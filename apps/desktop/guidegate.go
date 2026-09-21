package main

import (
	"fmt"
	"regexp"

	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
)

// plainModelName is what a spaCy package name looks like: letters, digits, underscores, dots and dashes, and not starting with a dash.
var plainModelName = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*$`)

// spacyForBuild decides what the Story Bible build gives the sidecar as its language model, or stops at the first-use gate:
//
//   - rulesOnly (the narrator chose to build without a model this once): the rules-only extraction, nothing to download;
//   - the selected model is installed: the folder it was unpacked to, which `spacy.load` reads by path;
//   - the selected model is one the app manages and is not installed: no model and a gate answer, so nothing starts until the narrator
//     chooses Download, rules-only for this run, or Cancel (there is no silent fallback to a lower-quality extraction);
//   - a name the app does not manage (a developer's own install): passed on as it is.
func (h *Host) spacyForBuild(store *settings.Store, rulesOnly bool) (model string, gate map[string]any, err error) {
	if rulesOnly {
		return guide.RulesOnly, nil, nil
	}
	name, _ := store.Effective("ManuscriptGuide", "spacy_model", "en_core_web_sm")
	registry := h.registry()
	if registry.spacy == nil {
		return "", nil, registry.catalogUnavailable("language model")
	}
	approved, known := registry.spacy.Model(name)
	if !known {
		if !plainModelName.MatchString(name) || name == guide.RulesOnly {
			// The setting is a file the narrator or a project can edit, so it is not trusted as a path or as the rules-only choice: only a
			// plain package name (a developer's own install) is passed on. A folder, a network path or an option is refused.
			return "", nil, fmt.Errorf("%q is not a language model the app can use: choose one of the approved models in Settings", name)
		}
		return name, nil, nil
	}
	dir, dirErr := registry.spacy.ModelDir(name)
	if dirErr != nil {
		return "", spacyAssetRequired(approved, registry.spacy.State(approved), registry.spacy.InstallDir(name)), nil
	}
	return dir, nil, nil
}

// spacyAssetRequired is the answer to a Story Bible build that needs a language model that is not installed yet: what it is, its two sizes
// (the download, and the disk it takes once unpacked), where it will be stored, and its state, so the UI can offer the three choices. The UI
// validates it as `GuideBuildResult` (ADR 0069).
func spacyAssetRequired(model spacy.Model, installState, installPath string) map[string]any {
	return map[string]any{"status": "asset_required", "model": map[string]any{"id": model.ID, "provider": model.Provider, "displayName": model.DisplayName, "description": model.Description,
		"version": model.Version, "publisher": model.Publisher, "license": model.License, "licenseUrl": model.LicenseURL, "modelCardUrl": model.ModelCardURL,
		"provenanceUrl": model.ProvenanceURL, "attribution": model.Attribution}, "installState": installState, "downloadSize": model.DownloadSize(), "diskSize": model.DiskSize(), "installPath": installPath}
}
