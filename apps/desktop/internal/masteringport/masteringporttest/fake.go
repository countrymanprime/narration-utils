package masteringporttest

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Fake is the mock row (D67): it "masters" a WAV by copying it, then answers masteringport.Judge's verdict on the copy, as every row
// must. It keeps the port's promises (a new file only, never over the source, nothing left on failure), so the suite passes it and
// a consumer can be built and tested against it before a real row exists.
type Fake struct {
	name          string
	needsApproval bool
}

var _ masteringport.Mastering = Fake{}

// NewFake is a ModeWAV row called name; needsApproval makes it refuse a request the narrator has not approved, as a DAW row does.
func NewFake(name string, needsApproval bool) Fake {
	return Fake{name: name, needsApproval: needsApproval}
}

// Entry is the fake's registry row.
func (f Fake) Entry() port.Entry[masteringport.Mastering] {
	return port.Entry[masteringport.Mastering]{
		Name:       f.name,
		Descriptor: port.Descriptor{Label: "Fake chain (a copy)", Modes: []string{masteringport.ModeWAV}},
		New:        func() masteringport.Mastering { return f },
	}
}

func (f Fake) Name() string { return f.name }

func (f Fake) Capabilities() masteringport.Capabilities {
	return masteringport.Capabilities{Level: port.Supported, NeedsApproval: f.needsApproval}
}

func (f Fake) Master(ctx context.Context, req masteringport.Request) (masteringport.Result, error) {
	if f.needsApproval && !req.Approved {
		return masteringport.Result{}, masteringport.ErrNotApproved
	}
	source, err := filepath.Abs(req.Source)
	if err != nil {
		return masteringport.Result{}, err
	}
	dest, err := filepath.Abs(req.Destination)
	if err != nil {
		return masteringport.Result{}, err
	}
	if source == dest {
		return masteringport.Result{}, masteringport.ErrSameFile
	}
	if _, err := os.Lstat(dest); err == nil {
		return masteringport.Result{}, masteringport.ErrDestinationExists
	}
	if err := ctx.Err(); err != nil {
		return masteringport.Result{}, err
	}
	before, _, err := masteringport.Judge(ctx, source, req.Profile)
	if err != nil {
		return masteringport.Result{}, err
	}
	if err := copyNew(source, dest); err != nil {
		return masteringport.Result{}, err
	}
	after, judgement, err := masteringport.Judge(ctx, dest, req.Profile)
	if err != nil {
		_ = os.Remove(dest)
		return masteringport.Result{}, err
	}
	if req.Progress != nil {
		req.Progress(1, 1)
	}
	return masteringport.Result{
		Provider: f.name, Source: source, Destination: dest, Profile: req.Profile.Key(),
		Chain:  []masteringport.Step{{Name: "Copy", Detail: "Unchanged"}},
		Before: &before, After: after, Judgement: judgement,
	}, nil
}

// copyNew copies source to a new file at dest, refusing one that exists, and removes what it wrote on failure.
func copyNew(source, dest string) (err error) {
	in, err := os.Open(source) //nolint:gosec // G304: a test-only fake; source is the path its test chose
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600) //nolint:gosec // G304: as above
	if errors.Is(err, os.ErrExist) {
		return masteringport.ErrDestinationExists
	}
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := out.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(dest)
		}
	}()
	_, err = io.Copy(out, in)
	return err
}
