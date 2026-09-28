package masteringport

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Audacity is the row that masters with the narrator's chosen Audacity effect macro (ADR 0306, ADR 0460, render-encode-master PRD
// Phase 10). Unlike daw.go it masters a rendered WAV (ModeWAV): Audacity has no per-track FX chain or region it can enumerate or
// render from over its scripting pipe, only a named macro it applies to whatever it imports. It shares daw.go's session, run-folder
// and place-without-replacing machinery (dawSession, randomHex, placeNew), because both rows are DAW-triggered renders under the
// same four conditions (ADR 0306): the narrator's approval for this one run, their own action, Experimental until the owner's pass,
// and a folder the host made that nothing outside it can be written to.
const Audacity = "audacity"

const audacityLabel = "Audacity's effect macro"

func init() {
	Rows.Register(port.Entry[Mastering]{
		Name:       Audacity,
		Descriptor: port.Descriptor{Label: audacityLabel, Modes: []string{ModeWAV}},
		New:        func() Mastering { return audacityChain{} },
	})
}

// ErrNoMacro: an Audacity master was asked with no macro name.
var ErrNoMacro = errors.New("choose the macro this master applies")

// audacityChain is the Audacity row. Master imports req.Source into Audacity as its own track (never whatever else the narrator
// has open), applies req.Macro to it, exports into a fresh run folder inside the project, moves the one file into place without
// ever replacing a file, then answers Judge's verdict, never a level Audacity itself reports.
type audacityChain struct{}

var _ Mastering = audacityChain{}

func (audacityChain) Name() string { return Audacity }

func (audacityChain) Capabilities() Capabilities {
	return Capabilities{
		Level:         port.Experimental,
		NeedsApproval: true,
		Needs:         []dawport.Capability{dawport.CapMacroRender},
	}
}

func (audacityChain) Master(ctx context.Context, req Request) (Result, error) {
	if !req.Approved {
		return Result{}, ErrNotApproved
	}
	dest, err := newDestination(req.Source, req.Destination)
	if err != nil {
		return Result{}, err
	}
	if req.Macro == "" {
		return Result{}, ErrNoMacro
	}
	if req.Source == "" {
		return Result{}, errors.New("name the WAV to master")
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	session, err := dawSession()
	if err != nil {
		return Result{}, err
	}
	renderer, err := dawport.Role[dawport.MacroRenderer](session.Resolver, dawport.CapMacroRender)
	if err != nil {
		return Result{}, err
	}
	progress(req, 0)

	runID, err := randomHex(8)
	if err != nil {
		return Result{}, err
	}
	runID = "master-" + runID
	folder := filepath.Join(session.ProjectFolder, "narration-utils", "mastering", runID)
	if err := os.MkdirAll(filepath.Dir(folder), 0o750); err != nil {
		return Result{}, err
	}
	if err := os.Mkdir(folder, 0o750); err != nil {
		return Result{}, err
	}
	defer func() { _ = os.RemoveAll(folder) }()

	token, err := randomHex(16)
	if err != nil {
		return Result{}, err
	}
	outputPath := filepath.Join(folder, "master.wav")
	rendered, err := renderer.RenderWithMacro(ctx, dawport.MacroRender{
		Source: req.Source, Macro: req.Macro, OutputPath: outputPath, Approval: token,
	})
	if err != nil {
		return Result{}, err
	}
	file, err := renderedMacroFile(folder, rendered.Path)
	if err != nil {
		return Result{}, err
	}
	if err := placeNew(file, dest); err != nil {
		return Result{}, err
	}
	after, judgement, err := Judge(ctx, dest, req.Profile)
	if err != nil {
		_ = os.Remove(dest)
		return Result{}, err
	}
	progress(req, 1)
	return Result{
		Provider:    Audacity,
		Source:      req.Source,
		Destination: dest,
		Profile:     req.Profile.Key(),
		Chain: []Step{
			{Name: "Import", Detail: "the rendered chapter, as its own track"},
			{Name: "Macro", Detail: fmt.Sprintf("%q", req.Macro)},
			{Name: "Export", Detail: "Export2, into a run folder this app made"},
		},
		After:     after,
		Judgement: judgement,
	}, nil
}

// renderedMacroFile is the one WAV a macro render wrote, refused unless it is a regular file directly inside folder: the same
// defence daw.go's renderedFile gives the FX render, against an adapter that answers with a path outside the folder this row made.
func renderedMacroFile(folder, path string) (string, error) {
	clean := filepath.Clean(path)
	if filepath.Dir(clean) != filepath.Clean(folder) || !strings.EqualFold(filepath.Ext(clean), ".wav") {
		return "", errors.New("audacity exported a file outside the folder this app made for it")
	}
	info, err := os.Lstat(clean)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("audacity's exported file is missing")
	}
	return clean, nil
}
