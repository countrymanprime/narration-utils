package main

import (
	"errors"

	"github.com/countrymanprime/narration-utils/shell/internal/dictionary"
)

// SystemLookup looks one word from the manuscript reader up in the offline dictionary (ADR 0097: the Open English WordNet, read from Go in
// this process; no cloud API and no server). The answer is one of:
//
//   - "ok": the word the lookup used (normalised: lower case, surrounding punctuation removed), one entry per headword and part of speech
//     (none when the dictionary does not have the word), and the dictionary with the attribution its licence requires the UI to show;
//   - "asset_required": the dictionary is not installed (or did not verify), with its sizes, licence and where it would be stored, so the UI
//     offers the standard first-use download. Nothing is downloaded here: only AssetsInstall("dictionary", id), which the narrator confirms,
//     does that.
//
// A selection that is not one word is an error the UI shows as it is. The dictionary is not project-scoped: it is read through the
// set-once asset registry, not the project services (so there is no h.services() snapshot to take).
func (h *Host) SystemLookup(word string) (string, error) { return encodeBinding(h.systemLookup(word)) }

func (h *Host) systemLookup(word string) (map[string]any, error) {
	if _, err := dictionary.Normalize(word); err != nil {
		return nil, err
	}
	registry := h.registry()
	if registry.dictionary == nil {
		return nil, registry.catalogUnavailable("dictionary")
	}
	entry, ok := registry.dictionary.Default()
	if !ok {
		return nil, registry.catalogUnavailable("dictionary")
	}
	result, err := registry.dictionary.Lookup(entry.ID, word)
	if errors.Is(err, dictionary.ErrNotInstalled) {
		return dictionaryAssetRequired(entry, registry.dictionary.State(entry), registry.dictionary.InstallDir(entry.ID)), nil
	}
	if err != nil {
		return nil, err
	}
	return dictionaryFound(entry, result), nil
}

// dictionaryFound is the answer to a lookup the installed dictionary could make. The UI validates it as `DictionaryLookupResult`.
func dictionaryFound(entry dictionary.Dictionary, result dictionary.Result) map[string]any {
	return map[string]any{"status": "ok", "query": result.Query, "entries": result.Entries, "dictionary": dictionaryInfo(entry)}
}

// dictionaryAssetRequired is the answer to a lookup that needs the dictionary downloaded first: what it is, its two sizes (the download, and
// the index it keeps on disk), where it will be stored and its state, the same shape as the other first-use gates (spacyAssetRequired).
func dictionaryAssetRequired(entry dictionary.Dictionary, installState, installPath string) map[string]any {
	return map[string]any{"status": "asset_required", "dictionary": dictionaryInfo(entry), "installState": installState, "downloadSize": entry.DownloadSize(),
		"diskSize": entry.DiskSize(), "installPath": installPath}
}

func dictionaryInfo(entry dictionary.Dictionary) map[string]any {
	return map[string]any{"id": entry.ID, "provider": entry.Provider, "displayName": entry.DisplayName, "description": entry.Description, "version": entry.Version,
		"publisher": entry.Publisher, "license": entry.License, "licenseUrl": entry.LicenseURL, "modelCardUrl": entry.ModelCardURL, "provenanceUrl": entry.ProvenanceURL,
		"attribution": entry.Attribution}
}
