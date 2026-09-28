package masteringport

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// DAW is the row that masters with the project's own track and master FX, in the DAW.
const DAW = "daw"

const dawLabel = "Your DAW's FX chain"

func init() {
	Rows.Register(port.Entry[Mastering]{
		Name:       DAW,
		Descriptor: port.Descriptor{Label: dawLabel, Modes: []string{ModeDAWRegion}},
		New:        func() Mastering { return dawChain{} },
	})
}

// Session is the launch's DAW as a row that makes the DAW render sees it: the DAW port's resolver, which hands out the
// render_with_fx and master_chain_read roles only while the engine declares them and the narrator's settings allow them, and the
// app's project folder, inside which the row makes each run's render folder.
type Session struct {
	Resolver      *dawport.Resolver
	ProjectFolder string
}

// ErrNoDAW: the launch has no DAW session for the DAW row to render with (the host has not set one with UseSession).
var ErrNoDAW = errors.New("your DAW is not connected to this app, so its FX chain cannot master this")

// ErrNoRegion: a DAW row was asked to master without a region to render.
var ErrNoRegion = errors.New("name the region the DAW renders")

var (
	sessionMu sync.RWMutex
	// +checklocks:sessionMu
	currentSession func() (Session, error)
)

// UseSession sets how the DAW-rendering rows find the launch's DAW, asked on each master (so a project switch is seen at once),
// and returns a function that puts the previous one back. The host sets it where it builds the DAW port resolver; the conformance
// suite sets a fake DAW for the length of a run.
func UseSession(session func() (Session, error)) (restore func()) {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	previous := currentSession
	currentSession = session
	return func() {
		sessionMu.Lock()
		defer sessionMu.Unlock()
		currentSession = previous
	}
}

func dawSession() (Session, error) {
	sessionMu.RLock()
	session := currentSession
	sessionMu.RUnlock()
	if session == nil {
		return Session{}, ErrNoDAW
	}
	s, err := session()
	if err != nil {
		return Session{}, err
	}
	if s.Resolver == nil || s.ProjectFolder == "" {
		return Session{}, ErrNoDAW
	}
	return s, nil
}

// renderTimeout is how long a master waits for the DAW to answer its render, a chapter's render included.
var renderTimeout = 30 * time.Minute

// dispatchEvery is how often a master waiting for its render reads what the engine reported.
const dispatchEvery = 50 * time.Millisecond

// dawChain is the DAW row (ADR 0306, render-encode-master PRD Phase 9). Master reads the chain the render will run
// (master_chain_read), makes an empty folder for the run inside the app's project folder, asks the engine to render req.Region
// through its FX there (render_with_fx) with a one-time approval token made from req.Approved, waits for the one file, and moves it
// to req.Destination without ever replacing a file. It then answers Judge's verdict on that file, never a level the DAW reports.
// Experimental until the owner's REAPER pass (#510).
type dawChain struct{}

var _ Mastering = dawChain{}

func (dawChain) Name() string { return DAW }

func (dawChain) Capabilities() Capabilities {
	return Capabilities{
		Level:         port.Experimental,
		NeedsApproval: true,
		Needs:         []dawport.Capability{dawport.CapRenderWithFX, dawport.CapMasterChainRead},
	}
}

func (dawChain) Master(ctx context.Context, req Request) (Result, error) {
	if !req.Approved {
		return Result{}, ErrNotApproved
	}
	dest, err := newDestination(req.Source, req.Destination)
	if err != nil {
		return Result{}, err
	}
	if req.Region == "" {
		return Result{}, ErrNoRegion
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	session, err := dawSession()
	if err != nil {
		return Result{}, err
	}
	reader, err := dawport.Role[dawport.MasterChainReader](session.Resolver, dawport.CapMasterChainRead)
	if err != nil {
		return Result{}, err
	}
	renderer, err := dawport.Role[dawport.FXRenderer](session.Resolver, dawport.CapRenderWithFX)
	if err != nil {
		return Result{}, err
	}
	progress(req, 0)
	chain, err := reader.ReadMasterChain(ctx)
	if err != nil {
		return Result{}, err
	}

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

	rendered, err := render(ctx, renderer, runID, dawport.FXRender{Regions: []string{req.Region}, OutputFolder: folder})
	if err != nil {
		return Result{}, err
	}
	file, err := renderedFile(folder, req.Region, rendered)
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
		Provider:    DAW,
		Destination: dest,
		Profile:     req.Profile.Key(),
		Chain:       chainSteps(chain, req.Region),
		After:       after,
		Judgement:   judgement,
	}, nil
}

func progress(req Request, done int64) {
	if req.Progress != nil {
		req.Progress(done, 1)
	}
}

// newDestination is dest made absolute, refused when it is the source (a DAW row does not read one, but a request may still name
// it) or when anything is already there.
func newDestination(source, dest string) (string, error) {
	dest, err := filepath.Abs(dest)
	if err != nil {
		return "", err
	}
	if source != "" {
		if abs, err := filepath.Abs(source); err == nil && abs == dest {
			return "", ErrSameFile
		}
	}
	info, err := os.Lstat(dest)
	if errors.Is(err, fs.ErrNotExist) {
		return dest, nil
	}
	if err != nil {
		return "", err
	}
	if sourceInfo, statErr := os.Stat(source); source != "" && statErr == nil && os.SameFile(sourceInfo, info) {
		return "", ErrSameFile
	}
	return "", fmt.Errorf("%s: %w", dest, ErrDestinationExists)
}

// render asks the engine for one render with a fresh approval token and waits for its answer, reading the engine's events itself
// (Dispatch is safe beside the host's own loop). The token is the narrator's approval for this render only: it is made here, sent
// once, and never kept.
func render(ctx context.Context, renderer dawport.FXRenderer, runID string, request dawport.FXRender) (dawport.FXRendered, error) {
	token, err := randomHex(16)
	if err != nil {
		return dawport.FXRendered{}, err
	}
	request.Approval = token
	answers := make(chan renderAnswer, 1)
	var got dawport.FXRendered
	finish := func(answer renderAnswer) {
		select {
		case answers <- answer:
		default:
		}
	}
	unsubscribe := renderer.Subscribe(dawport.Subscription{
		Tags: []string{"FX_RENDER_FILE", "FX_RENDERED", "ERROR"},
		Owns: func(id string) bool { return id == runID },
		Handle: func(event dawport.Event) {
			if event.RunID != runID {
				return
			}
			switch event.Tag {
			case "FX_RENDER_FILE":
				got.Files = append(got.Files, dawport.FXRenderedFile{Region: event.Fields[2], Path: event.Fields[3]})
			case "FX_RENDERED":
				finish(renderAnswer{rendered: got})
			case "ERROR":
				message := "the DAW could not render"
				if len(event.Fields) > 2 && event.Fields[2] != "" {
					message = event.Fields[2]
				}
				finish(renderAnswer{err: errors.New(message)})
			}
		},
		Invalid: func(_ dawport.Event, reason error) {
			finish(renderAnswer{err: fmt.Errorf("the DAW sent an answer this app could not read (%w): import the Narration Utils script from this app's REAPER folder again", reason)})
		},
	})
	defer unsubscribe()
	if err := renderer.RenderWithFX(runID, request); err != nil {
		return dawport.FXRendered{}, err
	}
	timeout := time.NewTimer(renderTimeout)
	defer timeout.Stop()
	tick := time.NewTicker(dispatchEvery)
	defer tick.Stop()
	for {
		if err := renderer.Dispatch(); err != nil {
			return dawport.FXRendered{}, err
		}
		select {
		case answer := <-answers:
			return answer.rendered, answer.err
		case <-ctx.Done():
			return dawport.FXRendered{}, ctx.Err()
		case <-timeout.C:
			return dawport.FXRendered{}, errors.New("the DAW did not finish the render in time")
		case <-tick.C:
		}
	}
}

type renderAnswer struct {
	rendered dawport.FXRendered
	err      error
}

// renderedFile is the one WAV the render wrote for region, refused unless it is a regular file directly inside folder.
func renderedFile(folder, region string, rendered dawport.FXRendered) (string, error) {
	if len(rendered.Files) != 1 || rendered.Files[0].Region != region {
		return "", fmt.Errorf("the DAW rendered %d files, not the one region asked for", len(rendered.Files))
	}
	path := filepath.Clean(rendered.Files[0].Path)
	if filepath.Dir(path) != filepath.Clean(folder) || !strings.EqualFold(filepath.Ext(path), ".wav") {
		return "", errors.New("the DAW rendered a file outside the folder this app made for it")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("the DAW's rendered file is missing")
	}
	return path, nil
}

// placeNew moves the rendered file to dest without ever replacing a file: a hard link where the disk allows one (it fails if dest
// exists), otherwise a copy beside dest moved into place once dest is still free, as the built-in chain does.
func placeNew(file, dest string) error {
	err := os.Link(file, dest)
	if err == nil {
		return nil
	}
	if errors.Is(err, fs.ErrExist) {
		return fmt.Errorf("%s: %w", dest, ErrDestinationExists)
	}
	temp, err := os.CreateTemp(filepath.Dir(dest), ".mastering-*.wav")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	in, err := os.Open(file) //nolint:gosec // G304: the rendered file, checked to be inside the run folder the row made
	if err == nil {
		_, err = io.Copy(temp, in)
		_ = in.Close()
	}
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		if _, statErr := os.Lstat(dest); statErr == nil {
			err = fmt.Errorf("%s: %w", dest, ErrDestinationExists)
		}
	}
	if err == nil {
		err = os.Rename(tempPath, dest)
	}
	if err != nil {
		_ = os.Remove(tempPath)
	}
	return err
}

// chainSteps words what ran for the narrator's report: each track's FX, the master's, then the render itself.
func chainSteps(chain dawport.MasterChain, region string) []Step {
	var steps []Step
	for _, track := range chain.Tracks {
		name := track.Name
		if name == "" {
			name = "Track"
		}
		steps = append(steps, Step{Name: name, Detail: slotList(track.FX)})
	}
	if len(chain.Master) > 0 {
		steps = append(steps, Step{Name: "Master", Detail: slotList(chain.Master)})
	}
	detail := fmt.Sprintf("%q through the project's FX", region)
	if len(steps) == 0 {
		detail = fmt.Sprintf("%q, with no FX on any track or the master", region)
	}
	return append(steps, Step{Name: "Render", Detail: detail})
}

func slotList(slots []dawport.FXSlot) string {
	names := make([]string, 0, len(slots))
	for _, slot := range slots {
		if slot.Enabled {
			names = append(names, slot.Name)
		} else {
			names = append(names, slot.Name+" (off)")
		}
	}
	return strings.Join(names, ", ")
}

func randomHex(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
