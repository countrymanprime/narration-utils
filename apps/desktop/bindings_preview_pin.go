package main

import (
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/preview"
)

// The proofing-preview-suggestion PRD's Phase 8: letting the narrator settle on one suggested window and keep it
// (Q9 recommendation B, "a pin per book"), and move its edges by paragraph (User Flow step 5). Like Phase 2's
// PreviewCandidates, every binding here recomputes the pin's evidence fresh from the manuscript's current state on
// every call (SR D1): only the pin itself - which chapter, which paragraphs, and the text they read when pinned or
// last adjusted - is stored (preview.PinStore), never a verdict.

// pinnedPreviewView is the wire shape for the narrator's pinned window: always present (never null), with
// `present` naming whether one exists at all - the same named-state convention PreviewResult's own `outcome`
// already uses, rather than a nullable payload the UI has to null-check everywhere. `candidate` is omitted only
// when the pin's chapter or every one of its paragraphs no longer exists (staleReason "paragraph_missing"): there
// is nothing left to recompute evidence for, but the pin itself is still `present` so the panel can offer to clear
// it.
type pinnedPreviewView struct {
	Present        bool                  `json:"present"`
	Candidate      *previewCandidateView `json:"candidate,omitempty"`
	Stale          bool                  `json:"stale"`
	StaleReason    string                `json:"staleReason,omitempty"`
	PinnedAt       string                `json:"pinnedAt,omitempty"`
	CanExtendStart bool                  `json:"canExtendStart"`
	CanShrinkStart bool                  `json:"canShrinkStart"`
	CanExtendEnd   bool                  `json:"canExtendEnd"`
	CanShrinkEnd   bool                  `json:"canShrinkEnd"`
}

var noPin = pinnedPreviewView{}

// PreviewPin reads the narrator's pinned window, if any, resolved against the manuscript's current text.
func (h *Host) PreviewPin() (string, error) {
	svc := h.services()
	return encodeBinding(h.resolvePin(svc), nil)
}

// PreviewPinSet pins one window: chapterID and paragraphIDs are normally a candidate's own fields, exactly as
// PreviewCandidates answered them, though any contiguous, in-order run of one chapter's paragraph ids is accepted
// (Phase 8 does not require the narrator to have started from a suggested candidate at all).
func (h *Host) PreviewPinSet(chapterID string, paragraphIDs []string) (string, error) {
	svc := h.services()
	if svc.manuscript == nil {
		return encodeBinding(noPin, fmt.Errorf("save the REAPER project and import a manuscript first"))
	}
	if len(paragraphIDs) == 0 {
		return encodeBinding(noPin, fmt.Errorf("a pin needs at least one paragraph"))
	}
	paragraphs := previewParagraphsForChapter(svc.manuscript, chapterID)
	anchor, ok := previewAnchorText(paragraphs, paragraphIDs)
	if !ok {
		return encodeBinding(noPin, fmt.Errorf("one or more of those paragraphs are not in that chapter"))
	}
	pin := preview.PinnedRange{ChapterID: chapterID, ParagraphIDs: paragraphIDs, AnchorText: anchor, PinnedAt: time.Now()}
	if err := h.previewPinStore(svc).Write(pin); err != nil {
		return "", err
	}
	return encodeBinding(h.resolvePin(svc), nil)
}

// PreviewPinAdjust grows or shrinks the pinned range by one paragraph at edge ("start" or "end"); grow false
// shrinks it instead. It is a no-op, not an error, once the range already reaches the chapter's edge or (shrinking)
// is down to one paragraph (preview.AdjustRange's own rule).
func (h *Host) PreviewPinAdjust(edge string, grow bool) (string, error) {
	svc := h.services()
	if svc.manuscript == nil {
		return encodeBinding(noPin, fmt.Errorf("save the REAPER project and import a manuscript first"))
	}
	store := h.previewPinStore(svc)
	pin, ok := store.Read()
	if !ok {
		return encodeBinding(noPin, fmt.Errorf("no preview is pinned"))
	}
	paragraphs := previewParagraphsForChapter(svc.manuscript, pin.ChapterID)
	newIDs, adjusted := preview.AdjustRange(paragraphs, pin.ChapterID, pin.ParagraphIDs, preview.Edge(edge), grow)
	if !adjusted {
		return encodeBinding(h.resolvePin(svc), fmt.Errorf("this pin can no longer be adjusted; clear it and pin a new one"))
	}
	anchor, _ := previewAnchorText(paragraphs, newIDs)
	pin.ParagraphIDs = newIDs
	pin.AnchorText = anchor
	pin.PinnedAt = time.Now()
	if err := store.Write(pin); err != nil {
		return "", err
	}
	return encodeBinding(h.resolvePin(svc), nil)
}

// PreviewPinClear removes the pin. Clearing when nothing is pinned is not an error.
func (h *Host) PreviewPinClear() (string, error) {
	svc := h.services()
	if svc.manuscript != nil {
		if err := h.previewPinStore(svc).Clear(); err != nil {
			return "", err
		}
	}
	return encodeBinding(noPin, nil)
}

// previewPinStore builds the pin store over one services() snapshot: it keeps no state of its own, so a project
// switch in the middle of a call never mixes two projects (bindings_prepmarkup.go's own prepMarkup convention).
func (h *Host) previewPinStore(svc hostServices) *preview.PinStore {
	store := preview.NewPinStore(svc.config.projectFolder)
	store.Reporter = h.persist
	return store
}

// resolvePin reads the stored pin, if any, and resolves it against the manuscript's current chapters and
// paragraphs: staleness (preview.CheckStale), a recomputed candidate when the chapter and its paragraphs still
// exist, and which edge adjustments remain available.
func (h *Host) resolvePin(svc hostServices) pinnedPreviewView {
	if svc.manuscript == nil {
		return noPin
	}
	pin, ok := h.previewPinStore(svc).Read()
	if !ok {
		return noPin
	}
	view := pinnedPreviewView{Present: true, PinnedAt: pin.PinnedAt.UTC().Format(time.RFC3339)}

	chapter, found := previewChapterByID(svc.manuscript, pin.ChapterID)
	paragraphs := previewParagraphsForChapter(svc.manuscript, pin.ChapterID)
	currentText := make(map[string]string, len(paragraphs))
	for _, p := range paragraphs {
		currentText[p.ID] = p.Text
	}
	if !found {
		view.Stale = true
		view.StaleReason = string(preview.StaleParagraphMissing)
		return view
	}
	if reason := preview.CheckStale(pin, currentText); reason != preview.StaleNone {
		view.Stale = true
		view.StaleReason = string(reason)
	}

	candidate, evaluated := preview.EvaluateRange(chapter, paragraphs, pin.ParagraphIDs, nil, previewOpenFindings(svc.findings), previewSettings(svc.settings), previewAudioEvidence(svc, []preview.Chapter{chapter}, svc.manuscript)[chapter.ID])
	if !evaluated {
		// Every paragraph id is individually missing (not merely re-worded), the same condition CheckStale would
		// already have called StaleParagraphMissing - reached here only if the manuscript changed between the two
		// reads above, an unlikely race this still answers honestly rather than with a zero-value candidate.
		view.Stale = true
		view.StaleReason = string(preview.StaleParagraphMissing)
		return view
	}
	rendered := previewView(preview.Result{Outcome: preview.OutcomeOK, Candidates: []preview.Candidate{candidate}}).Candidates[0]
	view.Candidate = &rendered

	view.CanExtendStart = previewCanAdjust(paragraphs, pin, preview.EdgeStart, true)
	view.CanShrinkStart = previewCanAdjust(paragraphs, pin, preview.EdgeStart, false)
	view.CanExtendEnd = previewCanAdjust(paragraphs, pin, preview.EdgeEnd, true)
	view.CanShrinkEnd = previewCanAdjust(paragraphs, pin, preview.EdgeEnd, false)
	return view
}

// previewCanAdjust reports whether adjusting pin's range at edge (grow or shrink) would actually change it: false
// both when AdjustRange refuses (an unresolvable range) and when it succeeds but the range is already at that
// edge's limit (its own documented no-op).
func previewCanAdjust(paragraphs []preview.Paragraph, pin preview.PinnedRange, edge preview.Edge, grow bool) bool {
	ids, ok := preview.AdjustRange(paragraphs, pin.ChapterID, pin.ParagraphIDs, edge, grow)
	return ok && !equalPreviewIDs(ids, pin.ParagraphIDs)
}

func equalPreviewIDs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// previewChapterByID reads chapterID's chapter fields from the manuscript's own reader payloads (previewInput's
// own loop, narrowed to one chapter for the pin bindings, which never need the whole book).
func previewChapterByID(service *manuscript.Service, chapterID string) (preview.Chapter, bool) {
	payloads, err := service.Chapters()
	if err != nil {
		return preview.Chapter{}, false
	}
	for _, payload := range payloads {
		if previewString(payload, "id") != chapterID {
			continue
		}
		order, _ := previewOrder(payload["index"])
		return preview.Chapter{
			ID:          chapterID,
			Title:       previewString(payload, "title"),
			ContentKind: preview.ContentKind(previewString(payload, "contentKind")),
			Order:       order,
		}, true
	}
	return preview.Chapter{}, false
}

// previewParagraphsForChapter reads chapterID's current paragraphs in order, the same reader Paragraphs() already
// gives previewInput and previewParagraphIDsForChapter (bindings_preview.go) - this one keeps each paragraph's
// text too, which the pin bindings need for anchoring and recomputation and the id-only reader does not carry.
func previewParagraphsForChapter(service *manuscript.Service, chapterID string) []preview.Paragraph {
	payloads, err := service.Paragraphs(chapterID)
	if err != nil {
		return nil
	}
	paragraphs := make([]preview.Paragraph, 0, len(payloads))
	for index, payload := range payloads {
		paragraphs = append(paragraphs, preview.Paragraph{
			ID:        previewString(payload, "id"),
			ChapterID: chapterID,
			Index:     index,
			Text:      previewString(payload, "text"),
			EntityIDs: previewEntityIDs(payload),
		})
	}
	return paragraphs
}

// previewAnchorText builds a pin's AnchorText map from paragraphs' current text for exactly the given ids, in
// order. ok is false when any id does not resolve to one of paragraphs.
func previewAnchorText(paragraphs []preview.Paragraph, ids []string) (map[string]string, bool) {
	byID := make(map[string]string, len(paragraphs))
	for _, p := range paragraphs {
		byID[p.ID] = p.Text
	}
	anchor := make(map[string]string, len(ids))
	for _, id := range ids {
		text, ok := byID[id]
		if !ok {
			return nil, false
		}
		anchor[id] = text
	}
	return anchor, true
}
