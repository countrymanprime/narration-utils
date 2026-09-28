package masteringporttest

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
)

// FakeAudacity is the DAW the suite masters a macro_render row through (render-encode-master PRD Phase 10): a dawport.Adapter that
// declares macro_render Experimental, with the narrator's settings allowing it. Its render refuses a request with no approval, an
// approval it has seen before, or an output path that is not inside an empty run folder inside the project; otherwise it writes the
// suite's tone to that path. Misbehave makes it answer wrongly on purpose, mirroring FakeDAW's own Misbehaviour values.
type FakeAudacity struct {
	project string

	mu sync.Mutex // guards everything below
	// +checklocks:mu
	misbehave Misbehaviour
	// +checklocks:mu
	renders []dawport.MacroRender
	// +checklocks:mu
	refusals []string
}

var _ dawport.Adapter = (*FakeAudacity)(nil)

// NewFakeAudacity is a fake Audacity whose project folder is project.
func NewFakeAudacity(project string) *FakeAudacity { return &FakeAudacity{project: project} }

// Session is the fake as the rows see a launch's Audacity.
func (f *FakeAudacity) Session() masteringport.Session {
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
func (f *FakeAudacity) Misbehave(m Misbehaviour) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.misbehave = m
}

// Renders are the renders the fake was asked for, refused or not, in order.
func (f *FakeAudacity) Renders() []dawport.MacroRender {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.renders)
}

// Refusals are why the fake refused each render it refused, in order.
func (f *FakeAudacity) Refusals() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.refusals)
}

func (f *FakeAudacity) Kind() dawport.Kind { return dawport.KindAudacity }

func (f *FakeAudacity) Declares() map[dawport.Capability]dawport.Level {
	return map[dawport.Capability]dawport.Level{dawport.CapMacroRender: dawport.Experimental}
}

func (f *FakeAudacity) Role(c dawport.Capability) any {
	if c == dawport.CapMacroRender {
		return fakeMacroRenderer{f}
	}
	return nil
}

type fakeMacroRenderer struct{ f *FakeAudacity }

func (r fakeMacroRenderer) RenderWithMacro(_ context.Context, req dawport.MacroRender) (dawport.MacroRendered, error) {
	f := r.f
	f.mu.Lock()
	defer f.mu.Unlock()
	f.renders = append(f.renders, req)
	if refusal := f.refusalLocked(req); refusal != "" {
		f.refusals = append(f.refusals, refusal)
		return dawport.MacroRendered{}, errors.New(refusal)
	}
	if f.misbehave == Fails {
		return dawport.MacroRendered{}, errors.New("the fake Audacity could not render")
	}
	path := req.OutputPath
	if f.misbehave == Escapes {
		path = filepath.Join(filepath.Dir(filepath.Dir(req.OutputPath)), "escaped.wav")
	}
	if err := os.WriteFile(path, ToneWAV(), 0o600); err != nil {
		return dawport.MacroRendered{}, err
	}
	return dawport.MacroRendered{Path: path}, nil
}

// refusalLocked is why the bridge would refuse req, or "": mirrors FakeDAW's own checks, over an output path in place of a folder.
//
// +checklocks:f.mu
func (f *FakeAudacity) refusalLocked(req dawport.MacroRender) string {
	if req.Approval == "" {
		return "no approval"
	}
	for _, earlier := range f.renders[:len(f.renders)-1] {
		if earlier.Approval == req.Approval {
			return "an approval used twice"
		}
	}
	if req.Macro == "" {
		return "no macro named"
	}
	folder := filepath.Dir(req.OutputPath)
	rel, err := filepath.Rel(filepath.Join(f.project, "narration-utils", "mastering"), folder)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || strings.ContainsRune(rel, filepath.Separator) {
		return "an output path that is not inside a run folder inside the project"
	}
	entries, err := os.ReadDir(folder)
	if err != nil || len(entries) > 0 {
		return "a run folder that does not exist or is not empty"
	}
	return ""
}
