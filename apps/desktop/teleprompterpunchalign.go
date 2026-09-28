package main

import (
	"context"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Punch and roll's offline fallback (teleprompter-manuscript-integration.prd.md Phase 12, ADR 0560, owner decision
// 2026-09-23: live anchors first, offline alignment when no anchor covers the word). When the anchors the poll recorded
// (teleprompterpunchpoll.go) cannot bracket a flagged word, "Punch from here" times it from the chapter's recording
// instead: the chapter's track (the same match the resume prompt reads, teleprompterlocate.go), the recorded item the
// word is in, at most teleprompter.MaxTailSeconds of it, and one run of the sidecar's `--align-word` mode
// (teleprompter.Service.AlignWord), whose answer, seconds into the take's source file, is mapped back onto the project
// timeline through the item's position, offset and rate. It only reads: nothing in REAPER moves until the narrator
// confirms the punch.

// punchAligner times word of chapterID from the recording; estimate is the anchors' pace estimate for it (nil when
// there is none), which says which stretch of the recording to decode. ok is false whenever the recording cannot
// answer (no track, nothing recorded, the model not installed, REAPER recording onto the track, a sidecar failure, or
// the word not in the stretch): the caller then falls back to the estimate.
type punchAligner func(chapterID string, word int, estimate *float64) (position float64, ok bool)

// punchItem is one recorded item of the chapter's track as the alignment uses it: its span on the project timeline
// and how that maps onto its take's source file (the item plays Length*Rate seconds of source from SourceStart).
type punchItem struct {
	Position    float64
	Length      float64
	SourceStart float64
	Rate        float64
	File        string
}

func (item punchItem) end() float64            { return item.Position + item.Length }
func (item punchItem) contains(t float64) bool { return t >= item.Position && t < item.end() }
func (item punchItem) toSource(t float64) float64 {
	return item.SourceStart + (t-item.Position)*item.Rate
}
func (item punchItem) toProject(s float64) float64 {
	return item.Position + (s-item.SourceStart)/item.Rate
}

// savedPunchItems is the saved track's items the alignment can decode: unmuted, overlapping within (a chapter region's
// span, nil for the whole track), with a source file that is there and supported and a take with no stretch markers
// (which bend the item's time away from its source's).
func savedPunchItems(track *tracks.Track, within *tracks.Span) []punchItem {
	if track == nil {
		return nil
	}
	var items []punchItem
	for _, item := range track.Items {
		if item.Muted || item.Length <= 0 || item.SourceFile == "" || !item.SourceAvailable || !item.Supported {
			continue
		}
		if within != nil && (item.Position >= within.End || item.Position+item.Length <= within.Start) {
			continue
		}
		if take, ok := savedTake(track, item.TakeGUID); ok && take.StretchMarkerCount > 0 {
			continue
		}
		items = append(items, punchItem{Position: item.Position, Length: item.Length, SourceStart: item.SourceStart, Rate: positiveRate(item.PlayRate), File: item.SourceFile})
	}
	return items
}

// livePunchItems is the same from REAPER's live answer, with the take's section start and mute filled in from the
// saved track where the live answer lacks them (liveEndAt, liveMuted, as the resume prompt's live reading does).
func livePunchItems(state dawport.TrackState, saved *tracks.Track, within *tracks.Span, projectFolder string) []punchItem {
	var items []punchItem
	for _, item := range state.Items {
		if item.TakeGUID == "" || item.SourceFile == "" || liveMuted(item, saved) || item.Length <= 0 {
			continue
		}
		if within != nil && (item.Position >= within.End || item.Position+item.Length <= within.Start) {
			continue
		}
		mapped := liveEndAt(item, item.Position, saved, projectFolder)
		if !mapped.SourceAvailable || !mapped.Supported || mapped.Approximate {
			continue
		}
		items = append(items, punchItem{Position: item.Position, Length: item.Length, SourceStart: mapped.SourceStart, Rate: positiveRate(item.PlayRate), File: mapped.SourceFile})
	}
	return items
}

func positiveRate(rate float64) float64 {
	if rate <= 0 {
		return 1
	}
	return rate
}

// pickPunchStretch is the item to decode and the project span of it to decode: the item holding the estimate (the one
// starting last when several overlap, as it plays on top) with at most teleprompter.MaxTailSeconds centred on the
// estimate, or, with no estimate or none holding it, the last teleprompter.MaxTailSeconds of the item that ends last
// (a flag is most often on what was just read). ok is false with no item.
func pickPunchStretch(items []punchItem, estimate *float64) (item punchItem, from, to float64, ok bool) {
	var holding, last *punchItem
	for i := range items {
		candidate := &items[i]
		if last == nil || candidate.end() > last.end() {
			last = candidate
		}
		if estimate != nil && candidate.contains(*estimate) && (holding == nil || candidate.Position >= holding.Position) {
			holding = candidate
		}
	}
	switch {
	case holding != nil:
		from = max(holding.Position, *estimate-teleprompter.MaxTailSeconds/2)
		to = min(holding.end(), from+teleprompter.MaxTailSeconds)
		from = max(holding.Position, to-teleprompter.MaxTailSeconds)
		return *holding, from, to, true
	case last != nil:
		return *last, max(last.Position, last.end()-teleprompter.MaxTailSeconds), last.end(), true
	}
	return punchItem{}, 0, 0, false
}

// punchAlignCache keeps the last alignment the sidecar answered, so the punch that follows a preview of the same word
// over the same stretch reuses it rather than decoding the same audio again.
type punchAlignCache struct {
	mu sync.Mutex
	// +checklocks:mu
	request teleprompter.AlignRequest
	// +checklocks:mu
	result teleprompter.WordTime
	// +checklocks:mu
	held bool
}

func (cache *punchAlignCache) get(request teleprompter.AlignRequest) (teleprompter.WordTime, bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	return cache.result, cache.held && cache.request == request
}

func (cache *punchAlignCache) put(request teleprompter.AlignRequest, result teleprompter.WordTime) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	cache.request, cache.result, cache.held = request, result, true
}

// punchAlignerFor is the production punchAligner: it reads the chapter's track live when REAPER can say (live is nil
// when it cannot) and from the saved project otherwise, and times the word with the installed default Whisper model.
func (h *Host) punchAlignerFor(svc hostServices, live trackStateReader) punchAligner {
	return func(chapterID string, word int, estimate *float64) (float64, bool) {
		if svc.teleprompter == nil {
			return 0, false
		}
		item, from, to, ok := h.punchStretch(svc, live, chapterID, estimate)
		if !ok {
			return 0, false
		}
		modelID, modelDir, required, err := h.teleprompterModel("")
		if err != nil || required != nil {
			return 0, false
		}
		request := teleprompter.AlignRequest{Word: word, Recording: teleprompter.LocateRequest{
			Chapter: chapterID, Audio: item.File, From: item.toSource(from), To: item.toSource(to), Model: modelID, ModelDir: modelDir,
		}}
		timed, held := h.punchAlignments.get(request)
		if !held {
			ctx, cancel := context.WithTimeout(context.Background(), teleprompterLocateTimeout)
			defer cancel()
			run := h.runLog.Begin("teleprompter_punch_align", "chapter_id", chapterID)
			timed, err = svc.teleprompter.AlignWord(runlog.WithRun(ctx, run), request)
			if err != nil {
				run.End("error")
				return 0, false
			}
			run.End("ok")
			h.punchAlignments.put(request, timed)
		}
		if timed.Time == nil {
			return 0, false
		}
		return item.toProject(*timed.Time), true
	}
}

// punchStretch finds the chapter's track and the stretch of its recording to decode for a word (pickPunchStretch). It
// reports false with no confident track, nothing recorded, or REAPER recording onto the track right now (its take's
// file is still growing, and a punch is refused while recording anyway).
func (h *Host) punchStretch(svc hostServices, live trackStateReader, chapterID string, estimate *float64) (punchItem, float64, float64, bool) {
	match, project, err := chapterTrackMatchIn(svc, chapterID)
	if err != nil {
		return punchItem{}, 0, 0, false
	}
	candidate, err := locateTrack(match, project, "")
	if err != nil || candidate == nil {
		return punchItem{}, 0, 0, false
	}
	saved := savedTrack(project, candidate.TrackGUID)
	items := savedPunchItems(saved, candidateSpan(*candidate))
	if state, reachable := readLiveTrack(context.Background(), live, project.Path, candidate.TrackGUID); reachable {
		if recordingOn(state) {
			return punchItem{}, 0, 0, false
		}
		items = livePunchItems(state, saved, candidateSpan(*candidate), svc.config.projectFolder)
	}
	return pickPunchStretch(items, estimate)
}
