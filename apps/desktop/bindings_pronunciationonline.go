package main

import (
	"context"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline/merriamwebster"
)

// The online pronunciation lookup (prep-depth.prd.md Phase 9; ADR 0405 point 2, ADR 0350): Merriam-Webster, on the
// narrator's own key, one word at a time, cached. This file is the composition root's only mention of the adapter
// (pronunciationonlineguard_test.go); every binding below talks to the port's Service.
//
// None of these bindings logs, and none of their errors carries the key or the word (the Service's errors are fixed
// sentences). The key crosses the Wails boundary exactly once, inward, in PronunciationOnlineKeySet; nothing sends it
// back out: the status binding says only whether one is saved.

// newPronunciationOnline is the lookup the app runs: the Merriam-Webster adapter, the key in the per-user credentials file
// and the answers in the per-user cache, both beside the recents list and outside the logs folder, so neither is in a
// diagnostics export.
func newPronunciationOnline() *pronunciationonline.Service {
	dir := filepath.Dir(recentProjectsPath())
	return pronunciationonline.NewService(merriamwebster.New(), filepath.Join(dir, "credentials.json"), filepath.Join(dir, "pronunciation", "merriam-webster-cache.json"))
}

// PronunciationOnlineKeyStatus says whether the narrator has saved their Merriam-Webster key, and whether it is sealed at
// rest on this platform. Never the key.
func (h *Host) PronunciationOnlineKeyStatus() (string, error) {
	return encodeBinding(h.pronunciationOnline.KeyStatus())
}

// PronunciationOnlineKeySet saves the narrator's pasted key (Q10). An error never quotes what was pasted.
func (h *Host) PronunciationOnlineKeySet(key string) (string, error) {
	return encodeBinding(h.pronunciationOnline.SetKey(key))
}

// PronunciationOnlineKeyClear removes the saved key; cached answers stay.
func (h *Host) PronunciationOnlineKeyClear() (string, error) {
	return encodeBinding(h.pronunciationOnline.ClearKey())
}

// PronunciationOnlineSignUpOpen opens the dictionary's free-key sign-up page in the narrator's browser: a fixed constant of
// the adapter's, never an address the UI supplies (the same trusted-URL discipline as PronunciationLookupOpen).
func (h *Host) PronunciationOnlineSignUpOpen() (string, error) {
	return h.openTrustedURL(h.pronunciationOnline.SignUpURL())
}

// PronunciationOnlineLookup looks one word up for the narrator, who pressed Look up for it (D72: narrator-initiated): from
// the local cache when it was looked up before, otherwise from Merriam-Webster on the narrator's key.
func (h *Host) PronunciationOnlineLookup(word string) (string, error) {
	return encodeBinding(h.pronunciationOnline.Lookup(h.lookupContext(), word))
}

// PronunciationOnlineLookupBatch looks every word in words up once (Q11: opt-in with a notice). confirmedCount is the word
// count the narrator confirmed in the notice; the Service refuses the batch unless it is exactly the number of distinct
// words it would send.
func (h *Host) PronunciationOnlineLookupBatch(words []string, confirmedCount int) (string, error) {
	return encodeBinding(h.pronunciationOnline.LookupBatch(h.lookupContext(), words, confirmedCount))
}

// lookupContext is the app's context once Startup has run, so quitting cancels a lookup in flight.
func (h *Host) lookupContext() context.Context {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

// openTrustedURL opens address, a constant of the host's own, in the narrator's default browser.
func (h *Host) openTrustedURL(address string) (string, error) {
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
