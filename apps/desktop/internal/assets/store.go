// Package assets implements the download-verify-install-remove lifecycle
// shared by every optional first-use asset catalog (Piper voices, Whisper
// models, and future model packs). Each capability owns its own catalog
// schema and display metadata; this package only knows about a
// provider/id/version install directory made of files with an expected size
// and SHA-256.
//
// An install is staged in `<dir>.installing`, checked file by file, and renamed into place, so a partial or failed download never looks
// installed. What arrived before a network failure stays in the staging folder as `<file>.part` and the next attempt resumes it (HTTP
// Range); a cancel, or a file that fails its hash, removes it. The install directory holds a manifest with every file's size, hash,
// source and modification time: listing state trusts it, and only Verify (or the first load of a session, Ready) reads the bytes.
package assets

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// The two ways a downloaded file can disagree with its catalog entry. A caller matches on them, not on the text.
var (
	ErrSizeMismatch     = errors.New("unexpected asset size")
	ErrChecksumMismatch = errors.New("asset checksum mismatch")
)

type File struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// Dir returns the install directory for one catalog item under root.
func Dir(root, provider, id, version string) string {
	return filepath.Join(root, provider, id, version)
}

// State reports "installed", "not_installed", or "verification_failed" for one catalog item. It is cheap: an asset whose manifest vouches
// for the catalog entry (the same names, sizes and hashes) and whose files still have the recorded size and modification time is installed
// without reading a byte. Anything else (an asset installed before manifests held files, a file that changed) is hashed. A failed Verify
// marks the asset damaged, and it stays "verification_failed" until it is repaired or verifies again.
func State(root, provider, id, version string, files []File) string {
	dir := Dir(root, provider, id, version)
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return "not_installed"
		}
		return "verification_failed"
	}
	if manifest, err := ReadManifest(dir); err == nil {
		if manifest.Damaged {
			return "verification_failed"
		}
		if manifest.vouchesFor(dir, files) {
			return "installed"
		}
	}
	return hashState(dir, files)
}

// hashState is the state of every file after reading every byte of it.
func hashState(dir string, files []File) string {
	for _, f := range files {
		if err := verify(filepath.Join(dir, f.Name), f); err != nil {
			if os.IsNotExist(err) {
				return "not_installed"
			}
			return "verification_failed"
		}
	}
	return "installed"
}

// Verify is State that always reads every byte (the narrator's Verify button). It records the outcome in the manifest: a success refreshes
// it (which also upgrades an asset installed before manifests held files), a failure marks the asset damaged.
func Verify(root, provider, id, version string, files []File) string {
	dir := Dir(root, provider, id, version)
	state := hashState(dir, files)
	switch state {
	case "installed":
		_ = recordVerified(dir, provider, id, version, files)
	case "verification_failed":
		_ = recordDamaged(dir, provider, id, version)
	}
	return state
}

func verify(path string, f File) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Size() != f.Size {
		return ErrSizeMismatch
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }() // read-only: a close error cannot change the digest
	h := sha256.New()
	if _, err = io.Copy(h, file); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != f.SHA256 {
		return ErrChecksumMismatch
	}
	return nil
}

// Options are the parts of an install a caller may add to. The zero value is the plain install the voices and models use.
type Options struct {
	// Client makes the requests; nil is http.DefaultClient. The app's own update gives it a redirect policy.
	Client *http.Client
	// OnProgress is called as bytes of a file arrive, with the file and how many bytes of it there are so far. A file that was resumed
	// starts at what it already had, and a file that was already complete reports its whole size.
	OnProgress func(file File, done int64)
	// OnVerify is called once per file, after every byte of it has arrived and before it is checked against its size and SHA-256, so a job
	// can say it is checking (a multi-gigabyte model takes seconds to hash).
	OnVerify func(file File)
	// Preflight is asked once, before anything is written, with the root and the bytes still to be downloaded (what a resumed staging folder
	// already holds is not counted), and may refuse (a full disk). It is not asked when the asset is already installed.
	Preflight func(root string, total int64) error
	// Force installs even when State says the asset is installed: Repair, after a Verify that found it damaged.
	Force bool
	// NoResume makes an install start from nothing and leave nothing when it fails: the staging folder of an earlier attempt is removed
	// first, and this attempt's is removed if it fails. The app's own update uses it (a program that is not wanted is not kept).
	NoResume bool
}

// Install downloads every catalog-owned file into an adjacent staging
// directory, verifies each against its expected size and hash, and only then
// atomically renames the staging directory into place. A partial or failed
// download never becomes visible as an installed asset.
func Install(ctx context.Context, root, provider, id, version string, files []File) error {
	return InstallWith(ctx, root, provider, id, version, files, Options{})
}

// InstallWith is Install with the options of Options.
func InstallWith(ctx context.Context, root, provider, id, version string, files []File, options Options) error {
	if !options.Force && State(root, provider, id, version, files) == "installed" {
		return nil
	}
	target := Dir(root, provider, id, version)
	staging := target + stagingSuffix
	if options.NoResume {
		_ = os.RemoveAll(staging)
	}
	if options.Preflight != nil {
		if err := options.Preflight(root, remainingBytes(staging, files)); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return err
	}
	fail := func(err error) error {
		if options.NoResume || !resumable(ctx, err) {
			_ = os.RemoveAll(staging)
		}
		return err
	}
	for _, file := range files {
		if err := download(ctx, staging, file, options); err != nil {
			return fail(err)
		}
	}
	if err := pruneStaging(staging, files); err != nil {
		return fail(err)
	}
	if err := writeInstalledManifest(staging, provider, id, version, files); err != nil {
		return fail(err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fail(err)
	}
	if err := swapIn(staging, target); err != nil {
		return fail(err)
	}
	Forget(root, provider, id, version)
	return nil
}

// resumable says whether what a failed install fetched is worth keeping for the next attempt: it is unless the narrator cancelled or a
// file was wrong (bytes that failed their hash must not be resumed from).
func resumable(ctx context.Context, err error) bool {
	return ctx.Err() == nil && !errors.Is(err, ErrChecksumMismatch) && !errors.Is(err, ErrSizeMismatch)
}

// swapIn puts the staging folder where the install belongs. An existing target (a damaged install) is renamed aside first and removed
// only once the new one is in place, and put back if that fails, so there is never a moment with neither.
func swapIn(staging, target string) error {
	if _, err := os.Stat(target); err != nil {
		return os.Rename(staging, target)
	}
	aside := fmt.Sprintf("%s%s%d", target, asideMarker, time.Now().UnixNano())
	if err := os.Rename(target, aside); err != nil {
		return err
	}
	if err := os.Rename(staging, target); err != nil {
		_ = os.Rename(aside, target)
		return err
	}
	_ = os.RemoveAll(aside) // a leftover is cleaned up at the next start (CleanStale)
	return nil
}

// Repair reads the asset in full and, if it is damaged or incomplete, downloads it again and swaps the fresh copy in. An asset that
// verifies is left alone and nothing is downloaded. If the download fails the damaged copy stays where it was.
func Repair(ctx context.Context, root, provider, id, version string, files []File, options Options) error {
	Forget(root, provider, id, version)
	if Verify(root, provider, id, version, files) == "installed" {
		return nil
	}
	options.Force = true
	return InstallWith(ctx, root, provider, id, version, files, options)
}

// Remove deletes one catalog item's install directory.
func Remove(root, provider, id, version string) error {
	Forget(root, provider, id, version)
	return os.RemoveAll(Dir(root, provider, id, version))
}
