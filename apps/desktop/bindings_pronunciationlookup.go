package main

import "github.com/countrymanprime/narration-utils/shell/internal/pronunciationlookup"

// PronunciationLookupOpen opens source's fixed lookup-page template for word in the narrator's default browser
// (prep-depth.prd.md Phase 2; provider-ports.prd.md Open Question Q5's BrowserLookup role), and nothing else: it
// never fetches, scrapes or caches the site itself. source and word cross the Wails boundary, never a URL - the
// destination is always built server-side by pronunciationlookup.URL from one of four hardcoded templates, so
// nothing UI-supplied can pick an arbitrary destination (mirrors DawCatalogOpenDownloadPage's same trusted-URL
// discipline, for the same reason).
func (h *Host) PronunciationLookupOpen(source, word string) (string, error) {
	address, err := pronunciationlookup.URL(pronunciationlookup.Source(source), word)
	if err != nil {
		return "", err
	}
	h.mu.RLock()
	ctx, open := h.ctx, h.openURL
	h.mu.RUnlock()
	if open != nil {
		open(ctx, address)
		return encodeBinding(nil, nil)
	}
	if ctx == nil {
		return "", errHostNotReady
	}
	if err := openInBrowser(address); err != nil {
		return "", err
	}
	return encodeBinding(nil, nil)
}
