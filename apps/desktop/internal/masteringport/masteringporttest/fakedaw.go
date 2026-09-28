package masteringporttest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
)

// FakeDAW is the DAW the suite masters ModeDAWRegion rows through (render-encode-master PRD Phase 9): a dawport.Adapter that declares
// render_with_fx and master_chain_read Experimental, with the narrator's settings allowing them, and keeps the bridge's promises the
// way integrations/reaper/narration_master_render.lua does. Its render refuses a request with no approval, an approval it has seen
// before, or a folder that is not an empty folder inside the project; otherwise it writes the suite's tone as one WAV per region
// into that folder and answers FX_RENDER_FILE and FX_RENDERED through its events. Misbehave makes it answer wrongly on purpose.
type FakeDAW struct {
	project string

	mu sync.Mutex // guards everything below
	// +checklocks:mu
	misbehave Misbehaviour
	// +checklocks:mu
	renders []dawport.FXRender
	// +checklocks:mu
	refusals []string
	// +checklocks:mu
	subs map[int]dawport.Subscription
	// +checklocks:mu
	next int
	// +checklocks:mu
	queue []dawport.Event
}

// Misbehaviour is how a FakeDAW answers a render wrongly, to show a row does not trust the DAW's answer.
type Misbehaviour int

const (
	// Behaves renders as asked.
	Behaves Misbehaviour = iota
	// Escapes reports a rendered file outside the run folder (and writes it there).
	Escapes
	// Fails answers the render with ERROR.
	Fails
)

var _ dawport.Adapter = (*FakeDAW)(nil)

// NewFakeDAW is a fake DAW whose project folder is project.
func NewFakeDAW(project string) *FakeDAW {
	return &FakeDAW{project: project, subs: map[int]dawport.Subscription{}}
}

// Session is the fake as the rows see a launch's DAW.
func (f *FakeDAW) Session() masteringport.Session {
	return masteringport.Session{
		Resolver: dawport.NewResolver(dawport.ResolverConfig{
			Adapter:      f,
			Runtime:      func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} },
			Experimental: func() bool { return true },
		}),
		ProjectFolder: f.project,
	}
}

// Misbehave sets how the next renders answer.
func (f *FakeDAW) Misbehave(m Misbehaviour) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.misbehave = m
}

// Renders are the renders the fake was asked for, refused or not, in order.
func (f *FakeDAW) Renders() []dawport.FXRender {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.renders)
}

// Refusals are why the fake refused each render it refused, in order.
func (f *FakeDAW) Refusals() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.refusals)
}

func (f *FakeDAW) Kind() dawport.Kind { return dawport.KindREAPER }

func (f *FakeDAW) Declares() map[dawport.Capability]dawport.Level {
	return map[dawport.Capability]dawport.Level{dawport.CapRenderWithFX: dawport.Experimental, dawport.CapMasterChainRead: dawport.Experimental}
}

func (f *FakeDAW) Role(c dawport.Capability) any {
	switch c {
	case dawport.CapRenderWithFX:
		return fakeRenderer{f}
	case dawport.CapMasterChainRead:
		return fakeChainReader{}
	default:
		return nil
	}
}

type fakeChainReader struct{}

func (fakeChainReader) ReadMasterChain(context.Context) (dawport.MasterChain, error) {
	return dawport.MasterChain{
		Tracks: []dawport.TrackFX{{TrackGUID: "{00000001-0000-4000-8000-000000000001}", Name: "Voice",
			FX: []dawport.FXSlot{{Name: "VST: ReaEQ (Cockos)", Enabled: true}}}},
		Master: []dawport.FXSlot{{Name: "VST: ReaLimit (Cockos)", Enabled: true}},
	}, nil
}

type fakeRenderer struct{ f *FakeDAW }

func (r fakeRenderer) Subscribe(sub dawport.Subscription) (unsubscribe func()) {
	f := r.f
	f.mu.Lock()
	defer f.mu.Unlock()
	id := f.next
	f.next++
	f.subs[id] = sub
	return func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		delete(f.subs, id)
	}
}

// Dispatch delivers what the fake has queued, in order, to the subscriptions whose tags match and who own the run, as the bridge
// client's fan-out does. Handlers run without the lock held.
func (r fakeRenderer) Dispatch() error {
	f := r.f
	f.mu.Lock()
	queue := f.queue
	f.queue = nil
	subs := make([]dawport.Subscription, 0, len(f.subs))
	for id := range f.next {
		if sub, ok := f.subs[id]; ok {
			subs = append(subs, sub)
		}
	}
	f.mu.Unlock()
	for _, event := range queue {
		for _, sub := range subs {
			if slices.Contains(sub.Tags, event.Tag) && (sub.Owns == nil || sub.Owns(event.RunID)) {
				sub.Handle(event)
			}
		}
	}
	return nil
}

func (r fakeRenderer) RenderWithFX(runID string, render dawport.FXRender) error {
	f := r.f
	f.mu.Lock()
	defer f.mu.Unlock()
	f.renders = append(f.renders, render)
	if refusal := f.refusalLocked(render); refusal != "" {
		f.refusals = append(f.refusals, refusal)
		f.emitLocked("ERROR", runID, refusal)
		return nil
	}
	if f.misbehave == Fails {
		f.emitLocked("ERROR", runID, "The fake DAW could not render.")
		return nil
	}
	for i, region := range render.Regions {
		path := filepath.Join(render.OutputFolder, fmt.Sprintf("fx-%02d.wav", i+1))
		if f.misbehave == Escapes {
			path = filepath.Join(filepath.Dir(render.OutputFolder), "escaped.wav")
		}
		if err := os.WriteFile(path, ToneWAV(), 0o600); err != nil {
			f.emitLocked("ERROR", runID, err.Error())
			return nil
		}
		f.emitLocked("FX_RENDER_FILE", runID, region, path)
	}
	f.emitLocked("FX_RENDERED", runID, render.OutputFolder, "1")
	return nil
}

// refusalLocked is why the bridge would refuse render, or "".
//
// +checklocks:f.mu
func (f *FakeDAW) refusalLocked(render dawport.FXRender) string {
	if render.Approval == "" {
		return "no approval"
	}
	for _, earlier := range f.renders[:len(f.renders)-1] {
		if earlier.Approval == render.Approval {
			return "an approval used twice"
		}
	}
	rel, err := filepath.Rel(filepath.Join(f.project, "narration-utils", "mastering"), render.OutputFolder)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || strings.ContainsRune(rel, filepath.Separator) {
		return "a folder that is not a run folder inside the project"
	}
	entries, err := os.ReadDir(render.OutputFolder)
	if err != nil || len(entries) > 0 {
		return "a folder that does not exist or is not empty"
	}
	return ""
}

// +checklocks:f.mu
func (f *FakeDAW) emitLocked(tag, runID string, fields ...string) {
	f.queue = append(f.queue, dawport.Event{Tag: tag, RunID: runID, Fields: append([]string{tag, runID}, fields...)})
}
