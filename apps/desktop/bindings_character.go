package main

// character-continuity-review.prd.md Phase 6, non-acoustic part only: region
// listing and reference approvals over internal/character (Phase 3), and
// dialogue-cue reading and correction over internal/guide (Phase 2). Owner
// decision D87 on #509 benches every acoustic-drift-finding binding (the
// Phase 5 engine's wiring, findings, the Review character filter, audition):
// internal/continuity stays unwired here.

// CharacterRegionWire is one project region as CharacterListRegions sends
// it: tracks.Region has no JSON tags of its own (internal/tracks predates
// any binding directly on it), so this binding shapes the wire form instead
// of exporting Go's own field names.
type CharacterRegionWire struct {
	Index int     `json:"index"`
	Name  string  `json:"name"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	GUID  string  `json:"guid"`
}

// CharacterListRegions lists the saved REAPER project's regions, for the
// narrator to pick one to approve as a voice reference.
func (h *Host) CharacterListRegions() (string, error) {
	svc := h.services().character
	if svc == nil {
		return "", errNoProject
	}
	regions, err := svc.ListRegions()
	if err != nil {
		return "", err
	}
	wire := make([]CharacterRegionWire, 0, len(regions))
	for _, region := range regions {
		wire = append(wire, CharacterRegionWire{Index: region.Index, Name: region.Name, Start: region.Start, End: region.End, GUID: region.GUID})
	}
	return encodeBinding(wire, nil)
}

// CharacterApprove approves regionGUID as a voice reference for characterID
// (a Story Bible entity id, or the reserved Narration id), with an optional
// note. Approving the same character and region again refreshes the
// snapshot in place.
func (h *Host) CharacterApprove(characterID, regionGUID, note string) (string, error) {
	svc := h.services().character
	if svc == nil {
		return "", errNoProject
	}
	return encodeBinding(svc.Approve(characterID, regionGUID, note))
}

// CharacterRevoke removes one stored reference by id. Revoking an id that is
// not (or no longer) stored is not an error.
func (h *Host) CharacterRevoke(id string) (string, error) {
	svc := h.services().character
	if svc == nil {
		return "", errNoProject
	}
	return encodeBinding(nil, svc.Revoke(id))
}

// CharacterReferences lists every stored reference, each annotated with
// whether the region it names has changed since it was approved.
func (h *Host) CharacterReferences() (string, error) {
	svc := h.services().character
	if svc == nil {
		return "", errNoProject
	}
	return encodeBinding(svc.References())
}

// CharacterRemoveVoiceData revokes every reference for the project in one
// action (Q7's "Remove voice analysis data", delivered in Phase 6 rather
// than Phase 7 per D87): the data-layer effect is the same as revoking each
// reference one at a time.
func (h *Host) CharacterRemoveVoiceData() (string, error) {
	svc := h.services().character
	if svc == nil {
		return "", errNoProject
	}
	return encodeBinding(nil, svc.RemoveAll())
}

// GuideDialogueCues returns the Story Bible's extracted dialogue cues
// (character-continuity-review.prd.md Phase 2): one entry per quoted span,
// with its resolved or unknown speaker.
func (h *Host) GuideDialogueCues() (string, error) {
	svc := h.services().guide
	if svc == nil {
		return "", errNoProject
	}
	return encodeBinding(svc.DialogueCues())
}

// GuideCorrectCue records the narrator's own attribution for one dialogue
// cue. speakerEntityID "unknown" or "" clears the cue back to unknown; a
// rebuild never overwrites a correction (mirroring ADR 0007's lock guard).
func (h *Host) GuideCorrectCue(cueID, speakerEntityID string) (string, error) {
	svc := h.services().guide
	if svc == nil {
		return "", errNoProject
	}
	return encodeBinding(nil, svc.CorrectCue(cueID, speakerEntityID))
}
